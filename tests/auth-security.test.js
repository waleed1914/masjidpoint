const assert=require('assert');
const fs=require('fs');
const path=require('path');
const accounts=require('./seed-accounts');
const base=accounts.BASE;
const post=(route,body,token='')=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-MasjidPoint-Session':token}:{})},body:JSON.stringify(body)});

(async()=>{
  let response=await post('/api/admin/login',{email:accounts.ADMIN.email,password:accounts.ADMIN.password});
  let result=await response.json();assert.strictEqual(response.status,200,result.error);let token=result.session;
  const file=path.join(process.env.MASJIDPOINT_DATA_DIR,'masjidpoint.json');let db=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.match(db.masjidPointAdminUsers[0].passwordHash,/^\$2[aby]\$/,'legacy administrator password was not migrated to bcrypt');
  assert.ok(!JSON.stringify(await fetch(base+'/api/state').then(r=>r.json())).includes(db.masjidPointAdminUsers[0].passwordHash),'password hash leaked through public state');

  response=await post('/api/admin/users/2fa',{id:db.masjidPointAdminUsers[0].id,enabled:true},token);assert.strictEqual(response.status,200);
  response=await post('/api/admin/login',{email:accounts.ADMIN.email,password:accounts.ADMIN.password});result=await response.json();assert.ok(result.twoFactorRequired&&result.challenge,`2FA challenge was not issued (${response.status}: ${result.error||'no error'})`);
  response=await post('/api/admin/login/2fa',{challenge:result.challenge,code:'123456'});result=await response.json();assert.strictEqual(response.status,200,result.error);token=result.session;
  await post('/api/admin/users/2fa',{id:db.masjidPointAdminUsers[0].id,enabled:false},token);

  for(let i=0;i<6;i++)response=await post('/api/admin/login',{email:'blocked-attempt@example.test',password:'Wrong!Password123'});
  assert.strictEqual(response.status,429,'login rate limiter did not activate');
  console.log('PASS authentication security');
})().catch(error=>{console.error('FAIL',error);process.exit(1)});
