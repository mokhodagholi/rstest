import { spawnSync } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    cli: { type: 'string' },
    binding: { type: 'string' },
    mode: { type: 'string', default: 'api' },
    label: { type: 'string', default: 'selection-demo' },
    output: { type: 'string' },
  },
});
if (!values.cli || !values.output || !['api', 'native'].includes(values.mode)) {
  throw new Error(
    'Use --cli <built rstest.js> --mode api|native --output <new directory>; native mode also needs --binding <native .node file>.',
  );
}
if (values.mode === 'native' && !values.binding)
  throw new Error(
    'Native mode requires --binding for the proposed native metadata producer.',
  );
const cli = await realpath(resolve(values.cli));
const binding = values.binding
  ? await realpath(resolve(values.binding))
  : undefined;
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Preserve previous evidence rather than replacing it.
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(?:DESIGN_|DECLARED_NATIVE_|NATIVE_AUDIT_)/.test(key)) delete env[key];
delete env.NAPI_RS_NATIVE_LIBRARY_PATH;
if (binding) env.NAPI_RS_NATIVE_LIBRARY_PATH = binding;
env.DESIGN_PLUGIN_PATH = join(
  root,
  'declarations',
  values.mode === 'api' ? 'plugin.mjs' : 'native-marker-plugin.mjs',
);
const suites = [
  [
    'strict-selection',
    [
      join(root, 'validation/verify.mjs'),
      cli,
      '--label',
      values.label,
      '--output',
      join(output, 'strict-selection'),
    ],
  ],
];
if (values.mode === 'native')
  suites.push(
    [
      'native-integration',
      [
        join(root, 'native-validation/verify.mjs'),
        cli,
        join(output, 'native-integration'),
      ],
    ],
    [
      'gap-regressions',
      [
        join(root, 'final-review/verify-gap-regressions.mjs'),
        '--cli',
        cli,
        '--binding',
        binding,
        '--output',
        join(output, 'gap-regressions'),
        '--label',
        values.label,
      ],
    ],
    [
      'deleted-symlink',
      [
        join(root, 'final-review/verify-deleted-symlink.mjs'),
        '--cli',
        cli,
        '--binding',
        binding,
        '--output',
        join(output, 'deleted-symlink'),
        '--label',
        values.label,
      ],
    ],
  );
const results = [];
for (const [suite, args] of suites) {
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (run.error) throw run.error;
  results.push({ suite, exit: run.status, signal: run.signal });
}
await writeFile(
  join(output, 'suite-results.json'),
  JSON.stringify(
    { label: values.label, mode: values.mode, node: process.version, results },
    null,
    2,
  ) + '\n',
);
process.exitCode = results.every((result) => result.exit === 0) ? 0 : 1;
