
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
// Payment strip on each admin shop order card. What it offers depends on how the customer
// chose to pay: bank transfers are verified here, while pay-at-mosque orders are settled by
// the mosque at handover and are only reported here.
(function () {
  const list = document.querySelector('#admin-order-list');
  if (!list) return;

  async function enhance() {
    const state = await MasjidDB.state(), orders = state.masjidPointShopOrders || [];
    list.querySelectorAll('.shop-order-card').forEach(card => {
      if (card.querySelector('.shop-payment-state')) return;
      const id = card.querySelector('header strong')?.textContent;
      const order = orders.find(x => x.id === id);
      if (!order) return;
      card.dataset.orderStatus = order.status || '';
      card.dataset.paymentStatus = order.paymentStatus || '';
      const method = ShopFulfilment.methodOf(order), paid = order.paymentStatus === 'paid';
      const box = document.createElement('div');
      box.className = `shop-payment-state ${order.paymentStatus}`;
      // Shop evidence is uploaded to the server and recorded as a proof, with the order pointing at
      // it. This looked for order.paymentEvidence.fileData — a shape nothing writes any more — so
      // every order read "Not submitted" however much evidence had been sent, and payments were
      // being verified having seen nothing. fileData is still honoured for anything submitted
      // before the upload existed.
      const proof = (state.masjidPointPaymentProofs || []).find(pr =>
        pr.orderId === order.id || (order.paymentProofId && pr.id === order.paymentProofId));
      const evidence = proof
        ? proofSummaryHtml(proof, (v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))))
        : method.paysUpfront ? '<span class="shop-proof-missing"><small>Evidence</small><strong>Not submitted</strong></span>' : '';
      const action = paid
        ? '<b>✓ Payment verified</b>'
        : method.paysUpfront
          ? `<button type="button" data-shop-payment="${order.id}">Verify payment received</button>`
          : '<b class="shop-payment-at-mosque">Mosque collects on handover</b>';
      box.innerHTML = `<span><small>${method.paysUpfront ? 'Bank payment' : 'Payment'}</small><strong>${ShopFulfilment.paymentLabel(order)}</strong></span>`
        + `<span><small>${method.paysUpfront ? 'Required reference' : 'Amount due'}</small><strong>${method.paysUpfront ? (order.paymentReference || order.id) : `£${Number(order.total || 0).toFixed(2)}`}</strong></span>`
        + evidence + action;
      card.querySelector('.shop-order-customer').after(box);
      // Only hold back fulfilment for orders that should already have been paid for.
      const next = card.querySelector('[data-order-next]');
      if (next && method.paysUpfront && !paid) {
        next.disabled = true;
        next.title = 'Verify the bank payment before fulfilment';
      }
    });

    list.querySelectorAll('[data-shop-payment]').forEach(button => button.onclick = async () => {
      const current = await MasjidDB.state(), items = current.masjidPointShopOrders || [];
      const order = items.find(x => x.id === button.dataset.shopPayment);
      if (!confirm(`Confirm bank transfer ${order.paymentReference || order.id} for £${Number(order.total).toFixed(2)} was received?`)) return;
      const proof=(current.masjidPointPaymentProofs||[]).find(item=>item.orderId===order.id||(order.paymentProofId&&item.id===order.paymentProofId));
      if(!proof)return alert('No submitted payment evidence is connected to this order.');
      const decision=await fetch('/api/admin/payment-proof/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:proof.id,status:'approved',note:'Verified against the bank account.'})}),decisionResult=await decision.json();
      if(!decision.ok)return alert(decisionResult.error||'The payment could not be verified.');
      location.reload();return;
    });
  }

  new MutationObserver(() => enhance()).observe(list, { childList: true });
  enhance();
})();
