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
  };

  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  const section = SECTIONS[page];
  if (!section) return;

  // The two portals name their wrapper differently; everything else about this is the same.
  const contentEl = () => document.querySelector('.portal-content, .business-content');

  function apply() {
    const content = contentEl();
    if (!content) return;

    const wanted = new Set();
    for (const selector of section.keep) {
      document.querySelectorAll(selector).forEach(el => {
        // Keep the section itself, wherever it sits in the tree.
        const top = [...content.children].find(child => child === el || child.contains(el)) || el;
        wanted.add(top);
      });
    }
    // Nothing matched — better to leave the whole dashboard visible than an empty page.
    if (!wanted.size) return;

    [...content.children].forEach(child => {
      // The greeting and the stat row belong to the dashboard, not to a single section.
      child.style.display = wanted.has(child) ? '' : 'none';
    });

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
  }

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
