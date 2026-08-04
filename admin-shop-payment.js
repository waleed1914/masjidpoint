// Payment strip on each admin shop order card. What it offers depends on how the customer
// chose to pay: bank transfers are verified here, while pay-at-mosque orders are settled by
// the mosque at handover and are only reported here.
(function () {
  const list = document.querySelector('#admin-order-list');
  if (!list) return;

  async function enhance() {
    const state = await MasjidDB.state(), orders = state.masjidPointShopOrders || [];
    list.querySelectorAll('.shop-order-card').forEach(card => {
      if (card.querySelector('.shop-payment-state')) return;
      const id = card.querySelector('header strong')?.textContent;
      const order = orders.find(x => x.id === id);
      if (!order) return;
      const method = ShopFulfilment.methodOf(order), paid = order.paymentStatus === 'paid';
      const box = document.createElement('div');
      box.className = `shop-payment-state ${order.paymentStatus}`;
      const evidence = order.paymentEvidence?.fileData
        ? `<a class="shop-proof-link" href="${order.paymentEvidence.fileData}" target="_blank" rel="noopener">View payment proof →</a>`
        : method.paysUpfront ? '<span class="shop-proof-missing"><small>Evidence</small><strong>Not submitted</strong></span>' : '';
      const action = paid
        ? '<b>✓ Payment verified</b>'
        : method.paysUpfront
          ? `<button type="button" data-shop-payment="${order.id}">Verify payment received</button>`
          : '<b class="shop-payment-at-mosque">Mosque collects on handover</b>';
      box.innerHTML = `<span><small>${method.paysUpfront ? 'Bank payment' : 'Payment'}</small><strong>${ShopFulfilment.paymentLabel(order)}</strong></span>`
        + `<span><small>${method.paysUpfront ? 'Required reference' : 'Amount due'}</small><strong>${method.paysUpfront ? (order.paymentReference || order.id) : `£${Number(order.total || 0).toFixed(2)}`}</strong></span>`
        + evidence + action;
      card.querySelector('.shop-order-customer').after(box);
      // Only hold back fulfilment for orders that should already have been paid for.
      const next = card.querySelector('[data-order-next]');
      if (next && method.paysUpfront && !paid) {
        next.disabled = true;
        next.title = 'Verify the bank payment before fulfilment';
      }
    });

    list.querySelectorAll('[data-shop-payment]').forEach(button => button.onclick = async () => {
      const current = await MasjidDB.state(), items = current.masjidPointShopOrders || [];
      const order = items.find(x => x.id === button.dataset.shopPayment);
      if (!confirm(`Confirm bank transfer ${order.paymentReference || order.id} for £${Number(order.total).toFixed(2)} was received?`)) return;
      order.paymentStatus = 'paid';
      order.paidAt = new Date().toISOString();
      order.paymentVerifiedBy = JSON.parse(sessionStorage.getItem('masjidPointAdminSession') || 'null')?.name || 'Admin';
      order.history ||= [];
      order.history.push({ status: 'payment_verified', at: order.paidAt, by: order.paymentVerifiedBy });
      await MasjidDB.save('masjidPointShopOrders', items);
      location.reload();
    });
  }

  new MutationObserver(() => enhance()).observe(list, { childList: true });
  enhance();
})();
