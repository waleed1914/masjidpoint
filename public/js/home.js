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

  // On phones the three trust messages form a compact swipeable snap track. The dots both show
  // the current card and act as controls; desktop keeps the ordinary three-column strip.
  const promiseTrack = document.querySelector('#promise-track');
  const promiseDots = [...document.querySelectorAll('.promise-dots button')];
  if (promiseTrack && promiseDots.length) {
    const promiseCards = [...promiseTrack.querySelectorAll('article')];
    const mobileCarousel = matchMedia('(max-width: 560px)');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let activePromise = 0;
    let promiseTimer = null;
    let promiseMotionTimer = null;
    let promiseVisible = false;
    const cardLeft = card => card.offsetLeft - promiseTrack.offsetLeft;
    const setPromiseDot = (index, moving = false) => {
      activePromise = index;
      promiseDots.forEach((dot, dotIndex) => {
        const selected = dotIndex === index;
        dot.classList.toggle('is-active', selected);
        dot.classList.toggle('is-moving', selected && moving);
        if (selected) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
      clearTimeout(promiseMotionTimer);
      if (moving) promiseMotionTimer = setTimeout(() => promiseDots.forEach(dot => dot.classList.remove('is-moving')), 190);
    };
    const movePromise = (index, smooth = true) => {
      const next = (index + promiseCards.length) % promiseCards.length;
      promiseTrack.scrollTo({ left: cardLeft(promiseCards[next]), behavior: smooth ? 'smooth' : 'auto' });
      setPromiseDot(next, smooth);
    };
    const stopPromiseAuto = () => { clearTimeout(promiseTimer); promiseTimer = null; };
    const startPromiseAuto = () => {
      stopPromiseAuto();
      if (!mobileCarousel.matches || !promiseVisible || document.hidden) return;
      promiseTimer = setTimeout(() => {
        movePromise(activePromise + 1, !reducedMotion.matches);
        startPromiseAuto();
      }, 3600);
    };
    let promiseFrame = null;
    promiseTrack.addEventListener('scroll', () => {
      cancelAnimationFrame(promiseFrame);
      promiseFrame = requestAnimationFrame(() => {
        const closest = promiseCards.reduce((best, card, index) => {
          const distance = Math.abs(cardLeft(card) - promiseTrack.scrollLeft);
          return distance < best.distance ? { index, distance } : best;
        }, { index: 0, distance: Infinity });
        setPromiseDot(closest.index, true);
      });
    }, { passive: true });
    promiseDots.forEach((dot, index) => dot.addEventListener('click', () => {
      movePromise(index);
      startPromiseAuto();
    }));
    promiseTrack.addEventListener('pointerdown', stopPromiseAuto, { passive: true });
    promiseTrack.addEventListener('pointerup', startPromiseAuto, { passive: true });
    promiseTrack.addEventListener('pointercancel', startPromiseAuto, { passive: true });
    promiseTrack.addEventListener('focusin', stopPromiseAuto);
    promiseTrack.addEventListener('focusout', startPromiseAuto);
    document.addEventListener('visibilitychange', startPromiseAuto);
    mobileCarousel.addEventListener?.('change', () => {
      if (!mobileCarousel.matches) movePromise(0, false);
      startPromiseAuto();
    });
    setPromiseDot(0);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        promiseVisible = entries[0]?.isIntersecting || false;
        if (promiseVisible) startPromiseAuto();
        else stopPromiseAuto();
      }, { threshold: .28 }).observe(promiseTrack);
    } else {
      promiseVisible = true;
      startPromiseAuto();
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
  const mobileHomeCarousel = matchMedia('(max-width: 560px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileCarouselState = {
    business: { destroy: () => {}, signature: '' },
    masjid: { destroy: () => {}, signature: '' },
    job: { destroy: () => {}, signature: '' },
    how: { destroy: () => {}, signature: '' }
  };

  function perRow(cards) {
    if (!cards.length) return FALLBACK;
    const wasHidden = cards.map(card => card.hidden);
    cards.forEach(card => { card.hidden = false; });
    const top = Math.round(cards[0].getBoundingClientRect().top);
    const count = cards.filter(card => Math.round(card.getBoundingClientRect().top) === top).length;
    cards.forEach((card, index) => { card.hidden = wasHidden[index]; });
    return count || FALLBACK;
  }

  function moreButton(grid, total, shown, href, label, compact = false) {
    const id = `${grid.id}-more`;
    let button = document.querySelector(`#${id}`);
    if (!compact && total <= shown) { button?.remove(); return; }
    if (!button) {
      button = document.createElement('a');
      button.id = id;
      button.className = 'button button-outline view-all';
      grid.insertAdjacentElement('afterend', button);
    }
    button.href = href;
    button.textContent = compact ? 'View all \u2192' : `${label} (${total}) \u2192`;
  }

  function setupHomeCarousel(grid, cards, kind) {
    const carousel = mobileCarouselState[kind];
    const visibleCards = cards.filter(card => !card.hidden);
    const signature = visibleCards.map(card => card.dataset.requestId || card.textContent).join('|');
    if (!mobileHomeCarousel.matches || visibleCards.length < 2) {
      carousel.destroy();
      carousel.destroy = () => {};
      carousel.signature = '';
      document.querySelector(`.${kind}-carousel-controls`)?.remove();
      return;
    }
    if (signature === carousel.signature && document.querySelector(`.${kind}-carousel-dots`)) return;
    carousel.destroy();
    document.querySelector(`.${kind}-carousel-controls`)?.remove();
    carousel.signature = signature;

    const controls = document.createElement('div');
    controls.className = `${kind}-carousel-controls`;
    const dots = document.createElement('div');
    dots.className = `${kind}-carousel-dots`;
    dots.setAttribute('aria-label', `Choose a ${kind}`);
    dots.innerHTML = visibleCards.map((_, index) => `<button type="button" aria-label="Show ${kind} ${index + 1}"${index === 0 ? ' class="is-active" aria-current="true"' : ''}></button>`).join('');
    controls.appendChild(dots);
    grid.insertAdjacentElement('afterend', controls);
    const viewAll = document.querySelector(`#${grid.id}-more`);
    if (viewAll) controls.appendChild(viewAll);
    const dotButtons = [...dots.querySelectorAll('button')];
    const cardLeft = card => card.offsetLeft - grid.offsetLeft;
    let active = 0;
    let timer = null;
    let frame = null;
    let motionTimer = null;
    let inViewport = false;
    let visibilityObserver = null;
    const setActive = (index, moving = false) => {
      active = index;
      dotButtons.forEach((dot, dotIndex) => {
        const selected = dotIndex === index;
        dot.classList.toggle('is-active', selected);
        dot.classList.toggle('is-moving', selected && moving);
        dot.toggleAttribute('aria-current', selected);
      });
      clearTimeout(motionTimer);
      if (moving) motionTimer = setTimeout(() => dotButtons.forEach(dot => dot.classList.remove('is-moving')), 190);
    };
    const moveTo = (index, smooth = true) => {
      const next = (index + visibleCards.length) % visibleCards.length;
      grid.scrollTo({ left: cardLeft(visibleCards[next]), behavior: smooth ? 'smooth' : 'auto' });
      setActive(next, smooth);
    };
    const stop = () => { clearTimeout(timer); timer = null; };
    const start = () => {
      stop();
      if (!mobileHomeCarousel.matches || !inViewport || document.hidden) return;
      timer = setTimeout(() => { moveTo(active + 1, !reducedMotion.matches); start(); }, 3600);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const closest = visibleCards.reduce((best, card, index) => {
          const distance = Math.abs(cardLeft(card) - grid.scrollLeft);
          return distance < best.distance ? { index, distance } : best;
        }, { index: 0, distance: Infinity });
        setActive(closest.index, true);
      });
    };
    const onVisibility = () => start();
    grid.addEventListener('scroll', onScroll, { passive: true });
    grid.addEventListener('pointerdown', stop, { passive: true });
    grid.addEventListener('pointerup', start, { passive: true });
    grid.addEventListener('pointercancel', start, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    dotButtons.forEach((dot, index) => dot.addEventListener('click', () => { moveTo(index); start(); }));
    grid.scrollLeft = 0;
    if ('IntersectionObserver' in window) {
      visibilityObserver = new IntersectionObserver(entries => {
        inViewport = entries[0]?.isIntersecting || false;
        if (inViewport) start();
        else stop();
      }, { threshold: .28 });
      visibilityObserver.observe(grid);
    } else {
      inViewport = true;
      start();
    }
    carousel.destroy = () => {
      stop();
      clearTimeout(motionTimer);
      visibilityObserver?.disconnect();
      cancelAnimationFrame(frame);
      grid.removeEventListener('scroll', onScroll);
      grid.removeEventListener('pointerdown', stop);
      grid.removeEventListener('pointerup', start);
      grid.removeEventListener('pointercancel', start);
      document.removeEventListener('visibilitychange', onVisibility);
      if (viewAll && controls.contains(viewAll)) grid.insertAdjacentElement('afterend', viewAll);
      controls.remove();
    };
  }

  function applyLimit(selector) {
    const grid = document.querySelector(selector);
    if (!grid) return;
    const cards = [...grid.children].filter(node => node.nodeType === 1);
    if (!cards.length) return;
    if (mobileHomeCarousel.matches && ['#business-grid', '#masjid-grid'].includes(selector)) {
      cards.forEach((card, index) => { card.hidden = index >= 6; });
      const business = selector === '#business-grid';
      moreButton(grid, cards.length, 0, business ? 'businesses' : 'masjids', 'View all', true);
      setupHomeCarousel(grid, cards, business ? 'business' : 'masjid');
      return;
    }
    const limit = perRow(cards);
    cards.forEach((card, index) => { card.hidden = index >= limit; });
    if (selector === '#business-grid') {
      setupHomeCarousel(grid, cards, 'business');
      moreButton(grid, cards.length, limit, 'businesses', 'View all businesses');
    } else {
      setupHomeCarousel(grid, cards, 'masjid');
      moreButton(grid, cards.length, limit, 'masjids', 'Browse all masjids');
    }
  }
  window.refreshHomeGrid = applyLimit;

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

  mobileHomeCarousel.addEventListener?.('change', () => GRIDS.forEach(applyLimit));
  addEventListener('masjidpoint:masjids-rendered', () => applyLimit('#masjid-grid'));

  function applyJobCarousel() {
    const grid = document.querySelector('#home-job-preview');
    if (!grid) return;
    const cards = [...grid.querySelectorAll('.job-card')];
    if (!cards.length) {
      document.querySelector('#home-job-preview-more')?.remove();
      setupHomeCarousel(grid, cards, 'job');
      return;
    }
    if (mobileHomeCarousel.matches) {
      moreButton(grid, cards.length, 0, 'public-jobs', 'View all', true);
      setupHomeCarousel(grid, cards, 'job');
    } else {
      setupHomeCarousel(grid, cards, 'job');
      document.querySelector('#home-job-preview-more')?.remove();
    }
  }
  const jobPreview = document.querySelector('#home-job-preview');
  if (jobPreview) {
    let jobQueued = null;
    new MutationObserver(() => {
      clearTimeout(jobQueued);
      jobQueued = setTimeout(applyJobCarousel, 50);
    }).observe(jobPreview, { childList: true });
    applyJobCarousel();
  }
  mobileHomeCarousel.addEventListener?.('change', applyJobCarousel);

  function applyHowCarousel() {
    const grid = document.querySelector('#how-it-works .how-grid');
    if (!grid) return;
    setupHomeCarousel(grid, [...grid.querySelectorAll('article')], 'how');
  }
  applyHowCarousel();
  mobileHomeCarousel.addEventListener?.('change', applyHowCarousel);

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
