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
const target = path.join(root, 'data', 'masjidpoint.json');
const backups = path.join(root, 'backups');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

const ADMIN_EMAIL = 'admin@masjidpoint.co.uk';
const ADMIN_PASSWORD = 'Admin!2026Secure';
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
console.log('Restart the server so it reloads the store:  PORT=4174 node server.js');
