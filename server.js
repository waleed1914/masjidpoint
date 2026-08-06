const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const {StateRepository}=require('./lib/db');
const {EmailService}=require('./lib/email-service');
const {audit,locateInvoice,cancelInvoice,refund,csv,invoicePdf}=require('./lib/finance-service');
const fulfilment=require('./lib/shop-fulfilment');
const {shopInvoicePdf}=require('./lib/shop-invoice');
const invoiceRegister=require('./lib/invoice-register');
const settlementRegister=require('./lib/settlement-register');

const root = __dirname;
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'masjidpoint.json');
const port = Number(process.env.PORT || 4173);

// The bootstrap administrator, used only when a deployment starts with no administrators of its
// own. The default is deliberately fixed and known, so that wiping the data never locks anyone out
// of the panel — change it from Admin profiles once you are in, and the stored password takes over.
//
// It is a known default in a public repository, so it is only ever a way in, never a way to stay:
// set ADMIN_PASSWORD on any deployment that matters, and change it in the panel on the rest.
const DEFAULT_ADMIN_PASSWORD = 'Admin!2026Secure';
const bootstrapAdminPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const bootstrapAdminUsesDefault = !process.env.ADMIN_PASSWORD;

// What a deployment starts as: an empty platform. It used to start with a job, a business, a
// listing and an invoice — demo content, which meant a brand-new installation opened with a
// business it had never approved and a balance it had never billed. The demo dataset lives in
// scripts/seed-demo-data.js and is loaded deliberately with `npm run seed`, never by starting up.
//
// The keys must all stay: WRITABLE_COLLECTIONS is derived from them, and a missing key means the
// frontend cannot save that collection at all.
const seed = {
  masjidPointJobs: [],
  masjidPointFinance: { accounts: [], unmatched: [], settled: {}, settlementHistory: [] },
  masjidPointPaymentProofs: [],
  masjidPointBusinessRequests: [],
  masjidPointBusinessListings: [],
  masjidPointAdminApplications: [],
  masjidPointActivatedAccounts: [],
  masjidPointJobApplications: [],
  masjidPointMasjidPricing: [],
  masjidPointProducts: [],
  masjidPointShopOrders: [],
  masjidPointPlatformSettings:{bankDetails:{active:false,accountName:'',bankName:'',sortCode:'',accountNumber:'',iban:'',instructions:'',updatedAt:null}},
  masjidPointNotifications: [],
  masjidPointCustomers: [],
  masjidPointAdminUsers:[{id:'ADM-0001',name:'Platform Owner',email:process.env.ADMIN_EMAIL||'admin@masjidpoint.co.uk',role:'super_admin',status:'active',passwordHash:crypto.createHash('sha256').update(bootstrapAdminPassword).digest('hex'),createdAt:'2026-08-02T00:00:00.000Z'}]
};

// The collections a client may replace wholesale through /api/collection/:key.
const WRITABLE_COLLECTIONS=new Set([...Object.keys(seed),'masjidPointEmailTokens']);

const repository=new StateRepository({seed,root});
const emailService=new EmailService(root);
function load(){return repository.load()}

// Invoice numbers must identify exactly one invoice: they are what a business quotes when it pays
// and what the money is matched against. Take the highest number already issued and add one,
// rather than reading the clock — several accounts are invoiced inside the same loop, and the
// clock does not move between them.
function nextInvoiceNumber(db){
  const year=new Date().getFullYear();
  let highest=0;
  for(const acct of (db.masjidPointFinance&&db.masjidPointFinance.accounts)||[])
    for(const inv of acct.invoices||[]){
      const m=String(inv.number||'').match(/^INV-\d{4}-(\d+)$/);
      if(m)highest=Math.max(highest,Number(m[1]));
    }
  return `INV-${year}-${String(highest+1).padStart(5,'0')}`;
}


