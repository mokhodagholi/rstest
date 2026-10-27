import { expect, it } from '@rstest/core';
import { loyaltyDiscount } from '../src/loyalty';
import { paymentFee } from '../src/payment';

it('quotes the configured payment provider fee', async () => {
  expect(await paymentFee(10_000)).toBe(320);
});

it('applies the current loyalty policy', () => {
  expect(loyaltyDiscount(10_000)).toBe(500);
});
