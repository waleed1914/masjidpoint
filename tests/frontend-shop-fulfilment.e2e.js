const ADMIN_PASSWORD = require('../scripts/seed-demo-data.js').ADMIN_PASSWORD;
const {spawn}=require('child_process'),path=require('path'),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',port=9955,base='http://127.0.0.1:4174';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
let ws,browser,id=0,pending=new Map(),exceptions=[];
async function connect(){for(let i=0;i<60;i++){try{const t=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result)}};return}}catch{}await sleep(200)}throw Error('Edge unavailable')}
const cdp=(method,params={})=>new Promise(res=>{pending.set(++id,res);ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser error');return r.result.value}
const go=async(u,ms=2200)=>{exceptions=[];await cdp('Page.navigate',{url:u});await sleep(ms)};
const set=(name,value)=>ev(`(()=>{const e=document.querySelector('form [name=${JSON.stringify(name)}]');if(!e)throw Error('Missing ${name}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const accounts=require('./seed-accounts.js');
const state=()=>fetch(`${base}/api/state`).then(r=>r.json());
// An existing admin session sends admin-login.html straight to the dashboard, so only fill the form when it is there.
const adminLogin=async()=>{await go(`${base}/admin-login.html`,1500);if(await ev(`!!document.querySelector('#admin-email')`)){await ev(`document.querySelector('#admin-email').value='admin@masjidpoint.co.uk';document.querySelector('#admin-password').value=${JSON.stringify(ADMIN_PASSWORD)};document.querySelector('#admin-login-form').requestSubmit()`);await sleep(1800)}assert(/\/admin(?:\.html)?$/.test(await ev('location.pathname')),'Admin login failed')};

(async()=>{
 let db=await state();
 // A seeded mosque that is activated and has sellable stock.
 const seeded=accounts.shopMosque(db);
 assert(seeded,'No seeded mosque with stock and an activated account is available');
 const target=(db.masjidPointAdminApplications||[]).find(a=>a.reference===seeded.ref);
 const account={email:seeded.email,reference:seeded.ref};
 const mosquePassword=seeded.password;
 // This suite buys real stock and leaves orders behind, so restock first and tag this run's
 // customers uniquely — otherwise a repeat run silently matches the previous run's orders.
 const run=Date.now().toString().slice(-6);
 const deliveryEmail=`delivery.customer.${run}@example.test`,collectEmail=`collection.customer.${run}@example.test`;
 const products=db.masjidPointProducts||[];
 products.filter(p=>(p.mosques||[]).some(m=>m.reference===target.reference)).forEach(p=>{if(Number(p.stock)<5)p.stock=25});
 await fetch(`${base}/api/collection/masjidPointProducts`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Fulfilment test'},body:JSON.stringify(products)});
 browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(__dirname,'.shop-edge-'+Date.now())}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
 await connect();await cdp('Page.enable');await cdp('Runtime.enable');

 // 1. Admin turns on all three fulfilment options and sets this mosque's delivery charge.
 await adminLogin();
 await go(`${base}/admin-masjid-view.html?reference=${encodeURIComponent(target.reference)}`,3000);
 assert(await ev(`!!document.querySelector('#shop-fulfilment-form')`),'Shop fulfilment settings card is missing from the mosque profile');
 await ev(`(()=>{const f=document.querySelector('#shop-fulfilment-form');['collectPayNow','collectPayAtMosque','delivery'].forEach(n=>{f.elements[n].checked=true});f.dispatchEvent(new Event('input',{bubbles:true}));f.elements.shopDeliveryFee.value='4.50';f.requestSubmit()})()`);
 await sleep(1600);
 db=await state();
 const rate=(db.masjidPointMasjidPricing||[]).find(r=>r.masjidReference===target.reference);
 assert(rate.shopFulfilment.delivery===true&&Number(rate.shopDeliveryFee)===4.5,'Fulfilment options or delivery fee did not save');
 assert(!exceptions.length,`Mosque profile raised: ${exceptions.join(', ')}`);

 // 2. The public shop offers exactly the three enabled options.
 await go(`${base}/masjid-shop.html?reference=${encodeURIComponent(target.reference)}`,2600);
 const options=await ev(`[...document.querySelectorAll('[name=fulfilmentMethod]')].map(i=>i.value)`);
 assert(options.length===3&&options.includes('delivery')&&options.includes('collect_pay_at_mosque'),`Shop did not offer all three options: ${options.join(', ')}`);

 // 3. Delivery order: address is required and the mosque's fee lands on the total.
 await ev(`document.querySelector('[data-add]').click();document.querySelector('#open-cart').click()`);await sleep(500);
 const beforeFee=await ev(`document.querySelector('#cart-total').textContent`);
 await ev(`(()=>{const i=document.querySelector('[name=fulfilmentMethod][value=delivery]');i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(400);
 const delivery=await ev(`({addressShown:!document.querySelector('#delivery-address').hidden,required:document.querySelector('[name=line1]').required,total:document.querySelector('#cart-total').textContent,totals:document.querySelector('#checkout-totals').textContent})`);
 assert(delivery.addressShown&&delivery.required,'Delivery did not reveal or require the address');
 assert(delivery.total!==beforeFee&&delivery.totals.includes('4.50'),`Delivery fee missing from the total: ${delivery.total} / ${delivery.totals}`);
 await set('name','Delivery Test Customer');await set('email',deliveryEmail);await set('phone','07123 456789');
 await set('line1','12 Test Street');await set('city','Birmingham');await set('postcode','B12 0XS');
 await ev(`document.querySelector('#place-order').click()`);await sleep(2400);assert(await ev(`!document.querySelector('#order-success').hidden`),'Checkout did not confirm the order to the customer');
 db=await state();
 const deliveryOrder=[...(db.masjidPointShopOrders||[])].reverse().find(o=>o.customer?.email===deliveryEmail);
 assert(deliveryOrder,'Delivery order was not saved');
 assert(deliveryOrder.fulfilmentMethod==='delivery','Delivery order lost its fulfilment method');
 assert(Number(deliveryOrder.deliveryFee)===4.5,'Delivery fee was not stored on the order');
 assert(Number(deliveryOrder.total)===Number((deliveryOrder.goodsTotal+4.5).toFixed(2)),'Delivery order total excludes the fee');
 assert(deliveryOrder.deliveryAddress?.postcode==='B12 0XS','Delivery address was not captured');
 assert(deliveryOrder.paymentStatus==='awaiting_bank_transfer','Delivery order should owe a bank transfer');
 assert(deliveryOrder.invoiceNumber?.startsWith('SHP-'),'Delivery order has no shop invoice number');

 // 4. Pay-at-mosque order owes the mosque, not the bank.
 await go(`${base}/masjid-shop.html?reference=${encodeURIComponent(target.reference)}`,2600);
 await ev(`document.querySelector('[data-add]').click();document.querySelector('#open-cart').click()`);await sleep(500);
 await ev(`(()=>{const i=document.querySelector('[name=fulfilmentMethod][value=collect_pay_at_mosque]');i.checked=true;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(400);
 assert(await ev(`document.querySelector('#delivery-address').hidden`),'Address panel should stay hidden for collection');
 assert(await ev(`!document.querySelector('.customer-bank-card')||document.querySelector('.customer-bank-card').hidden`),'Bank details should be hidden when paying at the mosque');
 await set('name','Collection Test Customer');await set('email',collectEmail);await set('phone','07123 000111');
 await ev(`document.querySelector('#place-order').click()`);await sleep(2400);assert(await ev(`!document.querySelector('#order-success').hidden`),'Checkout did not confirm the order to the customer');
 db=await state();
 const collectOrder=[...(db.masjidPointShopOrders||[])].reverse().find(o=>o.customer?.email===collectEmail);
 assert(collectOrder,'Pay-at-mosque order was not saved');
 assert(collectOrder.fulfilmentMethod==='collect_pay_at_mosque'&&collectOrder.paymentStatus==='pay_at_mosque','Pay-at-mosque order has the wrong payment state');
 assert(Number(collectOrder.deliveryFee)===0,'Collection order should carry no delivery fee');

 // 5. Admin order desk is method-aware.
 await adminLogin();
 await go(`${base}/admin-masjid-products.html`,3200);
 await ev(`[...document.querySelectorAll('[data-shop-tab]')].find(b=>b.dataset.shopTab==='orders').click()`);await sleep(1400);
 const desk=await ev(`(()=>{const card=[...document.querySelectorAll('.shop-order-card')].find(c=>c.querySelector('header strong').textContent===${JSON.stringify(deliveryOrder.id)});const collect=[...document.querySelectorAll('.shop-order-card')].find(c=>c.querySelector('header strong').textContent===${JSON.stringify(collectOrder.id)});return{badge:card?.querySelector('.shop-method-badge')?.textContent,address:card?.querySelector('.shop-order-method small')?.textContent,invoice:card?.querySelector('.shop-invoice-link')?.getAttribute('href'),nextBlocked:card?.querySelector('[data-order-next]')?.disabled,collectBadge:collect?.querySelector('.shop-method-badge')?.textContent,collectVerify:!!collect?.querySelector('[data-shop-payment]'),collectNextBlocked:collect?.querySelector('[data-order-next]')?.disabled}})()`);
 assert(desk.badge==='Delivery','Admin card does not show the delivery badge');
 assert(desk.address?.includes('B12 0XS'),'Admin card does not show the delivery address');
 assert(desk.invoice?.includes('/api/shop/invoice.pdf'),'Admin card has no invoice link');
 assert(desk.nextBlocked===true,'Unpaid delivery order should be blocked from fulfilment');
 assert(desk.collectBadge==='Pay at mosque','Admin card does not show the pay-at-mosque badge');
 assert(desk.collectVerify===false,'Admin should not verify a payment the mosque collects');
 assert(desk.collectNextBlocked!==true,'Pay-at-mosque order should not be blocked from fulfilment');
 assert(!exceptions.length,`Admin order desk raised: ${exceptions.join(', ')}`);

 // 6. Delivery orders run ordered -> preparing -> dispatched -> delivered without the mosque.
 const orders=db.masjidPointShopOrders;
 orders.find(o=>o.id===deliveryOrder.id).paymentStatus='paid';
 await fetch(`${base}/api/collection/masjidPointShopOrders`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Fulfilment test'},body:JSON.stringify(orders)});
 await go(`${base}/admin-masjid-products.html`,3200);
 await ev(`[...document.querySelectorAll('[data-shop-tab]')].find(b=>b.dataset.shopTab==='orders').click()`);await sleep(1400);
 const chain=[];
 for(let step=0;step<3;step++){
   const button=await ev(`(()=>{const c=[...document.querySelectorAll('.shop-order-card')].find(x=>x.querySelector('header strong').textContent===${JSON.stringify(deliveryOrder.id)});const b=c?.querySelector('[data-order-next]');return b&&!b.disabled?b.textContent:null})()`);
   if(!button)break;
   chain.push(button);
   await ev(`[...document.querySelectorAll('.shop-order-card')].find(x=>x.querySelector('header strong').textContent===${JSON.stringify(deliveryOrder.id)}).querySelector('[data-order-next]').click()`);
   await sleep(1500);
 }
 assert(chain.join(' > ').includes('Mark dispatched'),`Delivery chain never offered dispatch: ${chain.join(' > ')}`);
 db=await state();
 assert(db.masjidPointShopOrders.find(o=>o.id===deliveryOrder.id).status==='delivered',`Delivery order did not reach delivered via admin (${chain.join(' > ')})`);

 // 7. The mosque sees both orders, including the delivery it never handled.
 await ev('sessionStorage.clear()');
 await go(`${base}/login.html?return=masjid-portal.html`,1800);
 await set('email',account.email);await set('password',mosquePassword);
 await ev(`document.querySelector('#login-form button[type=submit]').click()`);await sleep(2800);
 assert(/\/masjid-portal(?:\.html)?$/.test(await ev('location.pathname')),'Mosque login failed');
 await sleep(1200);
 const portal=await ev(`(()=>{const card=id=>[...document.querySelectorAll('.mosque-order')].find(a=>a.querySelector('header strong').textContent===id);const d=card(${JSON.stringify(deliveryOrder.id)}),c=card(${JSON.stringify(collectOrder.id)});return{deliverySeen:!!d,deliveryBuyer:d?.querySelector('.mosque-order-customer strong')?.textContent,deliveryBadge:d?.querySelector('.shop-method-badge')?.textContent,deliveryAction:!!d?.querySelector('[data-deliver-order],[data-collect-order]'),deliveryInvoice:d?.querySelector('.shop-invoice-link')?.getAttribute('href'),collectSeen:!!c,collectBuyer:c?.querySelector('.mosque-order-customer strong')?.textContent,collectBadge:c?.querySelector('.shop-method-badge')?.textContent,collectPayment:c?.querySelector('.mosque-order-method small')?.textContent}})()`);
 assert(portal.deliverySeen&&portal.deliveryBuyer==='Delivery Test Customer','Mosque cannot see who bought the delivery order');
 assert(portal.deliveryBadge==='Delivery','Mosque cannot see that the order was a delivery');
 assert(portal.deliveryAction===false,'Mosque should not action an admin-delivered order');
 assert(portal.deliveryInvoice?.includes('/api/shop/invoice.pdf'),'Mosque has no invoice link for the delivery order');
 assert(portal.collectSeen&&portal.collectBuyer==='Collection Test Customer','Mosque cannot see who bought the collection order');
 assert(portal.collectBadge==='Pay at mosque'&&portal.collectPayment?.includes('Payable at the mosque'),'Mosque cannot see the payment method');
 assert(!exceptions.length,`Mosque portal raised: ${exceptions.join(', ')}`);

 // 8. Taking cash tells the mosque what it owes MasjidPoint, and records it.
 const orderList=db.masjidPointShopOrders;
 orderList.find(o=>o.id===collectOrder.id).status='mosque_received';
 await fetch(`${base}/api/collection/masjidPointShopOrders`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Fulfilment test'},body:JSON.stringify(orderList)});
 await go(`${base}/masjid-portal.html`,3000);
 const owedBefore=await ev(`(()=>{const b=document.querySelector('.cash-owed-banner strong');return b?Number(b.textContent.replace(/[^0-9.]/g,'')):0})()`);
 await ev(`[...document.querySelectorAll('.mosque-order')].find(a=>a.querySelector('header strong').textContent===${JSON.stringify(collectOrder.id)}).querySelector('[data-collect-order]').click()`);
 await sleep(700);
 const cash=await ev(`(()=>{const m=document.querySelector('.cash-handover-modal');if(!m)return null;const rows=[...m.querySelectorAll('.cash-breakdown>div')].map(r=>({label:r.querySelector('small').textContent,value:r.querySelector('strong').textContent}));return{rows,confirm:m.querySelector('[data-cash-confirm]').textContent}})()`);
 assert(cash,'Cash handover did not open a breakdown');
 const expectedOwed=Number((collectOrder.total-collectOrder.mosqueRevenue).toFixed(2));
 assert(cash.rows[0].value===`£${collectOrder.total.toFixed(2)}`&&cash.rows[0].label.toLowerCase().includes('cash to take'),`Cash to take is wrong: ${JSON.stringify(cash.rows[0])}`);
 assert(cash.rows[1].value===`£${Number(collectOrder.mosqueRevenue).toFixed(2)}`,`Mosque keeps is wrong: ${JSON.stringify(cash.rows[1])}`);
 assert(cash.rows[2].label.toLowerCase().includes('owe masjidpoint')&&cash.rows[2].value===`£${expectedOwed.toFixed(2)}`,`Owed to MasjidPoint is wrong: ${JSON.stringify(cash.rows[2])}`);
 await ev(`document.querySelector('[data-cash-confirm]').click()`);await sleep(2200);
 db=await state();
 const settled=db.masjidPointShopOrders.find(o=>o.id===collectOrder.id);
 assert(settled.paymentStatus==='paid'&&settled.status==='delivered','Cash handover did not complete the order');
 assert(Number(settled.mosqueOwesAdmin)===expectedOwed&&Number(settled.cashTakenAtMosque)===Number(collectOrder.total),'Cash owed was not recorded on the order');
 await go(`${base}/masjid-portal.html`,3000);
 // The banner is a running total across every cash order, so check it grew by this one.
 const owedAfter=await ev(`(()=>{const b=document.querySelector('.cash-owed-banner strong');return b?Number(b.textContent.replace(/[^0-9.]/g,'')):0})()`);
 assert(Number((owedAfter-owedBefore).toFixed(2))===expectedOwed,`Owed running total moved by ${(owedAfter-owedBefore).toFixed(2)}, expected ${expectedOwed.toFixed(2)}`);
 assert(!exceptions.length,`Cash handover raised: ${exceptions.join(', ')}`);

 // 9. The invoice PDF renders for a shop order.
 const pdf=await fetch(`${base}/api/shop/invoice.pdf?order=${encodeURIComponent(deliveryOrder.id)}`);
 const head=Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString();
 assert(pdf.status===200&&head==='%PDF-','Shop invoice PDF did not render');

 console.log(JSON.stringify({passed:true,mosque:target.name,deliveryFee:4.5,deliveryOrder:deliveryOrder.id,deliveryInvoice:deliveryOrder.invoiceNumber,collectionOrder:collectOrder.id,adminChain:chain,cashOwedToAdmin:Number((collectOrder.total-collectOrder.mosqueRevenue).toFixed(2)),checks:['per-mosque fulfilment settings','three options at checkout','delivery address required','delivery fee on total','pay-at-mosque owes the mosque','admin desk method-aware','delivery bypasses the mosque','mosque sees buyer and method','cash handover shows what the mosque owes','owed running total','shop invoice PDF']},null,2));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>{try{ws?.close()}catch{}try{browser?.kill()}catch{}});
