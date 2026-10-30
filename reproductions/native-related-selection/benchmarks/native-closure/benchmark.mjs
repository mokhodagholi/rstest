import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {
  arch,
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
} from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateFixture } from './generate.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    config: { type: 'string', default: join(root, 'profiles.json') },
    output: { type: 'string', default: join(root, 'results') },
    sizes: { type: 'string', default: '100,1000,3000' },
    profiles: { type: 'string' },
    workloads: {
      type: 'string',
      default:
        'static-leaf,dynamic-esm,dynamic-cjs,literal-native,shared-fanout,multi-change,unrelated',
    },
    samples: { type: 'string', default: '7' },
    warmups: { type: 'string', default: '2' },
    'full-samples': { type: 'string', default: '3' },
    'timeout-seconds': { type: 'string', default: '600' },
    'skip-full-gate': { type: 'boolean', default: false },
    'full-gate-profiles': { type: 'string' },
  },
});
const config = JSON.parse(await readFile(resolve(values.config), 'utf8'));
const sizes = values.sizes.split(',').map(Number);
const profiles = values.profiles?.split(',') ?? Object.keys(config.profiles);
const workloads = values.workloads.split(',');
const sampleCount = Number(values.samples);
const warmupCount = Number(values.warmups);
const fullSamples = Number(values['full-samples']);
const fullGateProfiles =
  values['full-gate-profiles']?.split(',').filter(Boolean) ?? profiles;
if (fullGateProfiles.some((name) => !profiles.includes(name)))
  throw new Error('Every full-gate profile must be a selected profile.');
if (
  profiles.includes('producer-base') &&
  profiles.includes('producer-custom') &&
  fullGateProfiles.includes('producer-base') !==
    fullGateProfiles.includes('producer-custom')
)
  throw new Error('Producer controls must use the same gate type.');
