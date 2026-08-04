const form = document.querySelector('#advertising-form');
const steps = [...document.querySelectorAll('.form-step')];
const progressItems = [...document.querySelectorAll('[data-progress]')];
const nextButton = document.querySelector('#next-button');
const previousButton = document.querySelector('#previous-button');
const actions = document.querySelector('#form-actions');
const description = form.elements.description;
const logoInput = document.querySelector('#logo-input');
const masjidSearch = document.querySelector('#masjid-search');
const clearMasjidSearch = document.querySelector('#clear-masjid-search');
const masjidOptions = [...document.querySelectorAll('.masjid-option')];
const masjidEmpty = document.querySelector('#masjid-empty');
let currentStep = 1;

function fieldsForStep(step) {
  return [...steps[step - 1].querySelectorAll('input, select, textarea')];
}

function validateStep(step) {
  const fields = fieldsForStep(step);
  let valid = true;
  fields.forEach(field => {
    const fieldValid = field.checkValidity();
    field.classList.toggle('invalid', !fieldValid);
    if (!fieldValid) valid = false;
  });
  if (step === 1) document.querySelector('#masjid-error').hidden = valid;
  if (!valid) fields.find(field => !field.checkValidity())?.focus();
  return valid;
}

function showStep(step) {
  currentStep = step;
  steps.forEach(item => item.classList.toggle('active', Number(item.dataset.step) === step));
  progressItems.forEach((item, index) => {
    item.classList.toggle('active', index + 1 === step);
    item.classList.toggle('complete', index + 1 < step);
    item.querySelector('b').textContent = index + 1 < step ? '✓' : String(index + 1);
  });
  previousButton.hidden = step === 1;
  nextButton.textContent = step === 4 ? 'Submit application →' : 'Continue →';
  document.querySelector('#mobile-step').textContent = `Step ${step} of 4`;
  document.querySelector('#progress-bar').style.width = `${step * 25}%`;
  if (step === 4) buildReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function buildReview() {
  const data = new FormData(form);
  document.querySelector('#review-content').innerHTML = `
    <div class="review-section"><header><strong>Selected masjid</strong><button type="button" data-edit="1">Edit</button></header><div class="review-grid"><div><small>Masjid</small><span>${escapeHtml(data.get('masjid'))}</span></div></div></div>
    <div class="review-section"><header><strong>Your details</strong><button type="button" data-edit="2">Edit</button></header><div class="review-grid"><div><small>Contact name</small><span>${escapeHtml(data.get('contactName'))}</span></div><div><small>Contact number</small><span>${escapeHtml(data.get('contactNumber'))}</span></div><div><small>Contact email</small><span>${escapeHtml(data.get('contactEmail'))}</span></div></div></div>
    <div class="review-section"><header><strong>Business details</strong><button type="button" data-edit="3">Edit</button></header><div class="review-grid"><div><small>Business name</small><span>${escapeHtml(data.get('businessName'))}</span></div><div><small>Category</small><span>${escapeHtml(data.get('category'))}</span></div><div><small>Business phone</small><span>${escapeHtml(data.get('businessNumber'))}</span></div><div><small>Business email</small><span>${escapeHtml(data.get('businessEmail'))}</span></div><div class="wide"><small>Description</small><span>${escapeHtml(data.get('description'))}</span></div></div></div>`;
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.edit))));
}

