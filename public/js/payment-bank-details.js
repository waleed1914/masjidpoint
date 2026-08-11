// Bank-transfer details for anything paid up front: shop orders, advertising and job listings.
// The account is only shown once an administrator has published it in Bank details. When it has
// not been published, a customer who chooses to pay now would otherwise reach the end of checkout
// with no way to pay at all, so they are told where to get the details instead of seeing nothing.
(async function () {
  const state = await MasjidDB.state();
  const bank = state.masjidPointPlatformSettings?.bankDetails;
  const published = bank?.active === true;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const card = reference => `<section class="customer-bank-card"><header><span>£</span><div><strong>Pay by bank transfer</strong><small>Use the exact payment reference shown below.</small></div></header><div><span><small>Account name</small><strong>${esc(bank.accountName)}</strong></span><span><small>Bank</small><strong>${esc(bank.bankName)}</strong></span><span><small>Sort code</small><strong>${esc(bank.sortCode)}</strong></span><span><small>Account number</small><strong>${esc(bank.accountNumber)}</strong></span>${bank.iban ? `<span class="wide"><small>IBAN</small><strong>${esc(bank.iban)}</strong></span>` : ''}<span class="wide bank-reference"><small>Payment reference</small><strong>${esc(reference)}</strong></span></div>${bank.instructions ? `<p>${esc(bank.instructions)}</p>` : ''}</section>`;

  const pendingCard = reference => `<section class="customer-bank-card bank-card-pending"><header><span>£</span><div><strong>Payment details to follow</strong><small>Bank-transfer details have not been published yet.</small></div></header><div><span class="wide bank-reference"><small>Payment reference</small><strong>${esc(reference)}</strong></span></div><p>Your order is saved. Contact the mosque to arrange payment, quoting this reference — you will be notified once payment has been verified.</p></section>`;

  if (/\/business-(?:portal|invoices)(?:\.html)?$/.test(location.pathname)) {
    const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
    const app = (state.masjidPointAdminApplications || []).find(x => x.reference === session?.reference);
    const code = app?.businessCode || app?.reference || 'Your business payment code';

    if (published) {
      const body = document.querySelector('#proof-form .proof-body');
      if (body && !body.querySelector('.customer-bank-card')) body.insertAdjacentHTML('afterbegin', card(code));
    }

    // The invoice a business opens ends in "I've made this payment" — which, without the account
    // to pay into, asks them to confirm something they have had no way of doing. The details
    // belong on the invoice itself, above that button, not only on the form that follows it.
    // When no account has been published yet, say so plainly rather than showing nothing.
    const modal = document.querySelector('#invoice-modal');
    const startProof = document.querySelector('#start-proof');
    if (modal && startProof) {
      new MutationObserver(() => {
        if (modal.hidden) return;
        if (modal.querySelector('.customer-bank-card')) return;
        const number = (document.querySelector('#modal-invoice-number')?.textContent || '').trim();
        startProof.insertAdjacentHTML('beforebegin', published ? card(number || code) : pendingCard(number || code));
      }).observe(modal, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    }
  }

  if (/\/masjid-shop(?:\.html)?$/.test(location.pathname)) {
    // The basket no longer carries a bank card. It could only show a placeholder reference, since
    // the real one does not exist until the order does — checkout now has a payment step that
    // shows the account alongside the order's own reference.
    const success = document.querySelector('#order-success');
    if (!success) return;
    new MutationObserver(async () => {
      if (success.hidden || success.querySelector('.customer-bank-card')) return;
      const reference = success.textContent.match(/ORD-\d+/)?.[0];
      if (!reference) return;
      const latest = await MasjidDB.state();
      const orders = latest.masjidPointShopOrders || [];
      const order = orders.find(x => x.id === reference);
      if (!order) return;
      if (!ShopFulfilment.methodOf(order).paysUpfront) return;
      // Once evidence is in, or the payment is verified, repeating the account details is noise.
      if (['submitted', 'paid'].includes(order.paymentStatus)) return;
      const payTo = order.paymentReference || reference;
      success.insertAdjacentHTML('beforeend', published ? card(payTo) : pendingCard(payTo));
      if (!order.paymentReference) {
        order.paymentReference = reference;
        await MasjidDB.save('masjidPointShopOrders', orders);
      }
    }).observe(success, { childList: true, subtree: true, attributes: true });
  }
})();
