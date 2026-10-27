import { expect, it } from '@rstest/core';
import { available } from '../packages/catalog/dist/availability.js';

it('checks catalog stock independently of pricing', () => {
  expect(available('coffee', 8)).toBe(true);
  expect(available('coffee', 9)).toBe(false);
});
