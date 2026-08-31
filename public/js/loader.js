// Puts the turning MasjidPoint mark over the page until it has real data to show.
//
// It runs from <head>, before the body exists. The overlay itself cannot be built that early —
// there is nothing to append it to — so building it on DOMContentLoaded meant the page painted
// first and the loader dropped on top of a page the visitor had already seen, which is worse than
// no loader at all. A stylesheet rule can apply from the first paint, so one goes in immediately
// to cover the page, and the mark is added to it as soon as there is a body.
//
// The important property is that it cannot strand anyone. It comes down when the data has arrived,
// or when the page has finished loading, or after a hard time limit, whichever happens first. If
// the JavaScript that fetches the data throws, the time limit still clears it, and the page
// underneath is the ordinary page.
(function () {
  'use strict';

  // Anyone who has asked for less movement gets no spinner and no overlay.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const HARD_LIMIT = 6000;   // emergency escape only; never strand the page after a failed request

  // Applied while this script is still parsing, so the very first paint is already covered.
  const early = document.createElement('style');
  early.textContent =
    'html.masjidpoint-loading{overflow:hidden}' +
    'html.masjidpoint-loading body>*:not(#masjidpoint-loader){visibility:hidden}' +
    'html.masjidpoint-loading::before{content:"";position:fixed;inset:0;z-index:9998;' +
      'background:#fffdf8}' +
    'html.masjidpoint-loading.portal-shell::before{background:#f3f1eb}';
  (document.head || document.documentElement).appendChild(early);
  document.documentElement.classList.add('masjidpoint-loading');
  // The portals sit on a warmer background; matching it stops the cover flashing a different
  // colour as it lifts. The body class is not readable yet, so the page name stands in for it.
  if (/^\/(admin|masjid|business)/.test(location.pathname)) document.documentElement.classList.add('portal-shell');

  const MARK = '<img class="masjidpoint-loader-mark" src="/assets/logo-mark.svg?v=5" alt="MasjidPoint">';

  let overlay = null;
  let done = false;
  let waitForBody = null;

  // Once the loader has come down it must stay down. Everything that can put it up asks here
  // first, because the events that build it — readystatechange in particular — keep firing after
  // the page is ready, and on a slow connection they fire *after* it has been cleared. Without
  // this, a second cover was built over a page that had already finished and nothing ever took it
  // away: the visitor sat looking at the spinner over a page that was working underneath.
  function build() {
    if (done || overlay || !document.body) return;
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
    // Nothing may build it again after this point.
    document.removeEventListener('DOMContentLoaded', build);
    document.removeEventListener('readystatechange', build);
    if (waitForBody) { clearInterval(waitForBody); waitForBody = null; }
    // Uncover the page first, then fade the mark out over it. Doing it the other way round shows
    // the bare cover for a frame.
    document.documentElement.classList.remove('masjidpoint-loading');
    if (!overlay) return;
    overlay.hidden = true;
    // Remove it entirely once the fade is over, so nothing is left covering the page or catching
    // a stray click.
    setTimeout(() => { overlay && overlay.remove(); overlay = null; }, 420);
  }

  // Put the mark up as soon as there is a body to put it in. The cover is already in place, so
  // this only adds the spinner to it — the page was never visible in between.
  //
  // readystatechange as well as DOMContentLoaded: a script in <head> can be parsed after the
  // document is already interactive when the page comes from cache, and DOMContentLoaded would
  // then never fire again.
  if (document.body) build();
  else {
    document.addEventListener('DOMContentLoaded', build, { once: true });
    document.addEventListener('readystatechange', build);
    // Belt and braces for a body that appears between those two.
    waitForBody = setInterval(() => { if (document.body || done) { build(); clearInterval(waitForBody); waitForBody = null; } }, 16);
    setTimeout(() => { if (waitForBody) { clearInterval(waitForBody); waitForBody = null; } }, 4000);
  }

  // The hard limit is only a failure safeguard. Successful pages clear the loader from their real
  // readiness signal below, without adding an artificial display delay.
  setTimeout(clear, HARD_LIMIT);
  window.addEventListener('error', clear);

  // The data layer publishes a promise for its first fetch. Waiting on it is what makes the
  // overlay useful rather than decorative: the page is uncovered once it has something true to
  // show. `catch` matters as much as `then` — a failed fetch must still uncover the page.
  const waitForData = () => {
    const ready = window.MasjidDB && window.MasjidDB.ready;
    if (!ready || typeof ready.then !== 'function') return false;
    ready.then(clear).catch(clear);
    return true;
  };

  // A few authentication pages do not load application state. For those pages, the browser load
  // event is the real readiness signal. Data-backed pages stay covered until MasjidDB.ready.
  window.addEventListener('load', () => {
    const needsData=[...document.scripts].some(script=>/\blocal-db\.js(?:\?|$)/.test(script.src));
    if(!needsData)clear();
    else waitForData();
  });

  if (!waitForData()) {
    // local-db.js may not have run yet. Look again a few times, then stop and let the load
    // event or the time limit deal with it.
    let tries = 0;
    const poll = setInterval(() => {
      if (done || waitForData() || ++tries > 40) clearInterval(poll);
    }, 100);
  }
})();
