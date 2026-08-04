const base=process.env.MASJIDPOINT_URL||'http://127.0.0.1:4174',reference=process.argv[2]||require('./seed-demo-data.js').BUSINESSES.find(b=>b.advert&&b.advert.paid).ref;
async function put(key,value){const response=await fetch(`${base}/api/collection/${key}`,{method:'PUT',headers:{'Content-Type':'application/json','X-Admin-Name':'Test data setup'},body:JSON.stringify(value)});if(!response.ok)throw Error(await response.text())}
const state=()=>fetch(`${base}/api/state`).then(response=>response.json());
async function main(){
 let db=await state();
 const requests=db.masjidPointBusinessRequests||[],request=requests.find(item=>item.reference===reference);
 if(!request)throw Error(`Advert request ${reference} not found.`);
 const app=(db.masjidPointAdminApplications||[]).find(item=>item.reference===reference);
 if(!app?.businessCode)throw Error('The advert has no permanent business code.');
 // A settled invoice re-marks its request as paid on every reconcile, so clear the settled
 // advertising invoice before returning the request itself to the unpaid state.
 const finance=db.masjidPointFinance,account=(finance.accounts||[]).find(item=>item.code===app.businessCode);
 if(!account)throw Error(`No finance account for ${app.businessCode}.`);
 const settled=(account.invoices||[]).filter(item=>(item.lines||[]).some(line=>line.requestId===request.id));
 const numbers=new Set(settled.map(item=>item.number));
 account.invoices=(account.invoices||[]).filter(item=>!numbers.has(item.number));
 account.payments=(account.payments||[]).filter(item=>!numbers.has(item.invoice));
 finance.settlementHistory=(finance.settlementHistory||[]).filter(item=>item.requestId!==request.id);
 await put('masjidPointFinance',finance);
 await put('masjidPointPaymentProofs',(db.masjidPointPaymentProofs||[]).filter(proof=>!numbers.has(proof.invoice)));
 Object.assign(request,{status:'approved',paymentStatus:'due',listing:'disabled'});
 await put('masjidPointBusinessRequests',requests);
 db=await state();
 const rebuilt=(db.masjidPointFinance?.accounts||[]).find(item=>item.code===app.businessCode);
 const invoice=(rebuilt?.invoices||[]).find(item=>Number(item.paid||0)<Number(item.amount)&&(item.lines||[]).some(line=>line.requestId===request.id));
 if(!invoice)throw Error('No outstanding advertising invoice was regenerated for this request.');
 const outstanding=Number(invoice.amount)-Number(invoice.paid||0);
 console.log(`Reset advert ${reference} to unpaid: ${invoice.number} owing £${outstanding.toFixed(2)} for ${request.masjid}.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
