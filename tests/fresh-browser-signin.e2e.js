// A masjid signing in on a browser that has never seen the site — which is what an incognito
// window is. Nothing cached, so the page must ask the server rather than consult a local list.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const repo = 'c:/Users/pc/Desktop/chiraz_mosque_project';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 4401, cdpPort = 10331, base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, browser, server, id = 0; const pending = new Map();

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-fresh-'));
  const env = { ...process.env, MASJIDPOINT_DATA_DIR: dataDir, PORT: String(port), SESSION_SECRET: 'x'.repeat(50), SMTP_HOST: '' };
  delete env.NODE_ENV; delete env.MASJIDPOINT_TEST_MODE;
  execFileSync(process.execPath, ['scripts/seed-demo-data.js'], { cwd: repo, env, stdio: 'ignore' });
  server = spawn(process.execPath, ['server.js'], { cwd: repo, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/state`)).ok) break; } catch {} await sleep(250); }

  const seed = require(path.join(repo, 'scripts', 'seed-demo-data.js'));
  const mosque = seed.MOSQUES.find(m => m.password && m.status === 'activated');
  const business = seed.BUSINESSES.find(b => b.password && b.status === 'activated');

  browser = spawn(edge, ['--headless=new', `--remote-debugging-port=${cdpPort}`, '--window-size=1300,900',
    `--user-data-dir=${path.join(__dirname, 'fresh-' + Date.now())}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const t = (await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(x => x.json())).find(x => x.type === 'page');
      if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.onmessage = e => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } }; break; } } catch {}
    await sleep(200);
  }
  const cdp = (m, p = {}) => new Promise(res => { pending.set(++id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async e => (await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  await cdp('Page.enable'); await cdp('Runtime.enable');

  const trySignIn = async (who, email, password, expect) => {
    // Wipe everything the browser holds, so each attempt really is a first visit.
    await cdp('Page.navigate', { url: `${base}/login` }); await sleep(2600);
    await ev(`localStorage.clear();sessionStorage.clear()`);
    await cdp('Page.navigate', { url: `${base}/login` }); await sleep(3000);
    const cached = await ev(`(JSON.parse(localStorage.getItem('masjidPointActivatedAccounts')||'[]')).length`);
    await ev(`(()=>{const f=document.querySelector('#login-form');
      f.querySelector('[name=email]').value=${JSON.stringify(email)};
      f.querySelector('[name=password]').value=${JSON.stringify(password)};
      f.requestSubmit()})()`);
    await sleep(4000);
    const where = await ev('location.pathname');
    const shown = await ev(`(()=>{const e=document.querySelector('#login-error');return e&&!e.hidden?e.textContent.trim():''})()`);
    const ok = new RegExp(expect).test(where);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${who.padEnd(26)} cached accounts: ${cached}  ->  ${where}${shown ? '  "' + shown + '"' : ''}`);
    return ok;
  };

  console.log('signing in on a browser holding nothing:');
  let bad = 0;
  if (!await trySignIn('a masjid', mosque.email, mosque.password, 'masjid-portal')) bad++;
  if (!await trySignIn('a business', business.email, business.password, 'business-portal')) bad++;
  if (!await trySignIn('a wrong password', mosque.email, 'Wrong!Password2026', 'login')) bad++;
  // Fail loudly. The runner reads the exit code, so a suite that only prints its unhappiness is
  // a suite that can never fail.
  if(bad){console.error(`FAIL ${bad} sign-in(s) wrong on a browser holding nothing`);process.exitCode=1}
  else console.log('PASS  a masjid and a business sign in on a browser that has never seen the site');
})().catch(e => console.error('ERR', e.stack))
  .finally(() => { try { ws?.close(); } catch {} try { browser?.kill(); } catch {} try { server?.kill(); } catch {} });
