// Public-facing surface: home page, masjid directory, shop and jobs board. Everything here is
// what a community member sees without signing in, so the checks assert that nothing invented
// appears and every link resolves to real data.
const {spawn}=require('child_process'),path=require('path'),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',port=9810,base=process.env.MASJIDPOINT_URL||'http://127.0.0.1:4174';
const accounts=require('./seed-accounts.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
let ws,browser,id=0,pending=new Map(),exceptions=[];
async function connect(){for(let i=0;i<60;i++){try{const t=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result)}};return}}catch{}await sleep(200)}throw Error('Edge unavailable')}
const cdp=(method,params={})=>new Promise(res=>{pending.set(++id,res);ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser error');return r.result.value}
const go=async(u,ms=3000)=>{exceptions=[];await cdp('Page.navigate',{url:u});await sleep(ms)};
const state=()=>fetch(`${base}/api/state`).then(r=>r.json());

(async()=>{
 const db=await state();
 const operational=(db.masjidPointAdminApplications||[]).filter(a=>a.type==='masjid'&&['approved','activated'].includes(a.status));
 const liveAdverts=(db.masjidPointBusinessRequests||[]).filter(r=>r.status==='approved'&&r.paymentStatus==='paid'&&r.listing==='enabled');
 const liveJobs=(db.masjidPointJobs||[]).filter(j=>j.status==='live'&&j.enabled);
 const pendingMosque=(db.masjidPointAdminApplications||[]).find(a=>a.type==='masjid'&&a.status==='pending');
 const shopMosque=accounts.shopMosque(db);
 assert(operational.length&&liveAdverts.length&&liveJobs.length,'Seed must provide mosques, adverts and jobs');

 browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(__dirname,'.public-edge-'+Date.now())}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
 await connect();await cdp('Page.enable');await cdp('Runtime.enable');

 // 1. Home page is built from real records, not placeholders.
 await go(`${base}/index.html`,3400);
 assert(!exceptions.length,`Home raised: ${exceptions.join(', ')}`);
 const home=await ev(`({masjids:document.querySelectorAll('#masjid-grid .masjid-card').length,businesses:document.querySelectorAll('#business-grid .business-card').length,stats:{b:document.querySelector('#stat-businesses').textContent,m:document.querySelector('#stat-masjids').textContent,s:document.querySelector('#stat-support').textContent},chips:[...document.querySelectorAll('#category-chips .chip')].map(c=>c.dataset.category),filterOptions:[...document.querySelector('#masjid-filter').options].map(o=>o.value),jobPreview:document.querySelectorAll('#home-job-preview .job-card').length,externalImages:[...document.images].filter(i=>/^https?:/.test(i.getAttribute('src')||'')).length,deadLinks:[...document.querySelectorAll('a[href="#"]')].length})`);
 assert(home.masjids===operational.length,`Home shows ${home.masjids} masjids, expected ${operational.length}`);
 assert(home.businesses===liveAdverts.length,`Home shows ${home.businesses} businesses, expected ${liveAdverts.length}`);
 assert(home.stats.b===String(liveAdverts.length)&&home.stats.m===String(operational.length),`Hero counters are wrong: ${JSON.stringify(home.stats)}`);
 assert(home.stats.s.startsWith('£'),'Raised-for-masjids counter is not a money figure');
 assert(home.filterOptions.length===operational.length+1,'Masjid filter does not list every masjid');
 assert(home.chips.length>1,'Category chips were not derived from the listings');
 assert(home.jobPreview>0,'Home job preview is empty');
 assert(home.externalImages===0,`Home still loads ${home.externalImages} external images`);
 assert(home.deadLinks===0,`Home still has ${home.deadLinks} placeholder links`);

 // 2. Home filters actually narrow the directory.
 const oneCategory=home.chips.find(c=>c!=='all');
 const expectedInCategory=liveAdverts.filter(a=>a.category===oneCategory).length;
 await ev(`[...document.querySelectorAll('#category-chips .chip')].find(c=>c.dataset.category===${JSON.stringify(oneCategory)}).click()`);await sleep(400);
 const filtered=await ev(`[...document.querySelectorAll('#business-grid .business-card')].filter(c=>!c.hidden).length`);
 assert(filtered===expectedInCategory,`Category "${oneCategory}" showed ${filtered}, expected ${expectedInCategory}`);

 // 3. A masjid card opens that masjid's directory.
 await go(`${base}/index.html`,3200);
 const href=await ev(`document.querySelector('#masjid-grid .masjid-card').getAttribute('href')`);
 assert(href.startsWith('masjid-adverts?reference=MSJ-'),`Masjid card links to ${href}`);
 await go(`${base}/${href}`,3200);
 assert(!exceptions.length,`Masjid directory raised: ${exceptions.join(', ')}`);
 const ref=decodeURIComponent(href.split('reference=')[1]);
 const mosque=operational.find(m=>m.reference===ref);
 const expectedAdverts=liveAdverts.filter(a=>a.masjidReference===ref||a.masjid===mosque.name).length;
 const expectedJobs=liveJobs.filter(j=>(j.masjids||[]).some(m=>(m.reference===ref||m.name===mosque.name)&&m.paymentStatus==='paid')).length;
 const directory=await ev(`({name:document.querySelector('#masjid-name').textContent,adverts:document.querySelectorAll('.advert-card').length,jobs:document.querySelectorAll('.advert-job').length,stats:[...document.querySelectorAll('#adverts-stats strong')].map(s=>Number(s.textContent)),cta:document.querySelector('#cta-advertise').getAttribute('href'),shop:document.querySelector('#shop-link').getAttribute('href')})`);
 assert(directory.name===mosque.name,`Directory shows ${directory.name}, expected ${mosque.name}`);
 assert(directory.adverts===expectedAdverts,`Directory shows ${directory.adverts} adverts, expected ${expectedAdverts}`);
 assert(directory.jobs===expectedJobs,`Directory shows ${directory.jobs} jobs, expected ${expectedJobs}`);
 assert(directory.stats[0]===expectedAdverts&&directory.stats[1]===expectedJobs,'Directory counters disagree with its own lists');
 assert(directory.cta.includes(encodeURIComponent(ref)),'Advertise CTA does not preselect this masjid');

 // 4. The advertise form arrives with that masjid already chosen.
 await go(`${base}/${directory.cta}`,3000);
 const preselected=await ev(`(()=>{const i=document.querySelector('[name=masjid]:checked');return i?i.value:null})()`);
 assert(preselected===mosque.name,`Advertise form preselected ${preselected}, expected ${mosque.name}`);

 // 5. A masjid awaiting a decision must not be publicly reachable.
 if(pendingMosque){
   await go(`${base}/masjid-adverts.html?reference=${encodeURIComponent(pendingMosque.reference)}`,2800);
   const blocked=await ev(`({name:document.querySelector('#masjid-name').textContent,blocks:[...document.querySelectorAll('.adverts-block')].every(b=>b.hidden)})`);
   assert(blocked.name==='Masjid not found'&&blocked.blocks,'A pending masjid is publicly listed');
 }

 // 6. The shop shows only that masjid's sellable stock and its enabled methods.
 const rate=(db.masjidPointMasjidPricing||[]).find(p=>p.masjidReference===shopMosque.ref);
 const expectedProducts=(db.masjidPointProducts||[]).filter(p=>p.visibility!=='hidden'&&p.stock>0&&(p.mosques||[]).some(m=>m.reference===shopMosque.ref)).length;
 const expectedMethods=Object.entries(rate.shopFulfilment).filter(([,on])=>on).length;
 await go(`${base}/masjid-shop.html?reference=${encodeURIComponent(shopMosque.ref)}`,3200);
 assert(!exceptions.length,`Shop raised: ${exceptions.join(', ')}`);
 const shop=await ev(`({products:document.querySelectorAll('.public-product').length,methods:[...document.querySelectorAll('[name=fulfilmentMethod]')].map(i=>i.value),outOfStock:[...document.querySelectorAll('.public-product')].filter(c=>/(^|\\D)0 available/.test(c.textContent)).length,title:document.querySelector('#shop-masjid-name').textContent})`);
 assert(shop.products===expectedProducts,`Shop shows ${shop.products} products, expected ${expectedProducts}`);
 assert(shop.methods.length===expectedMethods,`Shop offers ${shop.methods.length} methods, expected ${expectedMethods}`);
 assert(shop.outOfStock===0,'Shop is offering an out-of-stock product');
 assert(shop.title.includes(shopMosque.name),'Shop header names the wrong masjid');

 // 7. The jobs board lists live roles only.
 await go(`${base}/public-jobs.html`,3000);
 assert(!exceptions.length,`Jobs board raised: ${exceptions.join(', ')}`);
 const board=await ev(`({rows:document.querySelectorAll('#public-job-list > *').length,count:document.querySelector('#hero-job-count')?.textContent})`);
 assert(board.rows===liveJobs.length,`Jobs board shows ${board.rows}, expected ${liveJobs.length}`);
 assert(String(board.count)===String(liveJobs.length),`Jobs counter says ${board.count}, expected ${liveJobs.length}`);

 console.log(JSON.stringify({passed:true,masjids:operational.length,adverts:liveAdverts.length,jobs:liveJobs.length,shopProducts:expectedProducts,checks:['home built from real records','no external images or dead links','category filter narrows directory','masjid card opens its directory','directory counts match its lists','advertise form preselects the masjid','pending masjid is not public','shop respects stock and methods','jobs board lists live roles only']},null,2));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>{try{ws?.close()}catch{}try{browser?.kill()}catch{}});
