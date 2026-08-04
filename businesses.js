// Full business directory with search, category, city and masjid filters. A business inherits
// its city from the masjid it advertises through, since listings carry no address of their own.
(async function () {
  const state = await MasjidDB.state();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const mosques = DirectoryData.operationalMosques(state);
  const byRef = Object.fromEntries(mosques.map(m => [m.reference, m]));
  const byName = Object.fromEntries(mosques.map(m => [m.name, m]));

  const listings = DirectoryData.liveAdverts(state).map(request => {
    const mosque = byRef[request.masjidReference] || byName[request.masjid] || null;
    return { request, mosque, city: mosque ? DirectoryData.cityOf(mosque) : 'United Kingdom' };
  });

  const search = document.querySelector('#business-search');
  const categoryFilter = document.querySelector('#category-filter');
  const cityFilter = document.querySelector('#city-filter');
  const masjidFilter = document.querySelector('#masjid-filter');
  const results = document.querySelector('#business-results');
  const empty = document.querySelector('#business-empty');
  const count = document.querySelector('#result-count');

  [...new Set(listings.map(l => l.request.category).filter(Boolean))].sort().forEach(c => categoryFilter.add(new Option(c, c)));
  [...new Set(listings.map(l => l.city))].sort().forEach(c => cityFilter.add(new Option(c, c)));
  [...new Set(listings.map(l => l.request.masjid).filter(Boolean))].sort().forEach(m => masjidFilter.add(new Option(m, m)));

  // Support arriving from a masjid page or the home search with a filter already applied.
  const params = new URLSearchParams(location.search);
  const preset = (select, value) => { if (value && [...select.options].some(o => o.value === value)) select.value = value; };
  preset(categoryFilter, params.get('category'));
  preset(cityFilter, params.get('city'));
  preset(masjidFilter, params.get('masjid') || byRef[params.get('masjidReference')]?.name);
  if (params.get('q')) search.value = params.get('q');

  function render() {
    const q = search.value.toLowerCase().trim();
    const list = listings.filter(l =>
      (categoryFilter.value === 'all' || l.request.category === categoryFilter.value)
      && (cityFilter.value === 'all' || l.city === cityFilter.value)
      && (masjidFilter.value === 'all' || l.request.masjid === masjidFilter.value)
      && (!q || `${l.request.name} ${l.request.description} ${l.request.category} ${l.request.masjid} ${l.city}`.toLowerCase().includes(q))
    ).sort((a, b) => a.request.name.localeCompare(b.request.name));

    results.innerHTML = list.map(({ request, mosque, city }) => `
      <article class="business-tile"${request.website ? ` data-website="${esc(request.website)}"` : ''}>
        <header>
          <span class="business-mark">${esc(initials(request.name))}</span>
          <div>
            <h2>${request.website
              ? `<a class="business-name-link" href="${esc(request.website)}" target="_blank" rel="noopener">${esc(request.name)}</a>`
              : esc(request.name)}</h2>
            <span class="business-tags"><em class="business-category">${esc(request.category || 'Local business')}</em><em class="business-place">${esc(city)}</em></span>
          </div>
        </header>
        <p>${esc(request.description || '')}</p>
        <dl>
          ${request.phone ? `<div><dt>Phone</dt><dd><a href="tel:${esc(String(request.phone).replace(/\s+/g, ''))}">${esc(request.phone)}</a></dd></div>` : ''}
          ${request.email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(request.email)}">${esc(request.email)}</a></dd></div>` : ''}
          ${request.website ? `<div><dt>Website</dt><dd><a href="${esc(request.website)}" target="_blank" rel="noopener">Visit site ↗</a></dd></div>` : ''}
        </dl>
        <footer>
          <span class="business-verified">✓ Approved by this masjid</span>
          ${mosque
            ? `<a class="via-masjid" href="masjid-adverts?reference=${encodeURIComponent(mosque.reference)}">${esc(request.masjid)} <b aria-hidden="true">→</b></a>`
            : `<span>${esc(request.masjid || '')}</span>`}
        </footer>
      </article>`).join('');

    empty.hidden = list.length > 0;
    results.hidden = !list.length;
    const filtered = q || categoryFilter.value !== 'all' || cityFilter.value !== 'all' || masjidFilter.value !== 'all';
    count.innerHTML = filtered
      ? `<strong>${list.length}</strong> of ${listings.length} businesses match`
      : `<strong>${listings.length}</strong> business${listings.length === 1 ? '' : 'es'} listed`;
  }

  // The whole card opens the business's website. The name is a real link so keyboard and screen
  // reader users get one too; this only adds the surrounding area as a click target, and never
  // steals a click meant for the phone, email, website or masjid link inside it.
  results.addEventListener('click', event => {
    if (event.target.closest('a, button')) return;
    if (window.getSelection && String(window.getSelection()).trim()) return;
    const website = event.target.closest('.business-tile')?.dataset.website;
    if (website) window.open(website, '_blank', 'noopener');
  });

  search.oninput = render;
  [categoryFilter, cityFilter, masjidFilter].forEach(select => select.onchange = render);
  document.querySelector('#clear-filters').onclick = () => {
    search.value = '';
    [categoryFilter, cityFilter, masjidFilter].forEach(s => s.value = 'all');
    render();
  };
  render();
})();
