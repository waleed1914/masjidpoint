// The loader has one job and two ways of failing it: arriving after the page it was meant to
// cover, and never leaving. This suite checks both, on a public page and on an admin page.
//
// The second failure is the reason this file exists. The overlay is built by whichever of
// DOMContentLoaded, readystatechange or a short poll happens first — and readystatechange keeps
// firing after that. On a fast connection the document is complete long before the data arrives,
// so the last of those events is harmless. On a slow one the order swaps: the data arrives, the
// loader lifts, and *then* the document completes and builds a second cover over a page that was
// already working. Nothing takes that one away, so the visitor sits looking at a spinner.
//
// Dispatching readystatechange by hand reproduces exactly that ordering without having to
// simulate a slow connection, which would make the test a coin toss.
const { spawn } = require('child_process');
const path = require('path');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9822, base = process.env.MASJIDPOINT_URL || 'http://127.0.0.1:4174';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (v, m) => { if (!v) throw Error(m); };
let ws, browser, id = 0; const pending = new Map();

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const t = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(x => x.type === 'page');
      if (t) {
        ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } };
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

// offsetParent is null for anything position:fixed, so it cannot answer "is this on screen".
const LOOK = `(() => {
  const o = document.querySelector('#masjidpoint-loader');
  const cs = o && getComputedStyle(o);
  return {
    covering: !!o && !o.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
    count: document.querySelectorAll('#masjidpoint-loader').length,
    covered: document.documentElement.classList.contains('masjidpoint-loading'),
    text: (document.body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)
  };
})()`;

(async () => {
  const db = await fetch(`${base}/api/state`).then(r => r.json());
  const mosque = (db.masjidPointAdminApplications || []).find(a => a.type === 'masjid' && ['approved', 'activated'].includes(a.status));

  browser = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(__dirname, '.loader-edge-' + Date.now())}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  await connect(); await cdp('Page.enable'); await cdp('Runtime.enable');

  // An admin session, so the admin pages render rather than bouncing to sign-in.
  await cdp('Page.navigate', { url: `${base}/admin-login` }); await sleep(2200);
  await ev(`sessionStorage.setItem('masjidPointAdminSession', JSON.stringify({id:'ADM-TEST',name:'Test administrator',
    email:'admin@masjidpoint.co.uk',role:'super_admin',signedInAt:Date.now(),expiresAt:Date.now()+28800000}))`);

  const pages = [['/', 'the home page'], ['/admin', 'the admin overview']];
  if (mosque) pages.push([`/admin-masjid-view?reference=${encodeURIComponent(mosque.reference)}`, 'a masjid detail page']);

  for (const [url, label] of pages) {
    await cdp('Page.navigate', { url: base + url });

    // 1. It covers the page from the first paint, rather than dropping onto a page already seen.
    await sleep(160);
    const early = await ev(LOOK);
    assert(early.covered || early.covering || early.count === 0,
      `${label} was painted before the loader covered it`);

    // 2. It comes down. The loader's own limit is six seconds; allow for one reload on top.
    await sleep(9000);
    const settled = await ev(LOOK);
    assert(!settled.covering && !settled.covered,
      `${label} is still under the loader after nine seconds: ${JSON.stringify(settled)}`);

    // 3. It stays down when the document finishes loading afterwards.
    await ev(`document.dispatchEvent(new Event('readystatechange'))`);
    await sleep(500);
    const after = await ev(LOOK);
    assert(!after.covering && !after.covered && after.count === 0,
      `${label} was covered again after it had loaded: ${JSON.stringify(after)}`);
  }

  console.log(`PASS  the loader covers, lifts and stays lifted on ${pages.length} pages`);
})().catch(e => { console.error('FAIL ' + e.message); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} try { browser?.kill(); } catch {} });
