(function(){
  const accountNote=document.querySelector('.account-note');
  if(accountNote)accountNote.innerHTML='<span>✓</span><p><strong>One individual account for everything</strong><small>After submitting, sign in or create one account to track this application and all mosque-shop orders.</small></p>';
  const asDataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
  document.addEventListener('submit',async event=>{
    const form=event.target;if(form.id!=='candidate-form')return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!form.checkValidity()){form.reportValidity();return}
    const button=form.querySelector('[type="submit"]'),data=new FormData(form),file=data.get('cv');button.disabled=true;button.textContent='Submitting…';
    try{
      const response=await fetch('/api/public/job-application',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:data.get('jobId'),fullName:data.get('fullName'),email:data.get('email'),phone:data.get('phone'),experienceYears:data.get('experienceYears'),additionalInformation:data.get('additionalInformation'),fileName:file.name,file:await asDataUrl(file)})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Application could not be submitted.');
      localStorage.setItem('masjidPointCandidateProfile',JSON.stringify({fullName:data.get('fullName'),email:data.get('email'),phone:data.get('phone'),experienceYears:data.get('experienceYears'),cvName:file.name,savedAt:new Date().toISOString()}));
      form.hidden=true;document.querySelector('#success-job-title').textContent=result.jobTitle;document.querySelector('#candidate-reference').textContent=result.reference;
      const link=document.querySelector('#success-signup'),email=encodeURIComponent(data.get('email'));
      link.href=result.accountExists?`login?email=${email}&return=my-account`:`customer-signup?application=${encodeURIComponent(result.reference)}&email=${email}`;
      link.textContent=result.accountExists?'Sign in to view this application →':'Create my individual account →';
      document.querySelector('#candidate-success').hidden=false;
    }catch(failure){const toast=document.querySelector('#candidate-toast');toast.textContent=failure.message;toast.hidden=false;button.disabled=false;button.textContent='Submit application →'}
  },true);
})();
