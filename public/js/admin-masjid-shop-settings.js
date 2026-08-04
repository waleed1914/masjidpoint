// Lets an admin choose which of the three fulfilment options this mosque's shop offers,
// and what it charges for delivery. Stored alongside the mosque's pricing row.
(async function () {
  const reference = new URLSearchParams(location.search).get('reference')
    || sessionStorage.getItem('masjidPointSelectedMasjid');
  const host = document.querySelector('.masjid-view-grid > aside');
  if (!reference || !host || host.hidden) return;

  const state = await MasjidDB.state();
  const mosque = (state.masjidPointAdminApplications || []).find(
    item => item.type === 'masjid' && item.reference === reference
  );
  if (!mosque || !['approved', 'activated'].includes(mosque.status)) return;

  const pricing = state.masjidPointMasjidPricing || [];
  let rate = pricing.find(item => item.masjidReference === reference);
  if (!rate) { rate = { masjidReference: reference, masjidName: mosque.name }; pricing.push(rate); }
  const settings = ShopFulfilment.settingsOf(rate);

  const section = document.createElement('section');
  section.className = 'view-card shop-fulfilment-card';
  section.innerHTML = `
    <header><h2>Shop fulfilment options</h2></header>
    <div class="view-card-body">
      <p class="shop-fulfilment-intro">Choose how customers of this mosque's shop can receive their order. Unticked options are hidden at checkout.</p>
      <form id="shop-fulfilment-form">
        ${ShopFulfilment.ORDER.map(key => {
          const method = ShopFulfilment.METHODS[key];
          return `<label class="shop-fulfilment-option">
            <input type="checkbox" name="${method.setting}" ${settings[method.setting] ? 'checked' : ''}>
            <span><strong>${method.label}</strong><small>${method.customerNote}</small></span>
          </label>`;
        }).join('')}
        <label class="shop-delivery-fee">
          <span>Delivery charge for this mosque</span>
          <input name="shopDeliveryFee" type="number" min="0" step="0.01" value="${ShopFulfilment.deliveryFeeOf(rate).toFixed(2)}">
        </label>
        <p class="shop-fulfilment-hint" id="shop-fulfilment-hint">Added to the total once the customer enters a delivery address at checkout.</p>
        <p class="pricing-error" id="shop-fulfilment-error" hidden>Enable at least one option, or the shop cannot take orders.</p>
        <button class="button" type="submit">Save fulfilment options</button>
      </form>
    </div>`;
  host.appendChild(section);

  const form = section.querySelector('#shop-fulfilment-form');
  const error = section.querySelector('#shop-fulfilment-error');
  const feeField = form.elements.shopDeliveryFee;

  function syncFee() {
    const deliveryOn = form.elements.delivery.checked;
    feeField.disabled = !deliveryOn;
    feeField.closest('label').classList.toggle('disabled', !deliveryOn);
    section.querySelector('#shop-fulfilment-hint').textContent = deliveryOn
      ? 'Added to the total once the customer enters a delivery address at checkout.'
      : 'Enable delivery to set a charge for this mosque.';
  }
  form.oninput = syncFee;
  syncFee();

  form.onsubmit = async event => {
    event.preventDefault();
    const chosen = {
      collectPayNow: form.elements.collectPayNow.checked,
      collectPayAtMosque: form.elements.collectPayAtMosque.checked,
      delivery: form.elements.delivery.checked
    };
    if (!Object.values(chosen).some(Boolean)) { error.hidden = false; return; }
    error.hidden = true;
    Object.assign(rate, {
      masjidName: mosque.name,
      shopFulfilment: chosen,
      shopDeliveryFee: Math.max(0, Number(feeField.value) || 0),
      updatedAt: new Date().toISOString()
    });
    await MasjidDB.save('masjidPointMasjidPricing', pricing);
    const toast = document.querySelector('#toast');
    if (toast) { toast.textContent = 'Shop fulfilment options saved.'; toast.hidden = false; setTimeout(() => toast.hidden = true, 2500); }
  };
})();
