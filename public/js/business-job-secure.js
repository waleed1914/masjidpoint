(function () {
  if(window.__masjidPointSecureJobs)return;window.__masjidPointSecureJobs=true;
  const ready = callback => document.readyState === 'loading' ? addEventListener('DOMContentLoaded', callback, {once:true}) : callback();
  ready(async () => {
    const form=document.querySelector('#job-form');if(!form)return;
    let mosqueReferences=new Map();
    try { const state=await MasjidDB.state(); mosqueReferences=new Map((state.masjidPointAdminApplications||[]).filter(item=>item.type==='masjid').map(item=>[item.name,item.reference])); const session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null'); const own=(state.masjidPointJobs||[]).filter(job=>job.businessReference===session?.reference||job.businessCode===session?.businessCode); jobs.splice(0,jobs.length,...own); localStorage.setItem('masjidPointJobs',JSON.stringify(own)); render(); } catch (_) {}
    document.addEventListener('submit',async event=>{
      if(event.target!==form)return;
      event.preventDefault();event.stopImmediatePropagation();
      const required=[...form.querySelectorAll('[required]')],missing=required.filter(field=>!field.checkValidity()),selected=[...form.querySelectorAll('input[name="masjid"]:checked')];
      missing.forEach(field=>field.classList.add('invalid'));document.querySelector('#job-masjid-error').hidden=selected.length>0;
      if(missing.length||!selected.length){(missing[0]||document.querySelector('.job-masjids'))?.scrollIntoView({behavior:'smooth',block:'center'});toast('Please complete all required fields before submitting.');return}
      const data=new FormData(form),button=form.querySelector('button[type="submit"]'),session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null');button.disabled=true;button.textContent='Saving job…';
      const payload={title:data.get('title'),employmentType:data.get('employmentType'),arrangement:data.get('arrangement'),city:data.get('city'),postcode:data.get('postcode'),salaryFrom:data.get('salaryFrom'),salaryTo:data.get('salaryTo'),payPeriod:data.get('payPeriod'),description:data.get('description'),shortDescription:data.get('shortDescription'),industry:data.get('industry'),educationLevel:data.get('educationLevel'),experienceLevel:data.get('experienceLevel'),closingDate:data.get('closingDate'),responsibilities:data.get('responsibilities'),requirements:data.get('requirements'),benefits:data.get('benefits'),tags:String(data.get('tags')||'').split(',').map(item=>item.trim()).filter(Boolean),encouraged:data.getAll('encouraged'),masjids:selected.map(input=>input.dataset.reference||mosqueReferences.get(input.value)).filter(Boolean)};
      try{const response=await fetch('/api/business/job',{method:'POST',headers:{'Content-Type':'application/json','X-MasjidPoint-Session':session?.token||''},body:JSON.stringify(payload)}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'The job could not be saved.');jobs.unshift(result.job);localStorage.setItem('masjidPointJobs',JSON.stringify(jobs));closeJob();render();toast('Job saved and sent to the selected mosques.')}catch(error){toast(error.message);button.disabled=false;button.textContent='Send to selected masjids'}
    },true);
  });
})();
