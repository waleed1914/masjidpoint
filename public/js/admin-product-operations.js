(function(){
  document.addEventListener('click',async event=>{
    const toggle=event.target.closest('[data-toggle-product]'),advance=event.target.closest('[data-order-next]');
    if(!toggle&&!advance)return;
    event.preventDefault();event.stopImmediatePropagation();
    const button=toggle||advance;button.disabled=true;
    const url=toggle?'/api/admin/product':'/api/order/advance',payload=toggle?{id:toggle.dataset.toggleProduct,action:'toggle'}:{id:advance.dataset.orderNext};
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await response.json();
    if(!response.ok){button.disabled=false;return alert(result.error||'The action could not be completed.');}
    location.reload();
  },true);
})();
