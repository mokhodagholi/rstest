import { expect, it } from '@rstest/core';
import { checkout } from '../src/shipping/checkout.mjs';

it('adds the native ESM shipping provider fee', async () => {
  expect(await checkout(2400, 'standard')).toBe(2900);
});
