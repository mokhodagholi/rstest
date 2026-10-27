import { expect, it } from '@rstest/core';
import { priceFor } from '../packages/catalog/dist/price.js';

it('quotes catalog prices in integer cents', () => {
  expect(priceFor('coffee', 2)).toBe(2400);
  expect(priceFor('tea', 3)).toBe(2700);
});
