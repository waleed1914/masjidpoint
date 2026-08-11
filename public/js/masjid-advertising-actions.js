(function(){
  function showTrialContext(){
    const approve=document.querySelector('#masjid-approve');if(approve)approve.textContent='Approve request';
    if(typeof activeRequest==='undefined'||!activeRequest?.trialAdvertisingEligible)return;
    const fields=[...document.querySelectorAll('#request-details .portal-detail-grid>div')];
    const price=fields.find(field=>field.querySelector('small')?.textContent.includes('monthly price'));
    const payment=fields.find(field=>field.querySelector('small')?.textContent.trim()==='Payment');
    if(price){price.querySelector('small').textContent='Trial advertising';price.querySelector('span').textContent='£0.00 — no charge'}
    if(payment)payment.querySelector('span').textContent='No payment required — admin trial';
    if(approve)approve.textContent='Approve trial & publish';
  }
  async function act(action,event){
    if(typeof activeRequest==='undefined'||!activeRequest)return;
    event.preventDefault();event.stopImmediatePropagation();event.currentTarget.disabled=true;
    const response=await fetch('/api/advertising/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeRequest.id,action,note:document.querySelector('#masjid-note')?.value.trim()||''})}),result=await response.json();
    if(!response.ok){event.currentTarget.disabled=false;return alert(result.error||'The advertising decision could not be saved.');}
    location.reload();
  }
  document.querySelector('#masjid-approve')?.addEventListener('click',event=>act('approve',event),true);
  document.querySelector('#masjid-reject')?.addEventListener('click',event=>act('reject',event),true);
  document.querySelector('#toggle-listing')?.addEventListener('click',event=>act('toggle',event),true);
  document.addEventListener('click',event=>{if(event.target.closest('[data-request]'))setTimeout(showTrialContext,0)});
})();
