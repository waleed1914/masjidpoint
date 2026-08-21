// Home page interactions. Business cards and category chips are rendered from live data after
// this file runs, so everything here queries the DOM at event time rather than caching lists.
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.main-nav');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const masjidFilter = document.querySelector('#masjid-filter');
const emptyState = document.querySelector('#empty-state');

menuButton?.addEventListener('click', () => {
  const isOpen = navigation.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

navigation?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  navigation.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

function filterCards(category = document.querySelector('.chip.active')?.dataset.category || 'all') {
  const cards = document.querySelectorAll('.business-card');
  let visible = 0;
  cards.forEach(card => {
    const categoryMatch = category === 'all' || card.dataset.category === category;
    const show = categoryMatch;
    card.hidden = !show;
    if (show) visible += 1;
  });
  if (emptyState) emptyState.hidden = visible !== 0 || cards.length === 0;
}
window.filterBusinessCards = filterCards;

// Delegated so chips added after load still work.
document.querySelector('#category-chips')?.addEventListener('click', event => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#category-chips .chip').forEach(item => item.classList.remove('active'));
  chip.classList.add('active');
  filterCards(chip.dataset.category);
});

searchForm?.addEventListener('submit', event => {
  event.preventDefault();
  const firstResult = document.querySelector('#home-search-results a');
  if (firstResult) {
    window.location.href = firstResult.href;
    return;
  }
  const params = new URLSearchParams();
  const query = (searchInput?.value || '').trim();
  const masjid = masjidFilter?.value || '';
  if (query) params.set('q', query);
  if (masjid) params.set('masjid', masjid);
  window.location.href = `businesses${params.toString() ? `?${params}` : ''}`;
});

// The main search is an autocomplete navigator. It does not hide or rearrange the home page.
(async function setupHomeSearch() {
  if (!searchInput || !searchForm || !window.MasjidDB) return;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'home-search.css?v=1';
  document.head.appendChild(style);

  const field = searchInput.closest('.search-field');
  const results = document.createElement('div');
  results.id = 'home-search-results';
  results.className = 'home-search-results';
  results.hidden = true;
  field?.appendChild(results);
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', results.id);
  searchInput.setAttribute('aria-expanded', 'false');

  let state;
  try { state = await MasjidDB.state(); } catch { return; }

  const approvedMasjids = (state.masjidPointAdminApplications || [])
    .filter(item => item.type === 'masjid' && ['approved', 'activated'].includes(item.status));
  const businesses = (state.masjidPointBusinessRequests || [])
    .filter(item => item.status === 'approved' && item.paymentStatus === 'paid' && item.listing === 'enabled');
  const jobs = (state.masjidPointJobs || [])
    .filter(item => item.enabled === true && (item.status === 'live' || item.public === true || item.listing === 'enabled'));
  const products = (state.masjidPointProducts || [])
    .filter(item => item.visibility !== 'hidden' && Number(item.stock || 0) > 0);

  const entries = [
    ...businesses.map(item => ({
      type: 'Business', title: item.name, detail: `${item.category || 'Local business'} · ${item.masjid || 'UK'}`,
      mosque: item.masjid || '', search: `${item.name} ${item.category || ''} ${item.description || ''} ${item.masjid || ''}`,
      href: `businesses?q=${encodeURIComponent(item.name || '')}${item.masjid ? `&masjid=${encodeURIComponent(item.masjid)}` : ''}`
    })),
    ...approvedMasjids.map(item => ({
      type: 'Masjid', title: item.name, detail: item.details?.Address || item.details?.Postcode || 'View mosque listings',
      mosque: item.name || '', search: `${item.name} ${item.details?.Address || ''} ${item.details?.Postcode || ''}`,
      href: `masjid-adverts?reference=${encodeURIComponent(item.reference || item.id || '')}`
    })),
    ...jobs.map(item => ({
      type: 'Job', title: item.title, detail: `${item.business || item.businessName || 'Local employer'} · ${item.masjid || ''}`,
      mosque: item.masjid || '', search: `${item.title} ${item.business || item.businessName || ''} ${item.masjid || ''} ${item.city || ''}`,
      href: `public-jobs?job=${encodeURIComponent(item.id || item.reference || '')}`
    })),
    ...products.flatMap(product => (product.mosques || []).map(assignment => {
      const mosque = typeof assignment === 'string'
        ? approvedMasjids.find(item => item.reference === assignment || item.name === assignment) || { name: assignment }
        : assignment;
      return {
        type: 'Mosque shop', title: product.name, detail: `${mosque.name || 'Masjid shop'} · £${Number(product.price || 0).toFixed(2)}`,
        mosque: mosque.name || '', search: `${product.name} ${product.description || ''} ${mosque.name || ''}`,
        href: `masjid-shop?reference=${encodeURIComponent(mosque.reference || '')}`
      };
    }))
  ];

  const normal = value => String(value || '').toLowerCase().trim();
  const closeResults = () => {
    results.hidden = true;
    results.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
  };
  const showResults = () => {
    const query = normal(searchInput.value);
    const selectedMasjid = normal(masjidFilter?.value);
    if (!query) { closeResults(); return; }
    const matches = entries.filter(item => normal(item.search).includes(query)
      && (!selectedMasjid || normal(item.mosque) === selectedMasjid)).slice(0, 8);
    results.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'home-search-empty';
      empty.textContent = 'No matching businesses, masjids, jobs or products.';
      results.appendChild(empty);
    } else {
      matches.forEach(item => {
        const link = document.createElement('a');
        link.href = item.href;
        link.className = 'home-search-result';
        const badge = document.createElement('span');
        badge.className = 'home-search-type';
        badge.textContent = item.type;
        const copy = document.createElement('span');
        copy.className = 'home-search-copy';
        const title = document.createElement('strong');
        title.textContent = item.title || item.type;
        const detail = document.createElement('small');
        detail.textContent = item.detail;
        copy.append(title, detail);
        const arrow = document.createElement('span');
        arrow.className = 'home-search-arrow';
        arrow.textContent = '→';
        link.append(badge, copy, arrow);
        results.appendChild(link);
      });
    }
    results.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  };

  searchInput.addEventListener('input', showResults);
  searchInput.addEventListener('focus', showResults);
  masjidFilter?.addEventListener('change', showResults);
  searchInput.addEventListener('keydown', event => {
    const links = [...results.querySelectorAll('a')];
    if (event.key === 'Escape') closeResults();
    if (event.key === 'ArrowDown' && links.length) { event.preventDefault(); links[0].focus(); }
  });
  results.addEventListener('keydown', event => {
    const links = [...results.querySelectorAll('a')];
    const index = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); links[(index + 1) % links.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); index <= 0 ? searchInput.focus() : links[index - 1].focus(); }
    if (event.key === 'Escape') { closeResults(); searchInput.focus(); }
  });
  document.addEventListener('click', event => {
    if (!searchForm.contains(event.target)) closeResults();
  });
})();
