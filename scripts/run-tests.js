// Runs the whole suite against the development server and prints one summary.
// Backend checks run first (fast, no browser), then the browser journeys.
//
//   npm test              everything
//   npm test -- backend   only files matching "backend"
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'tests');
const base = process.env.MASJIDPOINT_URL || 'http://127.0.0.1:4174';
const filter = process.argv[2];

// Fixture resets some one-shot journeys depend on. Failures here are not fatal: the suites
// that need them will say so themselves.
const FIXTURES = ['seed-payment-proof-fixture.js', 'seed-advert-payment-fixture.js'];

const run = (file, cwd = root) => {
  try {
    const out = execFileSync(process.execPath, [file], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    return { ok: /"passed":\s*true|^PASS/m.test(out), out };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

(async () => {
  try {
    const res = await fetch(`${base}/api/state`);
    if (!res.ok) throw Error(String(res.status));
  } catch {
    console.error(`No server on ${base}. Start it with:  PORT=4174 node server.js`);
    process.exit(1);
  }

  for (const fixture of FIXTURES) run(path.join('scripts', fixture));

  const files = fs.readdirSync(testDir)
    .filter(f => /\.(e2e|test)\.js$/.test(f))
    .filter(f => !filter || f.includes(filter))
    .sort((a, b) => (a.includes('backend') ? -1 : 0) - (b.includes('backend') ? -1 : 0) || a.localeCompare(b));

  // Several suites sign in as accounts defined by scripts/seed-demo-data.js. Those accounts only
  // exist after `npm run seed`, and a database holding real work instead will make them fail on a
  // missing record — which looks like a regression but is not one. Detect that up front and skip
  // them with a reason, so a genuine failure is never buried among fixture noise.
  const seededAccounts = (() => {
    try {
      const seed = require(path.join(root, 'scripts', 'seed-demo-data.js'));
      return [...(seed.MOSQUES || []), ...(seed.BUSINESSES || [])].filter(x => x.password && x.status === 'activated');
    } catch { return []; }
  })();
  let seedLoaded = true;
  if (seededAccounts.length) {
    const db = await fetch(`${base}/api/state`).then(r => r.json()).catch(() => ({}));
    const applications = db.masjidPointAdminApplications || [];
    seedLoaded = seededAccounts.some(account => applications.some(a => a.reference === account.ref));
  }
  // Only the suites that sign in as a seeded account, not everything that merely imports the
  // seed script to read its definitions.
  const needsSeed = file => /require\(['"]\.\/seed-accounts/.test(fs.readFileSync(path.join(testDir, file), 'utf8'));

  const failures = [];
  const skipped = [];
  for (const file of files) {
    process.stdout.write(`${file.padEnd(42)}`);
    const { ok, out } = run(path.join('tests', file));
    // Every suite still runs: some import the seed definitions but never sign in with them, and
    // those must keep counting. Only a suite that actually failed, and that depends on accounts
    // this database does not hold, is reported as skipped rather than broken.
    if (!ok && !seedLoaded && needsSeed(file)) {
      console.log('SKIP');
      skipped.push(file);
      continue;
    }
    console.log(ok ? 'PASS' : 'FAIL');
    if (!ok) failures.push({ file, line: (out.split('\n').find(l => /error|fail/i.test(l)) || '').trim().slice(0, 140) });
  }

  const ran = files.length - skipped.length;
  console.log(`\n${ran - failures.length}/${ran} suites passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
  if (skipped.length) console.log(`  skipped: the demo accounts are not in this database — run "npm run seed" to load them (this replaces the current data)`);
  if (failures.length) {
    failures.forEach(f => console.log(`  ${f.file}: ${f.line}`));
    process.exit(1);
  }
})();
