// Shared pagination for the public listing pages. Each of those pages renders its results by
// replacing a container's contents, so this works on the rendered children rather than on their
// data — one implementation covers masjids, businesses, shops and jobs without any of them
// needing to know about paging. Filtering re-renders the container, which resets to page one.
(function () {
  const PER_PAGE_CHOICES = [8, 12, 24, 48];
  const STORAGE_KEY = 'masjidPointPerPage';

  const TARGETS = {
    masjids: { container: '#masjid-results', noun: 'masjids' },
    businesses: { container: '#business-results', noun: 'businesses' },
    shops: { container: '#shop-results', noun: 'masjid shops' },
    'public-jobs': { container: '#public-job-list', noun: 'roles' }
  };

  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  const target = TARGETS[page];
  if (!target) return;

  const container = document.querySelector(target.container);
  if (!container) return;

  const savedPerPage = Number(localStorage.getItem(STORAGE_KEY));
  let perPage = PER_PAGE_CHOICES.includes(savedPerPage) ? savedPerPage : PER_PAGE_CHOICES[1];
  let current = 1;
  let signature = '';

  const controls = document.createElement('nav');
  controls.className = 'pagination';
  controls.setAttribute('aria-label', 'Pagination');
  container.insertAdjacentElement('afterend', controls);

  const items = () => [...container.children].filter(node => node.nodeType === 1);

  function apply() {
    const all = items();
    const pages = Math.max(1, Math.ceil(all.length / perPage));
    current = Math.min(current, pages);
    const first = (current - 1) * perPage;

    all.forEach((item, index) => {
      const show = index >= first && index < first + perPage;
      item.style.display = show ? '' : 'none';
    });

    // Nothing to page through: keep the per-page choice available but drop the numbers.
    const showing = Math.min(perPage, Math.max(0, all.length - first));
    controls.hidden = all.length === 0;
    controls.innerHTML = `
      <p class="pagination-summary">Showing <strong>${all.length ? first + 1 : 0}–${first + showing}</strong> of ${all.length} ${target.noun}</p>
      ${pages > 1 ? `<div class="pagination-pages">
        <button type="button" data-page="prev" ${current === 1 ? 'disabled' : ''} aria-label="Previous page">←</button>
        ${pageNumbers(current, pages).map(n => n === '…'
          ? '<span class="pagination-gap">…</span>'
          : `<button type="button" data-page="${n}" class="${n === current ? 'current' : ''}" ${n === current ? 'aria-current="page"' : ''}>${n}</button>`).join('')}
        <button type="button" data-page="next" ${current === pages ? 'disabled' : ''} aria-label="Next page">→</button>
      </div>` : ''}
      <label class="pagination-size">Per page
        <select>${PER_PAGE_CHOICES.map(n => `<option value="${n}" ${n === perPage ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>`;

    controls.querySelectorAll('[data-page]').forEach(button => button.onclick = () => {
      const value = button.dataset.page;
      current = value === 'prev' ? current - 1 : value === 'next' ? current + 1 : Number(value);
      apply();
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    controls.querySelector('select').onchange = event => {
      perPage = Number(event.target.value);
      try { localStorage.setItem(STORAGE_KEY, String(perPage)); } catch {}
      current = 1;
      apply();
    };
  }

  // 1 2 3 … 9 rather than every number once a list gets long.
  function pageNumbers(active, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const near = [active - 1, active, active + 1].filter(n => n > 1 && n < total);
    const list = [1, ...near, total];
    const out = [];
    list.forEach((n, i) => {
      if (i && n - list[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }

  // A filter change replaces the children; that is the signal to go back to page one.
  function sync() {
    const all = items();
    const next = all.map(item => item.getAttribute('href') || item.textContent.slice(0, 40)).join('|');
    if (next !== signature) {
      signature = next;
      current = 1;
    }
    apply();
  }

  let queued = null;
  new MutationObserver(() => {
    clearTimeout(queued);
    queued = setTimeout(sync, 40);
  }).observe(container, { childList: true });

  sync();
})();