if (
  sizes.some((n) => !Number.isInteger(n) || n < 10) ||
  sampleCount < 3 ||
  warmupCount < 1 ||
  fullSamples < 3
)
  throw new Error('Invalid benchmark dimensions.');
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function hashFile(file) {
  const result = createHash('sha256');
  for await (const data of createReadStream(file)) result.update(data);
  return result.digest('hex');
}
async function fingerprint(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(mjs|cjs|js)$/.test(file))
        files.push([relative(directory, file), await hashFile(file)]);
    }
  }
  await visit(directory);
  return { count: files.length, sha256: hash(JSON.stringify(files)) };
}
const provenance = {};
for (const name of profiles) {
  const profile = config.profiles[name];
  if (!profile) throw new Error(`Unknown profile: ${name}`);
  const packageRoot = dirname(dirname(await realpath(profile.cli)));
  const packageInfo = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  );
  provenance[name] = {
    ...profile,
    packageRoot,
    version: packageInfo.version,
    compiled: await fingerprint(join(packageRoot, 'dist')),
    nativeSha256: await hashFile(profile.binding),
    supportFiles: await Promise.all(
      (profile.supportFiles ?? []).map(async (file) => ({
        file,
        sha256: await hashFile(file),
      })),
    ),
  };
}
const records = [];
const states = [];
const fixtures = [];
const startedAt = new Date().toISOString();
const harnessFiles = await Promise.all(
  ['benchmark.mjs', 'generate.mjs', 'audit-plugin.mjs'].map(async (name) => ({
    name,
    sha256: await hashFile(join(root, name)),
  })),
);
let artifactChanges = [];
const machine = {
  platform: platform(),
  arch: arch(),
  release: release(),
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  memoryBytes: totalmem(),
  initialLoad: loadavg(),
};
function launch(args, options) {
  return new Promise((fulfill) => {
    const before = performance.now();
    const child = spawn('/usr/bin/time', ['-l', process.execPath, ...args], {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '',
      stderr = '',
      error;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(
      () => {
        error = `Invocation exceeded ${values['timeout-seconds']} seconds`;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      },
      Number(values['timeout-seconds']) * 1000,
    );
    child.on('error', (cause) => {
      error = cause.message;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      fulfill({
        code,
        signal,
        stdout,
        stderr,
        error,
        durationMs: performance.now() - before,
      });
    });
  });
}
async function invoke(fixture, profileId, workloadId, workload, phase, round) {
  const profile = provenance[profileId];
  const cwd = fixture.path;
  const link = join(cwd, 'node_modules', '@rstest', 'core');
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { recursive: true, force: true });
  await symlink(profile.packageRoot, link, 'junction');
  const reportPath = join(cwd, '.benchmark-report.json');
  await rm(reportPath, { force: true });
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (/^(?:DESIGN_|DECLARATION_|DECLARED_NATIVE_|NATIVE_AUDIT_)/.test(name))
      delete env[name];
  Object.assign(
    env,
    {
      CI: 'true',
      NO_COLOR: '1',
      RSTEST_NO_AGENT: '1',
      DESIGN_METADATA_MODE: 'observe',
      DESIGN_REPORT: reportPath,
    },
    profile.env,
  );
  if (profile.plugin) env.DESIGN_PLUGIN_PATH = profile.plugin;
  if (profile.manifest)
    env.DECLARED_NATIVE_MANIFEST = fixture.manifests[profile.manifest];
  const auditPath = join(cwd, '.benchmark-audit.json');
  const auditGate = phase === 'runtime-gate' || phase === 'compilation-gate';
  if (auditGate) {
    env.DESIGN_AUDIT_PLUGIN_PATH = join(root, 'audit-plugin.mjs');
    env.SCALE_AUDIT_PATH = auditPath;
    await rm(auditPath, { force: true });
  }
  const run = await launch([profile.cli, ...workload.args], { cwd, env });
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const actual = workload.args.includes('--filesOnly')
    ? run.stdout
        .split('\n')
        .map((line) => line.trim().replaceAll('\\', '/'))
        .filter((line) => /^tests\/.*\.test\.ts$/.test(line))
        .sort()
    : (report?.files
        .map((file) => file.testPath.replaceAll('\\', '/'))
        .sort() ?? []);
  const expected = [...workload.expectedFiles].sort();
  const expectedSet = new Set(expected),
    actualSet = new Set(actual);
  const missing = expected.filter((file) => !actualSet.has(file)),
    extra = actual.filter((file) => !expectedSet.has(file));
  const diagnostic =
    /Build error:|build failed|Failed to (?:build|compile)|Native dependency selection is incomplete/i.test(
      run.stdout + run.stderr,
    );
  const runtimeOk =
    workload.args[0] !== 'run' ||
    (report?.summary.passedTests === expected.length &&
      report?.summary.failedTests === 0 &&
      report?.summary.testFiles === expected.length);
  let audit;
  let provenanceOk = true;
  if (auditGate) {
    try {
      audit = JSON.parse(await readFile(auditPath, 'utf8'));
      provenanceOk = (
        await Promise.all(audit.loadedBindings.map((file) => realpath(file)))
      ).includes(await realpath(profile.binding));
      provenanceOk &&=
        audit.entrypoints === fixture.testCount &&
        JSON.stringify(audit.compiledTests) ===
          JSON.stringify([...fixture.allFiles].sort());
      const isNativeProfile = profileId.startsWith('native');
      provenanceOk &&= isNativeProfile
        ? audit.counts.nativeMetadata > 0 &&
          audit.counts.declarations ===
            fixture.stats.nativeImporters[profile.manifest] &&
          audit.counts.literalResolveCalls ===
            fixture.stats.nativeImporters.literalResolve
        : audit.counts.declarations === 0;
      if (profile.expectedNativeMetadata === false)
        provenanceOk &&= audit.counts.nativeMetadata === 0;
      if (profile.expectedNativeMetadata === true)
        provenanceOk &&=
          audit.counts.nativeMetadata > 0 &&
          audit.counts.literalResolveCalls ===
            fixture.stats.nativeImporters.literalResolve;
    } catch {
      provenanceOk = false;
    }
  }
  const valid =
    run.code === 0 &&
    !run.error &&
    !diagnostic &&
    JSON.stringify(actual) === JSON.stringify(expected) &&
    runtimeOk &&
    provenanceOk;
  const rss = run.stderr.match(/(\d+)\s+maximum resident set size/);
  const cpu = run.stderr.match(/([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys/);
  const id = `${fixture.testCount}-${profileId}-${workloadId}-${phase}-${round}`;
  const record = {
    id,
    testCount: fixture.testCount,
    profile: profileId,
    workload: workloadId,
    phase,
    round,
    valid,
    durationMs: run.durationMs,
    maxRssBytes: rss ? Number(rss[1]) : null,
    userSeconds: cpu ? Number(cpu[2]) : null,
    sysSeconds: cpu ? Number(cpu[3]) : null,
    expectedCount: expected.length,
    actualCount: actual.length,
    expectedHash: hash(JSON.stringify(expected)),
    actualHash: hash(JSON.stringify(actual)),
    missing,
    extra,
    exit: run.code,
    signal: run.signal,
    error: run.error,
    diagnostic,
    runtimeOk,
    provenanceOk,
    audit,
    summary: report?.summary,
    load: loadavg(),
  };
  records.push(record);
  await writeFile(
    join(output, `${id}.log`),
    [
      `${process.execPath} ${profile.cli} ${workload.args.join(' ')}`,
      JSON.stringify(record),
      run.stdout,
      run.stderr,
    ].join('\n'),
  );
  if (report)
    await writeFile(
      join(output, `${id}.report.json`),
      JSON.stringify(report, null, 2) + '\n',
    );
  await writeFile(
    join(output, 'progress.json'),
    JSON.stringify({ startedAt, records }, null, 2),
  );
  if (!valid)
    console.log(
      `INVALID ${id}: missing=${missing.length} extra=${extra.length} exit=${run.code}`,
    );
  return record;
}
const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
async function save() {
  const summaries = states.map((state) => {
    const samples = records.filter(
      (item) =>
        item.testCount === state.testCount &&
        item.profile === state.profile &&
        item.workload === state.workload &&
        item.phase === 'sample',
    );
    const valid =
      state.valid &&
      samples.length === state.samples &&
      samples.every((item) => item.valid);
    const memoryValid =
      valid &&
      samples.every(
        (item) => Number.isFinite(item.maxRssBytes) && item.maxRssBytes > 0,
      );
    return {
      ...state,
      valid,
      samples: samples.length,
      medianMs: valid ? median(samples.map((item) => item.durationMs)) : null,
      minMs: valid ? Math.min(...samples.map((item) => item.durationMs)) : null,
      maxMs: valid ? Math.max(...samples.map((item) => item.durationMs)) : null,
      medianMaxRssMiB: memoryValid
        ? median(samples.map((item) => item.maxRssBytes / 1048576))
        : null,
      peakMaxRssMiB: memoryValid
        ? Math.max(...samples.map((item) => item.maxRssBytes / 1048576))
        : null,
    };
  });
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    node: process.version,
    nodeExecutable: process.execPath,
    machine: { ...machine, freeBytesAtEnd: freemem(), finalLoad: loadavg() },
    config,
    provenance,
    harnessFiles,
    artifactChanges,
    fixtures,
    summaries,
    records,
    method: {
      sampleCount,
      fullSamples,
      warmupCount,
      gatesEnabled: !values['skip-full-gate'],
      fullGateProfiles,
      gatePolicy:
        'All profiles execute full suite at <=100 tests; above that, fullGateProfiles execute full suite, remaining controls pass complete analysis-compilation + exact shared-fanout selection and native audit. Runtime workloads always assert execution.',
      ordering:
        'serial fresh CLI processes; rotation advances every pair of rounds; odd rounds reverse the order (balanced for two-case controls)',
      cache:
        'warm OS cache intended; related analysis disables persistent build cache; OS cache not flushed',
      timing:
        'spawn through process exit including /usr/bin/time wrapper, startup, analysis, compilation, execution and JSON reporter output',
      memory:
        'macOS /usr/bin/time -l maximum resident set size, bytes; process rusage metric, NOT simultaneous aggregate process-tree RSS',
      sizes:
        'generated synthetic commerce projects; not a measured private production application',
    },
  };
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  const fmt = (v) => (v == null ? '—' : v.toFixed(2));
  await writeFile(
    join(output, 'REPORT.md'),
    [
      '# Large synthetic project benchmark',
      '',
      `Node ${process.version}; ${warmupCount} warmups; ${sampleCount} measured samples (${fullSamples} for full runs).`,
      '',
      values['skip-full-gate']
        ? 'Runtime and compilation/audit gates were SKIPPED for this invocation.'
        : `Full runtime gates: all profiles at <=100 tests; ${fullGateProfiles.length ? fullGateProfiles.join(', ') : 'none'} at larger sizes. Other large controls have full analysis-compilation/audit and exact selection gates. See raw records for each gate.`,
      '',
      '| Tests | Profile | Workload | Valid | Selected | N | Median ms | Min ms | Max ms | Median max RSS MiB |',
      '| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...summaries.map(
        (s) =>
          `| ${s.testCount} | ${s.profile} | ${s.workload} | ${s.valid ? 'yes' : 'NO'} | ${s.expectedCount} | ${s.samples} | ${fmt(s.medianMs)} | ${fmt(s.minMs)} | ${fmt(s.maxMs)} | ${fmt(s.medianMaxRssMiB)} |`,
      ),
      '',
      'Every sample asserts the exact selected file set. Runtime cases also assert all expected tests pass; build diagnostics invalidate results. Incorrect cases have no timing summary.',
      '',
      'RSS is the macOS rusage maximum, not the sum of simultaneous worker-process memory. Native development-build absolute times are not release-speed evidence. These are synthetic scale measurements on one laptop with warm OS caches, not a production service SLO or CI-machine guarantee.',
      '',
    ].join('\n'),
  );
  return summaries;
}
try {
  for (const testCount of sizes) {
    const path = join(output, 'fixtures', String(testCount));
    const fixture = {
      ...(await generateFixture(path, { testCount })),
      path,
      testCount,
    };
    fixtures.push(fixture);
    console.log(`Fixture ${testCount}: ${JSON.stringify(fixture.stats)}`);
    const profileOk = new Map();
    for (const profile of profiles) {
      const fullGate = testCount <= 100 || fullGateProfiles.includes(profile);
      const gateWorkload = fullGate ? 'full-run' : 'shared-fanout';
      const gatePhase = fullGate ? 'runtime-gate' : 'compilation-gate';
      const gate = values['skip-full-gate']
        ? { valid: true }
        : await invoke(
            fixture,
            profile,
            gateWorkload,
            fixture.workloads[gateWorkload],
            gatePhase,
            0,
          );
      profileOk.set(profile, gate.valid);
      console.log(
        `${testCount} ${profile} ${gatePhase} ${gate.valid ? 'PASS' : 'FAIL'}`,
      );
    }
    const producerControls = records.filter(
      (item) =>
        item.testCount === testCount &&
        ['runtime-gate', 'compilation-gate'].includes(item.phase) &&
        ['producer-base', 'producer-custom'].includes(item.profile),
    );
    if (
      producerControls.length === 2 &&
      (!producerControls.every((item) => item.audit?.assets?.length > 0) ||
        JSON.stringify(producerControls[0].audit.assets) !==
          JSON.stringify(producerControls[1].audit.assets))
    ) {
      console.log(
        `INVALID ${testCount} producer control: emitted JavaScript differs`,
      );
      profileOk.set('producer-base', false);
      profileOk.set('producer-custom', false);
    }
    if (![...profileOk.values()].some(Boolean))
      throw new Error(
        `All ${testCount}-test profile gates failed; stopping before larger fixtures.`,
      );
    const current = [];
    for (const profile of profiles)
      for (const workload of workloads) {
        if (!fixture.workloads[workload])
          throw new Error(`Unknown workload: ${workload}`);
        if (
          config.profiles[profile].workloads &&
          !config.profiles[profile].workloads.includes(workload)
        )
          continue;
        const state = {
          testCount,
          profile,
          workload,
          expectedCount: fixture.workloads[workload].expectedFiles.length,
          samples: workload === 'full-run' ? fullSamples : sampleCount,
          valid: profileOk.get(profile),
        };
        states.push(state);
        current.push(state);
        if (state.valid)
          state.valid = (
            await invoke(
              fixture,
              profile,
              workload,
              fixture.workloads[workload],
              'selection-gate',
              0,
            )
          ).valid;
      }
    for (const [phase, count] of [
      ['warmup', warmupCount],
      [
        'sample',
        Math.max(sampleCount, workloads.includes('full-run') ? fullSamples : 0),
      ],
    ]) {
      for (let round = 0; round < count; round++) {
        const order = current.map(
          (_, index) =>
            current[(index + Math.floor(round / 2)) % current.length],
        );
        if (round % 2) order.reverse();
        for (const state of order) {
          if (!state.valid || (phase === 'sample' && round >= state.samples))
            continue;
          const record = await invoke(
            fixture,
            state.profile,
            state.workload,
            fixture.workloads[state.workload],
            phase,
            round + 1,
          );
          if (!record.valid) state.valid = false;
        }
        await save();
        console.log(`${testCount} ${phase} ${round + 1}/${count} complete`);
      }
    }
  }
} finally {
  for (const [name, info] of Object.entries(provenance)) {
    if (
      (await fingerprint(join(info.packageRoot, 'dist'))).sha256 !==
      info.compiled.sha256
    )
      artifactChanges.push(`${name}: compiled JavaScript changed`);
    if ((await hashFile(info.binding)) !== info.nativeSha256)
      artifactChanges.push(`${name}: native binary changed`);
    for (const file of info.supportFiles)
      if ((await hashFile(file.file)) !== file.sha256)
        artifactChanges.push(`${name}: ${file.file} changed`);
  }
  for (const file of harnessFiles)
    if ((await hashFile(join(root, file.name))) !== file.sha256)
      artifactChanges.push(`${file.name} changed`);
  if (artifactChanges.length) {
    console.log(
      `INVALID run: artifacts changed: ${artifactChanges.join('; ')}`,
    );
    for (const state of states) state.valid = false;
  }
  const summaries = await save();
  console.log(`Evidence: ${output}`);
  if (summaries.some((item) => !item.valid)) process.exitCode = 1;
}
