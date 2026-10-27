const prices: Record<string, number> = { coffee: 1200, tea: 900 };

export function priceFor(sku: string, quantity: number): number {
  if (!(sku in prices)) throw new Error(`Unknown product: ${sku}`);
  return prices[sku]! * quantity;
}
