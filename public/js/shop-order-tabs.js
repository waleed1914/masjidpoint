// Status tabs over any list of shop orders — the admin fulfilment queue, the masjid's own orders,
// and a customer's order history.
//
// All three showed every order in one run, so finding the ones that need doing meant reading the
// whole list. The tabs are built from the orders actually present, so nobody is offered a filter
// that would show them nothing, and each carries its own count.
(function () {
  'use strict';

  // Where the orders are, per page. The first selector that matches something wins.
  const LISTS = ['#admin-order-list', '#masjid-order-list', '#shop-orders .order-list',
                 '#shop-orders', '#account-orders', '.order-history'];
  const CARD = '.shop-order-card, .order-card, [data-order-id], article';

  // Orders move through these; anything unrecognised is grouped as "other" rather than hidden.
  const GROUPS = [
    { key: 'all', label: 'All', match: () => true },
    { key: 'awaiting', label: 'Awaiting payment', match: t => !/payment verified|evidence approved|\bpaid\b/.test(t) && /awaiting[_ ](?:bank transfer|payment)|payment[_ ]pending|payment due|evidence submitted|unpaid/.test(t) },
    { key: 'ordered', label: 'Ordered', match: t => /\bordered\b/.test(t) },
    { key: 'preparing', label: 'Preparing', match: t => /preparing/.test(t) },
    { key: 'ready', label: 'Ready for collection', match: t => /ready for mosque|ready for collection|mosque received|ready/.test(t) },
    { key: 'dispatched', label: 'Dispatched', match: t => /dispatched|on its way/.test(t) },
    { key: 'completed', label: 'Completed', match: t => /delivered|collected|completed|handed over/.test(t) },
    { key: 'cancelled', label: 'Cancelled', match: t => /cancelled|refunded/.test(t) },
  ];

  const statusText = card => {
    // Prefer an explicit status if the card carries one; fall back to reading the card.
    const explicit=[card.dataset.orderStatus,card.dataset.paymentStatus].filter(Boolean).join(' ');
    const badge = card.querySelector('[data-order-status], .order-status, .shop-order-status, .status-badge, .portal-badge, .shop-order-card>header>span');
    return String(explicit || badge?.textContent || card.textContent || '').toLowerCase();
  };

  function build(list) {
    const cards = [...list.querySelectorAll(CARD)].filter(c => c.querySelector('*') || c.textContent.trim());
    if (cards.length < 2) {
      // A previous render may have had enough orders to create filters. Do not leave a lone
      // replacement card hidden by that old selection while the async payment data settles.
      cards.forEach(card => { card.hidden = false; });
      list.parentElement.querySelector('.shop-order-tabs')?.remove();
      list.parentElement.querySelector('.shop-order-tabs-empty')?.remove();
      return;
    }

    const counts = new Map();
    for (const group of GROUPS) {
      counts.set(group.key, group.key === 'all' ? cards.length
        : cards.filter(c => group.match(statusText(c))).length);
    }
    const shown = GROUPS.filter(g => g.key === 'all' || counts.get(g.key) > 0);
    if (shown.length < 3) return;                       // nothing worth filtering by

    let tabs = list.parentElement.querySelector('.shop-order-tabs');
    const previous=tabs?.querySelector('[aria-current="true"]')?.dataset.group;
    // A payment/status update can remove the selected group entirely. Never keep filtering by a
    // tab that is no longer rendered, otherwise every order is hidden with no active tab visible.
    const current=shown.some(group=>group.key===previous)?previous:'all';
    if (!tabs) {
      tabs = document.createElement('nav');
      tabs.className = 'shop-order-tabs';
      list.before(tabs);
    }
    tabs.innerHTML = shown.map(g =>
      `<button type="button" data-group="${g.key}"${g.key === current ? ' aria-current="true"' : ''}>${g.label}<b>${counts.get(g.key)}</b></button>`
    ).join('');

    const show = key => {
      const group = GROUPS.find(g => g.key === key) || GROUPS[0];
      for (const card of cards) card.hidden = !group.match(statusText(card));
      tabs.querySelectorAll('button').forEach(b =>
        b.setAttribute('aria-current', b.dataset.group === key ? 'true' : 'false'));
      // An empty result should say so rather than look like a page that failed to load.
      let empty = list.parentElement.querySelector('.shop-order-tabs-empty');
      const none = cards.every(c => c.hidden);
      if (none && !empty) {
        empty = document.createElement('p');
        empty.className = 'shop-order-tabs-empty';
        empty.textContent = 'No orders at this stage.';
        list.after(empty);
      }
      if (empty) empty.hidden = !none;
    };

    tabs.querySelectorAll('button').forEach(b => b.onclick = () => show(b.dataset.group));
    show(current);
  }

  function attach() {
    for (const selector of LISTS) {
      const list = document.querySelector(selector);
      if (!list) continue;
      build(list);
      if (!list.dataset.tabsWatched) {
        list.dataset.tabsWatched = '1';
        // The lists re-render when an order moves; rebuild rather than leave stale counts.
        new MutationObserver(() => build(list)).observe(list, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-order-status', 'data-payment-status']
        });
      }
      return;
    }
  }

  const start = () => { attach(); setTimeout(attach, 900); setTimeout(attach, 2400); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
