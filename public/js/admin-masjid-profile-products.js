(async function () {
  const reference = new URLSearchParams(location.search).get('reference')
    || sessionStorage.getItem('masjidPointSelectedMasjid');
  const page = document.querySelector('#masjid-view');
  if (!reference || !page) return;

  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || []).find(
    item => item.type === 'masjid' && item.reference === reference
  );
  if (!mosque || !['approved', 'activated'].includes(mosque.status)) return;

  const products = (state.masjidPointProducts || []).filter(product =>
    (product.mosques || []).some(selected => selected.reference === reference)
  );
  const orders = (state.masjidPointShopOrders || []).filter(order =>
    order.collectionMasjidReference === reference
    || order.collectionMasjidName === mosque.name
  );
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const money = value => `£${Number(value || 0).toFixed(2)}`;
  const visibleCount = products.filter(product => product.visibility !== 'hidden').length;
  const lowStockCount = products.filter(product => Number(product.stock) <= 5).length;

  const section = document.createElement('section');
  section.className = 'view-card mosque-profile-products';
  section.innerHTML = `
    <header class="mosque-products-header">
      <div>
        <p class="profile-section-label">MOSQUE SHOP</p>
        <h2>Products selected for ${escapeHtml(mosque.name)}</h2>
        <p>Only products assigned to this specific mosque are shown here.</p>
      </div>
      <div class="mosque-products-actions">
        <a class="button secondary" href="masjid-shop?reference=${encodeURIComponent(reference)}" target="_blank" rel="noopener">View public shop ↗</a>
        <a class="button" href="admin-masjid-products?reference=${encodeURIComponent(reference)}">Manage these products →</a>
      </div>
    </header>
    <div class="mosque-product-summary">
      <article><small>Assigned products</small><strong>${products.length}</strong></article>
      <article><small>Visible in shop</small><strong>${visibleCount}</strong></article>
      <article><small>Low stock</small><strong>${lowStockCount}</strong></article>
      <article><small>Shop orders</small><strong>${orders.length}</strong></article>
    </div>
    <div class="mosque-profile-product-grid">
      ${products.length ? products.map(product => `
        <article class="mosque-profile-product" data-product-visible="${product.visibility === 'hidden' ? 'false' : 'true'}" data-product-low-stock="${Number(product.stock) <= 5 ? 'true' : 'false'}">
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">
          <div class="mosque-profile-product-copy">
            <div class="product-title-line">
              <h3>${escapeHtml(product.name)}</h3>
              <span class="status-badge ${product.visibility === 'hidden' ? 'deactivated' : 'approved'}">${product.visibility === 'hidden' ? 'Hidden' : 'Visible'}</span>
            </div>
            <p>${escapeHtml(product.description)}</p>
            <dl>
              <div><dt>Price</dt><dd>${money(product.price)}</dd></div>
              <div><dt>Stock</dt><dd class="${Number(product.stock) <= 5 ? 'stock-warning' : ''}">${Number(product.stock || 0)}</dd></div>
              <div><dt>Mosque share</dt><dd>${Number(product.mosqueSharePercent || 0)}%</dd></div>
              <div><dt>Category</dt><dd>${escapeHtml(product.category || 'General')}</dd></div>
            </dl>
          </div>
        </article>`).join('') : `
        <div class="mosque-products-empty">
          <strong>No products assigned yet</strong>
          <p>Add a product or select this mosque from the central catalogue.</p>
          <a class="button" href="admin-masjid-products?reference=${encodeURIComponent(reference)}">Open shop management</a>
        </div>`}
    </div>
    <div class="mosque-profile-order-list" hidden>
      ${orders.length ? orders.map(order => {
        const method = ShopFulfilment.methodOf(order), address = ShopFulfilment.addressLines(order);
        return `<article class="mosque-profile-order"><div><small>${escapeHtml(order.id)}</small><strong>${escapeHtml(order.customer?.name || 'Customer')}</strong><span>${escapeHtml(order.customer?.email || '')}${order.customer?.phone ? ` · ${escapeHtml(order.customer.phone)}` : ''}</span></div><div><small>Products</small><strong>${(order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item(s)</strong><span>${(order.items || []).map(item => `${escapeHtml(item.name)} × ${Number(item.quantity || 0)}`).join(', ')}</span></div><div class="shop-order-payment"><small>${method.paysUpfront ? 'Bank payment' : 'Payment'}</small><strong>${escapeHtml(method.paysUpfront ? (order.paymentReference || 'Reference not provided') : `${money(order.total)} at the mosque`)}</strong><span class="shop-payment-state ${escapeHtml(order.paymentStatus || 'missing')}">${escapeHtml(ShopFulfilment.paymentLabel(order))}</span>${order.paymentEvidence?.fileData ? `<a class="review-link" href="${escapeHtml(order.paymentEvidence.fileData)}" target="_blank" rel="noopener">View payment proof →</a>` : ''}</div><div><small>How received</small><strong><span class="shop-method-badge ${method.key}">${escapeHtml(method.short)}</span></strong>${address.length ? `<span>${escapeHtml(address.join(', '))}</span>` : ''}<a class="review-link" href="/api/shop/invoice.pdf?order=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">Invoice ${escapeHtml(order.invoiceNumber || order.id)} ↓</a></div><div><small>Total</small><strong>${money(order.total)}</strong><span class="status-badge ${order.status === 'delivered' ? 'approved' : 'pending'}">${escapeHtml(String(order.status || 'ordered').replaceAll('_', ' '))}</span></div></article>`;
      }).join('') : '<p class="mosque-products-empty">No shop orders for this mosque.</p>'}
    </div>`;
  page.appendChild(section);
  const summaryCards = [...section.querySelectorAll('.mosque-product-summary article')];
  const productGrid = section.querySelector('.mosque-profile-product-grid');
  const orderList = section.querySelector('.mosque-profile-order-list');
  const filters = ['assigned', 'visible', 'low-stock', 'orders'];
  let activeFilter = '';
  function applyFilter(next) {
    activeFilter = activeFilter === next ? '' : next;
    summaryCards.forEach((card, index) => {
      const selected = filters[index] === activeFilter;
      card.classList.toggle('active-filter', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    const showingOrders = activeFilter === 'orders';
    productGrid.hidden = showingOrders;
    orderList.hidden = !showingOrders;
    section.querySelectorAll('.mosque-profile-product').forEach(product => {
      product.hidden = activeFilter === 'visible' && product.dataset.productVisible !== 'true'
        || activeFilter === 'low-stock' && product.dataset.productLowStock !== 'true';
    });
  }
  summaryCards.forEach((card, index) => {
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Filter by ${card.querySelector('small').textContent.trim()}`);
    card.setAttribute('aria-pressed', 'false');
    card.onclick = () => applyFilter(filters[index]);
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        applyFilter(filters[index]);
      }
    };
  });
})();
