import { expect, it } from '@rstest/core';

const shippingQuote = (method: string, subtotal: number) =>
  require(`../src/shipping/${method}.cjs`).shippingCost(subtotal);

const shippingManifest = (method: string) =>
  require.resolve(`../src/shipping/manifests/${method}.json`);

it('supports a CommonJS shipping integration', () => {
  expect(shippingQuote('standard', 2400)).toBe(500);
  expect(shippingQuote('standard', 5000)).toBe(0);
});

it('resolves shipping-provider metadata', () => {
  expect(shippingManifest('standard')).toMatch(/standard\.json$/);
});
