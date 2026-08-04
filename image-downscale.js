// Shared image intake for anything stored as a data URL in the JSON store.
//
// Product images are copied verbatim into every order line item, so a 2 MB phone photo becomes
// 2 MB on the product plus 2 MB per order that contains it. The orders collection is rewritten in
// full on every save, so unbounded images eventually push a save past the server's request limit
// and ordering stops working. Everything read through here is capped and re-encoded as JPEG,
// which turns a typical 2 MB upload into roughly 150 KB.
(function (root) {
  const MAX_EDGE = 1200;
  const QUALITY = 0.82;

  function read(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || Error('unreadable'));
      reader.readAsDataURL(file);
    });
  }

  // Re-encodes as JPEG whatever arrived: re-encoding a photograph to PNG regularly comes out
  // larger than the original, which defeats the point. The original is kept whenever it is still
  // the smaller of the two, and whenever the browser cannot decode it.
  function shrink(dataUrl, maxEdge) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL('image/jpeg', QUALITY);
        resolve(encoded.length < dataUrl.length ? encoded : dataUrl);
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  async function fromFile(file, maxEdge = MAX_EDGE) {
    if (!file?.size) return '';
    return shrink(await read(file), maxEdge);
  }

  root.ImageDownscale = { fromFile, read, shrink, MAX_EDGE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
