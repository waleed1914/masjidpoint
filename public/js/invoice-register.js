// One browser-side register over listing invoices and mosque-shop invoices.
(function (root) {
  const TYPES = {
    job: { key: 'job', label: 'Job listing', badge: 'type-job' },
    advertising: { key: 'advertising', label: 'Business advertising', badge: 'type-advertising' },
    mixed: { key: 'mixed', label: 'Listings', badge: 'type-mixed' },
    shop: { key: 'shop', label: 'Mosque shop', badge: 'type-shop' }
  };
  const STATUSES = {
    paid: { key: 'paid', label: 'Paid', badge: 'approved' },
    due: { key: 'due', label: 'Awaiting payment', badge: 'pending' },
    review: { key: 'review', label: 'Payment evidence under review', badge: 'review' },
    overdue: { key: 'overdue', label: 'Overdue', badge: 'rejected' },
    cancelled: { key: 'cancelled', label: 'Cancelled', badge: 'cancelled' },
    refunded: { key: 'refunded', label: 'Refunded', badge: 'refunded' }
  };
  const round = number => Number(Number(number || 0).toFixed(2));
  const today = () => new Date().toISOString().slice(0, 10);

  function statusOf({ amount, paid, due, status, evidenced }) {
    if (status === 'cancelled') return STATUSES.cancelled;
    if (status === 'refunded') return STATUSES.refunded;
    if (Number(paid) >= Number(amount)) return STATUSES.paid;
    if (evidenced) return STATUSES.review;
    return due && due < today() ? STATUSES.overdue : STATUSES.due;
  }

  function typeOfLines(lines) {
    const kinds = [...new Set((lines || []).map(line => line.kind).filter(Boolean))];
    if (kinds.length > 1) return TYPES.mixed;
    return TYPES[kinds[0]] || TYPES.mixed;
  }

  function fromBusiness(db) {
    return (db.masjidPointFinance?.accounts || []).flatMap(account =>
      (account.invoices || []).map(invoice => {
        const lines = invoice.lines || [];
        const mosques = [...new Set(lines.map(line => line.masjid).filter(Boolean))];
        const amount = round(invoice.amount);
        const paid = round(invoice.paid);
        return {
          source: 'business', id: invoice.number, number: invoice.number,
          type: typeOfLines(lines), payerName: account.name, payerDetail: account.code,
          payerCode: account.code, covers: lines.length ? `${lines.length} service line(s)` : 'Platform service',
          mosques, issued: invoice.date, sortAt: invoice.date || '', due: invoice.due,
          dueLabel: invoice.due, amount, paid, outstanding: round(Math.max(0, amount - paid)),
          mosqueShare: round(lines.reduce((sum, line) =>
            sum + Number(line.amount || 0) * Number(line.mosquePercent ?? 70) / 100, 0)),
          status: statusOf({
            amount, paid, due: invoice.due, status: invoice.status,
            evidenced: (db.masjidPointPaymentProofs || []).some(proof =>
              proof.invoice === invoice.number && (!proof.businessCode || proof.businessCode === account.code)
                && proof.status === 'submitted')
          }),
          route: null,
          viewHref: `admin-invoice-view?code=${encodeURIComponent(account.code)}&invoice=${encodeURIComponent(invoice.number)}`,
          pdfHref: `/api/finance/invoice.pdf?code=${encodeURIComponent(account.code)}&invoice=${encodeURIComponent(invoice.number)}`,
          account, invoice
        };
      })
    );
  }

  function fromShop(db) {
    return (db.masjidPointShopOrders || []).filter(order => order.invoiceNumber).map(order => {
      const method = root.ShopFulfilment.methodOf(order);
      const amount = round(order.total);
      const paid = order.paymentStatus === 'paid' ? amount : 0;
      const issued = String(order.placedAt || '').slice(0, 10);
      const due = method.paysUpfront ? issued : null;
      return {
        source: 'shop', id: order.id, number: order.invoiceNumber, type: TYPES.shop,
        payerName: order.customer?.name || 'Customer', payerDetail: order.customer?.email || '', payerCode: '',
        covers: `${(order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item(s)`,
        mosques: [order.collectionMasjidName].filter(Boolean), issued,
        sortAt: String(order.placedAt || issued), due, dueLabel: method.paysUpfront ? issued : 'On collection',
        amount, paid, outstanding: round(Math.max(0, amount - paid)), mosqueShare: round(order.mosqueRevenue),
        status: statusOf({
          amount, paid, due, status: order.invoiceStatus,
          evidenced: (db.masjidPointPaymentProofs || []).some(proof =>
            proof.orderId === order.id && proof.status === 'submitted')
        }),
        route: method, viewHref: `admin-invoice-view?order=${encodeURIComponent(order.id)}`,
        pdfHref: `/api/shop/invoice.pdf?order=${encodeURIComponent(order.id)}`, order
      };
    });
  }

  const build = db => [...fromBusiness(db), ...fromShop(db)]
    .sort((left, right) => String(right.sortAt || '').localeCompare(String(left.sortAt || '')));
  const totals = entries => ({
    invoiced: round(entries.reduce((sum, entry) => sum + entry.amount, 0)),
    paid: round(entries.reduce((sum, entry) => sum + entry.paid, 0)),
    outstanding: round(entries.filter(entry => !['cancelled', 'refunded'].includes(entry.status.key))
      .reduce((sum, entry) => sum + entry.outstanding, 0)),
    overdue: round(entries.filter(entry => entry.status.key === 'overdue')
      .reduce((sum, entry) => sum + entry.outstanding, 0)),
    overdueCount: entries.filter(entry => entry.status.key === 'overdue').length,
    mosqueShare: round(entries.reduce((sum, entry) => sum + entry.mosqueShare, 0))
  });
  const CSV_HEADERS = ['Invoice', 'Type', 'Billed to', 'Reference', 'Covers', 'Mosque', 'Issued', 'Due', 'Amount', 'Paid', 'Outstanding', 'Mosque share', 'Status', 'Payment route'];
  const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const toCsv = entries => [CSV_HEADERS.join(',')].concat(entries.map(entry => [
    entry.number, entry.type.label, entry.payerName, entry.payerCode || entry.payerDetail, entry.covers,
    entry.mosques.join('; '), entry.issued, entry.dueLabel, entry.amount.toFixed(2), entry.paid.toFixed(2),
    entry.outstanding.toFixed(2), entry.mosqueShare.toFixed(2), entry.status.label,
    entry.route ? entry.route.label : 'Listing charge'
  ].map(cell).join(','))).join('\r\n');

  root.InvoiceRegister = { TYPES, STATUSES, build, totals, statusOf, toCsv };
})(typeof globalThis !== 'undefined' ? globalThis : this);
