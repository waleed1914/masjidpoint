// Public directory for a single masjid: the businesses advertising through it and the jobs
// shared with its community. Only paid, mosque-enabled listings appear, so this page always
// reflects what the masjid has actually approved.
(async function () {
  const params = new URLSearchParams(location.search);
  const ref = params.get('reference') || params.get('masjidReference');
  const wanted = params.get('masjid');
  const state = await MasjidDB.state();

  const mosque = (state.masjidPointAdminApplications || []).find(app =>
    app.type === 'masjid'
    && ['approved', 'activated'].includes(app.status)
    && (app.reference === ref || app.id === ref || app.name === wanted));

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `£${Number(n || 0).toFixed(2)}`;

  if (!mosque) {
    document.querySelector('#masjid-name').textContent = 'Masjid not found';
    document.querySelector('#masjid-location').textContent = 'This masjid is not listed, or is not yet approved.';
    document.querySelector('.adverts-hero-actions').hidden = true;
    document.querySelectorAll('.adverts-block, .adverts-cta').forEach(node => node.hidden = true);
    return;
  }

  const rate = (state.masjidPointMasjidPricing || []).find(p => p.masjidReference === mosque.reference || p.masjidName === mosque.name);
  const adverts = (state.masjidPointBusinessRequests || []).filter(r =>
    (r.masjidReference === mosque.reference || r.masjid === mosque.name)
    && r.status === 'approved' && r.paymentStatus === 'paid' && r.listing === 'enabled');
  const jobs = (state.masjidPointJobs || []).filter(job =>
    job.status === 'live' && job.enabled
    && (job.masjids || []).some(m => (m.reference === mosque.reference || m.name === mosque.name) && m.paymentStatus === 'paid'));

  const shopProducts = (state.masjidPointProducts || []).filter(p =>
    p.visibility !== 'hidden' && p.stock > 0 && (p.mosques || []).some(m => m.reference === mosque.reference));

  document.title = `${mosque.name} — MasjidPoint`;
  document.querySelector('#masjid-name').textContent = mosque.name;
  const address = mosque.details?.Address || [mosque.details?.Postcode].filter(Boolean).join(' ');
  document.querySelector('#masjid-location').textContent = address || 'Verified UK masjid';

  const shopHref = `masjid-shop?reference=${encodeURIComponent(mosque.reference)}`;
  const advertiseHref = `advertise?masjidReference=${encodeURIComponent(mosque.reference)}&masjid=${encodeURIComponent(mosque.name)}`;
  const shopLink = document.querySelector('#shop-link');
  shopLink.href = shopHref;
  shopLink.hidden = !shopProducts.length;
  const navShop = document.querySelector('#nav-shop');
  if (navShop) { navShop.href = shopHref; navShop.hidden = !shopProducts.length; }
  document.querySelector('#jobs-link').href = `public-jobs?masjid=${encodeURIComponent(mosque.name)}`;
  const headerAdvertise = document.querySelector('#advertise-here');
  if (headerAdvertise) headerAdvertise.href = advertiseHref;
  document.querySelector('#cta-advertise').href = advertiseHref;
  if (rate) {
    document.querySelector('#cta-pricing').textContent =
      `Listings through ${mosque.name} are ${money(rate.advertisingPrice)} a month, with ${rate.mosquePercent}% going straight to the masjid. Jobs are ${money(rate.jobPrice)} per listing.`;
  }

  document.querySelector('#adverts-stats').innerHTML = [
    ['Businesses', adverts.length],
    ['Live jobs', jobs.length],
    ['Shop products', shopProducts.length]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');

  const categorySelect = document.querySelector('#advert-category');
  [...new Set(adverts.map(a => a.category).filter(Boolean))].sort()
    .forEach(c => categorySelect.add(new Option(c, c)));

  const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  function renderAdverts() {
    const q = document.querySelector('#advert-search').value.toLowerCase().trim();
    const category = categorySelect.value;
    const list = adverts.filter(a =>
      (category === 'all' || a.category === category)
      && (!q || `${a.name} ${a.description} ${a.category}`.toLowerCase().includes(q)));
    const grid = document.querySelector('#advert-grid');
    grid.innerHTML = list.map(a => {
      const detailHref = `/business-detail.html?reference=${encodeURIComponent(a.reference || a.id)}`;
      return `
      <article class="advert-card in-view" data-advert-id="${esc(a.id)}" data-detail-href="${esc(detailHref)}" tabindex="0" role="link" aria-label="View ${esc(a.name)} details" style="display:flex;opacity:1;visibility:visible;transform:none">
        <header><span class="advert-mark" data-business-avatar data-business-reference="${esc(a.reference||a.id)}" data-business-name="${esc(a.name)}" data-button-class="business-image-trigger advert-image-trigger" data-image-class="advert-mark">${esc(initials(a.name))}</span><div><h3>${esc(a.name)}</h3><small>${esc(a.category || 'Local business')}</small></div></header>
        <p>${esc(a.description || '')}</p>
        <dl>
          ${a.phone ? `<div><dt>Phone</dt><dd><a href="tel:${esc(String(a.phone).replace(/\s+/g, ''))}">${esc(a.phone)}</a></dd></div>` : ''}
          ${a.email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></dd></div>` : ''}
          ${a.website ? `<div><dt>Website</dt><dd><a href="${esc(a.website)}" target="_blank" rel="noopener">Visit site ↗</a></dd></div>` : ''}
        </dl>
        <footer><span class="advert-verified">✓ Approved by ${esc(mosque.name)}</span><a class="advert-detail-link" href="${esc(detailHref)}">View details →</a></footer>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-detail-href]').forEach(card => {
      const openDetails = () => { location.href = card.dataset.detailHref; };
      card.addEventListener('click', event => {
        if (event.target.closest('a,button,input,select,textarea')) return;
        openDetails();
      });
      card.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key) || event.target !== card) return;
        event.preventDefault();
        openDetails();
      });
    });
    document.querySelector('#advert-empty').hidden = list.length > 0;
    grid.hidden = !list.length;
  }

  const salary = job => {
    if (!job.salaryFrom) return 'Salary not specified';
    const from = Number(job.salaryFrom).toLocaleString('en-GB');
    const to = job.salaryTo ? `–£${Number(job.salaryTo).toLocaleString('en-GB')}` : '';
    return `£${from}${to} per ${job.payPeriod || 'year'}`;
  };

  document.querySelector('#job-list').innerHTML = jobs.map(job => `
    <article class="advert-job">
      <div><h3>${esc(job.title)}</h3><small>${esc(job.business)} · ${esc(job.city)}</small></div>
      <div class="advert-job-tags"><span>${esc(job.employmentType)}</span><span>${esc(job.arrangement)}</span></div>
      <div class="advert-job-salary">${esc(salary(job))}</div>
      <a class="button button-small" href="public-jobs?job=${encodeURIComponent(job.id)}">View role →</a>
    </article>`).join('');
  document.querySelector('#job-empty').hidden = jobs.length > 0;
  document.querySelector('#job-list').hidden = !jobs.length;

  document.querySelector('#advert-search').oninput = renderAdverts;
  categorySelect.onchange = renderAdverts;
  renderAdverts();

  // A few desktop browsers restore form/layout state after the async directory render. If that
  // removes a populated grid, restore it once the browser has finished that restoration pass.
  const advertGrid = document.querySelector('#advert-grid');
  let repairQueued = false;
  new MutationObserver(() => {
    if (repairQueued || advertGrid.querySelector('.advert-card')) return;
    const q = document.querySelector('#advert-search').value.toLowerCase().trim();
    const category = categorySelect.value;
    const shouldHaveCards = adverts.some(a =>
      (category === 'all' || a.category === category)
      && (!q || `${a.name} ${a.description} ${a.category}`.toLowerCase().includes(q)));
    if (!shouldHaveCards) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      if (!advertGrid.querySelector('.advert-card')) renderAdverts();
    });
  }).observe(advertGrid, { childList: true });
})();

