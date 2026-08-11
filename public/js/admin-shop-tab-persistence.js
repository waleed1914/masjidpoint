(function(){
  const tabs=document.querySelector('.shop-tabs');if(!tabs)return;
  const allowed=['products','orders','revenue'];
  const key=`masjidPointAdminShopTab:${new URLSearchParams(location.search).get('reference')||'all'}`;
  const fromHash=location.hash.replace('#','');
  const wanted=allowed.includes(fromHash)?fromHash:(sessionStorage.getItem(key)||'products');
  function remember(name){if(!allowed.includes(name))return;sessionStorage.setItem(key,name);history.replaceState(null,'',`${location.pathname}${location.search}#${name}`)}
  tabs.addEventListener('click',event=>{const button=event.target.closest('[data-shop-tab]');if(button)remember(button.dataset.shopTab)},true);
  function restore(){const button=tabs.querySelector(`[data-shop-tab="${wanted}"]`);if(!button)return;button.click();remember(wanted)}
  MasjidDB.ready.then(()=>setTimeout(restore,0));
})();
