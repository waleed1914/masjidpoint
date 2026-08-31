// Wipes the development store back to an empty platform so the whole journey can be walked
// from scratch: register a masjid, approve it, list a business, sell something, and so on.
//
// Only the admin login survives — without it there is no way back into the admin panel.
//
//   node scripts/reset-data.js          empty the store while preserving administrators and bank settings
//   node scripts/reset-data.js --clear-bank  also clear the platform bank details
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
// Wherever the server is actually reading from, so a deployment with its store somewhere else is
// reset rather than a file nothing loads.
const dataDir = process.env.MASJIDPOINT_DATA_DIR
  ? path.resolve(process.env.MASJIDPOINT_DATA_DIR)
  : path.join(root, 'data');
const target = path.join(dataDir, 'masjidpoint.json');
const backups = path.join(root, 'backups');
// Existing administrators are preserved, including their bcrypt password hashes. A brand-new
// installation can provide ADMIN_PASSWORD once to create the first administrator safely.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@masjidpoint.co.uk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const clearBank = process.argv.includes('--clear-bank');

// Preserve whatever is there now before replacing it.
if (fs.existsSync(target)) {
  fs.mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const copy = path.join(backups, `pre-reset-${stamp}.json`);
  fs.copyFileSync(target, copy);
  console.log(`Backed up existing data to ${path.relative(root, copy)}`);
}

const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const preservedAdmins = Array.isArray(previous.masjidPointAdminUsers) && previous.masjidPointAdminUsers.length
  ? previous.masjidPointAdminUsers
  : (() => {
      if (!ADMIN_PASSWORD) throw Error('No administrator exists. Set ADMIN_PASSWORD to create the initial administrator safely.');
      return [{
        id: 'ADM-0001', name: 'Platform Owner', email: ADMIN_EMAIL, role: 'super_admin',
        status: 'active', passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 12), createdAt: new Date().toISOString()
      }];
    })();

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
    bankDetails: !clearBank && previous.masjidPointPlatformSettings?.bankDetails
      ? previous.masjidPointPlatformSettings.bankDetails
      : { active: false, accountName: '', bankName: '', sortCode: '', accountNumber: '', iban: '', instructions: '', updatedAt: null }
  },
  masjidPointNotifications: [],
  masjidPointCustomers: [],
  masjidPointEmailTokens: [],
  // Keep all existing administrators so their secure sign-in credentials remain valid.
  masjidPointAdminUsers: preservedAdmins
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(empty, null, 2));

console.log(`Wrote ${path.relative(root, target)} — platform is empty.`);
console.log('');
console.log('Everything cleared: masjids, businesses, jobs, products, orders, invoices,');
console.log('settlements, applications, notifications and individual accounts.');
console.log(`Bank details: ${empty.masjidPointPlatformSettings.bankDetails.active ? 'kept' : 'not configured'}`);
console.log('');
console.log('Existing administrator profiles and passwords were preserved.');
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

// Older installations stored public previews in data/uploads rather than private-objects.
// Clear that dedicated upload directory too, so no old customer files remain on disk.
const legacyUploads = path.join(dataDir, 'uploads');
if (fs.existsSync(legacyUploads)) {
  fs.rmSync(legacyUploads, { recursive: true, force: true });
  console.log('Cleared legacy uploaded files.');
}

// Undelivered mail from the old records — activation codes, reset links — is meaningless now.
const outbox = path.join(dataDir, 'email-outbox');
if (fs.existsSync(outbox)) { fs.rmSync(outbox, { recursive: true, force: true }); console.log('Cleared the email outbox.'); }

console.log('');
console.log('Restart the server so it reloads the store:  sudo systemctl restart masjidpoint');
