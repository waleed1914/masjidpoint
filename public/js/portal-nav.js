// One sidebar for every masjid portal page. The portal began as a single scrolling page whose
// sidebar links were anchors; this owns the link list in one place and marks the current page
// active from the path. Entries flagged `page:false` are sections that still live on the
// dashboard and have not been split out yet — they keep their anchor until they have a page.
// Pages keep their own .masjid-identity markup so portal-context.js still finds it.
(function () {
  // Every entry is now a page of its own. Three of them used to point at "masjid-portal" with no
  // anchor at all, so clicking Active listings, Job requests or Earnings simply reloaded the
  // dashboard — which is what made the sidebar feel broken.
  //
  // Active listings and Earnings are not here: nothing in the codebase renders either of them, so
  // they were links to features that do not exist. They come back when they have something behind
  // them, rather than sitting in the sidebar doing nothing.
  const LINKS = [
    { href: 'masjid-portal',   icon: '▦', label: 'Dashboard',        page: true },
    { href: 'masjid-requests', icon: '◇', label: 'Business requests', page: true, badge: 'sidebar-pending' },
    { href: 'masjid-jobs',     icon: '▣', label: 'Job requests',      page: true },
    { href: 'masjid-products', icon: '⌗', label: 'Shop products',     page: true },
    { href: 'masjid-orders',   icon: '▥', label: 'Shop orders',       page: true },
    { href: 'masjid-qr',       icon: '▦', label: 'Advertising QR',    page: true },
    { href: 'masjid-settings', icon: '⚙', label: 'Masjid settings',   page: true }
  ];

  const current = (location.pathname.split('/').pop() || 'masjid-portal').replace(/\.html$/, '') || 'masjid-portal';
  const nav = document.querySelector('.portal-sidebar nav');
  if (!nav) return;

  nav.innerHTML = LINKS.map(link => {
    const target = link.href.split('#')[0];
    const active = link.page && target === current ? ' class="active"' : '';
    const badge = link.badge ? `<b id="${link.badge}">0</b>` : '';
    return `<a${active} href="${link.href}"><span>${link.icon}</span> ${link.label}${badge}</a>`;
  }).join('');

  const menu = document.querySelector('.portal-menu');
  if (menu) menu.addEventListener('click', () => document.querySelector('.portal-sidebar').classList.toggle('open'));
})();
