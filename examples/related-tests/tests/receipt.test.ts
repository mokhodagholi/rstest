import { expect, it } from '@rstest/core';
import { renderReceipt } from '../src/receipt';

it('renders the order, promotion, and store footer', () => {
  expect(renderReceipt('ORDER-1042', 2900)).toBe(
    [
      'Order ORDER-1042: $29.00',
      'Free standard shipping on orders of $50 or more.',
      'Thank you for shopping with us.',
      'Market Square',
    ].join('\n'),
  );
});
