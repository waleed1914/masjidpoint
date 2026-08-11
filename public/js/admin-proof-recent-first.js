(async function(){
  const host=document.querySelector('#proof-rows');if(!host)return;
  const state=await MasjidDB.state(),proofs=state.masjidPointPaymentProofs||[],timeByInvoice=new Map(proofs.map(proof=>[proof.invoice,Date.parse(proof.submittedAt||proof.date||0)||0]));
  let arranging=false;
  function arrange(){if(arranging)return;const rows=[...host.querySelectorAll('.proof-row')];if(rows.length<2)return;const invoice=row=>{const text=row.querySelector('small')?.textContent||'';return text.split('·').pop().trim()},sorted=[...rows].sort((a,b)=>(timeByInvoice.get(invoice(b))||0)-(timeByInvoice.get(invoice(a))||0));if(rows.every((row,index)=>row===sorted[index]))return;arranging=true;sorted.forEach(row=>host.appendChild(row));arranging=false}
  new MutationObserver(arrange).observe(host,{childList:true});arrange();
})();
