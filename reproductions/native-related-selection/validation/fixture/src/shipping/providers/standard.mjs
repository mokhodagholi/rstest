import { standardShippingFee } from '../../policies/shipping.mjs';

export const quote = (subtotal) => (subtotal >= 5000 ? 0 : standardShippingFee);
