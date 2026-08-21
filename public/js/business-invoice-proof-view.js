(async function () {
  const modal = document.querySelector('#invoice-modal');
  const startButton = document.querySelector('#start-proof');
  const total = document.querySelector('.invoice-total');
  if (!modal || !startButton || !total || !window.MasjidDB) return;

  const state = await MasjidDB.state();
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null'); } catch (_) {}
  const application = (state.masjidPointAdminApplications || []).find(item => item.reference === session?.reference);
  const businessCode = application?.businessCode || application?.reference;
  const proofs = (state.masjidPointPaymentProofs || []).filter(proof => proof.businessCode === businessCode);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const proofSource = proof => proof?.evidence?.objectKey || proof?.evidence?.key
    ? `/api/shop/proof/file?id=${encodeURIComponent(proof.id)}`
    : proof?.fileData || '';
  const isPdf = proof => (proof?.evidence?.mimeType || proof?.fileType || '') === 'application/pdf'
    || /\.pdf$/i.test(proof?.fileName || '');

  const panel = document.createElement('section');
  panel.className = 'business-invoice-proof-state';
  panel.hidden = true;
  total.insertAdjacentElement('afterend', panel);

  function latestProof(invoice) {
    return proofs.filter(proof => proof.invoice === invoice)
      .sort((a, b) => new Date(b.submittedAt || b.date || 0) - new Date(a.submittedAt || a.date || 0))[0];
  }

  function render(invoice) {
    const proof = latestProof(invoice);
    panel.hidden = !proof;
    panel.innerHTML = '';
    if (!proof) {
      startButton.hidden = false;
      startButton.textContent = 'I’ve made this payment';
      return;
    }

    const rejected = proof.status === 'rejected';
    const labels = {
      submitted: ['Payment proof submitted', 'Awaiting administrator verification'],
      approved: ['Payment verified', 'This invoice payment has been approved'],
      rejected: ['Payment proof rejected', 'Please review the reason and submit new evidence']
    };
    const label = labels[proof.status] || ['Payment proof received', String(proof.status || '')];
    const source = proofSource(proof);
    const preview = isPdf(proof)
      ? `<a class="business-proof-pdf" href="${escapeHtml(source)}" target="_blank" rel="noopener">Open submitted PDF evidence ↗</a>`
      : `<a class="business-proof-image" href="${escapeHtml(source)}" target="_blank" rel="noopener"><img src="${escapeHtml(source)}" alt="Submitted payment evidence"><span>Open full evidence ↗</span></a>`;

    panel.innerHTML = `<header><div><small>Bank transfer evidence</small><strong>${escapeHtml(label[0])}</strong><span>${escapeHtml(label[1])}</span></div><em class="${escapeHtml(proof.status)}">${escapeHtml(proof.status)}</em></header>${source ? preview : ''}<dl><div><dt>Amount</dt><dd>£${Number(proof.amount || 0).toFixed(2)}</dd></div><div><dt>Bank reference</dt><dd>${escapeHtml(proof.bankReference || 'Not provided')}</dd></div><div><dt>Submitted</dt><dd>${new Date(proof.submittedAt || proof.date).toLocaleString('en-GB')}</dd></div><div><dt>File</dt><dd>${escapeHtml(proof.fileName || 'Payment evidence')}</dd></div></dl>${proof.adminNote ? `<p><strong>Administrator note:</strong> ${escapeHtml(proof.adminNote)}</p>` : ''}`;
    startButton.hidden = !rejected;
    startButton.textContent = rejected ? 'Submit replacement proof' : 'I’ve made this payment';
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-own-invoice],[data-invoice]');
    if (!trigger) return;
    const invoice = trigger.dataset.ownInvoice || trigger.dataset.invoice;
    setTimeout(() => render(invoice), 0);
  });
})();
