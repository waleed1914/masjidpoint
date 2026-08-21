const assert=require('assert');
const base=process.env.MASJIDPOINT_URL||'http://127.0.0.1:4174';

(async()=>{
  const home=await fetch(`${base}/`);
  assert.strictEqual(home.status,200,'Public home page is unavailable');
  for(const pathname of ['/.git/config','/.env','/package.json','/server.js','/lib/db.js','/data/masjidpoint.json']){
    const response=await fetch(base+pathname);
    assert.strictEqual(response.status,404,`${pathname} is publicly accessible`);
  }
  const state=await fetch(`${base}/api/state`,{headers:{'Accept-Encoding':'gzip'}});
  assert.strictEqual(state.status,200,'Public state is unavailable');
  assert.strictEqual(state.headers.get('content-encoding'),'gzip','Large JSON responses are not compressed');
  assert.ok((await state.json()).masjidPointAdminApplications,'Compressed state is not valid JSON');
  console.log('PASS static server exposes public assets only');
})().catch(error=>{console.error('FAIL',error);process.exit(1)});
