(function () {
  const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const admin = path === '/admin';
  const mosque = path === '/masjid-portal';
  const business = path === '/business-portal';
  if (!admin && !mosque && !business) return;

  const shortcuts = admin ? [
    ['Applications', 'admin-applications', '◇'], ['Masjid accounts', 'admin-masjids', '⌂'],
    ['Business accounts', 'admin-businesses', '▤'], ['Payments & settlements', 'admin-payments', '£']
  ] : mosque ? [
    ['Business requests', 'masjid-requests', '◇'], ['Job requests', 'masjid-jobs', '▣'],
    ['Shop orders', 'masjid-orders', '▤'], ['Earnings', 'masjid-earnings', '£']
  ] : [
    ['My advertising', 'business-advertising', '◇'], ['Job listings', 'business-jobs', '▣'],
    ['Job applicants', 'business-applicants', '▤'], ['Invoices & payments', 'business-invoices', '£']
  ];
  const stats = document.querySelector(admin ? '.stat-grid' : mosque ? '.portal-stats' : '.business-stats');
  if (stats && !document.querySelector('.dashboard-shortcuts')) {
    const nav = document.createElement('nav');
    nav.className = 'dashboard-shortcuts';
    nav.setAttribute('aria-label', 'Portal shortcuts');
    nav.innerHTML = shortcuts.map(([label, href, icon]) => `<a href="${href}"><span>${icon}</span>${label}<b>→</b></a>`).join('');
    stats.insertAdjacentElement('afterend', nav);
  }

  function linkCard(card, href) {
    if (!card || card.closest('a')) return;
    card.dataset.dashboardHref = href;
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    const go = () => { location.href = href; };
    card.addEventListener('click', event => { if (!event.target.closest('a,button,input,select')) go(); });
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } });
  }
  if (mosque) {
    const cards = [...document.querySelectorAll('.portal-stats article')];
    ['masjid-requests', 'masjid-listings', 'masjid-listings', 'masjid-earnings'].forEach((href, index) => linkCard(cards[index], href));
  }
  if (business) {
    const cards = [...document.querySelectorAll('.business-stats article')];
    ['business-advertising', 'business-advertising', 'business-jobs', 'business-invoices'].forEach((href, index) => linkCard(cards[index], href));
  }

  function recent({ host, items, href, label, limit = 6 }) {
    const container = document.querySelector(host);
    if (!container) return;
    const header = container.querySelector(':scope > header');
    if (header && !header.querySelector('.dashboard-view-all')) {
      const link = document.createElement('a');
      link.className = 'dashboard-view-all'; link.href = href; link.textContent = `View all ${label} →`;
      header.appendChild(link);
    }
    let note = container.querySelector('.dashboard-recent-note');
    if (!note) {
      note = document.createElement('footer'); note.className = 'dashboard-recent-note';
      container.appendChild(note);
    }
    const apply = () => {
      const rows = [...container.querySelectorAll(items)];
      rows.forEach((row, index) => row.classList.toggle('dashboard-overflow', index >= limit));
      const content = rows.length > limit
        ? `<span>Showing the latest ${limit} of ${rows.length}</span><a href="${href}">View all ${label} →</a>`
        : `<span>${rows.length ? `Showing ${rows.length} recent ${label}` : `No recent ${label}`}</span><a href="${href}">Open ${label} →</a>`;
      if (note.innerHTML !== content) note.innerHTML = content;
    };
    new MutationObserver(apply).observe(container, { childList: true, subtree: true });
    apply();
  }

  if (admin) recent({ host: '.applications-panel', items: '#application-rows > tr', href: 'admin-applications', label: 'applications' });
  if (mosque) {
    recent({ host: '.request-panel', items: '#request-rows > tr', href: 'masjid-requests', label: 'business requests' });
    recent({ host: '.job-approval-panel', items: '#masjid-job-requests > article', href: 'masjid-jobs', label: 'job requests' });
  }
  if (business) {
    recent({ host: '.advertising-panel', items: '#listing-cards > .listing-row', href: 'business-advertising', label: 'advertising listings' });
    recent({ host: '.invoice-panel', items: '.invoice-table tbody > tr', href: 'business-invoices', label: 'invoices' });
  }
})();
