import { subtotal } from './pricing';

export async function checkout(
  items: { unitPrice: number; quantity: number }[],
  shippingMethod: 'standard' | 'express',
) {
  // Prices are integer cents. Providers are loaded only when the customer chooses one.
  const { shippingCost } = await import(`./shipping/${shippingMethod}.mjs`);
  const itemsTotal = subtotal(items);
  return { itemsTotal, total: itemsTotal + shippingCost(itemsTotal) };
}
