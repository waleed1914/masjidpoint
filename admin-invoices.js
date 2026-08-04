(async function () {
  const state = await MasjidDB.state();
  const money = n => `£${Number(n || 0).toFixed(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const entries = InvoiceRegister.build(state);

  const search = document.querySelector('#invoice-search');
  const mosqueFilter = document.querySelector('#invoice-mosque');
  const typeFilter = document.querySelector('#invoice-type');
  const sortFilter = document.querySelector('#invoice-sort');
  const rows = document.querySelector('#invoice-rows');
  let active = 'all';

  [...new Set(entries.flatMap(entry => entry.mosques))].sort()
    .forEach(name => mosqueFilter.add(new Option(name, name)));

  const all = InvoiceRegister.totals(entries);
  document.querySelector('#invoice-total').textContent = money(all.invoiced);
  document.querySelector('#invoice-total-note').textContent = `${entries.length} invoice(s) · ${entries.filter(e => e.source === 'shop').length} from mosque shops`;
  document.querySelector('#invoice-paid').textContent = money(all.paid);
  document.querySelector('#invoice-paid-note').textContent = all.invoiced
    ? `${Math.round(all.paid / all.invoiced * 100)}% of everything invoiced`
    : 'Nothing invoiced yet';
  document.querySelector('#invoice-due').textContent = money(all.outstanding);
  document.querySelector('#invoice-due-note').textContent = `${entries.filter(e => ['due', 'overdue'].includes(e.status.key)).length} invoice(s) still to collect`;
  document.querySelector('#invoice-overdue').textContent = money(all.overdue);
  document.querySelector('#invoice-overdue-note').textContent = `${all.overdueCount} invoice(s) past their due date`;
  document.querySelector('#invoice-share').textContent = money(all.mosqueShare);
  document.querySelector('.tile-alert').classList.toggle('quiet', all.overdueCount === 0);

  const SORTS = {
    newest: (a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')),
    oldest: (a, b) => String(a.sortAt || '').localeCompare(String(b.sortAt || '')),
    highest: (a, b) => b.amount - a.amount,
    outstanding: (a, b) => b.outstanding - a.outstanding
  };

  function matches(entry) {
    const q = search.value.toLowerCase().trim();
    if (active !== 'all' && entry.status.key !== active) return false;
    if (typeFilter.value !== 'all' && entry.type.key !== typeFilter.value) return false;
    if (mosqueFilter.value !== 'all' && !entry.mosques.includes(mosqueFilter.value)) return false;
    if (!q) return true;
    return `${entry.number} ${entry.payerName} ${entry.payerDetail} ${entry.payerCode} ${entry.mosques.join(' ')} ${entry.type.label} ${entry.covers}`.toLowerCase().includes(q);
  }

  function render() {
    const filtered = entries.filter(matches).sort(SORTS[sortFilter.value] || SORTS.newest);
    rows.innerHTML = filtered.map(entry => `<tr class="admin-clickable-surface" tabindex="0" data-open="${esc(entry.viewHref)}">
      <td><span class="invoice-cell"><strong>${esc(entry.number)}</strong><span class="type-badge ${entry.type.badge}">${esc(entry.type.label)}</span></span></td>
      <td><span class="applicant-cell"><p><strong>${esc(entry.payerName)}</strong><small>${esc(entry.payerDetail || '—')}</small></p></span></td>
      <td><span class="invoice-purpose"><strong>${esc(entry.covers)}</strong>${entry.route ? `<small class="route-badge ${entry.route.key}">${esc(entry.route.short)}</small>` : '<small>Listing charges</small>'}</span></td>
      <td>${esc(entry.mosques.join(', ') || '—')}</td>
      <td>${esc(entry.issued || '—')}<br><small>Due ${esc(entry.dueLabel || '—')}</small></td>
      <td><strong>${money(entry.amount)}</strong><br><small>${entry.outstanding > 0 ? `${money(entry.outstanding)} outstanding` : `${money(entry.paid)} paid`}</small></td>
      <td>${money(entry.mosqueShare)}</td>
      <td><span class="status-badge ${entry.status.badge}">${esc(entry.status.label)}</span></td>
      <td class="invoice-actions"><a class="review-link" href="${esc(entry.viewHref)}">View →</a><a class="review-link quiet" href="${esc(entry.pdfHref)}" target="_blank" rel="noopener" data-stop>PDF ↓</a></td>
    </tr>`).join('');

    document.querySelector('#invoice-empty').hidden = filtered.length > 0;
    document.querySelector('.table-wrap').hidden = !filtered.length;
    document.querySelectorAll('[data-status]').forEach(button => {
      button.classList.toggle('active', button.dataset.status === active);
      button.querySelector('b').textContent = button.dataset.status === 'all'
        ? entries.length
        : entries.filter(entry => entry.status.key === button.dataset.status).length;
    });

    // Whole row opens the invoice, but the PDF link keeps its own target.
    rows.querySelectorAll('[data-open]').forEach(row => {
      const open = () => { location.href = row.dataset.open; };
      row.onclick = event => { if (!event.target.closest('[data-stop]')) open(); };
      row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
    });
  }

  search.oninput = render;
  mosqueFilter.onchange = render;
  typeFilter.onchange = render;
  sortFilter.onchange = render;
  document.querySelectorAll('[data-status]').forEach(button => button.onclick = () => { active = button.dataset.status; render(); });
  render();
})();
