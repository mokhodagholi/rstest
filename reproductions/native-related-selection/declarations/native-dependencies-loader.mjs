import { existsSync } from 'node:fs';

export const declarationContextKey = Symbol.for(
  'example.rstest.declared-native-dependencies',
);

export default function nativeDependenciesLoader(
  source,
  sourceMap,
  additionalData,
) {
  const declaration = this[declarationContextKey];
  if (!declaration) {
    throw new Error(
      'Native dependency loader requires its declaration plugin.',
    );
  }
  const { manifestPath, inputs } = declaration;
  this.addDependency(manifestPath);
  for (const path of inputs) {
    if (existsSync(path)) {
      this.addDependency(path);
    } else {
      this.addMissingDependency(path);
    }
  }
  this.callback(null, source, sourceMap, additionalData);
}
