const jobId=new URLSearchParams(location.search).get('job')||'JOB-2041',jobs=JSON.parse(localStorage.getItem('masjidPointJobs')||'[]');const job=jobs.find(item=>item.id===jobId)||{id:jobId,title:'Junior Accounts Assistant',city:'Birmingham',masjid:'Central Masjid'};document.querySelector('#candidate-job-title').textContent=job.title;document.querySelector('#candidate-job-meta').textContent=`${job.city} · ${job.masjid||job.masjids?.map(m=>m.name).join(', ')||'Community job'}`;document.querySelector('#candidate-form').elements.jobId.value=job.id;const profile=JSON.parse(localStorage.getItem('masjidPointCandidateProfile')||'null');if(profile){['fullName','email','phone','experienceYears'].forEach(name=>{if(profile[name])document.querySelector('#candidate-form').elements[name].value=profile[name]})}
const cv=document.querySelector('#candidate-cv');cv.onchange=()=>{const file=cv.files[0];if(!file)return;if(file.size>5*1024*1024){cv.value='';document.querySelector('#cv-name').textContent='File is larger than 5 MB';return}document.querySelector('#cv-name').textContent=file.name};document.querySelector('[name="additionalInformation"]').oninput=e=>document.querySelector('#additional-count').textContent=e.target.value.length;function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('MasjidPointFiles',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('candidateCVs'))request.result.createObjectStore('candidateCVs');if(!request.result.objectStoreNames.contains('paymentProofs'))request.result.createObjectStore('paymentProofs')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}async function saveCV(id,file){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('candidateCVs','readwrite');tx.objectStore('candidateCVs').put(file,id);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
document.querySelector('#candidate-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,required=[...form.querySelectorAll('[required]')];let valid=true;required.forEach(field=>{field.classList.toggle('invalid',!field.checkValidity());if(!field.checkValidity())valid=false});if(!valid){const first=required.find(field=>!field.checkValidity());first?.closest('label')?.scrollIntoView({behavior:'smooth',block:'center'});return}const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Submitting…';const data=new FormData(form),reference=`APP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;try{await saveCV(reference,cv.files[0]);const candidate={fullName:data.get('fullName'),email:data.get('email'),phone:data.get('phone'),experienceYears:data.get('experienceYears')};localStorage.setItem('masjidPointCandidateProfile',JSON.stringify(candidate));const applications=JSON.parse(localStorage.getItem('masjidPointJobApplications')||'[]');applications.push({reference,jobId:job.id,jobTitle:job.title,business:job.business||'Amanah Accounting',...candidate,additionalInformation:data.get('additionalInformation'),cvName:cv.files[0].name,status:'Submitted',submittedAt:new Date().toISOString()});localStorage.setItem('masjidPointJobApplications',JSON.stringify(applications));form.hidden=true;document.querySelector('#success-job-title').textContent=job.title;document.querySelector('#candidate-reference').textContent=reference;await rememberCandidate(candidate,reference,cv.files[0]);try{const asDataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(cv.files[0])});for(let attempt=0;attempt<8;attempt++){const response=await fetch('/api/job/cv',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference,fileName:cv.files[0].name,file:asDataUrl})});if(response.ok)break;if(response.status!==404)break;await new Promise(r=>setTimeout(r,500))}}catch(_){/* the application still stands; the CV can be asked for directly */}showAccountState(reference);document.querySelector('#candidate-success').hidden=false}catch{document.querySelector('#candidate-toast').textContent='Your application could not be saved. Please try again.';document.querySelector('#candidate-toast').hidden=false}finally{button.disabled=false;button.textContent='Submit application →'}};

database=function(){return new Promise((resolve,reject)=>{const request=indexedDB.open('MasjidPointCandidateFiles',1);request.onupgradeneeded=()=>request.result.createObjectStore('candidateCVs');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})};

// ---------------------------------------------------------------------------
// Applying should get quicker each time. What the candidate typed is kept on their account
// when they are signed in, and the CV they uploaded is remembered so a second application
// does not mean finding the file again.
// ---------------------------------------------------------------------------
const session = () => JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
const signedInCustomer = () => { const s = session(); return s?.role === 'customer' ? s : null; };

// Once an application is in, the "create an account" prompt is wrong for someone who already
// has one — they should be pointed at the account the application was just filed under.
function showAccountState(reference) {
  const signup = document.querySelector('#success-signup');
  const card = signup?.closest('div');
  if (!card) return;
  if (!signedInCustomer()) {
    signup.href = `customer-signup?application=${encodeURIComponent(reference)}`;
    return;
  }
  card.innerHTML = `<h3>Saved to your account</h3>
    <p>This application, your details and your CV are stored against your account. Your next application will be pre-filled.</p>
    <a class="button" href="my-account">See this application →</a>
    <p class="order-alt"><a href="public-jobs">Browse more jobs</a></p>`;
}

// The typed details follow the account; the CV file itself stays in this browser, since there is
// no upload endpoint for CVs yet.
async function rememberCandidate(candidate, reference, file) {
  try {
    localStorage.setItem('masjidPointCandidateProfile', JSON.stringify({ ...candidate, cvName: file?.name || '', savedAt: new Date().toISOString() }));
    if (file) await saveCV('latest', file);
  } catch {}

  const active = signedInCustomer();
  if (!active || typeof MasjidDB === 'undefined') return;
  try {
    const state = await MasjidDB.state();
    const customers = state.masjidPointCustomers || [];
    const record = customers.find(c => c.id === active.customerId
      || String(c.email || '').toLowerCase() === String(active.email || '').toLowerCase());
    if (!record) return;
    record.name ||= candidate.fullName;
    record.phone ||= candidate.phone;
    record.candidateProfile = {
      fullName: candidate.fullName, email: candidate.email, phone: candidate.phone,
      experienceYears: candidate.experienceYears, cvName: file?.name || record.candidateProfile?.cvName || '',
      updatedAt: new Date().toISOString()
    };
    await MasjidDB.save('masjidPointCustomers', customers);
  } catch {}
}

// Pre-fill from the account first, then from whatever this browser remembers.
(async function prefillCandidate() {
  const form = document.querySelector('#candidate-form');
  if (!form) return;
  // Snapshot before any awaiting: whatever is in the fields now came from the profile this
  // browser remembered, not from the person. That distinction is what makes it safe to correct.
  const initial = {};
  ['fullName', 'email', 'phone', 'experienceYears'].forEach(name => {
    const field = form.elements[name];
    if (field) initial[name] = field.value;
  });

  // The signed-in account is the authority. A remembered profile can be stale — a different email
  // from a previous application — so account values replace it, but never replace something the
  // person has typed since the page loaded.
  const apply = (values, fromAccount = false) => {
    for (const [name, value] of Object.entries(values || {})) {
      const field = form.elements[name];
      if (!field || !value) continue;
      const untouched = field.value === (initial[name] ?? '');
      if (!field.value || (fromAccount && untouched)) field.value = value;
    }
  };

  const active = signedInCustomer();
  if (active && typeof MasjidDB !== 'undefined') {
    try {
      const state = await MasjidDB.state();
      const record = (state.masjidPointCustomers || []).find(c => c.id === active.customerId
        || String(c.email || '').toLowerCase() === String(active.email || '').toLowerCase());
      if (record) apply({
        fullName: record.name || record.candidateProfile?.fullName,
        // Always the address the account is registered under, never one left over from before.
        email: record.email || active.email,
        phone: record.phone || record.candidateProfile?.phone,
        experienceYears: record.candidateProfile?.experienceYears
      }, true);
      else apply({ fullName: active.name, email: active.email }, true);
    } catch {}
  }

  // A CV already on file means the upload is optional — they can reuse it or attach a new one.
  const saved = JSON.parse(localStorage.getItem('masjidPointCandidateProfile') || 'null');
  const cvInput = document.querySelector('#candidate-cv');
  if (!saved?.cvName || !cvInput) return;
  let stored = null;
  try {
    const db = await database();
    stored = await new Promise(resolve => {
      const request = db.transaction('candidateCVs', 'readonly').objectStore('candidateCVs').get('latest');
      request.onsuccess = () => { db.close(); resolve(request.result || null); };
      request.onerror = () => { db.close(); resolve(null); };
    });
  } catch {}
  if (!stored) return;

  cvInput.required = false;
  const label = document.querySelector('#cv-name');
  if (label) label.textContent = `Using your saved CV: ${saved.cvName}`;
  const previous = document.querySelector('#candidate-form').onsubmit;
  // Feed the remembered file in if they do not choose a new one.
  const transfer = new DataTransfer();
  transfer.items.add(new File([stored], saved.cvName, { type: stored.type || 'application/pdf' }));
  cvInput.files = transfer.files;
  void previous;
})();
