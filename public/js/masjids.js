// Full masjid directory with search, city filter and sorting. Replaces the scroll-only section
// that used to live on the home page.
(async function () {
  const state = await MasjidDB.state();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const summaries = DirectoryData.operationalMosques(state)
    .map(mosque => DirectoryData.mosqueSummary(state, mosque));

  const search = document.querySelector('#masjid-search');
  const cityFilter = document.querySelector('#city-filter');
  const areaFilter = document.querySelector('#area-filter');
  const sortFilter = document.querySelector('#sort-filter');
  const results = document.querySelector('#masjid-results');
  const empty = document.querySelector('#masjid-empty');
  const count = document.querySelector('#result-count');

  // Filters start closed on every screen and remember the visitor's last choice.
  const filterToggle = document.querySelector('#masjid-filter-toggle');
  const filterHero = document.querySelector('.directory-hero');
  const filterPreferenceKey = 'masjidPoint.masjidDirectoryFilters';
  let filtersOpen = false;
  try { filtersOpen = localStorage.getItem(filterPreferenceKey) === 'open'; } catch (_) {}
  const paintFilterToggle = () => {
    filterHero?.classList.toggle('filters-open', filtersOpen);
    filterToggle?.setAttribute('aria-expanded', String(filtersOpen));
    const label = filterToggle?.querySelector('span:last-child');
    if (label) label.textContent = filtersOpen ? 'Hide filters' : 'Show filters';
  };
  if (filterToggle) filterToggle.onclick = () => {
    filtersOpen = !filtersOpen;
    try { localStorage.setItem(filterPreferenceKey, filtersOpen ? 'open' : 'closed'); } catch (_) {}
    paintFilterToggle();
  };
  paintFilterToggle();

  [...new Set(summaries.map(s => s.city))].sort()
    .forEach(city => cityFilter.add(new Option(city, city)));
  [...new Set(summaries.map(s => s.area).filter(Boolean))].sort().forEach(a => areaFilter.add(new Option(a, a)));

  // A city or search term can be carried in from the home page or a shared link.
  const params = new URLSearchParams(location.search);
  if (params.get('city') && [...cityFilter.options].some(o => o.value === params.get('city'))) cityFilter.value = params.get('city');
  if (params.get('q')) search.value = params.get('q');

  const SORTS = {
    activity: (a, b) => b.activity - a.activity || a.mosque.name.localeCompare(b.mosque.name),
    name: (a, b) => a.mosque.name.localeCompare(b.mosque.name),
    city: (a, b) => a.city.localeCompare(b.city) || a.mosque.name.localeCompare(b.mosque.name)
  };

  function render() {
    const q = search.value.toLowerCase().trim();
    const city = cityFilter.value;
    const list = summaries
      .filter(s => (city === 'all' || s.city === city)
        && (areaFilter.value === 'all' || s.area === areaFilter.value)
        && (!q || `${s.mosque.name} ${s.mosque.details?.Address || ''} ${s.postcode} ${s.city} ${s.area}`.toLowerCase().includes(q)))
      .sort(SORTS[sortFilter.value] || SORTS.activity);

    results.innerHTML = list.map(s => `
      <a class="masjid-tile" href="masjid-adverts?reference=${encodeURIComponent(s.mosque.reference)}">
        <span class="masjid-tile-art${s.mosque.photo ? ' has-photo' : ''}" aria-hidden="true">
          ${s.mosque.photo
            ? `<img class="masjid-tile-photo" src="${esc(s.mosque.photo)}" alt="" loading="lazy" onerror="this.closest('.masjid-tile-art').classList.remove('has-photo');this.remove()">`
            : ''}
          <i></i><b></b><span class="masjid-tile-city">${esc(s.city)}</span>
        </span>
        <span class="masjid-tile-body">
          <h2>${esc(s.mosque.name)}</h2>
          <p class="masjid-tile-address">${esc(s.mosque.details?.Address || s.postcode || 'Verified UK masjid')}</p>
          <span class="masjid-tile-stats">
            <div><strong>${s.adverts}</strong><span>Businesses</span></div>
            <div><strong>${s.jobs}</strong><span>Jobs</span></div>
            <div><strong>${s.shop}</strong><span>Shop items</span></div>
          </span>
          <span class="masjid-tile-go">View masjid →</span>
        </span>
      </a>`).join('');

    empty.hidden = list.length > 0;
    results.hidden = !list.length;
    const filtered = q || city !== 'all' || areaFilter.value !== 'all';
    if (count) count.innerHTML = filtered
      ? `<strong>${list.length}</strong> of ${summaries.length} masjids match`
      : `<strong>${summaries.length}</strong> masjid${summaries.length === 1 ? '' : 's'} listed`;
  }

  search.oninput = render;
  cityFilter.onchange = render;
  areaFilter.onchange = render;
  sortFilter.onchange = render;
  document.querySelector('#clear-filters').onclick = () => {
    search.value = ''; cityFilter.value = 'all'; areaFilter.value = 'all'; sortFilter.value = 'activity'; render();
  };
  render();
})();
