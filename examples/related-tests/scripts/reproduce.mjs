import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = process.argv[2]
  ? resolve(process.argv[2])
  : join(
      dirname(require.resolve('@rstest/core/package.json')),
      'bin/rstest.js',
    );
const cwd = await mkdtemp(join(tmpdir(), 'rstest-checkout-demo-'));
const results = [];

function git(...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

function check(name, args, expectedFiles, expectedExit = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, RSTEST_NO_AGENT: '1', NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  const files = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^tests\/.*\.test\.ts$/.test(line))
    .sort();
  const passed =
    result.status === expectedExit &&
    (expectedFiles === undefined ||
      JSON.stringify(files) === JSON.stringify(expectedFiles.toSorted()));
  results.push({ scenario: name, result: passed ? 'PASS' : 'FAIL' });
  console.log(`\n${name}: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`rstest ${args.join(' ')} (exit ${result.status})`);
  console.log(result.stdout.trim());
  if (!passed || expectedExit !== 0) console.log(result.stderr.trim());
}

try {
  for (const file of [
    'src',
    'tests',
    'config',
    'rstest.config.ts',
    'receipt-loader.mjs',
    'package.json',
  ]) {
    await cp(join(root, file), join(cwd, file), { recursive: true });
  }
  await symlink(
    join(root, 'node_modules'),
    join(cwd, 'node_modules'),
    'junction',
  );
  await writeFile(join(cwd, '.gitignore'), 'node_modules/\ndist/\n');
  git('-c', 'init.defaultBranch=main', 'init');
  git('config', 'user.name', 'Checkout demo');
  git('config', 'user.email', 'demo@example.com');
  git('add', '.');
  git('commit', '-m', 'Initial checkout example');

  check('Complete application suite', ['run'], undefined);
  for (const [name, source, expected] of [
    [
      'Computed shipping import',
      'src/shipping/standard.mjs',
      ['tests/checkout.test.ts'],
    ],
    [
      'Loader file input',
      'src/templates/footer.txt',
      ['tests/receipt.test.ts'],
    ],
    [
      'Loader directory input',
      'src/templates/promotions/shipping.txt',
      ['tests/receipt.test.ts'],
    ],
    [
      'Loader missing input',
      'src/templates/branding.txt',
      ['tests/receipt.test.ts'],
    ],
    [
      'Unrelated directory with the same prefix',
      'src/templates/promotions-extra/shipping.txt',
      [],
    ],
  ]) {
    check(name, ['list', '--filesOnly', '--related', source], expected);
  }

  await rm(join(cwd, 'src/pricing.ts'));
  git('add', '-u');
  check(
    'Staged source deletion',
    ['list', '--filesOnly', '--changed'],
    ['tests/checkout.test.ts'],
  );
  check(
    'Deleted import cannot silently pass',
    ['run', '--changed', '--passWithNoTests'],
    undefined,
    1,
  );
  git('restore', '--staged', '--worktree', 'src/pricing.ts');

  await rm(join(cwd, 'config/checkout.json'));
  git('add', '-u');
  git('commit', '-m', 'Remove a configured force-rerun trigger');
  check(
    'Committed trigger deletion',
    ['list', '--filesOnly', '--changed=HEAD~1'],
    [
      'tests/checkout.test.ts',
      'tests/inventory.test.ts',
      'tests/receipt.test.ts',
    ],
  );

  await writeFile(join(cwd, 'src/pricing.ts'), 'export const subtotal = ;\n');
  check(
    'Invalid graph cannot silently pass',
    ['run', '--related', 'src/inventory.ts', '--passWithNoTests'],
    undefined,
    1,
  );

  console.table(results);
  process.exitCode = results.some(({ result }) => result === 'FAIL') ? 1 : 0;
} finally {
  await rm(cwd, { recursive: true, force: true });
}
