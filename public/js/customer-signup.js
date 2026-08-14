// The same rule the server enforces. Checking only the length here meant a password with no
// lowercase letter passed, went to the server, and came back refused — the round trip was the
// only way to find out what was actually required.
function strongPassword(value){return typeof value==='string'&&value.length>=12&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value)&&/[^A-Za-z0-9]/.test(value)}
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
  const verification = document.querySelector('#customer-verification');
  const verificationForm = document.querySelector('#verification-form');
  let verificationEmail = '';
  function showVerification(email) {
    verificationEmail = String(email || '').trim().toLowerCase();
    form.hidden = true; verification.hidden = false;
    document.querySelector('#verification-email').textContent = verificationEmail;
    document.querySelector('#signup-heading').textContent = 'Check your inbox';
    document.querySelector('#signup-lede').textContent = 'Verify your email to securely activate your individual account.';
    verificationForm.elements.code.focus();
  }

  // Find whatever the visitor has already done, either by explicit reference or by email.
  const application = (state.masjidPointJobApplications || []).find(a =>
    a.reference === params.get('application'));
  const order = (state.masjidPointShopOrders || []).find(o => o.id === params.get('order'));

  const seedFrom = application
    ? { name: application.fullName, email: application.email, phone: application.phone, source: 'application' }
    : order
      ? { name: order.customer?.name, email: order.customer?.email, phone: order.customer?.phone, address: order.deliveryAddress, source: 'order' }
      : { name:params.get('name')||'',email:params.get('email')||'',phone:params.get('phone')||'',source:params.get('order')?'order':params.get('application')?'application':null };

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
      ? `We've filled in your details from application <strong>${esc(application?.reference||params.get('application'))}</strong>. Just choose a password.`
      : `We've filled in your details from order <strong>${esc(order?.id||params.get('order'))}</strong>. Just choose a password.`;
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
    if (!strongPassword(password)) { error.textContent = 'Use at least 12 characters with uppercase, lowercase, a number and a symbol.'; error.hidden = false; return; }
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
          password, address
        })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'We could not create the account.');
      showVerification(result.customer.email);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Create account →';
    }
  };
  verificationForm.onsubmit = async event => {
    event.preventDefault(); const verificationError = document.querySelector('#verification-error'); verificationError.hidden = true;
    const response = await fetch('/api/customer/verification/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:verificationEmail,code:verificationForm.elements.code.value})});
    const result=await response.json();if(!response.ok){verificationError.textContent=result.error||'The code could not be verified.';verificationError.hidden=false;return}
    location.href=`login?verified=1&email=${encodeURIComponent(verificationEmail)}`;
  };
  document.querySelector('#resend-customer-code').onclick=async()=>{const verificationError=document.querySelector('#verification-error');verificationError.hidden=true;const response=await fetch('/api/customer/verification/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:verificationEmail})});const result=await response.json();verificationError.textContent=result.message||result.error;verificationError.hidden=false;verificationError.style.color=response.ok?'#174d3f':''};
  if(params.get('verify'))showVerification(params.get('email'));
})();
