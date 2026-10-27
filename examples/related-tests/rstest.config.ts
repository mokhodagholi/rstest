import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const mode = process.env.CHECKOUT_DEMO_MODE;
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  include: ['tests/**/*.test.ts'],
  forceRerunTriggers: [
    'config/checkout.json',
    ...(mode === 'compiled-trigger' ? ['packages/catalog/src/**'] : []),
    ...(mode === 'runtime-trigger'
      ? ['runtime/**', 'config/loyalty.json']
      : []),
  ],
  ...(mode === 'source-alias'
    ? {
        resolve: {
          alias: {
            '../packages/catalog/dist/price.js$': source(
              './packages/catalog/src/price.ts',
            ),
            '../packages/catalog/dist/availability.js$': source(
              './packages/catalog/src/availability.ts',
            ),
          },
        },
      }
    : {}),
  ...(process.env.CHECKOUT_DEMO_REPORT
    ? {
        reporters: [['json', { outputPath: process.env.CHECKOUT_DEMO_REPORT }]],
      }
    : {}),
  tools: {
    rspack: {
      ...(mode === 'bail' ? { bail: true } : {}),
      module: {
        ...(mode === 'parser-contexts'
          ? {
              parser: {
                javascript: {
                  importDynamic: true,
                  requireDynamic: true,
                  requireResolve: true,
                },
              },
            }
          : {}),
        rules: [
          ...(mode === 'source-map-inputs'
            ? [
                {
                  test: /[\\/]catalog[\\/]dist[\\/].*\.js$/,
                  enforce: 'pre' as const,
                  use: [
                    {
                      loader: source('./source-inputs-loader.mjs'),
                      options: {
                        buildInputs: ['packages/catalog/tsconfig.json'],
                      },
                    },
                  ],
                },
              ]
            : []),
          {
            test: /\.receipt$/,
            type: 'javascript/auto',
            use: [
              fileURLToPath(new URL('./receipt-loader.mjs', import.meta.url)),
            ],
          },
        ],
      },
    },
  },
});
