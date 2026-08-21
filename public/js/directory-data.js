// Shared helpers for the public masjid, business and shop directories.
(function (root) {
  const CITY_KEYS = ['City', 'Town', 'Town or city'];

  function cityOf(mosque) {
    const details = mosque?.details || {};
    for (const key of CITY_KEYS) if (details[key]) return String(details[key]).trim();
    const parts = String(details.Address || '').split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const candidate = /^[A-Z]{1,2}\d/i.test(last) ? parts[parts.length - 2] : last;
      if (candidate && !/^\d/.test(candidate)) return candidate;
    }
    const postcode = String(details.Postcode || '').trim();
    return postcode ? postcode.split(' ')[0] : 'United Kingdom';
  }

  function areaOf(mosque) {
    const postcode = String(mosque?.details?.Postcode || '').trim().toUpperCase();
    const outward = postcode.split(/\s+/)[0];
    return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? outward : '';
  }

  const operationalMosques = db => (db.masjidPointAdminApplications || [])
    .filter(app => app.type === 'masjid' && ['approved', 'activated'].includes(app.status));
  const liveAdverts = db => (db.masjidPointBusinessRequests || [])
    .filter(request => request.status === 'approved'
      && ['paid', 'trial'].includes(request.paymentStatus)
      && request.listing === 'enabled');
  const liveJobs = db => (db.masjidPointJobs || []).filter(job => job.status === 'live' && job.enabled);
  const sellableProducts = db => (db.masjidPointProducts || [])
    .filter(product => product.visibility !== 'hidden' && product.stock > 0);

  function mosqueSummary(db, mosque) {
    const adverts = liveAdverts(db).filter(request =>
      request.masjidReference === mosque.reference || request.masjid === mosque.name).length;
    const jobs = liveJobs(db).filter(job => (job.masjids || []).some(item =>
      (item.reference === mosque.reference || item.name === mosque.name) && item.paymentStatus === 'paid')).length;
    const shop = sellableProducts(db).filter(product =>
      (product.mosques || []).some(item => item.reference === mosque.reference)).length;
    return {
      mosque,
      city: cityOf(mosque),
      area: areaOf(mosque),
      postcode: mosque.details?.Postcode || '',
      adverts,
      jobs,
      shop,
      activity: adverts + jobs + shop
    };
  }

  root.DirectoryData = {
    cityOf, areaOf, operationalMosques, liveAdverts, liveJobs, sellableProducts, mosqueSummary
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