// Everything the frontend reads comes from GET /api/state, which for a long time meant the whole
// database — including every password hash. That was survivable while the platform only ran on a
// trusted machine, and is not once it is on the open internet: a hash is not a password, but it is
// enough to sign in with, because the browser is what does the hashing.
//
// So the hashes are removed on the way out. Nothing in the frontend needs them any more: signing
// in and changing a password both go through endpoints above, which compare server-side.
function publicState(db){
  const withoutHash = rows => (rows||[]).map(({passwordHash,...rest})=>rest);
  return {
    ...db,
    masjidPointActivatedAccounts: withoutHash(db.masjidPointActivatedAccounts),
    masjidPointAdminUsers: withoutHash(db.masjidPointAdminUsers),
    masjidPointCustomers: withoutHash(db.masjidPointCustomers),
    // Single-use activation and reset tokens are as good as a password until they are spent.
    masjidPointEmailTokens: []
  };
}
function save(db){return repository.save(db)}
const tokenHash=token=>crypto.createHash('sha256').update(token).digest('hex');
async function emailTransitions(before,after,actor='Super Admin'){
  after.masjidPointEmailTokens ||= [];
  after.masjidPointFinance ||= {accounts:[], unmatched:[], settled:{}, settlementHistory:[], audit:[]};
  after.masjidPointFinance.audit ||= [];
  const oldApps=before.masjidPointAdminApplications||[];
  for(const app of after.masjidPointAdminApplications||[]){const old=oldApps.find(x=>x.reference===app.reference);if(old?.status===app.status||!['approved','rejected'].includes(app.status))continue;try{if(app.status==='approved'){const token=crypto.randomBytes(32).toString('base64url');after.masjidPointEmailTokens=after.masjidPointEmailTokens.filter(x=>!(x.purpose==='activation'&&x.reference===app.reference&&!x.usedAt));after.masjidPointEmailTokens.push({hash:tokenHash(token),purpose:'activation',reference:app.reference,email:app.email,expiresAt:new Date(Date.now()+48*3600000).toISOString(),createdAt:new Date().toISOString()});await emailService.approval(app,token)}else await emailService.rejection(app)}catch(error){console.error('Application email failed:',error.message)}}
  for(const app of after.masjidPointAdminApplications||[]){const old=oldApps.find(x=>x.reference===app.reference);if(!old)continue;if(old.status!==app.status)audit(after,{action:`account.${app.status}`,entityType:app.type,entityId:app.reference,actor,reason:app.note||'',before:{status:old.status},after:{status:app.status},metadata:{name:app.name}});if((old.accountStatus||'active')!==(app.accountStatus||'active'))audit(after,{action:`account.${app.accountStatus}`,entityType:app.type,entityId:app.reference,actor,reason:app.accountStatusNote||app.note||'',before:{accountStatus:old.accountStatus||'active'},after:{accountStatus:app.accountStatus||'active'},metadata:{name:app.name}})}
  const oldPricing=before.masjidPointMasjidPricing||[];for(const price of after.masjidPointMasjidPricing||[]){const old=oldPricing.find(x=>x.masjidReference===price.masjidReference);if(!old)continue;const fields=['advertisingPrice','jobPrice','adminPercent','mosquePercent','acceptingListings'],changed=fields.some(key=>String(old[key])!==String(price[key]));if(changed)audit(after,{action:'pricing.updated',entityType:'masjid',entityId:price.masjidReference,actor,reason:price.changeNote||'',before:Object.fromEntries(fields.map(key=>[key,old[key]])),after:Object.fromEntries(fields.map(key=>[key,price[key]])),metadata:{name:price.masjidName}})}
  const oldBank=before.masjidPointPlatformSettings?.bankDetails||{},newBank=after.masjidPointPlatformSettings?.bankDetails||{};if(JSON.stringify(oldBank)!==JSON.stringify(newBank))audit(after,{action:'bank_details.updated',entityType:'platform_setting',entityId:'customer_bank_details',actor,before:{active:oldBank.active,accountName:oldBank.accountName,bankName:oldBank.bankName,sortCode:oldBank.sortCode,accountNumberEnding:String(oldBank.accountNumber||'').slice(-4)},after:{active:newBank.active,accountName:newBank.accountName,bankName:newBank.bankName,sortCode:newBank.sortCode,accountNumberEnding:String(newBank.accountNumber||'').slice(-4)}})
  const oldProofs=before.masjidPointPaymentProofs||[];
  for(const proof of after.masjidPointPaymentProofs||[]){const old=oldProofs.find(x=>x.id===proof.id);if(old?.status===proof.status||!['approved','rejected'].includes(proof.status))continue;audit(after,{action:`payment.proof_${proof.status}`,entityType:'payment_proof',entityId:proof.id,actor,reason:proof.adminNote||'',before:{status:old?.status||'submitted'},after:{status:proof.status},metadata:{invoice:proof.invoice,businessCode:proof.businessCode,amount:proof.amount}});const app=(after.masjidPointAdminApplications||[]).find(x=>x.type==='business'&&(x.businessCode===proof.businessCode||x.reference===proof.businessCode));try{await emailService.payment(app?.email,proof.businessName||app?.name,proof.status==='approved',proof.adminNote)}catch(error){console.error('Payment email failed:',error.message)}}
  const oldAccounts=before.masjidPointFinance?.accounts||[];
  for(const account of after.masjidPointFinance?.accounts||[]){
    const old=oldAccounts.find(x=>x.code===account.code);
    for(const invoice of account.invoices||[]){
      const isNew=!(old?.invoices||[]).some(x=>x.number===invoice.number);
      const logged=after.masjidPointFinance.audit.some(x=>x.action==='invoice.created'&&x.entityId===invoice.number);
      if(isNew&&!logged)audit(after,{action:'invoice.created',entityType:'invoice',entityId:invoice.number,after:{amount:invoice.amount,due:invoice.due},metadata:{businessCode:account.code}})
    }
    for(const payment of account.payments||[]){
      const existed=(old?.payments||[]).some(x=>(x.proofId&&x.proofId===payment.proofId)||(!x.proofId&&x.bankReference===payment.bankReference&&x.date===payment.date&&Number(x.amount)===Number(payment.amount)));
      if(!existed)audit(after,{action:'payment.recorded',entityType:'payment',entityId:payment.proofId||payment.bankReference,after:{amount:payment.amount,date:payment.date},metadata:{businessCode:account.code,bankReference:payment.bankReference}})
    }
  }
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function body(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', c => { raw += c; if (raw.length > 8e6) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch(e) { reject(e); } }); }); }
function notify(db, audience, title, message, href, key) {
  db.masjidPointNotifications ||= [];
  if (key && db.masjidPointNotifications.some(n => n.key === key)) return;
  db.masjidPointNotifications.unshift({ id: `NTF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, audience, title, message, href, key, read: false, createdAt: new Date().toISOString() });
}
function account(db, code='BUS-00184', name='Amanah Accounting', email='hello@amanahaccounts.co.uk') {
  db.masjidPointFinance ||= {accounts:[], unmatched:[], settled:{}, settlementHistory:[]};
  let item = db.masjidPointFinance.accounts.find(a => a.code === code);
  if (!item) { item={code,name,email,invoices:[],payments:[]}; db.masjidPointFinance.accounts.push(item); }
  return item;
}
// Shop orders gained fulfilment methods, delivery details and their own invoice numbers after
// the first orders were taken, so every order is brought up to the current shape on load.
function normaliseShopOrders(db){
  const orders=db.masjidPointShopOrders||[];
  let nextInvoice=Math.max(0,...orders.map(order=>Number(String(order.invoiceNumber||'').split('-').pop())||0));
  for(const order of orders){
    const method=fulfilment.methodOf(order);
    order.fulfilmentMethod=method.key;
    const rate=(db.masjidPointMasjidPricing||[]).find(item=>item.masjidReference===order.collectionMasjidReference||item.masjidName===order.collectionMasjidName);
    order.deliveryFee=method.needsAddress?Math.max(0,Number(order.deliveryFee)||fulfilment.deliveryFeeOf(rate)):0;
    if(!method.needsAddress)delete order.deliveryAddress;
    const goods=(order.items||[]).reduce((sum,item)=>sum+Number(item.price||0)*Number(item.quantity||0),0);
    order.goodsTotal=Number(goods.toFixed(2));
    order.total=Number((goods+order.deliveryFee).toFixed(2));
    order.mosqueRevenue=Number((order.items||[]).reduce((sum,item)=>sum+Number(item.mosqueRevenue||0),0).toFixed(2));
    // Legacy orders used pay_on_collection for everything; split it by what the method expects.
    if(!order.paymentStatus||order.paymentStatus==='pay_on_collection')order.paymentStatus=method.paysUpfront?'awaiting_bank_transfer':'pay_at_mosque';
    if(!method.paysUpfront&&['awaiting_bank_transfer','submitted'].includes(order.paymentStatus))order.paymentStatus='pay_at_mosque';
    order.paymentReference||=`SHOP-PAY-${String(order.id).replace(/\D/g,'').slice(-6)||'000000'}`;
    if(!order.invoiceNumber)order.invoiceNumber=`SHP-${new Date(order.placedAt||Date.now()).getFullYear()}-${String(++nextInvoice).padStart(6,'0')}`;
  }
}
function reconcile(db, previousJobs=[]) {
  const jobs = db.masjidPointJobs || [];
  let nextCode=Math.max(100,...(db.masjidPointAdminApplications||[]).map(a=>Number(String(a.businessCode||'').replace(/\D/g,''))||0),...(db.masjidPointFinance?.accounts||[]).map(a=>Number(String(a.code||'').replace(/\D/g,''))||0))+1;
  for(const app of db.masjidPointAdminApplications||[]){if(app.type==='business'&&['approved','activated'].includes(app.status)&&!/^BUS-\d{5}$/.test(app.businessCode||''))app.businessCode=`BUS-${String(nextCode++).padStart(5,'0')}`}
  db.masjidPointMasjidPricing||=[];
  for(const app of db.masjidPointAdminApplications||[]){if(app.type!=='masjid'||!['approved','activated'].includes(app.status))continue;const rate=db.masjidPointMasjidPricing.find(x=>x.masjidReference===app.reference||x.masjidName===app.name);if(rate){rate.masjidReference||=app.reference;rate.masjidName=app.name;continue}db.masjidPointMasjidPricing.push({masjidReference:app.reference,masjidName:app.name,advertisingPrice:20,jobPrice:5,adminPercent:30,mosquePercent:70,acceptingListings:true,updatedAt:new Date().toISOString()})}
  for(const rate of db.masjidPointMasjidPricing){rate.shopFulfilment=fulfilment.settingsOf(rate);rate.shopDeliveryFee=fulfilment.deliveryFeeOf(rate)}
  normaliseShopOrders(db);
  // Job notices were once addressed to every business at once, which showed each account other
  // businesses' approvals and payment demands. Re-address the historic ones to their owner.
  for(const item of db.masjidPointNotifications||[]){
    if(item.audience!=='business')continue;
    const owner=(db.masjidPointJobs||[]).find(job=>String(item.key||'').includes(job.id));
    if(owner?.businessCode)item.audience=`business:${owner.businessCode}`;
  }
  // Anything still unattributable names a job that no longer exists, so it cannot be shown to
  // one business without showing it to all of them. Drop it rather than keep leaking it.
  db.masjidPointNotifications=(db.masjidPointNotifications||[]).filter(item=>item.audience!=='business');
  for(const job of jobs){const owner=(db.masjidPointAdminApplications||[]).find(a=>a.type==='business'&&(a.reference===job.businessReference||a.reference===job.businessCode));if(owner?.businessCode){const old=job.businessCode;job.businessCode=owner.businessCode;job.businessReference=owner.reference;job.business=owner.name;const acct=db.masjidPointFinance?.accounts?.find(a=>a.code===old);if(acct&&!db.masjidPointFinance.accounts.some(a=>a.code===owner.businessCode))acct.code=owner.businessCode}}
  for(const proof of db.masjidPointPaymentProofs||[]){const owner=(db.masjidPointAdminApplications||[]).find(a=>a.type==='business'&&a.reference===proof.businessCode);if(owner?.businessCode)proof.businessCode=owner.businessCode}
  for(const application of db.masjidPointJobApplications||[]){const job=jobs.find(j=>j.id===application.jobId);if(job){application.business=job.business;application.businessReference=job.businessReference;application.businessCode=job.businessCode}}
  for (const job of jobs) {
    job.business ||= 'Amanah Accounting'; job.businessCode ||= 'BUS-00184';
    job.masjids ||= [{name:job.masjid || 'Central Masjid', fee:Number(job.fee)||5, status:job.status==='pending'?'pending':'approved'}];
    if(!Number.isFinite(Number(job.fee)))job.fee=job.masjids.reduce((sum,choice)=>sum+(Number(choice.fee)||0),0);
    for (const choice of job.masjids) {
      choice.fee=Number(choice.fee)||0; choice.paymentStatus ||= choice.status === 'approved' ? 'due' : 'not_due';
      const old = previousJobs.find(j=>j.id===job.id)?.masjids?.find(m=>m.name===choice.name);
      if (choice.status==='approved' && old?.status!=='approved') {
        choice.paymentStatus='due';
        notify(db,`business:${job.businessCode}`,`${choice.name} approved ${job.title}`,`Pay £${choice.fee.toFixed(2)} to publish this job through ${choice.name}.`,'business-portal#workflow',`approval-business-${job.id}-${choice.name}`);
        notify(db,'admin',`Job charge ready`,`${job.business} owes £${choice.fee.toFixed(2)} for ${job.title}.`,'admin-payments#workflow',`approval-admin-${job.id}-${choice.name}`);
        notify(db,`masjid:${choice.name}`,`Job approved`,`${job.title} is awaiting business payment.`,'masjid-portal#jobs',`approval-masjid-${job.id}-${choice.name}`);
      }
    }
    const approved=job.masjids.filter(m=>m.status==='approved');
    const paid=approved.filter(m=>m.paymentStatus==='paid');
    if (paid.length) { job.status='live'; job.enabled=true; job.masjid=paid.map(m=>m.name).join(', '); }
    else if (approved.length) { job.status='payment due'; job.enabled=false; }
  }
  const requests=db.masjidPointBusinessRequests||[];
  for(const request of requests){const owner=(db.masjidPointAdminApplications||[]).find(a=>a.type==='business'&&(a.reference===request.reference||a.id===request.id||String(a.email||'').toLowerCase()===String(request.email||'').toLowerCase()));if(owner?.businessCode)request.businessCode=owner.businessCode;if(request.status==='approved'&&request.paymentStatus!=='paid'){request.paymentStatus='due';
    // The price agreed when the business applied is locked. Prefer the snapshot captured on the
    // application itself, then the request's own, and only fall back to live mosque pricing when
    // neither exists. Editing a mosque's rates must not reprice an application already in flight.
    const applied=Number(owner?.pricingSnapshot?.advertisingPrice),held=Number(request.pricingSnapshot?.advertisingPrice);
    if(Number.isFinite(applied)&&applied>0){request.pricingSnapshot=owner.pricingSnapshot;request.price=applied}
    else if(Number.isFinite(held)&&held>0){request.price=held}
    else{const current=(db.masjidPointMasjidPricing||[]).find(price=>price.masjidName===request.masjid||price.masjidReference===request.masjidReference);if(current){request.pricingSnapshot={advertisingPrice:Number(current.advertisingPrice),adminPercent:Number(current.adminPercent),mosquePercent:Number(current.mosquePercent),adminAmount:Number(current.advertisingPrice)*Number(current.adminPercent)/100,mosqueAmount:Number(current.advertisingPrice)*Number(current.mosquePercent)/100,updatedAt:current.updatedAt};request.price=Number(current.advertisingPrice)}}}}
  const groups=new Map(),addLine=(code,line)=>{if(!groups.has(code))groups.set(code,[]);groups.get(code).push(line)};
  for(const job of jobs){const code=job.businessCode||'BUS-00184';job.masjids.filter(m=>m.status==='approved'&&m.paymentStatus!=='paid').forEach(m=>addLine(code,{jobId:job.id,kind:'job',description:`${job.title} — ${m.name}`,masjid:m.name,amount:m.fee,adminPercent:Number(m.adminPercent??30),mosquePercent:Number(m.mosquePercent??70)}))}
  for(const request of requests.filter(r=>r.status==='approved'&&r.paymentStatus!=='paid'&&r.businessCode)){const snap=request.pricingSnapshot||{},amount=Number(snap.advertisingPrice??request.price??0);if(amount>0)addLine(request.businessCode,{requestId:request.id,kind:'advertising',description:`Business advertising — ${request.masjid}`,masjid:request.masjid,amount,adminPercent:Number(snap.adminPercent??30),mosquePercent:Number(snap.mosquePercent??70)})}
  for(const acct of db.masjidPointFinance.accounts){acct.invoices=acct.invoices.filter(inv=>{if(!inv.workflow||inv.paid>0)return true;const active=(inv.lines||[]).filter(line=>{if(line.requestId){const request=requests.find(r=>r.id===line.requestId);return request?.status==='approved'&&request.paymentStatus!=='paid'}const job=jobs.find(j=>j.id===line.jobId),choice=job?.masjids.find(m=>m.name===line.masjid);return choice?.status==='approved'&&choice.paymentStatus!=='paid'});inv.lines=active;inv.amount=active.reduce((s,l)=>s+Number(l.amount),0);inv.shares={};active.forEach(l=>inv.shares[l.masjid]=(inv.shares[l.masjid]||0)+Number(l.amount)*Number(l.mosquePercent??70)/100);return active.length>0})}
  for(const [code,dueLines] of groups){const owner=(db.masjidPointAdminApplications||[]).find(a=>a.businessCode===code),acct=account(db,code,owner?.name||'Business',owner?.email||'');let invoice=acct.invoices.find(i=>i.workflow===true&&i.paid<i.amount&&!['cancelled','refunded'].includes(i.status));if(dueLines.length){if(!invoice){invoice={number:nextInvoiceNumber(db),date:new Date().toISOString().slice(0,10),due:new Date(Date.now()+14*864e5).toISOString().slice(0,10),amount:0,paid:0,shares:{},lines:[],workflow:true};acct.invoices.unshift(invoice)}invoice.lines=dueLines;invoice.amount=dueLines.reduce((s,l)=>s+Number(l.amount),0);invoice.shares={};dueLines.forEach(l=>invoice.shares[l.masjid]=(invoice.shares[l.masjid]||0)+Number(l.amount)*Number(l.mosquePercent??70)/100)}}
  for (const acct of db.masjidPointFinance.accounts) for (const inv of acct.invoices.filter(i=>i.workflow && i.paid>=i.amount && i.amount>0&&!['cancelled','refunded'].includes(i.status))) {
    for (const line of inv.lines||[]) {
      if(line.requestId){const request=requests.find(r=>r.id===line.requestId);if(request&&request.paymentStatus!=='paid'){request.paymentStatus='paid';request.listing='ready';const share=Number(line.amount)*Number(line.mosquePercent??70)/100;notify(db,`business:${request.email}`,'Advertising payment approved',`Your £${Number(line.amount).toFixed(2)} payment for ${request.masjid} was verified.`,'business-portal#listings',`advert-paid-business-${request.id}`);notify(db,`masjid:${request.masjid}`,'Advertising payment received',`${request.name} paid £${Number(line.amount).toFixed(2)}. You can now enable the listing. Your £${share.toFixed(2)} share is due.`,'masjid-portal#requests',`advert-paid-masjid-${request.id}`);notify(db,'admin','Mosque settlement due',`£${share.toFixed(2)} is due to ${request.masjid}.`,'admin-payments#settlements',`advert-settlement-${request.id}`)}continue}
      const job=jobs.find(j=>j.id===line.jobId), choice=job?.masjids.find(m=>m.name===line.masjid);
      if (choice && choice.paymentStatus!=='paid') {
        choice.paymentStatus='paid'; job.status='live'; job.enabled=true; job.masjid=job.masjids.filter(m=>m.paymentStatus==='paid').map(m=>m.name).join(', ');
        notify(db,`business:${job.businessCode}`,`${job.title} is now live`,`Payment verified. The job is public through ${choice.name}.`,'public-jobs',`live-business-${job.id}-${choice.name}`);
        const share=choice.fee*Number(choice.mosquePercent??70)/100;notify(db,`masjid:${choice.name}`,`Job payment received`,`${job.business} paid £${choice.fee.toFixed(2)}. Your £${share.toFixed(2)} share is awaiting admin settlement.`,'masjid-portal#settlements',`paid-masjid-${job.id}-${choice.name}`);
        notify(db,'admin','Masjid settlement due',`£${share.toFixed(2)} is due to ${choice.name}.`,'admin-payments#settlements',`settlement-admin-${job.id}-${choice.name}`);
      }
    }
  }
}

const server=http.createServer(async (req,res)=>{
  // "//admin-login" is a protocol-relative URL: left as-is, new URL() reads the first
  // segment as the host and the path collapses to "/", quietly serving the home page for any
  // address with a doubled slash. Collapse repeated slashes before parsing.
  const url=new URL(String(req.url||'/').replace(/\/{2,}/g,'/'),`http://${req.headers.host}`);
  // An optional shared password in front of the whole site. It is off by default now: visitors
  // land on the site, as they should. Set PREVIEW_PASSWORD only to hide a deployment while it is
  // being worked on.
  //
  // What it used to be covering: GET /api/state published every password hash, which is now
  // stripped, and PUT /api/collection/:key still replaces a whole collection without
  // authenticating. That second one is open — see DEPLOY.md.
  if(process.env.PREVIEW_PASSWORD){
    const expected='Basic '+Buffer.from(`${process.env.PREVIEW_USER||'preview'}:${process.env.PREVIEW_PASSWORD}`).toString('base64');
    const offered=String(req.headers.authorization||'');
    const a=Buffer.from(offered),b=Buffer.from(expected);
    const ok=a.length===b.length&&crypto.timingSafeEqual(a,b);
    if(!ok){
      res.writeHead(401,{'WWW-Authenticate':'Basic realm="MasjidPoint preview", charset="UTF-8"','Content-Type':'text/plain','Cache-Control':'no-store'});
      return res.end('This preview is password protected.');
    }
  }
  try {
    if(url.pathname==='/api/admin/login'&&req.method==='POST'){const {email,passwordHash}=await body(req),db=await load(),user=(db.masjidPointAdminUsers||seed.masjidPointAdminUsers).find(x=>String(x.email).toLowerCase()===String(email||'').trim().toLowerCase()&&x.passwordHash===passwordHash&&x.status==='active');if(!user)return json(res,401,{error:'The email address or password is incorrect.'});return json(res,200,{user:{id:user.id,name:user.name,email:user.email,role:user.role}})}
    // An administrator changing their own password. Creating and suspending administrators is
    // Masjid and business sign-in. This used to happen entirely in the browser: the page fetched
    // every account from /api/state and compared password hashes locally, which meant every hash
    // on the platform had to be publicly readable for anyone to log in at all. The comparison
    // happens here now, and /api/state no longer publishes hashes.
    if(url.pathname==='/api/account/login'&&req.method==='POST'){
      const {email,passwordHash}=await body(req),db=await load();
      const wanted=String(email||'').trim().toLowerCase();
      const account=(db.masjidPointActivatedAccounts||[]).find(x=>String(x.email).toLowerCase()===wanted);
      // The same answer whether the account is unknown or the password is wrong, so this cannot be
      // used to find out which addresses are registered.
      if(!account||!account.passwordHash||account.passwordHash!==passwordHash)
        return json(res,401,{error:'No activated account matches that email and password.'});
      const {passwordHash:_ignored,...safe}=account;
      return json(res,200,{account:safe});
    }

    // Changing a masjid or business password, for the same reason: the portal used to read the
    // stored hash to check the current password before replacing it.
    if(url.pathname==='/api/account/password'&&req.method==='POST'){
      const {email,currentHash,nextHash}=await body(req),db=await load();
      if(!/^[a-f0-9]{64}$/.test(String(nextHash||''))) return json(res,400,{error:'A new password is required.'});
      if(currentHash===nextHash) return json(res,400,{error:'The new password is the same as the current one.'});
      const wanted=String(email||'').trim().toLowerCase();
      const account=(db.masjidPointActivatedAccounts||[]).find(x=>String(x.email).toLowerCase()===wanted);
      if(!account||account.passwordHash!==currentHash) return json(res,401,{error:'That is not your current password.'});
      account.passwordHash=nextHash; account.passwordChangedAt=new Date().toISOString();
      audit(db,{action:'account.password.changed',entityType:'account',entityId:account.reference||account.email,actor:account.email});
      await save(db);
      return json(res,200,{ok:true});
    }

    // restricted to the Platform Owner, but until now nobody — including the owner — could rotate
    // their own credentials once set, so a shared or exposed password could not be replaced.
    // Authority comes from proving the current password, not from a header a client can assert.
    if(url.pathname==='/api/admin/password'&&req.method==='POST'){
      const {email,currentHash,nextHash}=await body(req),db=await load();
      if(!/^[a-f0-9]{64}$/.test(String(nextHash||''))) return json(res,400,{error:'A new password is required.'});
      if(currentHash===nextHash) return json(res,400,{error:'The new password is the same as the current one.'});
      const users=db.masjidPointAdminUsers||[];
      const user=users.find(x=>String(x.email).toLowerCase()===String(email||'').trim().toLowerCase()&&x.status==='active');
      if(!user||user.passwordHash!==currentHash) return json(res,401,{error:'That is not your current password.'});
      user.passwordHash=nextHash;
      user.passwordChangedAt=new Date().toISOString();
      db.masjidPointFinance=db.masjidPointFinance||{accounts:[],unmatched:[],settled:{},settlementHistory:[],audit:[],cashRemittances:[]};
      db.masjidPointFinance.audit=db.masjidPointFinance.audit||[];
      db.masjidPointFinance.audit.unshift({id:`AUD-${Date.now()}-pw`,action:'admin.password.changed',entityType:'admin',entityId:user.id,
        actor:user.name,reason:'',before:{},after:{},metadata:{email:user.email},createdAt:user.passwordChangedAt});
      await save(db);
      return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/admin/users'&&req.method==='GET'){if(req.headers['x-admin-role']!=='super_admin')return json(res,403,{error:'Only the Platform Owner can manage administrators.'});const db=await load();return json(res,200,{users:(db.masjidPointAdminUsers||seed.masjidPointAdminUsers).map(({passwordHash,...user})=>user)})}
    if(url.pathname==='/api/admin/users'&&req.method==='POST'){if(req.headers['x-admin-role']!=='super_admin')return json(res,403,{error:'Only the Platform Owner can create administrators.'});const input=await body(req),db=await load(),email=String(input.email||'').trim().toLowerCase(),roles=['admin','finance_admin','reviewer'];if(!input.name||!email||!roles.includes(input.role)||!/^[a-f0-9]{64}$/.test(input.passwordHash||''))return json(res,400,{error:'Name, email, role and temporary password are required.'});db.masjidPointAdminUsers||=JSON.parse(JSON.stringify(seed.masjidPointAdminUsers));if(db.masjidPointAdminUsers.some(x=>x.email===email))return json(res,409,{error:'An administrator already uses this email.'});const user={id:`ADM-${String(db.masjidPointAdminUsers.length+1).padStart(4,'0')}`,name:String(input.name).trim(),email,role:input.role,status:'active',passwordHash:input.passwordHash,createdAt:new Date().toISOString(),createdBy:String(req.headers['x-admin-name']||'Platform Owner')};db.masjidPointAdminUsers.push(user);audit(db,{action:'admin.created',entityType:'administrator',entityId:user.id,actor:user.createdBy,after:{name:user.name,email:user.email,role:user.role}});await save(db);const{passwordHash,...safe}=user;return json(res,201,{user:safe})}
    if(url.pathname==='/api/admin/users/status'&&req.method==='POST'){if(req.headers['x-admin-role']!=='super_admin')return json(res,403,{error:'Only the Platform Owner can manage administrators.'});const input=await body(req),db=await load(),user=(db.masjidPointAdminUsers||[]).find(x=>x.id===input.id);if(!user)return json(res,404,{error:'Administrator not found.'});if(user.role==='super_admin')return json(res,400,{error:'The Platform Owner account cannot be deactivated.'});const before=user.status;user.status=input.status==='active'?'active':'deactivated';audit(db,{action:`admin.${user.status}`,entityType:'administrator',entityId:user.id,actor:String(req.headers['x-admin-name']||'Platform Owner'),before:{status:before},after:{status:user.status},metadata:{name:user.name,email:user.email}});await save(db);return json(res,200,{ok:true,status:user.status})}
    if(url.pathname==='/api/auth/activation/verify'&&req.method==='GET'){const db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='activation'&&!x.usedAt&&x.hash===tokenHash(url.searchParams.get('token')||'')&&new Date(x.expiresAt)>new Date());if(!record)return json(res,400,{error:'This activation link is invalid or has expired.'});return json(res,200,{reference:record.reference,email:record.email})}
    if(url.pathname==='/api/auth/activation/complete'&&req.method==='POST'){const {token,passwordHash}=await body(req),db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='activation'&&!x.usedAt&&x.hash===tokenHash(token||'')&&new Date(x.expiresAt)>new Date());if(!record||!/^[a-f0-9]{64}$/.test(passwordHash||''))return json(res,400,{error:'This activation request is invalid or expired.'});const app=(db.masjidPointAdminApplications||[]).find(x=>x.reference===record.reference);if(!app)return json(res,404,{error:'Account not found.'});db.masjidPointActivatedAccounts=(db.masjidPointActivatedAccounts||[]).filter(x=>x.reference!==record.reference);db.masjidPointActivatedAccounts.unshift({reference:record.reference,email:record.email,verified:true,activatedAt:new Date().toISOString(),passwordHash});app.status='activated';app.accountStatus='active';app.activatedAt=new Date().toISOString();record.usedAt=new Date().toISOString();await save(db);return json(res,200,{ok:true})}
    if(url.pathname==='/api/auth/password-reset/request'&&req.method==='POST'){const {email}=await body(req),db=await load(),normal=String(email||'').trim().toLowerCase(),account=(db.masjidPointActivatedAccounts||[]).find(x=>String(x.email).toLowerCase()===normal);if(account){const app=(db.masjidPointAdminApplications||[]).find(x=>x.reference===account.reference),token=crypto.randomBytes(32).toString('base64url');db.masjidPointEmailTokens||=[];db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>!(x.purpose==='password_reset'&&x.reference===account.reference&&!x.usedAt));db.masjidPointEmailTokens.push({hash:tokenHash(token),purpose:'password_reset',reference:account.reference,email:normal,expiresAt:new Date(Date.now()+1800000).toISOString(),createdAt:new Date().toISOString()});await save(db);try{await emailService.reset(normal,app?.name||'your account',token)}catch(error){console.error('Password reset email failed:',error.message)}}return json(res,200,{ok:true,message:'If an account matches that email, a reset link has been sent.'})}
    if(url.pathname==='/api/auth/password-reset/complete'&&req.method==='POST'){const {token,passwordHash}=await body(req),db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='password_reset'&&!x.usedAt&&x.hash===tokenHash(token||'')&&new Date(x.expiresAt)>new Date());if(!record||!/^[a-f0-9]{64}$/.test(passwordHash||''))return json(res,400,{error:'This reset link is invalid or has expired.'});const account=(db.masjidPointActivatedAccounts||[]).find(x=>x.reference===record.reference);if(!account)return json(res,404,{error:'Account not found.'});account.passwordHash=passwordHash;account.passwordChangedAt=new Date().toISOString();record.usedAt=new Date().toISOString();await save(db);return json(res,200,{ok:true})}
    if(url.pathname==='/api/finance/invoice/cancel'&&req.method==='POST'){const input=await body(req),db=await load(),invoice=cancelInvoice(db,input);await save(db);return json(res,200,{ok:true,invoice})}
    if(url.pathname==='/api/finance/refund'&&req.method==='POST'){const input=await body(req),db=await load(),record=refund(db,input);await save(db);return json(res,200,{ok:true,refund:record})}
    if(url.pathname==='/api/invoices/export.csv'&&req.method==='GET'){const db=await load();reconcile(db);await save(db);const content=invoiceRegister.toCsv(invoiceRegister.build(db));res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="masjidpoint-invoices.csv"','Cache-Control':'private, no-store'});return res.end(content)}
    if(url.pathname==='/api/shop/invoice.pdf'&&req.method==='GET'){const db=await load();reconcile(db);await save(db);const order=(db.masjidPointShopOrders||[]).find(x=>x.id===url.searchParams.get('order')||x.invoiceNumber===url.searchParams.get('order'));if(!order)return json(res,404,{error:'Order not found.'});return shopInvoicePdf(res,order)}
    if(url.pathname==='/api/finance/invoice.pdf'&&req.method==='GET'){const db=await load(),{account,invoice}=locateInvoice(db,url.searchParams.get('code'),url.searchParams.get('invoice'));return invoicePdf(res,account,invoice)}
    if(url.pathname==='/api/finance/export.csv'&&req.method==='GET'){const db=await load(),type=url.searchParams.get('type')||'invoices',content=csv(db,type);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="masjidpoint-${type}-${new Date().toISOString().slice(0,10)}.csv"`,'Cache-Control':'private, no-store'});return res.end('\ufeff'+content)}
    if(url.pathname==='/api/finance/audit'&&req.method==='GET'){const db=await load();return json(res,200,{items:db.masjidPointFinance?.audit||[]})}
    // Customer payment evidence for a shop order. The file arrives as a data URL and is written to
    // disk so an administrator can actually open it — unlike the business proof flow, which keeps
    // its uploads in the submitter's own browser and shows the reviewer nothing.
    if (url.pathname==='/api/shop/proof' && req.method==='POST') {
      const input=await body(req), db=await load();
      const order=(db.masjidPointShopOrders||[]).find(x=>x.id===input.order);
      if(!order) return json(res,404,{error:'Order not found.'});
      const amount=Number(input.amount), reference=String(input.bankReference||'').trim();
      if(!(amount>0)||!reference) return json(res,400,{error:'A payment amount and bank transaction reference are required.'});
      const id=`PAY-${Date.now()}`;
      let evidence=null;
      const match=/^data:(image\/png|image\/jpeg|image\/webp|application\/pdf);base64,(.+)$/.exec(String(input.file||''));
      if(input.file&&!match) return json(res,400,{error:'Evidence must be a PNG, JPG, WebP or PDF.'});
      if(match){
        const uploads=path.join(dataDir,'uploads');
        await fs.promises.mkdir(uploads,{recursive:true});
        const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'}[match[1]];
        const key=`${id}.${extension}`;
        await fs.promises.writeFile(path.join(uploads,key),Buffer.from(match[2],'base64'));
        evidence={key,type:match[1],name:String(input.fileName||key).slice(0,120)};
      }
      db.masjidPointPaymentProofs=db.masjidPointPaymentProofs||[];
      db.masjidPointPaymentProofs.unshift({id,orderId:order.id,invoice:order.invoiceNumber||order.id,
        customerName:order.customer?.name||'',customerEmail:order.customer?.email||'',amount,
        date:String(input.date||'').slice(0,10)||new Date().toISOString().slice(0,10),
        bankReference:reference,evidence,status:'submitted',submittedAt:new Date().toISOString(),adminNote:''});
      order.paymentStatus='submitted';
      order.paymentProofId=id;
      notify(db,'admin','Payment proof awaiting verification',`${order.customer?.name||'A customer'} submitted £${amount.toFixed(2)} for ${order.id}.`,`admin-payments.html?proof=${id}#proofs`,`shop-proof-${id}`);
      await save(db);
      return json(res,200,{ok:true,proof:id});
    }
    // Serves stored evidence back to the admin queue. basename() keeps the key from escaping the directory.
    if (url.pathname==='/api/shop/proof/file' && req.method==='GET') {
      const db=await load(), proof=(db.masjidPointPaymentProofs||[]).find(x=>x.id===url.searchParams.get('id'));
      if(!proof?.evidence?.key) return json(res,404,{error:'No evidence stored for this proof.'});
      try {
        const data=await fs.promises.readFile(path.join(dataDir,'uploads',path.basename(proof.evidence.key)));
        res.writeHead(200,{'Content-Type':proof.evidence.type||'application/octet-stream','Cache-Control':'no-store'});
        return res.end(data);
      } catch { return json(res,404,{error:'Evidence file is missing.'}); }
    }
    if (url.pathname==='/api/state' && req.method==='GET') { const db=await load(); reconcile(db); await save(db); return json(res,200,publicState(db)); }
    if (url.pathname.startsWith('/api/collection/') && req.method==='PUT') {
      const key=decodeURIComponent(url.pathname.split('/').pop());
      // Only the collections the application actually owns may be written, so a typo or a
      // crafted request cannot graft arbitrary keys onto the stored state.
      if(!WRITABLE_COLLECTIONS.has(key))return json(res,400,{error:`Unknown collection "${key}".`});
      const value=await body(req), db=await load(), previousJobs=JSON.parse(JSON.stringify(db.masjidPointJobs||[]));
      if(Array.isArray(seed[key])&&!Array.isArray(value))return json(res,400,{error:`Collection "${key}" must be an array.`});
      const before=JSON.parse(JSON.stringify(db)),actor=String(req.headers['x-admin-name']||'System').slice(0,100);if(key==='masjidPointFinance')value.audit=db.masjidPointFinance?.audit||[];db[key]=value; reconcile(db, previousJobs); await emailTransitions(before,db,actor);await save(db); return json(res,200,{ok:true,state:db});
    }
    if (url.pathname==='/api/notifications/read' && req.method==='POST') { const {id}=await body(req),db=await load(),n=db.masjidPointNotifications.find(x=>x.id===id); if(n)n.read=true; await save(db); return json(res,200,{ok:true}); }
    /* ---------------------------------------------------- individual accounts */
    // Community members who apply for jobs or shop do so without an account. These endpoints
    // let them claim one afterwards, so their existing applications and orders — matched on the
    // email they already gave — become visible in one place.
    if (url.pathname==='/api/customer/signup' && req.method==='POST') {
      const {name,email,phone,passwordHash,address}=await body(req),db=await load();
      const clean=String(email||'').trim().toLowerCase();
      if(!String(name||'').trim())return json(res,400,{error:'Please give your name.'});
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))return json(res,400,{error:'Please give a valid email address.'});
      if(!/^[a-f0-9]{64}$/.test(passwordHash||''))return json(res,400,{error:'A password is required.'});
      db.masjidPointCustomers||=[];
      if(db.masjidPointCustomers.some(c=>String(c.email).toLowerCase()===clean))
        return json(res,409,{error:'An account already exists for this email. Please sign in instead.'});
      // A masjid or business account uses the same sign-in form, so the email must be free there too.
      if((db.masjidPointActivatedAccounts||[]).some(a=>String(a.email).toLowerCase()===clean))
        return json(res,409,{error:'This email is already registered as a masjid or business account.'});
      const customer={
        id:`CUS-${Date.now()}`,name:String(name).trim(),email:clean,
        phone:String(phone||'').trim(),address:address&&typeof address==='object'?address:null,
        passwordHash,createdAt:new Date().toISOString()
      };
      db.masjidPointCustomers.push(customer);
      await save(db);
      const {passwordHash:_omit,...safe}=customer;
      return json(res,201,{ok:true,customer:safe});
    }
    if (url.pathname==='/api/customer/login' && req.method==='POST') {
      const {email,passwordHash}=await body(req),db=await load();
      const clean=String(email||'').trim().toLowerCase();
      const customer=(db.masjidPointCustomers||[]).find(c=>String(c.email).toLowerCase()===clean);
      if(!customer||customer.passwordHash!==passwordHash)return json(res,401,{error:'Email or password is incorrect.'});
      const {passwordHash:_omit,...safe}=customer;
      return json(res,200,{ok:true,customer:safe});
    }
    // Individuals give very little up front, so the portal lets them fill in the rest later.
    if (url.pathname==='/api/customer/profile' && req.method==='POST') {
      const {id,passwordHash,name,phone,address,newPasswordHash}=await body(req),db=await load();
      const customer=(db.masjidPointCustomers||[]).find(c=>c.id===id);
      if(!customer||customer.passwordHash!==passwordHash)return json(res,401,{error:'Please sign in again.'});
      if(name!==undefined&&String(name).trim())customer.name=String(name).trim();
      if(phone!==undefined)customer.phone=String(phone||'').trim();
      if(address!==undefined)customer.address=address&&typeof address==='object'?address:null;
      if(newPasswordHash){
        if(!/^[a-f0-9]{64}$/.test(newPasswordHash))return json(res,400,{error:'The new password is not valid.'});
        customer.passwordHash=newPasswordHash;
      }
      customer.updatedAt=new Date().toISOString();
      await save(db);
      const {passwordHash:_omit,...safe}=customer;
      return json(res,200,{ok:true,customer:safe});
    }

    // A mosque paying MasjidPoint back for cash it took at the counter. The opposite direction
    // to /api/settle, so it clears the orders rather than paying a share out.
    if (url.pathname==='/api/mosque-cash/remit' && req.method==='POST') {
      const {masjid,transactionReference,note,actor}=await body(req),db=await load();
      if(!String(transactionReference||'').trim())return json(res,400,{error:'A bank transaction reference is required.'});
      reconcile(db);const finance=db.masjidPointFinance;finance.cashRemittances||=[];
      const outstanding=settlementRegister.cashHeld(db,masjid);
      const amount=Number(outstanding.reduce((sum,item)=>sum+item.owed,0).toFixed(2));
      if(amount<=0)return json(res,400,{error:'This mosque does not owe anything from cash sales.'});
      const record={id:`CSH-${Date.now()}`,masjid,orderIds:outstanding.map(item=>item.id),amount,transactionReference:String(transactionReference).trim(),note:String(note||'').trim(),receivedAt:new Date().toISOString()};
      finance.cashRemittances.push(record);
      audit(db,{action:'cash.remitted',entityType:'masjid',entityId:masjid,actor:String(actor||req.headers['x-admin-name']||'Super Admin').slice(0,100),reason:record.note,after:{amount},metadata:{amount,transactionReference,orders:record.orderIds.length}});
      notify(db,`masjid:${masjid}`,'Cash payment recorded',`MasjidPoint recorded your £${amount.toFixed(2)} payment for cash shop sales.`,'masjid-portal#shop-orders',`cash-remit-${record.id}`);
      await save(db);
      return json(res,200,{ok:true,amount,orders:record.orderIds.length});
    }
    // One transfer that clears both directions at once: the mosque's unpaid shares and the cash
    // it still holds are settled together, so only the net amount actually moves.
    if (url.pathname==='/api/settle/net' && req.method==='POST') {
      const {masjid,transactionReference,note,actor}=await body(req),db=await load();
      if(!String(transactionReference||'').trim())return json(res,400,{error:'A bank transaction reference is required.'});
      reconcile(db);const finance=db.masjidPointFinance;finance.settlementHistory||=[];finance.cashRemittances||=[];
      const earned=settlementRegister.earnings(db,masjid),cash=settlementRegister.cashHeld(db,masjid);
      const owedOut=Number([...earned.jobs,...earned.adverts,...earned.shop].reduce((s,i)=>s+i.share,0).toFixed(2));
      const owedIn=Number(cash.reduce((s,i)=>s+i.owed,0).toFixed(2));
      if(owedOut<=0&&owedIn<=0)return json(res,400,{error:'Nothing is outstanding in either direction.'});
      const net=Number((owedOut-owedIn).toFixed(2)),reference=String(transactionReference).trim(),cleanNote=String(note||'').trim();
      const settlementId=`SET-${Date.now()}`,stampedAt=new Date().toISOString();
      const entry=extra=>({masjid,transactionReference:reference,note:cleanNote,settledAt:stampedAt,netSettlement:true,...extra});
      earned.jobs.forEach(m=>finance.settlementHistory.push(entry({id:`${settlementId}-${m.id}`,jobId:m.id,amount:m.share})));
      earned.adverts.forEach(i=>finance.settlementHistory.push(entry({id:`${settlementId}-${i.id}`,requestId:i.id,amount:i.share})));
      earned.shop.forEach(i=>finance.settlementHistory.push(entry({id:`${settlementId}-${i.id}`,orderId:i.id,amount:i.share})));
      if(owedOut>0)finance.settled[masjid]=Number(((finance.settled[masjid]||0)+owedOut).toFixed(2));
      if(owedIn>0)finance.cashRemittances.push({id:`CSH-${Date.now()}`,masjid,orderIds:cash.map(i=>i.id),amount:owedIn,transactionReference:reference,note:cleanNote,receivedAt:stampedAt,netSettlement:true});
      audit(db,{action:'settlement.net',entityType:'masjid',entityId:masjid,actor:String(actor||req.headers['x-admin-name']||'Super Admin').slice(0,100),reason:cleanNote,after:{net},metadata:{owedOut,owedIn,net,transactionReference:reference,settlementId}});
      notify(db,`masjid:${masjid}`,'Settlement completed',net>=0?`MasjidPoint sent £${Math.abs(net).toFixed(2)} after offsetting £${owedIn.toFixed(2)} of cash you collected.`:`MasjidPoint recorded £${Math.abs(net).toFixed(2)} received from you after offsetting £${owedOut.toFixed(2)} of shares owed.`,'masjid-portal#shop-orders',`net-settle-${settlementId}`);
      await save(db);
      return json(res,200,{ok:true,owedOut,owedIn,net});
    }
    if (url.pathname==='/api/settle' && req.method==='POST') {
      const {masjid,transactionReference,note,evidence}=await body(req),db=await load();if(!String(transactionReference||'').trim())return json(res,400,{error:'A bank transaction reference is required.'});if(evidence&&(!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(String(evidence.dataUrl||''))||String(evidence.dataUrl).length>7e6))return json(res,400,{error:'Settlement evidence must be a PNG, JPG, WEBP or PDF no larger than 5 MB.'});const savedEvidence=evidence?{fileName:String(evidence.fileName||'settlement-evidence').slice(0,180),mimeType:String(evidence.mimeType||'application/octet-stream').slice(0,100),dataUrl:String(evidence.dataUrl)}:null;reconcile(db); const finance=db.masjidPointFinance; finance.settlementHistory ||= [];
      // Jobs, adverts and bank-paid shop orders all settle together through the shared register.
      const earned=settlementRegister.earnings(db,masjid),paid=earned.jobs,adverts=earned.adverts,shopShares=earned.shop;
      const amount=Number([...paid,...adverts,...shopShares].reduce((s,item)=>s+item.share,0).toFixed(2)); if(amount<=0)return json(res,400,{error:'Nothing is currently due.'});
      const settlementId=`SET-${Date.now()}`,stampedAt=new Date().toISOString(),entry=extra=>({masjid,transactionReference:String(transactionReference).trim(),note:String(note||'').trim(),settledAt:stampedAt,...extra});
      paid.forEach(m=>finance.settlementHistory.push(entry({id:`${settlementId}-${m.id}`,jobId:m.id,amount:m.share})));
      adverts.forEach(item=>finance.settlementHistory.push(entry({id:`${settlementId}-${item.id}`,requestId:item.id,amount:item.share})));
      shopShares.forEach(item=>finance.settlementHistory.push(entry({id:`${settlementId}-${item.id}`,orderId:item.id,amount:item.share}))); finance.settled[masjid]=(finance.settled[masjid]||0)+amount;audit(db,{action:'settlement.sent',entityType:'masjid',entityId:masjid,reason:String(note||'').trim(),before:{settled:Number(finance.settled[masjid])-amount},after:{settled:finance.settled[masjid]},metadata:{amount,transactionReference,settlementId}});const masjidApp=(db.masjidPointAdminApplications||[]).find(x=>x.type==='masjid'&&x.name===masjid);try{await emailService.settlement(masjidApp?.email,masjid,amount)}catch(error){console.error('Settlement email failed:',error.message)}
      if(savedEvidence)finance.settlementHistory.filter(item=>item.id.startsWith(settlementId)).forEach(item=>item.evidence=savedEvidence);notify(db,`masjid:${masjid}`,'Settlement sent',`Admin marked £${amount.toFixed(2)} as transferred to your mosque.`,'masjid-portal#settlements',`settled-${masjid}-${Date.now()}`); save(db); return json(res,200,{ok:true,amount,state:db});
    }
    // The URL space stays flat — /styles.css, /masjid-shop.js, /assets/logo.svg — while the files
    // themselves are filed by kind. Each request is resolved against these roots in order, so
    // moving a file between them never changes the address anything links to.
    const staticRoots=[path.join(root,'public'),path.join(root,'public','css'),path.join(root,'public','js'),path.join(root,'lib'),root];
    // Each masjid portal section has its own address, served by the one portal document.
    // portal-section.js then shows the section that address names. They are not separate files
    // because masjid-portal.js reads its elements without checking they exist, so a page missing
    // the parts it does not show would throw on every one of them.
    const PORTAL_SECTIONS={'/masjid-requests':1,'/masjid-jobs':1,'/masjid-orders':1,'/masjid-qr':1};
    const requested=decodeURIComponent(
      url.pathname==='/'?'/index':(PORTAL_SECTIONS[url.pathname]?'/masjid-portal':url.pathname));
    const usable=candidate=>fs.existsSync(candidate)&&!fs.statSync(candidate).isDirectory();
    let file=null;
    for(const base of staticRoots){
      const candidate=path.join(base,requested);
      // Keep a traversing path ("/../server.js") inside the root it was resolved against.
      if(!candidate.startsWith(base))return json(res,403,{error:'Forbidden'});
      if(usable(candidate)){file=candidate;break}
      // Pages are linked without their extension ("/masjids"), so fall back to the .html file.
      // The extension still resolves, which keeps older links and bookmarks working.
      if(!path.extname(candidate)&&usable(`${candidate}.html`)){file=`${candidate}.html`;break}
    }
    if(!file)return json(res,404,{error:'Not found'});
    const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'}[path.extname(file).toLowerCase()]||'application/octet-stream'; res.writeHead(200,{'Content-Type':type,'Cache-Control':['.html','.js','.css'].includes(path.extname(file).toLowerCase())?'no-store':'public, max-age=3600'}); fs.createReadStream(file).pipe(res);
  } catch(e) { json(res,500,{error:e.message}); }
});
// If this deployment has no administrators yet, the bootstrap account above is the only way in, so
// say what its password is. Printed once, to the log, and only when it was generated rather than
// supplied — there is otherwise no way for anyone to know it.
async function announceBootstrapAdmin(){
  if(!bootstrapAdminUsesDefault) return;
  try{
    const db=await load();
    // Not "are there no administrators" — a fresh deployment loads the seed, so there is always
    // one. The question is whether the bootstrap password still opens an account, which is exactly
    // when it is worth saying that a published default is what stands in front of the panel.
    const hash=crypto.createHash('sha256').update(bootstrapAdminPassword).digest('hex');
    const bootstrap=(db.masjidPointAdminUsers||[]).find(x=>x.passwordHash===hash&&x.status==='active');
    if(!bootstrap) return;
    console.log('');
    console.log(`  Signing in as ${bootstrap.email} still uses the default password.`);
    console.log('  It is published in this repository, so anyone can read it. Change it under');
    console.log('  Admin profiles, or set ADMIN_PASSWORD, and this notice stops.');
    console.log('');
  }catch{}
}

Promise.all([repository.init(),emailService.init()])
  .then(announceBootstrapAdmin)
  .then(()=>server.listen(port,'127.0.0.1',()=>console.log(`MasjidPoint server: http://127.0.0.1:${port} (${process.env.DATABASE_URL?'PostgreSQL':'development JSON fallback'})`)))
  .catch(error=>{console.error(`Startup failed: ${error.message}`);process.exit(1)});
