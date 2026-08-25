// Builds a complete, coherent MasjidPoint dataset from scratch and writes it to the
// development JSON store. Everything downstream (invoices, settlements, shop revenue) is left
// for the server's own reconcile pass to derive, so the seed only states facts, never totals.
//
//   node scripts/seed-demo-data.js         write data/masjidpoint.json
//   node scripts/seed-demo-data.js --print summary only, write nothing
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
// Seeds wherever the server is reading from, so a test suite with a store of its own can be
// seeded the same way as the development one.
const target = process.env.MASJIDPOINT_DATA_DIR
  ? path.join(path.resolve(process.env.MASJIDPOINT_DATA_DIR), 'masjidpoint.json')
  : path.join(root, 'data', 'masjidpoint.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// Fixed clock so repeated seeds produce comparable data.
const NOW = new Date('2026-08-03T09:00:00.000Z');
const day = n => new Date(NOW.getTime() - n * 86400000).toISOString();
const dayOnly = n => day(n).slice(0, 10);

// Deliberately a throwaway, and deliberately not the password any real deployment uses: this
// dataset is fictional and the tests need the value to be the same in the seeding process and in
// the process that later signs in, so it cannot be random. Set ADMIN_PASSWORD to override it.
// Seeding replaces the whole store and is for development only — see DEPLOY.md.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Demo!Seed2026Aa';

/* ------------------------------------------------------------------ mosques */
const MOSQUES = [
  { ref: 'MSJ-2026-ALHUDA', name: 'Al-Huda Community Masjid', city: 'Birmingham', postcode: 'B10 0RX',
    address: '14 Coventry Road, Birmingham', contact: 'Yusuf Rahman', role: 'Trustee', phone: '0121 772 4410',
    email: 'office@alhuda-masjid.org.uk', password: 'Alhuda!2026Aa', status: 'activated', submitted: 62,
    pricing: { advertisingPrice: 25, jobPrice: 8, adminPercent: 30, mosquePercent: 70 },
    shop: { collectPayNow: true, collectPayAtMosque: true, delivery: true }, deliveryFee: 4.5 },
  { ref: 'MSJ-2026-ALNOOR', name: 'Masjid Al-Noor', city: 'Manchester', postcode: 'M14 5TB',
    address: '208 Wilmslow Road, Manchester', contact: 'Imran Patel', role: 'Chair', phone: '0161 224 8890',
    email: 'admin@masjidalnoor.org.uk', password: 'Alnoor!2026Aa', status: 'activated', submitted: 58,
    pricing: { advertisingPrice: 20, jobPrice: 6, adminPercent: 25, mosquePercent: 75 },
    shop: { collectPayNow: true, collectPayAtMosque: true, delivery: false }, deliveryFee: 0 },
  { ref: 'MSJ-2026-GRNLNE', name: 'Green Lane Masjid', city: 'Birmingham', postcode: 'B10 0UZ',
    address: '20 Green Lane, Birmingham', contact: 'Bilal Ahmed', role: 'Secretary', phone: '0121 448 2255',
    email: 'contact@greenlanemasjid.org', password: 'Greenlane!2026Aa', status: 'activated', submitted: 44,
    pricing: { advertisingPrice: 30, jobPrice: 10, adminPercent: 30, mosquePercent: 70 },
    shop: { collectPayNow: true, collectPayAtMosque: false, delivery: true }, deliveryFee: 3.95 },
  { ref: 'MSJ-2026-BRDFRD', name: 'Bradford Central Masjid', city: 'Bradford', postcode: 'BD8 8AW',
    address: '31 Carlisle Road, Bradford', contact: 'Adnan Hussain', role: 'Trustee', phone: '01274 490 118',
    email: 'info@bradfordcentral.org.uk', password: 'Bradford!2026Aa', status: 'activated', submitted: 30,
    pricing: { advertisingPrice: 18, jobPrice: 5, adminPercent: 35, mosquePercent: 65 },
    shop: { collectPayNow: false, collectPayAtMosque: true, delivery: false }, deliveryFee: 0 },
  // Approved but not yet claimed — shows the Approved vs Activated distinction on the masjids page.
  { ref: 'MSJ-2026-EASTLN', name: 'East London Masjid Trust', city: 'London', postcode: 'E1 1JX',
    address: '82 Whitechapel Road, London', contact: 'Tariq Uddin', role: 'Operations lead', phone: '020 7650 3000',
    email: 'trust@eastlondonmasjid.org.uk', password: null, status: 'approved', submitted: 9,
    pricing: { advertisingPrice: 35, jobPrice: 12, adminPercent: 30, mosquePercent: 70 },
    shop: { collectPayNow: true, collectPayAtMosque: true, delivery: false }, deliveryFee: 0 },
  // Waiting on an admin decision.
  { ref: 'MSJ-2026-LEEDSG', name: 'Leeds Grand Masjid', city: 'Leeds', postcode: 'LS6 1BH',
    address: '9 Woodsley Road, Leeds', contact: 'Kamran Aziz', role: 'Trustee', phone: '0113 245 6677',
    email: 'office@leedsgrandmasjid.org', password: null, status: 'pending', submitted: 3, pricing: null }
];

/* --------------------------------------------------------------- businesses */
const BUSINESSES = [
  { ref: 'MP-2026-AMANAH', code: 'BUS-00101', name: 'Amanah Accounting', category: 'Professional services',
    contact: 'Hassan Ali', phone: '0121 555 0123', email: 'hello@amanahaccounts.co.uk', password: 'Amanah!2026Aa',
    website: 'https://amanahaccounts.co.uk', mosque: 'MSJ-2026-ALHUDA', status: 'activated', submitted: 55,
    description: 'Tax returns, bookkeeping and payroll for small businesses and sole traders across the Midlands.',
    advert: { paid: true, listing: 'enabled' } },
  { ref: 'MP-2026-BARAKH', code: 'BUS-00102', name: 'Barakah Bakes', category: 'Food & catering',
    contact: 'Fatima Khan', phone: '0161 445 7781', email: 'orders@barakahbakes.co.uk', password: 'Barakah!2026Aa',
    website: 'https://barakahbakes.co.uk', mosque: 'MSJ-2026-ALNOOR', status: 'activated', submitted: 48,
    description: 'Halal celebration cakes, dessert tables and daily fresh bakes made in a small Manchester kitchen.',
    advert: { paid: true, listing: 'enabled' } },
  { ref: 'MP-2026-IHSANH', code: 'BUS-00103', name: 'Ihsan Home Care', category: 'Home & trades',
    contact: 'Nadia Begum', phone: '0121 448 9020', email: 'care@ihsanhome.co.uk', password: 'Ihsan!2026Aa',
    website: '', mosque: 'MSJ-2026-GRNLNE', status: 'activated', submitted: 40,
    description: 'Respectful home help, personal care and companionship for elderly members of the community.',
    advert: { paid: true, listing: 'enabled' } },
  { ref: 'MP-2026-NOOROP', code: 'BUS-00104', name: 'Noor Opticians', category: 'Health & wellbeing',
    contact: 'Salman Iqbal', phone: '01274 733 219', email: 'appointments@nooropticians.co.uk', password: 'Nooropt!2026Aa',
    website: 'https://nooropticians.co.uk', mosque: 'MSJ-2026-BRDFRD', status: 'activated', submitted: 26,
    description: 'NHS and private eye tests, designer frames and same-week glazing in the heart of Bradford.',
    advert: { paid: false, listing: 'disabled' } },
  { ref: 'MP-2026-SAFATU', code: 'BUS-00105', name: 'Safa Tutoring', category: 'Education',
    contact: 'Aisha Mahmood', phone: '0121 663 8845', email: 'learn@safatutoring.co.uk', password: 'Safatut!2026Aa',
    website: '', mosque: 'MSJ-2026-ALHUDA', status: 'activated', submitted: 18,
    description: 'GCSE maths and science tuition in small groups, plus Saturday supplementary school support.',
    advert: { paid: true, listing: 'enabled' } },
  // Approved but the mosque has not switched the listing on yet.
  { ref: 'MP-2026-ZAMZAM', code: 'BUS-00106', name: 'Zam Zam Groceries', category: 'Food & catering',
    contact: 'Omar Sheikh', phone: '0121 771 5566', email: 'shop@zamzamgroceries.co.uk', password: 'Zamzam!2026Aa',
    website: '', mosque: 'MSJ-2026-ALHUDA', status: 'activated', submitted: 11,
    description: 'Halal butchers and everyday grocery essentials with free local delivery over £30.',
    advert: { paid: false, listing: 'disabled' } },
  // Fresh application awaiting the mosque's decision.
  { ref: 'MP-2026-RAHMAT', code: null, name: 'Rahma Travel', category: 'Professional services',
    contact: 'Zainab Yusuf', phone: '020 7946 1122', email: 'bookings@rahmatravel.co.uk', password: null,
    website: '', mosque: 'MSJ-2026-ALNOOR', status: 'pending', submitted: 2,
    description: 'ATOL-protected Umrah and Hajj packages with group departures from Manchester and Birmingham.',
    advert: null }
];

/* ----------------------------------------------------------------- products */
const PRODUCTS = [
  { id: 'PRD-TASBIH', name: 'Premium Tasbih Gift Set', category: 'Prayer essentials', price: 24, stock: 40, share: 20,
    image: 'assets/shop/tasbih-gift-set.png', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-ALNOOR', 'MSJ-2026-GRNLNE'],
    description: 'A refined natural-wood tasbih presented in a reusable forest-green gift box.' },
  { id: 'PRD-PRAYERMAT', name: 'Geometric Prayer Mat', category: 'Prayer essentials', price: 32, stock: 25, share: 25,
    image: 'assets/shop/geometric-prayer-mat.png', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-ALNOOR', 'MSJ-2026-BRDFRD'],
    description: 'A premium deep-green prayer mat with warm cream detailing and a soft woven finish.' },
  { id: 'PRD-MISWAK', name: 'Miswak Care Set', category: 'Wellbeing', price: 9.5, stock: 80, share: 30,
    image: 'assets/shop/miswak-care-set.png', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-GRNLNE', 'MSJ-2026-BRDFRD'],
    description: 'Three natural miswak sticks with an airtight travel case and trimming guide.' },
  { id: 'PRD-QURANSTAND', name: 'Carved Qur’an Stand', category: 'Home', price: 28, stock: 18, share: 20,
    image: 'assets/shop/quran-stand.svg', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-GRNLNE'],
    description: 'A folding hardwood rehal with hand-carved edging, sized for a standard mushaf.' },
  { id: 'PRD-ATTAR', name: 'Attar Collection', category: 'Wellbeing', price: 18, stock: 34, share: 25,
    image: 'assets/shop/attar-set.svg', mosques: ['MSJ-2026-ALNOOR', 'MSJ-2026-GRNLNE', 'MSJ-2026-BRDFRD'],
    description: 'Three alcohol-free attars — oud, musk and amber — in a lined presentation case.' },
  { id: 'PRD-DATES', name: 'Ajwa Date Selection', category: 'Food', price: 14, stock: 60, share: 30,
    image: 'assets/shop/dates-box.svg', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-ALNOOR', 'MSJ-2026-BRDFRD'],
    description: 'A 500g presentation box of soft Ajwa dates, ideal for gifting or breaking a fast.' },
  { id: 'PRD-CAP', name: 'Cotton Prayer Cap', category: 'Clothing', price: 7.5, stock: 95, share: 30,
    image: 'assets/shop/prayer-cap.svg', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-ALNOOR', 'MSJ-2026-GRNLNE', 'MSJ-2026-BRDFRD'],
    description: 'Breathable cotton prayer cap with a soft band, machine washable and shape-holding.' },
  { id: 'PRD-ARTPRINT', name: 'Geometric Art Print', category: 'Home', price: 22, stock: 12, share: 20,
    image: 'assets/shop/islamic-art-print.svg', mosques: ['MSJ-2026-ALHUDA', 'MSJ-2026-GRNLNE'],
    description: 'A giclée print of a hand-drawn eight-point geometric pattern, unframed at A3.' },
  // Deliberately out of stock so the shop's stock handling is visible.
  { id: 'PRD-INCENSE', name: 'Bakhoor Burner Set', category: 'Home', price: 26, stock: 0, share: 25,
    image: 'assets/shop/attar-set.svg', mosques: ['MSJ-2026-ALNOOR'],
    description: 'A ceramic bakhoor burner with a starter pack of three traditional blends.' }
];

/* --------------------------------------------------------------------- jobs */
const JOBS = [
  { id: 'JOB-2101', business: 'MP-2026-AMANAH', mosque: 'MSJ-2026-ALHUDA', title: 'Junior Accounts Assistant',
    type: 'Full time', arrangement: 'On-site', city: 'Birmingham', postcode: 'B10 0RX', from: '24000', to: '27000',
    period: 'year', industry: 'Accounting & finance', experience: 'Entry level', education: 'A level or equivalent',
    state: 'live', submitted: 34 },
  { id: 'JOB-2102', business: 'MP-2026-BARAKH', mosque: 'MSJ-2026-ALNOOR', title: 'Weekend Bakery Assistant',
    type: 'Part time', arrangement: 'On-site', city: 'Manchester', postcode: 'M14 5TB', from: '12.50', to: '13.50',
    period: 'hour', industry: 'Hospitality', experience: 'Entry level', education: 'GCSE or equivalent',
    state: 'live', submitted: 27 },
  { id: 'JOB-2103', business: 'MP-2026-IHSANH', mosque: 'MSJ-2026-GRNLNE', title: 'Community Care Worker',
    type: 'Full time', arrangement: 'On-site', city: 'Birmingham', postcode: 'B10 0UZ', from: '23500', to: '26000',
    period: 'year', industry: 'Health & social care', experience: '1–2 years', education: 'GCSE or equivalent',
    state: 'payment_due', submitted: 12 },
  { id: 'JOB-2104', business: 'MP-2026-SAFATU', mosque: 'MSJ-2026-ALHUDA', title: 'GCSE Science Tutor',
    type: 'Part time', arrangement: 'Hybrid', city: 'Birmingham', postcode: 'B10 0RX', from: '22.00', to: '28.00',
    period: 'hour', industry: 'Education', experience: '2–3 years', education: "Bachelor's degree",
    state: 'pending', submitted: 5 },
  { id: 'JOB-2105', business: 'MP-2026-NOOROP', mosque: 'MSJ-2026-BRDFRD', title: 'Optical Assistant',
    type: 'Full time', arrangement: 'On-site', city: 'Bradford', postcode: 'BD8 8AW', from: '23000', to: '25000',
    period: 'year', industry: 'Health & wellbeing', experience: 'Entry level', education: 'GCSE or equivalent',
    state: 'live', submitted: 21 }
];

/* ------------------------------------------------------------ individual */
// A community member with an account, so the individual portal has real content to show.
const CUSTOMER = {
  id: 'CUS-DEMO-0001', name: 'Sumayya Iqbal', email: 'sumayya.iqbal@example.co.uk',
  phone: '07700 900101', password: 'Member!2026Aa',
  address: { line1: '58 Ladypool Road', city: 'Birmingham', postcode: 'B12 8JU' },
  // Roles they have applied for, and the orders placed under the same email.
  applications: [
    { job: 'JOB-2101', status: 'Submitted', ago: 6 },
    { job: 'JOB-2102', status: 'Shortlisted', ago: 15 }
  ]
};

/* ------------------------------------------------------------- shop orders */
// method: collect_pay_now | collect_pay_at_mosque | delivery
const ORDERS = [
  { id: 'ORD-5001', mosque: 'MSJ-2026-ALHUDA', method: 'collect_pay_now', status: 'delivered', payment: 'paid',
    customer: { name: CUSTOMER.name, email: CUSTOMER.email, phone: CUSTOMER.phone },
    lines: [['PRD-TASBIH', 1], ['PRD-CAP', 2]], placed: 21 },
  { id: 'ORD-5002', mosque: 'MSJ-2026-ALHUDA', method: 'collect_pay_at_mosque', status: 'delivered', payment: 'cash',
    customer: { name: 'Ibrahim Malik', email: 'ibrahim.malik@example.co.uk', phone: '07700 900102' },
    lines: [['PRD-DATES', 2]], placed: 18 },
  { id: 'ORD-5003', mosque: 'MSJ-2026-ALHUDA', method: 'delivery', status: 'delivered', payment: 'paid',
    customer: { name: CUSTOMER.name, email: CUSTOMER.email, phone: CUSTOMER.phone },
    address: { line1: '46 Stratford Road', line2: 'Sparkhill', city: 'Birmingham', postcode: 'B11 1AG' },
    lines: [['PRD-PRAYERMAT', 1]], placed: 15 },
  { id: 'ORD-5004', mosque: 'MSJ-2026-ALNOOR', method: 'collect_pay_now', status: 'mosque_received', payment: 'paid',
    customer: { name: 'Yasin Choudhury', email: 'yasin.c@example.co.uk', phone: '07700 900104' },
    lines: [['PRD-ATTAR', 1], ['PRD-DATES', 1]], placed: 9 },
  { id: 'ORD-5005', mosque: 'MSJ-2026-GRNLNE', method: 'delivery', status: 'dispatched', payment: 'paid',
    customer: { name: 'Ruqayyah Sattar', email: 'r.sattar@example.co.uk', phone: '07700 900105' },
    address: { line1: '3 Alum Rock Road', line2: '', city: 'Birmingham', postcode: 'B8 1JB' },
    lines: [['PRD-QURANSTAND', 1], ['PRD-MISWAK', 2]], placed: 6 },
  { id: 'ORD-5006', mosque: 'MSJ-2026-BRDFRD', method: 'collect_pay_at_mosque', status: 'mosque_received', payment: 'pay_at_mosque',
    customer: { name: 'Abdullah Rashid', email: 'a.rashid@example.co.uk', phone: '07700 900106' },
    lines: [['PRD-CAP', 3], ['PRD-MISWAK', 1]], placed: 4 },
  { id: 'ORD-5007', mosque: 'MSJ-2026-ALHUDA', method: 'collect_pay_now', status: 'preparing', payment: 'submitted',
    customer: { name: 'Maryam Siddiqui', email: 'm.siddiqui@example.co.uk', phone: '07700 900107' },
    lines: [['PRD-ARTPRINT', 1]], placed: 2 },
  { id: 'ORD-5008', mosque: 'MSJ-2026-ALNOOR', method: 'collect_pay_now', status: 'ordered', payment: 'awaiting_bank_transfer',
    customer: { name: 'Zakariya Patel', email: 'z.patel@example.co.uk', phone: '07700 900108' },
    lines: [['PRD-TASBIH', 1]], placed: 1 },
  { id: 'ORD-5009', mosque: 'MSJ-2026-GRNLNE', method: 'collect_pay_at_mosque', status: 'delivered', payment: 'cash',
    customer: { name: 'Khadija Bano', email: 'k.bano@example.co.uk', phone: '07700 900109' },
    lines: [['PRD-MISWAK', 3]], placed: 13 }
];

/* --------------------------------------------------------------------- build */
const mosqueByRef = Object.fromEntries(MOSQUES.map(m => [m.ref, m]));
const businessByRef = Object.fromEntries(BUSINESSES.map(b => [b.ref, b]));
const productById = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

const applications = [];
const accounts = [];
const pricing = [];
const notifications = [];
const notify = (audience, title, message, href, key, agoDays) =>
  notifications.push({ id: `NTF-${key}`, audience, title, message, href, key, read: false, createdAt: day(agoDays) });

for (const m of MOSQUES) {
  applications.push({
    id: m.ref, type: 'masjid', name: m.name, email: m.email, reference: m.ref,
    status: m.status, submittedAt: day(m.submitted),
    details: {
      'Masjid name': m.name, 'Address': `${m.address}, ${m.postcode}`, 'Postcode': m.postcode,
      'Primary contact': m.contact, 'Role': m.role, 'Contact number': m.phone, 'Email': m.email
    },
    ...(m.status === 'pending' ? {} : {
      accountStatus: 'active',
      note: 'Verified against Charity Commission listing and a site visit.',
      decidedAt: day(m.submitted - 2)
    }),
    ...(m.status === 'activated' ? { activatedAt: day(m.submitted - 3) } : {})
  });
  if (m.status === 'activated') {
    accounts.push({ reference: m.ref, email: m.email, verified: true, activatedAt: day(m.submitted - 3), passwordHash: hash(m.password) });
  }
  if (m.pricing) {
    pricing.push({
      masjidReference: m.ref, masjidName: m.name, ...m.pricing, acceptingListings: true,
      shopFulfilment: m.shop, shopDeliveryFee: m.deliveryFee, updatedAt: day(m.submitted - 2)
    });
  }
}
notify('admin', 'New masjid registration', `${mosqueByRef['MSJ-2026-LEEDSG'].name} has applied to join the platform.`, 'admin-applications.html', 'seed-masjid-pending', 3);

const requests = [];
for (const b of BUSINESSES) {
  const mosque = mosqueByRef[b.mosque];
  const rate = pricing.find(p => p.masjidReference === b.mosque);
  const snapshot = rate ? {
    masjidReference: mosque.ref, advertisingPrice: rate.advertisingPrice, adminPercent: rate.adminPercent,
    mosquePercent: rate.mosquePercent, adminAmount: Number((rate.advertisingPrice * rate.adminPercent / 100).toFixed(2)),
    mosqueAmount: Number((rate.advertisingPrice * rate.mosquePercent / 100).toFixed(2)),
    pricingUpdatedAt: rate.updatedAt, capturedAt: day(b.submitted)
  } : null;
  applications.push({
    id: b.ref, type: 'business', name: b.name, email: b.email, reference: b.ref,
    ...(b.code ? { businessCode: b.code } : {}),
    status: b.status, submittedAt: day(b.submitted),
    ...(snapshot ? { price: rate.advertisingPrice, pricingSnapshot: snapshot } : {}),
    details: {
      'Business name': b.name, 'Category': b.category, 'Selected masjid': mosque.name,
      'Agreed monthly price': rate ? `£${rate.advertisingPrice.toFixed(2)}` : 'Not set',
      'Admin cut': rate ? `${rate.adminPercent}%` : '—', 'Mosque share': rate ? `${rate.mosquePercent}%` : '—',
      'Contact name': b.contact, 'Contact email': b.email, 'Business email': b.email,
      'Business phone': b.phone, 'Website': b.website || 'Not provided', 'Description': b.description
    },
    ...(b.status === 'pending' ? {} : { accountStatus: 'active', decidedAt: day(b.submitted - 1) }),
    ...(b.status === 'activated' ? { activatedAt: day(b.submitted - 2) } : {})
  });
  if (b.status === 'activated') {
    accounts.push({ reference: b.ref, email: b.email, verified: true, activatedAt: day(b.submitted - 2), passwordHash: hash(b.password) });
  }
  requests.push({
    id: b.ref, reference: b.ref, masjid: mosque.name, masjidReference: mosque.ref, type: 'business',
    ...(b.code ? { businessCode: b.code } : {}),
    name: b.name, category: b.category, contact: b.contact, email: b.email, contactEmail: b.email,
    phone: b.phone, description: b.description, website: b.website,
    status: b.status === 'pending' ? 'pending' : 'approved',
    listing: b.advert ? b.advert.listing : 'disabled',
    paymentStatus: b.advert?.paid ? 'paid' : (b.status === 'pending' ? 'not_due' : 'due'),
    ...(rate ? { price: rate.advertisingPrice, pricingSnapshot: snapshot } : {}),
    submittedAt: day(b.submitted),
    ...(b.status === 'pending' ? {} : { decidedAt: day(b.submitted - 1) })
  });
  if (b.status === 'pending') {
    notify(`masjid:${mosque.name}`, 'New business application', `${b.name} wants to advertise through your mosque.`,
      `masjid-portal.html?request=${b.ref}#requests`, `seed-request-${b.ref}`, b.submitted);
  }
}

const products = PRODUCTS.map(p => ({
  id: p.id, name: p.name, description: p.description, category: p.category, price: p.price,
  stock: p.stock, mosqueSharePercent: p.share,
  mosques: p.mosques.map(ref => ({ reference: ref, name: mosqueByRef[ref].name })),
  image: p.image, visibility: 'visible', createdAt: day(50), updatedAt: day(20)
}));

const jobs = JOBS.map(j => {
  const b = businessByRef[j.business], mosque = mosqueByRef[j.mosque];
  const rate = pricing.find(p => p.masjidReference === j.mosque);
  const choice = {
    name: mosque.name, reference: mosque.ref, fee: rate.jobPrice,
    adminPercent: rate.adminPercent, mosquePercent: rate.mosquePercent,
    status: j.state === 'pending' ? 'pending' : 'approved',
    paymentStatus: j.state === 'live' ? 'paid' : j.state === 'payment_due' ? 'due' : 'not_due'
  };
  return {
    id: j.id, title: j.title, business: b.name, businessReference: b.ref, businessCode: b.code,
    employmentType: j.type, arrangement: j.arrangement, city: j.city, postcode: j.postcode,
    salaryFrom: j.from, salaryTo: j.to, payPeriod: j.period,
    shortDescription: `${j.title} with ${b.name}.`,
    description: `${b.name} is recruiting a ${j.title.toLowerCase()} to support the team in ${j.city}. This role is advertised through ${mosque.name}.`,
    responsibilities: 'Support daily operations, keep accurate records and work respectfully with community members.',
    requirements: 'Reliable, organised and comfortable working with people from a range of backgrounds.',
    benefits: 'Pension, paid holiday and prayer-friendly scheduling.',
    industry: j.industry, experienceLevel: j.experience, educationLevel: j.education,
    closingDate: '2026-12-31', tags: [j.industry.toLowerCase()],
    masjids: [choice], masjid: mosque.name, fee: rate.jobPrice,
    status: j.state === 'live' ? 'live' : j.state === 'payment_due' ? 'payment due' : 'pending',
    enabled: j.state === 'live', submittedAt: day(j.submitted)
  };
});
notify(`masjid:${mosqueByRef['MSJ-2026-ALHUDA'].name}`, 'New job request',
  `Safa Tutoring asked to advertise "GCSE Science Tutor" through your mosque.`,
  'masjid-portal.html#jobs', 'seed-job-pending', 5);

const shopOrders = ORDERS.map(o => {
  const mosque = mosqueByRef[o.mosque];
  const rate = pricing.find(p => p.masjidReference === o.mosque);
  const items = o.lines.map(([id, qty]) => {
    const p = productById[id];
    return {
      productId: p.id, name: p.name, description: p.description, image: p.image,
      quantity: qty, price: p.price, mosqueSharePercent: p.share,
      mosqueRevenue: Number((p.price * qty * p.share / 100).toFixed(2))
    };
  });
  const goods = Number(items.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2));
  const fee = o.method === 'delivery' ? rate.shopDeliveryFee : 0;
  const total = Number((goods + fee).toFixed(2));
  const mosqueRevenue = Number(items.reduce((s, i) => s + i.mosqueRevenue, 0).toFixed(2));
  const cash = o.payment === 'cash';
  const order = {
    id: o.id, customer: o.customer,
    collectionMasjidReference: mosque.ref, collectionMasjidName: mosque.name,
    fulfilmentMethod: o.method, items, goodsTotal: goods, deliveryFee: fee, total, mosqueRevenue,
    status: o.status, paymentStatus: cash ? 'paid' : o.payment,
    paymentReference: `SHOP-PAY-${o.id.replace(/\D/g, '')}`,
    placedAt: day(o.placed),
    history: [{ status: 'ordered', at: day(o.placed), by: 'customer' }]
  };
  if (o.address) order.deliveryAddress = o.address;
  if (cash) {
    order.cashTakenAtMosque = total;
    order.mosqueOwesAdmin = Number((total - mosqueRevenue).toFixed(2));
    order.paidAt = day(o.placed - 1);
    order.paymentVerifiedBy = `masjid:${mosque.ref}`;
  }
  if (o.payment === 'paid' && !cash) order.paidAt = day(o.placed - 1);
  return order;
});

