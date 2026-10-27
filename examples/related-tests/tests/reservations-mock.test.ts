import { expect, it, rs } from '@rstest/core';
import { canReserve } from '../src/reservations';

rs.mock('../src/reservations', () => ({ canReserve: () => true }));

it('can mock stock reservation independently of other consumers', () => {
  expect(canReserve(0, 3)).toBe(true);
});
