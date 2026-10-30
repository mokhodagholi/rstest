export async function regionalTax(subtotal, region) {
  const policy = await import(`./regions/${region}.mjs`);
  return policy.taxFor(subtotal);
}
