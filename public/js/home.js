// Home page motion and the shop preview. Everything here is additive: if it fails, the page is
// still a complete, readable home page.
(function () {
  // Sections rise into place once, as they are scrolled to.
  const blocks = [...document.querySelectorAll('[data-reveal]')];
  if (blocks.length) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      blocks.forEach(block => block.classList.add('in-view'));
    } else {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
      blocks.forEach(block => observer.observe(block));
      // Anything already on screen at load should not wait for a scroll that may never come.
      requestAnimationFrame(() => blocks.forEach(block => {
        if (block.getBoundingClientRect().top < innerHeight) block.classList.add('in-view');
      }));
    }
  }

  // The home page is a shop window, not the directory: show the newest few and send people to the
  // full list. Everything stays in the DOM so the search still looks across all of it — a search
  // that only found the five on screen would be worse than no search.
  // How many to show is measured, not guessed: each grid shows exactly the number that fills one
  // row at the current width. A fixed count leaves a gap on one screen size and spills a lone
  // card onto a second row on another.
  const GRIDS = ['#business-grid', '#masjid-grid'];
  const FALLBACK = 4;

  function perRow(cards) {
    if (!cards.length) return FALLBACK;
    const wasHidden = cards.map(card => card.hidden);
    cards.forEach(card => { card.hidden = false; });
    const top = Math.round(cards[0].getBoundingClientRect().top);
    const count = cards.filter(card => Math.round(card.getBoundingClientRect().top) === top).length;
    cards.forEach((card, index) => { card.hidden = wasHidden[index]; });
    return count || FALLBACK;
  }

  function isFiltering() {
    const category = document.querySelector('#category-chips .chip.active')?.dataset.category;
    return Boolean(category && category !== 'all');
  }

  function moreButton(grid, total, shown, href, label) {
    const id = `${grid.id}-more`;
    let button = document.querySelector(`#${id}`);
    if (total <= shown) { button?.remove(); return; }
    if (!button) {
      button = document.createElement('a');
      button.id = id;
      button.className = 'button button-outline view-all';
      grid.insertAdjacentElement('afterend', button);
    }
    button.href = href;
    button.textContent = `${label} (${total}) →`;
  }

  function applyLimit(selector) {
    const grid = document.querySelector(selector);
    if (!grid) return;
    const cards = [...grid.children].filter(node => node.nodeType === 1);
    if (!cards.length) return;
    const limit = perRow(cards);

    // While a search or category is active the filter owns what is visible.
    if (selector === '#business-grid' && isFiltering()) {
      document.querySelector('#business-grid-more')?.remove();
      return;
    }
    cards.forEach((card, index) => { card.hidden = index >= limit; });
    if (selector === '#business-grid') moreButton(grid, cards.length, limit, 'businesses', 'View all businesses');
    else moreButton(grid, cards.length, limit, 'masjids', 'Browse all masjids');
  }

  // A resize changes how many fit, so the row is recalculated.
  let resizeQueued = null;
  addEventListener('resize', () => {
    clearTimeout(resizeQueued);
    resizeQueued = setTimeout(() => GRIDS.forEach(applyLimit), 180);
  });

  GRIDS.forEach(selector => {
    const grid = document.querySelector(selector);
    if (!grid) return;
    let queued = null;
    new MutationObserver(() => {
      clearTimeout(queued);
      queued = setTimeout(() => applyLimit(selector), 50);
    }).observe(grid, { childList: true });
    applyLimit(selector);
  });

  // These run after the page's own handlers, so the limit is restored once a filter is cleared.
  ['#category-chips'].forEach(selector => {
    const element = document.querySelector(selector);
    if (!element) return;
    ['input', 'change', 'click'].forEach(type =>
      element.addEventListener(type, () => setTimeout(() => applyLimit('#business-grid'), 0)));
  });

  // Counting up reads as "this is live", where a static number reads as marketing copy.
  function countUp(element, target, suffix = '') {
    if (!isFinite(target) || target <= 0) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.textContent = `${suffix}${target}`;
      return;
    }
    const duration = 900;
    const start = performance.now();
    (function step(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = `${suffix}${Math.round(target * eased)}`;
      if (progress < 1) requestAnimationFrame(step);
    })(start);
  }

  (async function live() {
    if (typeof MasjidDB === 'undefined') return;
    let state;
    try { state = await MasjidDB.state(); } catch { return; }

    const masjids = (state.masjidPointAdminApplications || [])
      .filter(a => a.type === 'masjid' && ['approved', 'activated'].includes(a.status));
    const listings = (state.masjidPointBusinessRequests || [])
      .filter(r => r.status === 'approved' && r.paymentStatus === 'paid' && r.listing === 'enabled');

    // What the masjids have actually earned: their share of every settled invoice line.
    const raised = (state.masjidPointFinance?.accounts || [])
      .flatMap(account => account.invoices || [])
      .filter(invoice => Number(invoice.paid || 0) >= Number(invoice.amount) && Number(invoice.amount) > 0)
      .flatMap(invoice => invoice.lines || [])
      .reduce((total, line) => total + Number(line.amount || 0) * Number(line.mosquePercent ?? 70) / 100, 0);

    const businesses = document.querySelector('#stat-businesses');
    const masjidCount = document.querySelector('#stat-masjids');
    const support = document.querySelector('#stat-support');
    if (businesses) countUp(businesses, listings.length);
    if (masjidCount) countUp(masjidCount, masjids.length);
    if (support) countUp(support, Math.round(raised), '£');

    // A glimpse of what the shops actually sell, rather than a drawing of a bottle.
    const preview = document.querySelector('#shop-preview');
    if (!preview) return;
    const sellable = (state.masjidPointProducts || [])
      .filter(p => p.visibility !== 'hidden' && Number(p.stock) > 0 && (p.mosques || []).length);
    if (!sellable.length) return;

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => `£${Number(n || 0).toFixed(2)}`;
    preview.removeAttribute('aria-hidden');
    preview.innerHTML = sellable.slice(0, 4).map(product => {
      const mosque = product.mosques[0];
      return `<a href="masjid-shop?reference=${encodeURIComponent(mosque.reference)}">
        <img src="${esc(product.image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span>${esc(product.name)}<b>${money(product.price)}</b></span>
      </a>`;
    }).join('');
  })();
})();
