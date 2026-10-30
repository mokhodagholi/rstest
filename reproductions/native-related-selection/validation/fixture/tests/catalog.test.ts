import { expect, it } from '@rstest/core';
import { coffeePrice } from '@shop/catalog/price';

it('uses source prices through the configured package alias', () => {
  expect(coffeePrice).toBe(1200);
});
