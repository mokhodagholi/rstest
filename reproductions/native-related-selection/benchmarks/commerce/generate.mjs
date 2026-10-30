import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const domains = [
  'catalog',
  'inventory',
  'checkout',
  'shipping',
  'tax',
  'payments',
  'promotions',
  'subscriptions',
  'returns',
  'fulfillment',
];
const kinds = [
  'static',
  'alias',
  'computed-esm',
  'computed-cjs',
  'literal-resolve',
  'shared-discount',
  'computed-esm',
  'static',
];
const posix = (path) => path.replaceAll('\\', '/');
const specifier = (from, to) => {
  const path = posix(relative(dirname(from), to));
  return path.startsWith('.') ? path : `./${path}`;
};

export function expectedSelection(oracle, changedPaths) {
  const reverse = new Map();
  for (const [importer, inputs] of Object.entries(oracle.dependencies)) {
    for (const input of inputs) {
      const owners = reverse.get(input) ?? new Set();
      owners.add(importer);
      reverse.set(input, owners);
    }
  }
  const queue = changedPaths.map((path) => {
    if (isAbsolute(path))
      throw new Error('Oracle input paths must be root-relative.');
    return posix(path).replace(/^\.\//, '');
  });
  const seen = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    for (const importer of reverse.get(queue[index]) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  return oracle.tests.filter((test) => seen.has(test)).sort();
}

export async function generateFixture(target, { testCount = 100 } = {}) {
  if (!Number.isInteger(testCount) || testCount < 80)
    throw new Error(
      'testCount must be an integer >= 80; reviewed profiles are 100, 1000, and 3000.',
    );
  const rootDir = resolve(target);
  await mkdir(rootDir, { recursive: true });
  if ((await readdir(rootDir)).length)
    throw new Error(`Fixture output must be empty: ${rootDir}`);
  const files = new Map();
  const graph = new Map();
  const allManifest = {};
  const computedManifest = {};
  const examples = {};
  const typeCounts = {};
  const domainCounts = {};
  const allFiles = [];
  const add = (path, source, dependencies = []) => {
    files.set(path, source.endsWith('\n') ? source : `${source}\n`);
    graph.set(path, [...new Set(dependencies)].sort());
  };
  const mergeInputs = (importer, inputs) =>
    graph.set(
      importer,
      [...new Set([...(graph.get(importer) ?? []), ...inputs])].sort(),
    );
  const declare = (importer, inputs, computed) => {
    allManifest[importer] = [...new Set(inputs)].sort();
    if (computed) computedManifest[importer] = allManifest[importer];
    mergeInputs(importer, inputs);
  };

  const money = 'packages/shared/src/money.mjs';
  const loyalty = 'packages/shared/src/loyalty.mjs';
  const nativeEsmFee = 'packages/native-common/src/fees.mjs';
  const nativeCjsFee = 'packages/native-common/src/fees.cjs';
  add(money, 'export const money = (cents) => Math.round(cents);');
  add(loyalty, 'export const loyaltyDiscount = 25;');
  add(nativeEsmFee, 'export const networkAdjustment = 3;');
  add(nativeCjsFee, 'exports.networkAdjustment = 4;');
  const nativeGroups = new Map();

  for (const [domainIndex, domain] of domains.entries()) {
    const packageRoot = `packages/${domain}`;
    const policy = `${packageRoot}/src/policy.mjs`;
    const catalog = `${packageRoot}/src/catalog.mjs`;
    add(
      `${packageRoot}/package.json`,
      JSON.stringify(
        {
          name: `@commerce/${domain}`,
          private: true,
          type: 'module',
          exports: { './catalog': './dist/catalog.mjs' },
        },
        null,
        2,
      ),
    );
    add(policy, `export const serviceCharge = ${domainIndex * 11};`);
    add(catalog, `export const unitPrice = ${1200 + domainIndex * 10};`);
    add(`${packageRoot}/dist/catalog.mjs`, 'export const unitPrice = 900;');
    for (let group = 0; group < 4; group++) {
      const esmDirectory = `${packageRoot}/runtime/providers/group-${group}`;
      const cjsDirectory = `${packageRoot}/runtime/legacy/group-${group}`;
      const esmPolicy = `${packageRoot}/runtime/policies/group-${group}.mjs`;
      const cjsPolicy = `${packageRoot}/runtime/policies/group-${group}.cjs`;
      const regionalFee = domainIndex * 3 + group * 7;
      add(esmPolicy, `export const regionalFee = ${regionalFee};`);
      add(cjsPolicy, `exports.regionalFee = ${regionalFee};`);
      for (const [channel, baseFee] of [
        ['standard', 100],
        ['priority', 160],
      ]) {
        const esm = `${esmDirectory}/${channel}.mjs`;
        const cjs = `${cjsDirectory}/${channel}.cjs`;
        add(
          esm,
          `import { regionalFee } from ${JSON.stringify(specifier(esm, esmPolicy))};\nimport { networkAdjustment } from ${JSON.stringify(specifier(esm, nativeEsmFee))};\nexport const fee = () => ${baseFee} + regionalFee + networkAdjustment;`,
          [esmPolicy, nativeEsmFee],
        );
        add(
          cjs,
          `const { regionalFee } = require(${JSON.stringify(specifier(cjs, cjsPolicy))});\nconst { networkAdjustment } = require(${JSON.stringify(specifier(cjs, nativeCjsFee))});\nexports.fee = () => ${baseFee} + regionalFee + networkAdjustment;`,
          [cjsPolicy, nativeCjsFee],
        );
      }
      add(
        `${esmDirectory}/retired.mjs`,
        '// Inactive provider: native loading must not parse unselected candidates.\nexport const fee = ;',
      );
      add(
        `${cjsDirectory}/retired.cjs`,
        '// Inactive provider: native loading must not parse unselected candidates.\nexports.fee = ;',
      );
      const asset = `${packageRoot}/runtime/manifests/provider-group-${group}.cjs`;
      add(
        asset,
        '// This lookup-only provider asset must never be parsed or executed.\nmodule.exports = ;',
      );
      nativeGroups.set(`${domain}/${group}`, {
        esmDirectory,
        cjsDirectory,
        esmPolicy,
        cjsPolicy,
        asset,
        regionalFee,
        esmInputs: [
          `${esmDirectory}/standard.mjs`,
          `${esmDirectory}/priority.mjs`,
          `${esmDirectory}/retired.mjs`,
          esmPolicy,
          nativeEsmFee,
        ],
        cjsInputs: [
          `${cjsDirectory}/standard.cjs`,
          `${cjsDirectory}/priority.cjs`,
          `${cjsDirectory}/retired.cjs`,
          cjsPolicy,
          nativeCjsFee,
        ],
      });
    }
  }

  for (let index = 0; index < testCount; index++) {
    const domainIndex = index % domains.length;
    const domain = domains[domainIndex];
    const round = Math.floor(index / domains.length);
    const kind = kinds[round % kinds.length];
    const group = Math.floor(round / kinds.length) % 4;
    const native = nativeGroups.get(`${domain}/${group}`);
    const id = String(index + 1).padStart(5, '0');
    const test = `tests/${domain}/order-${id}.test.ts`;
    const service = `packages/${domain}/src/services/order-${id}.mjs`;
    const policy = `packages/${domain}/src/policy.mjs`;
    const catalog = `packages/${domain}/src/catalog.mjs`;
    const base = 1000 + (index % 97) * 13;
    const subtotal = base + domainIndex * 11;
    const body = [
      `import { money } from ${JSON.stringify(specifier(service, money))};`,
      `import { serviceCharge } from ${JSON.stringify(specifier(service, policy))};`,
      `export const orderSubtotal = money(${base} + serviceCharge);`,
    ];
    const serviceInputs = [money, policy];
    let testSource;
    let testInputs = [];
    if (kind === 'literal-resolve') {
      testSource = `import { expect, it } from '@rstest/core';\nit(${JSON.stringify(`${domain}: locates provider for order ${id}`)}, () => {\n  const providerPath = require.resolve(${JSON.stringify(specifier(test, native.asset))});\n  expect(providerPath.endsWith(${JSON.stringify(`provider-group-${group}.cjs`)})).toBe(true);\n});`;
      add(test, testSource);
      declare(test, [native.asset], false);
      examples['literal-native'] ??= native.asset;
    } else {
      let expected = subtotal;
      let expression = 'quote()';
      let imported = 'quote';
      if (kind === 'alias') {
        body.push(
          `import { unitPrice } from '@commerce/${domain}/catalog';`,
          'export const quote = () => money(orderSubtotal + unitPrice);',
        );
        serviceInputs.push(catalog);
        expected += 1200 + domainIndex * 10;
        examples.alias ??= catalog;
      } else if (kind === 'shared-discount') {
        body.push(
          `import { loyaltyDiscount } from ${JSON.stringify(specifier(service, loyalty))};`,
          'export const quote = () => money(orderSubtotal - loyaltyDiscount);',
        );
        serviceInputs.push(loyalty);
        expected -= 25;
      } else if (kind === 'computed-esm') {
        const prefix = `${specifier(service, native.esmDirectory)}/`;
        const channel = round % kinds.length === 6 ? 'priority' : 'standard';
        body.push(
          `export async function quote(channel) {\n  const provider = await import(\`${prefix}\${channel}.mjs\`);\n  return money(orderSubtotal + provider.fee());\n}`,
        );
        expression = `await quote(${JSON.stringify(channel)})`;
        expected +=
          (channel === 'priority' ? 160 : 100) + native.regionalFee + 3;
        examples['dynamic-esm'] ??= `${native.esmDirectory}/standard.mjs`;
      } else if (kind === 'computed-cjs') {
        imported = 'orderSubtotal';
        const channel = domainIndex % 2 ? 'priority' : 'standard';
        const prefix = `${specifier(test, native.cjsDirectory)}/`;
        testSource = `import { expect, it } from '@rstest/core';\nimport { orderSubtotal } from ${JSON.stringify(specifier(test, service))};\nconst providerFee = (channel: string) => require(\`${prefix}\${channel}.cjs\`).fee();\nit(${JSON.stringify(`${domain}: legacy quote for order ${id}`)}, () => {\n  expect(orderSubtotal + providerFee(${JSON.stringify(channel)})).toBe(${subtotal + (channel === 'priority' ? 160 : 100) + native.regionalFee + 4});\n});`;
        examples['dynamic-cjs'] ??= `${native.cjsDirectory}/standard.cjs`;
      } else {
        body.push('export const quote = () => orderSubtotal;');
        examples['static-leaf'] ??= service;
      }
      add(service, body.join('\n'), serviceInputs);
      if (kind === 'computed-esm') declare(service, native.esmInputs, true);
      testSource ??= `import { expect, it } from '@rstest/core';\nimport { ${imported} } from ${JSON.stringify(specifier(test, service))};\nit(${JSON.stringify(`${domain}: ${kind} quote for order ${id}`)}, ${kind === 'computed-esm' ? 'async ' : ''}() => {\n  expect(${expression}).toBe(${expected});\n});`;
      testInputs = [service];
      add(test, testSource, testInputs);
      if (kind === 'computed-cjs') declare(test, native.cjsInputs, true);
    }
    allFiles.push(test);
    typeCounts[kind] = (typeCounts[kind] ?? 0) + 1;
    domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
  }
  allFiles.sort();

  const wrongExtension =
    'packages/catalog/runtime/providers/group-0/standard.txt';
  const sibling =
    'packages/catalog/runtime/providers-extra/group-0/standard.mjs';
  add(
    wrongExtension,
    'Human-readable provider documentation, not a runtime module.',
  );
  add(sibling, 'export const fee = () => 999;');
  add(
    'README.md',
    `# Generated commerce monorepo\n\n${testCount} independent order tests across ten domains.\nDocumentation edits must not select tests.\n`,
  );
  add(
    'package.json',
    JSON.stringify(
      {
        name: `commerce-selection-${testCount}`,
        private: true,
        type: 'module',
      },
      null,
      2,
    ),
  );
  add(
    '.gitignore',
    'node_modules/\n.scale-report.json\n.benchmark-report.json\n.evidence/\n',
  );
  add(
    'rstest.config.mjs',
    [
      "import { fileURLToPath, pathToFileURL } from 'node:url';",
      "import { defineConfig } from '@rstest/core';",
      `const domains = ${JSON.stringify(domains)};`,
      "const manifestPath = process.env.DECLARED_NATIVE_MANIFEST || fileURLToPath(new URL('./native-dependencies-all.json', import.meta.url));",
      'const designPlugin = process.env.DESIGN_PLUGIN_PATH ? (await import(pathToFileURL(process.env.DESIGN_PLUGIN_PATH).href)).default({ manifestPath }) : undefined;',
      'const auditPlugin = process.env.DESIGN_AUDIT_PLUGIN_PATH ? (await import(pathToFileURL(process.env.DESIGN_AUDIT_PLUGIN_PATH).href)).default() : undefined;',
      'export default defineConfig({',
      "  include: ['tests/**/*.test.ts'],",
      '  pool: { maxWorkers: 2 },',
      '  plugins: [designPlugin, auditPlugin].filter(Boolean),',
      '  resolve: { alias: Object.fromEntries(domains.map((domain) => [`@commerce/${domain}/catalog$`, fileURLToPath(new URL(`./packages/${domain}/src/catalog.mjs`, import.meta.url))])) },',
      "  reporters: process.env.DESIGN_REPORT ? [['json', { outputPath: process.env.DESIGN_REPORT }]] : ['default'],",
      '});',
    ].join('\n'),
  );
  const manifests = {
    all: join(rootDir, 'native-dependencies-all.json'),
    computed: join(rootDir, 'native-dependencies-computed.json'),
  };
  files.set(
    'native-dependencies-all.json',
    `${JSON.stringify({ version: 1, importers: allManifest }, null, 2)}\n`,
  );
  files.set(
    'native-dependencies-computed.json',
    `${JSON.stringify({ version: 1, importers: computedManifest }, null, 2)}\n`,
  );
  const oracle = {
    version: 1,
    semantics:
      'Exact static and explicitly declared potential-native input graph; literal resolve paths do not execute their contents.',
    tests: allFiles,
    dependencies: Object.fromEntries(
      [...graph.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  const sourceSets = {
    'static-leaf': [examples['static-leaf']],
    'dynamic-esm': [examples['dynamic-esm']],
    'dynamic-cjs': [examples['dynamic-cjs']],
    'literal-native': [examples['literal-native']],
    'shared-fanout': [money],
    'native-esm-fanout': [nativeEsmFee],
    'native-cjs-fanout': [nativeCjsFee],
    'domain-fanout': ['packages/catalog/src/policy.mjs'],
    alias: [examples.alias],
    'loyalty-fanout': [loyalty],
    'multi-change': [
      examples['static-leaf'],
      examples['dynamic-esm'],
      examples['dynamic-cjs'],
      examples['literal-native'],
      examples.alias,
    ],
    unrelated: ['README.md'],
    'wrong-extension': [wrongExtension],
    'sibling-directory': [sibling],
  };
  const workloads = {};
  for (const [id, sources] of Object.entries(sourceSets)) {
    const expectedFiles = expectedSelection(oracle, sources);
    workloads[id] = {
      args: ['list', '--filesOnly', '--related', ...sources],
      expectedFiles,
      sources,
    };
    workloads[`${id}-run`] = {
      args: [
        'run',
        '--related',
        ...sources,
        ...(expectedFiles.length ? [] : ['--passWithNoTests']),
      ],
      expectedFiles,
      sources,
    };
  }
  workloads['full-run'] = { args: ['run'], expectedFiles: allFiles };
  const stats = {
    testCount,
    packageCount: domains.length + 2,
    poolMaxWorkers: 2,
    typeCounts,
    domainCounts,
    graphNodes: graph.size,
    graphEdges: [...graph.values()].reduce(
      (sum, inputs) => sum + inputs.length,
      0,
    ),
    nativeImporters: {
      all: Object.keys(allManifest).length,
      computed: Object.keys(computedManifest).length,
      literalResolve:
        Object.keys(allManifest).length - Object.keys(computedManifest).length,
    },
    declaredInputEdges: Object.values(allManifest).reduce(
      (sum, inputs) => sum + inputs.length,
      0,
    ),
    invalidNativeAssets: domains.length * 4 * 3,
    generatedSourceFiles: [...files.keys()].filter((path) =>
      /\.(?:mjs|cjs|ts)$/.test(path),
    ).length,
  };
  const oraclePath = join(rootDir, 'selection-oracle.json');
  const metadata = {
    version: 1,
    rootDir,
    allFiles,
    workloads,
    manifests,
    oraclePath,
    stats,
  };
  files.set('selection-oracle.json', `${JSON.stringify(oracle, null, 2)}\n`);
  files.set('fixture-metadata.json', `${JSON.stringify(metadata, null, 2)}\n`);
  const entries = [...files.entries()];
  for (let offset = 0; offset < entries.length; offset += 64) {
    await Promise.all(
      entries.slice(offset, offset + 64).map(async ([path, content]) => {
        const destination = join(rootDir, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }),
    );
  }
  return metadata;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' },
      size: { type: 'string', default: '100' },
    },
  });
  if (!values.output)
    throw new Error(
      'Usage: node generate.mjs --size 100|1000|3000 --output /empty/fixture/directory',
    );
  const result = await generateFixture(values.output, {
    testCount: Number(values.size),
  });
  console.log(
    JSON.stringify(
      {
        rootDir: result.rootDir,
        stats: result.stats,
        manifests: result.manifests,
        workloads: Object.fromEntries(
          Object.entries(result.workloads).map(([id, value]) => [
            id,
            value.expectedFiles.length,
          ]),
        ),
      },
      null,
      2,
    ),
  );
}
