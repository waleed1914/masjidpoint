// Puts the turning MasjidPoint mark over the page until it has real data to show.
//
// It runs from <head>, before the body exists, so the overlay is in place for the first paint —
// otherwise you would see the very flash it is meant to cover.
//
// The important property is that it cannot strand anyone. It comes down when the data has arrived,
// or when the page has finished loading, or after a hard time limit, whichever happens first. If
// the JavaScript that fetches the data throws, the time limit still clears it, and the page
// underneath is the ordinary page.
(function () {
  'use strict';

  // Anyone who has asked for less movement gets no spinner and no overlay.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const HARD_LIMIT = 6000;   // never cover the page for longer than this
  const SETTLE = 260;        // let the first render finish before uncovering

  const MARK = `
    <svg class="masjidpoint-loader-mark" viewBox="0 0 48 48" role="img" aria-label="MasjidPoint">
      <defs>
        <linearGradient id="mpl-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#17513f"/><stop offset="100%" stop-color="#0c3128"/>
        </linearGradient>
        <linearGradient id="mpl-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f0d295"/><stop offset="100%" stop-color="#c49a52"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#mpl-bg)"/>
      <path d="M24 13c6.2 6 12.4 9.6 12.4 16.2 0 4.6-5.6 7.6-12.4 7.6s-12.4-3-12.4-7.6C11.6 22.6 17.8 19 24 13z" fill="url(#mpl-gold)"/>
      <path d="M24 13c6.2 6 12.4 9.6 12.4 16.2 0 4.6-5.6 7.6-12.4 7.6z" fill="#000" opacity=".08"/>
      <path d="M21 37v-6.2a3 3 0 0 1 6 0V37z" fill="#0c3128" opacity=".55"/>
      <circle cx="24" cy="8.2" r="1.9" fill="#f0d295"/>
    </svg>`;

  let overlay = null;
  let done = false;

  function build() {
    if (overlay || !document.body) return;
    overlay = document.createElement('div');
    overlay.id = 'masjidpoint-loader';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Loading');
    overlay.innerHTML = `${MARK}
      <p class="masjidpoint-loader-word">Masjid<span>Point</span></p>
      <span class="masjidpoint-loader-bar"><i></i></span>`;
    document.body.appendChild(overlay);
  }

  function clear() {
    if (done) return;
    done = true;
    if (!overlay) return;
    overlay.hidden = true;
    // Remove it entirely once the fade is over, so nothing is left covering the page or catching
    // a stray click.
    setTimeout(() => { overlay && overlay.remove(); overlay = null; }, 420);
  }

  // Put it up as soon as there is a body to put it in.
  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build, { once: true });

  // Whichever of these comes first wins.
  setTimeout(clear, HARD_LIMIT);
  window.addEventListener('load', () => setTimeout(clear, SETTLE));
  window.addEventListener('error', () => setTimeout(clear, SETTLE));

  // The data layer publishes a promise for its first fetch. Waiting on it is what makes the
  // overlay useful rather than decorative: the page is uncovered once it has something true to
  // show. `catch` matters as much as `then` — a failed fetch must still uncover the page.
  const waitForData = () => {
    const ready = window.MasjidDB && window.MasjidDB.ready;
    if (!ready || typeof ready.then !== 'function') return false;
    ready.then(() => setTimeout(clear, SETTLE)).catch(() => clear());
    return true;
  };

  if (!waitForData()) {
    // local-db.js may not have run yet. Look again a few times, then stop and let the load
    // event or the time limit deal with it.
    let tries = 0;
    const poll = setInterval(() => {
      if (done || waitForData() || ++tries > 40) clearInterval(poll);
    }, 100);
  }
})();
