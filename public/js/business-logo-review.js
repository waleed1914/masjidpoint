(function () {
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const card = request => request?.logo ? `<div class="wide business-logo-review"><small>Business logo</small><img src="/api/business-logo?reference=${encodeURIComponent(request.reference || request.id)}" alt="${esc(request.name)} logo" style="display:block;max-width:190px;max-height:130px;object-fit:contain;margin-top:8px;padding:9px;border:1px solid #d4d9d5;background:#fff"><span style="display:block;margin-top:6px">Uploaded business branding</span></div>` : '';
  async function find(reference) { const state = await MasjidDB.state(); return (state.masjidPointBusinessRequests || []).find(item => item.reference === reference || item.id === reference) || (state.masjidPointAdminApplications || []).find(item => item.type === 'business' && (item.reference === reference || item.id === reference)); }
  async function mosque(reference) { const details=document.querySelector('#request-details'); if(!details)return; const request=await find(reference); details.querySelector('.business-logo-review')?.remove(); const grid=details.querySelector('.portal-detail-grid'); if(grid&&request?.logo)grid.insertAdjacentHTML('afterbegin',card(request)); }
  async function admin() { const details=document.querySelector('#business-details'); if(!details)return; const query=new URLSearchParams(location.search),request=await find(query.get('reference')||query.get('application')); details.querySelector('.business-logo-review')?.remove(); if(request?.logo)details.insertAdjacentHTML('beforeend',card(request)); }
  let tableRequests=[];
  async function enhanceTableLogos(){
    if(!tableRequests.length){const state=await MasjidDB.state();tableRequests=state.masjidPointBusinessRequests||[]}
    document.querySelectorAll('.business-cell,.applicant-cell').forEach(cell=>{
      const icon=cell.querySelector('.business-logo,.applicant-icon'),name=cell.querySelector('strong')?.textContent?.trim(),email=cell.querySelector('small')?.textContent?.trim().toLowerCase();
      if(!icon||icon.dataset.logoChecked==='1')return;
      const request=tableRequests.find(item=>item.logo&&((name&&item.name===name)||(email&&String(item.email||'').toLowerCase()===email)));
      icon.dataset.logoChecked='1';if(!request)return;
      const fallback=icon.textContent,image=document.createElement('img');image.src=`/api/business-logo?reference=${encodeURIComponent(request.reference||request.id)}`;image.alt=`${request.name} logo`;image.style.cssText='display:block;width:100%;height:100%;object-fit:contain;background:#fff;padding:3px;box-sizing:border-box';
      image.onerror=()=>{icon.textContent=fallback};icon.textContent='';icon.appendChild(image);
    });
  }
  document.addEventListener('click',event=>{const trigger=event.target.closest('[data-request],[data-scoped-request]');if(trigger)setTimeout(()=>mosque(trigger.dataset.request||trigger.dataset.scopedRequest),0)},true);
  const start=()=>{admin();enhanceTableLogos();const observer=new MutationObserver(()=>enhanceTableLogos());observer.observe(document.body,{childList:true,subtree:true})};
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',start);else start();
})();
