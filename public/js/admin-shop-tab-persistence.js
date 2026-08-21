(function(){
  const tabs=document.querySelector('.shop-tabs');if(!tabs)return;
  const allowed=['products','orders','revenue'];
  const key=`masjidPointAdminShopTab:${new URLSearchParams(location.search).get('reference')||'all'}`;

  function requested(){
    const hash=location.hash.replace('#','');
    return allowed.includes(hash)?hash:(sessionStorage.getItem(key)||'products');
  }
  function show(name,updateUrl=true){
    if(!allowed.includes(name))name='products';
    tabs.querySelectorAll('[data-shop-tab]').forEach(button=>button.classList.toggle('active',button.dataset.shopTab===name));
    allowed.forEach(panel=>{const element=document.querySelector(`#${panel}-panel`);if(element)element.hidden=panel!==name});
    sessionStorage.setItem(key,name);
    if(updateUrl)history.replaceState(null,'',`${location.pathname}${location.search}#${name}`);
  }

  // Capture the choice before the page's own handler runs. Updating an order only redraws the
  // order list, so this outer workspace remains on Orders without a document reload.
  tabs.addEventListener('click',event=>{
    const button=event.target.closest('[data-shop-tab]');
    if(button)show(button.dataset.shopTab);
  },true);
  addEventListener('hashchange',()=>show(requested(),false));

  // Do not simulate a click here: this helper can load before the async shop controller has
  // attached its click handlers. Setting the panels directly removes that timing race.
  show(requested());
  MasjidDB.ready.then(()=>show(requested()));
})();
