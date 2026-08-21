(function () {
  const emptySelector = '.admin-empty:not([hidden]),.portal-empty:not([hidden]),.job-empty:not([hidden]),.earnings-empty:not([hidden]),.customer-empty:not([hidden]),.donation-empty:not([hidden]),.adverts-empty:not([hidden]),.empty-state:not([hidden])';

  function setBarHidden(bar, hidden) {
    if (bar.dataset.emptyHidden === String(hidden)) return;
    bar.dataset.emptyHidden = String(hidden);
    bar.hidden = hidden;
    if (hidden) bar.style.setProperty('display', 'none', 'important');
    else bar.style.removeProperty('display');
  }

  function tableBodyNear(bar) {
    const neighbours = [bar.previousElementSibling, bar.nextElementSibling];
    for (const node of neighbours) {
      const body = node?.querySelector?.('tbody');
      if (body) return body;
    }
    return null;
  }

  function sync() {
    document.querySelectorAll('.native-admin-pager,.table-pagination').forEach(bar => {
      const body = tableBodyNear(bar);
      const adjacentEmpty = bar.previousElementSibling?.matches?.(emptySelector)
        || bar.nextElementSibling?.matches?.(emptySelector)
        || bar.nextElementSibling?.nextElementSibling?.matches?.(emptySelector);
      setBarHidden(bar, Boolean(adjacentEmpty || (body && body.rows.length === 0)));
    });

    const audit = document.querySelector('.audit-pagination');
    if (audit) setBarHidden(audit, Boolean(document.querySelector('#audit-empty:not([hidden])')));

    const earnings = document.querySelector('.earnings-pagination');
    if (earnings) setBarHidden(earnings, Boolean(document.querySelector('#earnings-empty:not([hidden])')));

    document.querySelectorAll('.pagination').forEach(bar => {
      const container = bar.previousElementSibling;
      setBarHidden(bar, Boolean(container && container.children.length === 0));
    });
  }

  let queued = false;
  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  }

  new MutationObserver(queueSync).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden']
  });
  sync();
})();
