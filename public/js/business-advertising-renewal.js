(async function () {
  const host = document.querySelector('#listing-cards');
  if (!host || !window.MasjidDB) return;
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null'); } catch (_) {}
  if (session?.role !== 'business') return;
  const state = await MasjidDB.state();
  const business = (state.masjidPointAdminApplications || []).find(item => item.reference === session.reference);
  if (!business) return;
  const requests = (state.masjidPointBusinessRequests || []).filter(request =>
    request.reference === business.reference || request.businessCode === business.businessCode
      || String(request.email || '').toLowerCase() === String(business.email || '').toLowerCase());
  let selected = null;

  const modal = document.createElement('div');
  modal.className = 'renewal-modal'; modal.hidden = true;
  modal.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="renewal-title"><header><div><small>Advertising renewal</small><h2 id="renewal-title"></h2></div><button type="button" data-renewal-close aria-label="Close">×</button></header><section><div class="renewal-calendar"><span>◇</span><p><small>Current paid period ends</small><strong id="renewal-date"></strong></p></div><p id="renewal-message"></p><div class="renewal-notice"><b>i</b><span>Your advert remains public until the date above. Stopping renewal does not refund or shorten the period already paid for.</span></div><p class="renewal-error" hidden></p></section><footer><button type="button" data-renewal-close>Keep current setting</button><button class="button" id="confirm-renewal" type="button"></button></footer></div>`;
  document.body.appendChild(modal);

  function periodEnd(request) { return request.paymentStatus === 'trial' || (!request.paidUntil && request.trialUntil) ? request.trialUntil : request.paidUntil; }
  function dateText(value) { return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function enhance() {
    requests.forEach(request => {
      const card = host.querySelector(`[data-advertising-request="${CSS.escape(request.id)}"]`); if (!card || card.querySelector('[data-renewal-request]')) return;
      const end = periodEnd(request), active = request.status === 'approved' && ['paid', 'trial'].includes(request.paymentStatus) && end && new Date(end) > new Date(), stopped = request.status === 'approved' && request.renewalStatus === 'stopped';
      if (!active && !stopped) return;
      const actions = document.createElement('div'); actions.className = 'advert-renewal-actions';
      const scheduled = request.cancelAtPeriodEnd === true || stopped;
      actions.innerHTML = `${stopped ? '<span>Advertising stopped · no renewal charge</span>' : scheduled ? `<span>Ends ${dateText(end)} · no renewal charge</span>` : '<span>Renews monthly</span>'}<button type="button" data-renewal-request="${request.id}">${stopped ? 'Restart advertising' : scheduled ? 'Keep advertising next month' : 'Stop from next month'}</button>`;
      card.querySelector('.listing-meta')?.appendChild(actions);
    });
  }
  function open(request) {
    selected = request; const stopping = !(request.cancelAtPeriodEnd || request.renewalStatus === 'stopped');
    document.querySelector('#renewal-title').textContent = stopping ? `Stop advertising at ${request.masjid} next month?` : `Continue advertising at ${request.masjid}?`;
    const end = periodEnd(request), current = end && new Date(end) > new Date();
    document.querySelector('#renewal-date').textContent = end ? dateText(end) : 'Already ended';
    document.querySelector('#renewal-message').textContent = stopping ? 'We will schedule this listing to finish at the end of its current paid period and will not raise the next monthly charge.' : current ? 'The scheduled stop will be removed and the advert will remain public through its current paid period.' : 'A new monthly invoice will be raised. The advert will return after the payment is verified.';
    const confirm = document.querySelector('#confirm-renewal'); confirm.textContent = stopping ? 'Stop renewal' : 'Continue next month'; confirm.classList.toggle('danger', stopping);
    document.querySelector('.renewal-error').hidden = true; modal.hidden = false;
  }
  function close() { modal.hidden = true; selected = null; }
  host.addEventListener('click', event => { const button = event.target.closest('[data-renewal-request]'); if (button) open(requests.find(item => item.id === button.dataset.renewalRequest)); });
  modal.querySelectorAll('[data-renewal-close]').forEach(button => button.onclick = close);
  modal.onclick = event => { if (event.target === modal) close(); };
  document.querySelector('#confirm-renewal').onclick = async event => {
    if (!selected) return; const button = event.currentTarget, stopping = !(selected.cancelAtPeriodEnd || selected.renewalStatus === 'stopped'), original = button.textContent;
    button.disabled = true; button.textContent = 'Saving…';
    try {
      const response = await fetch('/api/business/advertising-renewal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, action: stopping ? 'stop' : 'resume' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The renewal setting could not be saved.');
      location.reload();
    } catch (error) { const message = document.querySelector('.renewal-error'); message.textContent = error.message; message.hidden = false; button.disabled = false; button.textContent = original; }
  };
  enhance();
})();
