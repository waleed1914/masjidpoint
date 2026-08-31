// The same rule the server enforces. Checking only the length here meant a password with no
// lowercase letter passed, went to the server, and came back refused — the round trip was the
// only way to find out what was actually required.
function strongPassword(value){return typeof value==='string'&&value.length>=12&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value)&&/[^A-Za-z0-9]/.test(value)}
// The individual's portal: every job application and shop order tied to their email, plus the
// details they can fill in over time. Records are matched on email, so anything they did before
// creating the account still appears here.
(async function () {
  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (session?.role !== 'customer') { location.href = 'login?return=my-account'; return; }

  const state = await MasjidDB.state();

  // Orders no longer carry a copy of the product picture — inline images were duplicated into
  // every order and grew the collection past the server's request limit — so it is resolved from
  // the product instead. Older orders that still hold their own copy keep using it.
  const imageFor = productId => (state.masjidPointProducts || []).find(p => p.id === productId)?.image || '';
  const customer = (state.masjidPointCustomers || []).find(c => c.id === session.customerId);
  if (!customer) { sessionStorage.removeItem('masjidPointSession'); location.href = 'login'; return; }

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `£${Number(n || 0).toFixed(2)}`;
  const date = v => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const hash = async value => masjidSha256(value);

  const email = String(customer.email).toLowerCase();
  document.querySelector('#account-name').textContent = `Welcome back, ${customer.name.split(' ')[0]}`;
  document.querySelector('#account-email').textContent = customer.email;

  /* --------------------------------------------------------- job applications */
  const applications = (state.masjidPointJobApplications || [])
    .filter(a => String(a.email || '').toLowerCase() === email)
    .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));

  // An application's own status is the source of truth; the job tells us whether it is still open.
  const STATUS = {
    Submitted: { label: 'Submitted', tone: 'pending' },
    Reviewed: { label: 'Under review', tone: 'pending' },
    Shortlisted: { label: 'Shortlisted', tone: 'approved' },
    Accepted: { label: 'Accepted', tone: 'approved' },
    Rejected: { label: 'Not selected', tone: 'rejected' },
    Withdrawn: { label: 'Withdrawn', tone: 'quiet' }
  };

  const applicationState = application => {
    const status = String(application.status || 'Submitted').toLowerCase();
    if (['accepted', 'shortlisted'].includes(status)) return 'accepted';
    if (status === 'rejected') return 'rejected';
    if (status === 'reviewed') return 'under_review';
    if (status === 'withdrawn') return 'withdrawn';
    return 'submitted';
  };
  const applicationFilter = document.querySelector('#application-status-filter');
  const renderApplications = () => {
    const selected = applicationFilter.value;
    const visible = applications.filter(application => selected === 'all' || applicationState(application) === selected);
    document.querySelector('#applications-list').innerHTML = visible.map(a => {
    const job = (state.masjidPointJobs || []).find(j => j.id === a.jobId);
    const status = STATUS[a.status] || { label: a.status || 'Submitted', tone: 'pending' };
    const closed = job && !(job.status === 'live' && job.enabled);
    return `<article class="account-card application-card">
      <header>
        <div><h3>${esc(a.jobTitle || job?.title || 'Job application')}</h3><small>${esc(a.business || job?.business || '')}${job?.city ? ` · ${esc(job.city)}` : ''}</small></div>
        <span class="account-badge ${status.tone}">${esc(status.label)}</span>
      </header>
      <dl>
        <div><dt>Reference</dt><dd>${esc(a.reference)}</dd></div>
        <div><dt>Applied</dt><dd>${esc(date(a.submittedAt))}</dd></div>
        ${job?.masjid ? `<div><dt>Through</dt><dd>${esc(job.masjid)}</dd></div>` : ''}
        <div><dt>Listing</dt><dd>${closed ? 'No longer advertised' : 'Still open'}</dd></div>
      </dl>
      ${job && !closed ? `<a class="account-link" href="public-jobs?job=${encodeURIComponent(job.id)}">View the role →</a>` : ''}
    </article>`;
    }).join('');
    const empty = document.querySelector('#applications-empty');
    empty.hidden = visible.length > 0;
    empty.innerHTML = selected === 'all'
      ? `You haven't applied for any jobs yet. <a href="public-jobs">Browse community jobs →</a>`
      : 'No job applications match this status.';
  };
  applicationFilter.onchange = renderApplications;
  renderApplications();
  document.querySelector('#count-applications').textContent = applications.length;

  /* --------------------------------------------------------------- shop orders */
  const orders = (state.masjidPointShopOrders || [])
    .filter(o => String(o.customer?.email || '').toLowerCase() === email && o.status !== 'payment_pending' && !(o.paymentStatus === 'awaiting_bank_transfer' && !o.paymentProofId))
    .sort((a, b) => String(b.placedAt || '').localeCompare(String(a.placedAt || '')));

  const orderState = order => {
    const status = String(order.status || '').toLowerCase();
    const payment = String(order.paymentStatus || '').toLowerCase();
    if (['cancelled', 'refunded'].includes(status)) return 'cancelled';
    if (status === 'delivered') return 'completed';
    if (['ready_for_mosque', 'mosque_received', 'out_for_delivery'].includes(status)) return 'ready';
    if (['ordered', 'preparing'].includes(status)) return 'processing';
    if (['submitted', 'pending'].includes(payment)) return 'payment_sent';
    if (['awaiting_bank_transfer', 'rejected', 'unpaid'].includes(payment) || status === 'payment_pending') return 'awaiting_payment';
    return 'processing';
  };
  const orderFilter = document.querySelector('#order-status-filter');
  const renderOrders = () => {
    const selected = orderFilter.value;
    const visible = orders.filter(order => selected === 'all' || orderState(order) === selected);
    document.querySelector('#orders-list').innerHTML = visible.map(o => {
    const method = ShopFulfilment.methodOf(o);
    const address = ShopFulfilment.addressLines(o);
    const done = o.status === 'delivered';
    const orderLabels = { ordered: 'Order received', preparing: 'Being prepared', ready_for_mosque: 'Ready at masjid', mosque_received: 'At the masjid', out_for_delivery: 'Out for delivery', delivered: 'Completed', payment_pending: 'Awaiting payment' };
    return `<article class="account-card order-card">
      <header>
        <div><h3>Order ${esc(o.id)}</h3><small>${esc(o.collectionMasjidName || '')} · ${esc(date(o.placedAt))}</small></div>
        <span class="account-badge ${done ? 'approved' : 'pending'}">${esc(orderLabels[o.status] || String(o.status || '').replaceAll('_', ' '))}</span>
      </header>
      <div class="account-items">
        ${(o.items || []).map(i => `<span><img src="${esc(i.image || imageFor(i.productId))}" alt="" loading="lazy" onerror="this.hidden=true"><b>${esc(i.name)}</b><em>× ${Number(i.quantity || 0)}</em></span>`).join('')}
      </div>
      <dl>
        <div><dt>How you receive it</dt><dd>${esc(method.label)}</dd></div>
        <div><dt>Payment</dt><dd>${esc(ShopFulfilment.paymentLabel(o))}</dd></div>
        ${address.length ? `<div><dt>Delivery to</dt><dd>${esc(address.join(', '))}</dd></div>` : ''}
        ${Number(o.deliveryFee) > 0 ? `<div><dt>Delivery</dt><dd>${money(o.deliveryFee)}</dd></div>` : ''}
        <div><dt>Total</dt><dd><strong>${money(o.total)}</strong></dd></div>
      </dl>
      <a class="account-link" href="/api/shop/invoice.pdf?order=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">Download invoice ${esc(o.invoiceNumber || '')} ↓</a>
    </article>`;
    }).join('');
    const empty = document.querySelector('#orders-empty');
    empty.hidden = visible.length > 0;
    empty.innerHTML = selected === 'all'
      ? `You haven't ordered anything yet. <a href="shops">Visit a masjid shop →</a>`
      : 'No shop orders match this status.';
  };
  orderFilter.onchange = renderOrders;
  renderOrders();
  document.querySelector('#count-orders').textContent = orders.length;


  /* -------------------------------------------------------------------- tabs */
  const tabs = document.querySelector('#account-tabs');
  const accountTabKey='masjidPointIndividualAccountTab';
  const showAccountTab=name=>{const button=tabs.querySelector(`[data-tab="${name}"]`)||tabs.querySelector('[data-tab]');if(!button)return;tabs.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));['applications','orders','details'].forEach(panel=>document.querySelector(`#panel-${panel}`).hidden=panel!==button.dataset.tab);sessionStorage.setItem(accountTabKey,button.dataset.tab)};
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    showAccountTab(button.dataset.tab);
  });
  showAccountTab(sessionStorage.getItem(accountTabKey)||'applications');

  /* ----------------------------------------------------------------- details */
  const form = document.querySelector('#details-form');
  const detailsError = document.querySelector('#details-error');
  const detailsSuccess = document.querySelector('#details-success');
  form.elements.name.value = customer.name || '';
  form.elements.email.value = customer.email || '';
  form.elements.phone.value = customer.phone || '';
  form.elements.line1.value = customer.address?.line1 || '';
  form.elements.city.value = customer.address?.city || '';
  form.elements.postcode.value = customer.address?.postcode || '';

  form.onsubmit = async event => {
    event.preventDefault();
    detailsError.hidden = true; detailsSuccess.hidden = true;
    const data = new FormData(form);
    const current = String(data.get('currentPassword') || '');
    const next = String(data.get('newPassword') || '');
    const confirmation = String(data.get('confirmNewPassword') || '');
    if (!current) { detailsError.textContent = 'Enter your current password to save changes.'; detailsError.hidden = false; return; }
    if (next && !strongPassword(next)) { detailsError.textContent = 'Use at least 12 characters with uppercase, lowercase, a number and a symbol.'; detailsError.hidden = false; return; }
    if (next !== confirmation) { detailsError.textContent = 'The new passwords do not match.'; detailsError.hidden = false; return; }

    const button = document.querySelector('#save-details');
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const address = ['line1', 'city', 'postcode'].some(k => String(data.get(k) || '').trim())
        ? { line1: String(data.get('line1') || '').trim(), city: String(data.get('city') || '').trim(), postcode: String(data.get('postcode') || '').trim().toUpperCase() }
        : null;
      const response = await fetch('/api/customer/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: customer.id, currentPassword: current,
          name: String(data.get('name') || '').trim(), phone: String(data.get('phone') || '').trim(),
          address, ...(next ? { newPassword: next } : {})
        })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'We could not save your details.');
      detailsSuccess.hidden = false;
      form.elements.currentPassword.value = '';
      form.elements.newPassword.value = '';
      form.elements.confirmNewPassword.value = '';
      document.querySelector('#account-name').textContent = `Welcome back, ${result.customer.name.split(' ')[0]}`;
    } catch (problem) {
      detailsError.textContent = problem.message;
      detailsError.hidden = false;
    } finally {
      button.disabled = false; button.textContent = 'Save changes';
    }
  };

  document.querySelector('#sign-out').onclick = () => {
    sessionStorage.removeItem('masjidPointSession');
    location.href = '/';
  };
})();
