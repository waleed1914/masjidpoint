const ADMIN_PASSWORD = require('../scripts/seed-demo-data.js').ADMIN_PASSWORD;
const {spawn}=require('child_process'),path=require('path'),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',port=9944,base='http://127.0.0.1:4174';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
let ws,browser,id=0,pending=new Map(),exceptions=[];
async function connect(){for(let i=0;i<60;i++){try{const t=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result)}};return}}catch{}await sleep(200)}throw Error('Edge unavailable')}
const cdp=(method,params={})=>new Promise(res=>{pending.set(++id,res);ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser error');return r.result.value}
const go=async(u,ms=3400)=>{exceptions=[];await cdp('Page.navigate',{url:u});await sleep(ms)};
const state=()=>fetch(`${base}/api/state`).then(r=>r.json());

globalThis.ShopFulfilment=require('../lib/shop-fulfilment');
const Register=require('../lib/settlement-register');

(async()=>{
 let db=await state();
 // This suite settles and remits everything it finds, so it seeds its own two-direction
 // fixture rather than depending on whatever another suite happened to leave behind.
 const run=Date.now().toString().slice(-6);
 const mosque=(db.masjidPointAdminApplications||[]).find(app=>app.type==='masjid'&&['approved','activated'].includes(app.status)
   &&(db.masjidPointProducts||[]).some(p=>(p.mosques||[]).some(m=>m.reference===app.reference)));
 assert(mosque,'No approved mosque with assigned products is available');
 const product=(db.masjidPointProducts||[]).find(p=>(p.mosques||[]).some(m=>m.reference===mosque.reference));
 const line=quantity=>({productId:product.id,name:product.name,description:product.description,image:product.image,quantity,price:Number(product.price),mosqueSharePercent:Number(product.mosqueSharePercent||0),mosqueRevenue:Number((Number(product.price)*quantity*Number(product.mosqueSharePercent||0)/100).toFixed(2))});
 const base_order=(id,items,extra)=>({id,customer:{name:`Settlement Fixture ${run}`,email:`settlement.${run}@example.test`,phone:'07700 900000'},collectionMasjidReference:mosque.reference,collectionMasjidName:mosque.name,items,goodsTotal:Number(items.reduce((s,i)=>s+i.price*i.quantity,0).toFixed(2)),deliveryFee:0,total:Number(items.reduce((s,i)=>s+i.price*i.quantity,0).toFixed(2)),mosqueRevenue:Number(items.reduce((s,i)=>s+i.mosqueRevenue,0).toFixed(2)),status:'delivered',placedAt:new Date().toISOString(),history:[],...extra});
 const bankItems=[line(1)],cashItems=[line(2)];
 const cashTotal=Number(cashItems.reduce((s,i)=>s+i.price*i.quantity,0).toFixed(2));
 const cashShare=Number(cashItems.reduce((s,i)=>s+i.mosqueRevenue,0).toFixed(2));
 const orders=db.masjidPointShopOrders||[];
 orders.push(base_order(`ORD-SETTLE-BANK-${run}`,bankItems,{fulfilmentMethod:'collect_pay_now',paymentStatus:'paid',paymentReference:`SET-BANK-${run}`}));
 orders.push(base_order(`ORD-SETTLE-CASH-${run}`,cashItems,{fulfilmentMethod:'collect_pay_at_mosque',paymentStatus:'paid',cashTakenAtMosque:cashTotal,mosqueOwesAdmin:Number((cashTotal-cashShare).toFixed(2))}));
 await fetch(`${base}/api/collection/masjidPointShopOrders`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Settlement test'},body:JSON.stringify(orders)});
 db=await state();

 // A mosque that both earned shop revenue and took cash exercises both directions.
 const target=Register.build(db).find(entry=>entry.masjid===mosque.name);
 assert(target&&target.owedToPlatform>0&&target.fromShop>0,`Fixture did not create both directions for ${mosque.name}: owed ${target?.owedToMosque}, cash ${target?.owedToPlatform}`);

 // Shop revenue must be part of what settlement pays out, not just listings.
 assert(target.owedToMosque>target.fromListings,'Shop revenue is missing from the amount owed to the mosque');

 browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(__dirname,'.settle-edge-'+Date.now())}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
 await connect();await cdp('Page.enable');await cdp('Runtime.enable');
 await go(`${base}/admin-login.html`,1700);
 if(await ev(`!!document.querySelector('#admin-email')`)){await ev(`document.querySelector('#admin-email').value='admin@masjidpoint.co.uk';document.querySelector('#admin-password').value=${JSON.stringify(ADMIN_PASSWORD)};document.querySelector('#admin-login-form').requestSubmit()`);await sleep(2000)}

 // 1. Net mode shows one figure and the correct direction.
 await go(`${base}/admin-payments.html#settlements`,3600);
 assert(!exceptions.length,`Payments page raised: ${exceptions.join(', ')}`);
 await ev(`document.querySelector('[data-mode="net"]').click()`);await sleep(600);
 const card=name=>`[...document.querySelectorAll('.settlement-card')].find(c=>c.querySelector('h3').textContent===${JSON.stringify(name)})`;
 const net=await ev(`(()=>{const c=${card(target.masjid)};return{direction:c.querySelector('.settlement-direction')?.textContent,value:c.querySelector('.settlement-net')?.textContent,netButtons:c.querySelectorAll('[data-settle-net]').length,grossButtons:c.querySelectorAll('[data-settle],[data-remit]').length}})()`);
 const expectDirection=target.net<0?'Mosque owes MasjidPoint':target.net>0?'MasjidPoint owes mosque':'Settled up';
 assert(net.direction===expectDirection,`Net direction is "${net.direction}", expected "${expectDirection}"`);
 assert(net.value===`£${Math.abs(target.net).toFixed(2)}`,`Net figure is ${net.value}, expected £${Math.abs(target.net).toFixed(2)}`);
 // Net mode must offer exactly one action, and never the gross ones.
 assert(net.netButtons===1&&net.grossButtons===0,`Net mode showed ${net.netButtons} net and ${net.grossButtons} gross actions`);

 // 2. Both-directions mode shows the two flows separately, unnetted.
 await ev(`document.querySelector('[data-mode="separate"]').click()`);await sleep(600);
 const separate=await ev(`(()=>{const c=${card(target.masjid)};const cols=[...c.querySelectorAll('.settlement-directions>div')];return{out:cols[0]?.querySelector('strong')?.textContent,in:cols[1]?.querySelector('strong')?.textContent,settle:!!c.querySelector('[data-settle]'),remit:!!c.querySelector('[data-remit]'),shopLine:[...c.querySelectorAll('.settlement-breakdown div')].map(d=>d.textContent).join(' | ')}})()`);
 assert(separate.out===`£${target.owedToMosque.toFixed(2)}`,`Owed-to-mosque shows ${separate.out}, expected £${target.owedToMosque.toFixed(2)}`);
 assert(separate.in===`£${target.owedToPlatform.toFixed(2)}`,`Owed-to-platform shows ${separate.in}, expected £${target.owedToPlatform.toFixed(2)}`);
 assert(separate.settle&&separate.remit,'Both-directions mode must offer both actions');
 assert(separate.shopLine.includes('Mosque shop shares'),'Breakdown does not separate shop revenue');

 // 3. The header stat agrees with the panel it sits above.
 const stat=await ev(`document.querySelector('#masjid-due-total').textContent`);
 const totals=Register.totals(Register.build(db));
 assert(stat===`£${totals.owedToMosques.toFixed(2)}`,`Header stat ${stat} disagrees with the panel total £${totals.owedToMosques.toFixed(2)}`);

 // 4. Net mode offers one action whose label matches the net figure, not the gross.
 await ev(`document.querySelector('[data-mode="net"]').click()`);await sleep(600);
 const netAction=await ev(`(()=>{const c=${card(target.masjid)},b=c.querySelector('[data-settle-net]');return{label:b?.textContent.trim(),offset:c.querySelector('.settlement-offset')?.textContent}})()`);
 assert(netAction.label?.includes(`£${Math.abs(target.net).toFixed(2)}`),`Net button says "${netAction.label}", expected the net £${Math.abs(target.net).toFixed(2)}`);
 assert(netAction.offset?.includes(`£${target.owedToMosque.toFixed(2)}`)&&netAction.offset.includes(`£${target.owedToPlatform.toFixed(2)}`),'Net button does not explain what it offsets');

 // 5. Recording cash received clears exactly those orders and nothing else.
 const cashOrders=Register.cashHeld(db,target.masjid).map(item=>item.id);
 const remit=await fetch(`${base}/api/mosque-cash/remit`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Name':'Settlement test'},body:JSON.stringify({masjid:target.masjid,transactionReference:`CASH-TEST-${Date.now()}`,note:'Automated settlement test'})}).then(r=>r.json());
 assert(remit.ok&&Number(remit.amount)===target.owedToPlatform,`Remittance recorded ${remit.amount}, expected ${target.owedToPlatform}`);
 assert(remit.orders===cashOrders.length,`Remittance cleared ${remit.orders} orders, expected ${cashOrders.length}`);
 db=await state();
 const afterRemit=Register.position(db,target.masjid);
 assert(afterRemit.owedToPlatform===0,'Cash owed did not clear after remittance');
 assert(afterRemit.owedToMosque===target.owedToMosque,'Remittance wrongly changed what is owed to the mosque');
 const remitted=(db.masjidPointFinance.cashRemittances||[]).find(r=>r.amount===target.owedToPlatform&&r.masjid===target.masjid);
 assert(remitted&&remitted.orderIds.length===cashOrders.length,'Remittance was not recorded against its orders');
 assert((db.masjidPointFinance.audit||[]).some(x=>x.action==='cash.remitted'&&x.entityId===target.masjid),'Cash remittance was not audited');

 // 5. Remitting twice must not double count.
 const again=await fetch(`${base}/api/mosque-cash/remit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masjid:target.masjid,transactionReference:'CASH-TEST-DUPLICATE'})});
 assert(again.status===400,'A second remittance with nothing owed should be rejected');

 // 6. Settling pays out listings and shop shares together, then leaves nothing due.
 const settle=await fetch(`${base}/api/settle`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Name':'Settlement test'},body:JSON.stringify({masjid:target.masjid,transactionReference:`SET-TEST-${Date.now()}`,note:'Automated settlement test'})}).then(r=>r.json());
 assert(settle.ok!==false,`Settlement failed: ${settle.error||'unknown'}`);
 db=await state();
 const afterSettle=Register.position(db,target.masjid);
 assert(afterSettle.owedToMosque===0,`Settlement left £${afterSettle.owedToMosque} owed to the mosque`);
 const history=db.masjidPointFinance.settlementHistory||[];
 assert(history.some(s=>s.orderId&&s.masjid===target.masjid),'Shop order shares were not recorded in settlement history');

 // 9. A net settlement clears both directions in a single transfer.
 const netRun=`${run}N`;
 const netOrders=db.masjidPointShopOrders;
 netOrders.push(base_order(`ORD-NET-BANK-${netRun}`,[line(1)],{fulfilmentMethod:'collect_pay_now',paymentStatus:'paid',paymentReference:`NET-BANK-${netRun}`}));
 netOrders.push(base_order(`ORD-NET-CASH-${netRun}`,[line(2)],{fulfilmentMethod:'collect_pay_at_mosque',paymentStatus:'paid',cashTakenAtMosque:cashTotal,mosqueOwesAdmin:Number((cashTotal-cashShare).toFixed(2))}));
 await fetch(`${base}/api/collection/masjidPointShopOrders`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Settlement test'},body:JSON.stringify(netOrders)});
 db=await state();
 const before=Register.position(db,target.masjid);
 assert(before.owedToMosque>0&&before.owedToPlatform>0,'Net fixture did not create both directions');
 const netResult=await fetch(`${base}/api/settle/net`,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Name':'Settlement test'},body:JSON.stringify({masjid:target.masjid,transactionReference:`NET-${netRun}`,note:'Automated net settlement'})}).then(r=>r.json());
 assert(netResult.ok,`Net settlement failed: ${netResult.error||'unknown'}`);
 assert(Number(netResult.net)===Number((before.owedToMosque-before.owedToPlatform).toFixed(2)),`Net settled ${netResult.net}, expected ${(before.owedToMosque-before.owedToPlatform).toFixed(2)}`);
 db=await state();
 const afterNet=Register.position(db,target.masjid);
 assert(afterNet.owedToMosque===0&&afterNet.owedToPlatform===0,`Net settlement left ${afterNet.owedToMosque} out and ${afterNet.owedToPlatform} in`);
 assert((db.masjidPointFinance.audit||[]).some(x=>x.action==='settlement.net'&&x.entityId===target.masjid),'Net settlement was not audited');

 console.log(JSON.stringify({passed:true,mosque:target.masjid,fromListings:target.fromListings,fromShop:target.fromShop,owedToMosque:target.owedToMosque,cashHeld:target.owedToPlatform,net:target.net,checks:['shop revenue included in settlement','net mode direction and figure','both-directions mode unnetted','header stat matches panel','cash remittance clears its orders','remittance is audited','duplicate remittance rejected','settlement pays listings and shop together','net button matches the net figure','net settlement clears both directions']},null,2));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>{try{ws?.close()}catch{}try{browser?.kill()}catch{}});
