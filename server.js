const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const {StateRepository}=require('./lib/db');
const {EmailService}=require('./lib/email-service');
const {audit,locateInvoice,cancelInvoice,refund,csv,invoicePdf}=require('./lib/finance-service');
const fulfilment=require('./lib/shop-fulfilment');
const {shopInvoicePdf}=require('./lib/shop-invoice');
const invoiceRegister=require('./lib/invoice-register');
const settlementRegister=require('./lib/settlement-register');
const {PrivateObjectStorage}=require('./lib/object-storage');

const root = __dirname;
// One store per server. The test runner gives each suite a directory of its own so the suites stop
// overwriting each other's accounts; everything else leaves this unset and uses ./data.
const dataDir = process.env.MASJIDPOINT_DATA_DIR
  ? path.resolve(process.env.MASJIDPOINT_DATA_DIR)
  : path.join(root, 'data');
const dataFile = path.join(dataDir, 'masjidpoint.json');
const port = Number(process.env.PORT || 4173);

// The bootstrap administrator, used only when a deployment starts with no administrators of its
// own. The default is deliberately fixed and known, so that wiping the data never locks anyone out
// of the panel — change it from Admin profiles once you are in, and the stored password takes over.
//
// It is a known default in a public repository, so it is only ever a way in, never a way to stay:
// set ADMIN_PASSWORD on any deployment that matters, and change it in the panel on the rest.
const bootstrapAdminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64url');
const bootstrapAdminGenerated = !process.env.ADMIN_PASSWORD;
const BCRYPT_ROUNDS = Math.max(10, Math.min(14, Number(process.env.BCRYPT_ROUNDS || 12)));
const PASSWORD_MIN_LENGTH = 12;
const passwordStrong = value => typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
const passwordDigest = value => bcrypt.hash(String(value), BCRYPT_ROUNDS);
async function passwordForStorage(input){
  if(passwordStrong(input.password))return passwordDigest(input.password);
  if(process.env.MASJIDPOINT_TEST_MODE==='1'&&/^[a-f0-9]{64}$/.test(String(input.passwordHash||'')))return input.passwordHash;
  throw Object.assign(new Error('Use at least 12 characters with uppercase, lowercase, a number and a symbol.'),{status:400});
}
async function passwordMatches(record, password, legacyHash){
  if(!record?.passwordHash) return false;
  if(String(record.passwordHash).startsWith('$2')) return typeof password === 'string' && bcrypt.compare(password, record.passwordHash);
  const candidate = typeof password === 'string' ? crypto.createHash('sha256').update(password).digest('hex') : String(legacyHash || '');
  const a=Buffer.from(String(record.passwordHash)),b=Buffer.from(candidate);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return false;
  if(typeof password === 'string'){record.passwordHash=await passwordDigest(password);record.passwordMigratedAt=new Date().toISOString()}
  return true;
}

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
  masjidPointAdminUsers:[{id:'ADM-0001',name:'Platform Owner',email:process.env.ADMIN_EMAIL||'admin@masjidpoint.co.uk',role:'super_admin',status:'active',passwordHash:bcrypt.hashSync(bootstrapAdminPassword,BCRYPT_ROUNDS),twoFactorEnabled:false,createdAt:'2026-08-02T00:00:00.000Z'}]
};

// The collections a client may replace wholesale through /api/collection/:key.
const WRITABLE_COLLECTIONS=new Set([...Object.keys(seed),'masjidPointEmailTokens']);

const repository=new StateRepository({seed,root,file:dataFile});
const emailService=new EmailService(root,path.join(dataDir,'email-outbox'));
const objectStorage=new PrivateObjectStorage({localDir:path.join(dataDir,'private-objects')});
function load(){return repository.load()}

// ---- sessions ---------------------------------------------------------------
//
// Signing in used to leave no trace on the server: the browser kept a note of who it was and the
// server took every request at face value. That was survivable when the platform only ran on a
// machine its operator controlled, and is not now it is on the open internet — PUT
// /api/collection/:key would let anyone replace the entire database.
//
// A token is a signed statement of who signed in. The secret never leaves the server, so a client
// can hold a token but cannot write one, and cannot promote itself to administrator by editing
// what it holds.
//
// SESSION_SECRET should be set in production. Without it a random one is generated per start,
// which is safe but signs everyone out when the process restarts.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MINUTES = 30;

function issueSession(payload){
  const body = { ...payload, exp: Date.now() + SESSION_MINUTES * 60000 };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}

// The token is also set as a cookie, because evidence and CVs are opened as ordinary links in a
// new tab — a plain navigation, which carries no custom header. HttpOnly so page scripts cannot
// read it, SameSite=Lax so another site cannot make the browser use it.
//
// Secure comes from how the request actually arrived, not from NODE_ENV. This deployment serves
// over HTTPS while still running in JSON mode, so keying it to NODE_ENV would have left the
// session cookie usable over plain http on the very deployment that has a certificate. nginx
// terminates TLS and passes X-Forwarded-Proto, which is what this reads.
// One month on, without the overflow the obvious version has: setMonth on the 31st of January
// gives the 3rd of March, skipping February altogether and drifting the billing date every time
// it happens. Paying on a day the next month does not have settles on that month's last day.
function addMonth(from){
  const date=new Date(from), day=date.getDate(), target=new Date(date);
  target.setDate(1);
  target.setMonth(target.getMonth()+1);
  const lastDay=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
  target.setDate(Math.min(day,lastDay));
  target.setHours(date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds());
  return target;
}

// One email, one kind of account. Sign-in tries the individual account first and falls through to
// masjid and business, so an address holding two kinds means one of them can never get in — and a
// masjid registering with the address its business already uses was accepted, because the check
// only ever looked at masjid applications. A business applying to several mosques is a feature and
// is left alone; a second application to the same mosque is not.
function emailBelongsElsewhere(db,email,{allowBusiness=false}={}){
  const wanted=String(email||'').trim().toLowerCase();
  if(!wanted)return null;
  const applications=(db.masjidPointAdminApplications||[]).filter(a=>String(a.email||'').toLowerCase()===wanted);
  const masjid=applications.find(a=>a.type==='masjid');
  if(masjid)return 'This email address is already registered to a masjid on MasjidPoint. Use a different address, or sign in.';
  const business=applications.find(a=>a.type==='business');
  if(business&&!allowBusiness)return 'This email address is already registered to a business on MasjidPoint. Use a different address, or sign in.';
  if((db.masjidPointCustomers||[]).some(c=>String(c.email||'').toLowerCase()===wanted))
    return 'This email address already has a personal MasjidPoint account. Use a different address for an organisation.';
  return null;
}

// Sending anything by email is decided from the store, and the store is read before it is written —
// so three quick presses of "send code" all read the same "nothing sent recently", all pass, and
// three emails go out with only the last code valid. The throttle was never wrong, it was outrun.
// This holds the door across the gap between reading and writing, which is all there was.
const emailInFlight=new Set();
const beginEmailSend=key=>emailInFlight.has(key)?false:(emailInFlight.add(key),true);
const endEmailSend=key=>emailInFlight.delete(key);

function requestIsSecure(req){
  const forwarded=String(req?.headers?.['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();
  if(forwarded)return forwarded==='https';
  return !!req?.socket?.encrypted||process.env.NODE_ENV==='production';
}
function sessionCookie(token,req){
  const secure=requestIsSecure(req)?'; Secure':'';
  return { 'Set-Cookie': `mp_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MINUTES*60}${secure}` };
}

// Small, bounded in-memory limiters protect credential, OTP, reset and upload endpoints. AWS
// should still add a WAF rule; this layer protects the application even when reached directly.
const rateBuckets=new Map();
function clientIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim()}
function limit(req,res,name,max,windowMs,identity=''){
  const now=Date.now(),key=`${name}:${clientIp(req)}:${String(identity).toLowerCase()}`,old=rateBuckets.get(key);
  const bucket=!old||old.reset<=now?{count:0,reset:now+windowMs}:old;bucket.count++;rateBuckets.set(key,bucket);
  if(rateBuckets.size>10000)for(const[k,v]of rateBuckets)if(v.reset<=now)rateBuckets.delete(k);
  if(bucket.count<=max)return true;
  res.setHeader('Retry-After',String(Math.max(1,Math.ceil((bucket.reset-now)/1000))));json(res,429,{error:'Too many attempts. Please wait and try again.'});return false;
}
function csrfAllowed(req){
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method)||process.env.MASJIDPOINT_TEST_MODE==='1')return true;
  // Accept the address the request actually came in on as well as the configured one. Comparing
  // only against APP_BASE_URL meant that setting it to https while the site was still served over
  // http refused every sign-in on the platform — administrators, masjids, businesses, everyone —
  // with a message that gave no hint the two disagreed about the scheme. The request's own origin
  // is same-origin by definition, so accepting it protects against cross-site posts just as well
  // and cannot lock anyone out over a mismatched setting.
  const proto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim()
    ||(req.socket?.encrypted?'https':(process.env.NODE_ENV==='production'?'https':'http'));
  const expected=new Set();
  for(const candidate of [process.env.APP_BASE_URL,`${proto}://${req.headers.host}`]){
    if(!candidate)continue;
    try{expected.add(new URL(candidate).origin)}catch{}
  }
  const origin=String(req.headers.origin||'');
  const site=String(req.headers['sec-fetch-site']||'');
  if(process.env.NODE_ENV==='production'&&!origin&&!site)return false;
  return (!origin||expected.has(origin))&&(!site||['same-origin','same-site','none'].includes(site));
}

function readSession(req){
  let raw = String(req.headers['x-masjidpoint-session'] || '').trim();
  if(!raw){
    const cookie = String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('mp_session='));
    if(cookie) raw = decodeURIComponent(cookie.slice('mp_session='.length));
  }
  if(!raw || !raw.includes('.')) return null;
  const [data, mac] = raw.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  // Compared in constant time, and only after checking the lengths match — timingSafeEqual throws
  // on a length mismatch, which would itself leak.
  const a = Buffer.from(mac || ''), b = Buffer.from(expected);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(data, 'base64url').toString());
    return Number(session.exp) > Date.now() ? session : null;
  } catch { return null; }
}

