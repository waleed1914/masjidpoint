const form = document.querySelector('#masjid-registration-form');
const steps = [...document.querySelectorAll('.form-step')];
const progressItems = [...document.querySelectorAll('[data-progress]')];
const nextButton = document.querySelector('#next-button');
const previousButton = document.querySelector('#previous-button');
const actions = document.querySelector('#form-actions');
let currentStep = 1;

function validateStep(step) {
  const fields = [...steps[step - 1].querySelectorAll('input, select, textarea')];
  let valid = true;
  fields.forEach(field => {
    const fieldValid = field.checkValidity();
    field.classList.toggle('invalid', !fieldValid);
    if (!fieldValid) valid = false;
  });
  fields.find(field => !field.checkValidity())?.focus();
  return valid;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

// The optional masjid photo. It is stored on the application as a data URL, the same way product
// images are, so it is downscaled first — a phone photo would otherwise put several megabytes of
// base64 into the record on every save.
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1200;
const photoInput = document.querySelector('#masjid-photo');
const photoPreview = document.querySelector('#photo-preview');
let masjidPhoto = null;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('unreadable'));
    reader.readAsDataURL(file);
  });
}

// Longest edge capped at PHOTO_MAX_EDGE, keeping the aspect ratio. Photographs are re-encoded as
// JPEG whatever they arrived as — re-encoding a photo to PNG routinely comes out larger than the
// original file, which defeats the point. The original is kept if it is still the smaller of the
// two, and if the browser cannot decode the image at all.
function downscale(dataUrl) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      // JPEG has no alpha channel, so anything transparent would otherwise turn black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const encoded = canvas.toDataURL('image/jpeg', 0.82);
      resolve(encoded.length < dataUrl.length ? encoded : dataUrl);
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function clearPhoto() {
  masjidPhoto = null;
  photoInput.value = '';
  photoInput.setCustomValidity('');
  photoPreview.hidden = true;
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) return clearPhoto();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    photoInput.setCustomValidity('Choose a PNG, JPG or WebP image.');
    photoInput.classList.add('invalid');
    photoPreview.hidden = true;
    masjidPhoto = null;
    return;
  }
  if (file.size > PHOTO_MAX_BYTES) {
    photoInput.setCustomValidity('That photo is larger than 3 MB. Choose a smaller image.');
    photoInput.classList.add('invalid');
    photoPreview.hidden = true;
    masjidPhoto = null;
    return;
  }
  photoInput.setCustomValidity('');
  photoInput.classList.remove('invalid');
  try {
    masjidPhoto = await downscale(await readImage(file));
    document.querySelector('#photo-preview-image').src = masjidPhoto;
    document.querySelector('#photo-preview-name').textContent = file.name;
    photoPreview.hidden = false;
  } catch {
    photoInput.setCustomValidity('That image could not be read. Try another file.');
    masjidPhoto = null;
  }
});

document.querySelector('#remove-photo').addEventListener('click', clearPhoto);

function showStep(step) {
  currentStep = step;
  steps.forEach(item => item.classList.toggle('active', Number(item.dataset.step) === step));
  progressItems.forEach((item, index) => {
    item.classList.toggle('active', index + 1 === step);
    item.classList.toggle('complete', index + 1 < step);
    item.querySelector('b').textContent = index + 1 < step ? '✓' : String(index + 1);
  });
  previousButton.hidden = step === 1;
  nextButton.textContent = step === 3 ? 'Submit registration →' : 'Continue →';
  document.querySelector('#mobile-step').textContent = `Step ${step} of 3`;
  document.querySelector('#progress-bar').style.width = `${step * 33.333}%`;
  if (step === 3) buildReview();
  window.scrollTo({top:0,behavior:'smooth'});
}

