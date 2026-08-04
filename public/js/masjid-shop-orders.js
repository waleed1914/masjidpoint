// The mosque's own view of shop orders placed through its shop. Delivery orders are shipped
// by admin and never reach the mosque, but the mosque still sees who bought what and how they
// paid, because the mosque earns its share on those orders too.
(async function () {
  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (session?.role !== 'masjid') return;
  const state = await MasjidDB.state();
  const app = (state.masjidPointAdminApplications || []).find(x => x.reference === session.reference);
  const orders = state.masjidPointShopOrders || [];
  if (!app) return;

  const mine = orders.filter(o => o.collectionMasjidReference === app.reference || o.collectionMasjidName === app.name);

  // Orders no longer carry a copy of the product picture, so it is resolved from the product.
  const imageFor = productId => (state.masjidPointProducts || []).find(p => p.id === productId)?.image || '';

  // A mosque only sees an order once the money is accounted for. Orders paid up front by bank
  // transfer stay hidden until an administrator has verified the transfer, so nothing can be
  // prepared or handed over on the strength of a payment that never arrived. Pay-at-the-mosque
  // orders are the exception: there is no transfer for an administrator to verify because the
  // mosque takes the payment itself at the counter, so they appear straight away.
  const cleared = o => !ShopFulfilment.methodOf(o).paysUpfront || o.paymentStatus === 'paid';
  const own = mine.filter(cleared);
  const awaitingPayment = mine.length - own.length;
  const money = n => `£${Number(n || 0).toFixed(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function footerFor(order) {
    const method = ShopFulfilment.methodOf(order);
    if (!method.handledByMosque) {
      return order.status === 'delivered'
        ? '<b>Delivered by admin</b>'
        : '<small>Delivered directly by admin. No action needed from the mosque.</small>';
    }
    if (order.status === 'delivered') return '<b>Handed to customer</b>';
    if (order.status !== 'mosque_received') return '<small>Admin is preparing or transferring this order.</small>';
    return method.paysUpfront
      ? `<button class="button" data-deliver-order="${order.id}">Mark handed to customer</button>`
      : `<button class="button" data-collect-order="${order.id}">Take ${money(order.total)} and hand over</button>`;
  }

  const cashOrders = own.filter(o => Number(o.mosqueOwesAdmin) > 0);
  const owedToAdmin = Number(cashOrders.reduce((sum, o) => sum + Number(o.mosqueOwesAdmin || 0), 0).toFixed(2));
  const cashPending = own.filter(o => o.paymentStatus === 'pay_at_mosque' && o.status !== 'delivered');

  const section = document.createElement('section');
  section.className = 'request-panel mosque-shop-orders';
  section.id = 'shop-orders';
  section.innerHTML = `<header><div><h2>Shop orders</h2><p>Every order bought through your shop, including deliveries handled by admin. Hand over collection orders only after taking any payment due.</p></div><span>${own.filter(o => o.status !== 'delivered').length} active</span></header>
  ${owedToAdmin > 0 || cashPending.length ? `<div class="cash-owed-banner">
    <div><small>Cash taken at the mosque — owed to MasjidPoint</small><strong>${money(owedToAdmin)}</strong><span>From ${cashOrders.length} cash order(s) you have handed over.</span></div>
    ${cashPending.length ? `<div><small>Still to collect</small><strong>${money(cashPending.reduce((sum, o) => sum + Number(o.total || 0), 0))}</strong><span>${cashPending.length} cash order(s) not yet handed over.</span></div>` : ''}
  </div>` : ''}
  <div>${[...own].reverse().map(o => {
    const method = ShopFulfilment.methodOf(o);
    const address = ShopFulfilment.addressLines(o);
    return `<article class="mosque-order ${method.handledByMosque ? '' : 'admin-fulfilled'}">
      <header><div><strong>${esc(o.id)}</strong><small>${new Date(o.placedAt).toLocaleString('en-GB')}</small></div><span>${esc(String(o.status || '').replaceAll('_', ' '))}</span></header>
      <div class="mosque-order-customer"><strong>${esc(o.customer?.name || 'Customer')}</strong><span>${esc(o.customer?.email || '')}${o.customer?.phone ? ` · ${esc(o.customer.phone)}` : ''}</span></div>
      <div class="mosque-order-method"><span class="shop-method-badge ${method.key}">${esc(method.short)}</span><small>${esc(ShopFulfilment.paymentLabel(o))}</small>${address.length ? `<small class="mosque-order-address">Delivered to ${esc(address.join(', '))}</small>` : ''}<a class="shop-invoice-link" href="/api/shop/invoice.pdf?order=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">Invoice ${esc(o.invoiceNumber || o.id)} ↓</a></div>
      ${(o.items || []).map(i => `<div class="mosque-order-item"><img src="${esc(i.image || imageFor(i.productId))}" alt="" onerror="this.hidden=true"><span><strong>${esc(i.name)} × ${i.quantity}</strong><small>${esc(i.description)}</small></span><b>${money(i.price * i.quantity)}</b></div>`).join('')}
      ${Number(o.deliveryFee) > 0 ? `<div class="mosque-order-item mosque-order-fee"><span><strong>Delivery</strong></span><b>${money(o.deliveryFee)}</b></div>` : ''}
      <footer><span>Mosque revenue <strong>${money(o.mosqueRevenue)}</strong>${Number(o.mosqueOwesAdmin) > 0 ? `<small class="order-owed">Cash taken ${money(o.cashTakenAtMosque)} · ${money(o.mosqueOwesAdmin)} owed to MasjidPoint</small>` : ''}</span>${footerFor(o)}</footer>
    </article>`;
  }).join('') || (awaitingPayment
    ? `<p class="portal-empty">Nothing to prepare yet. ${awaitingPayment} order${awaitingPayment === 1 ? '' : 's'} awaiting payment verification by MasjidPoint — they appear here once the payment is confirmed.</p>`
    : '<p class="portal-empty">No shop orders for this mosque yet.</p>')}</div>`;
  document.querySelector('.portal-content').append(section);

  // The sidebar is rendered once by portal-nav.js and already links to this section.

  // On a cash order the mosque takes the whole total at the counter but only keeps its own
  // share, so the rest becomes owed to MasjidPoint. Spell that out before it accepts the cash.
  const adminShareOf = order => Number((Number(order.total || 0) - Number(order.mosqueRevenue || 0)).toFixed(2));

  function confirmCash(order) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'job-review-modal cash-handover-modal';
      modal.innerHTML = `<div>
        <header><h2>Take cash and hand over</h2><button type="button" data-cash-close>×</button></header>
        <div class="cash-handover-body">
          <p>You are handing <strong>${esc(order.id)}</strong> to <strong>${esc(order.customer?.name || 'the customer')}</strong>.</p>
          <div class="cash-breakdown">
            <div class="cash-take"><small>Cash to take from the customer</small><strong>${money(order.total)}</strong></div>
            <div><small>Your mosque keeps</small><strong>${money(order.mosqueRevenue)}</strong></div>
            <div class="cash-owed"><small>You owe MasjidPoint</small><strong>${money(adminShareOf(order))}</strong></div>
          </div>
          <p class="cash-note">Confirming records the payment against this order and adds ${money(adminShareOf(order))} to what your mosque owes MasjidPoint from cash sales.</p>
        </div>
        <footer class="cash-handover-actions"><button type="button" data-cash-cancel>Cancel</button><button class="button" type="button" data-cash-confirm>Take ${money(order.total)} and hand over</button></footer>
      </div>`;
      document.body.appendChild(modal);
      const close = answer => { modal.remove(); resolve(answer); };
      modal.querySelector('[data-cash-close]').onclick = () => close(false);
      modal.querySelector('[data-cash-cancel]').onclick = () => close(false);
      modal.querySelector('[data-cash-confirm]').onclick = () => close(true);
      modal.onclick = event => { if (event.target === modal) close(false); };
    });
  }

  async function handOver(id, takePayment) {
    const order = orders.find(x => x.id === id);
    const agreed = takePayment
      ? await confirmCash(order)
      : confirm(`Confirm ${order.id} was handed to ${order.customer?.name}?`);
    if (!agreed) return;
    const at = new Date().toISOString();
    order.status = 'delivered';
    order.deliveredAt = at;
    order.history ||= [];
    if (takePayment) {
      order.paymentStatus = 'paid';
      order.paidAt = at;
      order.paymentVerifiedBy = `masjid:${app.reference}`;
      order.cashTakenAtMosque = Number(order.total || 0);
      order.mosqueOwesAdmin = adminShareOf(order);
      order.history.push({ status: 'payment_taken_at_mosque', at, by: `masjid:${app.reference}`, amount: order.cashTakenAtMosque, owed: order.mosqueOwesAdmin });
    }
    order.history.push({ status: 'delivered', at, by: `masjid:${app.reference}` });
    await MasjidDB.save('masjidPointShopOrders', orders);
    location.reload();
  }

  section.querySelectorAll('[data-deliver-order]').forEach(button => button.onclick = () => handOver(button.dataset.deliverOrder, false));
  section.querySelectorAll('[data-collect-order]').forEach(button => button.onclick = () => handOver(button.dataset.collectOrder, true));
})();
