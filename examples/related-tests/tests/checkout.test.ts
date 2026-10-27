import { expect, it } from '@rstest/core';
import { checkout } from '../src/checkout';

it('waives standard shipping for orders over the threshold', async () => {
  expect(
    await checkout([{ unitPrice: 2500, quantity: 2 }], 'standard'),
  ).toEqual({ itemsTotal: 5000, total: 5000 });
});

it('charges the selected shipping rate for a small order', async () => {
  const items = [{ unitPrice: 1200, quantity: 2 }];
  expect(await checkout(items, 'standard')).toEqual({
    itemsTotal: 2400,
    total: 2900,
  });
  expect(await checkout(items, 'express')).toEqual({
    itemsTotal: 2400,
    total: 3900,
  });
});
