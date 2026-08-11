// "Active listings" — every business currently carrying this masjid's name, and what each one is
// worth to it.
//
// The sidebar has offered this since the portal was built and nothing ever rendered it, so the
// link went nowhere and a masjid had no way to see who advertises with it. Built from the business
// requests the masjid has already approved, so it needs no new data.
(async function () {
  'use strict';

  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  if (page !== 'masjid-listings') return;

  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (session?.role !== 'masjid') return;

  const state = await MasjidDB.state();
  const app = (state.masjidPointAdminApplications || []).find(a => a.reference === session.reference);
  if (!app) return;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => `£${Number(v || 0).toFixed(2)}`;

  const mine = (state.masjidPointBusinessRequests || []).filter(r => r.masjid === app.name);
  const pricing = (state.masjidPointMasjidPricing || []).find(p => p.masjidReference === app.reference) || {};
  const sharePercent = Number(pricing.mosquePercent ?? 70);

  // Live means the public directory shows it. Everything else is on its way there, or stopped.
  const stateOf = r => {
    if (r.status !== 'approved') return { label: r.status === 'rejected' ? 'Rejected' : 'Awaiting your decision', tone: 'pending' };
    if (r.paymentStatus !== 'paid') return { label: 'Awaiting payment', tone: 'pending' };
    if (r.listing === 'enabled') return { label: 'Live', tone: 'approved' };
    return { label: 'Paid — hidden by you', tone: 'disabled' };
  };

  const live = mine.filter(r => stateOf(r).label === 'Live');
  const monthly = live.reduce((sum, r) => sum + Number(r.price || 0) * sharePercent / 100, 0);

  const host = document.querySelector('.portal-content');
  if (!host) return;

  const section = document.createElement('section');
  section.className = 'request-panel';
  section.id = 'listings';
  section.innerHTML = `
    <header>
      <div>
        <h2>Businesses advertising with you</h2>
        <p>Everything currently carrying your masjid's name, and what it earns you each month.</p>
      </div>
      <span class="portal-badge ${live.length ? 'enabled' : ''}">${live.length} live</span>
    </header>
    <div class="portal-stats" style="margin:0;padding:18px 20px 0">
      <article><span>▤</span><p><small>Live listings</small><strong>${live.length}</strong><em>Visible in the public directory</em></p></article>
      <article><span>£</span><p><small>Your monthly share</small><strong>${money(monthly)}</strong><em>${sharePercent}% of live advertising</em></p></article>
      <article><span>◇</span><p><small>Total businesses</small><strong>${mine.length}</strong><em>Including pending and stopped</em></p></article>
    </div>
    <div class="request-table-wrap">
      <table>
        <thead><tr><th>Business</th><th>Category</th><th>Monthly</th><th>Your share</th><th>Status</th><th></th></tr></thead>
        <tbody>${mine.length ? mine.map(r => {
          const s = stateOf(r);
          const share = Number(r.price || 0) * sharePercent / 100;
          return `<tr>
            <td><strong>${esc(r.name)}</strong><small>${esc(r.email || '')}</small></td>
            <td>${esc(r.category || '—')}</td>
            <td>${money(r.price)}</td>
            <td>${s.label === 'Live' ? money(share) : '—'}</td>
            <td><span class="portal-badge ${s.tone}">${esc(s.label)}</span></td>
            <td>${s.label === 'Live' || s.label === 'Paid — hidden by you'
              ? `<button class="review-link" data-listing-toggle="${esc(r.id)}" type="button">${r.listing === 'enabled' ? 'Hide' : 'Show'}</button>`
              : ''}</td>
          </tr>`;
        }).join('') : '<tr><td colspan="6">No business has applied to advertise with you yet.</td></tr>'}</tbody>
      </table>
    </div>`;
  host.appendChild(section);

  // A masjid can still take a listing down, and put it back up. It no longer has to switch one on:
  // a listing goes live as soon as it is approved and paid for.
  section.querySelectorAll('[data-listing-toggle]').forEach(button => {
    button.addEventListener('click', async () => {
      const response=await fetch('/api/advertising/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:button.dataset.listingToggle,action:'toggle'})}),result=await response.json();
      if(!response.ok)return alert(result.error||'The listing could not be updated.');
      location.reload();
    });
  });
})();
