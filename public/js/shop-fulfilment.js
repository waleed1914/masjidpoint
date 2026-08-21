// Shared definitions for the public shop, admin fulfilment desk and mosque portal.
(function (root) {
  const METHODS = {
    collect_pay_now: {
      key: 'collect_pay_now',
      setting: 'collectPayNow',
      label: 'Pay now, collect from mosque',
      short: 'Pay now - collect',
      customerNote: 'Pay by bank transfer now and collect from the mosque once it is ready.',
      paysUpfront: true,
      needsAddress: false,
      handledByMosque: true,
      statuses: ['ordered', 'preparing', 'ready_for_mosque', 'mosque_received', 'delivered']
    },
    collect_pay_at_mosque: {
      key: 'collect_pay_at_mosque',
      setting: 'collectPayAtMosque',
      label: 'Pay at the mosque on collection',
      short: 'Pay at mosque',
      customerNote: 'Nothing to pay now. Pay the mosque when you collect your order.',
      paysUpfront: false,
      needsAddress: false,
      handledByMosque: true,
      statuses: ['ordered', 'preparing', 'ready_for_mosque', 'mosque_received', 'delivered']
    },
    delivery: {
      key: 'delivery',
      setting: 'delivery',
      label: 'Pay now and have it delivered',
      short: 'Delivery',
      customerNote: 'Pay by bank transfer now. We deliver straight to your address.',
      paysUpfront: true,
      needsAddress: true,
      handledByMosque: false,
      statuses: ['ordered', 'preparing', 'dispatched', 'delivered']
    }
  };

  const ORDER = ['collect_pay_now', 'collect_pay_at_mosque', 'delivery'];
  const DEFAULT_SETTINGS = { collectPayNow: true, collectPayAtMosque: true, delivery: false };

  function methodOf(order) {
    if (order?.fulfilmentMethod && METHODS[order.fulfilmentMethod]) return METHODS[order.fulfilmentMethod];
    const paid = ['awaiting_bank_transfer', 'submitted', 'paid', 'rejected'].includes(order?.paymentStatus);
    return paid ? METHODS.collect_pay_now : METHODS.collect_pay_at_mosque;
  }

  function settingsOf(rate) {
    const stored = rate?.shopFulfilment || {};
    return {
      collectPayNow: stored.collectPayNow !== false,
      collectPayAtMosque: stored.collectPayAtMosque !== false,
      delivery: stored.delivery === true
    };
  }

  const enabledFor = rate => {
    const settings = settingsOf(rate);
    return ORDER.filter(key => settings[METHODS[key].setting]).map(key => METHODS[key]);
  };
  const deliveryFeeOf = rate => Math.max(0, Number(rate?.shopDeliveryFee) || 0);

  function nextStatus(order) {
    const chain = methodOf(order).statuses;
    const at = chain.indexOf(order?.status);
    return at === -1 || at === chain.length - 1 ? null : chain[at + 1];
  }

  const paymentLabel = order => ({
    pay_at_mosque: 'Payable at the mosque',
    awaiting_bank_transfer: 'Awaiting bank transfer',
    submitted: 'Evidence submitted',
    paid: 'Payment verified',
    rejected: 'Evidence rejected'
  })[order?.paymentStatus] || String(order?.paymentStatus || 'Awaiting payment').replaceAll('_', ' ');

  const addressLines = order => [
    order?.deliveryAddress?.line1,
    order?.deliveryAddress?.line2,
    order?.deliveryAddress?.city,
    order?.deliveryAddress?.postcode
  ].map(part => String(part || '').trim()).filter(Boolean);

  root.ShopFulfilment = {
    METHODS, ORDER, DEFAULT_SETTINGS, methodOf, settingsOf, enabledFor,
    deliveryFeeOf, nextStatus, paymentLabel, addressLines
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
