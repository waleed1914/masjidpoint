// A way back, on the pages a visitor lands on from somewhere else. The destination is fixed per
// page rather than using history, so the link reads the same whether they arrived by link,
// search result or shared URL.
(function backLink() {
  const path = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  const params = new URLSearchParams(location.search);

  const targets = {
    'masjid-adverts': { href: 'masjids', label: 'All masjids', host: '.adverts-hero', tone: 'on-dark' },
    'masjid-shop': (() => {
      const reference = params.get('reference');
      return reference
        ? { href: `masjid-adverts?reference=${encodeURIComponent(reference)}`, label: 'Back to this masjid', host: '.shop-hero', tone: 'on-dark' }
        : { href: 'shops', label: 'All masjid shops', host: '.shop-hero', tone: 'on-dark' };
    })(),
    'candidate-apply': (() => {
      const job = params.get('job');
      return {
        href: job ? `public-jobs?job=${encodeURIComponent(job)}` : 'public-jobs',
        label: job ? 'Back to this role' : 'All jobs',
        host: '.candidate-shell > aside, .candidate-shell > div, .candidate-content', tone: 'on-dark'
      };
    })(),
    advertise: { href: 'masjids', label: 'All masjids', host: '.application-aside, .form-aside', tone: 'on-dark' },
    'register-masjid': { href: '/', label: 'Home', host: '.application-aside', tone: 'on-dark' }
  };

  const target = targets[path];
  if (!target) return;
  const host = document.querySelector(target.host);
  if (!host || host.querySelector('.back-link')) return;

  const link = document.createElement('a');
  link.className = `back-link ${target.tone || ''}`.trim();
  link.href = target.href;
  link.innerHTML = '<b aria-hidden="true">\u2190</b><span></span>';
  link.querySelector('span').textContent = target.label;
  host.prepend(link);
})();
