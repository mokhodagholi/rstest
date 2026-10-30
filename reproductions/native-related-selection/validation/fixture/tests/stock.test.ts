import { expect, it } from '@rstest/core';
import { canReserve } from '../src/stock.mjs';

it('reserves positive quantities when stock is available', () => {
  expect(canReserve(12, 3)).toBe(true);
  expect(canReserve(12, 13)).toBe(false);
});
