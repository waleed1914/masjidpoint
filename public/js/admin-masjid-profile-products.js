
// Everything a reviewer needs beside the image: what the customer quoted, what they say they paid,
// and whatever was written on the decision.
function proofSummaryHtml(proof, esc) {
  if (!proof) return '';
  const bits = [];
  if (proof.bankReference) bits.push(`<span><small>Their bank reference</small><strong>${esc(proof.bankReference)}</strong></span>`);
  if (proof.amount) bits.push(`<span><small>Amount claimed</small><strong>£${Number(proof.amount).toFixed(2)}</strong></span>`);
  if (proof.date) bits.push(`<span><small>Paid on</small><strong>${esc(proof.date)}</strong></span>`);
  if (proof.status) bits.push(`<span><small>Evidence</small><strong>${esc(proof.status)}</strong></span>`);
  if (proof.adminNote) bits.push(`<span><small>Note</small><strong>${esc(proof.adminNote)}</strong></span>`);
  const link = proof.evidence && (proof.evidence.objectKey || proof.evidence.key)
    ? `<a class="review-link" href="/api/shop/proof/file?id=${encodeURIComponent(proof.id)}" target="_blank" rel="noopener">Open the file ${proof.evidence.name ? '(' + esc(proof.evidence.name) + ')' : ''} →</a>`
    : proof.fileData ? `<a class="review-link" href="${esc(proof.fileData)}" target="_blank" rel="noopener">Open the file →</a>` : '';
  return `<div class="proof-summary">${bits.join('')}${link}</div>`;
}
(async function () {
  const reference = new URLSearchParams(location.search).get('reference')
    || sessionStorage.getItem('masjidPointSelectedMasjid');
  const page = document.querySelector('#masjid-view');
  if (!reference || !page) return;

  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || []).find(
    item => item.type === 'masjid' && item.reference === reference
  );
  if (!mosque || !['approved', 'activated'].includes(mosque.status)) return;

  const products = (state.masjidPointProducts || []).filter(product =>
    (product.mosques || []).some(selected => selected.reference === reference)
  );
  const orders = (state.masjidPointShopOrders || []).filter(order =>
    order.collectionMasjidReference === reference
    || order.collectionMasjidName === mosque.name
  );
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const money = value => `£${Number(value || 0).toFixed(2)}`;
  const visibleCount = products.filter(product => product.visibility !== 'hidden').length;
  const lowStockCount = products.filter(product => Number(product.stock) <= 5).length;

  const section = document.createElement('section');
  section.className = 'view-card mosque-profile-products';
  section.innerHTML = `
    <header class="mosque-products-header">
      <div>
        <p class="profile-section-label">MOSQUE SHOP</p>
        <h2>Products selected for ${escapeHtml(mosque.name)}</h2>
        <p>Only products assigned to this specific mosque are shown here.</p>
      </div>
      <div class="mosque-products-actions">
        <a class="button secondary" href="masjid-shop?reference=${encodeURIComponent(reference)}" target="_blank" rel="noopener">View public shop ↗</a>
        <a class="button" href="admin-masjid-products?reference=${encodeURIComponent(reference)}">Manage these products →</a>
      </div>
    </header>
    <div class="mosque-product-summary">
      <article><small>Assigned products</small><strong>${products.length}</strong></article>
      <article><small>Visible in shop</small><strong>${visibleCount}</strong></article>
      <article><small>Low stock</small><strong>${lowStockCount}</strong></article>
      <article><small>Shop orders</small><strong>${orders.length}</strong></article>
    </div>
    <div class="mosque-profile-product-grid">
      ${products.length ? products.map(product => `
        <article class="mosque-profile-product" data-product-visible="${product.visibility === 'hidden' ? 'false' : 'true'}" data-product-low-stock="${Number(product.stock) <= 5 ? 'true' : 'false'}">
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">
          <div class="mosque-profile-product-copy">
            <div class="product-title-line">
              <h3>${escapeHtml(product.name)}</h3>
              <span class="status-badge ${product.visibility === 'hidden' ? 'deactivated' : 'approved'}">${product.visibility === 'hidden' ? 'Hidden' : 'Visible'}</span>
            </div>
            <p>${escapeHtml(product.description)}</p>
            <dl>
              <div><dt>Price</dt><dd>${money(product.price)}</dd></div>
              <div><dt>Stock</dt><dd class="${Number(product.stock) <= 5 ? 'stock-warning' : ''}">${Number(product.stock || 0)}</dd></div>
              <div><dt>Mosque share</dt><dd>${Number(product.mosqueSharePercent || 0)}%</dd></div>
              <div><dt>Category</dt><dd>${escapeHtml(product.category || 'General')}</dd></div>
            </dl>
          </div>
        </article>`).join('') : `
        <div class="mosque-products-empty">
          <strong>No products assigned yet</strong>
          <p>Add a product or select this mosque from the central catalogue.</p>
          <a class="button" href="admin-masjid-products?reference=${encodeURIComponent(reference)}">Open shop management</a>
        </div>`}
    </div>
    <div class="mosque-profile-order-list" hidden>
      ${orders.length ? orders.map(order => {
        const method = ShopFulfilment.methodOf(order), address = ShopFulfilment.addressLines(order);
        return `<article class="mosque-profile-order"><div><small>${escapeHtml(order.id)}</small><strong>${escapeHtml(order.customer?.name || 'Customer')}</strong><span>${escapeHtml(order.customer?.email || '')}${order.customer?.phone ? ` · ${escapeHtml(order.customer.phone)}` : ''}</span></div><div><small>Products</small><strong>${(order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item(s)</strong><span>${(order.items || []).map(item => `${escapeHtml(item.name)} × ${Number(item.quantity || 0)}`).join(', ')}</span></div><div class="shop-order-payment"><small>${method.paysUpfront ? 'Bank payment' : 'Payment'}</small><strong>${escapeHtml(method.paysUpfront ? (order.paymentReference || 'Reference not provided') : `${money(order.total)} at the mosque`)}</strong><span class="shop-payment-state ${escapeHtml(order.paymentStatus || 'missing')}">${escapeHtml(ShopFulfilment.paymentLabel(order))}</span>${order.paymentEvidence?.fileData ? `${proofSummaryHtml((state.masjidPointPaymentProofs||[]).find(pr=>pr.orderId===order.id||(order.paymentProofId&&pr.id===order.paymentProofId)), escapeHtml)}` : ''}</div><div><small>How received</small><strong><span class="shop-method-badge ${method.key}">${escapeHtml(method.short)}</span></strong>${address.length ? `<span>${escapeHtml(address.join(', '))}</span>` : ''}<a class="review-link" href="/api/shop/invoice.pdf?order=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">Invoice ${escapeHtml(order.invoiceNumber || order.id)} ↓</a></div><div><small>Total</small><strong>${money(order.total)}</strong><span class="status-badge ${order.status === 'delivered' ? 'approved' : 'pending'}">${escapeHtml(String(order.status || 'ordered').replaceAll('_', ' '))}</span></div></article>`;
      }).join('') : '<p class="mosque-products-empty">No shop orders for this mosque.</p>'}
    </div>`;
  page.appendChild(section);
  const proofs=state.masjidPointPaymentProofs||[];
  const reviewDialog=document.createElement('dialog');reviewDialog.className='profile-proof-dialog';reviewDialog.innerHTML=`<form method="dialog" class="profile-proof-card"><header><div><small>Mosque shop payment</small><h2>Review payment evidence</h2></div><button value="cancel" aria-label="Close">×</button></header><div class="profile-proof-body"><div class="profile-proof-meta"></div><div class="profile-proof-preview"></div><label><span>Admin decision note <small>(required when rejecting)</small></span><textarea rows="4"></textarea></label><p class="profile-proof-error" hidden></p></div><footer><button class="profile-proof-reject" type="button">Reject evidence</button><button class="button profile-proof-approve" type="button">Verify payment</button></footer></form>`;document.body.appendChild(reviewDialog);
  let activeProof=null;const closeReview=()=>reviewDialog.close();
  orders.forEach(order=>{const proof=proofs.find(item=>item.orderId===order.id||(order.paymentProofId&&item.id===order.paymentProofId)),row=[...section.querySelectorAll('.mosque-profile-order')].find(item=>item.querySelector('small')?.textContent===order.id);if(!proof||!row)return;const payment=row.querySelector('.shop-order-payment');if(proof.status==='submitted'){const button=document.createElement('button');button.type='button';button.className='review-shop-proof';button.textContent='Review payment evidence →';button.onclick=()=>{activeProof=proof;reviewDialog.querySelector('.profile-proof-meta').innerHTML=`<span><small>Customer</small><strong>${escapeHtml(proof.customerName||order.customer?.name)}</strong></span><span><small>Order</small><strong>${escapeHtml(order.id)}</strong></span><span><small>Amount</small><strong>${money(proof.amount)}</strong></span><span><small>Bank reference</small><strong>${escapeHtml(proof.bankReference)}</strong></span>`;const preview=reviewDialog.querySelector('.profile-proof-preview');preview.innerHTML=proof.evidence?.mimeType==='application/pdf'?`<a href="/api/shop/proof/file?id=${encodeURIComponent(proof.id)}" target="_blank">Open submitted PDF →</a>`:`<img src="/api/shop/proof/file?id=${encodeURIComponent(proof.id)}" alt="Submitted payment evidence">`;reviewDialog.querySelector('textarea').value=proof.adminNote||'';reviewDialog.querySelector('.profile-proof-error').hidden=true;reviewDialog.showModal()};payment.appendChild(button)}});
  let evidenceObjectUrl='';section.addEventListener('click',async event=>{if(!event.target.closest('.review-shop-proof'))return;await Promise.resolve();const preview=reviewDialog.querySelector('.profile-proof-preview');preview.textContent='Loading submitted evidence…';try{const response=await fetch(`/api/shop/proof/file?id=${encodeURIComponent(activeProof.id)}`,{headers:{'X-MasjidPoint-Session':sessionToken()}});if(!response.ok)throw new Error('Evidence could not be loaded.');if(evidenceObjectUrl)URL.revokeObjectURL(evidenceObjectUrl);evidenceObjectUrl=URL.createObjectURL(await response.blob());if(activeProof.evidence?.mimeType==='application/pdf')preview.innerHTML=`<a href="${evidenceObjectUrl}" target="_blank" rel="noopener">Open submitted PDF →</a>`;else{const image=document.createElement('img');image.src=evidenceObjectUrl;image.alt='Submitted payment evidence';preview.replaceChildren(image)}}catch(error){preview.innerHTML=`<p class="profile-proof-error">${escapeHtml(error.message)} Refresh the page and try again.</p>`}});
  async function decideProof(status){if(!activeProof)return;const note=reviewDialog.querySelector('textarea').value.trim(),error=reviewDialog.querySelector('.profile-proof-error');if(status==='rejected'&&!note){error.textContent='Enter a reason so the customer knows what to correct.';error.hidden=false;return}const response=await fetch('/api/admin/payment-proof/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeProof.id,status,note})}),result=await response.json();if(!response.ok){error.textContent=result.error||'The decision could not be saved.';error.hidden=false;return}closeReview();location.reload()}
  reviewDialog.querySelector('.profile-proof-approve').onclick=()=>decideProof('approved');reviewDialog.querySelector('.profile-proof-reject').onclick=()=>decideProof('rejected');reviewDialog.addEventListener('click',event=>{if(event.target===reviewDialog)closeReview()});reviewDialog.addEventListener('close',()=>{if(evidenceObjectUrl){URL.revokeObjectURL(evidenceObjectUrl);evidenceObjectUrl=''}});
  const summaryCards = [...section.querySelectorAll('.mosque-product-summary article')];
  const productGrid = section.querySelector('.mosque-profile-product-grid');
  const orderList = section.querySelector('.mosque-profile-order-list');
  const filters = ['assigned', 'visible', 'low-stock', 'orders'];
  const filterStorageKey=`masjidPointAdminMosqueShopFilter:${reference}`;
  let activeFilter = '';
  function applyFilter(next, restore = false) {
    activeFilter = restore ? next : activeFilter === next ? '' : next;
    sessionStorage.setItem(filterStorageKey,activeFilter);
    summaryCards.forEach((card, index) => {
      const selected = filters[index] === activeFilter;
      card.classList.toggle('active-filter', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    const showingOrders = activeFilter === 'orders';
    productGrid.hidden = showingOrders;
    orderList.hidden = !showingOrders;
    section.querySelectorAll('.mosque-profile-product').forEach(product => {
      product.hidden = activeFilter === 'visible' && product.dataset.productVisible !== 'true'
        || activeFilter === 'low-stock' && product.dataset.productLowStock !== 'true';
    });
  }
  summaryCards.forEach((card, index) => {
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Filter by ${card.querySelector('small').textContent.trim()}`);
    card.setAttribute('aria-pressed', 'false');
    card.onclick = () => applyFilter(filters[index]);
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        applyFilter(filters[index]);
      }
    };
  });
  const savedFilter=sessionStorage.getItem(filterStorageKey);if(filters.includes(savedFilter))applyFilter(savedFilter,true);
})();