// One piece of evidence awaiting review, so the admin proof queue is not empty.
const pendingProofOrder = shopOrders.find(o => o.paymentStatus === 'submitted');
if (pendingProofOrder) {
  pendingProofOrder.paymentEvidence = {
    fileName: 'bank-transfer-confirmation.svg', fileType: 'image/svg+xml',
    fileData: 'assets/test-payment-proof-217765.svg'
  };
}

const paymentProofs = [{
  id: 'PAY-SEED-0001', invoice: 'PENDING', businessCode: 'BUS-00104', businessName: 'Noor Opticians',
  amount: 18, date: dayOnly(3), bankReference: 'NOOR-2026-0803', fileName: 'bank-transfer-confirmation.svg',
  fileType: 'image/svg+xml', fileData: 'assets/test-payment-proof-217765.svg',
  status: 'submitted', submittedAt: day(3), adminNote: ''
}];
notify('admin', 'Payment proof awaiting verification', 'Noor Opticians submitted £18.00 for its advertising invoice.',
  'admin-payments.html?proof=PAY-SEED-0001#proofs', 'seed-proof-pending', 3);

// The server derives "paid" for jobs and adverts from a settled invoice line, so anything the
// seed calls paid needs a real invoice and a matching bank payment behind it.
const financeAccounts = BUSINESSES.filter(b => b.code).map(b => ({
  code: b.code, name: b.name, email: b.email, invoices: [], payments: []
}));
const accountByCode = Object.fromEntries(financeAccounts.map(a => [a.code, a]));
let invoiceSeq = 700;

