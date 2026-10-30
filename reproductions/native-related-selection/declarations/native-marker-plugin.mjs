import { createDeclarationsPlugin } from './plugin.mjs';

export default function completeNativeDeclarations(options = {}) {
  return createDeclarationsPlugin(options, {
    name: 'research:complete-native-declarations',
    onCompilation(compilation, declarations) {
      compilation.hooks.finishModules.tap(
        'CompleteNativeDeclarations',
        (modules) => {
          for (const module of modules) {
            const files = declarations.get(module.nameForCondition?.());
            if (files) {
              module.buildInfo.rstestDeclaredRuntimeDependencies = {
                version: 1,
                complete: true,
                files,
              };
            }
          }
        },
      );
    },
  });
}
