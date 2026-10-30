import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

const require = createRequire(import.meta.url);
let sequence = 0;

// This audit only reads compilation state. Native metadata is produced by the
// actual Rspack RstestPlugin; declarations come from the separate marker plugin.
export default function nativeAudit() {
  return {
    name: 'research:read-only-native-audit',
    setup(api) {
      api.modifyRspackConfig((config) => {
        config.plugins.push({
          apply(compiler) {
            compiler.hooks.thisCompilation.tap(
              'ReadOnlyNativeAudit',
              (compilation) => {
                compilation.hooks.processAssets.tap(
                  {
                    name: 'ReadOnlyNativeAudit',
                    stage:
                      compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
                  },
                  () => {
                    const normalize = (path) =>
                      relative(compiler.context, path).replaceAll('\\', '/');
                    const inspect = (module) => {
                      const path = module.nameForCondition?.();
                      const source = module.originalSource?.();
                      return {
                        source: path ? normalize(path) : null,
                        type: module.type,
                        sourceSha256: source
                          ? createHash('sha256')
                              .update(source.buffer())
                              .digest('hex')
                          : null,
                        native:
                          module.buildInfo?.rstestRuntimeDependencies ?? null,
                        declaration:
                          module.buildInfo?.rstestDeclaredRuntimeDependencies ??
                          null,
                        fileDependencies: [
                          ...(module.buildInfo?.fileDependencies ?? []),
                        ]
                          .map(normalize)
                          .sort(),
                        missingDependencies: [
                          ...(module.buildInfo?.missingDependencies ?? []),
                        ]
                          .map(normalize)
                          .sort(),
                        inner: [...(module.modules ?? [])].map(inspect),
                      };
                    };
                    const modules = [...compilation.modules]
                      .map(inspect)
                      .filter((module) => module.source)
                      .sort((a, b) => a.source.localeCompare(b.source));
                    const assets = compilation
                      .getAssets()
                      .filter(({ name }) => /\.(?:mjs|cjs|js)$/.test(name))
                      .map(({ name, source }) => ({
                        name,
                        sha256: createHash('sha256')
                          .update(source.buffer())
                          .digest('hex'),
                      }))
                      .sort((a, b) => a.name.localeCompare(b.name));
                    const directory = process.env.NATIVE_AUDIT_DIR;
                    mkdirSync(directory, { recursive: true });
                    writeFileSync(
                      join(
                        directory,
                        `${String(sequence++).padStart(3, '0')}.json`,
                      ),
                      JSON.stringify(
                        {
                          audit:
                            'read-only; no dependency metadata is fabricated',
                          compiler: compiler.name,
                          concatenateModules:
                            compiler.options.optimization.concatenateModules,
                          loadedNativeBindings: Object.keys(require.cache)
                            .filter((path) => path.endsWith('.node'))
                            .sort(),
                          modules,
                          assets,
                        },
                        null,
                        2,
                      ),
                    );
                  },
                );
              },
            );
          },
        });
      });
    },
  };
}
