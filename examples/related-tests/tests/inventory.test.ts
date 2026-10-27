import { expect, it } from '@rstest/core';
import { canReserve } from '../src/inventory';

it('reserves only positive quantities that are in stock', () => {
  expect(canReserve(8, 3)).toBe(true);
  expect(canReserve(8, 9)).toBe(false);
  expect(canReserve(8, 0)).toBe(false);
});
