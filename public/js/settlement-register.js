// Shared browser-side calculation of what is owed to each mosque and to the platform.
(function (root) {
  const round = number => Number(Number(number || 0).toFixed(2));
  const settledIds = finance => {
    const history = finance?.settlementHistory || [];
    return {
      jobs: new Set(history.filter(item => item.jobId).map(item => `${item.masjid}|${item.jobId}`)),
      requests: new Set(history.filter(item => item.requestId).map(item => `${item.masjid}|${item.requestId}`)),
      orders: new Set(history.filter(item => item.orderId).map(item => `${item.masjid}|${item.orderId}`))
    };
  };
  const remittedOrders = finance => new Set((finance?.cashRemittances || [])
    .flatMap(entry => (entry.orderIds || []).map(id => `${entry.masjid}|${id}`)));

  function earnings(db, masjid) {
    const finance = db.masjidPointFinance || {};
    const done = settledIds(finance);
    const jobs = (db.masjidPointJobs || []).flatMap(job => (job.masjids || [])
      .filter(item => item.name === masjid && item.paymentStatus === 'paid'
        && !done.jobs.has(`${masjid}|${job.id}`))
      .map(item => ({
        kind: 'job', id: job.id, label: job.title,
        share: round(Number(item.fee || 0) * Number(item.mosquePercent ?? 70) / 100)
      })));
    const adverts = (db.masjidPointBusinessRequests || [])
      .filter(request => request.masjid === masjid && request.paymentStatus === 'paid'
        && !done.requests.has(`${masjid}|${request.id}`))
      .map(request => ({
        kind: 'advertising', id: request.id, label: request.name,
        share: round(Number(request.pricingSnapshot?.mosqueAmount
          ?? (Number(request.price || 0) * Number(request.pricingSnapshot?.mosquePercent ?? 70) / 100)))
      }));
    const shop = (db.masjidPointShopOrders || [])
      .filter(order => (order.collectionMasjidName === masjid || order.collectionMasjidReference === masjid)
        && order.paymentStatus === 'paid' && !Number(order.mosqueOwesAdmin)
        && !done.orders.has(`${masjid}|${order.id}`))
      .map(order => ({
        kind: 'shop', id: order.id, label: order.invoiceNumber || order.id,
        share: round(order.mosqueRevenue)
      }));
    return { jobs, adverts, shop };
  }

  function cashHeld(db, masjid) {
    const remitted = remittedOrders(db.masjidPointFinance || {});
    return (db.masjidPointShopOrders || [])
      .filter(order => (order.collectionMasjidName === masjid || order.collectionMasjidReference === masjid)
        && Number(order.mosqueOwesAdmin) > 0 && !remitted.has(`${masjid}|${order.id}`))
      .map(order => ({
        kind: 'cash', id: order.id, label: order.invoiceNumber || order.id,
        collected: round(order.cashTakenAtMosque), owed: round(order.mosqueOwesAdmin)
      }));
  }

  function position(db, masjid) {
    const earned = earnings(db, masjid);
    const cash = cashHeld(db, masjid);
    const fromListings = round([...earned.jobs, ...earned.adverts]
      .reduce((sum, item) => sum + item.share, 0));
    const fromShop = round(earned.shop.reduce((sum, item) => sum + item.share, 0));
    const owedToMosque = round(fromListings + fromShop);
    const owedToPlatform = round(cash.reduce((sum, item) => sum + item.owed, 0));
    const settled = round((db.masjidPointFinance?.settled || {})[masjid]);
    return {
      masjid, fromListings, fromShop, owedToMosque, owedToPlatform,
      cashCollected: round(cash.reduce((sum, item) => sum + item.collected, 0)),
      net: round(owedToMosque - owedToPlatform), settledToDate: settled,
      items: { ...earned, cash }, hasActivity: owedToMosque > 0 || owedToPlatform > 0 || settled > 0
    };
  }

  function build(db) {
    const names = new Set();
    (db.masjidPointAdminApplications || [])
      .filter(app => app.type === 'masjid' && ['approved', 'activated'].includes(app.status))
      .forEach(app => names.add(app.name));
    (db.masjidPointJobs || []).forEach(job => (job.masjids || []).forEach(item => names.add(item.name)));
    (db.masjidPointBusinessRequests || []).forEach(request => request.masjid && names.add(request.masjid));
    (db.masjidPointShopOrders || []).forEach(order => order.collectionMasjidName && names.add(order.collectionMasjidName));
    Object.keys(db.masjidPointFinance?.settled || {}).forEach(name => names.add(name));
    return [...names].sort().map(name => position(db, name)).filter(entry => entry.hasActivity);
  }

  const totals = entries => ({
    owedToMosques: round(entries.reduce((sum, entry) => sum + entry.owedToMosque, 0)),
    owedToPlatform: round(entries.reduce((sum, entry) => sum + entry.owedToPlatform, 0)),
    net: round(entries.reduce((sum, entry) => sum + entry.net, 0)),
    settledToDate: round(entries.reduce((sum, entry) => sum + entry.settledToDate, 0)),
    payingOut: entries.filter(entry => entry.net > 0).length,
    collecting: entries.filter(entry => entry.net < 0).length
  });

  root.SettlementRegister = { build, position, earnings, cashHeld, totals };
})(typeof globalThis !== 'undefined' ? globalThis : this);
