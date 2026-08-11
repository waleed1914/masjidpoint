(function () {
  async function saveProduct(form, id) {
    const data = new FormData(form), state = await MasjidDB.state();
    const mosques = (state.masjidPointAdminApplications || []).filter(item => item.type === 'masjid' && ['approved', 'activated'].includes(item.status));
    const selected = [...form.querySelectorAll('[name="mosques"]:checked')].map(input => mosques.find(item => item.reference === input.value)).filter(Boolean);
    const file = data.get('image');
    if (!selected.length) throw Error('Select at least one mosque shop.');
    if (file && file.size > 2 * 1024 * 1024) throw Error('Product image must be 2 MB or smaller.');
    let image = file && file.size ? await ImageDownscale.fromFile(file) : '';
    if (id && !image) image = (state.masjidPointProducts || []).find(item => item.id === id)?.image || '';
    const product = {name:String(data.get('name')||'').trim(),description:String(data.get('description')||'').trim(),category:String(data.get('category')||'').trim(),price:Number(data.get('price')),stock:Number(data.get('stock')),mosqueSharePercent:Number(data.get('mosqueSharePercent')),mosques:selected.map(item=>({reference:item.reference,name:item.name})),image};
    const response = await fetch('/api/admin/product',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:id?'update':'create',id,product})});
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'The product could not be saved.');
    location.reload();
  }
  document.addEventListener('click', event => { const button=event.target.closest('[data-edit-product]');if(button)window.__editingProductId=button.dataset.editProduct; }, true);
  document.addEventListener('submit', async event => {
    const form=event.target;if(form.id!=='product-form'&&!form.closest('#edit-product-modal'))return;
    event.preventDefault();event.stopImmediatePropagation();const button=form.querySelector('[type="submit"]');if(button)button.disabled=true;
    try { await saveProduct(form,form.closest('#edit-product-modal')?window.__editingProductId:''); }
    catch(failure){const error=form.querySelector('.product-error')||document.querySelector('#product-error');if(error){error.textContent=failure.message;error.hidden=false}else alert(failure.message);if(button)button.disabled=false}
  },true);
})();
