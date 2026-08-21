// Canonical admin order renderer. Legacy live orders can be missing fields introduced by newer
// checkout versions. One incomplete order must never blank the whole fulfilment queue.
(async function () {
  const host = document.querySelector('#admin-order-list');
  const search = document.querySelector('#order-search');
  const count = document.querySelector('#order-count');
  if (!host || !search || !count) return;

  // local-db.js injects this renderer dynamically. On slower production connections it can
  // arrive before the page's shared fulfilment helper, so wait instead of silently exiting.
  for (let attempt = 0; attempt < 100 && (!window.MasjidDB || !window.ShopFulfilment); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!window.MasjidDB || !window.ShopFulfilment) {
    host.innerHTML = '<p class="admin-empty">Orders could not be loaded. Refresh the page to try again.</p>';
    return;
  }

  const state = await MasjidDB.state();
  const orders = Array.isArray(state.masjidPointShopOrders) ? state.masjidPointShopOrders : [];
  const products = Array.isArray(state.masjidPointProducts) ? state.masjidPointProducts : [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const money = value => `£${Number(value || 0).toFixed(2)}`;
  const labels = {
    preparing: 'Start preparing', ready_for_mosque: 'Ready for mosque collection',
    mosque_received: 'Confirm mosque received', dispatched: 'Mark dispatched',
    delivered: 'Confirm delivered to customer'
  };

  const imageFor = item => item?.image || products.find(product =>
    product.id === item?.productId || product.id === item?.id)?.image || 'assets/masjid-default.svg';
  const nextFor = order => {
    const next = ShopFulfilment.nextStatus(order);
    return next === 'delivered' && ShopFulfilment.methodOf(order).handledByMosque ? null : next;
  };

  function card(order) {
    const id = order.id || order.orderId || 'Order';
    const status = order.status || 'ordered';
    const paymentStatus = order.paymentStatus || 'awaiting_bank_transfer';
    const customer = order.customer || {};
    const customerName = customer.name || order.customerName || 'Customer';
    const customerEmail = customer.email || order.customerEmail || '';
    const customerPhone = customer.phone || order.customerPhone || '';
    const mosque = order.collectionMasjidName || order.masjid || 'Mosque';
    const placedAt = order.placedAt || order.createdAt || order.updatedAt || Date.now();
    const items = Array.isArray(order.items) ? order.items : [];
    const method = ShopFulfilment.methodOf(order);
    const address = ShopFulfilment.addressLines(order);
    const next = nextFor(order);
    return `<article class="shop-order-card" data-order-status="${esc(status)}" data-payment-status="${esc(paymentStatus)}">
      <header><div><strong>${esc(id)}</strong><small>${new Date(placedAt).toLocaleString('en-GB')} · ${esc(mosque)}</small></div><span>${esc(status.replaceAll('_', ' '))}</span></header>
      <div class="shop-order-customer"><b>${esc(customerName)}</b><span>${esc(customerEmail)}${customerPhone ? ` · ${esc(customerPhone)}` : ''}</span></div>
      <div class="shop-order-method"><span class="shop-method-badge ${esc(method.key)}">${esc(method.short)}</span>${address.length ? `<small>Deliver to ${esc(address.join(', '))}</small>` : ''}<a class="shop-invoice-link" href="/api/shop/invoice.pdf?order=${encodeURIComponent(id)}" target="_blank" rel="noopener">Invoice ${esc(order.invoiceNumber || id)} ↓</a></div>
      ${items.map(item => `<div class="shop-order-item"><img src="${esc(imageFor(item))}" alt=""><span><strong>${esc(item.name || 'Product')} × ${Number(item.quantity || 1)}</strong><small>${esc(item.description || '')}</small></span><b>${money(Number(item.price || 0) * Number(item.quantity || 1))}</b></div>`).join('')}
      ${Number(order.deliveryFee) > 0 ? `<div class="shop-order-item shop-order-fee"><span><strong>Delivery</strong></span><b>${money(order.deliveryFee)}</b></div>` : ''}
      <footer><strong>Total ${money(order.total)}</strong>${next ? `<button class="button" data-order-next="${esc(id)}">${labels[next] || 'Advance order'}</button>` : status === 'mosque_received' ? '<span>Waiting for mosque handover</span>' : '<span>Delivered</span>'}</footer>
    </article>`;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = [...orders].reverse().filter(order => {
      const customer = order.customer || {};
      return !query || `${order.id || order.orderId || ''} ${customer.name || order.customerName || ''} ${order.collectionMasjidName || order.masjid || ''}`.toLowerCase().includes(query);
    });
    count.textContent = orders.filter(order => !['delivered', 'cancelled'].includes(order.status)).length;
    host.innerHTML = visible.length ? visible.map(card).join('') : '<p class="admin-empty">No orders yet.</p>';
  }

  search.addEventListener('input', render);
  render();
})();
