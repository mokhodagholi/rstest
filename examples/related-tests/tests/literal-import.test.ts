import { expect, it } from '@rstest/core';

it('loads stock checks on demand through a literal import', async () => {
  const { canReserve } = await import('../src/inventory');
  expect(canReserve(8, 3)).toBe(true);
});