// ---------------------------------------------------------------------------
// The page counted shop products but never showed them, and the masjid photo captured at
// registration was never used anywhere. Both are added here, along with a map link for the
// address, so the page says something about the masjid rather than just linking away from it.
// ---------------------------------------------------------------------------
(async function enrichMasjidPage() {
  const reference = new URLSearchParams(location.search).get('reference');
  if (!reference) return;
  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || [])
    .find(a => a.type === 'masjid' && (a.reference === reference || a.id === reference));
  if (!mosque) return;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => `£${Number(n || 0).toFixed(2)}`;

  // The photo the masjid uploaded when it registered.
  const hero = document.querySelector('.adverts-hero');
  if (mosque.photo && hero && !hero.querySelector('.masjid-hero-photo')) {
    const figure = document.createElement('span');
    figure.className = 'masjid-hero-photo';
    const image = new Image();
    image.alt = `${mosque.name}`;
    image.onerror = () => figure.remove();
    image.src = mosque.photo;
    figure.appendChild(image);
    hero.prepend(figure);
    hero.classList.add('has-photo');
  }

  // Directions, from the address already on screen.
  const address = mosque.details?.Address || mosque.details?.Postcode;
  const location_ = document.querySelector('#masjid-location');
  if (address && location_ && !document.querySelector('#masjid-map-link')) {
    const link = document.createElement('a');
    link.id = 'masjid-map-link';
    link.className = 'masjid-map-link';
    link.target = '_blank';
    link.rel = 'noopener';
    link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${mosque.name}, ${address}`)}`;
    link.textContent = 'Get directions \u2197';
    location_.insertAdjacentElement('afterend', link);
  }

  // What the shop actually sells, rather than only a number.
  const products = (state.masjidPointProducts || [])
    .filter(p => p.visibility !== 'hidden' && Number(p.stock) > 0
      && (p.mosques || []).some(m => m.reference === mosque.reference));
  const cta = document.querySelector('.adverts-cta');
  if (!products.length || !cta || document.querySelector('#masjid-shop-preview')) return;

  const rate = (state.masjidPointMasjidPricing || [])
    .find(p => p.masjidReference === mosque.reference || p.masjidName === mosque.name);
  const fulfilment = rate?.shopFulfilment || {};
  const ways = [
    fulfilment.collectPayNow && 'Pay now, collect',
    fulfilment.collectPayAtMosque && 'Pay at the masjid',
    fulfilment.delivery && `Delivery${Number(rate?.shopDeliveryFee) > 0 ? ` ${money(rate.shopDeliveryFee)}` : ''}`
  ].filter(Boolean);
  const from = Math.min(...products.map(p => Number(p.price)));
  const shopHref = `masjid-shop?reference=${encodeURIComponent(mosque.reference)}`;

  const section = document.createElement('section');
  section.className = 'adverts-block masjid-shop-preview';
  section.id = 'masjid-shop-preview';
  section.innerHTML = `
    <div class="block-heading">
      <div>
        <p class="eyebrow"><span></span> Community shop</p>
        <h2>What this masjid sells</h2>
        <p>${products.length} item${products.length === 1 ? '' : 's'} in stock from ${money(from)}. A share of every purchase goes back to ${esc(mosque.name)}.</p>
      </div>
      <a class="button" href="${shopHref}">Shop now \u2192</a>
    </div>
    ${ways.length ? `<p class="shop-preview-ways">${ways.map(w => `<em>${esc(w)}</em>`).join('')}</p>` : ''}
    <div class="shop-preview-grid">
      ${products.slice(0, 4).map(p => `
        <a class="shop-preview-card" href="${shopHref}">
          <span class="shop-preview-media"><img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span>
          <span class="shop-preview-body">
            <small>${esc(p.category || 'Community shop')}</small>
            <strong>${esc(p.name)}</strong>
            <b>${money(p.price)}</b>
          </span>
        </a>`).join('')}
    </div>
    ${products.length > 4 ? `<p class="shop-preview-more"><a href="${shopHref}">See all ${products.length} items \u2192</a></p>` : ''}`;
  cta.insertAdjacentElement('beforebegin', section);
})();

