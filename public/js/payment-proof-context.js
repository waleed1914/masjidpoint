(async function(){
  const session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null');if(session?.role!=='business')return;await MasjidDB.ready;const state=await MasjidDB.state(),app=(state.masjidPointAdminApplications||[]).find(a=>a.reference===session.reference);if(!app)return;const code=app.businessCode||app.reference;
  const legacyProofForm=document.querySelector('#proof-form'),cleanProofForm=legacyProofForm.cloneNode(true);legacyProofForm.replaceWith(cleanProofForm);
  const form=document.querySelector('#proof-form');form.addEventListener('submit',async event=>{event.preventDefault();event.stopImmediatePropagation();const stale=document.querySelector('#proof-context-error');if(stale)stale.hidden=true;const required=[...form.querySelectorAll('[required]')];if(required.some(f=>!f.checkValidity())){required.forEach(f=>f.classList.toggle('invalid',!f.checkValidity()));return}const file=form.elements.proof.files[0],data=new FormData(form),id=`PAY-${Date.now()}`,button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Uploading…';try{const asDataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file)});const response=await fetch('/api/invoice/proof',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoice:data.get('invoice'),businessCode:code,businessName:app.name,amount:Number(data.get('amount')),date:data.get('date'),bankReference:data.get('bankReference'),fileName:file.name,file:asDataUrl})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'That could not be submitted.');document.querySelector('#proof-modal').hidden=true;location.reload()}catch(error){button.disabled=false;button.textContent='Submit for verification';showProofError(error)}} ,true);
  // It used to be an alert saying "Payment evidence could not be saved" and nothing else, so
  // whatever actually went wrong was thrown away — and an alert blocks the page until it is
  // dismissed. The reason now goes in the form, where it can be read and acted on.
  function showProofError(error){
    let line=document.querySelector('#proof-context-error');
    if(!line){line=document.createElement('p');line.id='proof-context-error';line.className='proof-error';
      // The same treatment the sign-in errors get, without pulling in a stylesheet for one line.
      line.style.cssText='background:#fff0ed;border:1px solid #e3b6ae;color:#963c32;padding:12px;font-size:12px;margin:0 0 12px';
      const submit=form.querySelector('button[type=submit]');submit.parentElement.insertBefore(line,submit)}
    line.textContent=`Payment evidence could not be saved: ${error&&error.message?error.message:'unknown error'}`;
    line.hidden=false;
    console.error('payment proof', error);
  }
})();

// The exact balance comes from the server-created invoice and is never editable by the payer.
(async function(){await MasjidDB.ready;const amount=document.querySelector('#proof-form [name="amount"]');if(amount){amount.readOnly=true;amount.setAttribute('aria-readonly','true')}})();
