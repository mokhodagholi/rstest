export async function checkout(subtotal, method) {
  const provider = await import(`./providers/${method}.mjs`);
  return subtotal + provider.quote(subtotal);
}
