(function(){
  const session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null');
  if(!session||session.role!=='business'||(session.expiresAt&&Number(session.expiresAt)<=Date.now())){
    sessionStorage.removeItem('masjidPointSession');
    location.replace(`login?expired=1&return=${encodeURIComponent((location.pathname.split('/').pop()||'').replace(/\.html$/,'')+location.search)}`);
    return;
  }
  const initialise=async()=>{
    const signout=document.querySelector('.business-signout');
    if(signout)signout.onclick=()=>sessionStorage.removeItem('masjidPointSession');
    const avatar=document.querySelector('.business-identity>span');
    if(!avatar)return;
    try{
      const response=await fetch('/api/state',{cache:'no-store',headers:{'X-MasjidPoint-Session':session.token||''}}),state=await response.json();
      const listing=(state.masjidPointBusinessRequests||[]).find(item=>item.reference===session.reference||item.businessReference===session.reference);
      if(!listing?.logo)return;
      const apply=()=>{
        const source=`/api/business-logo?reference=${encodeURIComponent(listing.reference||session.reference)}&v=${encodeURIComponent(listing.logo.sha256||listing.logo.id||'1')}`;
        if(!avatar.querySelector('img')){avatar.textContent='';
        const image=document.createElement('img');
        image.src=source;
        image.alt=`${listing.name||session.name||'Business'} logo`;
        avatar.appendChild(image)}
        const profileLogo=document.querySelector('.profile-logo');
        if(profileLogo&&!profileLogo.querySelector('img')){profileLogo.textContent='';const image=document.createElement('img');image.src=source;image.alt=`${listing.name||session.name||'Business'} logo`;profileLogo.appendChild(image)}
        const completion=document.querySelector('.completion');
        if(completion){completion.querySelector('em').textContent='100%';completion.querySelector('i b').style.width='100%';completion.querySelector('small').textContent='Your business profile is complete.'}
      };
      apply();
      new MutationObserver(apply).observe(avatar,{childList:true,characterData:true,subtree:true});
    }catch(_){/* Keep initials when the logo is unavailable. */}
  };
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',initialise);else initialise();
})();
