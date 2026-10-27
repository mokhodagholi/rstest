import { expect, it } from '@rstest/core';
import { canReserve } from '../src/reservations';
import * as reservations from '../src/reservations';

it('supports named imports from a barrel', () => {
  expect(canReserve(8, 3)).toBe(true);
});

it('supports namespace imports from a barrel', () => {
  expect(reservations.reservationLimit).toBe(10);
});
