// Individual sign-up. Someone arriving straight from a job application or a shop order has
// already typed their details once, so the form is prefilled from that record and only the
// password is genuinely new.
(async function () {
  const params = new URLSearchParams(location.search);
  const state = await MasjidDB.state();
  const form = document.querySelector('#customer-signup-form');
  const error = document.querySelector('#signup-error');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hash = async value => masjidSha256(value);

  // Find whatever the visitor has already done, either by explicit reference or by email.
  const application = (state.masjidPointJobApplications || []).find(a =>
    a.reference === params.get('application'));
  const order = (state.masjidPointShopOrders || []).find(o => o.id === params.get('order'));

  const seedFrom = application
    ? { name: application.fullName, email: application.email, phone: application.phone, source: 'application' }
    : order
      ? { name: order.customer?.name, email: order.customer?.email, phone: order.customer?.phone, address: order.deliveryAddress, source: 'order' }
      : { email: params.get('email') || '', source: null };

  const set = (name, value) => { if (value) form.elements[name].value = value; };
  set('name', seedFrom.name);
  set('email', seedFrom.email);
  set('phone', seedFrom.phone);
  if (seedFrom.address) {
    set('line1', seedFrom.address.line1);
    set('city', seedFrom.address.city);
    set('postcode', seedFrom.address.postcode);
  }

  if (seedFrom.source) {
    const note = document.querySelector('#prefill-note');
    note.hidden = false;
    note.innerHTML = seedFrom.source === 'application'
      ? `We've filled in your details from application <strong>${esc(application.reference)}</strong>. Just choose a password.`
      : `We've filled in your details from order <strong>${esc(order.id)}</strong>. Just choose a password.`;
    document.querySelector('#signup-heading').textContent = 'Just one more step';
    document.querySelector('#signup-lede').textContent =
      'Set a password and your account is ready — everything you have already done will be waiting inside.';
  }

  // Show what this account will pick up, matched on the email they used.
  function showLinked(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) { document.querySelector('#linked-preview').hidden = true; return; }
    const apps = (state.masjidPointJobApplications || []).filter(a => String(a.email || '').toLowerCase() === clean);
    const orders = (state.masjidPointShopOrders || []).filter(o => String(o.customer?.email || '').toLowerCase() === clean);
    const items = [
      ...apps.map(a => `<li><strong>${esc(a.jobTitle || 'Job application')}</strong><small>${esc(a.business || '')} · ${esc(a.reference)}</small></li>`),
      ...orders.map(o => `<li><strong>Order ${esc(o.id)}</strong><small>${esc(o.collectionMasjidName || '')} · £${Number(o.total || 0).toFixed(2)}</small></li>`)
    ];
    document.querySelector('#linked-preview').hidden = !items.length;
    document.querySelector('#linked-list').innerHTML = items.join('');
  }
  showLinked(form.elements.email.value);
  form.elements.email.addEventListener('input', () => showLinked(form.elements.email.value));

  form.onsubmit = async event => {
    event.preventDefault();
    error.hidden = true;
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    if (password.length < 8) { error.textContent = 'Your password must be at least 8 characters.'; error.hidden = false; return; }
    if (password !== String(data.get('confirm'))) { error.textContent = 'The two passwords do not match.'; error.hidden = false; return; }

    const button = document.querySelector('#create-account');
    button.disabled = true;
    button.textContent = 'Creating account…';
    try {
      const address = ['line1', 'city', 'postcode'].some(k => String(data.get(k) || '').trim())
        ? { line1: String(data.get('line1') || '').trim(), city: String(data.get('city') || '').trim(), postcode: String(data.get('postcode') || '').trim().toUpperCase() }
        : null;
      const response = await fetch('/api/customer/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') || '').trim(),
          email: String(data.get('email') || '').trim(),
          phone: String(data.get('phone') || '').trim(),
          passwordHash: await hash(password), address
        })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'We could not create the account.');
      sessionStorage.setItem('masjidPointSession', JSON.stringify({
        role: 'customer', customerId: result.customer.id, email: result.customer.email,
        name: result.customer.name, signedInAt: new Date().toISOString()
      }));
      location.href = 'my-account';
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Create account →';
    }
  };
})();