function settledInvoice(code, lines, agoDays, reference) {
  const account = accountByCode[code];
  if (!account || !lines.length) return;
  const amount = Number(lines.reduce((s, l) => s + l.amount, 0).toFixed(2));
  const number = `INV-2026-00${invoiceSeq++}`;
  const shares = {};
  lines.forEach(l => { shares[l.masjid] = Number(((shares[l.masjid] || 0) + l.amount * l.mosquePercent / 100).toFixed(2)); });
  account.invoices.unshift({
    number, date: dayOnly(agoDays), due: dayOnly(agoDays - 14),
    amount, paid: amount, shares, lines, workflow: true
  });
  account.payments.unshift({ amount, date: dayOnly(agoDays - 2), bankReference: reference, invoice: number });
}

// Paid job listings.
for (const j of JOBS.filter(x => x.state === 'live')) {
  const b = businessByRef[j.business], mosque = mosqueByRef[j.mosque];
  const rate = pricing.find(p => p.masjidReference === j.mosque);
  settledInvoice(b.code, [{
    jobId: j.id, kind: 'job', description: `${j.title} — ${mosque.name}`, masjid: mosque.name,
    amount: rate.jobPrice, adminPercent: rate.adminPercent, mosquePercent: rate.mosquePercent
  }], j.submitted - 3, `FT-${j.id.replace(/\D/g, '')}`);
}
// Paid business adverts.
for (const b of BUSINESSES.filter(x => x.advert?.paid)) {
  const mosque = mosqueByRef[b.mosque];
  const rate = pricing.find(p => p.masjidReference === b.mosque);
  settledInvoice(b.code, [{
    requestId: b.ref, kind: 'advertising', description: `Business advertising — ${mosque.name}`, masjid: mosque.name,
    amount: rate.advertisingPrice, adminPercent: rate.adminPercent, mosquePercent: rate.mosquePercent
  }], b.submitted - 4, `FT-${b.code.replace(/\D/g, '')}`);
}

