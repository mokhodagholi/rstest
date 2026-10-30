import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from '@rstest/core';

const designPlugin = process.env.DESIGN_PLUGIN_PATH
  ? (await import(pathToFileURL(process.env.DESIGN_PLUGIN_PATH).href)).default()
  : undefined;

export default defineConfig({
  include: ['tests/**/*.test.ts'],
  plugins: designPlugin ? [designPlugin] : [],
  resolve: {
    alias: {
      '@shop/catalog/price$': fileURLToPath(
        new URL('./packages/catalog/src/price.mjs', import.meta.url),
      ),
    },
  },
  reporters: process.env.DESIGN_REPORT
    ? [['json', { outputPath: process.env.DESIGN_REPORT }]]
    : ['default'],
});
