(async function () {
  if (location.hash === '#applications') {
    location.replace(`admin-applications${location.search}`);
    return;
  }

  const state = await MasjidDB.state();
  const applications = state.masjidPointAdminApplications || [];
  const finance = state.masjidPointFinance || { accounts: [] };
  let activeType = 'all';
  let activeApplication = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const effectiveStatus = application =>
    application.accountStatus && application.accountStatus !== 'active'
      ? application.accountStatus
      : String(application.status || 'pending').toLowerCase();
  const formatDate = value => value
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
    : 'Not recorded';
  const activeAccount = application =>
    ['approved', 'activated'].includes(application.status)
    && !['blocked', 'deactivated'].includes(application.accountStatus);

  function updateSummary() {
    const invoices = (finance.accounts || []).flatMap(account => account.invoices || []);
    const outstanding = invoices.reduce(
      (total, invoice) => total + Math.max(0, Number(invoice.amount || 0) - Number(invoice.paid || 0)), 0
    );
    document.querySelector('#active-masjids').textContent = applications.filter(item => item.type === 'masjid' && activeAccount(item)).length;
    document.querySelector('#active-businesses').textContent = applications.filter(item => item.type === 'business' && activeAccount(item)).length;
    document.querySelector('#pending-total').textContent = applications.filter(item => item.status === 'pending').length;
    document.querySelector('#nav-pending-count').textContent = applications.filter(item => item.status === 'pending').length;
    const outstandingCard = document.querySelector('.stat-grid .stat-card:nth-child(4)');
    if (outstandingCard) {
      outstandingCard.querySelector('strong').textContent = `£${outstanding.toFixed(2)}`;
      outstandingCard.querySelector('em').textContent = `Across ${invoices.filter(invoice => Number(invoice.paid || 0) < Number(invoice.amount || 0)).length} invoices`;
    }
  }

  function render() {
    const query = document.querySelector('#application-search').value.trim().toLowerCase();
    const requestedStatus = document.querySelector('#status-filter').value;
    const filtered = applications.filter(application =>
      (activeType === 'all' || application.type === activeType)
      && (requestedStatus === 'all' || effectiveStatus(application) === requestedStatus)
      && (!query || `${application.name} ${application.email} ${application.reference}`.toLowerCase().includes(query))
    );
    document.querySelector('#application-rows').innerHTML = filtered.slice(0, 10).map(application => {
      const status = effectiveStatus(application);
      return `<tr><td><div class="applicant-cell"><span class="applicant-icon">${application.type === 'masjid' ? '⌂' : '▤'}</span><p><strong>${escapeHtml(application.name)}</strong><small>${escapeHtml(application.email)}</small></p></div></td><td><span class="type-badge">${escapeHtml(application.type)}</span></td><td>${formatDate(application.submittedAt)}</td><td>${escapeHtml(application.reference)}</td><td><span class="status-badge ${status}">${status}</span></td><td><button class="review-link" data-review="${escapeHtml(application.reference)}">${status === 'pending' ? 'Review' : 'Manage'} →</button></td></tr>`;
    }).join('');
    document.querySelector('#admin-empty').hidden = filtered.length > 0;
    document.querySelector('.table-wrap').hidden = filtered.length === 0;
    document.querySelector('#all-count').textContent = applications.length;
    document.querySelector('#masjid-count').textContent = applications.filter(item => item.type === 'masjid').length;
    document.querySelector('#business-count').textContent = applications.filter(item => item.type === 'business').length;
    document.querySelectorAll('[data-review]').forEach(button => button.onclick = () => openDrawer(button.dataset.review));
    updateSummary();
  }

  function openDrawer(reference) {
    activeApplication = applications.find(application => application.reference === reference || application.id === reference);
    if (!activeApplication) return;
    const status = effectiveStatus(activeApplication);
    document.querySelector('#drawer-type').textContent = `${activeApplication.type} application`;
    document.querySelector('#drawer-title').textContent = activeApplication.name;
    document.querySelector('#drawer-status').innerHTML = `<span class="status-badge ${status}">${status}</span> &nbsp; <small>Submitted ${formatDate(activeApplication.submittedAt)}</small>`;
    document.querySelector('#drawer-details').innerHTML = `<section class="detail-section"><h3>Application details</h3><div class="detail-grid">${Object.entries(activeApplication.details || {}).map(([label, value]) => `<div class="${String(value).length > 55 ? 'wide' : ''}"><small>${escapeHtml(label)}</small><span>${escapeHtml(value)}</span></div>`).join('')}</div></section>`;
    document.querySelector('#decision-note').value = activeApplication.note || activeApplication.accountStatusNote || '';
    document.querySelector('#drawer-actions').hidden = activeApplication.status !== 'pending';
    document.querySelector('#account-actions').hidden = !['approved', 'activated'].includes(activeApplication.status);
    document.querySelector('#block-account').hidden = activeApplication.accountStatus === 'blocked';
    document.querySelector('#deactivate-account').hidden = activeApplication.accountStatus === 'deactivated';
    document.querySelector('#reactivate-account').hidden = !['blocked', 'deactivated'].includes(activeApplication.accountStatus);
    document.querySelector('#drawer-backdrop').hidden = false;
    document.querySelector('#review-drawer').classList.add('open');
    document.querySelector('#review-drawer').setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    document.querySelector('#review-drawer').classList.remove('open');
    document.querySelector('#review-drawer').setAttribute('aria-hidden', 'true');
    document.querySelector('#drawer-backdrop').hidden = true;
    activeApplication = null;
  }

  async function saveDecision(status, accountStatus) {
    if (!activeApplication) return;
    const name = activeApplication.name;
    const note = document.querySelector('#decision-note').value.trim();
    if (status) {
      activeApplication.status = status;
      activeApplication.note = note;
      activeApplication.decidedAt = new Date().toISOString();
      if (status === 'approved') activeApplication.accountStatus = 'active';
    }
    if (accountStatus) {
      activeApplication.accountStatus = accountStatus;
      activeApplication.accountStatusNote = note;
      activeApplication.accountStatusChangedAt = new Date().toISOString();
    }
    await MasjidDB.save('masjidPointAdminApplications', applications);
    closeDrawer();
    render();
    showToast(`${name} is now ${accountStatus || status}.`);
  }

  function showToast(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2800);
  }

  document.querySelector('#application-search').oninput = render;
  document.querySelector('#status-filter').onchange = render;
  document.querySelectorAll('[data-type]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-type]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    activeType = button.dataset.type;
    render();
  });
  document.querySelector('#close-drawer').onclick = closeDrawer;
  document.querySelector('#drawer-backdrop').onclick = closeDrawer;
  document.querySelector('#approve-application').onclick = () => saveDecision('approved');
  document.querySelector('#reject-application').onclick = () => saveDecision('rejected');
  document.querySelector('#block-account').onclick = () => saveDecision(null, 'blocked');
  document.querySelector('#deactivate-account').onclick = () => saveDecision(null, 'deactivated');
  document.querySelector('#reactivate-account').onclick = () => saveDecision(null, 'active');
  document.querySelector('#refresh-data').onclick = () => location.reload();
  document.querySelector('.admin-topbar small').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  const requestedStatus = new URLSearchParams(location.search).get('status');
  if (requestedStatus && document.querySelector(`#status-filter option[value="${CSS.escape(requestedStatus)}"]`)) {
    document.querySelector('#status-filter').value = requestedStatus;
  }
  render();
  const requestedApplication = new URLSearchParams(location.search).get('application');
  if (requestedApplication) openDrawer(requestedApplication);
})();
