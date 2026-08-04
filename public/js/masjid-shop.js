(async function () {
  const ref = new URLSearchParams(location.search).get('reference');
  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || []).find(x => x.type === 'masjid' && (x.reference === ref || x.id === ref));
  const products = state.masjidPointProducts || [];
  const orders = state.masjidPointShopOrders || [];
  if (!mosque) { document.querySelector('#shop-masjid-name').textContent = 'Mosque shop not found'; return; }
  document.querySelector('#shop-masjid-name').textContent = `${mosque.name} Shop`;

  const rate = (state.masjidPointMasjidPricing || []).find(item => item.masjidReference === mosque.reference || item.masjidName === mosque.name);
  const available = ShopFulfilment.enabledFor(rate);
  const deliveryFee = ShopFulfilment.deliveryFeeOf(rate);

  let cart = [], category = 'all', method = available[0] || null;
  const own = () => products.filter(p => p.visibility === 'visible' && p.stock > 0 && (p.mosques || []).some(m => m.reference === mosque.reference));

  // The cart survives a reload. It is kept per mosque and stored as ids and quantities only, so a
  // product that has since sold out or been withdrawn simply drops out rather than reappearing at
  // a stale price. This key is local to the browser — it is not one of the synced collections.
  const cartKey = `masjidPointCart:${mosque.reference}`;
  function saveCart() {
    try { localStorage.setItem(cartKey, JSON.stringify(cart.map(x => ({ id: x.product.id, quantity: x.quantity })))); } catch {}
  }
  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(cartKey) || '[]');
      cart = saved.map(line => {
        const product = own().find(p => p.id === line.id);
        return product ? { product, quantity: Math.max(1, Math.min(Number(line.quantity) || 1, product.stock)) } : null;
      }).filter(Boolean);
    } catch { cart = []; }
  }
  const money = n => `£${Number(n || 0).toFixed(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  [...new Set(own().map(p => p.category))].sort().forEach(c => document.querySelector('#shop-category').add(new Option(c, c)));

  const form = document.querySelector('#checkout-form');
  const addressBox = document.querySelector('#delivery-address');
  const addressFields = ['line1', 'city', 'postcode'];
  const submit = document.querySelector('#place-order');

  function renderFulfilment() {
    const host = document.querySelector('#fulfilment-options');
    // The hero promised collection before delivery existed; say what this shop actually offers.
    const note = document.querySelector('#shop-hero-note');
    if (note) note.textContent = !available.length
      ? 'This mosque shop is not currently taking orders.'
      : available.some(o => o.needsAddress) && available.some(o => !o.needsAddress)
        ? 'Order online and choose collection from the mosque or delivery to your door.'
        : available.some(o => o.needsAddress)
          ? 'Order online for delivery straight to your address.'
          : `Order online and collect from ${mosque.name}.`;
    if (!available.length) {
      document.querySelector('#fulfilment-choice').hidden = true;
      document.querySelector('#fulfilment-note').textContent = 'This mosque shop is not currently accepting orders. Please check back later.';
      submit.disabled = true;
      return;
    }
    host.innerHTML = available.map((option, index) => `
      <label class="fulfilment-option">
        <input type="radio" name="fulfilmentMethod" value="${option.key}" ${index === 0 ? 'checked' : ''}>
        <span><strong>${esc(option.label)}</strong><small>${esc(option.customerNote)}</small></span>
        ${option.needsAddress && deliveryFee > 0 ? `<b>${money(deliveryFee)}</b>` : ''}
      </label>`).join('');
    host.querySelectorAll('[name=fulfilmentMethod]').forEach(input => input.onchange = () => {
      method = ShopFulfilment.METHODS[input.value];
      syncMethod();
    });
    syncMethod();
  }

  function syncMethod() {
    if (!method) return;
    const needsAddress = method.needsAddress;
    addressBox.hidden = !needsAddress;
    addressFields.forEach(name => { form.elements[name].required = needsAddress; });
    document.querySelector('#fulfilment-note').textContent = needsAddress
      ? 'Your order is delivered by MasjidPoint, not collected from the mosque.'
      : `You will collect this order from ${mosque.name}.`;
    renderCart();
  }

  function currentFee() { return method?.needsAddress ? deliveryFee : 0; }

  const SORTS = {
    featured: (a, b) => String(a.name).localeCompare(String(b.name)),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    name: (a, b) => String(a.name).localeCompare(String(b.name))
  };

  function render() {
    const q = document.querySelector('#shop-search').value.toLowerCase().trim();
    const band = document.querySelector('#shop-price').value;
    const [from, to] = band === 'all' ? [null, null] : band.split('-').map(v => v === '' ? null : Number(v));
    const sort = document.querySelector('#shop-sort').value;
    const all = own();
    const list = all.filter(p =>
      (category === 'all' || p.category === category)
      && (from === null || p.price >= from)
      && (to === null || p.price < to)
      && (!q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q))
    ).sort(SORTS[sort] || SORTS.featured);

    const filtered = q || category !== 'all' || band !== 'all';
    document.querySelector('#shop-result-count').innerHTML = filtered
      ? `<strong>${list.length}</strong> of ${all.length} products match`
      : `<strong>${all.length}</strong> product${all.length === 1 ? '' : 's'} available`;
    document.querySelector('#public-products').innerHTML = list.map(p => {
      const inCart = cart.find(x => x.product.id === p.id)?.quantity || 0;
      const low = p.stock <= 5;
      return `<article class="public-product">
        <div class="product-media">
          <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" onerror="this.hidden=true">
          ${low ? `<span class="product-flag low">Only ${p.stock} left</span>` : ''}
          ${inCart ? `<span class="product-flag in-cart">${inCart} in cart</span>` : ''}
        </div>
        <div class="product-body">
          <small class="product-category">${esc(p.category)}</small>
          <h2>${esc(p.name)}</h2>
          <p>${esc(p.description)}</p>
          <footer>
            <span class="product-price"><strong>${money(p.price)}</strong><small>${p.stock} available</small></span>
            <button class="add-to-cart" data-add="${p.id}">Add to cart</button>
          </footer>
        </div>
      </article>`;
    }).join('');
    document.querySelector('#shop-empty').hidden = list.length > 0;
    document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      const p = products.find(x => x.id === b.dataset.add), line = cart.find(x => x.product.id === p.id);
      const full = line && line.quantity >= p.stock;
      if (line) line.quantity = Math.min(line.quantity + 1, p.stock); else cart.push({ product: p, quantity: 1 });
      renderCart();
      confirmAdded(b, full ? `All ${p.stock} in cart` : 'Added to cart ✓');
    });
  }

  // Adding to the cart happens off-screen — the cart lives in the header — so the button itself
  // confirms it, and the header count is nudged so the eye is drawn to where the item went.
  function confirmAdded(button, message) {
    if (button.dataset.busy) return;
    const original = button.textContent;
    button.dataset.busy = '1';
    button.classList.add('added');
    button.textContent = message;
    setTimeout(() => {
      button.classList.remove('added');
      button.textContent = original;
      delete button.dataset.busy;
    }, 1400);

    const count = document.querySelector('#cart-count');
    if (count) {
      count.classList.remove('bump');
      void count.offsetWidth; // restart the animation when items are added in quick succession
      count.classList.add('bump');
    }
  }

  function renderCart() {
    saveCart();
    document.querySelector('#cart-count').textContent = cart.reduce((s, x) => s + x.quantity, 0);
    document.querySelector('#cart-lines').innerHTML = cart.map(x => `<div class="cart-line">
      <img src="${esc(x.product.image)}" alt="" loading="lazy" onerror="this.hidden=true">
      <div class="cart-line-body">
        <strong>${esc(x.product.name)}</strong>
        <small>${money(x.product.price)} each${x.quantity >= x.product.stock ? ' · last in stock' : ''}</small>
        <div class="cart-line-controls">
          <label class="cart-qty"><span>Qty</span><input data-qty="${x.product.id}" type="number" min="1" max="${x.product.stock}" value="${x.quantity}"></label>
          <button class="cart-remove" data-remove="${x.product.id}" aria-label="Remove ${esc(x.product.name)} from the cart">Remove</button>
        </div>
      </div>
      <b class="cart-line-total">${money(x.product.price * x.quantity)}</b>
    </div>`).join('') || '<p class="shop-empty">Your cart is empty.</p>';
    const goods = cart.reduce((s, x) => s + x.product.price * x.quantity, 0), fee = currentFee();
    document.querySelector('#checkout-totals').innerHTML = fee > 0
      ? `<span><small>Items</small><b>${money(goods)}</b></span><span><small>Delivery</small><b>${money(fee)}</b></span>`
      : '';
    document.querySelector('#cart-total').textContent = money(goods + fee);
    document.querySelectorAll('[data-qty]').forEach(input => input.onchange = () => {
      cart.find(x => x.product.id === input.dataset.qty).quantity = Math.max(1, Math.min(Number(input.value), Number(input.max)));
      renderCart();
    });
    document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { cart = cart.filter(x => x.product.id !== b.dataset.remove); renderCart(); });
    refreshCartFlags();
  }

  // Keeps each card's "N in cart" badge honest without rebuilding the grid, which would throw away
  // the button mid-confirmation.
  function refreshCartFlags() {
    document.querySelectorAll('[data-add]').forEach(button => {
      const media = button.closest('.public-product')?.querySelector('.product-media');
      if (!media) return;
      const quantity = cart.find(x => x.product.id === button.dataset.add)?.quantity || 0;
      let flag = media.querySelector('.product-flag.in-cart');
      if (quantity) {
        if (!flag) { flag = document.createElement('span'); flag.className = 'product-flag in-cart'; media.appendChild(flag); }
        flag.textContent = `${quantity} in cart`;
      } else if (flag) flag.remove();
    });
  }

  // A signed-in customer should not retype what the platform already knows.
  function prefillDetails() {
    const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
    if (session?.role !== 'customer') return;
    const customer = (state.masjidPointCustomers || [])
      .find(c => c.id === session.customerId || String(c.email || '').toLowerCase() === String(session.email || '').toLowerCase());
    const values = {
      name: customer?.name || session.name || '',
      email: customer?.email || session.email || '',
      phone: customer?.phone || ''
    };
    for (const [field, value] of Object.entries(values)) {
      const input = form.elements[field];
      if (input && !input.value && value) input.value = value;
    }
    // Delivery goes to the address on file unless they change it.
    const address = customer?.address || customer?.deliveryAddress;
    if (address) for (const [field, value] of Object.entries(address)) {
      const input = form.elements[field];
      if (input && !input.value && value) input.value = value;
    }
  }

  // The shared header owns the navigation; the cart is the one action only this page needs,
  // so it is added into the header's action area rather than duplicating the nav here.
  const actions = document.querySelector('.site-nav-actions');
  if (actions && !document.querySelector('#open-cart')) {
    const basket = document.createElement('button');
    basket.id = 'open-cart';
    basket.type = 'button';
    basket.className = 'site-nav-basket';
    basket.setAttribute('aria-label', 'Open cart');
    basket.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.95-1.55L21 8H6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="20" r="1.4" fill="currentColor"/><circle cx="17.5" cy="20" r="1.4" fill="currentColor"/></svg><span>Cart</span><b id="cart-count">0</b>`;
    actions.prepend(basket);
  }

  document.querySelector('#open-cart').onclick = () => document.querySelector('#cart-drawer').hidden = false;
  document.querySelector('#close-cart').onclick = () => document.querySelector('#cart-drawer').hidden = true;
  document.querySelector('#shop-search').oninput = render;
  document.querySelector('#shop-category').onchange = e => { category = e.target.value; render(); };
  document.querySelector('#shop-price').onchange = render;
  document.querySelector('#shop-sort').onchange = render;
  document.querySelector('#shop-clear').onclick = () => {
    document.querySelector('#shop-search').value = '';
    document.querySelector('#shop-category').value = 'all';
    document.querySelector('#shop-price').value = 'all';
    document.querySelector('#shop-sort').value = 'featured';
    category = 'all';
    render();
  };

  let placing = false;
  form.onsubmit = async e => {
    e.preventDefault();
    if (placing) return;
    if (!method) return alert('This mosque shop is not accepting orders.');
    if (!cart.length) return alert('Your basket is empty.');
    if (cart.some(x => x.quantity > x.product.stock)) return alert('A product no longer has enough stock.');
    // Saving takes a round trip; block a second press so one basket cannot become two orders.
    placing = true;
    submit.disabled = true;
    submit.textContent = 'Placing order…';
    const d = new FormData(form);
    const items = cart.map(x => ({
      productId: x.product.id, name: x.product.name, description: x.product.description,
      // Never copy an inline image into the order: a data URL is duplicated per line item and per
      // order, and the collection is rewritten whole on every save, so a few orders push the
      // request past the server's 8 MB limit and orders silently stop saving. Displays resolve the
      // picture from the product by productId instead.
      image: String(x.product.image || '').startsWith('data:') ? '' : x.product.image,
      quantity: x.quantity, price: x.product.price, mosqueSharePercent: x.product.mosqueSharePercent || 0,
      mosqueRevenue: x.product.price * x.quantity * (x.product.mosqueSharePercent || 0) / 100
    }));
    const goods = items.reduce((s, x) => s + x.price * x.quantity, 0), fee = currentFee(), placedAt = new Date().toISOString();
    const order = {
      id: `ORD-${Date.now()}`,
      customer: { name: d.get('name'), email: d.get('email'), phone: d.get('phone') },
      collectionMasjidReference: mosque.reference,
      collectionMasjidName: mosque.name,
      fulfilmentMethod: method.key,
      items,
      goodsTotal: Number(goods.toFixed(2)),
      deliveryFee: fee,
      total: Number((goods + fee).toFixed(2)),
      mosqueRevenue: Number(items.reduce((s, x) => s + x.mosqueRevenue, 0).toFixed(2)),
      status: 'ordered',
      // Pay-now and delivery orders owe a bank transfer; pay-at-mosque owes the mosque at handover.
      paymentStatus: method.paysUpfront ? 'awaiting_bank_transfer' : 'pay_at_mosque',
      placedAt,
      history: [{ status: 'ordered', at: placedAt, by: 'customer' }]
    };
    if (method.needsAddress) order.deliveryAddress = { line1: d.get('line1'), line2: d.get('line2'), city: d.get('city'), postcode: d.get('postcode') };
    items.forEach(item => products.find(p => p.id === item.productId).stock -= item.quantity);
    orders.push(order);
    await Promise.all([MasjidDB.save('masjidPointProducts', products), MasjidDB.save('masjidPointShopOrders', orders)]);
    // `e.currentTarget` is null once the handler has awaited, so hold the form reference.
    form.hidden = true;
    document.querySelector('#cart-lines').hidden = true;
    cart = [];
    saveCart();
    render();
    // Orders paid up front stop at a payment step — bank details, the reference to quote and a
    // place to send evidence — before the receipt. Pay-at-the-mosque owes nothing yet, so it goes
    // straight through.
    if (method.paysUpfront) return showPaymentStep(order);
    return showSuccess(order);
  };

  function showSuccess(order, banner = '') {
    const heading = document.querySelector('#cart-drawer h2');
    if (heading) heading.textContent = 'Order confirmed';
    const success = document.querySelector('#order-success');
    success.innerHTML = `${banner}<h2>Order received</h2><p>Your reference is <strong>${order.id}</strong>. ${method.needsAddress
      ? `We will deliver to ${esc([order.deliveryAddress.line1, order.deliveryAddress.postcode].filter(Boolean).join(', '))}.`
      : method.paysUpfront
        ? `Collect from ${esc(mosque.name)} once your payment is verified and we notify you.`
        : `Collect from ${esc(mosque.name)} when notified, and pay the mosque ${money(order.total)} then.`}</p>`;
    // Offer to keep the order somewhere they can find it, prefilled from what they just typed.
    const signedIn = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null')?.role === 'customer';
    success.insertAdjacentHTML('beforeend', signedIn
      ? `<p class="order-account"><a href="my-account">See this order in your account →</a></p>`
      : `<div class="order-next">
           <h3>Keep track of this order</h3>
           <p>Create an account and we'll keep this order — and any job applications — in one place. Your details are already filled in, so you only need a password.</p>
           <a class="button" href="customer-signup?order=${encodeURIComponent(order.id)}">Create my account →</a>
           <p class="order-alt">Already have one? <a href="login?return=my-account">Sign in</a></p>
         </div>`);
    success.hidden = false;
  }

  // Step two of checkout for anything paid by bank transfer. The order already exists, so the
  // payment reference the customer must quote is available to show here.
  async function showPaymentStep(order) {
    const latest = await MasjidDB.state();
    const saved = (latest.masjidPointShopOrders || []).find(x => x.id === order.id) || order;
    const reference = saved.paymentReference || order.id;
    const bank = latest.masjidPointPlatformSettings?.bankDetails;
    const published = bank?.active === true;

    let step = document.querySelector('#payment-step');
    if (!step) {
      step = document.createElement('section');
      step.id = 'payment-step';
      step.className = 'payment-step';
      document.querySelector('#order-success').before(step);
    }

    // This is a second screen inside the drawer, not something appended below the form, so the
    // drawer is retitled and scrolled back to the top.
    const heading = document.querySelector('#cart-drawer h2');
    if (heading) heading.textContent = 'Payment';

    step.innerHTML = `
      <p class="step-kicker">Step 2 of 2</p>
      <h2>Pay ${money(order.total)} by bank transfer</h2>
      <p class="payment-step-intro">Your order <strong>${esc(order.id)}</strong> is saved. Transfer the total using the reference below, then send us the receipt so we can verify it.</p>
      ${published ? `<div class="payment-step-bank">
        <span><small>Account name</small><strong>${esc(bank.accountName)}</strong></span>
        <span><small>Bank</small><strong>${esc(bank.bankName)}</strong></span>
        <span><small>Sort code</small><strong>${esc(bank.sortCode)}</strong></span>
        <span><small>Account number</small><strong>${esc(bank.accountNumber)}</strong></span>
        ${bank.iban ? `<span class="wide"><small>IBAN</small><strong>${esc(bank.iban)}</strong></span>` : ''}
        <span class="wide payment-step-reference"><small>Payment reference — use exactly this</small><strong>${esc(reference)}</strong></span>
        ${bank.instructions ? `<p class="wide">${esc(bank.instructions)}</p>` : ''}
      </div>` : `<div class="payment-step-bank payment-step-unpublished">
        <span class="wide payment-step-reference"><small>Payment reference</small><strong>${esc(reference)}</strong></span>
        <p class="wide">Bank-transfer details have not been published yet. Contact ${esc(mosque.name)} to arrange payment, quoting this reference.</p>
      </div>`}
      <form id="proof-form" novalidate>
        <h3>Send your payment receipt</h3>
        <div class="payment-step-fields">
          <label><span>Amount paid <em>*</em></span><input name="amount" type="number" min="0.01" step="0.01" value="${Number(order.total).toFixed(2)}" required></label>
          <label><span>Payment date <em>*</em></span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
          <label class="wide"><span>Bank transaction reference <em>*</em></span><input name="bankReference" required placeholder="Shown on your bank statement"></label>
          <label class="wide"><span>Screenshot or receipt <em>*</em></span><input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required><small>PNG, JPG, WebP or PDF, up to 5 MB.</small></label>
        </div>
        <p class="payment-step-error" id="proof-error" hidden></p>
        <div class="payment-step-actions">
          <button class="button" type="submit">Send payment proof →</button>
          <button type="button" id="proof-later">I'll send proof later</button>
        </div>
        <p class="payment-step-note">Your order is held either way. It is prepared once MasjidPoint verifies the payment.</p>
      </form>`;
    step.hidden = false;
    for (let node = step.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight) { node.scrollTop = 0; break; }
    }

    const proofForm = step.querySelector('#proof-form');
    const error = step.querySelector('#proof-error');

    step.querySelector('#proof-later').onclick = () => {
      step.hidden = true;
      showSuccess(order, `<p class="order-banner">Send your receipt whenever you are ready — quote reference <strong>${esc(reference)}</strong>.</p>`);
    };

    proofForm.onsubmit = async event => {
      event.preventDefault();
      const button = proofForm.querySelector('button[type=submit]');
      const file = proofForm.elements.file.files[0];
      const amount = Number(proofForm.elements.amount.value);
      const bankReference = proofForm.elements.bankReference.value.trim();
      if (!(amount > 0) || !bankReference || !file) {
        error.textContent = 'Enter the amount, your bank reference and attach the receipt.';
        error.hidden = false;
        return;
      }
      // The server rejects request bodies over 8 MB, so evidence is shrunk or refused before it is sent.
      if (file.size > 5 * 1024 * 1024) {
        error.textContent = 'That file is larger than 5 MB. Attach a smaller screenshot or PDF.';
        error.hidden = false;
        return;
      }
      error.hidden = true;
      button.disabled = true;
      button.textContent = 'Sending…';
      try {
        const encoded = file.type === 'application/pdf'
          ? await ImageDownscale.read(file)
          : await ImageDownscale.fromFile(file);
        const response = await fetch('/api/shop/proof', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: order.id, amount, date: proofForm.elements.date.value, bankReference, file: encoded, fileName: file.name })
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'That could not be sent.');
        step.hidden = true;
        showSuccess(order, '<p class="order-banner order-banner-done">Payment proof received. MasjidPoint will verify it and confirm your order.</p>');
      } catch (failure) {
        error.textContent = `${failure.message} Your order is saved — you can send the receipt later.`;
        error.hidden = false;
        button.disabled = false;
        button.textContent = 'Send payment proof →';
      }
    };
  }

  // The saved cart must be read before anything renders: renderFulfilment() re-renders the cart,
  // and that writes it back — an empty cart would overwrite the stored one before it was loaded.
  loadCart();
  renderFulfilment();
  prefillDetails();
  render();
  renderCart();

  // Methods paid up front continue to a payment step, so the button should not promise otherwise.
  const syncSubmitLabel = () => { if (!placing) submit.textContent = method?.paysUpfront ? 'Continue to payment →' : 'Place order'; };
  form.addEventListener('change', syncSubmitLabel);
  syncSubmitLabel();
})();
