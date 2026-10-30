import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: 'string', default: 'strict-selection' },
    output: {
      type: 'string',
      default: join(root, 'results', 'strict-selection'),
    },
  },
});
if (!positionals[0])
  throw new Error('Pass an explicit path to packages/core/bin/rstest.js.');
const cli = await realpath(resolve(positionals[0]));
const runner = dirname(dirname(cli));
const runnerRepository = resolve(runner, '../..');
const fixture = join(root, 'fixture');
const output = resolve(values.output);
const allTests = (await readdir(join(fixture, 'tests')))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`)
  .sort();
const results = [];
const checkoutTest = 'tests/checkout.test.ts';
const legacyTest = 'tests/legacy-shipping.test.ts';
const locationTest = 'tests/provider-location.test.ts';
const taxTest = 'tests/regional-tax.test.ts';
await mkdir(output, { recursive: true });

function command(executable, args, cwd, extraEnv = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      RSTEST_NO_AGENT: '1',
      ...extraEnv,
    },
  });
  if (result.error) throw result.error;
  return result;
}

async function scenario(name, action) {
  const cwd = await mkdtemp(join(root, '.work-'));
  const reportFile = join(cwd, '.evidence', 'report.json');
  const clean = (text) =>
    text.replaceAll(cwd, '<shop>').replaceAll(runner, '<rstest>');
  const git = (...args) => {
    const result = command(
      'git',
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=disabled-hooks',
        ...args,
      ],
      cwd,
    );
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  };
  const check = async (id, kind, args, expected, executable = cli) => {
    if (executable === cli && !Array.isArray(expected.files)) {
      throw new Error(
        `Exact expected files are mandatory for every CLI check: ${id}`,
      );
    }
    await rm(reportFile, { force: true });
    const runArgs = executable === cli ? [cli, ...args] : args;
    const result = command(process.execPath, runArgs, cwd, {
      DESIGN_REPORT: reportFile,
    });
    let files;
    let report;
    if (args.includes('--filesOnly')) {
      files = result.stdout
        .split('\n')
        .map((line) => line.trim().replaceAll('\\', '/'))
        .filter((line) => /^tests\/.*\.test\.ts$/.test(line))
        .sort();
    } else if (executable === cli && args[0] === 'run') {
      try {
        report = JSON.parse(await readFile(reportFile, 'utf8'));
        files = report.files
          .map((file) => file.testPath.replaceAll('\\', '/'))
          .sort();
        await writeFile(
          join(output, `${id}.report.json`),
          `${clean(JSON.stringify(report, null, 2))}\n`,
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        files = [];
      }
    }
    const failedFiles = report?.files
      .filter((file) => file.status === 'fail')
      .map((file) => file.testPath.replaceAll('\\', '/'))
      .sort();
    const passed =
      result.status === expected.exit &&
      (expected.files === undefined ||
        JSON.stringify(files) === JSON.stringify(expected.files.toSorted())) &&
      (expected.failedFiles === undefined ||
        JSON.stringify(failedFiles) ===
          JSON.stringify(expected.failedFiles.toSorted()));
    const log = `${id}.log`;
    await writeFile(
      join(output, log),
      [
        `scenario: ${name}`,
        `${executable === cli ? 'rstest' : 'node'} ${args.join(' ')}`,
        `exit: ${result.status}`,
        clean(result.stdout),
        clean(result.stderr),
      ].join('\n'),
    );
    results.push({
      id,
      scenario: name,
      kind,
      command: [executable === cli ? 'rstest' : 'node', ...args],
      expected,
      actual: {
        exit: result.status,
        files,
        failedFiles,
        summary: report?.summary,
      },
      missingFiles: expected.files?.filter((file) => !files?.includes(file)),
      unexpectedFiles: files?.filter((file) => !expected.files.includes(file)),
      passed,
      log,
    });
    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${id}: exit ${result.status}${files ? `; ${files.join(', ') || 'no tests'}` : ''}`,
    );
    return passed;
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
    await writeFile(
      join(cwd, '.gitignore'),
      'node_modules/\n.evidence/\n.rstest-temp/\n.rstest/\n',
    );
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Shipping example');
    git('config', 'user.email', 'shipping@example.com');
    git('add', '.');
    git('commit', '-qm', 'Add shipping selection fixture');
    await action({
      check,
      replace: async (file, before, after) => {
        const path = join(cwd, file);
        const source = await readFile(path, 'utf8');
        if (!source.includes(before))
          throw new Error(`Missing mutation target: ${file}`);
        await writeFile(path, source.replace(before, after));
      },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const related = (file) => ['list', '--filesOnly', '--related', file];
const affected = (test, exit = 0) => ({
  exit,
  files: [test],
});

try {
  await scenario('native-semantics', async ({ check }) => {
    await check(
      'native-runtime-reference',
      'control',
      ['scripts/native-runtime-control.mjs'],
      { exit: 0 },
      'node',
    );
    for (const [id, path] of [
      ['unused-esm', 'src/shipping/providers/experimental.mjs'],
      ['unused-commonjs', 'src/shipping/legacy/experimental.cjs'],
      ['resolved-manifest', 'src/shipping/manifests/standard.cjs'],
    ]) {
      await check(
        `${id}-is-invalid-javascript`,
        'control',
        ['--check', path],
        { exit: 1 },
        'node',
      );
    }
    const fullPass = await check(
      'full-run-preserves-native-semantics',
      'control',
      ['run'],
      { exit: 0, files: allTests, failedFiles: [] },
    );
    if (!fullPass)
      throw new Error(
        'The unchanged full application must pass before selection evidence can be interpreted.',
      );

    for (const [id, path, test] of [
      [
        'computed-import-provider',
        'src/shipping/providers/standard.mjs',
        checkoutTest,
      ],
      [
        'computed-import-transitive-helper',
        'src/policies/shipping.mjs',
        checkoutTest,
      ],
      [
        'computed-require-provider',
        'src/shipping/legacy/standard.cjs',
        legacyTest,
      ],
      [
        'computed-require-transitive-helper',
        'src/policies/legacy-shipping.cjs',
        legacyTest,
      ],
      [
        'computed-resolve-invalid-target',
        'src/shipping/manifests/standard.cjs',
        locationTest,
      ],
      ['second-provider-group', 'src/taxes/regions/domestic.mjs', taxTest],
      ['second-provider-transitive-helper', 'src/policies/tax.mjs', taxTest],
    ]) {
      await check(id, 'regression', related(path), affected(test));
    }
    await check(
      'related-import-does-not-parse-unused-candidate',
      'regression',
      [
        'run',
        '--related',
        'src/shipping/providers/standard.mjs',
        '--passWithNoTests',
      ],
      affected(checkoutTest),
    );
    await check(
      'related-resolve-does-not-parse-target',
      'regression',
      [
        'run',
        '--related',
        'src/shipping/manifests/standard.cjs',
        '--passWithNoTests',
      ],
      affected(locationTest),
    );
    await check(
      'related-tax-provider-excludes-shipping',
      'regression',
      [
        'run',
        '--related',
        'src/taxes/regions/domestic.mjs',
        '--passWithNoTests',
      ],
      affected(taxTest),
    );
    await check(
      'unrelated-static-source',
      'control',
      related('src/stock.mjs'),
      {
        exit: 0,
        files: ['tests/stock.test.ts'],
      },
    );
    await check(
      'source-alias-selects-source',
      'control',
      related('packages/catalog/src/price.mjs'),
      {
        exit: 0,
        files: ['tests/catalog.test.ts'],
      },
    );
    await check(
      'source-alias-ignores-compiled-output',
      'control',
      related('packages/catalog/dist/price.mjs'),
      {
        exit: 0,
        files: [],
      },
    );
    for (const [id, path] of [
      ['documentation-related-selects-none', 'README.md'],
      ['wrong-extension-selects-none', 'src/shipping/providers/standard.txt'],
      [
        'sibling-directory-selects-none',
        'src/shipping/providers-extra/standard.mjs',
      ],
    ]) {
      await check(id, 'control', related(path), { exit: 0, files: [] });
    }
    await check(
      'empty-changed-selects-none',
      'control',
      ['list', '--filesOnly', '--changed'],
      { exit: 0, files: [] },
    );
    await check(
      'two-provider-groups-union-excludes-other-tests',
      'regression',
      [
        'list',
        '--filesOnly',
        '--related',
        'src/shipping/providers/standard.mjs',
        'src/taxes/regions/domestic.mjs',
      ],
      { exit: 0, files: [checkoutTest, taxTest] },
    );
  });

  for (const [name, file, before, after, test] of [
    [
      'esm-transitive-policy',
      'src/policies/shipping.mjs',
      'standardShippingFee = 500',
      'standardShippingFee = 800',
      checkoutTest,
    ],
    [
      'commonjs-transitive-policy',
      'src/policies/legacy-shipping.cjs',
      'standardShippingFee = 500',
      'standardShippingFee = 800',
      legacyTest,
    ],
    [
      'tax-transitive-policy',
      'src/policies/tax.mjs',
      'taxBasisPoints = 1000',
      'taxBasisPoints = 1500',
      taxTest,
    ],
  ]) {
    await scenario(name, async ({ check, replace }) => {
      await replace(file, before, after);
      await check(`${name}-full-run-detects-breakage`, 'control', ['run'], {
        exit: 1,
        files: allTests,
        failedFiles: [test],
      });
      await check(
        `${name}-changed-run-detects-breakage`,
        'regression',
        ['run', '--changed', '--passWithNoTests'],
        { ...affected(test, 1), failedFiles: [test] },
      );
    });
  }

  await scenario('source-alias-mutation', async ({ check, replace }) => {
    await replace(
      'packages/catalog/src/price.mjs',
      'coffeePrice = 1200',
      'coffeePrice = 1300',
    );
    await check(
      'source-alias-executes-changed-source',
      'control',
      ['run', '--changed', '--passWithNoTests'],
      {
        exit: 1,
        files: ['tests/catalog.test.ts'],
        failedFiles: ['tests/catalog.test.ts'],
      },
    );
  });
  for (const [name, file, before, after] of [
    [
      'documentation',
      'README.md',
      'independent consumers',
      'independent application consumers',
    ],
    [
      'wrong-extension',
      'src/shipping/providers/standard.txt',
      'Standard delivery',
      'Updated standard delivery',
    ],
    [
      'sibling-directory',
      'src/shipping/providers-extra/standard.mjs',
      '999',
      '888',
    ],
  ]) {
    await scenario(`${name}-mutation`, async ({ check, replace }) => {
      await replace(file, before, after);
      await check(
        `${name}-changed-selects-none`,
        'control',
        ['list', '--filesOnly', '--changed'],
        { exit: 0, files: [] },
      );
    });
  }
} finally {
  const packageInfo = JSON.parse(
    await readFile(join(runner, 'package.json'), 'utf8'),
  );
  const gitInfo = command('git', ['rev-parse', 'HEAD'], runnerRepository);
  const gitStatus = command('git', ['status', '--short'], runnerRepository);
  const gitDiff = command(
    'git',
    ['diff', '--', 'packages/core/src/core/execution/related.ts'],
    runnerRepository,
  );
  const report = {
    label: values.label,
    runnerVersion: packageInfo.version,
    runnerSourceSha: gitInfo.status === 0 ? gitInfo.stdout.trim() : undefined,
    runnerWorkingTreeStatus:
      gitStatus.status === 0 ? gitStatus.stdout.trim() : undefined,
    nodeVersion: process.version,
    selectionContract:
      'Every CLI check requires an exact expected test-file set; both missing and extra files fail.',
    metadataMode: process.env.DESIGN_METADATA_MODE ?? 'producer default',
    producer: process.env.DESIGN_PLUGIN_PATH
      ? 'Explicit native input declarations. Native producer behavior is verified separately by the native integration audit.'
      : 'none',
    consumerDiffSha256: createHash('sha256')
      .update(gitDiff.stdout)
      .digest('hex'),
    producerSha256: process.env.DESIGN_PLUGIN_PATH
      ? createHash('sha256')
          .update(await readFile(process.env.DESIGN_PLUGIN_PATH))
          .digest('hex')
      : null,
    designPlugin: process.env.DESIGN_PLUGIN_PATH
      ? resolve(process.env.DESIGN_PLUGIN_PATH)
      : null,
    results,
  };
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const failed = results.filter((result) => !result.passed);
  const table = results
    .map(
      ({ id, kind, expected, actual, passed }) =>
        `| ${id} | ${kind} | ${actual.exit} | ${expected.files?.join(', ') || '—'} | ${actual.files?.join(', ') || '—'} | ${passed ? 'PASS' : 'FAIL'} |`,
    )
    .join('\n');
  await writeFile(
    join(output, 'REPORT.md'),
    [
      `# Strict shipping and regional-tax selection: ${values.label}`,
      '',
      `Runner: Rstest ${packageInfo.version}, source ${report.runnerSourceSha}, Node ${process.version}.`,
      `Plugin: ${report.designPlugin ?? 'none'}.`,
      `Metadata mode: ${report.metadataMode}. ${report.producer}`,
      `${results.length - failed.length} checks passed; ${failed.length} checks failed.`,
      '',
      report.selectionContract,
      '',
      '| Check | Kind | Exit | Expected files | Actual files | Result |',
      '| --- | --- | --- | --- | --- | --- |',
      table,
      '',
      'Each check has a matching command log. Run checks also retain the JSON test report.',
      '',
    ].join('\n'),
  );
  console.log(`Evidence: ${join(output, 'results.json')}`);
  console.log(
    `${results.length - failed.length} checks passed; ${failed.length} checks failed.`,
  );
  if (failed.length > 0) process.exitCode = 1;
}
