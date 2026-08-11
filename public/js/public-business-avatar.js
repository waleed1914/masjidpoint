(function () {
  function loadImage(url) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  async function resolveAvatar(node) {
    if (!node || node.dataset.avatarLoading) return;
    node.dataset.avatarLoading = 'true';
    const reference = node.dataset.businessReference;
    const name = node.dataset.businessName || 'Business';
    if (!reference) return;
    const token = encodeURIComponent(reference);
    const cacheToken = Date.now();
    const candidates = [
      { url: `/api/business-contact-photo?reference=${token}&publicOnly=1&v=${cacheToken}`, title: `${name} — business owner`, logo: false },
      { url: `/api/business-logo?reference=${token}&v=${cacheToken}`, title: `${name} — business logo`, logo: true }
    ];
    for (const candidate of candidates) {
      const image = await loadImage(candidate.url);
      if (!image || !node.isConnected) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = node.dataset.buttonClass || 'business-image-trigger';
      button.dataset.businessImage = candidate.url;
      button.dataset.businessImageTitle = candidate.title;
      button.setAttribute('aria-label', `Enlarge ${candidate.title}`);
      image.className = [node.dataset.imageClass || 'business-mark', candidate.logo ? 'business-logo-image' : ''].filter(Boolean).join(' ');
      image.alt = candidate.title;
      button.appendChild(image);
      node.replaceWith(button);
      return;
    }
    node.dataset.avatarLoading = 'done';
  }

  function scan(root) {
    const nodes = [];
    if (root.nodeType === 1 && root.matches('[data-business-avatar]')) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll('[data-business-avatar]'));
    nodes.forEach(resolveAvatar);
  }

  function start() {
    scan(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
