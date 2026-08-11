(function(){
  const session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null');
  if(!session||session.role!=='business'){
    location.replace(`login?return=${encodeURIComponent((location.pathname.split('/').pop()||'').replace(/\.html$/,'')+location.search)}`);
    return;
  }
  addEventListener('DOMContentLoaded',async()=>{
    const signout=document.querySelector('.business-signout');
    if(signout)signout.onclick=()=>sessionStorage.removeItem('masjidPointSession');
    const avatar=document.querySelector('.business-identity>span');
    if(!avatar)return;
    try{
      const response=await fetch('/api/state',{cache:'no-store',headers:{'X-MasjidPoint-Session':session.token||''}}),state=await response.json();
      const listing=(state.masjidPointBusinessRequests||[]).find(item=>item.reference===session.reference||item.businessReference===session.reference);
      if(!listing?.logo)return;
      const apply=()=>{
        if(avatar.querySelector('img'))return;
        avatar.textContent='';
        const image=document.createElement('img');
        image.src=`/api/business-logo?reference=${encodeURIComponent(listing.reference||session.reference)}&v=${encodeURIComponent(listing.logo.sha256||listing.logo.id||'1')}`;
        image.alt=`${listing.name||session.name||'Business'} logo`;
        avatar.appendChild(image);
      };
      apply();
      new MutationObserver(apply).observe(avatar,{childList:true,characterData:true,subtree:true});
    }catch(_){/* Keep initials when the logo is unavailable. */}
  });
})();
