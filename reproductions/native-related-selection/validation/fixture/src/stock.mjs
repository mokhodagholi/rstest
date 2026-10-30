export const canReserve = (available, quantity) =>
  quantity > 0 && available >= quantity;
