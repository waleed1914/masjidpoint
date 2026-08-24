(async function () {
  const query = new URLSearchParams(location.search);
  const reference = query.get('reference');
  const productId = query.get('product');
  const state = await MasjidDB.state();
  const applications = state.masjidPointAdminApplications || [];
  const mosque = applications.find(item => item.type === 'masjid' && (item.reference === reference || item.id === reference));
  const product = (state.masjidPointProducts || []).find(item => item.id === productId);
  const assigned = product && mosque && (product.mosques || []).some(item => item.reference === mosque.reference);
  const available = assigned && product.visibility === 'visible' && Number(product.stock) > 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = value => `£${Number(value || 0).toFixed(2)}`;
  const shopHref = mosque ? `masjid-shop?reference=${encodeURIComponent(mosque.reference)}` : 'shops';
  document.querySelector('#back-to-shop').href = shopHref;
  document.querySelector('#not-found-back').href = shopHref;

  if (!available) {
    document.querySelector('#product-not-found').hidden = false;
    return;
  }

  document.title = `${product.name} — ${mosque.name} Shop — MasjidPoint`;
  const image = document.querySelector('#product-image');
  image.src = product.image || '';
  image.alt = product.name;
  document.querySelector('#product-category').textContent = product.category || 'Mosque shop';
  document.querySelector('#product-name').textContent = product.name;
  document.querySelector('#product-description').textContent = product.description || 'No description has been added for this product.';
  document.querySelector('#product-price').textContent = money(product.price);
  document.querySelector('#product-stock').textContent = `${product.stock} available`;
  document.querySelector('#product-mosque').textContent = mosque.name;
  document.querySelector('#product-mosque').href = shopHref;
  document.querySelector('#support-mosque').textContent = mosque.name;
  document.querySelector('#product-detail').hidden = false;

  if (Number(product.stock) <= 5) {
    const flag = document.querySelector('#product-stock-flag');
    flag.textContent = `Only ${product.stock} left`;
    flag.hidden = false;
  }

  const quantity = document.querySelector('#product-quantity');
  quantity.max = String(product.stock);
  const normaliseQuantity = () => {
    quantity.value = String(Math.max(1, Math.min(Number(quantity.value) || 1, Number(product.stock))));
  };
  quantity.onchange = normaliseQuantity;
  document.querySelector('#quantity-down').onclick = () => { quantity.value = String(Number(quantity.value) - 1); normaliseQuantity(); };
  document.querySelector('#quantity-up').onclick = () => { quantity.value = String(Number(quantity.value) + 1); normaliseQuantity(); };

  const cartKey = `masjidPointCart:${mosque.reference}`;
  const loadCart = () => {
    try { return JSON.parse(localStorage.getItem(cartKey) || '[]'); } catch { return []; }
  };
  const saveCart = cart => localStorage.setItem(cartKey, JSON.stringify(cart));
  const count = () => loadCart().reduce((total, line) => total + (Number(line.quantity) || 0), 0);
  const syncCount = () => { document.querySelector('#detail-cart-count').textContent = String(count()); };
  document.querySelector('#view-cart').href = `${shopHref}&cart=open`;
  syncCount();

  document.querySelector('#detail-add').onclick = () => {
    const cart = loadCart();
    const requested = Number(quantity.value) || 1;
    const line = cart.find(item => item.id === product.id);
    if (line) line.quantity = Math.min(Number(line.quantity || 0) + requested, Number(product.stock));
    else cart.push({ id: product.id, quantity: Math.min(requested, Number(product.stock)) });
    saveCart(cart);
    syncCount();
    const feedback = document.querySelector('#product-feedback');
    feedback.textContent = `${product.name} added to your cart ✓`;
    const button = document.querySelector('#detail-add');
    button.textContent = 'Added to cart ✓';
    setTimeout(() => { button.textContent = 'Add to cart'; }, 1400);
  };

  const rate = (state.masjidPointMasjidPricing || []).find(item => item.masjidReference === mosque.reference || item.masjidName === mosque.name);
  const methods = ShopFulfilment.enabledFor(rate);
  const deliveryFee = ShopFulfilment.deliveryFeeOf(rate);
  const fulfilment = document.querySelector('#product-fulfilment-options');
  fulfilment.innerHTML = methods.map(method => `<article class="fulfilment-detail"><strong>${esc(method.label)}</strong><p>${esc(method.customerNote)}</p>${method.needsAddress ? `<b>${deliveryFee > 0 ? `${money(deliveryFee)} delivery` : 'Free delivery'}</b>` : ''}</article>`).join('');
  document.querySelector('#product-fulfilment').hidden = methods.length === 0;

  const related = (state.masjidPointProducts || []).filter(item => item.id !== product.id && item.visibility === 'visible' && Number(item.stock) > 0 && (item.mosques || []).some(entry => entry.reference === mosque.reference)).slice(0, 3);
  document.querySelector('#related-products').innerHTML = related.map(item => `<a class="related-product" href="masjid-product?reference=${encodeURIComponent(mosque.reference)}&product=${encodeURIComponent(item.id)}"><img src="${esc(item.image)}" alt="" loading="lazy" onerror="this.hidden=true"><span><strong>${esc(item.name)}</strong><small>${money(item.price)} · ${item.stock} available</small></span></a>`).join('');
  document.querySelector('#product-related').hidden = related.length === 0;
})();
