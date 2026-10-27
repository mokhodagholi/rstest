export const subtotal = (items: { unitPrice: number; quantity: number }[]) =>
  items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
