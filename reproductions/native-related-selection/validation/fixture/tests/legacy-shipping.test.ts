import { expect, it } from '@rstest/core';

const shippingQuote = (method: string, subtotal: number) =>
  require(`../src/shipping/legacy/${method}.cjs`).quote(subtotal);

it('loads a native CommonJS shipping integration', () => {
  expect(shippingQuote('standard', 2400)).toBe(500);
});