// The demo individual's job applications, matched to their account by email.
const jobApplications = CUSTOMER.applications.map((entry, index) => {
  const spec = JOBS.find(j => j.id === entry.job);
  const business = businessByRef[spec.business];
  return {
    reference: `APP-2026-DEMO${index + 1}`, jobId: spec.id, jobTitle: spec.title,
    business: business.name, businessReference: business.ref, businessCode: business.code,
    fullName: CUSTOMER.name, email: CUSTOMER.email, phone: CUSTOMER.phone,
    experienceYears: '3–5 years', status: entry.status, submittedAt: day(entry.ago)
  };
});

const state = {
  masjidPointJobs: jobs,
  masjidPointFinance: { accounts: financeAccounts, unmatched: [], settled: {}, settlementHistory: [], audit: [], cashRemittances: [] },
  masjidPointPaymentProofs: paymentProofs,
  masjidPointBusinessRequests: requests,
  masjidPointBusinessListings: [],
  masjidPointAdminApplications: applications,
  masjidPointActivatedAccounts: accounts,
  masjidPointJobApplications: jobApplications,
  masjidPointMasjidPricing: pricing,
  masjidPointProducts: products,
  masjidPointShopOrders: shopOrders,
  masjidPointPlatformSettings: {
    bankDetails: {
      active: true, accountName: 'MasjidPoint Community Ltd', bankName: 'Lloyds Bank',
      sortCode: '30-96-26', accountNumber: '48210577', iban: '',
      instructions: 'Use the payment reference shown with your order or invoice so we can match your transfer.',
      updatedAt: day(60)
    }
  },
  masjidPointCustomers: [{ id: CUSTOMER.id, name: CUSTOMER.name, email: CUSTOMER.email, phone: CUSTOMER.phone, address: CUSTOMER.address, status: 'active', emailVerified: true, passwordHash: hash(CUSTOMER.password), createdAt: day(20) }],
  masjidPointNotifications: notifications,
  masjidPointAdminUsers: [{
    id: 'ADM-0001', name: 'Platform Owner', email: 'admin@masjidpoint.co.uk', role: 'super_admin',
    status: 'active', passwordHash: hash(ADMIN_PASSWORD), createdAt: day(90)
  }],
  masjidPointEmailTokens: []
};

