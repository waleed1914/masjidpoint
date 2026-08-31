(async function(){
  const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state=await MasjidDB.state();
  const approved=(state.masjidPointAdminApplications||[]).filter(app=>app.type==='masjid'&&['approved','activated'].includes(app.status));
  const pricing=state.masjidPointMasjidPricing||[],host=document.querySelector('.masjid-options');
  if(!host)return;
  host.innerHTML='';masjidOptions.splice(0,masjidOptions.length);
  for(const app of approved){
    const rate=pricing.find(item=>item.masjidReference===app.reference||item.masjidName===app.name);
    if(!rate||rate.acceptingListings===false)continue;
    const label=document.createElement('label'),postcode=app.details?.Postcode||'',photo=String(app.photo||'');
    const hasPhoto=photo.startsWith('data:image/');
    label.className='masjid-option';
    label.innerHTML=`<input type="radio" name="masjid" value="${escapeHtml(app.name)}" data-masjid-reference="${escapeHtml(app.reference)}" data-price="${Number(rate.advertisingPrice).toFixed(2)}" data-admin-percent="${Number(rate.adminPercent)}" data-mosque-percent="${Number(rate.mosquePercent)}" data-pricing-updated-at="${escapeHtml(rate.updatedAt||'')}" required><span class="option-icon${hasPhoto?' has-photo':''}">${hasPhoto?`<img src="${photo}" alt="${escapeHtml(app.name)}" loading="lazy"><b aria-hidden="true">⌂</b>`:'<b aria-hidden="true">⌂</b>'}</span><span><strong>${escapeHtml(app.name)}</strong><small>${escapeHtml(postcode||'Verified UK masjid')}</small></span><i>£${Number(rate.advertisingPrice).toFixed(2)}/month</i>`;
    const image=label.querySelector('.option-icon img');
    if(image)image.addEventListener('error',()=>{image.remove();label.querySelector('.option-icon')?.classList.remove('has-photo')},{once:true});
    host.appendChild(label);masjidOptions.push(label);
  }
  const params=new URLSearchParams(location.search),requestedReference=params.get('reference')||params.get('masjidReference'),requestedName=params.get('masjid'),selected=[...host.querySelectorAll('input[name="masjid"]')].find(input=>input.dataset.masjidReference===requestedReference||input.value===requestedName);if(selected){selected.checked=true;selected.closest('.masjid-option')?.classList.add('selected');masjidSearch.value=selected.value}filterMasjids();
})();
