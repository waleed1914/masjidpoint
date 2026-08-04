(function () {
  const sidebar = document.querySelector('.admin-sidebar');
  if (!sidebar) return;
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('masjidPointAdminSession') || 'null'); } catch (_) {}
  const current = (location.pathname.split('/').pop()||'').replace(/\.html$/,'') || 'admin';
  const detailParents = {
    'admin-masjid-view': 'admin-masjids',
    'admin-business-view': 'admin-businesses',
    'admin-invoice-view': 'admin-invoices'
  };
  const activePage = detailParents[current] || current;
  const rolePages = {
    finance_admin: new Set(['admin','admin-invoices','admin-invoice-view','admin-payments','admin-bank-settings','admin-businesses','admin-business-view']),
    reviewer: new Set(['admin','admin-applications','admin-masjids','admin-masjid-view','admin-businesses','admin-business-view'])
  };
  if (rolePages[session?.role] && !rolePages[session.role].has(current)) {
    location.replace('admin?access=restricted');
    return;
  }
  let links = [
    ['admin', 'Overview', '⌘'],
    ['admin-applications', 'Applications', '◇'],
    ['admin-masjids', 'Masjids', '⌂'],
    ['admin-businesses', 'Businesses', '▤'],
    ['admin-masjid-products', 'Shop', '▧'],
    ['admin-invoices', 'Invoices', '▣'],
    ['admin-payments', 'Payments & settlements', '£'],
    ['admin-bank-settings', 'Bank details', '¤']
  ];
  if (session?.role === 'finance_admin') links = links.filter(([href]) => ['admin','admin-businesses','admin-invoices','admin-payments','admin-bank-settings'].includes(href));
  if (session?.role === 'reviewer') links = links.filter(([href]) => ['admin','admin-applications','admin-masjids','admin-businesses'].includes(href));
  if (session?.role === 'super_admin') links.push(['admin-users', 'Admin profiles', '⚙']);
  if (['super_admin', 'admin'].includes(session?.role)) links.push(['admin-audit', 'Audit log', '≡']);
  const nav = sidebar.querySelector('nav');
  nav.setAttribute('aria-label', 'Administration');
  nav.innerHTML = links.map(([href, label, icon]) => `<a href="${href}" ${href === activePage ? 'class="active" aria-current="page"' : ''}><span>${icon}</span> ${label}${label === 'Applications' ? '<b id="nav-pending-count">0</b>' : ''}</a>`).join('');

  let profile = sidebar.querySelector('.admin-profile');
  if (!profile) {
    profile = document.createElement('div');
    profile.className = 'admin-profile';
    profile.innerHTML = '<span>AD</span><p><strong>Administrator</strong><small></small></p>';
    sidebar.appendChild(profile);
  }
  if (session) {
    const initials = String(session.name || 'Admin').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    profile.querySelector('span').textContent = initials;
    profile.querySelector('strong').textContent = session.name || 'Administrator';
    profile.querySelector('small').textContent = session.email || session.role.replaceAll('_', ' ');
  }
  let logout = document.querySelector('#admin-logout');
  if (!logout) {
    logout = document.createElement('button');
    logout.id = 'admin-logout';
    logout.type = 'button';
    logout.innerHTML = '<span>↪</span> Log out';
    sidebar.insertBefore(logout, profile);
  }
  logout.onclick = () => {
    sessionStorage.removeItem('masjidPointAdminSession');
    sessionStorage.removeItem('masjidPointSession');
    location.href = 'admin-login';
  };

  const topbar = document.querySelector('.admin-topbar');
  if (topbar && !topbar.querySelector('.sidebar-toggle')) {
    const toggle = document.createElement('button');
    toggle.className = 'sidebar-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open administration menu');
    toggle.textContent = '☰';
    topbar.prepend(toggle);
  }
  const toggle = document.querySelector('.sidebar-toggle');
  let backdrop = document.querySelector('.admin-menu-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.className = 'admin-menu-backdrop';
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', 'Close administration menu');
    document.body.appendChild(backdrop);
  }
  const closeMenu = () => sidebar.classList.remove('open');
  if (toggle) toggle.onclick = () => sidebar.classList.toggle('open');
  backdrop.onclick = closeMenu;

  MasjidDB.state().then(state => {
    const pending = (state.masjidPointAdminApplications || []).filter(application => application.status === 'pending').length;
    const count = document.querySelector('#nav-pending-count');
    if (count) { count.textContent = pending; count.hidden = pending === 0; }
  }).catch(() => {});
})();