// Sections read as flat text on a flat background. They are given a little life on scroll:
// each block and its cards fade and lift into place once, staggered, and never again.
(function revealOnScroll() {
  const blocks = [...document.querySelectorAll('.adverts-block, .adverts-cta')];
  if (!blocks.length) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const observer = reduced ? null : new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  const watch = element => {
    if (element.dataset.reveal !== undefined) return;
    element.dataset.reveal = '';
    if (reduced) element.classList.add('in-view');
    else observer.observe(element);
  };

  // Cards arrive after their section does — the listings and the shop preview both render once
  // their data has loaded — so tagging runs again whenever the page adds anything.
  function tag() {
    document.querySelectorAll('.adverts-block, .adverts-cta').forEach(block => {
      watch(block);
      [...block.querySelectorAll('.shop-preview-card, .advert-job')]
        .forEach((item, index) => {
          if (item.dataset.reveal === undefined) item.style.setProperty('--reveal-delay', `${Math.min(index, 6) * 70}ms`);
          watch(item);
        });
    });
  }

  tag();
  let queued = null;
  new MutationObserver(() => {
    clearTimeout(queued);
    queued = setTimeout(tag, 60);
  }).observe(document.body, { childList: true, subtree: true });
})();

// Sections that can outgrow the page get a way out to the full listing, filtered to this masjid.
(async function sectionOverflowLinks() {
  const reference = new URLSearchParams(location.search).get('reference');
  if (!reference) return;
  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || [])
    .find(a => a.type === 'masjid' && (a.reference === reference || a.id === reference));
  if (!mosque) return;

  const name = encodeURIComponent(mosque.name);
  const add = (block, href, label) => {
    if (!block || block.querySelector('.section-view-all')) return;
    const heading = block.querySelector('.block-heading');
    if (!heading) return;
    const link = document.createElement('a');
    link.className = 'section-view-all';
    link.href = href;
    link.textContent = label;
    heading.appendChild(link);
  };

  const liveJobs = (state.masjidPointJobs || []).filter(job => job.status === 'live' && job.enabled
    && (job.masjids || []).some(m => m.reference === mosque.reference || m.name === mosque.name));
  if (liveJobs.length > 2) {
    add(document.querySelector('#jobs-block'),
      `public-jobs?masjid=${name}`, `View all ${liveJobs.length} roles \u2192`);
  }

  const listings = (state.masjidPointBusinessRequests || []).filter(r => r.status === 'approved'
    && r.paymentStatus === 'paid' && r.listing === 'enabled'
    && (r.masjidReference === mosque.reference || r.masjid === mosque.name));
  if (listings.length > 4) {
    add(document.querySelector('#businesses-block'),
      `businesses?masjid=${name}`, `View all ${listings.length} businesses \u2192`);
  }
})();