function isAdminSession(session){
  return session?.role==='admin' && ['super_admin','admin','finance_admin','reviewer'].includes(session.adminRole);
}
function requireAdmin(req,res,roles){
  const session=readSession(req);
  if(!isAdminSession(session)){
    json(res,401,{error:'Administrator sign-in required.'});
    return null;
  }
  if(roles&&!roles.includes(session.adminRole)){
    json(res,403,{error:'Your administrator role cannot perform this action.'});
    return null;
  }
  return session;
}
function accountApplication(db,session){
  if(session?.role!=='account') return null;
  const app=(db.masjidPointAdminApplications||[]).find(item=>item.reference===session.reference)||null;
  return app&&['approved','activated'].includes(app.status)&&!['blocked','deactivated'].includes(app.accountStatus)?app:null;
}
function ownsBusinessCode(db,session,code){
  const app=accountApplication(db,session);
  return app?.type==='business' && [app.businessCode,app.reference].includes(String(code||''));
}
function rowId(row){
  return String(row&&(row.id??row.reference??row.number??row.code??row.email??''));
}
function ownsCollectionRow(db,session,key,row){
  if(!session||!row)return false;
  if(session.role==='customer'){
    const email=String(session.email||'').toLowerCase();
    return (key==='masjidPointCustomers'&&row.id===session.id)||
      (key==='masjidPointJobApplications'&&String(row.email||'').toLowerCase()===email)||
      (key==='masjidPointShopOrders'&&String(row.customer?.email||'').toLowerCase()===email)||
      (key==='masjidPointNotifications'&&[ `customer:${session.id}`,`customer:${email}` ].includes(row.audience));
  }
  const app=accountApplication(db,session);
  if(!app)return false;
  if(key==='masjidPointAdminApplications')return row.reference===app.reference;
  if(app.type==='business'){
    const codes=new Set([app.reference,app.businessCode].filter(Boolean));
    return (key==='masjidPointJobs'&&(codes.has(row.businessReference)||codes.has(row.businessCode)))||
      (key==='masjidPointBusinessRequests'&&(codes.has(row.reference)||codes.has(row.businessReference)||codes.has(row.businessCode)))||
      (key==='masjidPointPaymentProofs'&&codes.has(row.businessCode))||
      (key==='masjidPointNotifications'&&codes.has(String(row.audience||'').replace(/^business:/,'')));
  }
  if(app.type==='masjid'){
    const targeted=row.masjidReference===app.reference||row.masjid===app.name||row.name===app.name||row.collectionMasjidReference===app.reference||row.collectionMasjidName===app.name;
    return (key==='masjidPointBusinessRequests'&&targeted)||
      (key==='masjidPointJobs'&&(row.masjids||[]).some(item=>item.reference===app.reference||item.name===app.name))||
      (key==='masjidPointShopOrders'&&targeted)||
      (key==='masjidPointNotifications'&&[ `masjid:${app.name}`,`masjid:${app.reference}` ].includes(row.audience));
  }
  return false;
}

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
function stateForSession(db,session){
  const safe=publicState(db);
  if(process.env.MASJIDPOINT_TEST_MODE==='1'||isAdminSession(session)) return safe;

  const publicApplications=(db.masjidPointAdminApplications||[]).map(app=>({
    id:app.id,reference:app.reference,type:app.type,name:app.name,status:app.status,
    accountStatus:app.accountStatus,businessCode:app.businessCode,submittedAt:app.submittedAt,
    activatedAt:app.activatedAt,category:app.category,postcode:app.postcode||app.details?.Postcode,
    address:app.address||app.details?.Address,location:app.location,photo:app.type==='masjid'?(app.photo||''):'',
    donationBankDetails:app.donationBankDetails?.active?app.donationBankDetails:{active:true,unavailable:true,message:'Donation bank details have not been published for this mosque yet.'}
  }));
  const result={
    masjidPointJobs:(db.masjidPointJobs||[]).filter(job=>job.status==='live'||job.enabled),
    masjidPointFinance:{accounts:[],unmatched:[],settled:{},settlementHistory:[],audit:[],cashRemittances:[]},
    masjidPointPaymentProofs:[],masjidPointBusinessRequests:(db.masjidPointBusinessRequests||[]).filter(item=>item.status==='approved'&&item.paymentStatus==='paid'&&item.listing==='enabled').map(item=>({id:item.id,reference:item.reference,masjid:item.masjid,masjidReference:item.masjidReference,name:item.name,category:item.category,email:item.email,phone:item.phone,description:item.description,website:item.website,status:item.status,paymentStatus:item.paymentStatus,listing:item.listing,publicPhotoConsent:Boolean(item.publicPhotoConsent),hasLogo:Boolean(item.logo),hasPublicContactPhoto:Boolean(item.publicPhotoConsent&&item.contactPhoto)})),
    masjidPointBusinessListings:(db.masjidPointBusinessListings||[]).filter(item=>item.status==='live'||item.enabled),
    masjidPointAdminApplications:publicApplications,masjidPointActivatedAccounts:[],
    masjidPointJobApplications:[],masjidPointMasjidPricing:db.masjidPointMasjidPricing||[],
    masjidPointProducts:(db.masjidPointProducts||[]).filter(item=>item.visibility!=='hidden'),
    masjidPointShopOrders:[],masjidPointPlatformSettings:{bankDetails:db.masjidPointPlatformSettings?.bankDetails?.active?db.masjidPointPlatformSettings.bankDetails:{active:false}},
    masjidPointNotifications:[],masjidPointCustomers:[],masjidPointAdminUsers:[],masjidPointEmailTokens:[]
  };
  if(session?.role==='account'){
    const app=accountApplication(db,session);
    if(!app)return result;
    result.masjidPointAdminApplications=publicApplications.map(item=>item.reference===app.reference?{...item,...app,passwordHash:undefined}:item);
    result.masjidPointActivatedAccounts=(db.masjidPointActivatedAccounts||[]).filter(item=>item.reference===app.reference).map(({passwordHash,...item})=>item);
    if(app.type==='business'){
      const codes=new Set([app.reference,app.businessCode].filter(Boolean));
      const ownJobs=(db.masjidPointJobs||[]).filter(job=>codes.has(job.businessReference)||codes.has(job.businessCode));
      const ids=new Set(ownJobs.map(job=>job.id));
      result.masjidPointJobs=[...result.masjidPointJobs,...ownJobs.filter(job=>!result.masjidPointJobs.some(item=>item.id===job.id))];
      result.masjidPointBusinessRequests=(db.masjidPointBusinessRequests||[]).filter(item=>codes.has(item.reference)||codes.has(item.businessReference)||codes.has(item.businessCode));
      result.masjidPointPaymentProofs=(db.masjidPointPaymentProofs||[]).filter(item=>codes.has(item.businessCode));
      result.masjidPointJobApplications=(db.masjidPointJobApplications||[]).filter(item=>ids.has(item.jobId)||codes.has(item.businessCode));
      result.masjidPointFinance={...result.masjidPointFinance,accounts:(db.masjidPointFinance?.accounts||[]).filter(item=>codes.has(item.code))};
      result.masjidPointNotifications=(db.masjidPointNotifications||[]).filter(item=>codes.has(String(item.audience||'').replace(/^business:/,'')));
    }else if(app.type==='masjid'){
      const matches=item=>item.masjidReference===app.reference||item.masjid===app.name||item.name===app.name;
      result.masjidPointJobs=(db.masjidPointJobs||[]).filter(job=>(job.masjids||[]).some(matches));
      result.masjidPointBusinessRequests=(db.masjidPointBusinessRequests||[]).filter(matches);
      result.masjidPointShopOrders=(db.masjidPointShopOrders||[]).filter(order=>order.collectionMasjidReference===app.reference||order.collectionMasjidName===app.name);
      result.masjidPointNotifications=(db.masjidPointNotifications||[]).filter(item=>item.audience===`masjid:${app.name}`||item.audience===`masjid:${app.reference}`);
      result.masjidPointFinance={...result.masjidPointFinance,accounts:(db.masjidPointFinance?.accounts||[]).map(account=>({...account,invoices:(account.invoices||[]).filter(invoice=>(invoice.lines||[]).some(line=>line.masjid===app.name))})).filter(account=>account.invoices.length),settled:{[app.name]:db.masjidPointFinance?.settled?.[app.name]||0},settlementHistory:(db.masjidPointFinance?.settlementHistory||[]).filter(item=>item.masjid===app.name),cashRemittances:(db.masjidPointFinance?.cashRemittances||[]).filter(item=>item.masjid===app.name)};
    }
  }else if(session?.role==='customer'){
    const email=String(session.email||'').toLowerCase();
    result.masjidPointCustomers=(db.masjidPointCustomers||[]).filter(item=>String(item.email).toLowerCase()===email).map(({passwordHash,...item})=>item);
    result.masjidPointJobApplications=(db.masjidPointJobApplications||[]).filter(item=>String(item.email).toLowerCase()===email);
    result.masjidPointShopOrders=(db.masjidPointShopOrders||[]).filter(item=>String(item.customer?.email).toLowerCase()===email&&item.status!=='payment_pending'&&!(item.paymentStatus==='awaiting_bank_transfer'&&!item.paymentProofId));
    result.masjidPointNotifications=(db.masjidPointNotifications||[]).filter(item=>item.audience===`customer:${session.id}`||item.audience===`customer:${email}`);
  }
  return result;
}
function save(db){return repository.save(db)}
const tokenHash=token=>crypto.createHash('sha256').update(token).digest('hex');
async function emailTransitions(before,after,actor='Super Admin'){
  after.masjidPointEmailTokens ||= [];
  after.masjidPointFinance ||= {accounts:[], unmatched:[], settled:{}, settlementHistory:[], audit:[]};
  after.masjidPointFinance.audit ||= [];
  const oldApps=before.masjidPointAdminApplications||[];
  for(const app of after.masjidPointAdminApplications||[]){const old=oldApps.find(x=>x.reference===app.reference);if(old?.status===app.status||!['approved','rejected'].includes(app.status))continue;try{if(app.status==='approved'){const token=crypto.randomBytes(32).toString('base64url'),code=process.env.MASJIDPOINT_TEST_MODE==='1'?'123456':String(crypto.randomInt(0,1000000)).padStart(6,'0');after.masjidPointEmailTokens=after.masjidPointEmailTokens.filter(x=>!(['activation','activation_otp'].includes(x.purpose)&&x.reference===app.reference&&!x.usedAt));after.masjidPointEmailTokens.push({hash:tokenHash(token),purpose:'activation',reference:app.reference,email:app.email,expiresAt:new Date(Date.now()+48*3600000).toISOString(),createdAt:new Date().toISOString()});await emailService.approval(app,token,code)}else await emailService.rejection(app)}catch(error){console.error('Application email failed:',error.message)}}
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
function json(res, status, body, extraHeaders) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders||{}) }); res.end(JSON.stringify(body)); }
function body(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', c => { raw += c; if (raw.length > 8e6) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch(e) { reject(e); } }); }); }
function dataUrlFile(value){const match=/^data:([^;,]+);base64,(.+)$/.exec(String(value||''));return match?{mime:match[1],buffer:Buffer.from(match[2],'base64')}:null}
async function privateFile(res,document){
  if(!document?.objectKey)return json(res,404,{error:'The private file is missing.'});
  if(objectStorage.client){const signed=await objectStorage.signedRead(document.objectKey,document.originalName||'document');res.writeHead(302,{Location:signed,'Cache-Control':'private, no-store'});return res.end()}
  try{const data=await objectStorage.read(document);res.writeHead(200,{'Content-Type':document.mimeType||'application/octet-stream','Content-Disposition':`inline; filename="${String(document.originalName||'document').replace(/[^\w.\- ]/g,'_')}"`,'Cache-Control':'private, no-store'});return res.end(data)}catch{return json(res,404,{error:'The private file is missing.'})}
}
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
  // A business keeps one payment code for life: it is what it quotes when it pays, and what every
  // invoice is filed under. If the code is missing, look for the account this business already has
  // before minting a new one — otherwise a business whose code was lost gets a second account, and
  // the same advertising request is billed under both. That is how one business came to owe £45
  // for £25 of charges.
  for(const app of db.masjidPointAdminApplications||[]){
    if(app.type!=='business'||!['approved','activated'].includes(app.status))continue;
    if(/^BUS-\d{5}$/.test(app.businessCode||''))continue;
    const email=String(app.email||'').trim().toLowerCase();
    const existing=(db.masjidPointFinance?.accounts||[]).find(a=>
      /^BUS-\d{5}$/.test(String(a.code||'')) &&
      ((email&&String(a.email||'').trim().toLowerCase()===email)||
       (a.name&&app.name&&String(a.name).trim()===String(app.name).trim())));
    app.businessCode=existing?existing.code:`BUS-${String(nextCode++).padStart(5,'0')}`;
  }
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
    // A job with no business or no masjid is left as it is. Filling those in with a name picked
    // out of the air does not repair the record — it files a real job against a company and a
    // masjid that never agreed to it.
    job.masjids ||= job.masjid
      ? [{name:job.masjid, fee:Number(job.fee)||0, status:job.status==='pending'?'pending':'approved'}]
      : [];
    if(!Number.isFinite(Number(job.fee)))job.fee=job.masjids.reduce((sum,choice)=>sum+(Number(choice.fee)||0),0);
    for (const choice of job.masjids) {
      choice.fee=Number(choice.fee)||0; choice.paymentStatus ||= choice.status === 'approved' ? 'due' : 'not_due';
      const old = previousJobs.find(j=>j.id===job.id)?.masjids?.find(m=>m.name===choice.name);
      if (choice.status==='pending' && !old) {
        notify(db,`masjid:${choice.name}`,'New job listing request',
          `${job.business||'A business'} would like to advertise "${job.title}" through your masjid for £${Number(choice.fee||0).toFixed(2)} a month.`,
          'masjid-jobs',`job-request-${job.id}-${choice.name}`);
      }
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
  for(const job of jobs){const code=job.businessCode;if(!code)continue;job.masjids.filter(m=>m.status==='approved'&&m.paymentStatus!=='paid').forEach(m=>addLine(code,{jobId:job.id,kind:'job',description:`${job.title} — ${m.name}`,masjid:m.name,amount:m.fee,adminPercent:Number(m.adminPercent??30),mosquePercent:Number(m.mosquePercent??70)}))}
  // A month, or a trial, runs out. The listing comes down and the business is told, which is what
  // turns it back into something the loop below will raise a fresh invoice for — the same charge
  // it paid the first time, not a special renewal path.
  for(const request of requests){
    if(request.status!=='approved')continue;
    const now=new Date();
    const trialEnd=request.trialUntil?new Date(request.trialUntil):null;
    const paidEnd=request.paidUntil?new Date(request.paidUntil):null;
    const onTrial=request.paymentStatus==='trial'&&trialEnd&&!isNaN(trialEnd);
    const onMonth=request.paymentStatus==='paid'&&paidEnd&&!isNaN(paidEnd);
    if(!(onTrial&&trialEnd<=now)&&!(onMonth&&paidEnd<=now))continue;
    request.paymentStatus='due';request.listing='disabled';
    request.lapsedAt=now.toISOString();
    const what=onTrial?'free trial':'advertising month';
    notify(db,`business:${request.email}`,'Advertising has paused',
      `Your ${what} for ${request.masjid} has ended and your listing is no longer showing. Pay the new invoice to put it back up.`,
      'business-invoices',`advert-lapsed-${request.id}-${request.paidUntil||request.trialUntil}`);
    notify(db,`masjid:${request.masjid}`,'A business listing has paused',
      `${request.name} has reached the end of its ${what} and is no longer showing.`,
      'masjid-listings',`advert-lapsed-masjid-${request.id}-${request.paidUntil||request.trialUntil}`);
  }
  for(const request of requests.filter(r=>r.status==='approved'&&!['paid','trial'].includes(r.paymentStatus)&&r.businessCode)){const snap=request.pricingSnapshot||{},amount=Number(snap.advertisingPrice??request.price??0);if(amount>0)addLine(request.businessCode,{requestId:request.id,kind:'advertising',description:`Business advertising — ${request.masjid}`,masjid:request.masjid,amount,adminPercent:Number(snap.adminPercent??30),mosquePercent:Number(snap.mosquePercent??70)})}
  // Which account a charge belongs to today. A business that has been issued a new business code
  // leaves its old account behind, and an unpaid workflow invoice there would go on billing the
  // same advertising request the new account is already billing — the charge appears twice, the
  // mosque is shown a share of both, and the totals are simply wrong. A line is kept only on the
  // account the thing it charges for currently bills to.
  const codeForLine=line=>{
    if(line.requestId)return (requests.find(r=>r.id===line.requestId)||{}).businessCode;
    const job=jobs.find(j=>j.id===line.jobId);
    return job&&job.businessCode;
  };
  for(const acct of db.masjidPointFinance.accounts){acct.invoices=acct.invoices.filter(inv=>{if(!inv.workflow||inv.paid>0)return true;const active=(inv.lines||[]).filter(line=>{const owner=codeForLine(line);if(owner&&owner!==acct.code)return false;if(line.requestId){const request=requests.find(r=>r.id===line.requestId);return request?.status==='approved'&&request.paymentStatus!=='paid'}const job=jobs.find(j=>j.id===line.jobId),choice=job?.masjids.find(m=>m.name===line.masjid);return choice?.status==='approved'&&choice.paymentStatus!=='paid'});inv.lines=active;inv.amount=active.reduce((s,l)=>s+Number(l.amount),0);inv.shares={};active.forEach(l=>inv.shares[l.masjid]=(inv.shares[l.masjid]||0)+Number(l.amount)*Number(l.mosquePercent??70)/100);return active.length>0})}
  for(const [code,dueLines] of groups){const owner=(db.masjidPointAdminApplications||[]).find(a=>a.businessCode===code),acct=account(db,code,owner?.name||'Business',owner?.email||'');let invoice=acct.invoices.find(i=>i.workflow===true&&i.paid<i.amount&&!['cancelled','refunded'].includes(i.status));if(dueLines.length){if(!invoice){invoice={number:nextInvoiceNumber(db),date:new Date().toISOString().slice(0,10),due:new Date(Date.now()+14*864e5).toISOString().slice(0,10),amount:0,paid:0,shares:{},lines:[],workflow:true};acct.invoices.unshift(invoice)}invoice.lines=dueLines;invoice.amount=dueLines.reduce((s,l)=>s+Number(l.amount),0);invoice.shares={};dueLines.forEach(l=>invoice.shares[l.masjid]=(invoice.shares[l.masjid]||0)+Number(l.amount)*Number(l.mosquePercent??70)/100)}}
  for (const acct of db.masjidPointFinance.accounts) for (const inv of acct.invoices.filter(i=>i.workflow && i.paid>=i.amount && i.amount>0&&!['cancelled','refunded'].includes(i.status))) {
    for (const line of inv.lines||[]) {
      if(line.requestId){const request=requests.find(r=>r.id===line.requestId);if(request){request.paidPeriods=Array.isArray(request.paidPeriods)?request.paidPeriods:[];if(!request.paidPeriods.includes(inv.number)){const now=new Date(),current=request.paidUntil?new Date(request.paidUntil):null;const from=current&&current>now?current:now;request.paidPeriods.push(inv.number);request.paymentStatus='paid';request.listing='enabled';request.paidAt=now.toISOString();request.paidUntil=addMonth(from).toISOString();const share=Number(line.amount)*Number(line.mosquePercent??70)/100;notify(db,`business:${request.email}`,'Advertising payment approved',`Your £${Number(line.amount).toFixed(2)} payment for ${request.masjid} was verified and your listing is live.`,'business-portal#listings',`advert-paid-business-${request.id}`);notify(db,`masjid:${request.masjid}`,'Advertising payment received',`${request.name} paid £${Number(line.amount).toFixed(2)} and the listing is now live. Your £${share.toFixed(2)} share is due.`,'masjid-portal#requests',`advert-paid-masjid-${request.id}`);notify(db,'admin','Mosque settlement due',`£${share.toFixed(2)} is due to ${request.masjid}.`,'admin-payments#settlements',`advert-settlement-${request.id}`)}}continue}
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
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
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
  if(!csrfAllowed(req))return json(res,403,{error:'This request could not be verified. Refresh the page and try again.'});
  if(['POST','PUT','PATCH'].includes(req.method)&&Number(req.headers['content-length']||0)>100000&&!limit(req,res,'upload',30,60*60000))return;
  try {
    if(url.pathname==='/api/admin/login'&&req.method==='POST'){
      const input=await body(req),email=String(input.email||'').trim().toLowerCase();if(!limit(req,res,'admin-login',5,15*60000,email))return;
      const db=await load(),user=(db.masjidPointAdminUsers||seed.masjidPointAdminUsers).find(x=>String(x.email).toLowerCase()===email&&x.status==='active');
      if(!user||!await passwordMatches(user,input.password,input.passwordHash))return json(res,401,{error:'The email address or password is incorrect.'});
      await save(db);
      if(user.twoFactorEnabled){const code=process.env.MASJIDPOINT_TEST_MODE==='1'?'123456':String(crypto.randomInt(0,1000000)).padStart(6,'0'),challenge=crypto.randomBytes(24).toString('base64url');db.masjidPointEmailTokens||=[];db.masjidPointEmailTokens.push({hash:tokenHash(code),challengeHash:tokenHash(challenge),purpose:'admin_2fa',adminId:user.id,email:user.email,expiresAt:new Date(Date.now()+10*60000).toISOString(),attempts:0,createdAt:new Date().toISOString()});await save(db);await emailService.verificationCode(user.email,code);return json(res,200,{twoFactorRequired:true,challenge,message:'Enter the code sent to your administrator email.'})}
      const adminToken=issueSession({role:'admin',adminRole:user.role,adminId:user.id,email:user.email,name:user.name});return json(res,200,{user:{id:user.id,name:user.name,email:user.email,role:user.role},session:adminToken,expiresAt:Date.now()+SESSION_MINUTES*60000},sessionCookie(adminToken,req))
    }
    if(url.pathname==='/api/admin/login/2fa'&&req.method==='POST'){
      const input=await body(req);if(!limit(req,res,'admin-2fa',6,10*60000,input.challenge))return;const db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='admin_2fa'&&!x.usedAt&&x.challengeHash===tokenHash(input.challenge||'')&&new Date(x.expiresAt)>new Date());if(!record)return json(res,400,{error:'This verification challenge has expired.'});record.attempts=Number(record.attempts||0)+1;if(record.attempts>5||record.hash!==tokenHash(String(input.code||'').replace(/\D/g,''))){await save(db);return json(res,400,{error:'The verification code is incorrect.'})}const user=(db.masjidPointAdminUsers||[]).find(x=>x.id===record.adminId&&x.status==='active');if(!user)return json(res,403,{error:'This administrator is not active.'});record.usedAt=new Date().toISOString();await save(db);const adminToken=issueSession({role:'admin',adminRole:user.role,adminId:user.id,email:user.email,name:user.name});return json(res,200,{user:{id:user.id,name:user.name,email:user.email,role:user.role},session:adminToken,expiresAt:Date.now()+SESSION_MINUTES*60000},sessionCookie(adminToken,req))
    }
    if(url.pathname==='/api/auth/session/refresh'&&req.method==='POST'){const current=readSession(req);if(!current)return json(res,401,{error:'Your session has expired. Please sign in again.'});const {exp,...identity}=current,token=issueSession(identity);return json(res,200,{ok:true,session:token,expiresAt:Date.now()+SESSION_MINUTES*60000},sessionCookie(token,req))}
    // An administrator changing their own password. Creating and suspending administrators is
    // Masjid and business sign-in. This used to happen entirely in the browser: the page fetched
    // every account from /api/state and compared password hashes locally, which meant every hash
    // on the platform had to be publicly readable for anyone to log in at all. The comparison
    // happens here now, and /api/state no longer publishes hashes.
    if(url.pathname==='/api/account/login'&&req.method==='POST'){
      const input=await body(req),{email}=input;if(!limit(req,res,'account-login',8,15*60000,email))return;const db=await load();
      const wanted=String(email||'').trim().toLowerCase();
      const account=(db.masjidPointActivatedAccounts||[]).find(x=>String(x.email).toLowerCase()===wanted);
      // The same answer whether the account is unknown or the password is wrong, so this cannot be
      // used to find out which addresses are registered.
      if(!account||!await passwordMatches(account,input.password,input.passwordHash))
        return json(res,401,{error:'No activated account matches that email and password.'});
      await save(db);
      const application=(db.masjidPointAdminApplications||[]).find(item=>item.reference===account.reference);
      if(!application||!['approved','activated'].includes(application.status)||['blocked','deactivated'].includes(application.accountStatus))
        return json(res,403,{error:'This account is not currently active. Contact MasjidPoint support.'});
      const {passwordHash:_ignored,...safe}=account;
      const accountToken=issueSession({role:'account',reference:account.reference,email:account.email});
      return json(res,200,{account:safe,session:accountToken,expiresAt:Date.now()+SESSION_MINUTES*60000},sessionCookie(accountToken,req));
    }

    // Changing a masjid or business password, for the same reason: the portal used to read the
    // stored hash to check the current password before replacing it.
    if(url.pathname==='/api/account/password'&&req.method==='POST'){
      const input=await body(req),{email}=input,db=await load();
      if(!passwordStrong(input.nextPassword)) return json(res,400,{error:'Use at least 12 characters with uppercase, lowercase, a number and a symbol.'});
      const wanted=String(email||'').trim().toLowerCase();
      const account=(db.masjidPointActivatedAccounts||[]).find(x=>String(x.email).toLowerCase()===wanted);
      const session=readSession(req);if(session?.role!=='account'||session.reference!==account?.reference)return json(res,403,{error:'Sign in to the account whose password you are changing.'});
      if(!account||!await passwordMatches(account,input.currentPassword,input.currentHash)) return json(res,401,{error:'That is not your current password.'});
      if(await passwordMatches(account,input.nextPassword,input.nextHash))return json(res,400,{error:'The new password is the same as the current one.'});
      account.passwordHash=await passwordDigest(input.nextPassword); account.passwordChangedAt=new Date().toISOString();
      audit(db,{action:'account.password.changed',entityType:'account',entityId:account.reference||account.email,actor:account.email});
      await save(db);
      return json(res,200,{ok:true});
    }

    // restricted to the Platform Owner, but until now nobody — including the owner — could rotate
    // their own credentials once set, so a shared or exposed password could not be replaced.
    // Authority comes from proving the current password, not from a header a client can assert.
    if(url.pathname==='/api/admin/password'&&req.method==='POST'){
      const input=await body(req),{email}=input,db=await load();
      if(!passwordStrong(input.nextPassword)) return json(res,400,{error:'Use at least 12 characters with uppercase, lowercase, a number and a symbol.'});
      const users=db.masjidPointAdminUsers||[];
      const user=users.find(x=>String(x.email).toLowerCase()===String(email||'').trim().toLowerCase()&&x.status==='active');
      const session=requireAdmin(req,res);if(!session)return;if(session.adminId!==user?.id)return json(res,403,{error:'You can change only your own administrator password.'});
      if(!user||!await passwordMatches(user,input.currentPassword,input.currentHash)) return json(res,401,{error:'That is not your current password.'});
      user.passwordHash=await passwordDigest(input.nextPassword);
      user.passwordChangedAt=new Date().toISOString();
      db.masjidPointFinance=db.masjidPointFinance||{accounts:[],unmatched:[],settled:{},settlementHistory:[],audit:[],cashRemittances:[]};
      db.masjidPointFinance.audit=db.masjidPointFinance.audit||[];
      db.masjidPointFinance.audit.unshift({id:`AUD-${Date.now()}-pw`,action:'admin.password.changed',entityType:'admin',entityId:user.id,
        actor:user.name,reason:'',before:{},after:{},metadata:{email:user.email},createdAt:user.passwordChangedAt});
      await save(db);
      return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/admin/users'&&req.method==='GET'){const admin=requireAdmin(req,res,['super_admin']);if(!admin)return;const db=await load();return json(res,200,{users:(db.masjidPointAdminUsers||seed.masjidPointAdminUsers).map(({passwordHash,...user})=>user)})}
    if(url.pathname==='/api/admin/users'&&req.method==='POST'){const admin=requireAdmin(req,res,['super_admin']);if(!admin)return;const input=await body(req),db=await load(),email=String(input.email||'').trim().toLowerCase(),roles=['admin','finance_admin','reviewer'];if(!input.name||!email||!roles.includes(input.role)||!passwordStrong(input.password))return json(res,400,{error:'Name, email, role and a strong 12-character temporary password are required.'});db.masjidPointAdminUsers||=JSON.parse(JSON.stringify(seed.masjidPointAdminUsers));if(db.masjidPointAdminUsers.some(x=>x.email===email))return json(res,409,{error:'An administrator already uses this email.'});const user={id:`ADM-${String(db.masjidPointAdminUsers.length+1).padStart(4,'0')}`,name:String(input.name).trim(),email,role:input.role,status:'active',passwordHash:await passwordDigest(input.password),twoFactorEnabled:Boolean(input.twoFactorEnabled),createdAt:new Date().toISOString(),createdBy:admin.name||admin.email};db.masjidPointAdminUsers.push(user);audit(db,{action:'admin.created',entityType:'administrator',entityId:user.id,actor:user.createdBy,after:{name:user.name,email:user.email,role:user.role,twoFactorEnabled:user.twoFactorEnabled}});await save(db);const{passwordHash,...safe}=user;return json(res,201,{user:safe})}
    if(url.pathname==='/api/admin/users/status'&&req.method==='POST'){const admin=requireAdmin(req,res,['super_admin']);if(!admin)return;const input=await body(req),db=await load(),user=(db.masjidPointAdminUsers||[]).find(x=>x.id===input.id);if(!user)return json(res,404,{error:'Administrator not found.'});if(user.role==='super_admin')return json(res,400,{error:'The Platform Owner account cannot be deactivated.'});const before=user.status;user.status=input.status==='active'?'active':'deactivated';audit(db,{action:`admin.${user.status}`,entityType:'administrator',entityId:user.id,actor:admin.name||admin.email,before:{status:before},after:{status:user.status},metadata:{name:user.name,email:user.email}});await save(db);return json(res,200,{ok:true,status:user.status})}
    if(url.pathname==='/api/admin/users/2fa'&&req.method==='POST'){const admin=requireAdmin(req,res,['super_admin']);if(!admin)return;const input=await body(req),db=await load(),user=(db.masjidPointAdminUsers||[]).find(x=>x.id===input.id);if(!user)return json(res,404,{error:'Administrator not found.'});const before=Boolean(user.twoFactorEnabled);user.twoFactorEnabled=Boolean(input.enabled);audit(db,{action:'admin.2fa.changed',entityType:'administrator',entityId:user.id,actor:admin.name||admin.email,before:{enabled:before},after:{enabled:user.twoFactorEnabled}});await save(db);return json(res,200,{ok:true,enabled:user.twoFactorEnabled})}
    if(url.pathname==='/api/auth/activation/verify'&&req.method==='GET'){const db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='activation'&&!x.usedAt&&x.hash===tokenHash(url.searchParams.get('token')||'')&&new Date(x.expiresAt)>new Date());if(!record)return json(res,400,{error:'This activation link is invalid or has expired.'});return json(res,200,{reference:record.reference,email:record.email})}
    if(url.pathname==='/api/auth/activation/otp/verify'&&req.method==='POST'){const input=await body(req);if(!limit(req,res,'activation-verify',8,10*60000,input.email))return;const db=await load(),reference=String(input.reference||'').trim(),email=String(input.email||'').trim().toLowerCase(),code=String(input.code||'').replace(/\D/g,'');const record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='activation_otp'&&x.reference===reference&&String(x.email).toLowerCase()===email&&!x.usedAt&&new Date(x.expiresAt)>new Date());if(!record)return json(res,400,{error:'This verification code has expired. Request a new code.'});record.attempts=Number(record.attempts||0)+1;if(record.attempts>5){await save(db);return json(res,429,{error:'Too many incorrect attempts. Request a new code.'})}if(record.hash!==tokenHash(code)){await save(db);return json(res,400,{error:'The verification code is incorrect.'})}record.usedAt=new Date().toISOString();const token=crypto.randomBytes(32).toString('base64url');db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>!(x.purpose==='activation'&&x.reference===reference&&!x.usedAt));db.masjidPointEmailTokens.push({hash:tokenHash(token),purpose:'activation',reference,email,expiresAt:new Date(Date.now()+30*60000).toISOString(),createdAt:new Date().toISOString(),verifiedBy:'otp'});await save(db);return json(res,200,{ok:true,token,reference,email})}
    if(url.pathname==='/api/auth/activation/otp/resend'&&req.method==='POST'){const input=await body(req),email=String(input.email||'').trim().toLowerCase();if(!limit(req,res,'activation-send',3,10*60000,email))return;const db=await load(),requestedReference=String(input.reference||'').trim(),app=(db.masjidPointAdminApplications||[]).find(x=>(!requestedReference||x.reference===requestedReference)&&String(x.email).toLowerCase()===email&&x.status==='approved'),reference=app?.reference||requestedReference;if(!app)return json(res,400,{error:'No approved account matches this email address.'});const inFlightKey=`activation_otp:${reference}`;if(!beginEmailSend(inFlightKey))return json(res,429,{error:'A code is already on its way. Check your inbox.'});try{const recent=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='activation_otp'&&x.reference===reference&&!x.usedAt&&x.source==='user_request'&&Date.now()-new Date(x.createdAt).getTime()<60000);if(recent)return json(res,429,{error:'Please wait one minute before requesting another code.'});const code=process.env.MASJIDPOINT_TEST_MODE==='1'?'123456':String(crypto.randomInt(0,1000000)).padStart(6,'0');db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>!(x.purpose==='activation_otp'&&x.reference===reference&&!x.usedAt));db.masjidPointEmailTokens.push({hash:tokenHash(code),purpose:'activation_otp',reference,email,expiresAt:new Date(Date.now()+10*60000).toISOString(),createdAt:new Date().toISOString(),attempts:0,source:'user_request'});await save(db);try{await emailService.verificationCode(email,code)}catch(error){console.error('Activation code email failed:',error.message);return json(res,502,{error:'The email could not be sent. Please try again.'})}return json(res,200,{ok:true,reference,message:'A new verification code has been sent.'})}finally{endEmailSend(inFlightKey)}}
    if(url.pathname==='/api/auth/activation/complete'&&req.method==='POST'){const input=await body(req),db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='activation'&&!x.usedAt&&x.hash===tokenHash(input.token||'')&&new Date(x.expiresAt)>new Date());if(!record)return json(res,400,{error:'This activation request is invalid or expired.'});const app=(db.masjidPointAdminApplications||[]).find(x=>x.reference===record.reference);if(!app)return json(res,404,{error:'Account not found.'});const passwordHash=await passwordForStorage(input);db.masjidPointActivatedAccounts=(db.masjidPointActivatedAccounts||[]).filter(x=>x.reference!==record.reference);db.masjidPointActivatedAccounts.unshift({reference:record.reference,email:record.email,verified:true,activatedAt:new Date().toISOString(),passwordHash});app.status='activated';app.accountStatus='active';app.activatedAt=new Date().toISOString();record.usedAt=new Date().toISOString();await save(db);return json(res,200,{ok:true,type:app.type,email:record.email,reference:record.reference})}
    if(url.pathname==='/api/auth/password-reset/request'&&req.method==='POST'){
      const {email}=await body(req),normal=String(email||'').trim().toLowerCase();if(!limit(req,res,'password-reset',3,30*60000,normal))return;const db=await load();
      const account=(db.masjidPointActivatedAccounts||[]).find(x=>String(x.email).toLowerCase()===normal);
      const customer=(db.masjidPointCustomers||[]).find(x=>String(x.email).toLowerCase()===normal&&x.emailVerified);
      if(account||customer){
        const app=account?(db.masjidPointAdminApplications||[]).find(x=>x.reference===account.reference):null;
        const token=crypto.randomBytes(32).toString('base64url'),ownerId=customer?.id||account.reference;
        db.masjidPointEmailTokens||=[];
        db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>!(x.purpose==='password_reset'&&(x.reference===ownerId||x.customerId===ownerId)&&!x.usedAt));
        const resetToken={hash:tokenHash(token),purpose:'password_reset',reference:account?.reference,customerId:customer?.id,email:normal,expiresAt:new Date(Date.now()+1800000).toISOString(),createdAt:new Date().toISOString()};
        db.masjidPointEmailTokens.push(resetToken);
        await save(db);
        try{
          await emailService.reset(normal,customer?.name||app?.name||'your account',token);
        }catch(error){
          db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>x!==resetToken);
          await save(db);
          console.error('Password reset email failed:',error.message);
          return json(res,502,{ok:false,error:'We could not send the reset email. Please wait a moment and try again.'});
        }
      }
      return json(res,200,{ok:true,message:'If an activated account matches that email, a reset link has been sent. Please also check your spam folder.'});
    }
    if(url.pathname==='/api/auth/password-reset/complete'&&req.method==='POST'){const input=await body(req),db=await load(),record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='password_reset'&&!x.usedAt&&x.hash===tokenHash(input.token||'')&&new Date(x.expiresAt)>new Date());if(!record)return json(res,400,{error:'This reset link is invalid or has expired.'});const account=record.customerId?(db.masjidPointCustomers||[]).find(x=>x.id===record.customerId):(db.masjidPointActivatedAccounts||[]).find(x=>x.reference===record.reference);if(!account)return json(res,404,{error:'Account not found.'});account.passwordHash=await passwordForStorage(input);account.passwordChangedAt=new Date().toISOString();record.usedAt=new Date().toISOString();await save(db);return json(res,200,{ok:true})}
    if(url.pathname==='/api/finance/invoice/cancel'&&req.method==='POST'){if(!requireAdmin(req,res,['super_admin','admin','finance_admin']))return;const input=await body(req),db=await load(),invoice=cancelInvoice(db,input);await save(db);return json(res,200,{ok:true,invoice})}
    if(url.pathname==='/api/finance/refund'&&req.method==='POST'){if(!requireAdmin(req,res,['super_admin','admin','finance_admin']))return;const input=await body(req),db=await load(),record=refund(db,input);await save(db);return json(res,200,{ok:true,refund:record})}
    if(url.pathname==='/api/invoices/export.csv'&&req.method==='GET'){if(!requireAdmin(req,res,['super_admin','admin','finance_admin']))return;const db=await load();reconcile(db);await save(db);const content=invoiceRegister.toCsv(invoiceRegister.build(db));res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="masjidpoint-invoices.csv"','Cache-Control':'private, no-store'});return res.end(content)}
    if(url.pathname==='/api/shop/invoice.pdf'&&req.method==='GET'){const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to download this invoice.'});const db=await load();reconcile(db);await save(db);const order=(db.masjidPointShopOrders||[]).find(x=>x.id===url.searchParams.get('order')||x.invoiceNumber===url.searchParams.get('order'));if(!order)return json(res,404,{error:'Order not found.'});const app=accountApplication(db,session),allowed=isAdminSession(session)||(session.role==='customer'&&String(order.customer?.email).toLowerCase()===String(session.email).toLowerCase())||(app?.type==='masjid'&&(order.collectionMasjidReference===app.reference||order.collectionMasjidName===app.name));if(!allowed)return json(res,403,{error:'This invoice does not belong to your account.'});return shopInvoicePdf(res,order)}
    if(url.pathname==='/api/finance/invoice.pdf'&&req.method==='GET'){const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to download this invoice.'});const db=await load(),code=url.searchParams.get('code');if(!isAdminSession(session)&&!ownsBusinessCode(db,session,code))return json(res,403,{error:'This invoice does not belong to your account.'});const{account,invoice}=locateInvoice(db,code,url.searchParams.get('invoice'));return invoicePdf(res,account,invoice)}
    if(url.pathname==='/api/finance/export.csv'&&req.method==='GET'){if(!requireAdmin(req,res,['super_admin','admin','finance_admin']))return;const db=await load(),type=url.searchParams.get('type')||'invoices',content=csv(db,type);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="masjidpoint-${type}-${new Date().toISOString().slice(0,10)}.csv"`,'Cache-Control':'private, no-store'});return res.end('\ufeff'+content)}
    if(url.pathname==='/api/finance/audit'&&req.method==='GET'){if(!requireAdmin(req,res))return;const db=await load();return json(res,200,{items:db.masjidPointFinance?.audit||[]})}
    // Public checkout is a server-side transaction: prices and stock come from the catalogue, not
    // from values a browser can edit, and stock cannot be decremented without creating the order.
    if(url.pathname==='/api/shop/order'&&req.method==='POST'){
      const input=await body(req),db=await load(),draft=input.order||{},wanted=Array.isArray(draft.items)?draft.items:[];
      if(!wanted.length)return json(res,400,{error:'Your basket is empty.'});
      const method=fulfilment.METHODS[draft.fulfilmentMethod];
      if(!method)return json(res,400,{error:'Choose a valid fulfilment method.'});
      const mosque=(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&['approved','activated'].includes(item.status)&&(item.reference===draft.collectionMasjidReference||item.name===draft.collectionMasjidName));
      if(!mosque)return json(res,400,{error:'The selected mosque is not available.'});
      const rate=(db.masjidPointMasjidPricing||[]).find(item=>item.masjidReference===mosque.reference)||{};
      if(!fulfilment.enabledFor(rate).some(item=>item.key===method.key))return json(res,400,{error:'That fulfilment method is not available for this mosque.'});
      const items=[];
      for(const wantedItem of wanted){
        const product=(db.masjidPointProducts||[]).find(item=>item.id===wantedItem.productId&&item.visibility!=='hidden'&&(item.mosques||[]).some(place=>place.reference===mosque.reference));
        const quantity=Number(wantedItem.quantity);
        if(!product||!Number.isInteger(quantity)||quantity<1||Number(product.stock)<quantity)return json(res,409,{error:`${wantedItem.name||'A product'} is no longer available in that quantity.`});
        items.push({productId:product.id,name:product.name,description:product.description,image:String(product.image||'').startsWith('data:')?'':product.image,quantity,price:Number(product.price),mosqueSharePercent:Number(product.mosqueSharePercent||0),mosqueRevenue:Number((Number(product.price)*quantity*Number(product.mosqueSharePercent||0)/100).toFixed(2))});
      }
      const customer=draft.customer||{},email=String(customer.email||'').trim().toLowerCase();
      if(!String(customer.name||'').trim()||!/^\S+@\S+\.\S+$/.test(email)||!String(customer.phone||'').trim())return json(res,400,{error:'Name, email and phone number are required.'});
      const goods=Number(items.reduce((sum,item)=>sum+item.price*item.quantity,0).toFixed(2)),deliveryFee=method.key==='delivery'?Number(rate.shopDeliveryFee||0):0,placedAt=new Date().toISOString();
      const order={id:`ORD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,customer:{name:String(customer.name).trim(),email,phone:String(customer.phone).trim()},collectionMasjidReference:mosque.reference,collectionMasjidName:mosque.name,fulfilmentMethod:method.key,items,goodsTotal:goods,deliveryFee,total:Number((goods+deliveryFee).toFixed(2)),mosqueRevenue:Number(items.reduce((sum,item)=>sum+item.mosqueRevenue,0).toFixed(2)),status:method.paysUpfront?'payment_pending':'ordered',paymentStatus:method.paysUpfront?'awaiting_bank_transfer':'pay_at_mosque',placedAt,history:[{status:method.paysUpfront?'payment_pending':'ordered',at:placedAt,by:'customer'}]};
      if(method.needsAddress)order.deliveryAddress=draft.deliveryAddress;
      for(const item of items)(db.masjidPointProducts||[]).find(product=>product.id===item.productId).stock-=item.quantity;
      db.masjidPointShopOrders||=[];db.masjidPointShopOrders.push(order);
      db.masjidPointCustomers||=[];let individual=db.masjidPointCustomers.find(item=>String(item.email).toLowerCase()===email);if(!individual){individual={id:`CUS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,name:order.customer.name,email,phone:order.customer.phone,status:'account_not_created',emailVerified:false,applicationReferences:[],orderReferences:[],createdAt:placedAt};db.masjidPointCustomers.push(individual)}if(!method.paysUpfront)individual.orderReferences=Array.from(new Set([...(individual.orderReferences||[]),order.id]));order.customerAccountExists=Boolean(individual.passwordHash);
      reconcile(db);await save(db);
      return json(res,201,{ok:true,order:(db.masjidPointShopOrders||[]).find(item=>item.id===order.id)||order});
    }
    if(url.pathname==='/api/shop/order/cancel-draft'&&req.method==='POST'){
      const input=await body(req),db=await load(),email=String(input.email||'').trim().toLowerCase();
      const index=(db.masjidPointShopOrders||[]).findIndex(order=>order.id===input.order&&String(order.customer?.email||'').toLowerCase()===email);
      if(index<0)return json(res,200,{ok:true});
      const order=db.masjidPointShopOrders[index];
      const unfinished=order.status==='payment_pending'||(order.paymentStatus==='awaiting_bank_transfer'&&!order.paymentProofId);
      if(!unfinished||order.paymentProofId)return json(res,409,{error:'This order is no longer an unfinished checkout.'});
      for(const line of order.items||[]){const product=(db.masjidPointProducts||[]).find(item=>item.id===line.productId);if(product)product.stock=Number(product.stock||0)+Number(line.quantity||0)}
      db.masjidPointShopOrders.splice(index,1);
      for(const customer of db.masjidPointCustomers||[])customer.orderReferences=(customer.orderReferences||[]).filter(reference=>reference!==order.id);
      await save(db);return json(res,200,{ok:true});
    }
    // Customer payment evidence for a shop order. The file arrives as a data URL and is written to
    // disk so an administrator can actually open it — unlike the business proof flow, which keeps
    // its uploads in the submitter's own browser and shows the reviewer nothing.
    if (url.pathname==='/api/shop/proof' && req.method==='POST') {
      const input=await body(req), db=await load();
      const order=(db.masjidPointShopOrders||[]).find(x=>x.id===input.order);
      if(!order) return json(res,404,{error:'Order not found.'});
      const amount=Number(input.amount), reference=String(input.bankReference||'').trim();
      if(!(amount>0)||!reference) return json(res,400,{error:'A payment amount and bank transaction reference are required.'});
      if(Math.abs(amount-Number(order.total||0))>0.009)return json(res,400,{error:'The payment amount must match the order total.'});
      const id=`PAY-${Date.now()}`;
      let evidence=null;const upload=dataUrlFile(input.file);
      if(input.file&&!upload)return json(res,400,{error:'Evidence must be a PNG, JPG, WebP or PDF.'});
      if(upload)evidence=await objectStorage.put({kind:'payment_proof',ownerType:'shop_order',ownerId:order.id,name:String(input.fileName||'payment-evidence').slice(0,120),mime:upload.mime,buffer:upload.buffer});
      db.masjidPointPaymentProofs=db.masjidPointPaymentProofs||[];
      db.masjidPointPaymentProofs.unshift({id,orderId:order.id,invoice:order.invoiceNumber||order.id,
        customerName:order.customer?.name||'',customerEmail:order.customer?.email||'',amount,
        date:String(input.date||'').slice(0,10)||new Date().toISOString().slice(0,10),
        bankReference:reference,evidence,status:'submitted',submittedAt:new Date().toISOString(),adminNote:''});
      order.paymentStatus='submitted';
      order.status='ordered';
      order.paymentProofId=id;
      order.history=order.history||[];order.history.push({status:'ordered',at:new Date().toISOString(),by:'customer',note:'Payment proof submitted'});
      const individual=(db.masjidPointCustomers||[]).find(item=>String(item.email||'').toLowerCase()===String(order.customer?.email||'').toLowerCase());
      if(individual)individual.orderReferences=Array.from(new Set([...(individual.orderReferences||[]),order.id]));
      notify(db,'admin','Payment proof awaiting verification',`${order.customer?.name||'A customer'} submitted £${amount.toFixed(2)} for ${order.id}.`,`admin-payments.html?proof=${id}#proofs`,`shop-proof-${id}`);
      await save(db);
      return json(res,200,{ok:true,proof:id});
    }
    // The same thing for a business paying an invoice — advertising and job listings.
    //
    // This evidence used to be written to IndexedDB in the business's own browser, which meant it
    // never left that machine: the administrator, reviewing from somewhere else entirely, saw a
    // broken image and had nothing to verify a payment against. It is stored on the server now,
    // beside the shop evidence, and read back through the same endpoint below.
    if (url.pathname==='/api/invoice/proof' && req.method==='POST') {
      const input=await body(req), db=await load();
      const invoice=String(input.invoice||'').trim();
      const businessCode=String(input.businessCode||'').trim();
      const amount=Number(input.amount), reference=String(input.bankReference||'').trim();
      if(!invoice||!businessCode) return json(res,400,{error:'The invoice and business could not be identified.'});
      if(!ownsBusinessCode(db,readSession(req),businessCode)) return json(res,403,{error:'Sign in to the business that owns this invoice.'});
      if(!(amount>0)||!reference) return json(res,400,{error:'A payment amount and bank transaction reference are required.'});

      const account=(db.masjidPointFinance?.accounts||[]).find(a=>a.code===businessCode);
      const target=(account?.invoices||[]).find(i=>i.number===invoice);
      if(!target) return json(res,404,{error:'That invoice does not belong to this business.'});
      const outstanding=Number(target.amount||0)-Number(target.paid||0);
      if(Math.abs(amount-outstanding)>0.009)return json(res,400,{error:'The payment amount must match the outstanding invoice balance.'});

      const id=`PAY-${Date.now()}`;
      let evidence=null;const upload=dataUrlFile(input.file);
      if(input.file&&!upload)return json(res,400,{error:'Evidence must be a PNG, JPG, WebP or PDF.'});
      if(upload)evidence=await objectStorage.put({kind:'payment_proof',ownerType:'business',ownerId:businessCode,name:String(input.fileName||'payment-evidence').slice(0,120),mime:upload.mime,buffer:upload.buffer});

      db.masjidPointPaymentProofs=db.masjidPointPaymentProofs||[];
      // One open submission per invoice. Sending evidence twice replaces the earlier attempt
      // rather than queueing a second copy of the same payment for review.
      db.masjidPointPaymentProofs=db.masjidPointPaymentProofs.filter(p=>
        !(p.invoice===invoice&&p.businessCode===businessCode&&p.status==='submitted'));
      db.masjidPointPaymentProofs.unshift({id,invoice,businessCode,
        businessName:String(input.businessName||account?.name||''),amount,
        date:String(input.date||'').slice(0,10)||new Date().toISOString().slice(0,10),
        bankReference:reference,fileName:evidence?.originalName||'',fileType:evidence?.mimeType||'',evidence,
        status:'submitted',submittedAt:new Date().toISOString(),adminNote:''});
      notify(db,'admin','Payment proof awaiting verification',
        `${input.businessName||account?.name||'A business'} submitted £${amount.toFixed(2)} for ${invoice}.`,
        `admin-payments.html?proof=${id}#proofs`,`invoice-proof-${id}`);
      await save(db);
      return json(res,200,{ok:true,proof:id});
    }
    if(url.pathname==='/api/public/application-status'&&req.method==='POST'){
      const input=await body(req),db=await load(),email=String(input.email||'').trim().toLowerCase(),reference=String(input.reference||'').trim().toLowerCase(),postcode=String(input.postcode||'').trim().toUpperCase().replace(/\s/g,'');
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return json(res,400,{error:'Enter the email address used in the application.'});
      const applications=db.masjidPointAdminApplications||[],emailOf=app=>String(app.email||app.contactEmail||app.details?.Email||app.details?.['Email address']||'').trim().toLowerCase(),postcodeOf=app=>String(app.postcode||app.details?.Postcode||'').trim().toUpperCase().replace(/\s/g,'');
      const app=reference?applications.find(item=>String(item.reference||'').toLowerCase()===reference&&emailOf(item)===email):applications.find(item=>item.type==='masjid'&&emailOf(item)===email&&postcodeOf(item)===postcode);
      if(!app)return json(res,404,{error:reference?'We couldn’t find a matching application. Check the reference and email, then try again.':'We couldn’t find a matching mosque application. Check the email and postcode, then try again.'});
      return json(res,200,{application:{id:app.id,reference:app.reference,type:app.type,name:app.name,email,status:app.status,note:app.note||'',submittedAt:app.submittedAt,decidedAt:app.decidedAt||'',postcode:postcodeOf(app)}});
    }
    if(url.pathname==='/api/public/masjid-registration'&&req.method==='POST'){
      const input=await body(req),db=await load(),email=String(input.email||'').trim().toLowerCase(),postcode=String(input.postcode||'').trim().toUpperCase(),name=String(input.name||'').trim();
      if(!name||!email||!postcode||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return json(res,400,{error:'Enter the mosque name, postcode and a valid email address.'});
      const taken=emailBelongsElsewhere(db,email);if(taken)return json(res,409,{error:taken});const duplicate=(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&(String(item.email).toLowerCase()===email||(item.name===name&&String(item.details?.Postcode||'').toUpperCase()===postcode)));if(duplicate)return json(res,409,{error:'This mosque already has an application.',reference:duplicate.reference,status:duplicate.status});
      const reference=`MSJ-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,submittedAt=new Date().toISOString();
      const app={id:reference,type:'masjid',name:name.slice(0,160),email,reference,status:'pending',submittedAt,details:{'Masjid name':name.slice(0,160),'Address':String(input.address||'').trim().slice(0,300),'Postcode':postcode.slice(0,12),'Masjid phone':String(input.masjidPhone||'').trim().slice(0,40),'Primary contact':String(input.contactName||'').trim().slice(0,120),'Role':String(input.role||'').trim().slice(0,80),'Contact number':String(input.contactPhone||'').trim().slice(0,40),'Email':email}};
      if(input.photo){const photo=dataUrlFile(input.photo);if(!photo||!photo.mime.startsWith('image/')||photo.buffer.length>3*1024*1024)return json(res,400,{error:'The mosque photo must be PNG, JPG or WebP up to 3 MB.'});app.photo=String(input.photo)}
      db.masjidPointAdminApplications=db.masjidPointAdminApplications||[];db.masjidPointAdminApplications.unshift(app);notify(db,'admin','New masjid registration',`${app.name} submitted an application (${reference}).`,`admin-applications?application=${encodeURIComponent(reference)}`,`masjid-application-${reference}`);await save(db);return json(res,201,{ok:true,reference,status:'pending',submittedAt});
    }
    if(url.pathname==='/api/public/advertising'&&req.method==='POST'){
      const input=await body(req),db=await load(),mosque=(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&['approved','activated'].includes(item.status)&&(item.reference===input.masjidReference||item.name===input.masjid));
      if(!mosque)return json(res,400,{error:'Choose an active mosque.'});const name=String(input.name||'').trim(),email=String(input.email||'').trim().toLowerCase();if(!name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||String(input.description||'').trim().length<20)return json(res,400,{error:'Complete the business name, valid email and description.'});
      // A business may advertise through several mosques — that is the "Request another masjid"
      // route — so an existing business application on this address is fine. A masjid or a personal
      // account on it is not, and neither is a second application to the same mosque.
      const claimed=emailBelongsElsewhere(db,email,{allowBusiness:true});
      if(claimed)return json(res,409,{error:claimed});
      const already=(db.masjidPointBusinessRequests||[]).find(r=>String(r.email||'').toLowerCase()===email
        &&(r.masjidReference===mosque.reference||r.masjid===mosque.name)
        &&!['rejected','cancelled'].includes(String(r.status||'')));
      if(already)return json(res,409,{error:`You already have an application to advertise through ${mosque.name}.`,reference:already.reference});
      const pricing=(db.masjidPointMasjidPricing||[]).find(item=>item.reference===mosque.reference)||{},price=Number(pricing.businessPrice??pricing.advertisingPrice??20),adminPercent=Number(pricing.adminPercent??30),mosquePercent=100-adminPercent,reference=`MP-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,submittedAt=new Date().toISOString();
      const allowedAttendance=new Set(['','Very regularly — most days','Regularly — several times a week','Weekly — usually for Jumu’ah','Occasionally','I’m local but don’t regularly attend','I’m not local to this masjid']),attendanceFrequency=String(input.attendanceFrequency||'').trim();if(!allowedAttendance.has(attendanceFrequency))return json(res,400,{error:'Choose a valid attendance option.'});
      let contactPhoto=null;if(input.contactPhoto){const upload=dataUrlFile(input.contactPhoto);if(!upload||!['image/jpeg','image/png','image/webp'].includes(upload.mime)||upload.buffer.length>3*1024*1024)return json(res,400,{error:'Your photo must be a PNG, JPG or WebP image up to 3 MB.'});contactPhoto=await objectStorage.put({kind:'profile_photo',ownerType:'business_application',ownerId:reference,name:String(input.contactPhotoName||'contact-photo').slice(0,120),mime:upload.mime,buffer:upload.buffer})}
      let logo=null;if(input.logo){const upload=dataUrlFile(input.logo);if(!upload||!['image/jpeg','image/png','image/webp'].includes(upload.mime)||upload.buffer.length>5*1024*1024)return json(res,400,{error:'The business logo must be a PNG, JPG or WebP image up to 5 MB.'});logo=await objectStorage.put({kind:'business_logo',ownerType:'business_application',ownerId:reference,name:String(input.logoName||'business-logo').slice(0,120),mime:upload.mime,buffer:upload.buffer})}
      const request={id:reference,reference,masjid:mosque.name,masjidReference:mosque.reference,type:'business',name:name.slice(0,160),category:String(input.category||'Other').slice(0,80),contact:String(input.contactName||'').slice(0,120),email,contactEmail:String(input.contactEmail||'').trim().toLowerCase(),contactNumber:String(input.contactNumber||'').slice(0,40),attendanceFrequency,publicPhotoConsent:Boolean(input.publicPhotoConsent),contactPhoto,logo,phone:String(input.phone||'').slice(0,40),description:String(input.description).trim().slice(0,280),website:String(input.website||'').trim().slice(0,240),status:'pending',listing:'disabled',paymentStatus:'not_due',price,pricingSnapshot:{masjidReference:mosque.reference,advertisingPrice:price,adminPercent,mosquePercent,adminAmount:Number((price*adminPercent/100).toFixed(2)),mosqueAmount:Number((price*mosquePercent/100).toFixed(2)),capturedAt:submittedAt},submittedAt};
      const details={'Business name':request.name,'Category':request.category,'Selected masjid':mosque.name,'Agreed monthly price':`£${price.toFixed(2)}`,'Admin cut':`${adminPercent}%`,'Mosque share':`${mosquePercent}%`,'Contact name':request.contact,'Contact number':request.contactNumber,'Contact email':request.contactEmail,'Masjid attendance':attendanceFrequency||'Not provided','Public photo permission':request.publicPhotoConsent?'Granted':'Not granted','Business email':email,'Business phone':request.phone,'Website':request.website||'Not provided','Description':request.description};db.masjidPointBusinessRequests=db.masjidPointBusinessRequests||[];db.masjidPointBusinessRequests.unshift(request);db.masjidPointAdminApplications=db.masjidPointAdminApplications||[];db.masjidPointAdminApplications.unshift({...request,details});notify(db,`masjid:${mosque.reference}`,'New business application',`${request.name} wants to advertise through your mosque.`,`masjid-portal?request=${encodeURIComponent(reference)}#requests`,`business-request-${reference}`);notify(db,'admin','New business application',`${request.name} applied to advertise through ${mosque.name} (${reference}).`,`admin-applications?application=${encodeURIComponent(reference)}`,`business-application-${reference}`);await save(db);return json(res,201,{ok:true,reference,submittedAt,masjid:mosque.name});
    }
    if(url.pathname==='/api/business-contact-photo'&&req.method==='GET'){
      const db=await load(),reference=String(url.searchParams.get('reference')||''),request=(db.masjidPointBusinessRequests||[]).find(item=>item.reference===reference||item.id===reference);if(!request?.contactPhoto)return json(res,404,{error:'No photo is available.'});const session=readSession(req),app=session?accountApplication(db,session):null,isOwner=app?.type==='business'&&(app.reference===request.reference||app.businessCode===request.businessCode),isMosque=app?.type==='masjid'&&(app.reference===request.masjidReference||app.name===request.masjid),isPublic=request.publicPhotoConsent&&request.status==='approved'&&request.paymentStatus==='paid'&&request.listing==='enabled',publicOnly=url.searchParams.get('publicOnly')==='1';if((publicOnly&&!isPublic)||(!publicOnly&&!isPublic&&!isAdminSession(session)&&!isOwner&&!isMosque))return json(res,403,{error:'This photo is private.'});return privateFile(res,request.contactPhoto);
    }
    if(url.pathname==='/api/business-logo'&&req.method==='GET'){
      const db=await load(),reference=String(url.searchParams.get('reference')||''),request=(db.masjidPointBusinessRequests||[]).find(item=>item.reference===reference||item.id===reference);if(!request?.logo)return json(res,404,{error:'No business logo is available.'});const session=readSession(req),app=session?accountApplication(db,session):null,isOwner=app?.type==='business'&&(app.reference===request.reference||app.businessCode===request.businessCode),isMosque=app?.type==='masjid'&&(app.reference===request.masjidReference||app.name===request.masjid),isPublic=request.status==='approved'&&request.paymentStatus==='paid'&&request.listing==='enabled';if(!isPublic&&!isAdminSession(session)&&!isOwner&&!isMosque)return json(res,403,{error:'This logo is private.'});return privateFile(res,request.logo);
    }
    if(url.pathname==='/api/public/job-application'&&req.method==='POST'){
      const input=await body(req),db=await load(),job=(db.masjidPointJobs||[]).find(item=>item.id===input.jobId&&(item.status==='live'||item.enabled));if(!job)return json(res,404,{error:'This job is no longer accepting applications.'});
      const fullName=String(input.fullName||'').trim(),email=String(input.email||'').trim().toLowerCase(),phone=String(input.phone||'').trim();if(!fullName||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||phone.replace(/\D/g,'').length<10)return json(res,400,{error:'Enter your full name, valid email and phone number.'});
      const upload=dataUrlFile(input.file);if(!upload||!['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(upload.mime)||upload.buffer.length>5*1024*1024)return json(res,400,{error:'Upload a PDF, DOC or DOCX CV up to 5 MB.'});
      const reference=`APP-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,submittedAt=new Date().toISOString(),cv=await objectStorage.put({kind:'cv',ownerType:'job_application',ownerId:reference,name:String(input.fileName||'cv').slice(0,120),mime:upload.mime,buffer:upload.buffer});
      const application={reference,jobId:job.id,jobTitle:job.title,business:job.business||'',fullName:fullName.slice(0,160),email,phone:phone.slice(0,40),experienceYears:String(input.experienceYears||'').slice(0,60),additionalInformation:String(input.additionalInformation||'').trim().slice(0,1500),cvName:cv.originalName,cv,status:'Submitted',submittedAt};
      db.masjidPointJobApplications=db.masjidPointJobApplications||[];db.masjidPointJobApplications.push(application);db.masjidPointCustomers=db.masjidPointCustomers||[];let customer=db.masjidPointCustomers.find(item=>String(item.email).toLowerCase()===email);if(!customer){customer={id:`CUS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,name:application.fullName,email,phone:application.phone,status:'pending_verification',applicationReferences:[],createdAt:submittedAt};db.masjidPointCustomers.push(customer)}customer.applicationReferences=Array.from(new Set([...(customer.applicationReferences||[]),reference]));
      const accountExists=Boolean(customer.passwordHash&&customer.emailVerified);notify(db,`business:${job.businessCode||job.businessReference}`,'New job application',`${application.fullName} applied for ${job.title}.`,'business-applicants',`job-application-${reference}`);await save(db);return json(res,201,{ok:true,reference,jobTitle:job.title,submittedAt,accountExists});
    }
    if(url.pathname==='/api/business/job-application/decision'&&req.method==='POST'){
      const session=readSession(req),db=await load(),business=accountApplication(db,session);
      if(!business||business.type!=='business')return json(res,401,{error:'Sign in to the business that owns this vacancy.'});
      const input=await body(req),reference=String(input.reference||''),action=String(input.action||'').toLowerCase();
      const applications=db.masjidPointJobApplications||[],index=applications.findIndex(item=>item.reference===reference);
      if(index<0)return json(res,404,{error:'Job application not found.'});
      const application=applications[index],job=(db.masjidPointJobs||[]).find(item=>item.id===application.jobId);
      if(!job||(job.businessReference!==business.reference&&job.businessCode!==business.businessCode))return json(res,403,{error:'This application does not belong to your business.'});
      if(action==='delete'){
        applications.splice(index,1);
        for(const customer of db.masjidPointCustomers||[])customer.applicationReferences=(customer.applicationReferences||[]).filter(item=>item!==reference);
        notify(db,`customer:${String(application.email||'').toLowerCase()}`,'Application record removed',`The employer removed your application record for ${application.jobTitle}.`,'my-account#applications',`job-application-deleted-${reference}`);
      }else if(action==='accept'||action==='reject'){
        application.status=action==='accept'?'Accepted':'Rejected';
        application.decidedAt=new Date().toISOString();
        application.decisionNote=String(input.note||'').trim().slice(0,500);
        notify(db,`customer:${String(application.email||'').toLowerCase()}`,action==='accept'?'Application accepted':'Application update',action==='accept'?`Your application for ${application.jobTitle} has been accepted by the employer.`:`Your application for ${application.jobTitle} was not selected.`, 'my-account#applications',`job-application-${action}-${reference}`);
      }else return json(res,400,{error:'Choose accept, reject or delete.'});
      await save(db);return json(res,200,{ok:true,reference,status:action==='delete'?'deleted':application.status});
    }
    // A candidate's CV, sent to the business that advertised the job.
    //
    // The file used to be written to IndexedDB in the applicant's own browser, so the employer
    // received their name and the file name and nothing else — the document they were being asked
    // to hire on never left the applicant's machine. privacy.html said as much, and said it was
    // being changed. This is that change.
    if (url.pathname==='/api/job/cv' && req.method==='POST') {
      const input=await body(req), db=await load();
      const reference=String(input.reference||'').trim();
      if(!reference) return json(res,400,{error:'The application could not be identified.'});
      const application=(db.masjidPointJobApplications||[]).find(a=>a.reference===reference);
      if(!application) return json(res,404,{error:'That application does not exist.'});

      const upload=dataUrlFile(input.file);
      if(!upload) return json(res,400,{error:'A CV must be a PDF or a Word document.'});
      application.cv=await objectStorage.put({kind:'cv',ownerType:'job_application',ownerId:reference,name:String(input.fileName||'cv').slice(0,120),mime:upload.mime,buffer:upload.buffer});
      application.cvName=application.cv.originalName;
      await save(db);
      return json(res,200,{ok:true});
    }

    // Serves it back. Personal data, and this endpoint checks nothing beyond the reference — the
    // same as every other read on this platform today. It needs an employer session in front of it
    // before the platform handles anyone's real CV; see DEPLOY.md.
    if (url.pathname==='/api/job/cv/file' && req.method==='GET') {
      // A CV is somebody's employment history, address and phone number. Holding the reference
      // used to be enough to read one; it now takes a session as well.
      const session=readSession(req);
      if(!session) return json(res,401,{error:'Sign in to read a CV.'});
      const db=await load();
      const application=(db.masjidPointJobApplications||[]).find(a=>a.reference===url.searchParams.get('reference'));
      if(!application?.cv?.objectKey&&!application?.cv?.key) return json(res,404,{error:'No CV stored for this application.'});
      const app=accountApplication(db,session);
      const job=(db.masjidPointJobs||[]).find(item=>item.id===application.jobId);
      const allowed=isAdminSession(session)||(session.role==='customer'&&String(application.email).toLowerCase()===String(session.email).toLowerCase())||(app?.type==='business'&&(job?.businessReference===app.reference||job?.businessCode===app.businessCode));
      if(!allowed)return json(res,403,{error:'This CV does not belong to your account.'});
      if(application.cv.objectKey)return privateFile(res,application.cv);
      try {
        const data=await fs.promises.readFile(path.join(dataDir,'uploads',path.basename(application.cv.key)));
        res.writeHead(200,{'Content-Type':application.cv.type||'application/octet-stream',
          'Content-Disposition':`inline; filename="${String(application.cv.name||'cv').replace(/[^\w.\- ]/g,'_')}"`,
          'Cache-Control':'no-store'});
        return res.end(data);
      } catch { return json(res,404,{error:'The CV file is missing.'}); }
    }

    // Serves stored evidence back to the admin queue. basename() keeps the key from escaping the directory.
    if (url.pathname==='/api/shop/proof/file' && req.method==='GET') {
      // Payment evidence is often a screenshot of a bank statement. It takes a session to see one.
      if(!requireAdmin(req,res)) return;
      const db=await load(), proof=(db.masjidPointPaymentProofs||[]).find(x=>x.id===url.searchParams.get('id'));
      if(!proof?.evidence?.objectKey&&!proof?.evidence?.key) return json(res,404,{error:'No evidence stored for this proof.'});
      if(proof.evidence.objectKey)return privateFile(res,proof.evidence);
      try {
        const data=await fs.promises.readFile(path.join(dataDir,'uploads',path.basename(proof.evidence.key)));
        res.writeHead(200,{'Content-Type':proof.evidence.type||'application/octet-stream','Cache-Control':'no-store'});
        return res.end(data);
      } catch { return json(res,404,{error:'Evidence file is missing.'}); }
    }
    if(url.pathname==='/api/admin/payment-proof/decision'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin','finance_admin']);if(!admin)return;
      const input=await body(req),db=await load(),before=JSON.parse(JSON.stringify(db)),proof=(db.masjidPointPaymentProofs||[]).find(item=>item.id===input.id),status=input.status==='approved'?'approved':input.status==='rejected'?'rejected':'';
      if(!proof)return json(res,404,{error:'Payment proof not found.'});if(!status)return json(res,400,{error:'Choose approve or reject.'});if(status==='rejected'&&!String(input.note||'').trim())return json(res,400,{error:'Enter a rejection reason.'});
      proof.status=status;proof.adminNote=String(input.note||'').trim();proof.reviewedAt=new Date().toISOString();proof.reviewedBy=admin.name||admin.email;
      if(status==='approved'&&proof.orderId){const order=(db.masjidPointShopOrders||[]).find(item=>item.id===proof.orderId);if(!order)return json(res,404,{error:'Connected shop order not found.'});order.paymentStatus='paid';order.paidAt=proof.reviewedAt;order.paymentVerifiedBy=proof.reviewedBy;order.history||=[];order.history.push({status:'payment_verified',at:proof.reviewedAt,by:proof.reviewedBy});notify(db,`customer:${String(order.customer?.email||'').toLowerCase()}`,'Payment verified',`Your £${Number(order.total).toFixed(2)} payment for ${order.id} has been verified.`,'my-account',`order-paid-${order.id}`)}
      if(status==='approved'&&!proof.orderId){const account=(db.masjidPointFinance?.accounts||[]).find(item=>item.code===proof.businessCode),invoice=(account?.invoices||[]).find(item=>item.number===proof.invoice);if(!account||!invoice)return json(res,404,{error:'Connected invoice not found.'});account.payments||=[];if(!account.payments.some(payment=>payment.proofId===proof.id)){const outstanding=Math.max(0,Number(invoice.amount)-Number(invoice.paid||0)),allocated=Math.min(Number(proof.amount),outstanding);invoice.paid=Number(invoice.paid||0)+allocated;invoice.status=invoice.paid>=Number(invoice.amount||0)?'paid':invoice.paid>0?'partially_paid':'due';account.payments.push({amount:Number(proof.amount),date:proof.date,bankReference:proof.bankReference,note:'Verified from uploaded proof',proofId:proof.id});if(Number(proof.amount)>allocated)account.credit=Number(account.credit||0)+Number(proof.amount)-allocated}}
      reconcile(db);
      await save(db);
      // Payment verification must not wait for the SMTP provider. The financial
      // state is committed first, then the browser receives its success response;
      // notification email delivery continues independently afterwards.
      json(res,200,{ok:true,status});
      emailTransitions(before,db,admin.name||admin.email).catch(error=>console.error('Payment notification email failed:',error));
      return;
    }
    if(url.pathname==='/api/admin/application/decision'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin','reviewer']);if(!admin)return;const input=await body(req),db=await load(),before=JSON.parse(JSON.stringify(db)),app=(db.masjidPointAdminApplications||[]).find(item=>item.reference===input.reference),action=String(input.action||'');if(!app)return json(res,404,{error:'Application not found.'});
      const note=String(input.note||'').trim();if(['reject','block','deactivate'].includes(action)&&!note)return json(res,400,{error:'Enter a decision note for the audit record.'});
      if(action==='approve'){app.status='approved';app.accountStatus='active';app.decidedAt=new Date().toISOString()}
      else if(action==='reject'){app.status='rejected';app.decidedAt=new Date().toISOString()}
      else if(action==='block')app.accountStatus='blocked';else if(action==='deactivate')app.accountStatus='deactivated';else if(action==='reactivate')app.accountStatus='active';else return json(res,400,{error:'Unknown application decision.'});
      app.note=note;app.accountStatusNote=note;app.accountStatusChangedAt=new Date().toISOString();await emailTransitions(before,db,admin.name||admin.email);await save(db);return json(res,200,{ok:true,status:app.status,accountStatus:app.accountStatus});
    }
    if(url.pathname==='/api/admin/application/delete'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin']);if(!admin)return;const input=await body(req),db=await load(),reference=String(input.reference||''),app=(db.masjidPointAdminApplications||[]).find(item=>item.reference===reference);if(!app)return json(res,404,{error:'Application not found.'});
      audit(db,{action:'application.deleted',entityType:app.type,entityId:app.reference,actor:admin.name||admin.email,reason:String(input.note||'Deleted from the applications page').trim(),before:{name:app.name,status:app.status,accountStatus:app.accountStatus||'active',email:app.email},after:{deleted:true}});db.masjidPointAdminApplications=db.masjidPointAdminApplications.filter(item=>item.reference!==reference);db.masjidPointActivatedAccounts=(db.masjidPointActivatedAccounts||[]).filter(item=>item.reference!==reference);db.masjidPointEmailTokens=(db.masjidPointEmailTokens||[]).filter(item=>item.reference!==reference);if(app.type==='masjid')db.masjidPointMasjidPricing=(db.masjidPointMasjidPricing||[]).filter(item=>item.masjidReference!==reference);await save(db);return json(res,200,{ok:true,reference});
    }
    if(url.pathname==='/api/admin/business-trial'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin']);if(!admin)return;const input=await body(req),db=await load(),business=(db.masjidPointAdminApplications||[]).find(item=>item.type==='business'&&[item.reference,item.id,item.businessCode].includes(String(input.reference||'')));if(!business)return json(res,404,{error:'Business account not found.'});
      const enabled=input.enabled===true,before=Boolean(business.trialAdvertisingEnabled),changedAt=new Date().toISOString();business.trialAdvertisingEnabled=enabled;business.trialAdvertisingUpdatedAt=changedAt;business.trialAdvertisingUpdatedBy=admin.name||admin.email;
      let published=0;for(const request of db.masjidPointBusinessRequests||[]){const belongs=request.reference===business.reference||request.id===business.reference||(business.businessCode&&request.businessCode===business.businessCode)||String(request.email||'').toLowerCase()===String(business.email||'').toLowerCase();if(!belongs)continue;request.trialAdvertisingEligible=enabled;if(enabled&&request.status==='approved'&&!['paid','trial'].includes(request.paymentStatus)){const trialEnds=new Date(Date.now()+30*86400000);request.paymentStatus='trial';request.paymentMethod='trial';request.trialAdvertising=true;request.trialGrantedAt=changedAt;request.trialUntil=trialEnds.toISOString();request.listing='enabled';published++;notify(db,`business:${business.businessCode||business.email}`,'Trial advertising activated',`Your advertising through ${request.masjid} is live free for 30 days, until ${trialEnds.toLocaleDateString('en-GB',{day:'numeric',month:'long'})}. We will invoice you then to keep it up.`,'business-advertising',`trial-advert-live-${request.id}`)}}
      reconcile(db);audit(db,{action:enabled?'business.trial_enabled':'business.trial_disabled',entityType:'business',entityId:business.reference,actor:admin.name||admin.email,before:{trialAdvertisingEnabled:before},after:{trialAdvertisingEnabled:enabled,publishedListings:published},metadata:{businessCode:business.businessCode,name:business.name}});await save(db);return json(res,200,{ok:true,enabled,published});
    }
    if(url.pathname==='/api/admin/bank-settings'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin','finance_admin']);if(!admin)return;const input=await body(req),db=await load(),sort=String(input.sortCode||'').replace(/\D/g,''),account=String(input.accountNumber||'').replace(/\D/g,'');if(sort.length!==6||account.length!==8||!String(input.accountName||'').trim()||!String(input.bankName||'').trim())return json(res,400,{error:'Enter the account name, bank, valid 6-digit sort code and 8-digit account number.'});
      const before=JSON.parse(JSON.stringify(db)),bankDetails={active:input.active===true,accountName:String(input.accountName).trim().slice(0,120),bankName:String(input.bankName).trim().slice(0,120),sortCode:`${sort.slice(0,2)}-${sort.slice(2,4)}-${sort.slice(4)}`,accountNumber:account,iban:String(input.iban||'').trim().toUpperCase().slice(0,42),instructions:String(input.instructions||'').trim().slice(0,600),updatedAt:new Date().toISOString(),updatedBy:admin.name||admin.email};db.masjidPointPlatformSettings=db.masjidPointPlatformSettings||{};db.masjidPointPlatformSettings.bankDetails=bankDetails;await emailTransitions(before,db,admin.name||admin.email);await save(db);return json(res,200,{ok:true,bankDetails});
    }
    if(url.pathname==='/api/admin/mosque-pricing'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin']);if(!admin)return;const input=await body(req),db=await load(),mosque=(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&['approved','activated'].includes(item.status)&&item.reference===input.masjidReference);if(!mosque)return json(res,404,{error:'Active mosque not found.'});const advertisingPrice=Number(input.advertisingPrice),jobPrice=Number(input.jobPrice),adminPercent=Number(input.adminPercent),mosquePercent=Number(input.mosquePercent);if(advertisingPrice<0||jobPrice<0||adminPercent<0||mosquePercent<0||Math.abs(adminPercent+mosquePercent-100)>.001)return json(res,400,{error:'Enter valid prices and percentages totalling 100%.'});
      db.masjidPointMasjidPricing=db.masjidPointMasjidPricing||[];let rate=db.masjidPointMasjidPricing.find(item=>item.masjidReference===mosque.reference);const before=rate?JSON.parse(JSON.stringify(rate)):null;if(!rate){rate={masjidReference:mosque.reference};db.masjidPointMasjidPricing.push(rate)}Object.assign(rate,{masjidName:mosque.name,advertisingPrice,jobPrice,adminPercent,mosquePercent,acceptingListings:input.acceptingListings!==false,updatedAt:new Date().toISOString(),updatedBy:admin.name||admin.email});audit(db,{action:'mosque_pricing.updated',entityType:'masjid',entityId:mosque.reference,actor:admin.name||admin.email,before,after:rate});await save(db);return json(res,200,{ok:true,pricing:rate});
    }
    if(url.pathname==='/api/admin/mosque-donation-settings'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin','finance_admin']);if(!admin)return;const input=await body(req),db=await load(),mosque=(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&['approved','activated'].includes(item.status)&&item.reference===input.masjidReference);if(!mosque)return json(res,404,{error:'Active mosque not found.'});const sort=String(input.sortCode||'').replace(/\D/g,''),account=String(input.accountNumber||'').replace(/\D/g,'');if(input.active===true&&(sort.length!==6||account.length!==8||!String(input.accountName||'').trim()||!String(input.bankName||'').trim()))return json(res,400,{error:'To publish donations, enter the account name, bank, 6-digit sort code and 8-digit account number.'});
      const before=mosque.donationBankDetails?JSON.parse(JSON.stringify(mosque.donationBankDetails)):null;mosque.donationBankDetails={active:input.active===true,accountName:String(input.accountName||'').trim().slice(0,120),bankName:String(input.bankName||'').trim().slice(0,120),sortCode:sort.length===6?`${sort.slice(0,2)}-${sort.slice(2,4)}-${sort.slice(4)}`:'',accountNumber:account.slice(0,8),iban:String(input.iban||'').trim().toUpperCase().slice(0,42),reference:String(input.reference||'').trim().slice(0,80),message:String(input.message||'').trim().slice(0,500),updatedAt:new Date().toISOString()};audit(db,{action:'mosque_donations.updated',entityType:'masjid',entityId:mosque.reference,actor:admin.name||admin.email,before:before?{active:before.active,bankName:before.bankName,accountEnding:String(before.accountNumber||'').slice(-4)}:null,after:{active:mosque.donationBankDetails.active,bankName:mosque.donationBankDetails.bankName,accountEnding:String(mosque.donationBankDetails.accountNumber||'').slice(-4)}});await save(db);return json(res,200,{ok:true,donationBankDetails:mosque.donationBankDetails});
    }
    if(url.pathname==='/api/account/profile'&&req.method==='POST'){
      const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to update your profile.'});
      const db=await load(),app=accountApplication(db,session);if(!app)return json(res,403,{error:'This account is not active.'});
      const input=await body(req),details=input.details&&typeof input.details==='object'&&!Array.isArray(input.details)?input.details:{};
      const allowed=app.type==='masjid'
        ?new Set(['Masjid phone','Primary contact','Contact number','Role'])
        :new Set(['Contact name','Contact number','Contact email','Category','Business phone','Business email','Website','Description']);
      app.details=app.details||{};
      for(const [key,raw] of Object.entries(details))if(allowed.has(key)){const value=String(raw||'').trim().slice(0,key==='Description'?800:240);if(value)app.details[key]=value;else delete app.details[key]}
      if(app.type==='business'&&String(input.name||'').trim())app.name=String(input.name).trim().slice(0,160);
      if(app.type==='business'&&String(input.email||'').trim()){const email=String(input.email).trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return json(res,400,{error:'Enter a valid business email.'});app.email=email}
      if(app.type==='business'&&(Object.prototype.hasOwnProperty.call(input,'logo')||Object.prototype.hasOwnProperty.call(input,'ownerPhoto')||Object.prototype.hasOwnProperty.call(input,'publicPhotoConsent'))){
        const request=(db.masjidPointBusinessRequests||[]).find(item=>item.reference===app.reference||item.id===app.reference);
        if(!request)return json(res,404,{error:'The connected business listing could not be found.'});
        if(input.logo){const upload=dataUrlFile(input.logo);if(!upload||!['image/jpeg','image/png','image/webp'].includes(upload.mime)||upload.buffer.length>5*1024*1024)return json(res,400,{error:'The business logo must be PNG, JPG or WebP up to 5 MB.'});request.logo=await objectStorage.put({kind:'business_logo',ownerType:'business_application',ownerId:app.reference,name:String(input.logoName||'business-logo').slice(0,120),mime:upload.mime,buffer:upload.buffer});app.logo=request.logo}
        if(input.ownerPhoto){const upload=dataUrlFile(input.ownerPhoto);if(!upload||!['image/jpeg','image/png','image/webp'].includes(upload.mime)||upload.buffer.length>3*1024*1024)return json(res,400,{error:'The owner photo must be PNG, JPG or WebP up to 3 MB.'});request.contactPhoto=await objectStorage.put({kind:'profile_photo',ownerType:'business_application',ownerId:app.reference,name:String(input.ownerPhotoName||'owner-photo').slice(0,120),mime:upload.mime,buffer:upload.buffer});app.contactPhoto=request.contactPhoto}
        if(input.removeLogo===true){delete request.logo;delete app.logo}
        if(input.removeOwnerPhoto===true){delete request.contactPhoto;delete app.contactPhoto;request.publicPhotoConsent=false;app.publicPhotoConsent=false}
        if(Object.prototype.hasOwnProperty.call(input,'publicPhotoConsent')){request.publicPhotoConsent=Boolean(input.publicPhotoConsent&&request.contactPhoto);app.publicPhotoConsent=request.publicPhotoConsent}
      }
      if(Object.prototype.hasOwnProperty.call(input,'photo')){if(app.type!=='masjid')return json(res,403,{error:'Only a mosque profile has this photo.'});if(input.photo){const photo=dataUrlFile(input.photo);if(!photo||!photo.mime.startsWith('image/')||photo.buffer.length>3*1024*1024)return json(res,400,{error:'Choose a PNG, JPG or WebP image up to 3 MB.'});app.photo=String(input.photo)}else delete app.photo}
      app.profileUpdatedAt=new Date().toISOString();await save(db);return json(res,200,{ok:true,profile:{reference:app.reference,name:app.name,email:app.email,details:app.details,photo:app.photo||''}});
    }
    if(url.pathname==='/api/business/job'&&req.method==='POST'){
      const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to create a job listing.'});
      const db=await load(),business=accountApplication(db,session);if(business?.type!=='business'||!['approved','activated'].includes(business.status)||['blocked','deactivated'].includes(business.accountStatus))return json(res,403,{error:'An active business account is required.'});
      const input=await body(req),title=String(input.title||'').trim(),description=String(input.description||'').trim(),postcode=String(input.postcode||'').trim().toUpperCase(),selected=Array.isArray(input.masjids)?input.masjids.map(String):[];
      if(!title||description.length<40||!String(input.city||'').trim()||!/^[A-Z0-9 ]{5,8}$/.test(postcode)||!selected.length)return json(res,400,{error:'Complete the job details and select at least one mosque.'});
      const approved=(db.masjidPointAdminApplications||[]).filter(item=>item.type==='masjid'&&['approved','activated'].includes(item.status)),pricing=db.masjidPointMasjidPricing||[],masjids=[];
      for(const reference of [...new Set(selected)]){const mosque=approved.find(item=>item.reference===reference);const rate=pricing.find(item=>item.masjidReference===reference);if(!mosque||!rate||rate.acceptingListings===false)return json(res,400,{error:'One of the selected mosques is no longer accepting listings.'});masjids.push({reference:mosque.reference,name:mosque.name,fee:Number(rate.jobPrice||0),adminPercent:Number(rate.adminPercent??30),mosquePercent:Number(rate.mosquePercent??70),status:'pending',paymentStatus:'not_due'})}
      const salaryFrom=Number(input.salaryFrom),salaryTo=input.salaryTo===''?null:Number(input.salaryTo);if(!(salaryFrom>0)||(salaryTo!==null&&(!(salaryTo>0)||salaryTo<salaryFrom)))return json(res,400,{error:'Enter a valid salary. The maximum must not be lower than the minimum.'});
      const id=`JOB-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,submittedAt=new Date().toISOString(),job={id,title:title.slice(0,160),employmentType:String(input.employmentType||'').slice(0,60),arrangement:String(input.arrangement||'').slice(0,60),city:String(input.city).trim().slice(0,100),postcode,salaryFrom,salaryTo,payPeriod:String(input.payPeriod||'').slice(0,20),description:description.slice(0,1200),shortDescription:String(input.shortDescription||'').trim().slice(0,180),industry:String(input.industry||'').slice(0,80),educationLevel:String(input.educationLevel||'').slice(0,100),experienceLevel:String(input.experienceLevel||'').slice(0,80),closingDate:String(input.closingDate||'').slice(0,10),responsibilities:String(input.responsibilities||'').trim().slice(0,1600),requirements:String(input.requirements||'').trim().slice(0,1600),benefits:String(input.benefits||'').trim().slice(0,1200),tags:Array.isArray(input.tags)?input.tags.map(item=>String(item).trim().slice(0,50)).filter(Boolean).slice(0,15):[],encouraged:Array.isArray(input.encouraged)?input.encouraged.map(item=>String(item).slice(0,80)).slice(0,10):[],business:business.name,businessReference:business.reference,businessCode:business.businessCode,masjids,masjid:masjids[0].name,fee:masjids.reduce((sum,item)=>sum+item.fee,0),status:'pending',enabled:false,submittedAt};
      db.masjidPointJobs=db.masjidPointJobs||[];db.masjidPointJobs.unshift(job);for(const mosque of masjids)notify(db,`masjid:${mosque.reference}`,'New job listing request',`${business.name} submitted ${job.title} for your review.`,'masjid-job-requests',`job-request-${id}-${mosque.reference}`);await save(db);return json(res,201,{ok:true,job});
    }
    if(url.pathname==='/api/job/decision'&&req.method==='POST'){
      const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to review this job.'});const input=await body(req),db=await load(),job=(db.masjidPointJobs||[]).find(item=>item.id===input.jobId),status=input.status==='approved'?'approved':input.status==='rejected'?'rejected':'';if(!job||!status)return json(res,400,{error:'The job or decision is invalid.'});
      const app=accountApplication(db,session),admin=isAdminSession(session),mosque=admin?(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&(item.reference===input.masjidReference||item.name===input.masjid)):(app?.type==='masjid'?app:null);if(!mosque)return json(res,403,{error:'You cannot decide for this mosque.'});const choice=(job.masjids||[]).find(item=>item.reference===mosque.reference||item.name===mosque.name);if(!choice)return json(res,404,{error:'This job was not sent to that mosque.'});if(choice.status!=='pending')return json(res,409,{error:`This job is already ${choice.status}.`});
      choice.status=status;choice.paymentStatus=status==='approved'?'due':'not_due';choice.decidedBy=admin?(session.name||session.email):`masjid:${mosque.reference}`;choice.decidedAt=new Date().toISOString();choice.decisionNote=String(input.note||'').trim();job.status=status==='approved'?'payment due':job.masjids.every(item=>item.status==='rejected')?'rejected':'pending';job.enabled=false;reconcile(db);notify(db,`business:${job.businessCode||job.businessReference}`,`Job ${status}`,`${mosque.name} ${status} ${job.title}.`,'business-invoices',`job-decision-${job.id}-${mosque.reference}-${status}`);await save(db);return json(res,200,{ok:true,status:job.status});
    }
    if(url.pathname==='/api/advertising/decision'&&req.method==='POST'){
      const session=readSession(req),db=await load(),before=JSON.parse(JSON.stringify(db)),input=await body(req),request=(db.masjidPointBusinessRequests||[]).find(item=>item.id===input.id);if(!session)return json(res,401,{error:'Sign in to manage this listing.'});if(!request)return json(res,404,{error:'Advertising request not found.'});const app=accountApplication(db,session),admin=isAdminSession(session),mosque=admin?(db.masjidPointAdminApplications||[]).find(item=>item.type==='masjid'&&(item.reference===request.masjidReference||item.name===request.masjid)):(app?.type==='masjid'&&(request.masjidReference===app.reference||request.masjid===app.name)?app:null);if(!mosque)return json(res,403,{error:'This request does not belong to your mosque.'});
      const action=String(input.action||''),note=String(input.note||'').trim(),businessApp=(db.masjidPointAdminApplications||[]).find(item=>item.type==='business'&&(item.reference===request.reference||item.id===request.id||item.businessCode===request.businessCode||String(item.email||'').toLowerCase()===String(request.email||'').toLowerCase()));if(action==='approve'||action==='reject'){if(request.status!=='pending')return json(res,409,{error:`This request is already ${request.status}.`});request.status=action==='approve'?'approved':'rejected';request.note=note;request.decidedAt=new Date().toISOString();const trial=action==='approve'&&businessApp?.trialAdvertisingEnabled===true;if(trial){request.listing='enabled';request.paymentStatus='paid';request.paymentMethod='trial';request.trialAdvertising=true;request.trialGrantedAt=request.decidedAt}else{request.listing='waiting';request.paymentStatus=action==='approve'?'due':'not_due'}if(businessApp&&businessApp.status==='pending'){businessApp.status=request.status;businessApp.note=note;businessApp.decidedAt=request.decidedAt;if(request.status==='approved')businessApp.accountStatus='active'}}else if(action==='toggle'){if(request.status!=='approved'||request.paymentStatus!=='paid')return json(res,409,{error:'Only an approved listing with cleared payment or a trial exemption can be shown or hidden.'});request.listing=request.listing==='enabled'?'disabled':'enabled'}else return json(res,400,{error:'Unknown advertising action.'});reconcile(db);const trialLive=request.trialAdvertising&&request.status==='approved';notify(db,`business:${request.businessCode||request.email}`,trialLive?'Trial advertising live':`Advertising ${request.status}`,trialLive?`${mosque.name} approved your request. Your trial listing is now public with no payment required.`:`${mosque.name} ${request.status} your advertising request.`,'business-advertising',`advert-decision-${request.id}-${action}-${request.listing}`);await emailTransitions(before,db,admin?(session.name||session.email):mosque.name);await save(db);return json(res,200,{ok:true,status:request.status,listing:request.listing,paymentStatus:request.paymentStatus,trialAdvertising:Boolean(request.trialAdvertising)});
    }
    if(url.pathname==='/api/admin/product'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin']);if(!admin)return;const input=await body(req),db=await load(),products=db.masjidPointProducts||=[],action=String(input.action||'');
      if(action==='create'){
        const next=input.product||{},stock=Number(next.stock),price=Number(next.price),share=Number(next.mosqueSharePercent),image=String(next.image||'');
        if(!String(next.name||'').trim()||!String(next.description||'').trim()||!(price>0)||!Number.isInteger(stock)||stock<0||share<0||share>100||!Array.isArray(next.mosques)||!next.mosques.length||!image.startsWith('data:image/'))return json(res,400,{error:'Complete the product details, image, stock, price, share and mosque selection.'});
        if(Buffer.byteLength(image,'utf8')>3*1024*1024)return json(res,400,{error:'The product image is too large.'});
        const approved=new Map((db.masjidPointAdminApplications||[]).filter(item=>item.type==='masjid'&&['approved','activated'].includes(item.status)).map(item=>[item.reference,item]));
        const mosques=next.mosques.map(item=>approved.get(String(item.reference))).filter(Boolean);if(mosques.length!==next.mosques.length)return json(res,400,{error:'One of the selected mosque shops is unavailable.'});
        const product={id:`PRD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,name:String(next.name).trim().slice(0,160),description:String(next.description).trim().slice(0,800),category:String(next.category||'Other').trim().slice(0,80),price,stock,mosqueSharePercent:share,mosques:mosques.map(item=>({reference:item.reference,name:item.name})),image,visibility:'visible',createdAt:new Date().toISOString()};
        db.masjidPointProducts=db.masjidPointProducts||[];db.masjidPointProducts.unshift(product);audit(db,{action:'product.created',entityType:'product',entityId:product.id,actor:admin.name||admin.email,after:{name:product.name,stock,price}});await save(db);return json(res,201,{ok:true,product});
      }
      const product=products.find(item=>item.id===input.id);if(!product)return json(res,404,{error:'Product not found.'});
      if(action==='toggle')product.visibility=product.visibility==='visible'?'hidden':'visible';else if(action==='stock'){const stock=Number(input.stock);if(!Number.isInteger(stock)||stock<0)return json(res,400,{error:'Stock must be a whole number of zero or more.'});product.stock=stock;product.stockUpdatedAt=new Date().toISOString()}else if(action==='update'){const next=input.product||{},stock=Number(next.stock),price=Number(next.price),share=Number(next.mosqueSharePercent);if(!String(next.name||'').trim()||!String(next.description||'').trim()||!(price>0)||!Number.isInteger(stock)||stock<0||share<0||share>100||!Array.isArray(next.mosques)||!next.mosques.length)return json(res,400,{error:'Complete the product details, stock, price, share and mosque selection.'});Object.assign(product,{name:String(next.name).trim(),description:String(next.description).trim().slice(0,800),category:String(next.category||'Other').trim(),price,stock,mosqueSharePercent:share,mosques:next.mosques.map(item=>({reference:String(item.reference),name:String(item.name)})),image:String(next.image||product.image)})}else if(action==='delete'){db.masjidPointProducts=products.filter(item=>item.id!==product.id);audit(db,{action:'product.deleted',entityType:'product',entityId:product.id,actor:admin.name||admin.email,before:{name:product.name,stock:product.stock}});await save(db);return json(res,200,{ok:true})}else return json(res,400,{error:'Unknown product action.'});product.updatedAt=new Date().toISOString();audit(db,{action:`product.${action}`,entityType:'product',entityId:product.id,actor:admin.name||admin.email,after:{visibility:product.visibility,stock:product.stock,price:product.price}});await save(db);return json(res,200,{ok:true,product});
    }
    if(url.pathname==='/api/order/advance'&&req.method==='POST'){
      const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to update this order.'});const input=await body(req),db=await load(),order=(db.masjidPointShopOrders||[]).find(item=>item.id===input.id);if(!order)return json(res,404,{error:'Order not found.'});const app=accountApplication(db,session),admin=isAdminSession(session),isMosque=app?.type==='masjid'&&(order.collectionMasjidReference===app.reference||order.collectionMasjidName===app.name);if(!admin&&!isMosque)return json(res,403,{error:'This order does not belong to your account.'});const method=fulfilment.methodOf(order),at=new Date().toISOString();
      if(isMosque){if(order.status!=='mosque_received')return json(res,409,{error:'The order is not ready for mosque handover.'});order.status='delivered';order.deliveredAt=at;if(input.takePayment){if(method.paysUpfront)return json(res,400,{error:'This order was already paid by bank transfer.'});order.paymentStatus='paid';order.paidAt=at;order.paymentVerifiedBy=`masjid:${app.reference}`;order.cashTakenAtMosque=Number(order.total||0);order.mosqueOwesAdmin=Number((Number(order.total||0)-Number(order.mosqueRevenue||0)).toFixed(2));order.history||=[];order.history.push({status:'payment_taken_at_mosque',at,by:`masjid:${app.reference}`,amount:order.cashTakenAtMosque,owed:order.mosqueOwesAdmin})}}
      else{if(method.paysUpfront&&order.paymentStatus!=='paid')return json(res,409,{error:'Verify payment before fulfilment.'});const next=fulfilment.nextStatus(order);if(!next)return json(res,409,{error:'This order has no further fulfilment step.'});order.status=next;if(next==='delivered')order.deliveredAt=at}
      order.updatedAt=at;order.history||=[];order.history.push({status:order.status,at,by:admin?(session.name||session.email):`masjid:${app.reference}`});if(['ready_for_mosque','mosque_received'].includes(order.status))notify(db,`masjid:${order.collectionMasjidName}`,order.status==='ready_for_mosque'?'Order on its way':'Order ready to hand over',`${order.id} is ${order.status==='ready_for_mosque'?'on its way to your mosque':'ready for the customer'}.`,'masjid-orders',`order-${order.status}-${order.id}`);await save(db);return json(res,200,{ok:true,status:order.status});
    }
    if (url.pathname==='/api/state' && req.method==='GET') { const supplied=Boolean(req.headers['x-masjidpoint-session']);const session=readSession(req);if(supplied&&!session)return json(res,401,{error:'Your session has expired. Please sign in again.'});const db=await load(); reconcile(db); await save(db); return json(res,200,stateForSession(db,session)); }
    if (url.pathname.startsWith('/api/collection/') && req.method==='PUT') {
      const key=decodeURIComponent(url.pathname.split('/').pop());
      // Only the collections the application actually owns may be written, so a typo or a
      // crafted request cannot graft arbitrary keys onto the stored state.
      if(!WRITABLE_COLLECTIONS.has(key))return json(res,400,{error:`Unknown collection "${key}".`});
      const value=await body(req), db=await load(), previousJobs=JSON.parse(JSON.stringify(db.masjidPointJobs||[]));

      // Who may change what.
      //
      // The whole collection is sent on every save, so a write cannot be read as "add one row" —
      // it has to be compared against what is stored. Registering a masjid, applying to advertise,
      // applying for a job and buying from a shop all happen before anyone signs in, so those
      // additions must stay open. Removing or rewriting what is already there must not be.
      const session=readSession(req);
      const isAdmin=isAdminSession(session);

      // Money, prices, bank details and the administrators themselves are only ever written from
      // the admin pages. Nothing else has any business touching them.
      const ADMIN_ONLY=new Set(['masjidPointAdminUsers','masjidPointFinance','masjidPointPlatformSettings','masjidPointMasjidPricing','masjidPointActivatedAccounts','masjidPointCustomers']);
      if(ADMIN_ONLY.has(key)&&!isAdmin)
        return json(res,403,{error:'Only an administrator can change this.'});

      if(Array.isArray(seed[key])&&!Array.isArray(value))return json(res,400,{error:`Collection "${key}" must be an array.`});
      if(!isAdmin&&process.env.MASJIDPOINT_TEST_MODE!=='1'&&Array.isArray(seed[key])){
        const stored=Array.isArray(db[key])?db[key]:[],incoming=value;
        const existing=new Map(stored.map(row=>[rowId(row),row]));
        const PUBLIC_APPEND=new Set(['masjidPointAdminApplications','masjidPointBusinessRequests','masjidPointJobApplications','masjidPointShopOrders','masjidPointNotifications']);
        if(!session){
          if(!PUBLIC_APPEND.has(key))return json(res,403,{error:'Sign in to change this collection.'});
          for(const row of incoming){const old=existing.get(rowId(row));if(old&&JSON.stringify(old)!==JSON.stringify(row))return json(res,403,{error:'Public submissions cannot alter an existing record.'});}
          value=[...stored,...incoming.filter(row=>!existing.has(rowId(row)))];
        }else{
          const incomingById=new Map(incoming.map(row=>[rowId(row),row]));
          for(const row of incoming){const old=existing.get(rowId(row));if((!old||JSON.stringify(old)!==JSON.stringify(row))&&!ownsCollectionRow(db,session,key,row))return json(res,403,{error:'You can change only records owned by your account.'});}
          value=stored.filter(row=>!ownsCollectionRow(db,session,key,row)||incomingById.has(rowId(row))).map(row=>incomingById.get(rowId(row))||row);
          for(const row of incoming)if(!existing.has(rowId(row)))value.push(row);
        }
      }
      const before=JSON.parse(JSON.stringify(db)),actor=String(req.headers['x-admin-name']||'System').slice(0,100);if(key==='masjidPointFinance')value.audit=db.masjidPointFinance?.audit||[];db[key]=value; reconcile(db, previousJobs); await emailTransitions(before,db,actor);await save(db); return json(res,200,{ok:true,state:db});
    }
    if (url.pathname==='/api/notifications/read' && req.method==='POST') { const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to update notifications.'});const {id}=await body(req),db=await load(),n=db.masjidPointNotifications.find(x=>x.id===id);if(!n)return json(res,404,{error:'Notification not found.'});const allowed=isAdminSession(session)?n.audience==='admin':ownsCollectionRow(db,session,'masjidPointNotifications',n);if(!allowed)return json(res,403,{error:'This notification does not belong to your account.'});n.read=true;await save(db);return json(res,200,{ok:true}); }
    if(url.pathname==='/api/admin/customers/action'&&req.method==='POST'){
      const admin=requireAdmin(req,res,['super_admin','admin']);if(!admin)return;const input=await body(req),db=await load(),customer=(db.masjidPointCustomers||[]).find(item=>item.id===input.id),action=String(input.action||''),note=String(input.note||'').trim();if(!customer)return json(res,404,{error:'Individual account not found.'});if(!['block','activate','delete'].includes(action))return json(res,400,{error:'Choose block, activate or delete.'});
      const before={status:customer.status,email:customer.email};if(action==='delete'){db.masjidPointCustomers=db.masjidPointCustomers.filter(item=>item.id!==customer.id);db.masjidPointEmailTokens=(db.masjidPointEmailTokens||[]).filter(item=>item.customerId!==customer.id);audit(db,{action:'customer.deleted',entityType:'customer',entityId:customer.id,actor:admin.name||admin.email,reason:note,before,after:{deleted:true}})}else{customer.status=action==='block'?'blocked':'active';customer.accountNote=note;customer.accountUpdatedAt=new Date().toISOString();customer.accountUpdatedBy=admin.name||admin.email;audit(db,{action:`customer.${customer.status}`,entityType:'customer',entityId:customer.id,actor:customer.accountUpdatedBy,reason:note,before,after:{status:customer.status}})}await save(db);return json(res,200,{ok:true,status:action==='delete'?'deleted':customer.status});
    }
    /* ---------------------------------------------------- individual accounts */
    // Community members who apply for jobs or shop do so without an account. These endpoints
    // let them claim one afterwards, so their existing applications and orders — matched on the
    // email they already gave — become visible in one place.
    if (url.pathname==='/api/customer/signup' && req.method==='POST') {
      const input=await body(req),{name,email,phone,address}=input;if(!limit(req,res,'customer-signup',5,60*60000,email))return;const db=await load();
      const clean=String(email||'').trim().toLowerCase();
      if(!String(name||'').trim())return json(res,400,{error:'Please give your name.'});
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))return json(res,400,{error:'Please give a valid email address.'});
      const passwordHash=await passwordForStorage(input);
      db.masjidPointCustomers||=[];
      const existingCustomer=db.masjidPointCustomers.find(c=>String(c.email).toLowerCase()===clean);
      if(existingCustomer?.passwordHash)
        return json(res,409,{error:'An account already exists for this email. Please sign in instead.'});
      // A masjid or business account uses the same sign-in form, so the email must be free there too.
      if((db.masjidPointActivatedAccounts||[]).some(a=>String(a.email).toLowerCase()===clean))
        return json(res,409,{error:'This email is already registered as a masjid or business account.'});
      const customer=existingCustomer||{id:`CUS-${Date.now()}`,email:clean,createdAt:new Date().toISOString(),applicationReferences:[],orderReferences:[]};
      Object.assign(customer,{name:String(name).trim(),phone:String(phone||'').trim(),address:address&&typeof address==='object'?address:null,passwordHash,status:'pending_verification',emailVerified:false});
      if(!existingCustomer)db.masjidPointCustomers.push(customer);
      const code=process.env.MASJIDPOINT_TEST_MODE==='1'?'123456':String(crypto.randomInt(0,1000000)).padStart(6,'0');
      db.masjidPointEmailTokens||=[];
      db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>!(x.purpose==='customer_verification'&&String(x.email).toLowerCase()===clean&&!x.usedAt));
      db.masjidPointEmailTokens.push({hash:tokenHash(code),purpose:'customer_verification',customerId:customer.id,email:clean,expiresAt:new Date(Date.now()+10*60000).toISOString(),createdAt:new Date().toISOString(),attempts:0});
      await save(db);
      try{await emailService.verificationCode(clean,code)}catch(error){console.error('Customer verification email failed:',error.message);return json(res,502,{error:'Your account was saved, but the verification email could not be sent. Please use Resend code.'})}
      const {passwordHash:_omit,...safe}=customer;
      return json(res,201,{ok:true,customer:safe,verificationRequired:true,message:'We sent a verification code to your email.'});
    }
    if(url.pathname==='/api/customer/verification/send'&&req.method==='POST'){
      const input=await body(req),email=String(input.email||'').trim().toLowerCase();if(!limit(req,res,'customer-code-send',3,10*60000,email))return;const db=await load(),customer=(db.masjidPointCustomers||[]).find(c=>String(c.email).toLowerCase()===email);
      if(!customer)return json(res,404,{error:'No individual account matches this email. Create an account first.'});
      if(customer.emailVerified)return json(res,409,{error:'This email is already verified. Please sign in.'});
      db.masjidPointEmailTokens||=[];const recent=db.masjidPointEmailTokens.find(x=>x.purpose==='customer_verification'&&String(x.email).toLowerCase()===email&&!x.usedAt&&Date.now()-new Date(x.createdAt).getTime()<60000);
      if(recent)return json(res,429,{error:'Please wait one minute before requesting another code.'});
      const code=process.env.MASJIDPOINT_TEST_MODE==='1'?'123456':String(crypto.randomInt(0,1000000)).padStart(6,'0');
      db.masjidPointEmailTokens=db.masjidPointEmailTokens.filter(x=>!(x.purpose==='customer_verification'&&String(x.email).toLowerCase()===email&&!x.usedAt));
      db.masjidPointEmailTokens.push({hash:tokenHash(code),purpose:'customer_verification',customerId:customer.id,email,expiresAt:new Date(Date.now()+10*60000).toISOString(),createdAt:new Date().toISOString(),attempts:0});customer.status='pending_verification';customer.emailVerified=false;await save(db);
      try{await emailService.verificationCode(email,code)}catch(error){console.error('Customer verification email failed:',error.message);return json(res,502,{error:'The verification email could not be sent. Please try again.'})}
      return json(res,200,{ok:true,message:'A new verification code has been sent.'});
    }
    if(url.pathname==='/api/customer/verification/verify'&&req.method==='POST'){
      const input=await body(req),email=String(input.email||'').trim().toLowerCase();if(!limit(req,res,'customer-code-verify',8,10*60000,email))return;const db=await load(),code=String(input.code||'').replace(/\D/g,''),customer=(db.masjidPointCustomers||[]).find(c=>String(c.email).toLowerCase()===email);
      if(!customer)return json(res,404,{error:'Individual account not found.'});
      const record=(db.masjidPointEmailTokens||[]).find(x=>x.purpose==='customer_verification'&&String(x.email).toLowerCase()===email&&!x.usedAt&&new Date(x.expiresAt)>new Date());
      if(!record)return json(res,400,{error:'This verification code has expired. Request a new code.'});record.attempts=Number(record.attempts||0)+1;
      if(record.attempts>5){await save(db);return json(res,429,{error:'Too many incorrect attempts. Request a new code.'})}if(record.hash!==tokenHash(code)){await save(db);return json(res,400,{error:'The verification code is incorrect.'})}
      record.usedAt=new Date().toISOString();customer.emailVerified=true;customer.status='active';customer.emailVerifiedAt=new Date().toISOString();await save(db);return json(res,200,{ok:true,message:'Email verified. You can now sign in.'});
    }
    if (url.pathname==='/api/customer/login' && req.method==='POST') {
      const input=await body(req),{email}=input;if(!limit(req,res,'customer-login',8,15*60000,email))return;const db=await load();
      const clean=String(email||'').trim().toLowerCase();
      const customer=(db.masjidPointCustomers||[]).find(c=>String(c.email).toLowerCase()===clean);
      if(!customer||!await passwordMatches(customer,input.password,input.passwordHash))return json(res,401,{error:'Email or password is incorrect.'});
      if(customer.status==='blocked')return json(res,403,{error:'This individual account has been blocked. Contact support for help.'});
      if(!customer.emailVerified)return json(res,403,{error:'Please verify your email before signing in.',verificationRequired:true,email:clean});
      const {passwordHash:_omit,...safe}=customer;
      const customerToken=issueSession({role:'customer',email:customer.email,id:customer.id});
      await save(db);return json(res,200,{ok:true,customer:safe,session:customerToken,expiresAt:Date.now()+SESSION_MINUTES*60000},sessionCookie(customerToken,req));
    }
    // Individuals give very little up front, so the portal lets them fill in the rest later.
    if (url.pathname==='/api/customer/profile' && req.method==='POST') {
      const input=await body(req),{id,name,phone,address}=input,db=await load();
      const customer=(db.masjidPointCustomers||[]).find(c=>c.id===id);
      const session=readSession(req);if(!customer||session?.role!=='customer'||session.id!==customer.id||!await passwordMatches(customer,input.currentPassword,input.passwordHash))return json(res,401,{error:'Please sign in again.'});
      if(name!==undefined&&String(name).trim())customer.name=String(name).trim();
      if(phone!==undefined)customer.phone=String(phone||'').trim();
      if(address!==undefined)customer.address=address&&typeof address==='object'?address:null;
      if(input.newPassword||input.newPasswordHash){
        customer.passwordHash=await passwordForStorage({password:input.newPassword,passwordHash:input.newPasswordHash});
      }
      customer.updatedAt=new Date().toISOString();
      await save(db);
      const {passwordHash:_omit,...safe}=customer;
      return json(res,200,{ok:true,customer:safe});
    }

    // A mosque paying MasjidPoint back for cash it took at the counter. The opposite direction
    // to /api/settle, so it clears the orders rather than paying a share out.
    if (url.pathname==='/api/mosque-cash/remit' && req.method==='POST') {
      const admin=requireAdmin(req,res,['super_admin','admin','finance_admin']);if(!admin)return;
      const {masjid,transactionReference,note,actor}=await body(req),db=await load();
      if(!String(transactionReference||'').trim())return json(res,400,{error:'A bank transaction reference is required.'});
      reconcile(db);const finance=db.masjidPointFinance;finance.cashRemittances||=[];
      const outstanding=settlementRegister.cashHeld(db,masjid);
      const amount=Number(outstanding.reduce((sum,item)=>sum+item.owed,0).toFixed(2));
      if(amount<=0)return json(res,400,{error:'This mosque does not owe anything from cash sales.'});
      const record={id:`CSH-${Date.now()}`,masjid,orderIds:outstanding.map(item=>item.id),amount,transactionReference:String(transactionReference).trim(),note:String(note||'').trim(),receivedAt:new Date().toISOString()};
      finance.cashRemittances.push(record);
      audit(db,{action:'cash.remitted',entityType:'masjid',entityId:masjid,actor:admin.name||admin.email,reason:record.note,after:{amount},metadata:{amount,transactionReference,orders:record.orderIds.length}});
      notify(db,`masjid:${masjid}`,'Cash payment recorded',`MasjidPoint recorded your £${amount.toFixed(2)} payment for cash shop sales.`,'masjid-portal#shop-orders',`cash-remit-${record.id}`);
      await save(db);
      return json(res,200,{ok:true,amount,orders:record.orderIds.length});
    }
    // One transfer that clears both directions at once: the mosque's unpaid shares and the cash
    // it still holds are settled together, so only the net amount actually moves.
    if (url.pathname==='/api/settle/net' && req.method==='POST') {
      const admin=requireAdmin(req,res,['super_admin','admin','finance_admin']);if(!admin)return;
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
      audit(db,{action:'settlement.net',entityType:'masjid',entityId:masjid,actor:admin.name||admin.email,reason:cleanNote,after:{net},metadata:{owedOut,owedIn,net,transactionReference:reference,settlementId}});
      notify(db,`masjid:${masjid}`,'Settlement completed',net>=0?`MasjidPoint sent £${Math.abs(net).toFixed(2)} after offsetting £${owedIn.toFixed(2)} of cash you collected.`:`MasjidPoint recorded £${Math.abs(net).toFixed(2)} received from you after offsetting £${owedOut.toFixed(2)} of shares owed.`,'masjid-portal#shop-orders',`net-settle-${settlementId}`);
      await save(db);
      return json(res,200,{ok:true,owedOut,owedIn,net});
    }
    if (url.pathname==='/api/settle' && req.method==='POST') {
      const admin=requireAdmin(req,res,['super_admin','admin','finance_admin']);if(!admin)return;
      const {masjid,transactionReference,note,evidence}=await body(req),db=await load();if(!String(transactionReference||'').trim())return json(res,400,{error:'A bank transaction reference is required.'});const evidenceUpload=evidence?dataUrlFile(evidence.dataUrl):null;if(evidence&&!evidenceUpload)return json(res,400,{error:'Settlement evidence must be a PNG, JPG, WEBP or PDF no larger than 5 MB.'});reconcile(db); const finance=db.masjidPointFinance; finance.settlementHistory ||= [];
      // Jobs, adverts and bank-paid shop orders all settle together through the shared register.
      const earned=settlementRegister.earnings(db,masjid),paid=earned.jobs,adverts=earned.adverts,shopShares=earned.shop;
      const amount=Number([...paid,...adverts,...shopShares].reduce((s,item)=>s+item.share,0).toFixed(2)); if(amount<=0)return json(res,400,{error:'Nothing is currently due.'});
      const settlementId=`SET-${Date.now()}`,stampedAt=new Date().toISOString(),savedEvidence=evidenceUpload?await objectStorage.put({kind:'payment_proof',ownerType:'settlement',ownerId:settlementId,name:String(evidence.fileName||'settlement-evidence').slice(0,180),mime:evidenceUpload.mime,buffer:evidenceUpload.buffer}):null,entry=extra=>({masjid,transactionReference:String(transactionReference).trim(),note:String(note||'').trim(),settledAt:stampedAt,...extra});
      paid.forEach(m=>finance.settlementHistory.push(entry({id:`${settlementId}-${m.id}`,jobId:m.id,amount:m.share})));
      adverts.forEach(item=>finance.settlementHistory.push(entry({id:`${settlementId}-${item.id}`,requestId:item.id,amount:item.share})));
      shopShares.forEach(item=>finance.settlementHistory.push(entry({id:`${settlementId}-${item.id}`,orderId:item.id,amount:item.share}))); finance.settled[masjid]=(finance.settled[masjid]||0)+amount;audit(db,{action:'settlement.sent',entityType:'masjid',entityId:masjid,actor:admin.name||admin.email,reason:String(note||'').trim(),before:{settled:Number(finance.settled[masjid])-amount},after:{settled:finance.settled[masjid]},metadata:{amount,transactionReference,settlementId}});const masjidApp=(db.masjidPointAdminApplications||[]).find(x=>x.type==='masjid'&&x.name===masjid);try{await emailService.settlement(masjidApp?.email,masjid,amount)}catch(error){console.error('Settlement email failed:',error.message)}
      if(savedEvidence)finance.settlementHistory.filter(item=>item.id.startsWith(settlementId)).forEach(item=>item.evidence=savedEvidence);notify(db,`masjid:${masjid}`,'Settlement sent',`Admin marked £${amount.toFixed(2)} as transferred to your mosque.`,'masjid-portal#settlements',`settled-${masjid}-${Date.now()}`); save(db); return json(res,200,{ok:true,amount,state:db});
    }
    if(url.pathname==='/api/settlement/evidence'&&req.method==='GET'){
      const session=readSession(req);if(!session)return json(res,401,{error:'Sign in to view settlement evidence.'});const db=await load(),entry=(db.masjidPointFinance?.settlementHistory||[]).find(item=>item.id===url.searchParams.get('id'));if(!entry?.evidence)return json(res,404,{error:'Settlement evidence not found.'});const app=accountApplication(db,session),allowed=isAdminSession(session)||(app?.type==='masjid'&&app.name===entry.masjid);if(!allowed)return json(res,403,{error:'This evidence does not belong to your account.'});return privateFile(res,entry.evidence);
    }
    // The URL space stays flat — /styles.css, /masjid-shop.js, /assets/logo.svg — while the files
    // themselves are filed by kind. Each request is resolved against these roots in order, so
    // moving a file between them never changes the address anything links to.
    const staticRoots=[path.join(root,'public'),path.join(root,'public','css'),path.join(root,'public','js'),path.join(root,'lib'),root];
    // Each masjid portal section has its own address, served by the one portal document.
    // portal-section.js then shows the section that address names. They are not separate files
    // because masjid-portal.js reads its elements without checking they exist, so a page missing
    // the parts it does not show would throw on every one of them.
    const PORTAL_SECTIONS={'/masjid-requests':1,'/masjid-jobs':1,'/masjid-orders':1,'/masjid-qr':1,'/masjid-listings':1};
    const BUSINESS_SECTIONS={'/business-advertising':1,'/business-profile':1,'/business-invoices':1,'/business-applicants':1};
    const requested=decodeURIComponent(
      url.pathname==='/'?'/index':(PORTAL_SECTIONS[url.pathname]?'/masjid-portal':(BUSINESS_SECTIONS[url.pathname]?'/business-portal':url.pathname)));
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
  } catch(e) { json(res,Number(e.status)||500,{error:Number(e.status)?e.message:'The request could not be completed.'}); if(!e.status)console.error(e); }
});
// If this deployment has no administrators yet, the bootstrap account above is the only way in, so
// say what its password is. Printed once, to the log, and only when it was generated rather than
// supplied — there is otherwise no way for anyone to know it.
async function announceBootstrapAdmin(){
  if(!bootstrapAdminGenerated) return;
  try{
    const db=await load();
    // Not "are there no administrators" — a fresh deployment loads the seed, so there is always
    // one. The question is whether the bootstrap password still opens an account, which is exactly
    // when it is worth saying that a published default is what stands in front of the panel.
    const bootstrap=(db.masjidPointAdminUsers||[]).find(x=>x.id==='ADM-0001'&&x.status==='active');
    if(!bootstrap||!await bcrypt.compare(bootstrapAdminPassword,String(bootstrap.passwordHash||'')).catch(()=>false)) return;
    console.log('');
    console.log(`  Temporary local administrator: ${bootstrap.email}`);
    console.log(`  One-time generated password: ${bootstrapAdminPassword}`);
    console.log('  Set ADMIN_PASSWORD in the environment before any persistent deployment.');
    console.log('');
  }catch{}
}

