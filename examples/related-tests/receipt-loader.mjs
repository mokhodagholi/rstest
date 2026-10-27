import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Template inputs are tracked through the same loader APIs used by Rspack watch mode.
export default function receiptLoader(source) {
  const directory = dirname(this.resourcePath);
  const footer = join(directory, 'footer.txt');
  const promotions = join(directory, 'promotions');
  const branding = join(directory, 'branding.txt');

  this.addDependency(footer);
  this.addContextDependency(promotions);
  if (existsSync(branding)) {
    this.addDependency(branding);
  } else {
    this.addMissingDependency(branding);
  }

  const template = [
    source.trim(),
    ...readdirSync(promotions)
      .sort()
      .map((file) => readFileSync(join(promotions, file), 'utf8').trim()),
    readFileSync(footer, 'utf8').trim(),
    existsSync(branding)
      ? readFileSync(branding, 'utf8').trim()
      : 'Market Square',
  ].join('\n');

  return `export default ${JSON.stringify(template)};`;
}
