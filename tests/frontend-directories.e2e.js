// The three standalone public directories: masjids, businesses and masjid shops. Each must be
// reachable from the nav, list exactly what the data supports, and filter without reloading.
const {spawn}=require('child_process'),path=require('path'),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',port=9860,base=process.env.MASJIDPOINT_URL||'http://127.0.0.1:4174';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
let ws,browser,id=0,pending=new Map(),exceptions=[];
async function connect(){for(let i=0;i<60;i++){try{const t=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result)}};return}}catch{}await sleep(200)}throw Error('Edge unavailable')}
const cdp=(method,params={})=>new Promise(res=>{pending.set(++id,res);ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser error');return r.result.value}
const go=async(u,ms=3200)=>{exceptions=[];await cdp('Page.navigate',{url:u});await sleep(ms)};
const state=()=>fetch(`${base}/api/state`).then(r=>r.json());
globalThis.ShopFulfilment=require('../lib/shop-fulfilment');
const D=require('../lib/directory-data.js');

(async()=>{
 const db=await state();
 const mosques=D.operationalMosques(db);
 const adverts=D.liveAdverts(db);
 const products=D.sellableProducts(db);
 const pricing=db.masjidPointMasjidPricing||[];
 const expectedShops=mosques.filter(m=>{
   const stock=products.filter(p=>(p.mosques||[]).some(x=>x.reference===m.reference));
   const rate=pricing.find(p=>p.masjidReference===m.reference||p.masjidName===m.name);
   return stock.length&&ShopFulfilment.enabledFor(rate).length;
 });
 assert(mosques.length&&adverts.length&&expectedShops.length,'Seed must provide masjids, adverts and shops');
 const detailMosque=expectedShops[0];
 const detailProduct=products.find(p=>(p.mosques||[]).some(x=>x.reference===detailMosque.reference));

 browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(__dirname,'.dir-edge-'+Date.now())}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
 await connect();await cdp('Page.enable');await cdp('Runtime.enable');

 // 1. Every public page renders the one shared header, with the same links in the same order.
 const PUBLIC=['index.html','masjids.html','businesses.html','shops.html','public-jobs.html','advertise.html',
   'register-masjid.html','status.html','signup.html','login.html','candidate-apply.html','activate.html',
   'forgot-password.html','reset-password.html',
   `masjid-shop.html?reference=${encodeURIComponent(mosques[0].reference)}`,
   `masjid-product.html?reference=${encodeURIComponent(detailMosque.reference)}&product=${encodeURIComponent(detailProduct.id)}`,
   `masjid-adverts.html?reference=${encodeURIComponent(mosques[0].reference)}`];
 const shapes=new Set();
 for(const page of PUBLIC){
   await go(`${base}/${page}`,2400);
   const header=await ev(`(()=>{const h=document.querySelector('.site-nav');if(!h)return null;return JSON.stringify({links:[...h.querySelectorAll('.site-nav-links a')].map(a=>a.textContent+'>'+a.getAttribute('href')),actions:[...h.querySelectorAll('.site-nav-actions a')].map(a=>a.textContent)})})()`);
   assert(header,`${page} does not render the shared header`);
   assert(!exceptions.length,`${page} raised: ${exceptions.join(', ')}`);
   shapes.add(header);
 }
 assert(shapes.size===1,`The header differs between pages (${shapes.size} variants):\n${[...shapes].join('\n')}`);
 const nav=JSON.parse([...shapes][0]).links.map(l=>l.split('>')[1]);
 assert(nav.includes('masjids')&&nav.includes('businesses'),`Nav is missing a directory: ${nav.join(', ')}`);
 assert(nav.includes('shops'),`Nav "Masjid Shop" still scrolls instead of opening a page: ${nav.join(', ')}`);

 // The shop still gets its basket, added into the shared header rather than a bespoke one.
 await go(`${base}/masjid-shop.html?reference=${encodeURIComponent(expectedShops[0].reference)}`,3000);
 assert(await ev(`!!document.querySelector('.site-nav #open-cart')&&!!document.querySelector('#cart-count')`),'Shop basket is missing from the shared header');

 // Wide catalogues use three balanced columns and every card opens a product-detail page that
 // writes to the exact same mosque-specific cart as checkout.
 await cdp('Emulation.setDeviceMetricsOverride',{width:1536,height:864,deviceScaleFactor:1,mobile:false});
 const shopLayout=await ev(`(()=>{const grid=document.querySelector('#public-products');const href=grid.querySelector('.product-media')?.getAttribute('href');return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,href}})()`);
 assert(shopLayout.columns===3,`Wide mosque shop uses ${shopLayout.columns} columns, expected 3`);
 assert(shopLayout.href?.startsWith('masjid-product?reference='),`Product card links to ${shopLayout.href}`);
 await go(`${base}/${shopLayout.href}`,3000);
 const detail=await ev(`({visible:!document.querySelector('#product-detail').hidden,name:document.querySelector('#product-name').textContent,mosque:document.querySelector('#product-mosque').textContent,cart:document.querySelector('#detail-cart-count').textContent})`);
 assert(detail.visible&&detail.name===detailProduct.name,`Product detail shows ${detail.name}, expected ${detailProduct.name}`);
 assert(detail.mosque===detailMosque.name,`Product detail belongs to ${detail.mosque}, expected ${detailMosque.name}`);
 await ev(`(()=>{document.querySelector('#product-quantity').value='2';document.querySelector('#detail-add').click()})()`);await sleep(250);
 assert(Number(await ev(`document.querySelector('#detail-cart-count').textContent`))===Math.min(2,detailProduct.stock),'Product detail did not add the selected quantity to the shared cart');

 // 2. Masjid directory lists every operational masjid and filters by city and area.
 await go(`${base}/masjids.html`);
 assert(!exceptions.length,`Masjid directory raised: ${exceptions.join(', ')}`);
 const m=await ev(`({tiles:document.querySelectorAll('.masjid-tile').length,cities:document.querySelector('#city-filter').options.length-1,areas:document.querySelector('#area-filter').options.length-1,hasSearch:!!document.querySelector('#masjid-search')})`);
 assert(m.tiles===mosques.length,`Masjid directory shows ${m.tiles}, expected ${mosques.length}`);
 assert(m.hasSearch&&m.cities>0&&m.areas>0,'Masjid directory is missing its search or filters');
 const city=await ev(`document.querySelector('#city-filter').options[1].value`);
 const expectInCity=mosques.filter(x=>D.cityOf(x)===city).length;
 await ev(`(()=>{const s=document.querySelector('#city-filter');s.value=${JSON.stringify(city)};s.dispatchEvent(new Event('change'))})()`);await sleep(400);
 const afterCity=await ev(`document.querySelectorAll('.masjid-tile').length`);
 assert(afterCity===expectInCity,`City "${city}" showed ${afterCity}, expected ${expectInCity}`);
 // Search narrows to a single named masjid.
 await ev(`document.querySelector('#clear-filters').click()`);await sleep(300);
 const one=mosques[0].name;
 await ev(`(()=>{const s=document.querySelector('#masjid-search');s.value=${JSON.stringify(one)};s.dispatchEvent(new Event('input'))})()`);await sleep(400);
 assert(await ev(`document.querySelectorAll('.masjid-tile').length`)>=1,'Search for a known masjid returned nothing');
 // A tile opens that masjid's own directory page.
 const href=await ev(`document.querySelector('.masjid-tile').getAttribute('href')`);
 assert(href.startsWith('masjid-adverts?reference='),`Masjid tile links to ${href}`);

 // A paid business must remain visible on the mosque page at laptop width. This guards against
 // dynamic reveal styles hiding the card after it has been rendered.
 const withAdverts=mosques.find(mq=>adverts.some(a=>a.masjidReference===mq.reference||a.masjid===mq.name));
 if(withAdverts){
   const expected=adverts.filter(a=>a.masjidReference===withAdverts.reference||a.masjid===withAdverts.name).length;
   await cdp('Emulation.setDeviceMetricsOverride',{width:1536,height:864,deviceScaleFactor:1,mobile:false});
   await go(`${base}/masjid-adverts.html?reference=${encodeURIComponent(withAdverts.reference)}`,4200);
   const cards=await ev(`[...document.querySelectorAll('#advert-grid .advert-card')].map(card=>({display:getComputedStyle(card).display,opacity:getComputedStyle(card).opacity}))`);
   assert(cards.length===expected,`Laptop mosque page shows ${cards.length} businesses, expected ${expected}`);
   assert(cards.every(card=>card.display!=='none'&&card.opacity==='1'),'A laptop business card is rendered but hidden');
 }

 // 2b. "View role" on a masjid page must open that job's details with a working apply route,
 // not drop the visitor on the unfiltered jobs list.
 const withJobs=mosques.find(mq=>(db.masjidPointJobs||[]).some(j=>j.status==='live'&&j.enabled
   &&(j.masjids||[]).some(x=>(x.reference===mq.reference||x.name===mq.name)&&x.paymentStatus==='paid')));
 if(withJobs){
   await go(`${base}/masjid-adverts.html?reference=${encodeURIComponent(withJobs.reference)}`,3000);
   const roleLink=await ev(`document.querySelector('.advert-job a.button')?.getAttribute('href')`);
   assert(roleLink&&roleLink.startsWith('public-jobs?job='),`View role links to ${roleLink}`);
   const wantedId=decodeURIComponent(roleLink.split('job=')[1]);
   await go(`${base}/${roleLink}`,3000);
   const detail=await ev(`({open:document.querySelector('#public-job-drawer')?.classList.contains('open'),reference:document.querySelector('#public-job-details')?.textContent||'',apply:document.querySelector('#apply-job')?.getAttribute('href')})`);
   assert(detail.open,'View role did not open the job details');
   assert(detail.reference.includes(wantedId),`Job details show the wrong role (expected ${wantedId})`);
   assert(detail.apply===`candidate-apply?job=${encodeURIComponent(wantedId)}`,`Apply button points at ${detail.apply}`);
   assert(!exceptions.length,`Job details raised: ${exceptions.join(', ')}`);
   // And the apply route must reach a real application form for that job.
   await go(`${base}/${detail.apply}`,2800);
   const form=await ev(`({form:!!document.querySelector('form'),jobId:document.querySelector('[name=jobId]')?.value,fields:[...document.querySelectorAll('form [name]')].map(f=>f.name)})`);
   assert(form.form&&form.fields.includes('fullName')&&form.fields.includes('cv'),'Application form is incomplete');
   assert(form.jobId===wantedId,`Application form is for ${form.jobId}, expected ${wantedId}`);
 }

 // 3. Business directory lists every live advert and filters by category and masjid.
 await go(`${base}/businesses.html`);
 assert(!exceptions.length,`Business directory raised: ${exceptions.join(', ')}`);
 const b=await ev(`({tiles:document.querySelectorAll('.business-tile').length,cats:document.querySelector('#category-filter').options.length-1,cities:document.querySelector('#city-filter').options.length-1,masjids:document.querySelector('#masjid-filter').options.length-1,hasSearch:!!document.querySelector('#business-search')})`);
 assert(b.tiles===adverts.length,`Business directory shows ${b.tiles}, expected ${adverts.length}`);
 assert(b.hasSearch&&b.cats>0&&b.cities>0&&b.masjids>0,'Business directory is missing its search or filters');
 const cat=await ev(`document.querySelector('#category-filter').options[1].value`);
 const expectInCat=adverts.filter(a=>a.category===cat).length;
 await ev(`(()=>{const s=document.querySelector('#category-filter');s.value=${JSON.stringify(cat)};s.dispatchEvent(new Event('change'))})()`);await sleep(400);
 const afterCat=await ev(`document.querySelectorAll('.business-tile').length`);
 assert(afterCat===expectInCat,`Category "${cat}" showed ${afterCat}, expected ${expectInCat}`);

 // 4. Shop directory lists only masjids that can actually sell, with city/area/masjid filters.
 await go(`${base}/shops.html`);
 assert(!exceptions.length,`Shop directory raised: ${exceptions.join(', ')}`);
 const s=await ev(`({tiles:document.querySelectorAll('.shop-tile').length,filters:[...document.querySelectorAll('.directory-filters select')].map(x=>x.id),hasSearch:!!document.querySelector('#shop-search')})`);
 assert(s.tiles===expectedShops.length,`Shop directory shows ${s.tiles}, expected ${expectedShops.length}`);
 assert(s.hasSearch,'Shop directory has no search box');
 for(const required of ['city-filter','area-filter','masjid-filter'])
   assert(s.filters.includes(required),`Shop directory is missing the ${required.replace('-filter','')} filter`);
 // Delivery filter must only keep shops that actually deliver.
 const expectDelivery=expectedShops.filter(mq=>{
   const rate=pricing.find(p=>p.masjidReference===mq.reference||p.masjidName===mq.name);
   return ShopFulfilment.enabledFor(rate).some(x=>x.key==='delivery');
 }).length;
 await ev(`(()=>{const x=document.querySelector('#method-filter');x.value='delivery';x.dispatchEvent(new Event('change'))})()`);await sleep(400);
 const afterDelivery=await ev(`document.querySelectorAll('.shop-tile').length`);
 assert(afterDelivery===expectDelivery,`Delivery filter showed ${afterDelivery}, expected ${expectDelivery}`);
 // Every tile opens a real shop.
 await ev(`document.querySelector('#clear-filters').click()`);await sleep(300);
 const shopHref=await ev(`document.querySelector('.shop-tile').getAttribute('href')`);
 assert(shopHref.startsWith('masjid-shop?reference='),`Shop tile links to ${shopHref}`);

 console.log(JSON.stringify({passed:true,masjids:mosques.length,businesses:adverts.length,shops:expectedShops.length,checks:['one shared header on every public page','nav opens real pages','shop basket lives in the shared header','masjid directory lists all','masjid city filter','masjid search','masjid tile opens its page','view role opens job details','apply button reaches the application form','business directory lists all','business category filter','shop directory lists sellable shops','shop city/area/masjid filters present','shop delivery filter','shop tile opens the shop']},null,2));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>{try{ws?.close()}catch{}try{browser?.kill()}catch{}});
