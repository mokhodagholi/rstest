import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { checkout } from '../src/shipping/checkout.mjs';
import { regionalTax } from '../src/taxes/quote.mjs';
import { coffeePrice } from '@shop/catalog/price';

const require = createRequire(
  new URL('../tests/native-control.cjs', import.meta.url),
);
const method = 'standard';
const esmTotal = await checkout(2400, method);
const commonjsFee = require(`../src/shipping/legacy/${method}.cjs`).quote(2400);
const manifestPath = require.resolve(`../src/shipping/manifests/${method}.cjs`);

assert.equal(esmTotal, 2900);
assert.equal(commonjsFee, 500);
assert.match(manifestPath, /[\\/]manifests[\\/]standard\.cjs$/);
assert.equal(coffeePrice, 900);
const tax = await regionalTax(2400, 'domestic');
assert.equal(tax, 240);
console.log(
  JSON.stringify({
    esmTotal,
    commonjsFee,
    manifestPath,
    compiledCoffeePrice: coffeePrice,
    tax,
  }),
);