function validateProductionEnvironment(){
  if(process.env.NODE_ENV!=='production')return;
  const missing=['DATABASE_URL','SESSION_SECRET','ADMIN_PASSWORD','APP_BASE_URL','SMTP_HOST','OBJECT_STORAGE_BUCKET'].filter(key=>!process.env[key]);
  if(missing.length)throw new Error(`Production configuration is missing: ${missing.join(', ')}`);
  if(String(process.env.SESSION_SECRET).length<48)throw new Error('SESSION_SECRET must contain at least 48 characters.');
  if(!passwordStrong(process.env.ADMIN_PASSWORD))throw new Error('ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, a number and a symbol.');
  if(!String(process.env.APP_BASE_URL).startsWith('https://'))throw new Error('APP_BASE_URL must use HTTPS in production.');
}
try{validateProductionEnvironment()}catch(error){console.error(`Startup failed: ${error.message}`);process.exit(1)}
Promise.all([repository.init(),emailService.init()])
  .then(announceBootstrapAdmin)
  .then(()=>server.listen(port,'127.0.0.1',()=>console.log(`MasjidPoint server: http://127.0.0.1:${port} (${process.env.DATABASE_URL?'PostgreSQL':'development JSON fallback'})`)))
  .catch(error=>{console.error(`Startup failed: ${error.message}`);process.exit(1)});
