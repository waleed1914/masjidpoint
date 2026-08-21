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
      const result=await response.json();if(response.status===409&&result.code==='ALREADY_APPLIED'){
        form.hidden=true;
        const success=document.querySelector('#candidate-success'),email=encodeURIComponent(data.get('email'));
        success.querySelector('.step-kicker').textContent='Application already received';
        success.querySelector('h2').textContent='You have already applied';
        success.querySelector('h2+ p').innerHTML=`An application using <strong>${String(data.get('email')).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</strong> has already been submitted for <strong>${String(result.jobTitle||'this job').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</strong>.`;
        success.querySelector('.candidate-reference').hidden=true;
        success.querySelector('.success-next h3').textContent='Check your existing application';
        success.querySelector('.success-next>p').textContent=result.accountExists?'Sign in to your individual account to view its current status.':'Use your existing application to finish setting up your individual account.';
        const link=document.querySelector('#success-signup');link.href=result.accountExists?`login?email=${email}&return=my-account#applications`:`customer-signup?application=${encodeURIComponent(result.reference)}&email=${email}`;link.textContent=result.accountExists?'Sign in to check my application →':'Finish creating my account →';
        document.querySelector('#success-signin').closest('.success-alt').hidden=true;success.hidden=false;return;
      }if(!response.ok)throw Error(result.error||'Application could not be submitted.');
      localStorage.setItem('masjidPointCandidateProfile',JSON.stringify({fullName:data.get('fullName'),email:data.get('email'),phone:data.get('phone'),experienceYears:data.get('experienceYears'),cvName:file.name,savedAt:new Date().toISOString()}));
      form.hidden=true;document.querySelector('#success-job-title').textContent=result.jobTitle;document.querySelector('#candidate-reference').textContent=result.reference;
      const link=document.querySelector('#success-signup'),email=encodeURIComponent(data.get('email'));
      link.href=result.accountExists?`login?email=${email}&return=my-account`:`customer-signup?application=${encodeURIComponent(result.reference)}&email=${email}`;
      link.textContent=result.accountExists?'Sign in to view this application →':'Create my individual account →';
      document.querySelector('#candidate-success').hidden=false;
    }catch(failure){const toast=document.querySelector('#candidate-toast');toast.textContent=failure.message;toast.hidden=false;button.disabled=false;button.textContent='Submit application →'}
  },true);
})();
