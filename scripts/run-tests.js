// Runs the whole suite and prints one summary.
//
// Every suite gets a server of its own, on its own port, with its own freshly seeded database.
// They used to share one, and mutate it: a suite that signed in as a mosque could change the
// account another suite needed, so the total moved between runs for reasons that had nothing to do
// with the code, and a real regression was indistinguishable from a suite that had been stepped on.
// A failure here now means the code, not the order things ran in.
//
//   npm test              everything
//   npm test -- backend   only files matching "backend"
//
// Set MASJIDPOINT_URL to run every suite against one server you started yourself instead — useful
// for watching a single journey against the development data, but the suites will interfere with
// each other again.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'tests');
const filter = process.argv[2];
const shared = process.env.MASJIDPOINT_URL || '';

// Fixtures some one-shot journeys depend on. Failures are not fatal: the suites that need them
// say so themselves.
const FIXTURES = ['seed-payment-proof-fixture.js', 'seed-advert-payment-fixture.js'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const run = (file, env = {}) => {
  try {
    const out = execFileSync(process.execPath, [file], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000,
      env: { ...process.env, ...env }
    });
    return { ok: /"passed":\s*true|^PASS/m.test(out), out };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

async function reachable(base, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(`${base}/api/state`)).ok) return true; } catch {}
    await sleep(250);
  }
  return false;
}

// A seeded database and a server to itself. Returns the base URL and how to put it away again.
async function privateServer(name, port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `masjidpoint-${name}-`));
  const env = { MASJIDPOINT_DATA_DIR: dataDir, PORT: String(port), SESSION_SECRET: 'test-secret' };
  const base = `http://127.0.0.1:${port}`;

  const seeded = run(path.join('scripts', 'seed-demo-data.js'), env);
  if (!seeded.ok && !fs.existsSync(path.join(dataDir, 'masjidpoint.json'))) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw Error(`could not seed a database: ${seeded.out.split('\n')[0]}`);
  }

  const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' });
  const stop = () => {
    try { server.kill(); } catch {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  };
  if (!await reachable(base)) { stop(); throw Error(`server on ${port} never answered`); }
  return { base, stop };
}

(async () => {
  if (shared) {
    if (!await reachable(shared, 4)) {
      console.error(`No server on ${shared}. Start it with:  PORT=4174 node server.js`);
      process.exit(1);
    }
    console.log(`Running against ${shared} — the suites share one database and can disturb each other.\n`);
  }

  const files = fs.readdirSync(testDir)
    .filter(f => /\.(e2e|test)\.js$/.test(f))
    .filter(f => !filter || f.includes(filter))
    .sort((a, b) => (a.includes('backend') ? -1 : 0) - (b.includes('backend') ? -1 : 0) || a.localeCompare(b));

  const failures = [];
  let port = 4300;

  for (const file of files) {
    process.stdout.write(`${file.padEnd(42)}`);
    let server = null;
    let base = shared;

    if (!shared) {
      try {
        server = await privateServer(file.replace(/\W+/g, '-'), port++);
        base = server.base;
      } catch (error) {
        console.log('FAIL');
        failures.push({ file, line: error.message });
        continue;
      }
    }

    try {
      for (const fixture of FIXTURES) run(path.join('scripts', fixture), { MASJIDPOINT_URL: base });
      const { ok, out } = run(path.join('tests', file), { MASJIDPOINT_URL: base });
      console.log(ok ? 'PASS' : 'FAIL');
      if (!ok) failures.push({ file, line: (out.split('\n').find(l => /error|fail/i.test(l)) || '').trim().slice(0, 140) });
    } finally {
      if (server) server.stop();
    }
  }

  console.log(`\n${files.length - failures.length}/${files.length} suites passed`);
  if (failures.length) {
    failures.forEach(f => console.log(`  ${f.file}: ${f.line}`));
    process.exit(1);
  }
})();
