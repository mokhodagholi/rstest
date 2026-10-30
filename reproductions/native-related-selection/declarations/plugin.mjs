import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declarationContextKey } from './native-dependencies-loader.mjs';

const exampleManifest = fileURLToPath(
  new URL('./example-native-dependencies.json', import.meta.url),
);
const loaderPath = fileURLToPath(
  new URL('./native-dependencies-loader.mjs', import.meta.url),
);

function readDeclarations(manifestPath, projectRoot) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.version !== 1 ||
    !manifest.importers ||
    typeof manifest.importers !== 'object' ||
    Array.isArray(manifest.importers)
  ) {
    throw new Error(`Unsupported native dependency manifest: ${manifestPath}`);
  }
  const declarations = new Map();
  for (const [importer, inputs] of Object.entries(manifest.importers)) {
    if (
      !Array.isArray(inputs) ||
      inputs.some((input) => typeof input !== 'string')
    ) {
      throw new Error(
        `Invalid native dependency inputs for ${importer}: ${manifestPath}`,
      );
    }
    const resource = resolve(projectRoot, importer);
    if (declarations.has(resource)) {
      throw new Error(
        `Duplicate native dependency importer ${resource}: ${manifestPath}`,
      );
    }
    declarations.set(
      resource,
      Object.freeze(inputs.map((input) => resolve(projectRoot, input))),
    );
  }
  return declarations;
}

export function createDeclarationsPlugin(
  options = {},
  { name = 'example:declared-native-dependencies', onCompilation } = {},
) {
  return {
    name,
    setup(api) {
      api.modifyRspackConfig((config) => {
        const projectRoot = config.context;
        const configuredManifest =
          options.manifestPath ?? process.env.DECLARED_NATIVE_MANIFEST;
        const manifestPath = configuredManifest
          ? resolve(projectRoot, configuredManifest)
          : exampleManifest;
        let importers;
        config.module ??= {};
        config.module.rules ??= [];
        config.module.rules.push({
          enforce: 'pre',
          include: (resource) => importers?.has(resource) ?? false,
          use: [{ loader: loaderPath }],
        });
        config.plugins ??= [];
        config.plugins.push({
          apply(compiler) {
            let initialImporters;
            compiler.hooks.thisCompilation.tap(name, (compilation) => {
              const declarations = readDeclarations(manifestPath, projectRoot);
              if (
                initialImporters &&
                (declarations.size !== initialImporters.size ||
                  [...declarations.keys()].some(
                    (resource) => !initialImporters.has(resource),
                  ))
              ) {
                throw new Error(
                  `Native dependency importer membership changed in ${manifestPath}. ` +
                    'Restart the compiler to apply added or removed importer entries.',
                );
              }
              importers = new Set(declarations.keys());
              initialImporters ??= importers;
              compilation.fileDependencies.add(manifestPath);
              compiler.rspack.NormalModule.getCompilationHooks(
                compilation,
              ).loader.tap(name, (loaderContext) => {
                const inputs = declarations.get(loaderContext.resourcePath);
                if (inputs) {
                  loaderContext[declarationContextKey] = {
                    manifestPath,
                    inputs,
                  };
                }
              });
              onCompilation?.(compilation, declarations);
            });
          },
        });
      });
    },
  };
}

export default function declaredNativeDependencies(options = {}) {
  return createDeclarationsPlugin(options);
}
