const stock: Record<string, number> = { coffee: 8, tea: 12 };

export function available(sku: string, quantity: number): boolean {
  return quantity > 0 && quantity <= (stock[sku] ?? 0);
}