// An empty section is just furniture. If a masjid has no listings or no roles at all, the whole
// block goes rather than showing a heading over an empty-state box — the same way the shop
// section only exists when there is something to sell. A search that happens to match nothing
// still keeps its block, because that message is the answer to what was typed.
(async function hideEmptySections() {
  const params = new URLSearchParams(location.search);
  const reference = params.get('reference') || params.get('masjidReference');
  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || []).find(a => a.type === 'masjid'
    && ['approved', 'activated'].includes(a.status)
    && (a.reference === reference || a.id === reference || a.name === params.get('masjid')));
  if (!mosque) return;

  const listings = (state.masjidPointBusinessRequests || []).filter(r =>
    (r.masjidReference === mosque.reference || r.masjid === mosque.name)
    && r.status === 'approved' && r.paymentStatus === 'paid' && r.listing === 'enabled');
  const jobs = (state.masjidPointJobs || []).filter(job => job.status === 'live' && job.enabled
    && (job.masjids || []).some(m => (m.reference === mosque.reference || m.name === mosque.name) && m.paymentStatus === 'paid'));

  const businesses = document.querySelector('#businesses-block');
  if (businesses && !listings.length) businesses.hidden = true;
  const jobsBlock = document.querySelector('#jobs-block');
  if (jobsBlock && !jobs.length) jobsBlock.hidden = true;
})();
