import template from './templates/order.receipt';

export const renderReceipt = (orderId: string, total: number) =>
  template
    .replace('{{orderId}}', orderId)
    .replace('{{total}}', (total / 100).toFixed(2));
