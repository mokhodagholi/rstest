import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
const require = createRequire(import.meta.url);

// Read-only audit, enabled only in unmeasured full-runtime gates.
export default function auditScaleBuild() {
  return {
    name: 'benchmark:read-only-native-provenance',
    setup(api) {
      api.modifyRspackConfig((config) => {
        config.plugins.push({
          apply(compiler) {
            compiler.hooks.done.tap('ScaleProvenanceAudit', (stats) => {
              const counts = {
                modules: 0,
                nativeMetadata: 0,
                nativeCalls: 0,
                declarations: 0,
                literalResolveCalls: 0,
              };
              const seen = new Set();
              const compiledTests = new Set();
              function visit(module) {
                if (seen.has(module)) return;
                seen.add(module);
                counts.modules++;
                const resource = module.nameForCondition?.();
                if (resource) {
                  const file = relative(compiler.context, resource).replaceAll(
                    '\\',
                    '/',
                  );
                  if (/^tests\/.*\.test\.ts$/.test(file))
                    compiledTests.add(file);
                }
                const metadata = module.buildInfo?.rstestRuntimeDependencies;
                if (metadata?.version === 1) {
                  counts.nativeMetadata++;
                  counts.nativeCalls += metadata.calls.length;
                  counts.literalResolveCalls += metadata.calls.filter(
                    (call) =>
                      call.kind === 'resolve' &&
                      call.parts?.every((part) => typeof part === 'string'),
                  ).length;
                }
                if (module.buildInfo?.rstestDeclaredRuntimeDependencies)
                  counts.declarations++;
                for (const inner of module.modules ?? []) visit(inner);
              }
              for (const module of stats.compilation.modules) visit(module);
              writeFileSync(
                process.env.SCALE_AUDIT_PATH,
                JSON.stringify(
                  {
                    counts,
                    entrypoints: stats.compilation.entrypoints.size,
                    compiledTests: [...compiledTests].sort(),
                    loadedBindings: Object.keys(require.cache).filter((file) =>
                      file.endsWith('.node'),
                    ),
                    assets: stats.compilation
                      .getAssets()
                      .filter(({ name }) => /\.(mjs|cjs|js)$/.test(name))
                      .map(({ name, source }) => ({
                        name,
                        sha256: createHash('sha256')
                          .update(source.buffer())
                          .digest('hex'),
                      }))
                      .sort((a, b) => a.name.localeCompare(b.name)),
                  },
                  null,
                  2,
                ),
              );
            });
          },
        });
      });
    },
  };
}
