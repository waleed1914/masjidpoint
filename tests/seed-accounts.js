// Resolves seeded demo accounts for the test suite. Credentials come from the seed script
// itself, so a change to the demo data can never silently desynchronise the tests.
const seed = require('../scripts/seed-demo-data.js');

const BASE = process.env.MASJIDPOINT_URL || 'http://127.0.0.1:4174';
const state = () => fetch(`${BASE}/api/state`).then(r => r.json());

const ADMIN = { email: 'admin@masjidpoint.co.uk', password: seed.ADMIN_PASSWORD };

// Mosques and businesses that have completed activation and therefore have a working login.
const mosques = () => seed.MOSQUES.filter(m => m.password && m.status === 'activated');
const businesses = () => seed.BUSINESSES.filter(b => b.password && b.status === 'activated');

const mosqueByRef = ref => seed.MOSQUES.find(m => m.ref === ref);
const businessByRef = ref => seed.BUSINESSES.find(b => b.ref === ref);

// A mosque whose shop can actually take orders: activated, stocked and accepting a method.
function shopMosque(db) {
  return mosques().find(m => (db.masjidPointProducts || []).some(p =>
    p.visibility !== 'hidden' && p.stock > 0 && (p.mosques || []).some(x => x.reference === m.ref)));
}

// A business with a live, paid advert — the one the advertising and payment flows rely on.
const advertisingBusiness = () => businesses().find(b => b.advert && b.advert.paid);
// A business whose advert is still unpaid, for proof-of-payment journeys.
const unpaidBusiness = () => businesses().find(b => b.advert && !b.advert.paid);

module.exports = { BASE, state, ADMIN, seed, mosques, businesses, mosqueByRef, businessByRef, shopMosque, advertisingBusiness, unpaidBusiness };
