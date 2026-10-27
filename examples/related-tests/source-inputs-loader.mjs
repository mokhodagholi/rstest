import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// The demo's TypeScript build writes file-based source maps beside its output.
// Registering those inputs leaves the executed JavaScript unchanged.
export default function sourceInputsLoader(code) {
  const { buildInputs = [] } = this.getOptions();
  const mapFile = `${this.resourcePath}.map`;
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  this.addDependency(mapFile);
  for (const input of map.sources) {
    this.addDependency(resolve(dirname(mapFile), map.sourceRoot ?? '', input));
  }
  for (const input of buildInputs) {
    this.addDependency(resolve(this.rootContext, input));
  }
  return code;
}
