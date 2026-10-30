const { standardShippingFee } = require('../../policies/legacy-shipping.cjs');

exports.quote = (subtotal) => (subtotal >= 5000 ? 0 : standardShippingFee);
