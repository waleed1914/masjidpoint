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

  const failures = [];
  for (const file of files) {
    process.stdout.write(`${file.padEnd(42)}`);
    const { ok, out } = run(path.join('tests', file));
    console.log(ok ? 'PASS' : 'FAIL');
    if (!ok) failures.push({ file, line: (out.split('\n').find(l => /error|fail/i.test(l)) || '').trim().slice(0, 140) });
  }

  console.log(`\n${files.length - failures.length}/${files.length} suites passed`);
  if (failures.length) {
    failures.forEach(f => console.log(`  ${f.file}: ${f.line}`));
    process.exit(1);
  }
})();
