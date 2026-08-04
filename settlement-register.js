// Each mosque's money position, in both directions.
//
// MasjidPoint owes a mosque its share of paid job listings, paid adverts, and shop orders the
// customer paid by bank. A mosque owes MasjidPoint the platform's cut of any shop order it took
// in cash at the counter, because it already holds the whole amount.
//
// Shared by the payments page and the settle/remit endpoints so the figure an admin approves is
// the figure the server pays.
(function (root) {
  const round = n => Number(Number(n || 0).toFixed(2));

  const settledIds = finance => {
    const history = finance?.settlementHistory || [];
    return {
      jobs: new Set(history.filter(s => s.jobId).map(s => `${s.masjid}|${s.jobId}`)),
      requests: new Set(history.filter(s => s.requestId).map(s => `${s.masjid}|${s.requestId}`)),
      orders: new Set(history.filter(s => s.orderId).map(s => `${s.masjid}|${s.orderId}`))
    };
  };

  const remittedOrders = finance =>
    new Set((finance?.cashRemittances || []).flatMap(entry => (entry.orderIds || []).map(id => `${entry.masjid}|${id}`)));

  // Everything a mosque has earned that has not yet been paid out to it.
  function earnings(db, masjid) {
    const finance = db.masjidPointFinance || {};
    const done = settledIds(finance);
    const jobs = (db.masjidPointJobs || []).flatMap(job =>
      (job.masjids || [])
        .filter(m => m.name === masjid && m.paymentStatus === 'paid' && !done.jobs.has(`${masjid}|${job.id}`))
        .map(m => ({ kind: 'job', id: job.id, label: job.title, share: round(Number(m.fee || 0) * Number(m.mosquePercent ?? 70) / 100) }))
    );
    const adverts = (db.masjidPointBusinessRequests || [])
      .filter(r => r.masjid === masjid && r.paymentStatus === 'paid' && !done.requests.has(`${masjid}|${r.id}`))
      .map(r => ({
        kind: 'advertising', id: r.id, label: r.name,
        share: round(Number(r.pricingSnapshot?.mosqueAmount ?? (Number(r.price || 0) * Number(r.pricingSnapshot?.mosquePercent ?? 70) / 100)))
      }));
    // Only bank-paid shop orders are owed out; cash orders are handled in the other direction.
    const shop = (db.masjidPointShopOrders || [])
      .filter(order => (order.collectionMasjidName === masjid || order.collectionMasjidReference === masjid)
        && order.paymentStatus === 'paid'
        && !Number(order.mosqueOwesAdmin)
        && !done.orders.has(`${masjid}|${order.id}`))
      .map(order => ({ kind: 'shop', id: order.id, label: order.invoiceNumber || order.id, share: round(order.mosqueRevenue) }));
    return { jobs, adverts, shop };
  }

  // Cash a mosque took at the counter and still holds MasjidPoint's cut of.
  function cashHeld(db, masjid) {
    const remitted = remittedOrders(db.masjidPointFinance || {});
    return (db.masjidPointShopOrders || [])
      .filter(order => (order.collectionMasjidName === masjid || order.collectionMasjidReference === masjid)
        && Number(order.mosqueOwesAdmin) > 0
        && !remitted.has(`${masjid}|${order.id}`))
      .map(order => ({
        kind: 'cash', id: order.id, label: order.invoiceNumber || order.id,
        collected: round(order.cashTakenAtMosque), owed: round(order.mosqueOwesAdmin)
      }));
  }

  function position(db, masjid) {
    const earned = earnings(db, masjid), cash = cashHeld(db, masjid);
    const fromListings = round([...earned.jobs, ...earned.adverts].reduce((sum, item) => sum + item.share, 0));
    const fromShop = round(earned.shop.reduce((sum, item) => sum + item.share, 0));
    const owedToMosque = round(fromListings + fromShop);
    const owedToPlatform = round(cash.reduce((sum, item) => sum + item.owed, 0));
    const settled = round((db.masjidPointFinance?.settled || {})[masjid]);
    return {
      masjid,
      fromListings,
      fromShop,
      owedToMosque,
      owedToPlatform,
      cashCollected: round(cash.reduce((sum, item) => sum + item.collected, 0)),
      net: round(owedToMosque - owedToPlatform),
      settledToDate: settled,
      items: { ...earned, cash },
      hasActivity: owedToMosque > 0 || owedToPlatform > 0 || settled > 0
    };
  }

  // Every mosque that has ever earned, owes, or been settled.
  function build(db) {
    const names = new Set();
    (db.masjidPointAdminApplications || [])
      .filter(app => app.type === 'masjid' && ['approved', 'activated'].includes(app.status))
      .forEach(app => names.add(app.name));
    (db.masjidPointJobs || []).forEach(job => (job.masjids || []).forEach(m => names.add(m.name)));
    (db.masjidPointBusinessRequests || []).forEach(r => r.masjid && names.add(r.masjid));
    (db.masjidPointShopOrders || []).forEach(o => o.collectionMasjidName && names.add(o.collectionMasjidName));
    Object.keys(db.masjidPointFinance?.settled || {}).forEach(name => names.add(name));
    return [...names].sort().map(name => position(db, name)).filter(entry => entry.hasActivity);
  }

  const totals = entries => ({
    owedToMosques: round(entries.reduce((sum, e) => sum + e.owedToMosque, 0)),
    owedToPlatform: round(entries.reduce((sum, e) => sum + e.owedToPlatform, 0)),
    net: round(entries.reduce((sum, e) => sum + e.net, 0)),
    settledToDate: round(entries.reduce((sum, e) => sum + e.settledToDate, 0)),
    payingOut: entries.filter(e => e.net > 0).length,
    collecting: entries.filter(e => e.net < 0).length
  });

  const api = { build, position, earnings, cashHeld, totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SettlementRegister = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