function submitApplication() {
  if (!validateStep(4)) return;
  const selection=form.querySelector('input[name="masjid"]:checked'),masjid = new FormData(form).get('masjid');
  const reference = `MP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const data = new FormData(form);
  localStorage.setItem('masjidPointLastApplication', JSON.stringify({ reference, masjid, name: data.get('businessName'), email: data.get('businessEmail'), contactEmail: data.get('contactEmail'), submittedAt: new Date().toISOString(), status: 'Submitted' }));
  const submittedAt=new Date().toISOString(),price=Number(selection?.dataset.price||0),adminPercent=Number(selection?.dataset.adminPercent||30),mosquePercent=Number(selection?.dataset.mosquePercent||70),pricingSnapshot={masjidReference:selection?.dataset.masjidReference||'',advertisingPrice:price,adminPercent,mosquePercent,adminAmount:Number((price*adminPercent/100).toFixed(2)),mosqueAmount:Number((price*mosquePercent/100).toFixed(2)),pricingUpdatedAt:selection?.dataset.pricingUpdatedAt||'',capturedAt:submittedAt},request={id:reference,reference,masjid,type:'business',name:data.get('businessName'),category:data.get('category'),contact:data.get('contactName'),email:data.get('businessEmail'),contactEmail:data.get('contactEmail'),phone:data.get('businessNumber'),description:data.get('description'),website:data.get('website'),status:'pending',listing:'disabled',paymentStatus:'not_due',price,pricingSnapshot,submittedAt};
  const requests=JSON.parse(localStorage.getItem('masjidPointBusinessRequests')||'[]');requests.unshift(request);localStorage.setItem('masjidPointBusinessRequests',JSON.stringify(requests));
  const applications=JSON.parse(localStorage.getItem('masjidPointAdminApplications')||'[]');applications.unshift({...request,details:{'Business name':request.name,'Category':request.category,'Selected masjid':masjid,'Agreed monthly price':`£${price.toFixed(2)}`,'Admin cut':`${adminPercent}%`,'Mosque share':`${mosquePercent}%`,'Contact name':request.contact,'Contact email':request.contactEmail,'Business email':request.email,'Business phone':request.phone,'Website':request.website||'Not provided','Description':request.description}});localStorage.setItem('masjidPointAdminApplications',JSON.stringify(applications));
  const notifications=JSON.parse(localStorage.getItem('masjidPointNotifications')||'[]');notifications.unshift({id:`NTF-${Date.now()}`,audience:`masjid:${masjid}`,title:'New business application',message:`${request.name} wants to advertise through your mosque.`,href:`masjid-portal?request=${encodeURIComponent(reference)}#requests`,key:`business-request-${reference}-${masjid}`,read:false,createdAt:submittedAt});localStorage.setItem('masjidPointNotifications',JSON.stringify(notifications));
  steps.forEach(step => step.classList.remove('active'));
  actions.remove();
  document.querySelector('.mobile-progress').hidden = true;
  document.querySelector('#success-masjid').textContent = masjid;
  document.querySelector('#reference-number').textContent = reference;
  document.querySelector('#check-status-link').href = `status?reference=${encodeURIComponent(reference)}&email=${encodeURIComponent(data.get('businessEmail'))}`;
  document.querySelector('#success-step').hidden = false;
  progressItems.forEach(item => item.classList.add('complete'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

nextButton.addEventListener('click', () => {
  if (!validateStep(currentStep)) return;
  if (currentStep < 4) showStep(currentStep + 1);
  else submitApplication();
});
previousButton.addEventListener('click', () => showStep(currentStep - 1));
form.addEventListener('input', event => event.target.classList.remove('invalid'));
description.addEventListener('input', () => document.querySelector('#character-count').textContent = description.value.length);
logoInput.addEventListener('change', () => {
  const file = logoInput.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    logoInput.value = '';
    document.querySelector('#upload-label').textContent = 'File is larger than 5 MB';
    return;
  }
  document.querySelector('#upload-label').textContent = file.name;
});

function filterMasjids() {
  const query = masjidSearch.value.trim().toLowerCase().replace(/\s+/g, ' ');
  let matches = 0;
  masjidOptions.forEach(option => {
    const searchableText = option.textContent.toLowerCase().replace(/\s+/g, ' ');
    const match = !query || searchableText.includes(query) || searchableText.replace(/\s/g, '').includes(query.replace(/\s/g, ''));
    option.hidden = !match;
    if (match) matches += 1;
  });
  masjidEmpty.hidden = matches !== 0;
  clearMasjidSearch.hidden = !query;
}

masjidSearch.addEventListener('input', filterMasjids);
clearMasjidSearch.addEventListener('click', () => {
  masjidSearch.value = '';
  filterMasjids();
  masjidSearch.focus();
});

// The website is required now, and `type="url"` rejects the form most people type it in —
// "www.yourbusiness.co.uk" without a scheme. Rather than block them on a technicality, the
// missing https:// is added for them before the field is validated.
(function normaliseWebsite() {
  const field = document.querySelector('[name="website"]');
  if (!field) return;

  // Only something already shaped like a domain gets the scheme added. Prefixing anything at all
  // would turn "not a website" into "https://not a website", which the browser accepts as valid —
  // the convenience would quietly defeat the validation it was meant to help.
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i;

  function fix() {
    const value = field.value.trim().replace(/^\/+/, '');
    if (!value) return;
    if (!/^https?:\/\//i.test(value) && looksLikeDomain.test(value)) field.value = `https://${value}`;
    else field.value = value;
    field.classList.toggle('invalid', !field.checkValidity());
  }

  field.addEventListener('blur', fix);
  // The step buttons validate on click, so the value is tidied before they look at it.
  document.addEventListener('click', event => {
    if (event.target.closest('button')) fix();
  }, true);
})();
