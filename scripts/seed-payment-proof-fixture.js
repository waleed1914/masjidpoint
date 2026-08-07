const base = process.env.MASJIDPOINT_URL || 'http://127.0.0.1:4174';
async function main(){
 const state=await fetch(`${base}/api/state`).then(response=>response.json());
 const seeded=require('./seed-demo-data.js').BUSINESSES.find(b=>b.password&&b.status==='activated');
 if(!seeded)throw Error('No activated seeded business is available.');
 const business=(state.masjidPointAdminApplications||[]).find(item=>item.reference===seeded.ref);
 if(!business)throw Error('Seeded business is missing from the current dataset.');
 const mosqueName=business.details?.['Selected masjid'];
 const pricing=(state.masjidPointMasjidPricing||[]).find(item=>item.masjidName===mosqueName);
 const jobs=(state.masjidPointJobs||[]).filter(job=>!String(job.id).startsWith('JOB-PROOF-')),stamp=Date.now().toString().slice(-6);
 jobs.push({id:`JOB-PROOF-${stamp}`,title:`Payment Proof Test Job ${stamp}`,business:business.name,businessReference:business.reference,businessCode:business.businessCode,employmentType:'Full time',arrangement:'Hybrid',city:'Birmingham',postcode:'B12 0XS',salaryFrom:'30000',salaryTo:'36000',payPeriod:'year',description:'A dedicated payment-proof workflow test vacancy.',shortDescription:'Payment proof workflow fixture.',industry:'Technology',closingDate:'2026-12-31',masjids:[{name:mosqueName,fee:Number(pricing?.jobPrice||5),status:'pending',paymentStatus:'not_due'}],masjid:mosqueName,fee:Number(pricing?.jobPrice||5),status:'pending',enabled:false,submittedAt:new Date().toISOString()});
 const passwordHash=require('crypto').createHash('sha256').update(require('./seed-demo-data.js').ADMIN_PASSWORD).digest('hex');
 // Re-running this replaces the previous fixture job, and dropping a record needs a session.
 const signIn=await fetch(`${base}/api/admin/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@masjidpoint.co.uk',passwordHash})});
 const session=signIn.ok?(await signIn.json()).session||'':'';
 const response=await fetch(`${base}/api/collection/masjidPointJobs`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Automated test fixture','X-MasjidPoint-Session':session},body:JSON.stringify(jobs)});
 if(!response.ok)throw Error(await response.text());
 console.log(`Created unpaid proof fixture for ${business.name} (${business.businessCode})`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
