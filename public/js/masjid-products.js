// The masjid's own view of its shop catalogue. Products are stocked by the administrator and
// attached to one or more masjids, so this reads the same records the public shop reads and
// filters them to the signed-in masjid — previously a masjid had no way to see them at all.
(async function () {
  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (!session?.reference) return;

  const state = await MasjidDB.state();
  const masjid = (state.masjidPointAdminApplications || [])
    .find(app => app.type === 'masjid' && (app.reference === session.reference || app.id === session.reference));
  if (!masjid) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `£${Number(n || 0).toFixed(2)}`;

  // Keep the saved mosque photo and identity consistent with every other portal page.
  window.MasjidIdentity?.apply(masjid);
  document.querySelector('#view-shop').href = `masjid-shop?reference=${encodeURIComponent(masjid.reference)}`;

  const products = (state.masjidPointProducts || [])
    .filter(product => (product.mosques || []).some(m => m.reference === masjid.reference))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const rate = (state.masjidPointMasjidPricing || [])
    .find(p => p.masjidReference === masjid.reference || p.masjidName === masjid.name);
  const methods = typeof ShopFulfilment !== 'undefined' ? ShopFulfilment.enabledFor(rate) : [];
  const deliveryFee = typeof ShopFulfilment !== 'undefined' ? ShopFulfilment.deliveryFeeOf(rate) : 0;

  // A product only reaches customers when it is visible and actually in stock, and the shop only
  // opens at all when the masjid has at least one way to hand an order over.
  const onSale = product => product.visibility !== 'hidden' && Number(product.stock) > 0;
  const sellable = products.filter(onSale);

  document.querySelector('#product-stats').innerHTML = `
    <article><span>⌗</span><p><small>Products stocked</small><strong>${products.length}</strong><em>Assigned to your masjid</em></p></article>
    <article><span>✓</span><p><small>On sale now</small><strong>${sellable.length}</strong><em>Visible and in stock</em></p></article>
    <article><span>▤</span><p><small>Total stock</small><strong>${products.reduce((sum, p) => sum + Number(p.stock || 0), 0)}</strong><em>Units across the catalogue</em></p></article>
    <article><span>£</span><p><small>Your share if all sold</small><strong>${money(products.reduce((sum, p) => sum + Number(p.price || 0) * Number(p.stock || 0) * Number(p.mosqueSharePercent || 0) / 100, 0))}</strong><em>At current stock levels</em></p></article>`;

  const summary = document.querySelector('#fulfilment-summary');
  if (!methods.length) {
    summary.innerHTML = '<strong>Your shop is closed.</strong> No collection or delivery option is switched on, so nothing can be bought even while products are stocked. Ask the administrator to enable one.';
  } else {
    summary.textContent = `Customers can use: ${methods.map(m => m.short).join(', ')}${deliveryFee > 0 ? ` · delivery ${money(deliveryFee)}` : ''}.`;
  }

  const search = document.querySelector('#product-search');
  const filter = document.querySelector('#product-filter');
  const grid = document.querySelector('#product-grid');
  const empty = document.querySelector('#product-empty');

  function statusOf(product) {
    if (product.visibility === 'hidden') return { key: 'disabled', label: 'Hidden' };
    if (!(Number(product.stock) > 0)) return { key: 'rejected', label: 'Out of stock' };
    if (!methods.length) return { key: 'waiting', label: 'Shop closed' };
    return { key: 'enabled', label: 'On sale' };
  }

  function render() {
    const query = search.value.toLowerCase().trim();
    const mode = filter.value;
    const list = products.filter(product => {
      if (mode === 'onsale' && !onSale(product)) return false;
      if (mode === 'out' && Number(product.stock) > 0) return false;
      if (mode === 'hidden' && product.visibility !== 'hidden') return false;
      return !query || `${product.name} ${product.category || ''} ${product.description || ''}`.toLowerCase().includes(query);
    });

    grid.innerHTML = list.map(product => {
      const status = statusOf(product);
      const share = Number(product.price || 0) * Number(product.mosqueSharePercent || 0) / 100;
      const shared = (product.mosques || []).filter(m => m.reference !== masjid.reference);
      return `<article class="product-card">
        <img src="${esc(product.image)}" alt="" loading="lazy" onerror="this.hidden=true">
        <div class="product-card-body">
          <header><h3>${esc(product.name)}</h3><span class="portal-badge ${status.key}">${status.label}</span></header>
          <p>${esc(product.description || '')}</p>
          <dl>
            <div><dt>Price</dt><dd>${money(product.price)}</dd></div>
            <div><dt>In stock</dt><dd>${Number(product.stock || 0)}</dd></div>
            <div><dt>Your share</dt><dd>${money(share)} <small>(${Number(product.mosqueSharePercent || 0)}%)</small></dd></div>
            <div><dt>Category</dt><dd>${esc(product.category || 'Uncategorised')}</dd></div>
          </dl>
          ${shared.length ? `<small class="product-shared">Also stocked at ${shared.map(m => esc(m.name)).join(', ')}</small>` : ''}
        </div>
      </article>`;
    }).join('');

    grid.hidden = !list.length;
    empty.hidden = Boolean(list.length);
    if (!list.length && products.length) {
      empty.querySelector('strong').textContent = 'No products match';
      empty.querySelector('p').textContent = 'Try a different search or filter.';
    }
  }

  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  render();
})();
