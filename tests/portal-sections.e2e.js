// Every sidebar entry in both portals must lead to a page with its section on it.
//
// The portal is one document per role; each address hides everything that is not the section it
// is named for. That hiding walked into the section it was meant to reveal and hid its children,
// so "Business requests" and "My advertising" were reported as blank pages — a heading, a rule,
// and nothing else. The panel was there the whole time with every child set to display:none.
//
// So the check is not "did the section survive" but "is anything inside it on screen". Height,
// not presence.
const { spawn } = require('child_process');
const path = require('path');
const accounts = require('./seed-accounts.js');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9824, base = accounts.BASE;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (v, m) => { if (!v) throw Error(m); };
let ws, browser, id = 0; const pending = new Map(); let exceptions = [];

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const t = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(x => x.type === 'page');
      if (t) {
        ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.onmessage = e => {
          const m = JSON.parse(e.data);
          if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0]);
          const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); }
        };
        return;
      }
    } catch {}
    await sleep(200);
  }
  throw Error('Edge unavailable');
}
const cdp = (method, params = {}) => new Promise(res => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'Browser error');
  return r.result.value;
}

// Sections keyed the same way portal-section.js keys them.
const MASJID_SECTIONS = [
  ['masjid-requests', '#requests'], ['masjid-listings', '#listings'],
  ['masjid-jobs', '.job-approval-panel'], ['masjid-orders', '#shop-orders'], ['masjid-qr', '#qr-poster']
];
const BUSINESS_SECTIONS = [
  ['business-advertising', '#advertising'], ['business-invoices', '#invoices'],
  ['business-applicants', '#applicants'], ['business-profile', '#profile']
];

async function signIn(email, password) {
  await cdp('Page.navigate', { url: `${base}/login` }); await sleep(2600);
  await ev(`(() => { const f = document.querySelector('#login-form');
    f.querySelector('[name=email]').value = ${JSON.stringify(email)};
    f.querySelector('[name=password]').value = ${JSON.stringify(password)};
    f.requestSubmit(); })()`);
  await sleep(4000);
  return ev('location.pathname');
}

async function checkSection(page, selector, who) {
  exceptions = [];
  await cdp('Page.navigate', { url: `${base}/${page}` });
  await sleep(6500);
  const r = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { missing: true };
    const kids = [...el.children];
    return {
      height: el.offsetHeight,
      shownChildren: kids.filter(k => k.offsetHeight > 0).length,
      totalChildren: kids.length,
      active: (() => { const a = document.querySelector('.portal-sidebar nav a.active, .business-sidebar nav a.active');
        return a ? (a.getAttribute('href') || '') : ''; })(),
      // business-profile is reachable by address but no longer in the sidebar: that entry was
      // renamed to Business profile and pointed at business-account instead.
      inSidebar: [...document.querySelectorAll('.portal-sidebar nav a, .business-sidebar nav a')]
        .some(a => (a.getAttribute('href') || '') === ${JSON.stringify(page)})
    };
  })()`);
  assert(!r.missing, `${who}: ${page} has no ${selector} on it at all`);
  assert(r.shownChildren > 0,
    `${who}: ${page} shows an empty ${selector} — ${r.totalChildren} children, none of them on screen`);
  assert(r.height > 20, `${who}: ${page} renders ${selector} only ${r.height}px tall`);
  if (r.inSidebar) assert(r.active === page, `${who}: ${page} marks "${r.active || 'nothing'}" as the current sidebar page`);
  assert(!exceptions.length, `${who}: ${page} raised ${exceptions.join(', ')}`);
}

(async () => {
  const mosque = accounts.mosques()[0];
  const business = accounts.businesses()[0];
  assert(mosque && business, 'Seed must provide an activated mosque and business');

  browser = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(__dirname, '.sections-edge-' + Date.now())}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  await connect(); await cdp('Page.enable'); await cdp('Runtime.enable');

  let landed = await signIn(mosque.email, mosque.password);
  assert(/masjid-portal/.test(landed), `Masjid sign-in landed on ${landed}`);
  for (const [page, selector] of MASJID_SECTIONS) await checkSection(page, selector, 'masjid');

  landed = await signIn(business.email, business.password);
  assert(/business-portal/.test(landed), `Business sign-in landed on ${landed}`);
  for (const [page, selector] of BUSINESS_SECTIONS) await checkSection(page, selector, 'business');

  console.log(`PASS  ${MASJID_SECTIONS.length + BUSINESS_SECTIONS.length} portal sections render their own content`);
})().catch(e => { console.error('FAIL ' + e.message); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} try { browser?.kill(); } catch {} });
