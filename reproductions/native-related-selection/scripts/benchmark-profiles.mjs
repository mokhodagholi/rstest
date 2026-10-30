import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: Object.fromEntries(
    [
      'before-cli',
      'before-binding',
      'after-cli',
      'after-binding',
      'output',
    ].map((name) => [name, { type: 'string' }]),
  ),
});
for (const name of [
  'before-cli',
  'before-binding',
  'after-cli',
  'after-binding',
  'output',
])
  if (!values[name]) throw new Error(`Missing --${name}`);
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
for (const [kind, declared] of [
  ['commerce', true],
  ['native-closure', false],
]) {
  const profiles = {};
  for (const side of ['before', 'after']) {
    const cli = await realpath(resolve(values[`${side}-cli`]));
    const binding = await realpath(resolve(values[`${side}-binding`]));
    profiles[`native-${side}`] = {
      cli,
      binding,
      manifest: 'computed',
      expectedNativeMetadata: true,
      buildKind: `reviewer-supplied ${side} artifact; verify matching release settings`,
      env: { NAPI_RS_NATIVE_LIBRARY_PATH: binding },
      ...(declared
        ? {
            plugin: join(root, 'declarations/native-marker-plugin.mjs'),
            supportFiles: [
              'plugin.mjs',
              'native-dependencies-loader.mjs',
              'native-marker-plugin.mjs',
            ].map((file) => join(root, 'declarations', file)),
          }
        : {}),
    };
  }
  await writeFile(
    join(output, `${kind}.json`),
    JSON.stringify({ profiles }, null, 2) + '\n',
  );
}
console.log(output);
