import { readFileSync } from 'node:fs';

export function loyaltyDiscount(total: number): number {
  const policy = JSON.parse(readFileSync('config/loyalty.json', 'utf8'));
  return Math.floor((total * policy.discountBasisPoints) / 10_000);
}
