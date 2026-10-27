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
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', default: 'test-results/reproduction' },
    group: { type: 'string' },
    label: { type: 'string', default: 'installed' },
  },
});
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = positionals[0]
  ? resolve(positionals[0])
  : join(
      dirname(require.resolve('@rstest/core/package.json')),
      'bin/rstest.js',
    );
const runner = dirname(dirname(cli));
const runnerPath = await realpath(runner);
const compiler = require.resolve('typescript/lib/tsc.js');
const output = resolve(values.output);
const results = [];
const testFiles = (await readdir(join(root, 'tests')))
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/${file}`)
  .sort();
const inventoryTests = [
  'tests/inventory.test.ts',
  'tests/literal-import.test.ts',
  'tests/reservations-mock.test.ts',
  'tests/reservations.test.ts',
];
const groups = [
  'controls',
  'computed-imports',
  'deleted-files',
  'loader-inputs',
  'analysis-errors',
  'compiled-mapping',
  'runtime-inputs',
  'diagnostics',
  'integration',
];
if (values.group && !groups.includes(values.group)) {
  throw new Error(
    `Unknown group ${values.group}. Choose: ${groups.join(', ')}`,
  );
}
await mkdir(output, { recursive: true });

function command(executable, args, cwd, env = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      CI: 'true',
      RSTEST_NO_AGENT: '1',
      NO_COLOR: '1',
      ...env,
    },
  });
  if (result.error) throw result.error;
  return result;
}

function buildCatalog(cwd) {
  const result = command(
    process.execPath,
    [compiler, '-p', 'packages/catalog/tsconfig.json'],
    cwd,
  );
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
}

buildCatalog(root);

async function scenario(group, mode, action) {
  if (values.group && values.group !== group) return;
  const cwd = await mkdtemp(join(tmpdir(), 'rstest-checkout-demo-'));
  const demoPath = await realpath(cwd);
  const reportFile = join(cwd, '.reproduction/report.json');
  const clean = (text) =>
    text
      .replaceAll(demoPath, '<demo>')
      .replaceAll(cwd, '<demo>')
      .replaceAll(runnerPath, '<rstest>')
      .replaceAll(runner, '<rstest>')
      .replaceAll(root, '<example>/')
      .replaceAll(homedir(), '<home>');
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
    return result.stdout.trim();
  };
  const write = async (file, content) => {
    await mkdir(dirname(join(cwd, file)), { recursive: true });
    await writeFile(join(cwd, file), content);
  };
  const replace = async (file, before, after) => {
    const text = await readFile(join(cwd, file), 'utf8');
    if (!text.includes(before))
      throw new Error(`Mutation did not match ${file}: ${before}`);
    await write(file, text.replace(before, after));
  };
  const check = async (id, kind, args, expected) => {
    await rm(reportFile, { force: true });
    const result = command(process.execPath, [cli, ...args], cwd, {
      CHECKOUT_DEMO_MODE: mode,
      CHECKOUT_DEMO_REPORT: reportFile,
      CHECKOUT_PAYMENT_PROVIDER: 'runtime/card.mjs',
    });
    let files;
    if (args.includes('--filesOnly')) {
      files = result.stdout
        .split('\n')
        .map((line) => line.trim().replaceAll('\\', '/'))
        .filter((line) => /^tests\/.*\.test\.ts$/.test(line))
        .sort();
    } else if (args[0] === 'run') {
      try {
        const report = JSON.parse(await readFile(reportFile, 'utf8'));
        await writeFile(
          join(output, `${id}.report.json`),
          `${clean(JSON.stringify(report, null, 2))}\n`,
        );
        files = report.files
          .map((file) => file.testPath.replaceAll('\\', '/'))
          .sort();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        files = [];
      }
    }
    const passed =
      result.status === expected.exit &&
      (expected.files === undefined ||
        JSON.stringify(files) === JSON.stringify(expected.files.toSorted()));
    const log = `${id}.log`;
    await writeFile(
      join(output, log),
      [
        `mode: ${mode}`,
        `rstest ${args.join(' ')}`,
        `exit: ${result.status}`,
        clean(result.stdout),
        clean(result.stderr),
      ].join('\n'),
    );
    results.push({
      id,
      group,
      kind,
      mode,
      command: ['rstest', ...args],
      expected,
      actual: { exit: result.status, files },
      passed,
      log,
    });
    if (args.includes('--trace')) {
      for (const file of await readdir(join(cwd, '.rstest'))) {
        await writeFile(
          join(output, file),
          clean(await readFile(join(cwd, '.rstest', file), 'utf8')),
        );
      }
    }
    console.log(
      `${passed ? 'PASS' : 'FAIL'} ${id}: exit ${result.status}${files ? `; ${files.length} test files` : ''}`,
    );
    return { ...result, passed };
  };
  try {
    for (const file of [
      'src',
      'tests',
      'config',
      'runtime',
      'packages',
      'rstest.config.ts',
      'receipt-loader.mjs',
      'source-inputs-loader.mjs',
      'package.json',
    ]) {
      await cp(join(root, file), join(cwd, file), { recursive: true });
    }
    await mkdir(join(cwd, 'node_modules/@rstest'), { recursive: true });
    await symlink(runner, join(cwd, 'node_modules/@rstest/core'), 'junction');
    await write(
      '.gitignore',
      'node_modules/\ndist/\n.reproduction/\n.rstest/\n.rstest-temp/\n',
    );
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Checkout demo');
    git('config', 'user.email', 'demo@example.com');
    git('add', '.');
    git('commit', '-qm', 'Initial checkout example');
    await action({
      cwd,
      check,
      write,
      replace,
      git,
      build: () => buildCatalog(cwd),
      remove: (file) => rm(join(cwd, file)),
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const related = (file) => ['list', '--filesOnly', '--related', file];
const changed = ['list', '--filesOnly', '--changed'];
const priceSource = 'packages/catalog/src/price.ts';
const priceTest = ['tests/catalog-price.test.ts'];

try {
  await scenario('controls', 'default', async ({ check }) => {
    const result = await check('complete-suite', 'control', ['run'], {
      exit: 0,
      files: testFiles,
    });
    if (!result.passed)
      throw new Error(
        'The complete application suite must pass before selection results can be interpreted.',
      );
    await check(
      'direct-and-literal-imports',
      'control',
      related('src/inventory.ts'),
      { exit: 0, files: inventoryTests },
    );
    await check(
      'barrel-namespace-import',
      'control',
      related('src/reservations/limit.ts'),
      {
        exit: 0,
        files: [
          'tests/reservations-mock.test.ts',
          'tests/reservations.test.ts',
        ],
      },
    );
  });
  await scenario('controls', 'default', async ({ check, write }) => {
    await write(
      'src/reservations/limit.ts',
      'throw new Error("Reservation policy failed to initialize");\nexport const reservationLimit = 10;\n',
    );
    await check('barrel-evaluation-error', 'control', ['run', '--changed'], {
      exit: 1,
      files: ['tests/reservations-mock.test.ts', 'tests/reservations.test.ts'],
    });
  });
  await scenario('controls', 'source-alias', async ({ check, replace }) => {
    await check(
      'source-alias-selects-consumer',
      'control',
      related(priceSource),
      { exit: 0, files: priceTest },
    );
    await replace(priceSource, 'coffee: 1200', 'coffee: 1300');
    await check(
      'source-alias-executes-unbuilt-source',
      'control',
      ['run', '--changed'],
      { exit: 1, files: priceTest },
    );
  });

  for (const mode of ['default', 'parser-contexts']) {
    await scenario('computed-imports', mode, async ({ check }) => {
      await check(
        `computed-import-${mode}`,
        'regression',
        related('src/shipping/standard.mjs'),
        { exit: 0, files: ['tests/checkout.test.ts'] },
      );
      await check(
        `computed-require-${mode}`,
        'regression',
        related('src/shipping/standard.cjs'),
        { exit: 0, files: ['tests/legacy-shipping.test.ts'] },
      );
      await check(
        `computed-require-resolve-${mode}`,
        'regression',
        related('src/shipping/manifests/standard.json'),
        { exit: 0, files: ['tests/legacy-shipping.test.ts'] },
      );
    });
  }
  await scenario('computed-imports', 'default', async ({ check, replace }) => {
    await replace('src/shipping/standard.mjs', '500', '800');
    await check(
      'computed-import-broken-provider-full-run',
      'control',
      ['run'],
      { exit: 1, files: testFiles },
    );
    await check(
      'computed-import-broken-provider-changed-run',
      'regression',
      ['run', '--changed', '--passWithNoTests'],
      { exit: 1, files: ['tests/checkout.test.ts'] },
    );
  });

  await scenario(
    'loader-inputs',
    'default',
    async ({ check, write, replace }) => {
      await check(
        'loader-file-input',
        'regression',
        related('src/templates/footer.txt'),
        { exit: 0, files: ['tests/receipt.test.ts'] },
      );
      await check(
        'loader-directory-input',
        'regression',
        related('src/templates/promotions/shipping.txt'),
        { exit: 0, files: ['tests/receipt.test.ts'] },
      );
      await check(
        'loader-missing-input',
        'regression',
        related('src/templates/branding.txt'),
        { exit: 0, files: ['tests/receipt.test.ts'] },
      );
      await write(
        'src/templates/promotions-extra/shipping.txt',
        'Unrelated promotion\n',
      );
      await check(
        'loader-directory-prefix-boundary',
        'control',
        related('src/templates/promotions-extra/shipping.txt'),
        { exit: 0, files: [] },
      );
      await replace('src/templates/footer.txt', 'Thank you', 'Goodbye');
      await check('loader-broken-footer-full-run', 'control', ['run'], {
        exit: 1,
        files: testFiles,
      });
      await check(
        'loader-broken-footer-related-run',
        'regression',
        ['run', '--related', 'src/templates/footer.txt', '--passWithNoTests'],
        { exit: 1, files: ['tests/receipt.test.ts'] },
      );
    },
  );
  await scenario('integration', 'default', async ({ check, remove, git }) => {
    await remove('src/templates/promotions/shipping.txt');
    git('add', '-u');
    await check('loader-deleted-directory-member', 'regression', changed, {
      exit: 0,
      files: ['tests/receipt.test.ts'],
    });
  });

  for (const committed of [false, true]) {
    await scenario(
      'deleted-files',
      'default',
      async ({ check, remove, git }) => {
        await remove('src/pricing.ts');
        git('add', '-u');
        if (committed) git('commit', '-qm', 'Remove pricing implementation');
        const flag = committed ? '--changed=HEAD~1' : '--changed';
        const state = committed ? 'committed' : 'staged';
        await check(
          `${state}-source-deletion`,
          'regression',
          ['list', '--filesOnly', flag],
          { exit: 0, files: ['tests/checkout.test.ts'] },
        );
        await check(
          `${state}-deleted-import-cannot-pass`,
          'regression',
          ['run', flag, '--passWithNoTests'],
          { exit: 1 },
        );
      },
    );
    await scenario(
      'deleted-files',
      'default',
      async ({ check, remove, git }) => {
        await remove('config/checkout.json');
        git('add', '-u');
        if (committed) git('commit', '-qm', 'Remove configured rerun trigger');
        await check(
          `${committed ? 'committed' : 'staged'}-trigger-deletion`,
          'regression',
          ['list', '--filesOnly', committed ? '--changed=HEAD~1' : '--changed'],
          { exit: 0, files: testFiles },
        );
      },
    );
  }

  for (const mode of ['default', 'bail']) {
    await scenario('analysis-errors', mode, async ({ check, write }) => {
      await write('src/pricing.ts', 'export const subtotal = ;\n');
      await write(
        'src/unreferenced.ts',
        'export const futureFeature = true;\n',
      );
      await check(`syntax-error-full-run-${mode}`, 'control', ['run'], {
        exit: 1,
      });
      await check(
        `syntax-error-unmatched-related-${mode}`,
        'regression',
        ['run', '--related', 'src/unreferenced.ts', '--passWithNoTests'],
        { exit: 1 },
      );
      await check(
        `syntax-error-unrelated-valid-test-${mode}`,
        'regression',
        [
          'run',
          '--related',
          'packages/catalog/dist/availability.js',
          '--passWithNoTests',
        ],
        { exit: 1 },
      );
    });
  }

  await scenario(
    'compiled-mapping',
    'default',
    async ({ check, replace, build }) => {
      await check(
        'compiled-output-direct-match',
        'control',
        related('packages/catalog/dist/price.js'),
        { exit: 0, files: priceTest },
      );
      await check(
        'source-map-alone-no-source-edge',
        'limitation',
        related(priceSource),
        { exit: 0, files: [] },
      );
      await replace(priceSource, 'coffee: 1200', 'coffee: 1300');
      build();
      await check('rebuilt-catalog-full-run', 'control', ['run'], {
        exit: 1,
        files: testFiles,
      });
      await check(
        'rebuilt-catalog-source-change-unmapped',
        'limitation',
        changed,
        { exit: 0, files: [] },
      );
    },
  );
  await scenario(
    'compiled-mapping',
    'compiled-trigger',
    async ({ check, replace, build }) => {
      await replace(priceSource, 'coffee: 1200', 'coffee: 1300');
      await check('compiled-trigger-selects-whole-suite', 'control', changed, {
        exit: 0,
        files: testFiles,
      });
      await check(
        'compiled-trigger-does-not-rebuild',
        'control',
        ['run', '--changed'],
        { exit: 0, files: testFiles },
      );
      build();
      await check(
        'compiled-trigger-after-rebuild',
        'control',
        ['run', '--changed'],
        { exit: 1, files: testFiles },
      );
    },
  );
  await scenario(
    'compiled-mapping',
    'source-map-inputs',
    async ({ check, replace, build }) => {
      await check(
        'loader-maps-source-to-compiled-consumer',
        'regression',
        related(priceSource),
        { exit: 0, files: priceTest },
      );
      await check(
        'loader-maps-build-config-to-catalog-consumers',
        'regression',
        related('packages/catalog/tsconfig.json'),
        {
          exit: 0,
          files: ['tests/catalog-price.test.ts', 'tests/catalog-stock.test.ts'],
        },
      );
      await replace(priceSource, 'coffee: 1200', 'coffee: 1300');
      await check(
        'mapping-does-not-replace-executed-output',
        'control',
        ['run', 'tests/catalog-price.test.ts'],
        { exit: 0, files: priceTest },
      );
      build();
      await check(
        'mapped-rebuilt-source-selects-only-price-test',
        'regression',
        changed,
        { exit: 0, files: priceTest },
      );
      await check(
        'mapped-rebuilt-source-catches-failure',
        'regression',
        ['run', '--changed', '--passWithNoTests'],
        { exit: 1, files: priceTest },
      );
    },
  );

  for (const mode of ['default', 'runtime-trigger']) {
    await scenario('runtime-inputs', mode, async ({ check, replace }) => {
      await replace('runtime/card.mjs', '0.029', '0.039');
      await check(`runtime-provider-full-run-${mode}`, 'control', ['run'], {
        exit: 1,
        files: testFiles,
      });
      await check(
        `runtime-provider-selection-${mode}`,
        mode === 'default' ? 'limitation' : 'control',
        changed,
        { exit: 0, files: mode === 'default' ? [] : testFiles },
      );
      if (mode === 'runtime-trigger') {
        await check(
          'runtime-trigger-catches-provider-failure',
          'control',
          ['run', '--changed'],
          { exit: 1, files: testFiles },
        );
      }
    });
    await scenario('runtime-inputs', mode, async ({ check, replace }) => {
      await replace('config/loyalty.json', '500', '700');
      await check(`filesystem-input-full-run-${mode}`, 'control', ['run'], {
        exit: 1,
        files: testFiles,
      });
      await check(
        `filesystem-input-selection-${mode}`,
        mode === 'default' ? 'limitation' : 'control',
        changed,
        { exit: 0, files: mode === 'default' ? [] : testFiles },
      );
    });
  }

  await scenario('diagnostics', 'default', async ({ check }) => {
    await check(
      'selection-list-json',
      'observation',
      ['list', '--json', '--related', 'packages/catalog/dist/price.js'],
      { exit: 0 },
    );
    await check('selection-cli-help', 'observation', ['list', '--help'], {
      exit: 0,
    });
    await check(
      'performance-trace-output',
      'observation',
      ['run', '--trace', '--related', 'packages/catalog/dist/price.js'],
      { exit: 0, files: priceTest },
    );
  });
} finally {
  const { version } = JSON.parse(
    await readFile(join(runner, 'package.json'), 'utf8'),
  );
  const report = {
    label: values.label,
    rstestVersion: version,
    nodeVersion: process.version,
    group: values.group ?? 'all',
    results,
  };
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.table(
    results.map(({ id, kind, passed }) => ({
      scenario: id,
      kind,
      result: passed ? 'PASS' : 'FAIL',
    })),
  );
  console.log(`Evidence: ${join(output, 'results.json')}`);
  if (results.some(({ passed }) => !passed)) process.exitCode = 1;
}
