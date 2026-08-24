// Everything on the home page that used to be hardcoded — masjid cards, the hero counters, the
// masjid filter, category chips and the job preview — is derived from live data here, so the
// page can never advertise a masjid, business or figure that does not exist.
(async function () {
  if (!window.MasjidDB) return;
  const state = await MasjidDB.state();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `£${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

  const mosques = (state.masjidPointAdminApplications || [])
    .filter(app => app.type === 'masjid' && ['approved', 'activated'].includes(app.status));
  const adverts = (state.masjidPointBusinessRequests || []).filter(r =>
    r.status === 'approved' && r.paymentStatus === 'paid' && r.listing === 'enabled');
  const jobs = (state.masjidPointJobs || []).filter(job => job.status === 'live' && job.enabled);
  const products = (state.masjidPointProducts || []).filter(p => p.visibility !== 'hidden' && p.stock > 0);

  /* -------------------------------------------------------------- hero stats */
  // "Raised for masjids" is the mosque share of everything actually paid for — listings,
  // job fees and shop sales — not an invented headline number.
  const listingShare = [...adverts].reduce((sum, r) =>
    sum + Number(r.pricingSnapshot?.mosqueAmount ?? (Number(r.price || 0) * Number(r.pricingSnapshot?.mosquePercent ?? 70) / 100)), 0);
  const jobShare = jobs.reduce((sum, job) => sum + (job.masjids || [])
    .filter(m => m.paymentStatus === 'paid')
    .reduce((s, m) => s + Number(m.fee || 0) * Number(m.mosquePercent ?? 70) / 100, 0), 0);
  const shopShare = (state.masjidPointShopOrders || [])
    .filter(o => o.paymentStatus === 'paid')
    .reduce((sum, o) => sum + Number(o.mosqueRevenue || 0), 0);

  const setText = (id, value) => { const node = document.querySelector(id); if (node) node.textContent = value; };
  setText('#stat-businesses', adverts.length);
  setText('#stat-masjids', mosques.length);
  setText('#stat-support', money(listingShare + jobShare + shopShare));

  /* --------------------------------------------------------- masjid dropdown */
  const filter = document.querySelector('#masjid-filter');
  if (filter) mosques.map(m => m.name).sort().forEach(name => filter.add(new Option(name, name)));

  /* ------------------------------------------------------------ category chips */
  const chips = document.querySelector('#category-chips');
  if (chips) {
    [...new Set(adverts.map(a => a.category).filter(Boolean))].sort().forEach(category => {
      const button = document.createElement('button');
      button.className = 'chip';
      button.dataset.category = category;
      button.textContent = category;
      chips.appendChild(button);
    });
  }

  /* -------------------------------------------------------------- masjid grid */
  const grid = document.querySelector('#masjid-grid');
  if (grid) {
    const cards = mosques.map(mosque => {
      const businesses = adverts.filter(r => r.masjidReference === mosque.reference || r.masjid === mosque.name).length;
      const roles = jobs.filter(job => (job.masjids || []).some(m =>
        (m.reference === mosque.reference || m.name === mosque.name) && m.paymentStatus === 'paid')).length;
      const shop = products.filter(p => (p.mosques || []).some(m => m.reference === mosque.reference)).length;
      const city = String(mosque.details?.Address || '').split(',').slice(-2, -1)[0]?.trim()
        || mosque.details?.Postcode || 'United Kingdom';
      return { mosque, businesses, roles, shop, city, activity: businesses + roles + shop };
    }).sort((a, b) => b.activity - a.activity);

    // The busiest masjid takes the wide tile, so the grid leads with real activity.
    grid.innerHTML = cards.map((card, index) => {
      const parts = [
        card.businesses ? `${card.businesses} business${card.businesses === 1 ? '' : 'es'}` : '',
        card.roles ? `${card.roles} job${card.roles === 1 ? '' : 's'}` : '',
        card.shop ? `${card.shop} shop item${card.shop === 1 ? '' : 's'}` : ''
      ].filter(Boolean);
      return `<a class="masjid-card${index === 0 ? ' masjid-card-large' : ''}" href="masjid-adverts?reference=${encodeURIComponent(card.mosque.reference)}">
        <span class="masjid-card-art${card.mosque.photo ? ' has-photo' : ''}" aria-hidden="true">${card.mosque.photo
          ? `<img src="${esc(card.mosque.photo)}" alt="" loading="lazy" onerror="this.closest('.masjid-card-art').classList.remove('has-photo');this.remove()">`
          : ''}<i></i><b></b></span>
        <span class="masjid-overlay">
          <small>${esc(card.city)}</small>
          <strong>${esc(card.mosque.name)}</strong>
          <em>${esc(parts.join(' · ') || 'View directory')} →</em>
        </span>
      </a>`;
    }).join('');
    const empty = document.querySelector('#masjid-empty');
    if (empty) empty.hidden = cards.length > 0;
    grid.hidden = !cards.length;

    // Point the shop banner at a masjid that actually has stock.
    const withShop = cards.find(c => c.shop > 0);
    const cta = document.querySelector('#shop-cta');
    if (cta && withShop) cta.href = `masjid-shop?reference=${encodeURIComponent(withShop.mosque.reference)}`;
    const mobileCta = document.querySelector('.shop-mobile-cta');
    if (mobileCta && withShop) mobileCta.href = `masjid-shop?reference=${encodeURIComponent(withShop.mosque.reference)}`;

    // Build the homepage product preview from this same confirmed state response. Previously it
    // relied on a second async homepage task, which could leave the label and button with an empty
    // space between them on slower mobile loads.
    const shopPreview = document.querySelector('#shop-preview');
    if (shopPreview && products.length) {
      shopPreview.removeAttribute('aria-hidden');
      shopPreview.innerHTML = products.slice(0, 4).map(product => {
        const selectedMosque = (product.mosques || [])[0];
        if (!selectedMosque) return '';
        return `<a href="masjid-shop?reference=${encodeURIComponent(selectedMosque.reference)}">
          <img src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy" onerror="this.style.visibility='hidden'">
          <span>${esc(product.name)}<b>${money(product.price)}</b></span>
        </a>`;
      }).join('');
    }
    window.refreshHomeGrid?.('#masjid-grid');
    window.dispatchEvent(new CustomEvent('masjidpoint:masjids-rendered'));
  }

  /* -------------------------------------------------------------- job preview */
  const preview = document.querySelector('#home-job-preview');
  if (preview) {
    const recent = [...jobs].sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))).slice(0, 3);
    preview.innerHTML = recent.map(job => {
      const days = Math.max(0, Math.round((Date.now() - new Date(job.submittedAt || Date.now())) / 86400000));
      return `<a class="job-card" href="public-jobs?job=${encodeURIComponent(job.id)}">
        <span class="job-logo">${esc(String(job.business || '?')[0])}</span>
        <div><h3>${esc(job.title)}</h3><p>${esc(job.business)} · ${esc(job.city)}</p><small>${esc(job.employmentType)} &nbsp;•&nbsp; ${days === 0 ? 'Posted today' : `Posted ${days} day${days === 1 ? '' : 's'} ago`}</small></div>
        <span class="job-arrow">→</span>
      </a>`;
    }).join('') || '<p class="empty-state">No live jobs right now.</p>';
  }
})();
