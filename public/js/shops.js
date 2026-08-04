// Directory of every masjid community shop that currently has stock, with search and filters
// for city, product type and how the order can be received.
(async function () {
  const state = await MasjidDB.state();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `£${Number(n || 0).toFixed(2)}`;

  const products = DirectoryData.sellableProducts(state);
  const pricing = state.masjidPointMasjidPricing || [];

  // Only masjids with something actually purchasable appear.
  const shops = DirectoryData.operationalMosques(state).map(mosque => {
    const stock = products.filter(p => (p.mosques || []).some(m => m.reference === mosque.reference));
    const rate = pricing.find(p => p.masjidReference === mosque.reference || p.masjidName === mosque.name);
    const methods = ShopFulfilment.enabledFor(rate);
    return {
      mosque, stock,
      city: DirectoryData.cityOf(mosque),
      area: DirectoryData.areaOf(mosque),
      categories: [...new Set(stock.map(p => p.category).filter(Boolean))],
      methods,
      deliveryFee: ShopFulfilment.deliveryFeeOf(rate),
      from: stock.length ? Math.min(...stock.map(p => Number(p.price))) : 0
    };
  }).filter(shop => shop.stock.length && shop.methods.length);

  const search = document.querySelector('#shop-search');
  const cityFilter = document.querySelector('#city-filter');
  const areaFilter = document.querySelector('#area-filter');
  const masjidFilter = document.querySelector('#masjid-filter');
  const categoryFilter = document.querySelector('#category-filter');
  const methodFilter = document.querySelector('#method-filter');
  const results = document.querySelector('#shop-results');
  const empty = document.querySelector('#shop-empty');
  const count = document.querySelector('#result-count');

  [...new Set(shops.map(s => s.city))].sort().forEach(c => cityFilter.add(new Option(c, c)));
  [...new Set(shops.map(s => s.area).filter(Boolean))].sort().forEach(a => areaFilter.add(new Option(a, a)));
  [...new Set(shops.map(s => s.mosque.name))].sort().forEach(n => masjidFilter.add(new Option(n, n)));
  [...new Set(shops.flatMap(s => s.categories))].sort().forEach(c => categoryFilter.add(new Option(c, c)));

  const params = new URLSearchParams(location.search);
  if (params.get('city') && [...cityFilter.options].some(o => o.value === params.get('city'))) cityFilter.value = params.get('city');
  const preset = (select, value) => { if (value && [...select.options].some(o => o.value === value)) select.value = value; };
  preset(areaFilter, params.get('area'));
  preset(masjidFilter, params.get('masjid'));
  if (params.get('q')) search.value = params.get('q');

  function render() {
    const q = search.value.toLowerCase().trim();
    const list = shops.filter(s =>
      (cityFilter.value === 'all' || s.city === cityFilter.value)
      && (areaFilter.value === 'all' || s.area === areaFilter.value)
      && (masjidFilter.value === 'all' || s.mosque.name === masjidFilter.value)
      && (categoryFilter.value === 'all' || s.categories.includes(categoryFilter.value))
      && (methodFilter.value === 'all' || s.methods.some(m => m.key === methodFilter.value))
      && (!q || `${s.mosque.name} ${s.city} ${s.area} ${s.stock.map(p => p.name).join(' ')}`.toLowerCase().includes(q))
    ).sort((a, b) => b.stock.length - a.stock.length || a.mosque.name.localeCompare(b.mosque.name));

    results.innerHTML = list.map(s => {
      // At most three thumbnails, laid out by how many there actually are — a shop with one
      // product must not stretch its single picture across the whole tile.
      const preview = s.stock.slice(0, 3);
      return `<a class="shop-tile" href="masjid-shop?reference=${encodeURIComponent(s.mosque.reference)}">
        <span class="shop-tile-preview" data-count="${preview.length}">
          ${preview.map(p => `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join('')}
          <span class="shop-tile-count">${s.stock.length} product${s.stock.length === 1 ? '' : 's'}</span>
        </span>
        <span class="shop-tile-body">
          <span class="shop-tile-city">${esc(s.city)}${s.area ? ` · ${esc(s.area)}` : ''}</span>
          <h2>${esc(s.mosque.name)}</h2>
          <p class="shop-tile-meta">From <strong>${money(s.from)}</strong></p>
          <span class="shop-tile-methods">${s.methods.map(m => `<em class="${m.key}">${esc(m.short)}</em>`).join('')}</span>
          ${s.deliveryFee > 0 ? `<small class="shop-tile-delivery">Delivery ${money(s.deliveryFee)}</small>` : ''}
          <span class="shop-tile-go">Visit shop <b aria-hidden="true">→</b></span>
        </span>
      </a>`;
    }).join('');

    empty.hidden = list.length > 0;
    results.hidden = !list.length;
    const filtered = q || [cityFilter, areaFilter, masjidFilter, categoryFilter, methodFilter].some(s => s.value !== 'all');
    count.innerHTML = filtered
      ? `<strong>${list.length}</strong> of ${shops.length} masjid shops match`
      : `<strong>${shops.length}</strong> masjid shop${shops.length === 1 ? '' : 's'} open`;
  }

  search.oninput = render;
  [cityFilter, areaFilter, masjidFilter, categoryFilter, methodFilter].forEach(select => select.onchange = render);
  document.querySelector('#clear-filters').onclick = () => {
    search.value = '';
    [cityFilter, areaFilter, masjidFilter, categoryFilter, methodFilter].forEach(s => s.value = 'all');
    render();
  };
  render();
})();
