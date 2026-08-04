(async function () {
  const p = new URLSearchParams(location.search);
  const state = await MasjidDB.state();
  const sheet = document.querySelector('#invoice-sheet');
  const money = n => `£${Number(n || 0).toFixed(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const back = document.querySelector('#invoice-back');
  if (p.get('reference')) {
    const returnPage = p.get('return') === 'masjid' ? 'admin-masjid-view' : 'admin-business-view';
    back.href = `${returnPage}?reference=${encodeURIComponent(p.get('reference'))}`;
  } else {
    back.href = 'admin-invoices';
    back.textContent = '← Back to invoices';
  }

  const head = (entry, extra) => `<header class="invoice-head">
      <div><small>${esc(entry.type.label)}</small><h2>${esc(entry.number)}</h2></div>
      <div class="invoice-head-badges"><span class="type-badge ${entry.type.badge}">${esc(entry.type.label)}</span><span class="status-badge ${entry.status.badge}">${esc(entry.status.label)}</span></div>
    </header>
    <section class="invoice-meta">${extra}</section>`;

  const foot = entry => `<footer class="invoice-total">
      <div class="invoice-total-lines">
        <span><small>Paid</small><b>${money(entry.paid)}</b></span>
        <span><small>Outstanding</small><b>${money(entry.outstanding)}</b></span>
        <span><small>Mosque share</small><b>${money(entry.mosqueShare)}</b></span>
      </div>
      <strong>Total: ${money(entry.amount)}</strong>
    </footer>
    <div class="invoice-sheet-actions"><a class="button secondary" href="${esc(entry.pdfHref)}" target="_blank" rel="noopener">Download PDF ↓</a></div>`;

  // Mosque shop purchase: one order, billed to the customer.
  if (p.get('order')) {
    const entry = InvoiceRegister.build(state).find(item => item.source === 'shop' && item.id === p.get('order'));
    if (!entry) { sheet.innerHTML = '<div class="invoice-lines"><h2>Invoice not found</h2></div>'; return; }
    const order = entry.order, method = entry.route, address = ShopFulfilment.addressLines(order);
    sheet.innerHTML = head(entry, `
      <div><small>Customer</small><strong>${esc(order.customer?.name || 'Customer')}</strong></div>
      <div><small>Contact</small><strong>${esc(order.customer?.email || '—')}</strong></div>
      <div><small>Order</small><strong>${esc(order.id)}</strong></div>
      <div><small>Placed</small><strong>${esc(entry.issued || '—')}</strong></div>
      <div><small>Mosque</small><strong>${esc(order.collectionMasjidName || '—')}</strong></div>
      <div><small>How received</small><strong>${esc(method.label)}</strong></div>
      <div><small>Payment</small><strong>${esc(ShopFulfilment.paymentLabel(order))}</strong></div>
      <div><small>${method.paysUpfront ? 'Payment reference' : 'Collected by'}</small><strong>${esc(method.paysUpfront ? (order.paymentReference || '—') : (order.paymentVerifiedBy || 'Not yet collected'))}</strong></div>
      ${address.length ? `<div class="wide"><small>Delivery address</small><strong>${esc(address.join(', '))}</strong></div>` : ''}`)
      + `<section class="invoice-lines"><table><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Mosque share</th><th>Amount</th></tr></thead><tbody>
        ${(order.items || []).map(item => `<tr><td><strong>${esc(item.name)}</strong><span class="invoice-line-note">${esc(item.description || '')}</span></td><td>${Number(item.quantity || 0)}</td><td>${money(item.price)}</td><td>${money(item.mosqueRevenue)} (${Number(item.mosqueSharePercent || 0)}%)</td><td>${money(Number(item.price) * Number(item.quantity))}</td></tr>`).join('')}
        ${Number(order.deliveryFee) > 0 ? `<tr><td><strong>Delivery</strong><span class="invoice-line-note">Charged by ${esc(order.collectionMasjidName || 'the mosque')}</span></td><td>1</td><td>${money(order.deliveryFee)}</td><td>—</td><td>${money(order.deliveryFee)}</td></tr>` : ''}
      </tbody></table></section>`
      + (Number(order.mosqueOwesAdmin) > 0 ? `<p class="invoice-cash-note">Cash of ${money(order.cashTakenAtMosque)} was taken at the mosque. ${money(order.mosqueOwesAdmin)} of that is owed to MasjidPoint.</p>` : '')
      + foot(entry);
    return;
  }

  // Business listing invoice: jobs and adverts billed to a business account.
  const entry = InvoiceRegister.build(state).find(item => item.source === 'business'
    && item.number === p.get('invoice') && item.account.code === p.get('code'));
  if (!entry) { sheet.innerHTML = '<div class="invoice-lines"><h2>Invoice not found</h2></div>'; return; }
  const invoice = entry.invoice;
  sheet.innerHTML = head(entry, `
      <div><small>Business</small><strong>${esc(entry.account.name)}</strong></div>
      <div><small>Business code</small><strong>${esc(entry.account.code)}</strong></div>
      <div><small>Issued</small><strong>${esc(invoice.date)}</strong></div>
      <div><small>Due</small><strong>${esc(invoice.due)}</strong></div>`)
    + `<section class="invoice-lines"><table><thead><tr><th>Service</th><th>Mosque</th><th>Admin cut</th><th>Mosque share</th><th>Amount</th></tr></thead><tbody>
      ${(invoice.lines || []).map(line => {
        const admin = Number(line.amount) * Number(line.adminPercent ?? 30) / 100;
        const share = Number(line.amount) * Number(line.mosquePercent ?? 70) / 100;
        const kind = InvoiceRegister.TYPES[line.kind] || InvoiceRegister.TYPES.mixed;
        return `<tr><td><span class="type-badge ${kind.badge}">${esc(kind.label)}</span><span class="invoice-line-note">${esc(line.description)}</span></td><td>${esc(line.masjid)}</td><td>${money(admin)} (${Number(line.adminPercent ?? 30)}%)</td><td>${money(share)} (${Number(line.mosquePercent ?? 70)}%)</td><td>${money(line.amount)}</td></tr>`;
      }).join('') || '<tr><td colspan="5">No service lines on this invoice.</td></tr>'}
    </tbody></table></section>`
    + foot(entry);
})();
