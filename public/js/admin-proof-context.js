(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function proofOwner(proof){return proof.businessName||proof.customerName||'Shop customer'}
  function proofContext(proof){return proof.orderId?`Shop order ${proof.orderId}`:`${proof.businessCode||''}${proof.businessCode?' · ':''}${proof.invoice||''}`}

  renderProofs=function(){
    const pending=proofs.filter(proof=>proof.status==='submitted').length;
    document.querySelector('#proof-pending-count').textContent=`${pending} awaiting review`;
    document.querySelector('#proof-rows').innerHTML=[...proofs].reverse().map(proof=>`<article class="proof-row"><p><strong>${esc(proofOwner(proof))}</strong><small>${esc(proofContext(proof))}</small></p><strong>${money(proof.amount)}</strong><span class="proof-status ${esc(proof.status)}">${esc(proof.status)}</span><button data-proof="${esc(proof.id)}" type="button">${proof.status==='submitted'?'Review':'View'} →</button></article>`).join('');
    document.querySelector('#proof-empty').hidden=proofs.length>0;
    document.querySelectorAll('[data-proof]').forEach(button=>button.onclick=()=>openProofReview(button.dataset.proof));
  };
  openProofReview=function(id){
    reviewingProof=proofs.find(proof=>proof.id===id);if(!reviewingProof)return;
    document.querySelector('#review-proof-title').textContent=`${proofOwner(reviewingProof)} · ${reviewingProof.invoice||reviewingProof.orderId}`;
    document.querySelector('#proof-review-details').innerHTML=`<div><small>Payment for</small><strong>${esc(reviewingProof.orderId?'Mosque shop order':'Business invoice')}</strong></div><div><small>Reference</small><strong>${esc(reviewingProof.orderId||reviewingProof.businessCode||'—')}</strong></div><div><small>Amount claimed</small><strong>${money(reviewingProof.amount)}</strong></div><div><small>Payment date</small><strong>${new Intl.DateTimeFormat('en-GB').format(new Date(reviewingProof.date))}</strong></div><div><small>Bank reference</small><strong>${esc(reviewingProof.bankReference)}</strong></div>`;
    const preview=document.querySelector('#proof-preview');
    if(reviewingProof.evidence){const source=`/api/shop/proof/file?id=${encodeURIComponent(reviewingProof.id)}`;preview.innerHTML=reviewingProof.evidence.mimeType==='application/pdf'?`<a href="${source}" target="_blank">Open uploaded PDF receipt ↗</a>`:`<img src="${source}" alt="Uploaded payment evidence">`}
    else if(reviewingProof.fileData)preview.innerHTML=reviewingProof.fileType==='application/pdf'?`<a href="${reviewingProof.fileData}" target="_blank">Open uploaded PDF receipt ↗</a>`:`<img src="${reviewingProof.fileData}" alt="Uploaded payment evidence">`;
    else preview.textContent='No screenshot was attached. Verify using the bank reference.';
    document.querySelector('#proof-admin-note').value=reviewingProof.adminNote||'';document.querySelector('#reject-proof').hidden=reviewingProof.status!=='submitted';document.querySelector('#approve-proof').hidden=reviewingProof.status!=='submitted';document.querySelector('#proof-review').hidden=false;
  };
  MasjidDB.ready.then(async()=>{const state=await MasjidDB.state();proofs=state.masjidPointPaymentProofs||[];renderProofs()});
  async function decide(status,event){
    event.preventDefault();event.stopImmediatePropagation();
    if(typeof reviewingProof==='undefined'||!reviewingProof)return;
    const note=document.querySelector('#proof-admin-note').value.trim();
    if(status==='rejected'&&!note)return alert('Enter a rejection reason so the business knows what to correct.');
    const button=event.currentTarget,originalLabel=button.textContent;button.disabled=true;button.textContent=status==='approved'?'Verifying payment…':'Rejecting proof…';
    let response,result;
    try{response=await fetch('/api/admin/payment-proof/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:reviewingProof.id,status,note})});result=await response.json()}
    catch(error){button.disabled=false;button.textContent=originalLabel;return alert('The server could not be reached. Please try again.')}
    if(!response.ok){button.disabled=false;button.textContent=originalLabel;return alert(result.error||'The payment decision could not be saved.');}
    button.textContent=status==='approved'?'Payment verified ✓':'Proof rejected ✓';
    location.reload();
  }
  document.querySelector('#reject-proof')?.addEventListener('click',event=>decide('rejected',event),true);
  document.querySelector('#approve-proof')?.addEventListener('click',event=>decide('approved',event),true);
})();
