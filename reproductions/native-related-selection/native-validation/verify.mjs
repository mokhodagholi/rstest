import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2])
  throw new Error('Pass the actual precise Rstest CLI path.');
const cli = await realpath(resolve(process.argv[2]));
const runner = dirname(dirname(cli));
const fixture = resolve(root, '../validation/fixture');
const markerPlugin = resolve(root, '../declarations/native-marker-plugin.mjs');
const exampleManifest = resolve(
  root,
  '../declarations/example-native-dependencies.json',
);
const output = process.argv[3]
  ? resolve(process.argv[3])
  : join(root, 'results');
const allTests = (await readdir(join(fixture, 'tests')))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`)
  .sort();
const results = [];
const loadedBindings = new Set();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
await mkdir(output, { recursive: true });

function record(id, passed, evidence, note) {
  results.push({ id, passed, evidence, note });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}${note ? `: ${note}` : ''}`);
}

async function scenario(name, options, action) {
  const cwd = await mkdtemp(join(root, '.work-'));
  const reportPath = join(cwd, '.evidence', 'report.json');
  const auditPath = join(cwd, '.evidence', 'audit');
  const manifestPath = join(cwd, 'native-dependencies.json');
  const clean = (text) =>
    text.replaceAll(cwd, '<shop>').replaceAll(runner, '<rstest>');
  async function invoke(id, args, declarations = true) {
    await rm(reportPath, { force: true });
    await rm(auditPath, { recursive: true, force: true });
    const env = {
      ...process.env,
      CI: 'true',
      RSTEST_NO_AGENT: '1',
      NO_COLOR: '1',
      DESIGN_REPORT: reportPath,
      DESIGN_PLUGIN_PATH: declarations ? markerPlugin : '',
      DECLARED_NATIVE_MANIFEST: manifestPath,
      NATIVE_AUDIT_DIR: auditPath,
    };
    delete env.DESIGN_TYPESCRIPT_PATH;
    delete env.DESIGN_AUDIT_DIR;
    delete env.DESIGN_METADATA_MODE;
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 90_000,
      maxBuffer: 15 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    let report;
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const files = args.includes('--filesOnly')
      ? result.stdout
          .split('\n')
          .map((line) => line.trim().replaceAll('\\', '/'))
          .filter((line) => /^tests\/.*\.test\.ts$/.test(line))
          .sort()
      : (report?.files
          .map((file) => file.testPath.replaceAll('\\', '/'))
          .sort() ?? []);
    const audits = [];
    try {
      for (const file of (await readdir(auditPath)).sort()) {
        const audit = JSON.parse(await readFile(join(auditPath, file), 'utf8'));
        for (const binding of audit.loadedNativeBindings)
          loadedBindings.add(binding);
        audits.push(audit);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const evidence = JSON.parse(
      clean(
        JSON.stringify({
          id,
          scenario: name,
          command: ['rstest', ...args],
          declarations,
          exit: result.status,
          files,
          summary: report?.summary,
          failedFiles: report?.files
            .filter((file) => file.status === 'fail')
            .map((file) => file.testPath)
            .sort(),
          stdout: result.stdout,
          stderr: result.stderr,
          audits,
        }),
      ),
    );
    await writeFile(
      join(output, `${id}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    await writeFile(
      join(output, `${id}.log`),
      clean(
        [
          `scenario: ${name}`,
          `declarations: ${declarations}`,
          `rstest ${args.join(' ')}`,
          `exit: ${result.status}`,
          result.stdout,
          result.stderr,
        ].join('\n'),
      ),
    );
    if (report)
      await writeFile(
        join(output, `${id}.report.json`),
        `${clean(JSON.stringify(report, null, 2))}\n`,
      );
    return evidence;
  }
  const replace = async (file, before, after) => {
    const path = join(cwd, file);
    const source = await readFile(path, 'utf8');
    if (!source.includes(before)) throw new Error(`Missing mutation: ${file}`);
    await writeFile(path, source.replace(before, after));
  };
  try {
    await cp(fixture, cwd, { recursive: true });
    await mkdir(join(cwd, 'node_modules', '@rstest'), { recursive: true });
    await mkdir(join(cwd, 'node_modules', '@shop'), { recursive: true });
    await symlink(
      runner,
      join(cwd, 'node_modules', '@rstest', 'core'),
      'junction',
    );
    await symlink(
      join(cwd, 'packages', 'catalog'),
      join(cwd, 'node_modules', '@shop', 'catalog'),
      'junction',
    );
    const manifest = JSON.parse(await readFile(exampleManifest, 'utf8'));
    for (const importer of options.omitDeclarations ?? [])
      delete manifest.importers[importer];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(
      join(cwd, 'rstest.config.mjs'),
      join(cwd, 'shop.base.config.mjs'),
    );
    await writeFile(
      join(cwd, 'rstest.config.mjs'),
      [
        "import { defineConfig } from '@rstest/core';",
        "import base from './shop.base.config.mjs';",
        `import nativeAudit from ${JSON.stringify(pathToFileURL(join(root, 'audit-plugin.mjs')).href)};`,
        'export default defineConfig({',
        '  ...base,',
        '  plugins: [...(base.plugins ?? []), nativeAudit()],',
        ...(options.onlyCheckout
          ? ["  include: ['tests/checkout.test.ts'],"]
          : []),
        ...(options.concatenate
          ? [
              '  tools: { rspack: { optimization: { concatenateModules: true } } },',
            ]
          : []),
        '});',
        '',
      ].join('\n'),
    );
    await action({ cwd, invoke, replace });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function flatten(modules) {
  return modules.flatMap((module) => [module, ...flatten(module.inner)]);
}
const modules = (run) => run.audits.flatMap((audit) => flatten(audit.modules));
const forbiddenNative = (run) =>
  modules(run).filter((module) =>
    /^src\/(?:shipping\/(?:providers|legacy|manifests)|taxes\/regions|policies)\//.test(
      module.source ?? '',
    ),
  );
const assets = (run) => run.audits.map((audit) => audit.assets);
const compilationSources = (run) =>
  run.audits.map((audit) =>
    audit.modules.map(({ source, sourceSha256 }) => ({ source, sourceSha256 })),
  );
const rejectsComputed = (run) =>
  run.exit === 1 &&
  run.files.length === 0 &&
  /Native dependency selection is incomplete/.test(run.stderr + run.stdout) &&
  /unproven runtime path domain|parent traversal/.test(run.stderr + run.stdout);

try {
  await scenario('native-producer-and-runtime', {}, async ({ invoke }) => {
    const declared = await invoke('native-declared-full', ['run']);
    const undeclared = await invoke('native-undeclared-full', ['run'], false);
    const expectedCalls = {
      'src/shipping/checkout.mjs': [
        {
          kind: 'import',
          origin: 'source',
          parts: ['./providers/', null, '.mjs'],
        },
      ],
      'tests/legacy-shipping.test.ts': [
        {
          kind: 'require',
          origin: 'entry',
          parts: ['../src/shipping/legacy/', null, '.cjs'],
        },
      ],
      'tests/provider-location.test.ts': [
        {
          kind: 'resolve',
          origin: 'source',
          parts: ['../src/shipping/manifests/', null, '.cjs'],
        },
      ],
      'src/taxes/quote.mjs': [
        {
          kind: 'import',
          origin: 'source',
          parts: ['./regions/', null, '.mjs'],
        },
      ],
    };
    const observed = Object.fromEntries(
      Object.keys(expectedCalls).map((source) => [
        source,
        modules(undeclared).find((module) => module.source === source)?.native,
      ]),
    );
    const descriptorsCorrect = Object.entries(expectedCalls).every(
      ([source, calls]) => same(observed[source], { version: 1, calls }),
    );
    record(
      'actual-native-version-one-call-descriptors',
      declared.exit === 0 &&
        undeclared.exit === 0 &&
        same(declared.files, allTests) &&
        same(undeclared.files, allTests) &&
        descriptorsCorrect &&
        modules(undeclared).every((module) => module.declaration === null),
      {
        observed,
        expectedCalls,
        loadedNativeBindings: undeclared.audits.flatMap(
          (audit) => audit.loadedNativeBindings,
        ),
        declaredSummary: declared.summary,
        undeclaredSummary: undeclared.summary,
      },
      'Read-only audit; no JavaScript plugin writes rstestRuntimeDependencies.',
    );
    record(
      'native-producer-runtime-emission-unchanged-by-declarations',
      same(assets(declared), assets(undeclared)) &&
        same(compilationSources(declared), compilationSources(undeclared)) &&
        forbiddenNative(declared).length === 0 &&
        forbiddenNative(undeclared).length === 0,
      {
        declaredAssets: assets(declared),
        undeclaredAssets: assets(undeclared),
        unexpectedNativeModules: forbiddenNative(declared),
      },
      'Native metadata producer is active in both full runs, using the same fixture cwd.',
    );
    const rejected = await invoke(
      'undeclared-computed-selection',
      [
        'run',
        '--related',
        'src/shipping/providers/standard.mjs',
        '--passWithNoTests',
      ],
      false,
    );
    record(
      'undeclared-computed-selection-rejects-before-tests',
      rejectsComputed(rejected),
      rejected,
    );
  });

  await scenario(
    'parent-traversal',
    { onlyCheckout: true },
    async ({ cwd, invoke, replace }) => {
      await mkdir(join(cwd, 'src/shipping/overflow'), { recursive: true });
      await writeFile(
        join(cwd, 'src/shipping/overflow/standard.mjs'),
        'export const quote = () => 700;\n',
      );
      await replace(
        'tests/checkout.test.ts',
        "'standard'",
        "'../overflow/standard'",
      ).catch(async (error) => {
        if (!error.message.startsWith('Missing mutation:')) throw error;
        await replace(
          'tests/checkout.test.ts',
          '"standard"',
          '"../overflow/standard"',
        );
      });
      await replace('tests/checkout.test.ts', '2900', '3100');
      const passing = await invoke('traversal-full-passes', ['run'], false);
      record(
        'real-parent-traversal-loads-outside-pattern-directory',
        passing.exit === 0 &&
          same(passing.files, ['tests/checkout.test.ts']) &&
          passing.summary?.passedTests === 1,
        passing,
      );
      await replace('src/shipping/overflow/standard.mjs', '700', '900');
      const failing = await invoke(
        'traversal-full-detects-breakage',
        ['run'],
        false,
      );
      record(
        'outside-pattern-target-really-affects-checkout',
        failing.exit === 1 &&
          same(failing.failedFiles, ['tests/checkout.test.ts']) &&
          failing.summary?.failedTests === 1,
        failing,
      );
      const rejected = await invoke(
        'traversal-related-rejects',
        [
          'run',
          '--related',
          'src/shipping/overflow/standard.mjs',
          '--passWithNoTests',
        ],
        false,
      );
      record(
        'traversal-selection-rejects-instead-of-empty-success',
        rejectsComputed(rejected),
        rejected,
      );
    },
  );

  await scenario(
    'literal-resolve',
    { omitDeclarations: ['tests/provider-location.test.ts'] },
    async ({ invoke, replace }) => {
      await replace(
        'tests/provider-location.test.ts',
        '`../src/shipping/manifests/${method}.cjs`',
        "'../src/shipping/manifests/standard.cjs'",
      );
      const listed = await invoke('literal-resolve-list', [
        'list',
        '--filesOnly',
        '--related',
        'src/shipping/manifests/standard.cjs',
      ]);
      const location = modules(listed).find(
        (module) => module.source === 'tests/provider-location.test.ts',
      );
      record(
        'literal-resolve-selects-from-native-descriptor-without-declaration',
        listed.exit === 0 &&
          same(listed.files, ['tests/provider-location.test.ts']) &&
          location?.declaration === null &&
          same(location?.native, {
            version: 1,
            calls: [
              {
                kind: 'resolve',
                origin: 'source',
                parts: ['../src/shipping/manifests/standard.cjs'],
              },
            ],
          }) &&
          forbiddenNative(listed).length === 0,
        {
          selection: listed.files,
          descriptor: location?.native,
          declaration: location?.declaration,
          unexpectedNativeModules: forbiddenNative(listed),
        },
      );
      const executed = await invoke('literal-resolve-run', [
        'run',
        '--related',
        'src/shipping/manifests/standard.cjs',
      ]);
      record(
        'literal-resolve-invalid-target-is-not-parsed-or-executed',
        executed.exit === 0 &&
          same(executed.files, ['tests/provider-location.test.ts']) &&
          executed.summary?.passedTests === 1 &&
          forbiddenNative(executed).length === 0,
        executed,
      );
      const unrelated = await invoke('literal-resolve-unrelated-docs', [
        'list',
        '--filesOnly',
        '--related',
        'README.md',
      ]);
      record(
        'literal-resolve-has-no-unrelated-fallback',
        unrelated.exit === 0 && unrelated.files.length === 0,
        unrelated,
      );
    },
  );

  await scenario(
    'concatenation',
    { onlyCheckout: true, concatenate: true },
    async ({ invoke }) => {
      const declared = await invoke('concatenated-declared-full', ['run']);
      const undeclared = await invoke(
        'concatenated-undeclared-full',
        ['run'],
        false,
      );
      const markedInner = declared.audits.flatMap((audit) =>
        audit.modules.flatMap((module) =>
          flatten(module.inner).filter(
            (inner) =>
              inner.source === 'src/shipping/checkout.mjs' &&
              inner.declaration?.complete &&
              inner.native?.version === 1,
          ),
        ),
      );
      record(
        'concatenation-retains-native-descriptor-and-explicit-closure',
        declared.exit === 0 &&
          same(declared.files, ['tests/checkout.test.ts']) &&
          markedInner.length > 0 &&
          declared.audits.some((audit) => audit.concatenateModules === true) &&
          forbiddenNative(declared).length === 0,
        { markedInner, summary: declared.summary },
      );
      const selected = await invoke('concatenated-native-helper-list', [
        'list',
        '--filesOnly',
        '--related',
        'src/policies/shipping.mjs',
      ]);
      record(
        'concatenated-declaration-selects-exact-owner',
        selected.exit === 0 && same(selected.files, ['tests/checkout.test.ts']),
        selected,
      );
      const unrelated = await invoke('concatenated-unrelated-docs', [
        'list',
        '--filesOnly',
        '--related',
        'README.md',
      ]);
      record(
        'concatenated-declaration-has-no-unrelated-fallback',
        unrelated.exit === 0 && unrelated.files.length === 0,
        unrelated,
      );
      record(
        'concatenated-runtime-assets-unchanged-by-declarations',
        undeclared.exit === 0 &&
          same(undeclared.files, ['tests/checkout.test.ts']) &&
          same(assets(declared), assets(undeclared)),
        { declared: assets(declared), undeclared: assets(undeclared) },
      );
    },
  );
} finally {
  const nativeBindings = [];
  for (const path of loadedBindings) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    nativeBindings.push({ path, sha256: hash.digest('hex') });
  }
  const source = spawnSync('git', ['-C', runner, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  const status = spawnSync('git', ['-C', runner, 'status', '--short'], {
    encoding: 'utf8',
  });
  const diff = spawnSync('git', ['-C', runner, 'diff'], {
    encoding: 'utf8',
    maxBuffer: 15 * 1024 * 1024,
  });
  const provenance = {
    nodeVersion: process.version,
    cli,
    sourceSha: source.stdout.trim(),
    sourceStatus: status.stdout.trim(),
    sourceDiffSha256: createHash('sha256').update(diff.stdout).digest('hex'),
    nativeBindings,
    auditPluginSha256: createHash('sha256')
      .update(await readFile(join(root, 'audit-plugin.mjs')))
      .digest('hex'),
    declarationPluginSha256: createHash('sha256')
      .update(await readFile(markerPlugin))
      .digest('hex'),
  };
  const failed = results.filter((result) => !result.passed);
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify({ provenance, method: 'Actual native producer plus precise consumer; read-only audits and optional explicit declarations.', results }, null, 2)}\n`,
  );
  await writeFile(
    join(output, 'REPORT.md'),
    [
      '# Actual native integration validation',
      '',
      `${results.length - failed.length} checks passed; ${failed.length} checks failed. Node ${process.version}.`,
      '',
      'Actual loaded native binaries and hashes are recorded in results.json. The audit does not fabricate metadata.',
      '',
      '| Check | Result | Note |',
      '| --- | --- | --- |',
      ...results.map(
        ({ id, passed, note }) =>
          `| ${id} | ${passed ? 'PASS' : 'FAIL'} | ${note ?? ''} |`,
      ),
      '',
      'Computed requests require explicit complete closures in this tested contract. Literal resolve is handled without a declaration. These are correctness checks, not performance measurements.',
      '',
    ].join('\n'),
  );
  console.log(
    `${results.length - failed.length} passed; ${failed.length} failed.`,
  );
  console.log(`Evidence: ${join(output, 'results.json')}`);
  if (failed.length) process.exitCode = 1;
}
