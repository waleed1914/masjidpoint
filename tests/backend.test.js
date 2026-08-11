// Backend suite. No browser: exercises the pure domain modules and every HTTP endpoint the
// server exposes, against the running development server.
//
//   node tests/backend.test.js
const assert = require('assert');
const accounts = require('./seed-accounts.js');

globalThis.ShopFulfilment = require('../lib/shop-fulfilment');
const fulfilment = require('../lib/shop-fulfilment');
const invoices = require('../lib/invoice-register');
const settlements = require('../lib/settlement-register');
const crypto = require('crypto');

const BASE = accounts.BASE;
let adminToken = '';
const authHeaders = () => adminToken ? { 'X-MasjidPoint-Session': adminToken } : {};
const state = () => fetch(`${BASE}/api/state`).then(r => r.json());
const post = (path, body) => fetch(`${BASE}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body)
});
const put = (key, value) => fetch(`${BASE}/api/collection/${key}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(value)
});

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.message }); }
}

(async () => {
  const login = await post('/api/admin/login', {
    email: accounts.ADMIN.email,
    passwordHash: crypto.createHash('sha256').update(accounts.ADMIN.password).digest('hex')
  });
  adminToken = (await login.json()).session;
  assert.ok(adminToken, 'administrator test login failed');
  /* ------------------------------------------------------- fulfilment rules */
  await test('fulfilment: three methods with distinct status chains', () => {
    assert.deepStrictEqual(fulfilment.ORDER, ['collect_pay_now', 'collect_pay_at_mosque', 'delivery']);
    assert.ok(fulfilment.METHODS.delivery.statuses.includes('dispatched'));
    assert.ok(!fulfilment.METHODS.collect_pay_now.statuses.includes('dispatched'));
    assert.strictEqual(fulfilment.METHODS.delivery.handledByMosque, false);
    assert.strictEqual(fulfilment.METHODS.collect_pay_at_mosque.paysUpfront, false);
  });

  await test('fulfilment: legacy orders are inferred from how they were paid', () => {
    assert.strictEqual(fulfilment.methodOf({ paymentStatus: 'pay_on_collection' }).key, 'collect_pay_at_mosque');
    assert.strictEqual(fulfilment.methodOf({ paymentStatus: 'submitted' }).key, 'collect_pay_now');
  });

  await test('fulfilment: status chain advances then stops', () => {
    assert.strictEqual(fulfilment.nextStatus({ fulfilmentMethod: 'delivery', status: 'preparing' }), 'dispatched');
    assert.strictEqual(fulfilment.nextStatus({ fulfilmentMethod: 'delivery', status: 'delivered' }), null);
  });

  await test('fulfilment: a mosque with no settings still offers collection', () => {
    const enabled = fulfilment.enabledFor({}).map(m => m.key);
    assert.ok(enabled.includes('collect_pay_now') && enabled.includes('collect_pay_at_mosque'));
    assert.ok(!enabled.includes('delivery'), 'delivery must be opt-in');
  });

  /* ---------------------------------------------------------- invoice rules */
  await test('invoices: cancelled and refunded outrank paid/overdue', () => {
    assert.strictEqual(invoices.statusOf({ amount: 50, paid: 0, due: '2000-01-01', status: 'cancelled' }).key, 'cancelled');
    assert.strictEqual(invoices.statusOf({ amount: 50, paid: 50, status: 'refunded' }).key, 'refunded');
    assert.strictEqual(invoices.statusOf({ amount: 50, paid: 0, due: '2000-01-01' }).key, 'overdue');
    assert.strictEqual(invoices.statusOf({ amount: 50, paid: 50 }).key, 'paid');
    assert.strictEqual(invoices.statusOf({ amount: 50, paid: 10, due: '2999-01-01' }).key, 'due');
  });

  let db = await state();

  await test('invoices: register covers both listing and shop invoices', () => {
    const entries = invoices.build(db);
    assert.ok(entries.some(e => e.source === 'business'), 'no listing invoices');
    assert.ok(entries.some(e => e.source === 'shop'), 'no shop invoices');
    assert.ok(entries.every(e => e.number), 'an invoice has no number');
    assert.ok(entries.every(e => e.status && e.type), 'an invoice has no status or type');
  });

  await test('invoices: totals reconcile with their entries', () => {
    const entries = invoices.build(db);
    const totals = invoices.totals(entries);
    const invoiced = Number(entries.reduce((s, e) => s + e.amount, 0).toFixed(2));
    const paid = Number(entries.reduce((s, e) => s + e.paid, 0).toFixed(2));
    assert.strictEqual(totals.invoiced, invoiced);
    assert.strictEqual(totals.paid, paid);
    assert.ok(totals.outstanding >= 0);
  });

  await test('invoices: CSV export has one row per invoice', () => {
    const entries = invoices.build(db);
    const rows = invoices.toCsv(entries).trim().split(/\r?\n/);
    assert.strictEqual(rows.length, entries.length + 1, 'header plus one row per invoice');
    assert.ok(rows[0].startsWith('Invoice,Type,Billed to'));
  });

  /* ------------------------------------------------------- settlement rules */
  await test('settlements: cash orders are owed inward, never outward', () => {
    const entries = settlements.build(db);
    for (const entry of entries) {
      const cash = settlements.cashHeld(db, entry.masjid);
      const earned = settlements.earnings(db, entry.masjid);
      const overlap = earned.shop.filter(s => cash.some(c => c.id === s.id));
      assert.strictEqual(overlap.length, 0, `${entry.masjid} counts a cash order in both directions`);
    }
  });

  await test('settlements: net equals owed-out minus owed-in', () => {
    for (const entry of settlements.build(db)) {
      assert.strictEqual(entry.net, Number((entry.owedToMosque - entry.owedToPlatform).toFixed(2)), entry.masjid);
    }
  });

  /* ------------------------------------------------------------- reconcile */
  await test('reconcile: shop orders gain method, invoice number and totals', async () => {
    const orders = db.masjidPointShopOrders || [];
    assert.ok(orders.length, 'no shop orders seeded');
    for (const order of orders) {
      assert.ok(order.fulfilmentMethod, `${order.id} has no fulfilment method`);
      assert.ok(/^SHP-\d{4}-\d{6}$/.test(order.invoiceNumber), `${order.id} has a bad invoice number`);
      const goods = Number((order.items || []).reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2));
      assert.strictEqual(order.goodsTotal, goods, `${order.id} goods total`);
      assert.strictEqual(order.total, Number((goods + Number(order.deliveryFee || 0)).toFixed(2)), `${order.id} total`);
    }
  });

  await test('reconcile: only delivery orders carry a delivery fee or address', () => {
    for (const order of db.masjidPointShopOrders || []) {
      if (order.fulfilmentMethod === 'delivery') continue;
      assert.strictEqual(Number(order.deliveryFee), 0, `${order.id} charges delivery without being a delivery`);
      assert.ok(!order.deliveryAddress, `${order.id} keeps an address it should not have`);
    }
  });

  await test('reconcile: every operational mosque has pricing and shop settings', () => {
    const operational = (db.masjidPointAdminApplications || [])
      .filter(a => a.type === 'masjid' && ['approved', 'activated'].includes(a.status));
    for (const mosque of operational) {
      const rate = (db.masjidPointMasjidPricing || []).find(p => p.masjidReference === mosque.reference);
      assert.ok(rate, `${mosque.name} has no pricing row`);
      assert.ok(rate.shopFulfilment, `${mosque.name} has no shop fulfilment settings`);
      assert.strictEqual(typeof rate.shopDeliveryFee, 'number', `${mosque.name} delivery fee is not numeric`);
    }
  });

  await test('reconcile: approved businesses all hold a permanent code', () => {
    const businesses = (db.masjidPointAdminApplications || [])
      .filter(a => a.type === 'business' && ['approved', 'activated'].includes(a.status));
    assert.ok(businesses.length, 'no approved businesses');
    for (const b of businesses) assert.ok(/^BUS-\d{5}$/.test(b.businessCode || ''), `${b.name} has code ${b.businessCode}`);
  });

  await test('reconcile: a paid job stays paid across repeated reads', async () => {
    const before = (await state()).masjidPointJobs.filter(j => (j.masjids || []).some(m => m.paymentStatus === 'paid'));
    assert.ok(before.length, 'no paid jobs to check');
    await state(); await state();
    const after = (await state()).masjidPointJobs;
    for (const job of before) {
      const now = after.find(j => j.id === job.id);
      assert.ok((now.masjids || []).some(m => m.paymentStatus === 'paid'), `${job.id} lost its payment`);
    }
  });

  /* ------------------------------------------------------ notification scope */
  await test('notifications: none are addressed to every business at once', () => {
    const leaky = (db.masjidPointNotifications || []).filter(n => n.audience === 'business');
    assert.strictEqual(leaky.length, 0, `${leaky.length} notifications would be seen by every business`);
  });

  await test('notifications: business notices name a real recipient', () => {
    const codes = new Set((db.masjidPointAdminApplications || []).map(a => a.businessCode).filter(Boolean));
    const emails = new Set((db.masjidPointAdminApplications || []).map(a => a.email).filter(Boolean));
    for (const n of (db.masjidPointNotifications || []).filter(n => String(n.audience).startsWith('business:'))) {
      const who = n.audience.slice('business:'.length);
      assert.ok(codes.has(who) || emails.has(who), `unknown business audience ${who}`);
    }
  });

  /* ---------------------------------------------------------------- routes */
  await test('security: forged admin headers cannot manage administrators', async () => {
    const res = await fetch(`${BASE}/api/admin/users`, { headers: { 'X-Admin-Role': 'super_admin', 'X-Admin-Name': 'Forged owner' } });
    assert.strictEqual(res.status, 401);
  });

  await test('security: financial exports require an administrator session', async () => {
    const res = await fetch(`${BASE}/api/finance/export.csv?type=invoices`);
    assert.strictEqual(res.status, 401);
  });

  await test('security: finance collections reject forged browser roles', async () => {
    const res = await fetch(`${BASE}/api/collection/masjidPointFinance`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Role': 'super_admin' },
      body: JSON.stringify(db.masjidPointFinance)
    });
    assert.strictEqual(res.status, 403);
  });

  await test('security: operational decisions reject anonymous callers', async () => {
    const checks = await Promise.all([
      fetch(`${BASE}/api/job/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(`${BASE}/api/advertising/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(`${BASE}/api/admin/product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      fetch(`${BASE}/api/order/advance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    ]);
    assert.ok(checks.every(response => response.status === 401), checks.map(response => response.status).join(','));
  });

  await test('route: shop invoice PDF renders', async () => {
    const order = (db.masjidPointShopOrders || [])[0];
    const res = await fetch(`${BASE}/api/shop/invoice.pdf?order=${encodeURIComponent(order.id)}`, { headers: authHeaders() });
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(head, '%PDF-');
  });

  await test('route: shop invoice 404s for an unknown order', async () => {
    const res = await fetch(`${BASE}/api/shop/invoice.pdf?order=ORD-DOES-NOT-EXIST`, { headers: authHeaders() });
    assert.strictEqual(res.status, 404);
  });

  await test('route: listing invoice PDF renders', async () => {
    const account = (db.masjidPointFinance.accounts || []).find(a => (a.invoices || []).length);
    assert.ok(account, 'no account with an invoice');
    const res = await fetch(`${BASE}/api/finance/invoice.pdf?code=${encodeURIComponent(account.code)}&invoice=${encodeURIComponent(account.invoices[0].number)}`, { headers: authHeaders() });
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(head, '%PDF-');
  });

  await test('route: invoice CSV covers the whole register', async () => {
    const csv = await fetch(`${BASE}/api/invoices/export.csv`, { headers: authHeaders() }).then(r => r.text());
    const rows = csv.trim().split(/\r?\n/);
    assert.strictEqual(rows.length, invoices.build(await state()).length + 1);
    assert.ok(csv.includes('Mosque shop'), 'CSV omits shop invoices');
  });

  await test('route: settlement rejects a missing bank reference', async () => {
    const entry = settlements.build(await state()).find(e => e.owedToMosque > 0);
    assert.ok(entry, 'nothing is owed to any mosque');
    const res = await post('/api/settle', { masjid: entry.masjid, transactionReference: '' });
    assert.strictEqual(res.status, 400);
  });

  await test('route: cash remittance rejects a mosque that owes nothing', async () => {
    const clear = settlements.build(await state()).find(e => e.owedToPlatform === 0);
    if (!clear) return; // every mosque currently holds cash
    const res = await post('/api/mosque-cash/remit', { masjid: clear.masjid, transactionReference: 'BACKEND-TEST' });
    assert.strictEqual(res.status, 400);
  });

  await test('route: net settlement clears both directions at once', async () => {
    let current = await state();
    const target = settlements.build(current).find(e => e.owedToMosque > 0 && e.owedToPlatform > 0);
    if (!target) return; // no mosque is currently owed in both directions
    const res = await post('/api/settle/net', { masjid: target.masjid, transactionReference: `BACKEND-NET-${Date.now()}` });
    const body = await res.json();
    assert.strictEqual(res.status, 200, body.error);
    assert.strictEqual(Number(body.net), Number((target.owedToMosque - target.owedToPlatform).toFixed(2)));
    const after = settlements.position(await state(), target.masjid);
    assert.strictEqual(after.owedToMosque, 0, 'still owed outward');
    assert.strictEqual(after.owedToPlatform, 0, 'still owed inward');
  });

  await test('route: unknown collection is rejected', async () => {
    const res = await put('masjidPointNotARealCollection', []);
    assert.ok(res.status >= 400, `expected rejection, got ${res.status}`);
  });

  await test('route: state read is stable — two reads agree', async () => {
    const a = await state(), b = await state();
    assert.strictEqual((a.masjidPointShopOrders || []).length, (b.masjidPointShopOrders || []).length);
    assert.strictEqual((a.masjidPointJobs || []).length, (b.masjidPointJobs || []).length);
    const invA = invoices.totals(invoices.build(a)), invB = invoices.totals(invoices.build(b));
    assert.strictEqual(invA.invoiced, invB.invoiced, 'invoiced total drifts between reads');
  });

  /* ------------------------------------------------------------- reporting */
  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.name}${r.ok ? '' : `\n        ${r.error}`}`);
  console.log('');
  if (failed.length) {
    console.error(`FAIL ${failed.length} of ${results.length} backend checks failed`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ passed: true, checks: results.length, suite: 'backend' }, null, 2));
  }
})().catch(error => { console.error('FAIL', error.stack); process.exitCode = 1; });
