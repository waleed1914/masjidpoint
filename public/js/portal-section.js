// Gives each masjid portal section its own address.
//
// The sidebar used to point three of its entries at the dashboard with no anchor at all, so
// "Active listings", "Job requests" and "Earnings" simply reloaded the page. The obvious fix is a
// file per section, but masjid-portal.js reaches for its elements without checking they exist —
// splitting the markup would leave every page throwing on the parts it no longer contains.
//
// So there is still one document, served by the server at each of these paths, and this hides the
// sections that do not belong to the current one. Every element masjid-portal.js expects is still
// in the page, and the masjid gets a real page per section with a working back button and a URL
// worth bookmarking.
(function () {
  'use strict';

  // Only sections that actually exist. Earnings is still absent: nothing renders it, and a link
  // that goes nowhere is worse than one that is not there. Active listings is here now because
  // masjid-listings.js builds it.
  const SECTIONS = {
    'masjid-requests': { title: 'Business requests', keep: ['#requests'] },
    'masjid-listings': { title: 'Active listings',   keep: ['#listings'] },
    'masjid-jobs':     { title: 'Job requests',      keep: ['.job-approval-panel'] },
    'masjid-orders':   { title: 'Shop orders',       keep: ['#shop-orders'] },
    'masjid-qr':       { title: 'Advertising QR',    keep: ['#qr-poster'] },
    // The business portal had the same fault: three of its six entries were anchors that scrolled
    // the dashboard rather than going anywhere.
    'business-advertising': { title: 'My advertising',   keep: ['#advertising'] },
    'business-profile':     { title: 'Business profile', keep: ['#profile'] },
    'business-invoices':    { title: 'Invoices',         keep: ['#invoices'] },
    'business-applicants':  { title: 'Job applicants',   keep: ['#applicants'] },
  };

  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  const section = SECTIONS[page];
  if (!section) return;

  // The two portals name their wrapper differently; everything else about this is the same.
  const contentEl = () => document.querySelector('.portal-content, .business-content');

  function apply() {
    const content = contentEl();
    if (!content) return false;

    const targets = [];
    for (const selector of section.keep) content.querySelectorAll(selector).forEach(el => targets.push(el));
    // Nothing matched — better to leave the whole dashboard visible than an empty page.
    if (!targets.length) return false;

    // Hide the siblings at every level between the section and the content wrapper, not only at
    // the top. My advertising and Business profile both sit inside .business-layout, so keeping
    // whichever top-level child contained them kept the pair of them — and the two addresses
    // showed the same page.
    const keep = new Set();
    for (const target of targets) {
      for (let node = target; node && node !== content; node = node.parentElement) keep.add(node);
    }
    const hideSiblings = parent => {
      for (const child of parent.children) {
        if (keep.has(child)) { child.style.display = ''; hideSiblings(child); }
        else child.style.display = 'none';
      }
    };
    hideSiblings(content);

    const heading = document.querySelector('.portal-welcome h2, .business-welcome h2');
    if (heading && !heading.dataset.sectionTitled) {
      heading.textContent = section.title;
      heading.dataset.sectionTitled = '1';
      const owner = heading.closest('.portal-welcome, .business-welcome');
      if (owner) owner.style.display = '';
    }
    const topbar = document.querySelector('.portal-topbar h1, .business-topbar h1');
    if (topbar) topbar.textContent = section.title;
    document.title = `${section.title} — MasjidPoint`;
    reveal();
    return true;
  }

  // The dashboard was visible for a moment before the section replaced it, because this can only
  // hide things after they have been rendered. Keep the content hidden until the right section has
  // been isolated — and reveal it regardless after a moment, so a section that never arrives
  // leaves the page usable rather than blank.
  const style = document.createElement('style');
  style.textContent = '.portal-section-pending .portal-content,.portal-section-pending .business-content{visibility:hidden}';
  (document.head || document.documentElement).appendChild(style);
  document.documentElement.classList.add('portal-section-pending');
  let revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    document.documentElement.classList.remove('portal-section-pending');
  }
  setTimeout(reveal, 3000);

  // The portal renders asynchronously and some sections arrive late — shop orders is built by its
  // own script after the state has loaded, so a single pass would leave that page showing the
  // whole dashboard. Keep trying until the section this page is named for actually exists, then
  // stop; and keep watching for re-renders, because portal-context.js replaces several of them.
  const found = () => section.keep.some(sel => document.querySelector(sel));

  const start = () => {
    apply();
    const content = contentEl();
    if (content) new MutationObserver(apply).observe(content, { childList: true, subtree: true });

    let waited = 0;
    const poll = setInterval(() => {
      apply();
      waited += 300;
      if (found() || waited > 8000) clearInterval(poll);
    }, 300);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
