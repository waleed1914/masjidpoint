// The single public header. Every public page carries `<header data-site-nav></header>` followed
// by this script, so the navigation is defined once and cannot drift page to page.
//
// It renders synchronously where it sits, so any script later in the page sees the final markup.
(function () {
  const host = document.querySelector('[data-site-nav]');
  if (!host) return;

  const LINKS = [
    { href: 'businesses', label: 'Businesses' },
    { href: 'masjids', label: 'Masjids' },
    { href: 'donations', label: 'Donate' },
    { href: 'shops', label: 'Masjid Shop' },
    { href: 'public-jobs', label: 'Jobs' }
  ];

  // Detail pages highlight the section they belong to.
  const PARENT = {
    'masjid-shop': 'shops',
    'masjid-product': 'shops',
    'masjid-adverts': 'masjids',
    'advertise': 'businesses',
    'candidate-apply': 'public-jobs',
    'register-masjid': 'masjids'
  };

  const page = (location.pathname.split('/').pop()||'').replace(/\.html$/,'') || '/';
  const active = PARENT[page] || page;

  // Where each kind of signed-in account belongs.
  const PORTAL = {
    customer: { href: 'my-account', label: 'My account' },
    masjid: { href: 'masjid-portal', label: 'Masjid portal' },
    business: { href: 'business-portal', label: 'Business portal' }
  };

  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null'); } catch (_) {}
  const portal = session && PORTAL[session.role];

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = value => String(value || '?').trim().split(/[\s@.]+/).filter(Boolean)
    .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  // Signed out we prompt to join; signed in we show who you are and where your portal is.
  function accountMarkup() {
    if (!portal) {
      return `<div class="site-nav-auth-links">
          <a class="site-nav-signin" href="login">Sign in</a>
          <a class="button button-small" href="signup">Sign up</a>
        </div>
        <div class="site-nav-account site-nav-guest-account">
          <button class="site-nav-avatar" type="button" aria-expanded="false" aria-haspopup="true" aria-label="Sign in or create an account">
            <span class="site-nav-profile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="8" r="3.25"></circle><path d="M5.5 19c.45-3.65 2.65-5.5 6.5-5.5s6.05 1.85 6.5 5.5"></path></svg>
            </span>
            <span class="site-nav-caret" aria-hidden="true">â–¾</span>
          </button>
          <div class="site-nav-menu site-nav-guest-menu" hidden>
            <p><strong>Welcome to MasjidPoint</strong><small>Access your account or join the community.</small></p>
            <a href="login">Sign in</a>
            <a href="signup">Create an account</a>
          </div>
        </div>`;
    }
    const name = session.name || session.email || 'Account';
    return `<div class="site-nav-account">
      <button class="site-nav-avatar" type="button" aria-expanded="false" aria-haspopup="true" aria-label="Account menu">
        <span class="site-nav-initials" aria-hidden="true">${esc(initials(session.name || session.email))}</span>
        <span class="site-nav-who">${esc(name)}</span>
        <span class="site-nav-caret" aria-hidden="true">▾</span>
      </button>
      <div class="site-nav-menu" hidden>
        <p><strong>${esc(name)}</strong><small>${esc(session.email || '')}</small></p>
        <a href="${portal.href}">${esc(portal.label)}</a>
        <button type="button" data-sign-out>Sign out</button>
      </div>
    </div>`;
  }

  host.className = 'site-nav';
  host.innerHTML = `
    <a class="site-nav-brand" href="/" aria-label="MasjidPoint home">
      <span class="brand-mark" aria-hidden="true"><span></span></span>
      <span>Masjid<span>Point</span></span>
    </a>
    <button class="site-nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav-links" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
    <nav class="site-nav-links" id="site-nav-links" aria-label="Main navigation">
      ${LINKS.map(l => `<a href="${l.href}"${l.href === active ? ' class="active" aria-current="page"' : ''}>${l.label}</a>`).join('')}
    </nav>
    <div class="site-nav-actions">${accountMarkup()}</div>`;

  const toggle = host.querySelector('.site-nav-toggle');
  const links = host.querySelector('.site-nav-links');
  toggle.onclick = () => {
    const open = host.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  };
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    host.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));

  // Account menu: opens on click, closes on outside click or Escape.
  const avatar = host.querySelector('.site-nav-avatar');
  if (avatar) {
    const account = avatar.closest('.site-nav-account');
    const menu = host.querySelector('.site-nav-menu');
    const setOpen = open => { menu.hidden = !open; avatar.setAttribute('aria-expanded', String(open)); };
    avatar.onclick = event => { event.stopPropagation(); setOpen(menu.hidden); };
    document.addEventListener('click', event => { if (!account.contains(event.target)) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
    const signOut = menu.querySelector('[data-sign-out]');
    if (signOut) signOut.onclick = () => {
        sessionStorage.removeItem('masjidPointSession');
        location.href = '/';
      };
  }
})();
