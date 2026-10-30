import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    cli: { type: 'string' },
    binding: { type: 'string' },
    output: { type: 'string' },
    label: { type: 'string', default: 'gap-regressions' },
    scenarios: { type: 'string', default: 'create-require,cjs-var,hooks' },
  },
});
if (!values.cli || !values.binding || !values.output)
  throw new Error('Pass --cli, --binding, and a new --output directory.');
const cli = await realpath(resolve(values.cli));
const runner = dirname(dirname(cli));
const binding = await realpath(resolve(values.binding));
const output = resolve(values.output);
await mkdir(output); // Evidence must never be overwritten.
const selectedScenarios = new Set(values.scenarios.split(','));
const marker = resolve(root, '../declarations/native-marker-plugin.mjs');
const auditPlugin = resolve(root, '../native-validation/audit-plugin.mjs');
const tests = ['tests/price.test.ts', 'tests/unrelated.test.ts'];
const targetTest = [tests[0]];
const checks = [];
const runs = [];
const hash = (data) => createHash('sha256').update(data).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function fingerprint(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(mjs|cjs|js)$/.test(file))
        files.push([relative(directory, file), hash(await readFile(file))]);
    }
  }
  await visit(directory);
  return { count: files.length, sha256: hash(JSON.stringify(files)) };
}
const provenance = {
  node: process.version,
  cli,
  binding,
  nativeSha256: hash(await readFile(binding)),
  compiled: await fingerprint(join(runner, 'dist')),
  harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  supportFiles: await Promise.all(
    [
      marker,
      auditPlugin,
      resolve(root, '../declarations/plugin.mjs'),
      resolve(root, '../declarations/native-dependencies-loader.mjs'),
    ].map(async (file) => ({ file, sha256: hash(await readFile(file)) })),
  ),
};
function check(id, passed, evidence) {
  checks.push({ id, passed, evidence });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}`);
}
const selected = (run, files = targetTest) =>
  run.exit === 0 &&
  equal(run.files, files) &&
  !/Build error:|Failed to (?:build|compile)/i.test(run.stdout + run.stderr);
const incomplete = (run) =>
  run.exit !== 0 &&
  run.files.length === 0 &&
  /Native dependency selection is incomplete/.test(run.stdout + run.stderr);
const runtimePass = (run) =>
  run.exit === 0 &&
  equal(run.files, tests) &&
  run.summary?.passedTests === 2 &&
  run.summary?.failedTests === 0;
const mutationFailure = (run, all = true) =>
  run.exit === 1 &&
  equal(run.files, all ? tests : targetTest) &&
  equal(run.failedFiles, targetTest) &&
  run.summary?.failedTests === 1;

async function fixture(name, kind) {
  const cwd = join(output, name);
  for (const dir of [
    'tests',
    'src',
    'native',
    'node_modules/@rstest',
    'evidence',
  ])
    await mkdir(join(cwd, dir), { recursive: true });
  await symlink(runner, join(cwd, 'node_modules/@rstest/core'), 'junction');
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify(
      { name: `native-selection-${name}`, private: true, type: 'module' },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(cwd, tests[1]),
    `import { expect, test } from '@rstest/core';\ntest('unrelated inventory count', () => expect(3 + 4).toBe(7));\n`,
  );
  await writeFile(join(cwd, 'native/helper.cjs'), 'module.exports = 42;\n');
  await writeFile(
    join(cwd, 'native/provider.cjs'),
    `${kind === 'cjs-var' ? 'var require;\n' : ''}module.exports = require('./helper.cjs');\n`,
  );
  await writeFile(
    join(cwd, 'noop-loader.mjs'),
    "import { appendFileSync } from 'node:fs';\nif (process.env.GAP_LOADER_TRACE) appendFileSync(process.env.GAP_LOADER_TRACE, 'loaded\\n');\nexport function resolve(specifier, context, nextResolve) { return nextResolve(specifier, context); }\n",
  );
  if (kind === 'create-require') {
    await writeFile(
      join(cwd, 'src/native-reader.ts'),
      `import { createRequire } from 'node:module';\nconst nativeRequire = createRequire(import.meta.url);\nexport function price() { return nativeRequire('../native/provider.cjs'); }\n`,
    );
    await writeFile(
      join(cwd, tests[0]),
      `import { expect, test } from '@rstest/core';\nimport { price } from '../src/native-reader';\ntest('uses the native price provider', () => expect(price()).toBe(42));\n`,
    );
  } else {
    await writeFile(
      join(cwd, tests[0]),
      `import { expect, test } from '@rstest/core';\ntest('uses the native price provider', () => expect(require('../native/provider.cjs')).toBe(42));\n`,
    );
  }
  const importer =
    kind === 'create-require' ? 'src/native-reader.ts' : tests[0];
  await writeFile(
    join(cwd, 'native-dependencies.json'),
    JSON.stringify(
      {
        version: 1,
        importers: { [importer]: ['native/provider.cjs', 'native/helper.cjs'] },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(cwd, 'rstest.config.mjs'),
    [
      "import { defineConfig } from '@rstest/core';",
      `import declarations from ${JSON.stringify(pathToFileURL(marker).href)};`,
      `import audit from ${JSON.stringify(pathToFileURL(auditPlugin).href)};`,
      'export default defineConfig({',
      " include: ['tests/**/*.test.ts'],",
      " plugins: [...(process.env.GAP_DECLARATIONS === '1' ? [declarations({manifestPath:'native-dependencies.json'})] : []), audit()],",
      " pool: { type: 'forks', maxWorkers: 2, execArgv: JSON.parse(process.env.GAP_POOL_ARGS || '[]') },",
      " reporters: [['json', {outputPath:process.env.DESIGN_REPORT}]],",
      ...(kind === 'create-require'
        ? []
        : [
            " tools: {rspack: {module: {rules: [{test:/price\\.test\\.ts$/, type:'javascript/esm'}]}}},",
          ]),
      '});',
      '',
    ].join('\n'),
  );
  async function run(
    id,
    args,
    { declarations = false, poolArgs = [], nodeOptions } = {},
  ) {
    const evidenceDir = join(cwd, 'evidence', id);
    await mkdir(evidenceDir);
    const reportPath = join(evidenceDir, 'report.json');
    const auditPath = join(evidenceDir, 'audit');
    const loaderTracePath = join(evidenceDir, 'loader-trace.log');
    const env = {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      RSTEST_NO_AGENT: '1',
      NAPI_RS_NATIVE_LIBRARY_PATH: binding,
      DESIGN_REPORT: reportPath,
      NATIVE_AUDIT_DIR: auditPath,
      GAP_DECLARATIONS: declarations ? '1' : '0',
      GAP_POOL_ARGS: JSON.stringify(poolArgs),
      GAP_LOADER_TRACE: loaderTracePath,
    };
    for (const key of [
      'NODE_OPTIONS',
      'DESIGN_PLUGIN_PATH',
      'DECLARED_NATIVE_MANIFEST',
      'DESIGN_METADATA_MODE',
    ])
      delete env[key];
    if (nodeOptions) env.NODE_OPTIONS = nodeOptions;
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
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
          .map((x) => x.trim().replaceAll('\\', '/'))
          .filter((x) => /^tests\/.*\.test\.ts$/.test(x))
          .sort()
      : (report?.files.map((x) => x.testPath.replaceAll('\\', '/')).sort() ??
        []);
    const audits = [];
    try {
      for (const file of (await readdir(auditPath)).sort())
        audits.push(JSON.parse(await readFile(join(auditPath, file), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let loaderTrace = '';
    try {
      loaderTrace = await readFile(loaderTracePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const run = {
      id: `${name}/${id}`,
      args,
      declarations,
      poolArgs,
      nodeOptions,
      exit: result.status,
      files,
      summary: report?.summary,
      failedFiles:
        report?.files
          .filter((x) => x.status === 'fail')
          .map((x) => x.testPath)
          .sort() ?? [],
      loaderTrace,
      stdout: result.stdout,
      stderr: result.stderr,
      audits,
    };
    runs.push(run);
    await writeFile(
      join(evidenceDir, 'result.json'),
      JSON.stringify(run, null, 2) + '\n',
    );
    return run;
  }
  return {
    cwd,
    run,
    mutate: async () =>
      writeFile(join(cwd, 'native/helper.cjs'), 'module.exports = 99;\n'),
  };
}

try {
  if (selectedScenarios.has('create-require')) {
    const f = await fixture('create-require', 'create-require');
    check(
      'create-require/full-runtime-before',
      runtimePass(await f.run('full-before', ['run'])),
    );
    const automatic = await f.run('automatic-related', [
      'list',
      '--filesOnly',
      '--related',
      'native/helper.cjs',
    ]);
    check(
      'create-require/default-unsupported-rejects',
      incomplete(automatic),
      automatic.id,
    );
    check(
      'create-require/complete-declaration-exact',
      selected(
        await f.run(
          'declared-related',
          ['list', '--filesOnly', '--related', 'native/helper.cjs'],
          { declarations: true },
        ),
      ),
    );
    check(
      'create-require/declared-unrelated-empty',
      selected(
        await f.run(
          'declared-unrelated',
          ['list', '--filesOnly', '--related', 'README.md'],
          { declarations: true },
        ),
        [],
      ),
    );
    await f.mutate();
    check(
      'create-require/mutation-full-detects',
      mutationFailure(await f.run('full-mutated', ['run'])),
    );
    check(
      'create-require/mutation-automatic-rejects',
      incomplete(
        await f.run('automatic-run-mutated', [
          'run',
          '--related',
          'native/helper.cjs',
        ]),
      ),
    );
    check(
      'create-require/mutation-declared-exact-failure',
      mutationFailure(
        await f.run(
          'declared-run-mutated',
          ['run', '--related', 'native/helper.cjs'],
          { declarations: true },
        ),
        false,
      ),
    );
  }
  if (selectedScenarios.has('cjs-var')) {
    const f = await fixture('cjs-var', 'cjs-var');
    check(
      'cjs-var/full-runtime-before',
      runtimePass(await f.run('full-before', ['run'])),
    );
    check(
      'cjs-var/automatic-exact',
      selected(
        await f.run('automatic-related', [
          'list',
          '--filesOnly',
          '--related',
          'native/helper.cjs',
        ]),
      ),
    );
    await writeFile(
      join(f.cwd, 'native/provider.cjs'),
      "module.exports = require('./helper.cjs');\n",
    );
    check(
      'cjs-var/no-redeclaration-control',
      selected(
        await f.run('without-redeclaration', [
          'list',
          '--filesOnly',
          '--related',
          'native/helper.cjs',
        ]),
      ),
    );
    await writeFile(
      join(f.cwd, 'native/provider.cjs'),
      "var require;\nmodule.exports = require('./helper.cjs');\n",
    );
    check(
      'cjs-var/complete-declaration-exact',
      selected(
        await f.run(
          'declared-related',
          ['list', '--filesOnly', '--related', 'native/helper.cjs'],
          { declarations: true },
        ),
      ),
    );
    check(
      'cjs-var/unrelated-empty',
      selected(
        await f.run('automatic-unrelated', [
          'list',
          '--filesOnly',
          '--related',
          'README.md',
        ]),
        [],
      ),
    );
    await f.mutate();
    check(
      'cjs-var/mutation-full-detects',
      mutationFailure(await f.run('full-mutated', ['run'])),
    );
    check(
      'cjs-var/mutation-automatic-exact-failure',
      mutationFailure(
        await f.run('automatic-run-mutated', [
          'run',
          '--related',
          'native/helper.cjs',
        ]),
        false,
      ),
    );
    check(
      'cjs-var/mutation-declared-exact-failure',
      mutationFailure(
        await f.run(
          'declared-run-mutated',
          ['run', '--related', 'native/helper.cjs'],
          { declarations: true },
        ),
        false,
      ),
    );
  }
  if (selectedScenarios.has('hooks')) {
    const f = await fixture('hooks', 'literal');
    const loader = join(f.cwd, 'noop-loader.mjs');
    const envFile = join(f.cwd, 'node-hooks.env');
    await writeFile(envFile, `NODE_OPTIONS=--experimental-loader=${loader}\n`);
    const variants = [
      ['pool-hyphenated', { poolArgs: ['--experimental-loader', loader] }],
      ['pool-underscored', { poolArgs: ['--experimental_loader', loader] }],
      [
        'pool-underscored-equals',
        { poolArgs: [`--experimental_loader=${loader}`] },
      ],
      [
        'env-underscored-quoted',
        { nodeOptions: `"--experimental_loader=${loader}"` },
      ],
      ['pool-env-file', { poolArgs: ['--env-file', envFile] }],
    ];
    for (const [name, options] of variants) {
      const runtime = await f.run(`${name}-full`, ['run'], options);
      check(
        `hooks/${name}/runtime-accepted`,
        runtimePass(runtime) && runtime.loaderTrace.includes('loaded\n'),
      );
      const guarded = await f.run(
        `${name}-automatic`,
        ['list', '--filesOnly', '--related', 'native/helper.cjs'],
        options,
      );
      check(
        `hooks/${name}/rejects-custom-hooks`,
        incomplete(guarded) &&
          /custom Node loading hooks|external Node option files/.test(
            guarded.stdout + guarded.stderr,
          ),
      );
      check(
        `hooks/${name}/declared-exact`,
        selected(
          await f.run(
            `${name}-declared`,
            ['list', '--filesOnly', '--related', 'native/helper.cjs'],
            { ...options, declarations: true },
          ),
        ),
      );
    }
    await f.mutate();
    check(
      'hooks/mutation-full-detects',
      mutationFailure(await f.run('mutated-full', ['run'], variants[1][1])),
    );
    check(
      'hooks/mutation-declared-exact-failure',
      mutationFailure(
        await f.run(
          'mutated-declared',
          ['run', '--related', 'native/helper.cjs'],
          { ...variants[1][1], declarations: true },
        ),
        false,
      ),
    );
  }
} finally {
  const after = {
    compiled: await fingerprint(join(runner, 'dist')),
    nativeSha256: hash(await readFile(binding)),
  };
  check(
    'artifacts-unchanged',
    equal(after.compiled, provenance.compiled) &&
      after.nativeSha256 === provenance.nativeSha256,
    after,
  );
  const audited = runs.filter((run) => run.audits.length);
  check(
    'audits-loaded-requested-native-binding',
    audited.length > 0 &&
      (
        await Promise.all(
          audited.map(async (run) =>
            (
              await Promise.all(
                run.audits
                  .flatMap((a) => a.loadedNativeBindings)
                  .map((path) => realpath(path)),
              )
            ).includes(binding),
          ),
        )
      ).every(Boolean),
  );
  const result = {
    label: values.label,
    provenance,
    method:
      'Exact sets and real mutation failures; default createRequire must fail explicitly unless complete dependencies are declared; CJS wrapper var require must retain its dependency; supported Node hook spellings must be rejected by automatic analysis.',
    checks,
    runs,
  };
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  await writeFile(
    join(output, 'REPORT.md'),
    [
      `# Native selection gap regressions: ${values.label}`,
      '',
      `${checks.filter((x) => x.passed).length} passed; ${checks.filter((x) => !x.passed).length} failed. Node ${process.version}.`,
      '',
      '| Check | Result |',
      '| --- | --- |',
      ...checks.map((x) => `| ${x.id} | ${x.passed ? 'PASS' : 'FAIL'} |`),
      '',
      'Every selected file set is exact; an unrelated test must remain excluded. Full-suite mutations establish the dependency affects runtime. Original reproductions and previous outputs are retained.',
      '',
    ].join('\n'),
  );
}
process.exitCode = checks.some((x) => !x.passed) ? 1 : 0;
