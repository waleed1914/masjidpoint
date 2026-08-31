// Destructive production reset for the one-time move from test data to real data.
// It is deliberately guarded by an exact confirmation phrase, takes an encrypted state
// backup first, keeps administrator accounts and platform settings, then removes every
// record and private upload associated with the old platform data.
require('dotenv').config();

const { spawnSync } = require('child_process');
const path = require('path');
const { StateRepository } = require('../lib/db');
const { PrivateObjectStorage } = require('../lib/object-storage');

const root = path.join(__dirname, '..');
const confirmation = process.env.APPROVE_LIVE_DATA_RESET;
const requiredPhrase = 'DELETE_ALL_TEST_DATA';

function collectObjectKeys(value, keys = new Set(), seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  if (typeof value.objectKey === 'string' && value.objectKey.startsWith('private/')) keys.add(value.objectKey);
  Object.values(value).forEach(child => collectObjectKeys(child, keys, seen));
  return keys;
}

function emptyState(previous) {
  return {
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
    masjidPointPlatformSettings: previous.masjidPointPlatformSettings || {
      bankDetails: { active: false, accountName: '', bankName: '', sortCode: '', accountNumber: '', iban: '', instructions: '', updatedAt: null }
    },
    masjidPointNotifications: [],
    masjidPointCustomers: [],
    masjidPointEmailTokens: [],
    // Keep all administrator accounts and their existing bcrypt password hashes.
    masjidPointAdminUsers: previous.masjidPointAdminUsers || []
  };
}

(async () => {
  if (process.env.NODE_ENV !== 'production' || !process.env.DATABASE_URL) {
    throw Error('This command only runs against a production PostgreSQL database.');
  }
  if (confirmation !== requiredPhrase) {
    throw Error(`Refusing to reset production. Set APPROVE_LIVE_DATA_RESET=${requiredPhrase} for this one command.`);
  }
  if (!process.env.BACKUP_ENCRYPTION_KEY) {
    throw Error('BACKUP_ENCRYPTION_KEY is required so the current state can be backed up first.');
  }

  // Do not start deleting until the encrypted state backup has completed successfully.
  const backup = spawnSync(process.execPath, [path.join(__dirname, 'backup.js')], {
    cwd: root,
    env: process.env,
    encoding: 'utf8'
  });
  if (backup.status !== 0) throw Error(backup.stderr || 'Could not create the encrypted backup.');
  const backupFile = String(backup.stdout || '').trim();
  if (!backupFile) throw Error('The backup command did not report a backup file.');

  const repository = new StateRepository({ seed: {}, root });
  await repository.init();
  const previous = await repository.load();
  const objectKeys = [...collectObjectKeys(previous)];
  const storage = new PrivateObjectStorage({ localDir: path.join(root, 'data', 'private-objects') });

  // Remove uploads before removing their references. If this fails, the app state is left intact.
  for (const key of objectKeys) await storage.remove(key);
  await repository.save(emptyState(previous));

  // Metadata was not used by older records, but remove it as well if it exists.
  if (repository.pool) await repository.pool.query('DELETE FROM documents');
  await repository.close();

  console.log(`Backup created: ${backupFile}`);
  console.log(`Deleted ${objectKeys.length} private upload${objectKeys.length === 1 ? '' : 's'}.`);
  console.log('Production platform data is now empty. Admin users and platform settings were preserved.');
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
