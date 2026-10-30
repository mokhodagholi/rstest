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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    cli: { type: 'string' },
    binding: { type: 'string' },
    output: { type: 'string' },
    label: { type: 'string', default: 'deleted-symlink' },
  },
});
if (!values.cli || !values.binding || !values.output)
  throw new Error('Pass --cli, --binding, and a new --output directory.');
const cli = await realpath(resolve(values.cli));
const core = dirname(dirname(cli));
const binding = await realpath(resolve(values.binding));
const cwd = resolve(values.output);
await mkdir(cwd);
for (const directory of ['tests', 'shared', 'node_modules/@rstest', 'evidence'])
  await mkdir(join(cwd, directory), { recursive: true });
await symlink(core, join(cwd, 'node_modules/@rstest/core'), 'junction');
await symlink(join(cwd, 'shared'), join(cwd, 'linked'), 'junction');
await writeFile(
  join(cwd, 'package.json'),
  JSON.stringify(
    { name: 'warehouse-native-price-deletion', private: true, type: 'module' },
    null,
    2,
  ),
);
await writeFile(join(cwd, 'shared/helper.cjs'), 'module.exports = 42;\n');
await writeFile(
  join(cwd, 'tests/price.test.ts'),
  `import { expect, test } from '@rstest/core';
test('uses the native warehouse price', () => expect(require('../linked/helper.cjs')).toBe(42));
`,
);
await writeFile(
  join(cwd, 'tests/stock.test.ts'),
  `import { expect, test } from '@rstest/core';
test('reports unrelated stock', () => expect(3 + 4).toBe(7));
`,
);
const auditPlugin = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../native-validation/audit-plugin.mjs',
);
await writeFile(
  join(cwd, 'rstest.config.mjs'),
  `import { defineConfig } from '@rstest/core';
import audit from ${JSON.stringify(pathToFileURL(auditPlugin).href)};
export default defineConfig({
  include: ['tests/**/*.test.ts'],
  pool: { type: 'forks', maxWorkers: 2 },
  reporters: [['json', { outputPath: process.env.DESIGN_REPORT }]],
  plugins: [audit()],
  tools: { rspack: { module: { rules: [{ test: /price\\.test\\.ts$/, type: 'javascript/esm' }] } } },
});
`,
);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const worker = join(core, 'dist/runtimeDependenciesWorker.mjs');
const provenance = {
  node: process.version,
  cli,
  binding,
  bindingSha256: hash(await readFile(binding)),
  workerSha256: hash(await readFile(worker)),
  harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
};
const runs = [];
const checks = [];
const expected = ['tests/price.test.ts'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(id, passed, evidence) {
  checks.push({ id, passed, evidence });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id}`);
}
async function run(id, args) {
  const evidence = join(cwd, 'evidence', id);
  await mkdir(evidence);
  const reportPath = join(evidence, 'report.json');
  const auditPath = join(evidence, 'audit');
  const env = {
    ...process.env,
    CI: 'true',
    NO_COLOR: '1',
    RSTEST_NO_AGENT: '1',
    NAPI_RS_NATIVE_LIBRARY_PATH: binding,
    DESIGN_REPORT: reportPath,
    NATIVE_AUDIT_DIR: auditPath,
  };
  for (const key of [
    'NODE_OPTIONS',
    'DESIGN_PLUGIN_PATH',
    'DECLARED_NATIVE_MANIFEST',
    'DESIGN_METADATA_MODE',
  ])
    delete env[key];
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
        .map((line) => line.trim().replaceAll('\\', '/'))
        .filter((line) => /^tests\/.*\.test\.ts$/.test(line))
        .sort()
    : (report?.files
        .map((file) => file.testPath.replaceAll('\\', '/'))
        .sort() ?? []);
  const audits = [];
  try {
    for (const file of (await readdir(auditPath)).sort())
      audits.push(JSON.parse(await readFile(join(auditPath, file), 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const item = {
    id,
    command: [process.execPath, cli, ...args],
    args,
    exit: result.status,
    files,
    summary: report?.summary,
    failedFiles:
      report?.files
        .filter((file) => file.status === 'fail')
        .map((file) => file.testPath)
        .sort() ?? [],
    errorMessages:
      report?.tests.flatMap(
        (test) => test.errors?.map((error) => error.message) ?? [],
      ) ?? [],
    stdout: result.stdout,
    stderr: result.stderr,
    audits,
  };
  runs.push(item);
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify(item, null, 2) + '\n',
  );
  await writeFile(join(evidence, 'output.log'), result.stdout + result.stderr);
  return item;
}
const relatedArgs = ['list', '--filesOnly', '--related', 'shared/helper.cjs'];
try {
  const fullBefore = await run('full-before', ['run']);
  check(
    'full-runtime-before-passes',
    fullBefore.exit === 0 && fullBefore.summary?.passedTests === 2,
  );
  const before = await run('related-before', relatedArgs);
  check(
    'physical-path-before-selects-exact-owner',
    before.exit === 0 && equal(before.files, expected),
  );
  const control = await run('unrelated-before', [
    'list',
    '--filesOnly',
    '--related',
    'README.md',
  ]);
  check(
    'unrelated-control-is-empty',
    control.exit === 0 && control.files.length === 0,
  );
  await rm(join(cwd, 'shared/helper.cjs'));
  const fullAfter = await run('full-after', ['run']);
  check(
    'full-runtime-after-detects-deletion',
    fullAfter.exit === 1 &&
      equal(fullAfter.failedFiles, expected) &&
      fullAfter.errorMessages.some((message) =>
        message.includes('Cannot find module'),
      ),
  );
  const after = await run('related-after', relatedArgs);
  check(
    'identical-physical-path-after-selects-exact-owner',
    after.exit === 0 && equal(after.files, expected),
    after.id,
  );
  check(
    'before-and-after-use-identical-related-command',
    equal(before.command, after.command),
  );
  const relatedAfter = await run('related-run-after', [
    'run',
    '--related',
    'shared/helper.cjs',
  ]);
  check(
    'related-run-after-detects-deletion-without-unrelated-test',
    relatedAfter.exit === 1 &&
      equal(relatedAfter.files, expected) &&
      equal(relatedAfter.failedFiles, expected),
    relatedAfter.id,
  );
} finally {
  check(
    'artifacts-unchanged',
    provenance.bindingSha256 === hash(await readFile(binding)) &&
      provenance.workerSha256 === hash(await readFile(worker)),
  );
  const audited = runs.filter((run) => run.audits.length);
  check(
    'audits-confirm-loaded-native-artifact',
    audited.length > 0 &&
      (
        await Promise.all(
          audited.map(async (run) =>
            (
              await Promise.all(
                run.audits
                  .flatMap((audit) => audit.loadedNativeBindings)
                  .map((path) => realpath(path)),
              )
            ).includes(binding),
          ),
        )
      ).every(Boolean),
  );
  await writeFile(
    join(cwd, 'results.json'),
    JSON.stringify(
      {
        label: values.label,
        cwd,
        provenance,
        method:
          'Explicit --related physical path before and after deletion through an existing symlink directory. No Git discovery, declarations, custom hooks or dynamic expressions.',
        checks,
        runs,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(cwd, 'REPORT.md'),
    [
      `# Native literal deletion through an existing symlink: ${values.label}`,
      '',
      `${checks.filter((check) => check.passed).length} passed; ${checks.filter((check) => !check.passed).length} failed.`,
      '',
      'The price test natively requires `../linked/helper.cjs`; `linked` points to `shared`. The same `list --filesOnly --related shared/helper.cjs` command runs before and after the physical file is deleted. The stock test is unrelated.',
      '',
      '| Check | Result |',
      '| --- | --- |',
      ...checks.map(
        (check) => `| ${check.id} | ${check.passed ? 'PASS' : 'FAIL'} |`,
      ),
      '',
    ].join('\n'),
  );
}
console.log(`Evidence: ${cwd}`);
process.exitCode = checks.some((check) => !check.passed) ? 1 : 0;
