// One sidebar for every masjid portal page. The portal began as a single scrolling page whose
// sidebar links were anchors; this owns the link list in one place and marks the current page
// active from the path. Entries flagged `page:false` are sections that still live on the
// dashboard and have not been split out yet — they keep their anchor until they have a page.
// Pages keep their own .masjid-identity markup so portal-context.js still finds it.
(function () {
  const LINKS = [
    { href: 'masjid-portal', icon: '▦', label: 'Dashboard', page: true },
    { href: 'masjid-portal#requests', icon: '◇', label: 'Business requests', badge: 'sidebar-pending' },
    { href: 'masjid-portal', icon: '▤', label: 'Active listings' },
    { href: 'masjid-portal', icon: '▣', label: 'Job requests' },
    { href: 'masjid-products', icon: '⌗', label: 'Shop products', page: true },
    { href: 'masjid-portal#shop-orders', icon: '▥', label: 'Shop orders' },
    { href: 'masjid-portal#qr-poster', icon: '▦', label: 'Advertising QR' },
    { href: 'masjid-portal', icon: '£', label: 'Earnings' },
    { href: 'masjid-settings', icon: '⚙', label: 'Masjid settings', page: true }
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
