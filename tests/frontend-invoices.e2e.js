const {spawn}=require('child_process'),path=require('path'),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',port=9933,base='http://127.0.0.1:4174';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
let ws,browser,id=0,pending=new Map(),exceptions=[];
async function connect(){for(let i=0;i<60;i++){try{const t=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result)}};return}}catch{}await sleep(200)}throw Error('Edge unavailable')}
const cdp=(method,params={})=>new Promise(res=>{pending.set(++id,res);ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser error');return r.result.value}
const go=async(u,ms=2800)=>{exceptions=[];await cdp('Page.navigate',{url:u});await sleep(ms)};

// The register is shared with the server, so its rules can be checked directly.
globalThis.ShopFulfilment=require('../lib/shop-fulfilment');
const Register=require('../lib/invoice-register');

(async()=>{
 // A cancelled or refunded invoice must not be reported as due or paid.
 assert(Register.statusOf({amount:50,paid:0,due:'2000-01-01',status:'cancelled'}).key==='cancelled','Cancelled invoice is not reported as cancelled');
 assert(Register.statusOf({amount:50,paid:50,status:'refunded'}).key==='refunded','Refunded invoice is not reported as refunded');
 assert(Register.statusOf({amount:50,paid:0,due:'2000-01-01'}).key==='overdue','Past-due invoice is not overdue');
 assert(Register.statusOf({amount:50,paid:50}).key==='paid','Settled invoice is not paid');

 const db=await fetch(`${base}/api/state`).then(r=>r.json());
 const entries=Register.build(db),totals=Register.totals(entries);
 const shopEntries=entries.filter(e=>e.source==='shop'),businessEntries=entries.filter(e=>e.source==='business');
 assert(shopEntries.length&&businessEntries.length,'Register needs both shop and business invoices to be meaningful');

 browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(__dirname,'.invoices-edge-'+Date.now())}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
 await connect();await cdp('Page.enable');await cdp('Runtime.enable');
 await go(`${base}/admin-login.html`,1600);
 if(await ev(`!!document.querySelector('#admin-email')`)){await ev(`document.querySelector('#admin-email').value='admin@masjidpoint.co.uk';document.querySelector('#admin-password').value='Admin!2026Secure';document.querySelector('#admin-login-form').requestSubmit()`);await sleep(1900)}

 // 1. Both invoice families appear, and the tiles agree with the register.
 await go(`${base}/admin-invoices.html`,3200);
 assert(!exceptions.length,`Invoices page raised: ${exceptions.join(', ')}`);
 const page=await ev(`({rows:document.querySelectorAll('#invoice-rows tr').length,total:document.querySelector('#invoice-total').textContent,paid:document.querySelector('#invoice-paid').textContent,due:document.querySelector('#invoice-due').textContent,overdue:document.querySelector('#invoice-overdue').textContent,share:document.querySelector('#invoice-share').textContent,shopBadges:document.querySelectorAll('.type-badge.type-shop').length,jobBadges:document.querySelectorAll('.type-badge.type-job').length,export:document.querySelector('#export-invoices').getAttribute('href')})`);
 assert(page.rows===entries.length,`Register shows ${page.rows} rows, expected ${entries.length}`);
 assert(page.total===`£${totals.invoiced.toFixed(2)}`,`Total invoiced tile is ${page.total}, expected £${totals.invoiced.toFixed(2)}`);
 assert(page.paid===`£${totals.paid.toFixed(2)}`,`Paid tile is ${page.paid}`);
 assert(page.due===`£${totals.outstanding.toFixed(2)}`,`Outstanding tile is ${page.due}`);
 assert(page.overdue===`£${totals.overdue.toFixed(2)}`,`Overdue tile is ${page.overdue}`);
 assert(page.share===`£${totals.mosqueShare.toFixed(2)}`,`Mosque share tile is ${page.share}`);
 assert(page.shopBadges>0&&page.jobBadges>0,'Type badges are missing for shop or job invoices');
 assert(page.export==='/api/invoices/export.csv','Export button does not point at the full register');

 // 2. Type filter narrows to mosque shop invoices only.
 await ev(`(()=>{const s=document.querySelector('#invoice-type');s.value='shop';s.dispatchEvent(new Event('change'))})()`);await sleep(500);
 const shopOnly=await ev(`({rows:document.querySelectorAll('#invoice-rows tr').length,nonShop:[...document.querySelectorAll('#invoice-rows tr')].filter(r=>!r.querySelector('.type-badge.type-shop')).length})`);
 assert(shopOnly.rows===shopEntries.length&&shopOnly.nonShop===0,`Shop filter showed ${shopOnly.rows} rows (${shopOnly.nonShop} not shop), expected ${shopEntries.length}`);

 // 3. Status tabs filter and their counts match.
 await ev(`(()=>{const s=document.querySelector('#invoice-type');s.value='all';s.dispatchEvent(new Event('change'))})()`);await sleep(400);
 const paidCount=entries.filter(e=>e.status.key==='paid').length;
 await ev(`[...document.querySelectorAll('[data-status]')].find(b=>b.dataset.status==='paid').click()`);await sleep(500);
 const paidTab=await ev(`({rows:document.querySelectorAll('#invoice-rows tr').length,count:Number([...document.querySelectorAll('[data-status]')].find(b=>b.dataset.status==='paid').querySelector('b').textContent),offStatus:[...document.querySelectorAll('#invoice-rows tr')].filter(r=>r.querySelector('.status-badge').textContent.trim()!=='Paid').length})`);
 assert(paidTab.rows===paidCount&&paidTab.count===paidCount&&paidTab.offStatus===0,`Paid tab showed ${paidTab.rows}/${paidTab.count}, expected ${paidCount}`);

 // 4. Search narrows to a single known invoice.
 await ev(`[...document.querySelectorAll('[data-status]')].find(b=>b.dataset.status==='all').click()`);await sleep(400);
 const wanted=shopEntries[0];
 await ev(`(()=>{const s=document.querySelector('#invoice-search');s.value=${JSON.stringify(wanted.number)};s.dispatchEvent(new Event('input'))})()`);await sleep(500);
 const searched=await ev(`({rows:document.querySelectorAll('#invoice-rows tr').length,first:document.querySelector('#invoice-rows tr strong')?.textContent})`);
 assert(searched.rows===1&&searched.first===wanted.number,`Search for ${wanted.number} returned ${searched.rows} row(s)`);

 // 5. The row opens the shop invoice, which shows how it was received and the split.
 await ev(`document.querySelector('#invoice-rows tr').click()`);await sleep(2400);
 assert(/\/admin-invoice-view(?:\.html)?$/.test(await ev('location.pathname')),'Row click did not open the invoice');
 const shopSheet=await ev(`({number:document.querySelector('.invoice-head h2')?.textContent,badges:[...document.querySelectorAll('.invoice-head-badges span')].map(s=>s.textContent),meta:document.querySelector('.invoice-meta')?.textContent,lines:document.querySelectorAll('.invoice-lines tbody tr').length,pdf:document.querySelector('.invoice-sheet-actions a')?.getAttribute('href'),totals:document.querySelector('.invoice-total')?.textContent})`);
 assert(shopSheet.number===wanted.number,`Shop invoice sheet shows ${shopSheet.number}`);
 assert(shopSheet.badges.includes('Mosque shop'),'Shop invoice is missing its type badge');
 assert(shopSheet.meta?.includes('How received')&&shopSheet.meta.includes(wanted.route.label),'Shop invoice does not state how it was received');
 assert(shopSheet.lines>0&&shopSheet.pdf?.includes('/api/shop/invoice.pdf'),'Shop invoice lines or PDF link are missing');
 assert(shopSheet.totals?.includes('Mosque share'),'Shop invoice does not show the mosque share');
 assert(!exceptions.length,`Shop invoice sheet raised: ${exceptions.join(', ')}`);

 // 6. Business listing invoices still render, with per-line splits.
 const business=businessEntries.find(e=>(e.invoice.lines||[]).length>0);
 await go(`${base}/admin-invoice-view.html?code=${encodeURIComponent(business.account.code)}&invoice=${encodeURIComponent(business.number)}`,2800);
 const businessSheet=await ev(`({number:document.querySelector('.invoice-head h2')?.textContent,lines:document.querySelectorAll('.invoice-lines tbody tr').length,typeBadges:document.querySelectorAll('.invoice-lines .type-badge').length,pdf:document.querySelector('.invoice-sheet-actions a')?.getAttribute('href')})`);
 assert(businessSheet.number===business.number,`Business invoice sheet shows ${businessSheet.number}`);
 assert(businessSheet.lines===business.invoice.lines.length,`Business invoice shows ${businessSheet.lines} lines, expected ${business.invoice.lines.length}`);
 assert(businessSheet.typeBadges>0,'Business invoice lines have no type badges');
 assert(businessSheet.pdf?.includes('/api/finance/invoice.pdf'),'Business invoice PDF link is missing');
 assert(!exceptions.length,`Business invoice sheet raised: ${exceptions.join(', ')}`);

 // 7. Export and PDFs are actually served.
 const csv=await fetch(`${base}/api/invoices/export.csv`).then(r=>r.text());
 const csvLines=csv.trim().split(/\r?\n/);
 assert(csvLines.length===entries.length+1,`CSV has ${csvLines.length-1} rows, expected ${entries.length}`);
 assert(csv.includes('Mosque shop')&&csv.includes('Job listing'),'CSV export is missing one of the invoice types');
 const shopPdf=await fetch(`${base}${wanted.pdfHref}`);
 const businessPdf=await fetch(`${base}${business.pdfHref}`);
 assert(shopPdf.status===200&&businessPdf.status===200,'An invoice PDF did not render');

 console.log(JSON.stringify({passed:true,invoices:entries.length,business:businessEntries.length,shop:shopEntries.length,invoiced:totals.invoiced,mosqueShare:totals.mosqueShare,checks:['cancelled and refunded statuses','unified register','summary tiles match','type filter','status tabs','search','row opens invoice','shop invoice sheet','business invoice sheet','CSV export covers both','PDF for both']},null,2));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>{try{ws?.close()}catch{}try{browser?.kill()}catch{}});
