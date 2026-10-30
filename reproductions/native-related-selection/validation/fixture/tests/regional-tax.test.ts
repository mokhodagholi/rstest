import { expect, it } from '@rstest/core';
import { regionalTax } from '../src/taxes/quote.mjs';

it('uses the selected native regional tax policy', async () => {
  expect(await regionalTax(2400, 'domestic')).toBe(240);
});
