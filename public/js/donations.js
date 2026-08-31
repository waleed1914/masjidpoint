(async function(){
  if(!document.querySelector('body>footer')){
    document.querySelector('main').insertAdjacentHTML('afterend','<footer><a class="brand brand-light" href="/"><span class="brand-mark" aria-hidden="true"><span></span></span><span>Masjid<span>Point</span></span></a><p>Connecting communities. Strengthening masjids.</p><div><a href="businesses">Businesses</a><a href="masjids">Masjids</a><a href="donations">Donate</a><a href="public-jobs">Jobs</a><a href="shops">Masjid shops</a><a href="privacy">Privacy</a><a href="terms">Terms</a><a href="status">Check status</a><a href="admin-login">Admin</a></div><small>© 2026 MasjidPoint. All rights reserved.</small></footer>');
  }

  const state=await MasjidDB.state();
  const grid=document.querySelector('#donation-grid');
  const search=document.querySelector('#donation-search');
  const clear=document.querySelector('#clear-donation-search');
  const modal=document.querySelector('#donation-modal');
  const esc=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const bankDetailsAreComplete=bank=>{
    const sortCode=String(bank?.sortCode||'').replace(/\D/g,'');
    const accountNumber=String(bank?.accountNumber||'').replace(/\D/g,'');
    return Boolean(
      bank?.active===true&&
      String(bank.accountName||'').trim()&&
      String(bank.bankName||'').trim()&&
      sortCode.length===6&&
      accountNumber.length===8
    );
  };
  const all=(state.masjidPointAdminApplications||[]).filter(item=>
    item.type==='masjid'&&
    ['approved','activated'].includes(item.status)&&
    !['blocked','deactivated'].includes(item.accountStatus)&&
    bankDetailsAreComplete(item.donationBankDetails)
  );
  let selected=null;

  const locationOf=item=>item.address||item.location||item.postcode||'United Kingdom';
  function render(){
    const query=search.value.trim().toLowerCase().replace(/\s+/g,' ');
    const list=all.filter(item=>!query||`${item.name} ${locationOf(item)} ${item.postcode||''}`.toLowerCase().includes(query));
    document.querySelector('#donation-count').textContent=list.length;
    grid.innerHTML=list.map(item=>`<article class="donation-card" tabindex="0" role="button" data-donate="${esc(item.reference)}" aria-label="View bank details for ${esc(item.name)}">${item.photo?`<div class="donation-mosque-photo"><img src="${esc(item.photo)}" alt="${esc(item.name)} mosque building"></div>`:'<div class="mosque-arch"><span>☾</span></div>'}<div class="donation-card-body"><small>${esc(item.postcode||'UK MOSQUE')}</small><h3>${esc(item.name)}</h3><p>${esc(locationOf(item))}</p><span>View donation details →</span></div></article>`).join('');
    document.querySelector('#donation-empty').hidden=list.length>0;
    clear.hidden=!query;
    grid.querySelectorAll('[data-donate]').forEach(card=>{
      card.onclick=()=>open(card.dataset.donate);
      card.onkeydown=event=>{
        if(['Enter',' '].includes(event.key)){
          event.preventDefault();
          open(card.dataset.donate);
        }
      };
    });
  }

  const detail=(label,value)=>value?`<div><span><small>${esc(label)}</small><strong>${esc(value)}</strong></span><button type="button" data-copy="${esc(value)}" aria-label="Copy ${esc(label)}">Copy</button></div>`:'';
  function open(reference){
    selected=all.find(item=>item.reference===reference);
    if(!selected)return;
    const bank=selected.donationBankDetails;
    document.querySelector('#donation-modal-title').textContent=selected.name;
    document.querySelector('#donation-message').textContent=bank.message||`JazakAllahu Khairan for supporting ${selected.name}.`;
    document.querySelector('#donation-bank-details').innerHTML=detail('Account name',bank.accountName)+detail('Bank',bank.bankName)+detail('Sort code',bank.sortCode)+detail('Account number',bank.accountNumber)+detail('IBAN',bank.iban)+detail('Payment reference',bank.reference);
    modal.hidden=false;
    document.body.classList.add('modal-open');
    document.querySelector('#close-donation-modal').focus();
  }
  function close(){
    modal.hidden=true;
    document.body.classList.remove('modal-open');
    selected=null;
  }

  document.querySelector('#donation-bank-details').onclick=async event=>{
    const button=event.target.closest('[data-copy]');
    if(!button)return;
    try{
      await navigator.clipboard.writeText(button.dataset.copy);
    }catch(_){
      const area=document.createElement('textarea');
      area.value=button.dataset.copy;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    const row=button.closest('div');
    button.textContent='✓ Copied';
    button.classList.add('copy-confirmed');
    row?.classList.add('copy-row-confirmed');
    const toast=document.querySelector('#copy-toast');
    toast.textContent='Copied';
    toast.hidden=false;
    setTimeout(()=>{
      button.textContent='Copy';
      button.classList.remove('copy-confirmed');
      row?.classList.remove('copy-row-confirmed');
      toast.hidden=true;
    },1800);
  };
  search.oninput=render;
  clear.onclick=()=>{search.value='';render();search.focus();};
  document.querySelector('#close-donation-modal').onclick=document.querySelector('#close-donation-footer').onclick=close;
  modal.onclick=event=>{if(event.target===modal)close();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)close();});
  render();
  const initial=new URLSearchParams(location.search).get('masjid');
  if(initial)open(initial);
})();
