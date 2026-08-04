const crypto=require('crypto');
const base=process.env.MASJIDPOINT_URL||'http://127.0.0.1:4174';
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const get=path=>fetch(base+path,{cache:'no-store'}).then(async r=>{assert(r.ok,`${path} returned ${r.status}`);return r.headers.get('content-type')?.includes('json')?r.json():r.text()});
const put=(key,value)=>fetch(`${base}/api/collection/${key}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}).then(async r=>{assert(r.ok,`Saving ${key} returned ${r.status}`);return r.json()});
const passwordHash=value=>crypto.createHash('sha256').update(value).digest('hex');
(async()=>{
  const stamp=Date.now().toString().slice(-6),reference=`MSJ-TEST-${stamp}`,email=`automated.masjid.${stamp}@example.test`,name=`Automated Test Masjid ${stamp}`,password=`Test!${stamp}Aa`;
  let state=await get('/api/state'),applications=state.masjidPointAdminApplications||[],notifications=state.masjidPointNotifications||[];
  const application={id:reference,type:'masjid',name,email,reference,status:'pending',submittedAt:new Date().toISOString(),details:{'Masjid name':name,'Address':'1 Test Street, Birmingham, B12 0XS','Postcode':'B12 0XS','Primary contact':'Automated Tester','Role':'Trustee','Contact number':'07123 000000','Email':email}};
  applications.unshift(application);notifications.unshift({id:`NTF-${stamp}`,audience:'admin',title:'New masjid registration',message:`${name} submitted an application (${reference}).`,href:`admin.html?application=${reference}#applications`,key:`masjid-application-${reference}`,read:false,createdAt:application.submittedAt});
  await put('masjidPointAdminApplications',applications);await put('masjidPointNotifications',notifications);
  state=await get('/api/state');assert(state.masjidPointAdminApplications.some(a=>a.reference===reference&&a.status==='pending'),'New mosque did not appear as pending');assert(state.masjidPointNotifications.some(n=>n.key===`masjid-application-${reference}`&&n.audience==='admin'),'Admin notification was not created');
  applications=state.masjidPointAdminApplications;const approved=applications.find(a=>a.reference===reference);Object.assign(approved,{status:'approved',accountStatus:'active',note:'Approved by automated test',decidedAt:new Date().toISOString()});await put('masjidPointAdminApplications',applications);
  state=await get('/api/state');assert(state.masjidPointAdminApplications.find(a=>a.reference===reference)?.status==='approved','Approved status was not persisted');
  applications=state.masjidPointAdminApplications;const activated=applications.find(a=>a.reference===reference);Object.assign(activated,{status:'activated',activatedAt:new Date().toISOString(),email});let accounts=state.masjidPointActivatedAccounts||[];accounts.unshift({reference,email,verified:true,activatedAt:activated.activatedAt,passwordHash:passwordHash(password)});await put('masjidPointAdminApplications',applications);await put('masjidPointActivatedAccounts',accounts);
  state=await get('/api/state');const loginAccount=state.masjidPointActivatedAccounts.find(a=>a.reference===reference);assert(loginAccount?.verified,'Account was not activated');assert(loginAccount.passwordHash===passwordHash(password),'Password verification failed');const portal=await get('/masjid-portal.html');assert(portal.includes('portal-auth.js'),'Masjid portal is not protected by the login guard');
  console.log(JSON.stringify({passed:true,name,reference,email,password,checks:['registration saved','pending status visible','admin notification created','admin approval persisted','account activated','password login verified','portal login guard present']},null,2));
})().catch(error=>{console.error(error.stack);process.exit(1)});
