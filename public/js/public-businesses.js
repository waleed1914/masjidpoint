// Home page business directory. Renders every paid, masjid-enabled listing. Card artwork is
// drawn from the brand palette rather than fetched, so the page has no external image
// dependencies and never shows an empty tile when a photo is missing.
(async function () {
  const grid = document.querySelector('#business-grid');
  if (!grid || !window.MasjidDB) return;
  const state = await MasjidDB.state();

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const listings = (state.masjidPointBusinessRequests || []).filter(r =>
    r.status === 'approved' && r.paymentStatus === 'paid' && r.listing === 'enabled');

  const TONES = {
    'Food & catering': 'tone-food',
    'Professional services': 'tone-professional',
    'Home & trades': 'tone-home',
    'Education': 'tone-education',
    'Health & wellbeing': 'tone-health'
  };
  const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  grid.innerHTML = listings.map(request => `
    <article class="business-card" data-category="${esc(request.category || 'Other')}" data-request-id="${esc(request.id)}" data-masjid="${esc(request.masjid || '')}">
      <div class="card-image ${TONES[request.category] || 'tone-default'}">
        <span class="verified">✓ Masjid verified</span>
        <span class="card-mark">${esc(initials(request.name))}</span>
      </div>
      <div class="card-body">
        <span class="category">${esc(request.category || 'Local business')}</span>
        <h3>${esc(request.name)}</h3>
        <p>${esc(request.description || `Supporting the community through ${request.masjid}.`)}</p>
        <div class="card-meta">
          <span>⌂ ${esc(request.masjid)}</span>
          <a class="card-link" href="masjid-adverts?reference=${encodeURIComponent(request.masjidReference || '')}">View masjid →</a>
        </div>
      </div>
    </article>`).join('');

  grid.hidden = !listings.length;
  const empty = document.querySelector('#empty-state');
  if (empty) empty.hidden = listings.length > 0;

  // A masjid can be preselected from a QR code or a directory link.
  const params = new URLSearchParams(location.search);
  const reference = params.get('masjidReference');
  const requestedName = params.get('masjid');
  const mosque = (state.masjidPointAdminApplications || []).find(app =>
    app.type === 'masjid' && (app.reference === reference || app.name === requestedName));
  const selectedName = mosque?.name || requestedName;
  if (selectedName) {
    const filter = document.querySelector('#masjid-filter');
    if (filter && [...filter.options].some(o => o.value === selectedName)) filter.value = selectedName;
    const heading = document.querySelector('#discover .section-heading');
    if (heading && !heading.querySelector('.directory-mosque-filter')) {
      const note = document.createElement('p');
      note.className = 'directory-mosque-filter';
      note.innerHTML = `Showing listings connected to <strong>${esc(selectedName)}</strong> · <a href="/#discover">Clear filter</a>`;
      heading.appendChild(note);
    }
  }
  if (typeof window.filterBusinessCards === 'function') window.filterBusinessCards();
})();
