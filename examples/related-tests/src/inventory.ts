export const canReserve = (available: number, requested: number) =>
  requested > 0 && requested <= available;
