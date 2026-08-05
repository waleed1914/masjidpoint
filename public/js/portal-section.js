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

  // Only sections that actually exist. "Active listings" and "Earnings" were in the sidebar with
  // nothing behind them anywhere in the codebase — they are not listed here, and portal-nav.js no
  // longer offers them, because a link that goes nowhere is worse than one that is absent.
  const SECTIONS = {
    'masjid-requests': { title: 'Business requests', keep: ['#requests'] },
    'masjid-jobs':     { title: 'Job requests',      keep: ['.job-approval-panel'] },
    'masjid-orders':   { title: 'Shop orders',       keep: ['#shop-orders'] },
    'masjid-qr':       { title: 'Advertising QR',    keep: ['#qr-poster'] },
  };

  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  const section = SECTIONS[page];
  if (!section) return;

  function apply() {
    const main = document.querySelector('.portal-main, main');
    if (!main) return;

    const wanted = new Set();
    for (const selector of section.keep) {
      document.querySelectorAll(selector).forEach(el => {
        // Keep the section itself, wherever it sits in the tree.
        const top = el.closest('.portal-content > *') || el;
        wanted.add(top);
      });
    }
    // Nothing matched — better to leave the whole dashboard visible than an empty page.
    if (!wanted.size) return;

    const content = document.querySelector('.portal-content') || main;
    [...content.children].forEach(child => {
      if (wanted.has(child)) return;
      // The greeting and the stat row belong to the dashboard, not to a single section.
      child.style.display = 'none';
    });

    const heading = document.querySelector('.portal-welcome h2, .portal-content h2');
    if (heading && !heading.dataset.sectionTitled) {
      heading.textContent = section.title;
      heading.dataset.sectionTitled = '1';
      heading.parentElement && (heading.parentElement.style.display = '');
    }
    const topbar = document.querySelector('.portal-topbar h1');
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
    const content = document.querySelector('.portal-content');
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
