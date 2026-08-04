// Mosque settlements, in both directions. Admin can read the two flows separately or as a
// single net figure; the switch only changes the presentation, never the underlying amounts.
(async function () {
  const panel = document.querySelector('.settlement-panel');
  const grid = document.querySelector('#settlement-grid');
  if (!panel || !grid) return;

  const money = n => `£${Number(n || 0).toFixed(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (url, data) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Name': 'Super Admin' }, body: JSON.stringify({ ...data, actor: 'Super Admin' }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'The action failed.');
    return result;
  };

  const state = await MasjidDB.state();
  const entries = SettlementRegister.build(state);
  const totals = SettlementRegister.totals(entries);
  let mode = sessionStorage.getItem('masjidPointSettlementMode') || 'net';
  let query = '';

  panel.querySelector('header').innerHTML = `
    <div><h2>Mosque settlements</h2><p>What MasjidPoint owes each mosque, and what mosques owe back from cash shop sales.</p></div>
    <div class="settlement-mode" role="group" aria-label="Settlement view">
      <button type="button" data-mode="net">Net position</button>
      <button type="button" data-mode="separate">Both directions</button>
    </div>`;

  const summary = document.createElement('div');
  summary.className = 'settlement-totals';
  summary.innerHTML = `
    <article><small>Owed to mosques</small><strong>${money(totals.owedToMosques)}</strong><span>Listing and bank-paid shop shares</span></article>
    <article class="owed-in"><small>Owed to MasjidPoint</small><strong>${money(totals.owedToPlatform)}</strong><span>Cash taken at mosque counters</span></article>
    <article><small>Net across all mosques</small><strong>${money(Math.abs(totals.net))}</strong><span>${totals.net >= 0 ? 'Payable out to mosques' : 'Collectable from mosques'}</span></article>
    <article><small>Settled to date</small><strong>${money(totals.settledToDate)}</strong><span>${totals.payingOut} to pay · ${totals.collecting} to collect</span></article>`;
  panel.querySelector('header').after(summary);

  // The header stat used to be computed separately and could disagree with this panel.
  const dueStat = document.querySelector('#masjid-due-total');
  if (dueStat) {
    dueStat.textContent = money(totals.owedToMosques);
    const note = dueStat.nextElementSibling;
    if (note) note.textContent = totals.owedToPlatform > 0
      ? `Awaiting settlement · ${money(totals.owedToPlatform)} owed back in cash`
      : 'Awaiting settlement';
  }

  function card(entry) {
    const owesUs = entry.net < 0;
    const breakdown = `<dl class="settlement-breakdown">
        <div><dt>Job and advert shares</dt><dd>${money(entry.fromListings)}</dd></div>
        <div><dt>Mosque shop shares</dt><dd>${money(entry.fromShop)}</dd></div>
        ${entry.owedToPlatform > 0 ? `<div class="owed-in"><dt>Cash held by mosque</dt><dd>−${money(entry.owedToPlatform)}</dd></div>` : ''}
        <div class="quiet"><dt>Settled to date</dt><dd>${money(entry.settledToDate)}</dd></div>
      </dl>`;

    const payOut = `<button class="settlement-pay" data-settle="${esc(entry.masjid)}" ${entry.owedToMosque <= 0 ? 'disabled' : ''}>Send ${money(entry.owedToMosque)} to mosque</button>`;
    const collect = `<button class="settlement-collect" data-remit="${esc(entry.masjid)}" ${entry.owedToPlatform <= 0 ? 'disabled' : ''}>Record ${money(entry.owedToPlatform)} received</button>`;

    if (mode === 'separate') {
      return `<article class="settlement-card">
        <header><h3>${esc(entry.masjid)}</h3></header>
        ${breakdown}
        <div class="settlement-directions">
          <div><small>MasjidPoint owes</small><strong>${money(entry.owedToMosque)}</strong>${payOut}</div>
          <div class="owed-in"><small>Mosque owes MasjidPoint</small><strong>${money(entry.owedToPlatform)}</strong>${collect}</div>
        </div>
      </article>`;
    }

    // A settled mosque has no direction to show, so don't claim one.
    const clear = entry.net === 0;
    const direction = clear
      ? '<span class="settlement-direction clear">Settled up</span>'
      : `<span class="settlement-direction ${owesUs ? 'in' : 'out'}">${owesUs ? 'Mosque owes MasjidPoint' : 'MasjidPoint owes mosque'}</span>`;
    return `<article class="settlement-card ${clear ? 'net-clear' : owesUs ? 'net-in' : 'net-out'}">
      <header><h3>${esc(entry.masjid)}</h3>${direction}</header>
      ${breakdown}
      <strong class="settlement-net">${money(Math.abs(entry.net))}</strong>
      ${clear
        ? '<p class="settlement-clear">Nothing outstanding either way.</p>'
        : `<button class="${owesUs ? 'settlement-collect' : 'settlement-pay'}" data-settle-net="${esc(entry.masjid)}">${owesUs ? `Record ${money(Math.abs(entry.net))} received` : `Send ${money(entry.net)} to mosque`}</button>
           ${entry.owedToPlatform > 0 && entry.owedToMosque > 0 ? `<small class="settlement-offset">Clears ${money(entry.owedToMosque)} owed out against ${money(entry.owedToPlatform)} held in cash.</small>` : ''}`}
    </article>`;
  }

  function render() {
    const visible = entries.filter(entry => !query || entry.masjid.toLowerCase().includes(query));
    grid.className = `settlement-grid mode-${mode}`;
    grid.innerHTML = visible.map(card).join('') || '<p class="finance-empty">No mosque has settlement activity yet.</p>';
    panel.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  }

  panel.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
    mode = button.dataset.mode;
    sessionStorage.setItem('masjidPointSettlementMode', mode);
    render();
  });

  // The existing search box above the grid is added by admin-payments-enhance.js.
  panel.addEventListener('input', event => {
    if (event.target.type !== 'search') return;
    query = event.target.value.toLowerCase().trim();
    render();
  });

  // Cash collection and net settlement are ours; the gross pay-out keeps the existing flow.
  panel.addEventListener('click', async event => {
    const button = event.target.closest('[data-remit],[data-settle-net]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const netMode = 'settleNet' in button.dataset;
    const masjid = netMode ? button.dataset.settleNet : button.dataset.remit;
    const reference = prompt(`Bank transaction reference for ${masjid}`);
    if (!reference) return;
    const note = prompt('Note (optional)') || '';
    button.disabled = true;
    try {
      if (netMode) {
        const result = await api('/api/settle/net', { masjid, transactionReference: reference, note });
        alert(result.net >= 0
          ? `Sent ${money(result.net)} to ${masjid} — ${money(result.owedOut)} owed out less ${money(result.owedIn)} held in cash.`
          : `Recorded ${money(Math.abs(result.net))} received from ${masjid} — ${money(result.owedIn)} cash held less ${money(result.owedOut)} owed out.`);
      } else {
        const result = await api('/api/mosque-cash/remit', { masjid, transactionReference: reference, note });
        alert(`Recorded ${money(result.amount)} received from ${masjid} across ${result.orders} cash order(s).`);
      }
      location.reload();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }, true);

  render();
})();
