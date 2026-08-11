// Business account settings. Until now the sidebar's "Account settings" went nowhere, and there
// was no way for a business to change its password after activation — the only route was the
// forgotten-password email.
(async function () {
  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (session?.role !== 'business' || !session.reference) return;

  const state = await MasjidDB.state();
  const application = (state.masjidPointAdminApplications || []).find(a => a.reference === session.reference);
  if (!application) return;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hash = async value => masjidSha256(value);

  const details = application.details || {};
  const name = application.name;
  const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  document.querySelector('.business-identity>span').textContent = initials;
  document.querySelector('.business-identity strong').textContent = name;
  document.querySelector('.business-identity small').textContent = `Ref: ${application.businessCode || application.reference}`;
  document.querySelector('.business-menu').onclick = () => document.querySelector('.business-sidebar').classList.toggle('open');

  const toast = message => {
    const element = document.querySelector('#account-toast');
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => element.hidden = true, 2600);
  };

  // Always re-read before writing: these collections are shared with the administrator.
  async function persistApplication(mutate) {
    const latest = await MasjidDB.state();
    const list = latest.masjidPointAdminApplications || [];
    const record = list.find(a => a.reference === application.reference);
    if (!record) throw Error('This account no longer exists.');
    mutate(record);
    const response = await fetch('/api/account/profile', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({name: record.name, email: record.email, details: record.details})
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Your profile could not be saved.');
  }

  const listing = (state.masjidPointBusinessRequests || []).find(r => r.reference === application.reference);
  document.querySelector('#account-summary').innerHTML = [
    ['Business name', name],
    ['Payment reference', application.businessCode || '—'],
    ['Application reference', application.reference],
    ['Sign-in email', application.email],
    ['Advertising through', listing?.masjid || 'Not advertising yet'],
    ['Listing status', listing ? `${listing.status} · ${listing.paymentStatus} · ${listing.listing}` : '—'],
    ['Account status', application.accountStatus === 'active' ? 'Active' : (application.accountStatus || 'Pending')]
  ].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');

  const publicLink = document.querySelector('#public-listing');
  if (publicLink && listing?.masjid) publicLink.href = `businesses?masjid=${encodeURIComponent(listing.masjid)}`;

  // ---- owner photo and business logo ----
  const imagesForm=document.querySelector('#images-form'),ownerInput=imagesForm.elements.ownerPhoto,logoInput=imagesForm.elements.logo,consent=imagesForm.elements.publicPhotoConsent,ownerPreview=document.querySelector('#owner-photo-preview'),logoPreview=document.querySelector('#business-logo-preview');
  let hasOwner=Boolean(listing?.contactPhoto||application.contactPhoto),hasLogo=Boolean(listing?.logo||application.logo),removeOwner=false,removeLogo=false,ownerObjectUrl='',logoObjectUrl='';
  const imageUrl=(kind)=>kind==='owner'?`/api/business-contact-photo?reference=${encodeURIComponent(application.reference)}&v=${Date.now()}`:`/api/business-logo?reference=${encodeURIComponent(application.reference)}&v=${Date.now()}`;
  const showPreview=(element,src,alt)=>{element.innerHTML=src?`<img src="${src}" alt="${esc(alt)}">`:`<span>${alt}</span>`};
  if(hasOwner)showPreview(ownerPreview,imageUrl('owner'),'Owner photo');if(hasLogo)showPreview(logoPreview,imageUrl('logo'),'Business logo');consent.checked=Boolean(listing?.publicPhotoConsent||application.publicPhotoConsent);
  const updateRemoveButtons=()=>{imagesForm.querySelector('[data-remove-image="owner"]').hidden=!hasOwner;imagesForm.querySelector('[data-remove-image="logo"]').hidden=!hasLogo};updateRemoveButtons();
  function choose(input,kind){const file=input.files[0];if(!file)return;const limit=kind==='owner'?3:5;if(file.size>limit*1024*1024){input.value='';document.querySelector('#images-error').textContent=`The ${kind==='owner'?'owner photo':'business logo'} must be no larger than ${limit} MB.`;document.querySelector('#images-error').hidden=false;return}if(kind==='owner'){if(ownerObjectUrl)URL.revokeObjectURL(ownerObjectUrl);ownerObjectUrl=URL.createObjectURL(file);hasOwner=true;removeOwner=false;showPreview(ownerPreview,ownerObjectUrl,'Owner photo')}else{if(logoObjectUrl)URL.revokeObjectURL(logoObjectUrl);logoObjectUrl=URL.createObjectURL(file);hasLogo=true;removeLogo=false;showPreview(logoPreview,logoObjectUrl,'Business logo')}updateRemoveButtons()}
  ownerInput.onchange=()=>choose(ownerInput,'owner');logoInput.onchange=()=>choose(logoInput,'logo');
  imagesForm.querySelectorAll('[data-remove-image]').forEach(button=>button.onclick=()=>{if(button.dataset.removeImage==='owner'){ownerInput.value='';hasOwner=false;removeOwner=true;consent.checked=false;showPreview(ownerPreview,'','Owner')}else{logoInput.value='';hasLogo=false;removeLogo=true;showPreview(logoPreview,'','Logo')}updateRemoveButtons()});
  const asDataUrl=file=>file?new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)}):Promise.resolve('');
  imagesForm.onsubmit=async event=>{event.preventDefault();const error=document.querySelector('#images-error'),saved=document.querySelector('#images-saved'),button=imagesForm.querySelector('[type="submit"]');error.hidden=true;saved.hidden=true;if(consent.checked&&!hasOwner){error.textContent='Upload an owner photo before choosing to show it publicly.';error.hidden=false;return}button.disabled=true;button.textContent='Saving images…';try{const ownerFile=ownerInput.files[0],logoFile=logoInput.files[0],response=await fetch('/api/account/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerPhoto:await asDataUrl(ownerFile),ownerPhotoName:ownerFile?.name||'',logo:await asDataUrl(logoFile),logoName:logoFile?.name||'',publicPhotoConsent:consent.checked,removeOwnerPhoto:removeOwner,removeLogo})}),result=await response.json();if(!response.ok)throw Error(result.error||'Your business images could not be saved.');saved.hidden=false;toast('Business images saved.');setTimeout(()=>location.reload(),700)}catch(failure){error.textContent=failure.message;error.hidden=false;button.disabled=false;button.textContent='Save business images'}};

  // ---- contact details ----
  const contactForm = document.querySelector('#contact-form');
  const CONTACT = { contactName: 'Contact name', contactNumber: 'Contact number', contactEmail: 'Contact email' };
  contactForm.elements.contactName.value = details['Contact name'] || details.Contact || '';
  contactForm.elements.contactNumber.value = details['Contact number'] || '';
  contactForm.elements.contactEmail.value = details['Contact email'] || application.email || '';

  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.querySelector('#contact-error');
    const saved = document.querySelector('#contact-saved');
    error.hidden = true; saved.hidden = true;

    const phone = contactForm.elements.contactNumber.value.trim();
    if (phone && phone.replace(/\D/g, '').length < 10) {
      error.textContent = 'Enter a full contact number — at least 10 digits.';
      error.hidden = false;
      contactForm.elements.contactNumber.focus();
      return;
    }
    const email = contactForm.elements.contactEmail.value.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      error.textContent = 'Enter a valid contact email address.';
      error.hidden = false;
      contactForm.elements.contactEmail.focus();
      return;
    }

    try {
      await persistApplication(record => {
        record.details = record.details || {};
        for (const [field, key] of Object.entries(CONTACT)) {
          const value = contactForm.elements[field].value.trim();
          if (value) record.details[key] = value; else delete record.details[key];
        }
      });
      saved.hidden = false;
      setTimeout(() => saved.hidden = true, 2600);
      toast('Contact details saved.');
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    }
  });

  // ---- password ----
  const passwordForm = document.querySelector('#password-form');
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.querySelector('#password-error');
    const saved = document.querySelector('#password-saved');
    error.hidden = true; saved.hidden = true;

    const current = passwordForm.elements.current.value;
    const next = passwordForm.elements.next.value;
    const confirm = passwordForm.elements.confirm.value;

    const fail = message => { error.textContent = message; error.hidden = false; };
    if (!current || !next) return fail('Fill in your current and new password.');
    if (next.length < 12) return fail('Your new password needs at least 12 characters.');
    if (next !== confirm) return fail('The new passwords do not match.');
    if (next === current) return fail('Your new password is the same as your current one.');

    const fresh = await MasjidDB.state();
    const accounts = fresh.masjidPointActivatedAccounts || [];
    const account = accounts.find(a => a.reference === application.reference);
    if (!account) return fail('This account has not completed activation yet, so there is no password to change.');
    // Checked and written by the server. This used to read the stored hash out of the state
    // it had just fetched, which only worked because every hash on the platform was public.
    const change = await fetch('/api/account/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, currentPassword: current, nextPassword: next })
    }).catch(() => null);
    if (!change || !change.ok) {
      const said = change ? await change.json().catch(() => ({})) : {};
      return fail(said.error || 'That password could not be changed. Try again.');
    }
    try {
      await MasjidDB.refresh();
      passwordForm.reset();
      saved.hidden = false;
      setTimeout(() => saved.hidden = true, 3200);
      toast('Password changed.');
    } catch {
      fail('Your password could not be saved. Try again.');
    }
  });
})();
