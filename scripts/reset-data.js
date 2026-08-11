// Wipes the development store back to an empty platform so the whole journey can be walked
// from scratch: register a masjid, approve it, list a business, sell something, and so on.
//
// Only the admin login survives — without it there is no way back into the admin panel.
//
//   node scripts/reset-data.js          empty the store
//   node scripts/reset-data.js --keep-bank   keep the platform bank details configured
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
// Wherever the server is actually reading from, so a deployment with its store somewhere else is
// reset rather than a file nothing loads.
const dataDir = process.env.MASJIDPOINT_DATA_DIR
  ? path.resolve(process.env.MASJIDPOINT_DATA_DIR)
  : path.join(root, 'data');
const target = path.join(dataDir, 'masjidpoint.json');
const backups = path.join(root, 'backups');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// The admin password is not written down here. A fixed default in a source file is a working
// credential for every copy of this repository, and the reset it performs is exactly the moment it
// would be relied on. Set ADMIN_PASSWORD to choose one; otherwise a random one is generated and
// printed once, at the end of the run.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@masjidpoint.co.uk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  || `Admin!${crypto.randomBytes(9).toString('base64url')}`;
const keepBank = process.argv.includes('--keep-bank');

// Preserve whatever is there now before replacing it.
if (fs.existsSync(target)) {
  fs.mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const copy = path.join(backups, `pre-reset-${stamp}.json`);
  fs.copyFileSync(target, copy);
  console.log(`Backed up existing data to ${path.relative(root, copy)}`);
}

const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};

const empty = {
  masjidPointJobs: [],
  masjidPointFinance: { accounts: [], unmatched: [], settled: {}, settlementHistory: [], audit: [], cashRemittances: [] },
  masjidPointPaymentProofs: [],
  masjidPointBusinessRequests: [],
  masjidPointBusinessListings: [],
  masjidPointAdminApplications: [],
  masjidPointActivatedAccounts: [],
  masjidPointJobApplications: [],
  masjidPointMasjidPricing: [],
  masjidPointProducts: [],
  masjidPointShopOrders: [],
  masjidPointPlatformSettings: {
    bankDetails: keepBank && previous.masjidPointPlatformSettings?.bankDetails
      ? previous.masjidPointPlatformSettings.bankDetails
      : { active: false, accountName: '', bankName: '', sortCode: '', accountNumber: '', iban: '', instructions: '', updatedAt: null }
  },
  masjidPointNotifications: [],
  masjidPointCustomers: [],
  masjidPointEmailTokens: [],
  // The one thing that must survive, or the admin panel becomes unreachable.
  masjidPointAdminUsers: [{
    id: 'ADM-0001', name: 'Platform Owner', email: ADMIN_EMAIL, role: 'super_admin',
    status: 'active', passwordHash: hash(ADMIN_PASSWORD), createdAt: new Date().toISOString()
  }]
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(empty, null, 2));

console.log(`Wrote ${path.relative(root, target)} — platform is empty.`);
console.log('');
console.log('Everything cleared: masjids, businesses, jobs, products, orders, invoices,');
console.log('settlements, applications, notifications and individual accounts.');
console.log(`Bank details: ${empty.masjidPointPlatformSettings.bankDetails.active ? 'kept' : 'not configured'}`);
console.log('');
console.log('Admin sign-in (the only account left):');
console.log(`  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
console.log('');
// Emptying the collections used to leave every uploaded document behind: payment proofs,
// donation receipts, CVs and business logos sat in the store directory belonging to records that
// no longer existed. Nothing could reach them through the site, which made it easy to believe they
// were gone. A wipe that leaves personal documents on disk is not a wipe.
const documents = path.join(dataDir, 'private-objects');
if (fs.existsSync(documents)) {
  const count = (function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
      .reduce((n, e) => n + (e.isDirectory() ? walk(path.join(dir, e.name)) : 1), 0);
  })(documents);
  fs.rmSync(documents, { recursive: true, force: true });
  console.log(`Deleted ${count} uploaded document${count === 1 ? '' : 's'} from ${path.relative(root, documents) || documents}`);
} else {
  console.log('No uploaded documents to delete.');
}

// Undelivered mail from the old records — activation codes, reset links — is meaningless now.
const outbox = path.join(dataDir, 'email-outbox');
if (fs.existsSync(outbox)) { fs.rmSync(outbox, { recursive: true, force: true }); console.log('Cleared the email outbox.'); }

console.log('');
console.log('Restart the server so it reloads the store:  sudo systemctl restart masjidpoint');
