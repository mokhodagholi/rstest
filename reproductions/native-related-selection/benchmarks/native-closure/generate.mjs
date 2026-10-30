import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Deliberately no declarations, computed requests, aliases, runtime hooks, or
// unsupported syntax. Both compared implementations must be exactly correct.
// The early helper is the first require in every native provider. A selector
// that stops after matching it does less analysis than one validating closure.
export async function generateFixture(
  target,
  { testCount = 100, depth = 8 } = {},
) {
  const rootDir = resolve(target);
  await mkdir(rootDir, { recursive: true });
  if ((await readdir(rootDir)).length)
    throw new Error(`Fixture directory must be empty: ${rootDir}`);
  if (
    !Number.isInteger(testCount) ||
    testCount < 10 ||
    !Number.isInteger(depth) ||
    depth < 2
  )
    throw new Error('Invalid native closure dimensions.');
  const allFiles = [];
  const graph = {};
  async function write(file, source) {
    await mkdir(join(rootDir, file, '..'), { recursive: true });
    await writeFile(join(rootDir, file), source);
  }
  await write(
    'package.json',
    JSON.stringify(
      {
        name: 'native-commerce-closure-benchmark',
        private: true,
        type: 'module',
      },
      null,
      2,
    ) + '\n',
  );
  await write('native/shared/early.cjs', 'module.exports = 1;\n');
  await write('native/shared/late.cjs', 'module.exports = 2;\n');
  await write(
    'README.md',
    'Synthetic native quote pipelines. Shared intake and settlement policies surround eight-stage native CommonJS chains.\n',
  );
  graph['native/shared/early.cjs'] = [];
  graph['native/shared/late.cjs'] = [];
  for (let index = 0; index < testCount; index++) {
    const id = String(index + 1).padStart(5, '0');
    const test = `tests/quote-${id}.test.ts`;
    const directory = `native/chains/quote-${id}`;
    allFiles.push(test);
    await write(
      test,
      `import { expect, test } from '@rstest/core';\ntest('calculates quote ${id}', () => expect(require('../${directory}/step-0.cjs')).toBe(${depth + 2}));\n`,
    );
    graph[test] = [`${directory}/step-0.cjs`];
    for (let step = 0; step < depth; step++) {
      const file = `${directory}/step-${step}.cjs`;
      const next =
        step + 1 === depth ? '../../shared/late.cjs' : `./step-${step + 1}.cjs`;
      const prefix = step === 0 ? "require('../../shared/early.cjs')" : '1';
      await write(file, `module.exports = ${prefix} + require('${next}');\n`);
      graph[file] = [
        ...(step === 0 ? ['native/shared/early.cjs'] : []),
        step + 1 === depth
          ? 'native/shared/late.cjs'
          : `${directory}/step-${step + 1}.cjs`,
      ];
    }
  }
  allFiles.sort();
  await write(
    'rstest.config.mjs',
    [
      "import { defineConfig } from '@rstest/core';",
      "import { pathToFileURL } from 'node:url';",
      "import { relative } from 'node:path';",
      "import { writeFileSync } from 'node:fs';",
      'const audit = process.env.DESIGN_AUDIT_PLUGIN_PATH ? (await import(pathToFileURL(process.env.DESIGN_AUDIT_PLUGIN_PATH).href)).default() : undefined;',
      "const contract = { name:'benchmark:assert-native-closure', setup(api) {api.modifyRspackConfig((config) => {config.plugins.push({apply(compiler) {compiler.hooks.done.tap('AssertNativeClosure',(stats) => {",
      ' const seen = new Set(), entries = [], compiledNative = [];',
      " function visit(module) {if(seen.has(module))return;seen.add(module);const resource=module.nameForCondition?.();if(resource){const file=relative(compiler.context,resource).replaceAll('\\\\','/');if(file.startsWith('native/'))compiledNative.push(file);if(/^tests\\/.*\\.test\\.ts$/.test(file))entries.push({file,type:module.type,calls:module.buildInfo?.rstestRuntimeDependencies?.calls??[],declaration:module.buildInfo?.rstestDeclaredRuntimeDependencies??null});}for(const inner of module.modules??[])visit(inner);}",
      ' for(const module of stats.compilation.modules)visit(module);',
      ` if(entries.length!==${testCount}||compiledNative.length||entries.some((entry)=>entry.type!=='javascript/esm'||entry.declaration||entry.calls.length!==1||entry.calls[0].kind!=='require'||entry.calls[0].origin!=='entry'||!entry.calls[0].parts?.every((part)=>typeof part==='string')))throw new Error('Native closure fixture was bundled, undeclared, or lost its literal request metadata.');`,
      " writeFileSync(process.env.SCALE_AUDIT_PATH+'.closure.json',JSON.stringify({entries,compiledNative},null,2));",
      ' });}});});}};',
      "export default defineConfig({include:['tests/**/*.test.ts'], plugins:audit?[audit,contract]:[], pool:{maxWorkers:2},",
      " tools:{rspack:{module:{rules:[{test:/\\.test\\.ts$/,type:'javascript/esm'}]}}},",
      " reporters:[['json',{outputPath:process.env.DESIGN_REPORT}]],",
      '});',
      '',
    ].join('\n'),
  );
  const oracle = { allFiles, dependenciesBySource: graph };
  const oraclePath = join(rootDir, 'selection-oracle.json');
  await write('selection-oracle.json', JSON.stringify(oracle, null, 2) + '\n');
  const workloadSources = {
    'shared-fanout': ['native/shared/early.cjs'],
    'shared-late': ['native/shared/late.cjs'],
    'deep-leaf': [`native/chains/quote-00001/step-${depth - 1}.cjs`],
    unrelated: ['README.md'],
  };
  const workloads = { 'full-run': { args: ['run'], expectedFiles: allFiles } };
  for (const [name, sources] of Object.entries(workloadSources)) {
    const expectedFiles = expectedSelection(oracle, sources);
    workloads[name] = {
      args: ['list', '--filesOnly', '--related', ...sources],
      sources,
      expectedFiles,
    };
    workloads[`${name}-run`] = {
      args: ['run', '--passWithNoTests', '--related', ...sources],
      sources,
      expectedFiles,
    };
  }
  const emptyManifest = join(rootDir, 'native-dependencies-none.json');
  await write(
    'native-dependencies-none.json',
    '{"version":1,"importers":{}}\n',
  );
  const fixture = {
    version: 1,
    rootDir,
    allFiles,
    workloads,
    manifests: { all: emptyManifest, computed: emptyManifest },
    oraclePath,
    stats: {
      testFiles: testCount,
      nativeSourceFiles: testCount * depth + 2,
      chainDepth: depth,
      nativeImporters: { all: 0, computed: 0, literalResolve: 0 },
      automaticLiteralRequireImporters: testCount,
      oracleEdges: Object.values(graph).reduce(
        (sum, edges) => sum + edges.length,
        0,
      ),
    },
  };
  await write('fixture-metadata.json', JSON.stringify(fixture, null, 2) + '\n');
  return fixture;
}

export function expectedSelection(oracle, sources) {
  const dependents = new Map();
  for (const [owner, inputs] of Object.entries(oracle.dependenciesBySource)) {
    for (const input of inputs) {
      const owners = dependents.get(input) ?? new Set();
      owners.add(owner);
      dependents.set(input, owners);
    }
  }
  const seen = new Set(sources);
  const queue = [...sources];
  for (let index = 0; index < queue.length; index++) {
    for (const owner of dependents.get(queue[index]) ?? []) {
      if (!seen.has(owner)) {
        seen.add(owner);
        queue.push(owner);
      }
    }
  }
  return oracle.allFiles.filter((file) => seen.has(file)).sort();
}
