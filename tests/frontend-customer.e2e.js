// The individual (customer) journey: apply for a job without an account, claim one from the
// confirmation with details already filled in, then see that application — and any shop order
// placed with the same email — in one portal, and edit the details held about you.
const {spawn}=require('child_process'),path=require('path'),edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',port=9890,base=process.env.MASJIDPOINT_URL||'http://127.0.0.1:4174';
const accounts=require('./seed-accounts.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
let ws,browser,id=0,pending=new Map(),exceptions=[];
async function connect(){for(let i=0;i<60;i++){try{const t=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(t){ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m.result)}};return}}catch{}await sleep(200)}throw Error('Edge unavailable')}
const cdp=(method,params={})=>new Promise(res=>{pending.set(++id,res);ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Browser error');return r.result.value}
const go=async(u,ms=3000)=>{exceptions=[];await cdp('Page.navigate',{url:u});await sleep(ms)};
const set=(name,value)=>ev(`(()=>{const e=document.querySelector('form [name=${JSON.stringify(name)}]');if(!e)throw Error('Missing field ${name}');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const state=()=>fetch(`${base}/api/state`).then(r=>r.json());
async function upload(selector,file){const doc=await cdp('DOM.getDocument'),node=await cdp('DOM.querySelector',{nodeId:doc.root.nodeId,selector});assert(node.nodeId,`Missing file input ${selector}`);await cdp('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[file]})}

(async()=>{
 let db=await state();
 const job=(db.masjidPointJobs||[]).find(j=>j.status==='live'&&j.enabled);
 assert(job,'No live job to apply for');
 const run=Date.now().toString().slice(-6);
 const person={name:`Community Member ${run}`,email:`member.${run}@example.test`,phone:'07700 900500',password:'Member!2026Aa'};

 browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(__dirname,'.customer-edge-'+Date.now())}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
 await connect();await cdp('Page.enable');await cdp('Runtime.enable');

 // 1. Apply for a job with no account at all.
 await go(`${base}/candidate-apply.html?job=${encodeURIComponent(job.id)}`,3000);
 await set('fullName',person.name);await set('email',person.email);await set('phone',person.phone);
 await set('experienceYears','3–5 years');
 await upload('#candidate-cv',path.join(__dirname,'fixtures','sample-cv.pdf'));
 await ev(`(()=>{const c=document.querySelector('[name=consent]');if(c){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
 await ev(`document.querySelector('#candidate-form').requestSubmit()`);await sleep(2200);
 const reference=await ev(`document.querySelector('#candidate-reference')?.textContent`);
 assert(/^APP-/.test(reference||''),`Application was not submitted (reference ${reference})`);
 assert(!exceptions.length,`Application raised: ${exceptions.join(', ')}`);

 // 2. The confirmation offers an account, carrying the application reference.
 const offer=await ev(`({signup:document.querySelector('#success-signup')?.getAttribute('href'),signin:!!document.querySelector('#success-signin')})`);
 // The link carries the reference so the new account is joined to the application already made.
 // It gained an &email= as well, to save typing it twice; assert what has to be true rather
 // than the exact query string, so adding another hint here is not a failure.
 assert(/^customer-signup\?/.test(offer.signup||'')&&new URLSearchParams((offer.signup||'').split('?')[1]).get('application')===reference,
   `Sign-up button points at ${offer.signup}`);
 assert(offer.signin,'Confirmation does not offer sign-in for people who already have an account');

 // 3. Sign-up arrives prefilled — only the password is new.
 await go(`${base}/${offer.signup}`,3000);
 const prefill=await ev(`({name:document.querySelector('[name=name]').value,email:document.querySelector('[name=email]').value,phone:document.querySelector('[name=phone]').value,note:!document.querySelector('#prefill-note').hidden,linked:[...document.querySelectorAll('#linked-list li')].length})`);
 assert(prefill.name===person.name&&prefill.email===person.email&&prefill.phone===person.phone,
   `Sign-up was not prefilled from the application: ${JSON.stringify(prefill)}`);
 assert(prefill.note,'Sign-up does not explain that details were carried over');
 assert(prefill.linked>=1,'Sign-up does not show the application it will link');

 await set('password',person.password);await set('confirm',person.password);
 await set('line1','9 Community Way');await set('city','Birmingham');await set('postcode','B10 0RX');
 await ev(`document.querySelector('#create-account').click()`);await sleep(2600);
 // Creating the account no longer signs you straight in: an address has to be proved before it
 // can receive anything, so a six-digit code goes out by email and the page asks for it. In
 // development the mail is written to the outbox instead of being sent, which is where this reads
 // it from — the same place a developer would look.
 assert(await ev(`!!document.querySelector('[name=code]')&&document.querySelector('[name=code]').offsetParent!==null`),
   'Sign-up did not ask for the emailed verification code');
 const code=await verificationCode(person.email);
 assert(/^\d{6}$/.test(code||''),`No verification code was emailed (got ${code})`);
 await set('code',code);
 await ev(`document.querySelector('#verification-form').requestSubmit()`);await sleep(2600);
 assert(/\/login(?:\.html)?$/.test(await ev('location.pathname')),`Verifying the code did not return to sign-in (${await ev('location.pathname')})`);
 assert(!exceptions.length,`Sign-up raised: ${exceptions.join(', ')}`);

 // Now sign in the way the newly verified person would.
 await set('email',person.email);await set('password',person.password);
 await ev(`document.querySelector('#login-form').requestSubmit()`);await sleep(3000);
 assert(/\/my-account(?:\.html)?$/.test(await ev('location.pathname')),'Signing in after verification did not reach the account portal');

 db=await state();
 const customer=(db.masjidPointCustomers||[]).find(c=>c.email===person.email);
 assert(customer,'Customer record was not created');
 assert(customer.address?.postcode==='B10 0RX','Address was not saved at sign-up');
 assert(!('password' in customer),'A raw password was stored');

 // 4. The portal shows the application that predates the account.
 const portal=await ev(`({name:document.querySelector('#account-name').textContent,applications:document.querySelectorAll('#panel-applications .account-card').length,appCount:document.querySelector('#count-applications').textContent,reference:document.querySelector('#panel-applications .account-card')?.textContent||''})`);
 assert(portal.applications===1&&portal.appCount==='1',`Portal shows ${portal.applications} applications, expected 1`);
 assert(portal.reference.includes(reference),'Portal does not show the application reference');
 assert(portal.name.includes('Community'),`Portal greeting is wrong: ${portal.name}`);

 // 5. An order placed with the same email appears too, without any extra linking.
 const shop=accounts.shopMosque(db);
 assert(shop,'No seeded shop available');
 await go(`${base}/masjid-shop.html?reference=${encodeURIComponent(shop.ref)}`,3000);
 await ev(`document.querySelector('[data-add]').click();document.querySelector('#open-cart').click()`);await sleep(600);
 await set('name',person.name);await set('email',person.email);await set('phone',person.phone);
 // An order paid up front now stops at a payment step — bank details, the reference, somewhere to
 // send the receipt — before the confirmation. The order is saved either way, so this takes the
 // "send proof later" route and stays about what the account portal shows.
 await ev(`document.querySelector('#place-order').click()`);await sleep(2600);
 const paymentStep=await ev(`!!document.querySelector('#proof-form')`);
 assert(paymentStep,'Checkout did not reach the payment step');
 await sendPaymentProof(ev,upload,sleep);
 assert(await ev(`!document.querySelector('#order-success').hidden`),'Order was not confirmed');
 const orderOffer=await ev(`document.querySelector('#order-success .order-next a.button')?.getAttribute('href')||document.querySelector('#order-success .order-account a')?.getAttribute('href')`);
 assert(orderOffer,'Order confirmation offers no route to an account');

 await go(`${base}/my-account.html`,3000);
 const withOrder=await ev(`({orders:document.querySelectorAll('#panel-orders .account-card').length,orderCount:document.querySelector('#count-orders').textContent})`);
 assert(Number(withOrder.orderCount)>=1&&withOrder.orders>=1,`Portal shows ${withOrder.orderCount} orders, expected at least 1`);

 // 5b. Signed in, the header offers the account rather than sign in / sign up.
 await go(`${base}/index.html`,2600);
 const nav=await ev(`({avatar:!!document.querySelector('.site-nav-avatar'),initials:document.querySelector('.site-nav-initials')?.textContent,signIn:!!document.querySelector('.site-nav-signin'),signUp:!!document.querySelector('.site-nav-actions a[href="signup.html"]')})`);
 assert(nav.avatar,'Signed in, the header shows no account button');
 assert(!nav.signIn&&!nav.signUp,'Signed in, the header still offers Sign in / Sign up');
 assert(nav.initials==='CM',`Account initials are "${nav.initials}", expected initials of the name`);
 await ev(`document.querySelector('.site-nav-avatar').click()`);await sleep(400);
 const menu=await ev(`({open:!document.querySelector('.site-nav-menu').hidden,portal:document.querySelector('.site-nav-menu a')?.getAttribute('href'),signOut:!!document.querySelector('.site-nav-menu [data-sign-out]')})`);
 assert(menu.open&&menu.portal==='my-account'&&menu.signOut,`Account menu is wrong: ${JSON.stringify(menu)}`);

 // 5c. The jobs board flags roles this person has already applied for.
 await go(`${base}/public-jobs.html`,3600);
 const board=await ev(`({flagged:document.querySelectorAll('.public-job-card.already-applied').length,flags:document.querySelectorAll('.applied-flag').length,total:document.querySelectorAll('.public-job-card').length})`);
 assert(board.total>board.flagged,'Every job was flagged as applied — the match is too loose');
 assert(board.flagged===1&&board.flags===1,`Jobs board flagged ${board.flagged} roles, expected 1`);
 // Opening that role shows the application instead of an apply button.
 await go(`${base}/public-jobs.html?job=${encodeURIComponent(job.id)}`,3600);
 const drawer=await ev(`({applied:!!document.querySelector('.drawer-applied'),applyHidden:document.querySelector('#apply-job')?.hidden,note:document.querySelector('.drawer-applied')?.textContent||''})`);
 assert(drawer.applied&&drawer.applyHidden,'An already-applied role still offers the apply button');
 assert(drawer.note.includes(reference),'The applied note does not show the application reference');
 // Opening a role they have NOT applied for must still offer the apply button — the drawer is
 // reused, so hiding it once must not hide it for every role after.
 const other=(db.masjidPointJobs||[]).find(j=>j.status==='live'&&j.enabled&&j.id!==job.id);
 if(other){
   await ev(`document.querySelector('#close-public-job')?.click()`);await sleep(500);
   await ev(`openJob(${JSON.stringify(other.id)})`);await sleep(700);
   const fresh=await ev(`({applied:!!document.querySelector('.drawer-applied'),applyHidden:document.querySelector('#apply-job')?.hidden,apply:document.querySelector('#apply-job')?.getAttribute('href')})`);
   assert(fresh.applyHidden===false,'A role they have not applied for is missing its apply button');
   assert(!fresh.applied,'A role they have not applied for is marked as applied');
   assert(fresh.apply===`candidate-apply?job=${encodeURIComponent(other.id)}`,`Apply button points at ${fresh.apply}`);
 }
 assert(!exceptions.length,`Jobs board raised: ${exceptions.join(', ')}`);
 await go(`${base}/my-account.html`,3000);

 // 6. Details can be filled in later; the wrong password is refused.
 await ev(`[...document.querySelectorAll('#account-tabs button')].find(b=>b.dataset.tab==='details').click()`);await sleep(400);
 const loaded=await ev(`({name:document.querySelector('[name=name]').value,email:document.querySelector('[name=email]').value,emailLocked:document.querySelector('[name=email]').disabled,postcode:document.querySelector('[name=postcode]').value})`);
 assert(loaded.name===person.name&&loaded.email===person.email,'Details form did not load the account');
 assert(loaded.emailLocked,'Email should not be editable — it links the records');
 assert(loaded.postcode==='B10 0RX','Saved address did not load');

 await set('phone','07700 900999');await set('currentPassword','WrongPassword1');
 await ev(`document.querySelector('#save-details').click()`);await sleep(1600);
 assert(await ev(`!document.querySelector('#details-error').hidden`),'A wrong password was accepted');

 await set('currentPassword',person.password);
 await ev(`document.querySelector('#save-details').click()`);await sleep(1900);
 assert(await ev(`!document.querySelector('#details-success').hidden`),'Saving details with the right password failed');
 db=await state();
 assert((db.masjidPointCustomers||[]).find(c=>c.email===person.email).phone==='07700 900999','Updated phone was not stored');

 // 7. Signing out and back in returns to the same portal.
 await ev(`document.querySelector('#sign-out').click()`);await sleep(1600);
 await go(`${base}/login.html?return=my-account.html`,2200);
 await set('email',person.email);await set('password',person.password);
 await ev(`document.querySelector('#login-form button[type=submit]').click()`);await sleep(2600);
 assert(/\/my-account(?:\.html)?$/.test(await ev('location.pathname')),'Individual could not sign back in');
 assert(await ev(`document.querySelectorAll('#panel-applications .account-card').length>=1`),'Applications missing after sign-in');
 assert(!exceptions.length,`Sign-in raised: ${exceptions.join(', ')}`);

 // 8. A duplicate account for the same email is refused.
 const duplicate=await fetch(`${base}/api/customer/signup`,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:person.name,email:person.email,passwordHash:'a'.repeat(64)})});
 assert(duplicate.status===409,`Duplicate sign-up returned ${duplicate.status}, expected 409`);

 console.log(JSON.stringify({passed:true,customer:person.email,application:reference,checks:['apply with no account','confirmation offers an account','sign-up prefilled from the application','linked records previewed','account created and signed in','pre-account application appears','shop order linked by email','header shows the account when signed in','account menu opens the portal','jobs board flags roles already applied for','other roles keep their apply button','details editable later','email locked as the link key','wrong password refused','sign out and back in','duplicate email refused']},null,2));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>{try{ws?.close()}catch{}try{browser?.kill()}catch{}});

// An order paid up front is now held until the receipt arrives — the "send proof later" escape
// was removed on purpose, so the journey has to send real evidence to reach the confirmation.
async function sendPaymentProof(ev,upload,sleep){
 const fs=require('fs'),os=require('os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-receipt-'));
 const receipt=path.join(dir,'receipt.png');
 fs.writeFileSync(receipt,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
 await ev(`(()=>{const f=document.querySelector('#proof-form');
   f.elements.bankReference.value='E2E-'+Date.now();
   f.elements.bankReference.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await upload('#proof-form [name=file]',receipt);
 await ev(`document.querySelector('#proof-form button[type=submit]').click()`);
 await sleep(2600);
}

// The six-digit code the server emailed. In development nothing is sent — each message is written
// to the outbox in the data directory the server was started with, so the newest one addressed to
// this person is the code just issued.
async function verificationCode(email){
  // The server issues a fixed 123456 under MASJIDPOINT_TEST_MODE, which the runner sets, so a
  // suite never has to scrape a mailbox. Reading the outbox is the fallback for a run against
  // a server started by hand without it.
  if(process.env.MASJIDPOINT_TEST_MODE==='1')return '123456';
  const fs=require('fs');
  const dir=path.join(process.env.MASJIDPOINT_DATA_DIR||path.join(__dirname,'..','data'),'email-outbox');
  for(let attempt=0;attempt<20;attempt++){
    try{
      const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'))
        .map(f=>({f,at:fs.statSync(path.join(dir,f)).mtimeMs})).sort((a,b)=>b.at-a.at);
      for(const {f} of files){
        const mail=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
        if(String(mail.to||'').toLowerCase()!==String(email).toLowerCase())continue;
        const found=String(mail.subject||'').match(/(\d{6})/)||String(mail.text||'').match(/(\d{6})/)
          ||String(mail.html||'').match(/(\d{6})/);
        if(found)return found[1];
      }
    }catch{}
    await new Promise(r=>setTimeout(r,400));
  }
  return null;
}
