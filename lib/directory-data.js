// Shared helpers for the public masjid and business directories. Registered masjids only store
// a free-text address, so the town is parsed from it rather than assumed to exist as a field.
(function (root) {
  const CITY_KEYS = ['City', 'Town', 'Town or city'];

  function cityOf(mosque) {
    const details = mosque?.details || {};
    for (const key of CITY_KEYS) if (details[key]) return String(details[key]).trim();
    // "14 Coventry Road, Birmingham, B10 0RX" -> "Birmingham"
    const parts = String(details.Address || '').split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const looksLikePostcode = /^[A-Z]{1,2}\d/i.test(last);
      const candidate = looksLikePostcode ? parts[parts.length - 2] : last;
      if (candidate && !/^\d/.test(candidate)) return candidate;
    }
    const postcode = String(details.Postcode || '').trim();
    return postcode ? postcode.split(' ')[0] : 'United Kingdom';
  }

  // The postcode district — "B10 0RX" -> "B10" — which is how people describe a local area.
  function areaOf(mosque) {
    const postcode = String(mosque?.details?.Postcode || '').trim().toUpperCase();
    const outward = postcode.split(/\s+/)[0];
    return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? outward : '';
  }

  const operationalMosques = db => (db.masjidPointAdminApplications || [])
    .filter(app => app.type === 'masjid' && ['approved', 'activated'].includes(app.status));

  const liveAdverts = db => (db.masjidPointBusinessRequests || [])
    // A trial listing is as public as a paid one — that is the point of it. What separates them is
  // that a trial has an end date and is never invoiced until it reaches it.
  .filter(r => r.status === 'approved' && ['paid', 'trial'].includes(r.paymentStatus) && r.listing === 'enabled');

  const liveJobs = db => (db.masjidPointJobs || []).filter(job => job.status === 'live' && job.enabled);

  const sellableProducts = db => (db.masjidPointProducts || [])
    .filter(p => p.visibility !== 'hidden' && p.stock > 0);

  // Everything a directory card needs about one masjid, counted from live records.
  function mosqueSummary(db, mosque) {
    const adverts = liveAdverts(db).filter(r => r.masjidReference === mosque.reference || r.masjid === mosque.name).length;
    const jobs = liveJobs(db).filter(job => (job.masjids || []).some(m =>
      (m.reference === mosque.reference || m.name === mosque.name) && m.paymentStatus === 'paid')).length;
    const shop = sellableProducts(db).filter(p => (p.mosques || []).some(m => m.reference === mosque.reference)).length;
    return { mosque, city: cityOf(mosque), area: areaOf(mosque), postcode: mosque.details?.Postcode || '', adverts, jobs, shop, activity: adverts + jobs + shop };
  }

  const api = { cityOf, areaOf, operationalMosques, liveAdverts, liveJobs, sellableProducts, mosqueSummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DirectoryData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
