(async function () {
  const state = await MasjidDB.state();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const reference = new URLSearchParams(location.search).get('reference') || '';
  const listings = DirectoryData.liveAdverts(state);
  const selected = listings.find(item => [item.reference, item.id].includes(reference));
  const profile = document.querySelector('#business-detail');
  const empty = document.querySelector('#business-detail-empty');

  if (!selected) {
    empty.hidden = false;
    return;
  }

  const sameBusiness = item => item === selected
    || (selected.businessCode && item.businessCode === selected.businessCode)
    || (selected.email && String(item.email).toLowerCase() === String(selected.email).toLowerCase());
  const related = listings.filter(sameBusiness);
  const mosques = DirectoryData.operationalMosques(state);
  const approvedMosques = [...new Map(related.map(item => {
    const mosque = mosques.find(entry => entry.reference === item.masjidReference || entry.name === item.masjid);
    return [item.masjidReference || item.masjid, mosque || { reference: item.masjidReference, name: item.masjid }];
  }).filter(([, mosque]) => mosque?.name)).values()];
  const website = String(selected.website || '').trim();
  const safeWebsite = /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : '';

  document.title = `${selected.name} — MasjidPoint`;
  profile.innerHTML = `
    <header class="business-profile-hero">
      <div class="business-profile-avatar-wrap">
        <span class="business-profile-avatar" data-business-avatar data-business-reference="${esc(selected.reference || selected.id)}" data-business-name="${esc(selected.name)}" data-image-class="business-profile-avatar-image" data-button-class="business-profile-image-trigger">${esc(initials(selected.name))}</span>
      </div>
      <div class="business-profile-heading">
        <p class="eyebrow"><span></span> Community-approved business</p>
        <h1>${esc(selected.name)}</h1>
        <div class="business-profile-tags"><span>${esc(selected.category || 'Local business')}</span><span>${approvedMosques.length} approving masjid${approvedMosques.length === 1 ? '' : 's'}</span></div>
        <p>${esc(selected.description || 'This business is listed through a participating local masjid.')}</p>
      </div>
    </header>
    <div class="business-profile-grid">
      <section class="business-profile-card">
        <p class="eyebrow"><span></span> Contact the business</p>
        <h2>Business details</h2>
        <dl>
          ${selected.phone ? `<div><dt>Phone</dt><dd><a href="tel:${esc(String(selected.phone).replace(/\s+/g, ''))}">${esc(selected.phone)}</a></dd></div>` : ''}
          ${selected.email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(selected.email)}">${esc(selected.email)}</a></dd></div>` : ''}
          ${safeWebsite ? `<div><dt>Website</dt><dd><a href="${esc(safeWebsite)}" target="_blank" rel="noopener">Visit website &#8599;</a></dd></div>` : ''}
          <div><dt>Category</dt><dd>${esc(selected.category || 'Local business')}</dd></div>
          <div><dt>Listing reference</dt><dd>${esc(selected.businessCode || selected.reference || selected.id)}</dd></div>
        </dl>
      </section>
      <section class="business-profile-card business-profile-mosques">
        <p class="eyebrow"><span></span> Trusted locally</p>
        <h2>Approved by</h2>
        <p>Each public listing is reviewed by the masjid it advertises through.</p>
        <div class="business-profile-mosque-list">
          ${approvedMosques.map(mosque => `<a href="masjid-adverts?reference=${encodeURIComponent(mosque.reference || '')}"><span aria-hidden="true">⌂</span><b>${esc(mosque.name)}</b><em>View masjid &#8594;</em></a>`).join('')}
        </div>
      </section>
    </div>`;
  profile.hidden = false;
})();