const summary = () => {
  console.log('MasjidPoint demo dataset');
  console.log('  mosques            ', MOSQUES.length, `(${MOSQUES.filter(m => m.status === 'activated').length} activated, ${MOSQUES.filter(m => m.status === 'approved').length} approved, ${MOSQUES.filter(m => m.status === 'pending').length} pending)`);
  console.log('  businesses         ', BUSINESSES.length, `(${BUSINESSES.filter(b => b.advert?.listing === 'enabled').length} live adverts)`);
  console.log('  products           ', PRODUCTS.length, `(${PRODUCTS.filter(p => p.stock === 0).length} out of stock)`);
  console.log('  jobs               ', JOBS.length, `(${JOBS.filter(j => j.state === 'live').length} live)`);
  console.log('  shop orders        ', ORDERS.length, `(${ORDERS.filter(o => o.method === 'delivery').length} delivery, ${ORDERS.filter(o => o.payment === 'cash').length} paid in cash)`);
  console.log('  notifications      ', notifications.length);
  console.log('');
  console.log('Sign in with:');
  console.log('  individual         ' + CUSTOMER.email + ' / ' + CUSTOMER.password);
  console.log('  admin              admin@masjidpoint.co.uk / ' + ADMIN_PASSWORD);
  MOSQUES.filter(m => m.password).forEach(m => console.log('  masjid             ' + m.email + ' / ' + m.password));
  BUSINESSES.filter(b => b.password).forEach(b => console.log('  business           ' + b.email + ' / ' + b.password));
};

// Required as a module, this file is the single source of truth for demo credentials so the
// test suite never has to guess at seeded emails or passwords.
module.exports = { MOSQUES, BUSINESSES, PRODUCTS, JOBS, ORDERS, CUSTOMER, ADMIN_PASSWORD, state };

if (require.main === module) {
  if (process.argv.includes('--print')) { summary(); process.exit(0); }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state, null, 2));
  console.log(`Wrote ${target}`);
  summary();
}
