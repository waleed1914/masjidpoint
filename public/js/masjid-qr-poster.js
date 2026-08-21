// The poster on the masjid portal shipped with a decorative 4x4 grid standing in for a QR code,
// so the printed poster could not actually be scanned. This swaps in a real code for the signed-in
// masjid, pointing at the advertising form with that masjid already selected — the same destination
// the admin masjid view generates. The placeholder stays put until the image has loaded, so a
// masjid with no connection still prints something rather than an empty box.
(async function () {
  const placeholder = document.querySelector('.poster-preview .css-qr');
  if (!placeholder) return;

  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (!session?.reference) return;

  const state = await MasjidDB.state();
  const masjid = (state.masjidPointAdminApplications || [])
    .find(app => app.type === 'masjid' && (app.reference === session.reference || app.id === session.reference));
  if (!masjid) return;

  const destination = `${location.origin}/masjid-adverts?reference=${encodeURIComponent(masjid.reference)}`;

  // Printed at 260px, so the code is requested at a size that stays sharp on paper.
  const image = new Image();
  image.className = 'poster-qr';
  image.alt = `QR code opening the MasjidPoint advertising form for ${masjid.name}`;
  image.width = 130;
  image.height = 130;
  image.onload = () => placeholder.replaceWith(image);
  // The code is drawn by an external service, so it cannot be assumed to arrive. Rather than
  // leave the decorative grid standing — it looks like a QR code but scans as nothing — say so
  // and print the link itself, which still lets someone reach the form from a printed poster.
  image.onerror = () => {
    const fallback = document.createElement('span');
    fallback.className = 'poster-qr-fallback';
    const heading = document.createElement('strong');
    heading.textContent = 'QR code unavailable offline';
    const lead = document.createElement('small');
    lead.textContent = 'Apply at this address instead:';
    const link = document.createElement('em');
    link.textContent = destination;
    fallback.append(heading, lead, link);
    placeholder.replaceWith(fallback);
  };
  image.src = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=10&data=${encodeURIComponent(destination)}`;

  // Both buttons on this panel should act on the same link the code encodes.
  const copy = document.querySelector('#copy-link');
  if (copy) copy.addEventListener('click', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await navigator.clipboard.writeText(destination);
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = 'Copy unavailable';
    }
    setTimeout(() => copy.textContent = 'Copy application link', 1800);
  }, true);

  const print = document.querySelector('#print-qr');
  if (print) print.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    // Printing mid-download would produce a poster with an empty square, so wait for the code to
    // settle first — but never wait indefinitely. `complete` is true after a failed load too, so
    // a code that will never arrive prints straight away rather than deadening the button.
    if (image.complete) return window.print();
    let printed = false;
    const printOnce = () => { if (printed) return; printed = true; window.print(); };
    image.addEventListener('load', printOnce, { once: true });
    image.addEventListener('error', printOnce, { once: true });
    setTimeout(printOnce, 1500);
  }, true);
})();
