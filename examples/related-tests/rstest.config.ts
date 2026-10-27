import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['tests/**/*.test.ts'],
  forceRerunTriggers: ['config/checkout.json'],
  tools: {
    rspack: {
      module: {
        rules: [
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