function buildReview() {
  const data = new FormData(form);
  const address = [data.get('address1'),data.get('address2'),data.get('city'),data.get('postcode')].filter(Boolean).join(', ');
  document.querySelector('#review-content').innerHTML = `
    <div class="review-section"><header><strong>Masjid details</strong><button type="button" data-edit="1">Edit</button></header><div class="review-grid"><div><small>Masjid name</small><span>${escapeHtml(data.get('masjidName'))}</span></div><div><small>Phone</small><span>${escapeHtml(data.get('masjidPhone'))}</span></div><div class="wide"><small>Address</small><span>${escapeHtml(address)}</span></div><div class="wide"><small>Photo</small>${masjidPhoto ? `<img class="review-photo" src="${masjidPhoto}" alt="The masjid photo you selected">` : '<span>Not provided</span>'}</div></div></div>
    <div class="review-section"><header><strong>Primary contact</strong><button type="button" data-edit="2">Edit</button></header><div class="review-grid"><div><small>Full name</small><span>${escapeHtml(data.get('contactName'))}</span></div><div><small>Role</small><span>${escapeHtml(data.get('role'))}</span></div><div><small>Contact number</small><span>${escapeHtml(data.get('contactPhone'))}</span></div><div><small>Email address</small><span>${escapeHtml(data.get('email'))}</span></div></div></div>`;
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.edit))));
}

function submitRegistration() {
  if (!validateStep(3)) return;
  const data = new FormData(form);
  const reference = `MSJ-${new Date().getFullYear()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  const submittedAt=new Date().toISOString(),registration={reference,name:data.get('masjidName'),email:data.get('email'),postcode:data.get('postcode'),status:'Pending admin approval',submittedAt};
  localStorage.setItem('masjidPointLastMasjidRegistration', JSON.stringify(registration));
  const applications=JSON.parse(localStorage.getItem('masjidPointAdminApplications')||'[]');
  applications.unshift({id:reference,type:'masjid',name:data.get('masjidName'),email:data.get('email'),reference,status:'pending',submittedAt,...(masjidPhoto?{photo:masjidPhoto}:{}),details:{'Masjid name':data.get('masjidName'),'Address':[data.get('address1'),data.get('address2'),data.get('city'),data.get('postcode')].filter(Boolean).join(', '),'Postcode':data.get('postcode'),'Masjid phone':data.get('masjidPhone'),'Primary contact':data.get('contactName'),'Role':data.get('role'),'Contact number':data.get('contactPhone'),'Email':data.get('email')}});
  localStorage.setItem('masjidPointAdminApplications',JSON.stringify(applications));
  const notifications=JSON.parse(localStorage.getItem('masjidPointNotifications')||'[]');
  notifications.unshift({id:`NTF-${Date.now()}`,audience:'admin',title:'New masjid registration',message:`${data.get('masjidName')} submitted an application (${reference}).`,href:`admin?application=${encodeURIComponent(reference)}#applications`,key:`masjid-application-${reference}`,read:false,createdAt:submittedAt});
  localStorage.setItem('masjidPointNotifications',JSON.stringify(notifications));
  steps.forEach(step => step.classList.remove('active'));
  actions.remove();
  document.querySelector('.mobile-progress').hidden = true;
  document.querySelector('#success-name').textContent = data.get('masjidName');
  document.querySelector('#reference-number').textContent = reference;
  document.querySelector('#check-status-link').href = `status?reference=${encodeURIComponent(reference)}&email=${encodeURIComponent(data.get('email'))}`;
  document.querySelector('#success-step').hidden = false;
  progressItems.forEach(item => item.classList.add('complete'));
  window.scrollTo({top:0,behavior:'smooth'});
}

nextButton.addEventListener('click', () => { if (!validateStep(currentStep)) return; currentStep < 3 ? showStep(currentStep + 1) : submitRegistration(); });
previousButton.addEventListener('click', () => showStep(currentStep - 1));
form.addEventListener('input', event => event.target.classList.remove('invalid'));

const postcodeInput = form.elements.postcode;
postcodeInput.addEventListener('input', () => {
  postcodeInput.value = postcodeInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
});
postcodeInput.addEventListener('blur', () => {
  const compact = postcodeInput.value.replace(/\s/g, '');
  if (compact.length > 3) postcodeInput.value = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
});
