// Keeps the signed-in masjid identity consistent on every portal page.
(function () {
  function initials(name) {
    return String(name || 'Masjid').trim().split(/\s+/).filter(Boolean)
      .map(word => word[0]).slice(0, 2).join('').toUpperCase() || 'M';
  }

  function safePhoto(value) {
    const photo = String(value || '').trim();
    return /^(data:image\/(?:png|jpe?g|webp|gif);base64,|https?:\/\/|\/)/i.test(photo) ? photo : '';
  }

  function apply(masjid) {
    if (!masjid) return;
    const avatar = document.querySelector('.masjid-identity > span');
    const nameNode = document.querySelector('.masjid-identity strong');
    const metaNode = document.querySelector('.masjid-identity small');
    if (!avatar || !nameNode || !metaNode) return;

    const name = String(masjid.name || 'Masjid');
    const address = String(masjid.details?.Address || '');
    const city = address.split(',').slice(-2, -1)[0]?.trim() || 'United Kingdom';
    const photo = safePhoto(masjid.photo);

    avatar.textContent = photo ? '' : initials(name);
    avatar.style.backgroundImage = photo ? `url("${photo.replace(/"/g, '%22')}")` : '';
    avatar.style.backgroundSize = photo ? 'contain' : '';
    avatar.style.backgroundPosition = photo ? 'center' : '';
    avatar.style.backgroundRepeat = photo ? 'no-repeat' : '';
    avatar.style.backgroundColor = photo ? '#fffdf8' : '';
    avatar.classList.toggle('has-photo', Boolean(photo));
    if (photo) avatar.setAttribute('aria-label', `${name} photo`);
    else avatar.removeAttribute('aria-label');

    nameNode.textContent = name;
    metaNode.textContent = `${city} · Verified`;
  }

  window.MasjidIdentity = { apply };
})();
