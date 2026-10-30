import { taxBasisPoints } from '../../policies/tax.mjs';

export const taxFor = (subtotal) =>
  Math.round((subtotal * taxBasisPoints) / 10_000);
