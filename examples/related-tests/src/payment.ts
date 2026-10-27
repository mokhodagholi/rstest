import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function paymentFee(total: number): Promise<number> {
  const provider = process.env.CHECKOUT_PAYMENT_PROVIDER ?? 'runtime/card.mjs';
  const providerUrl = pathToFileURL(resolve(provider)).href;
  const { fee } = await import(providerUrl);
  return fee(total);
}
