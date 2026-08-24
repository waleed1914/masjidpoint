// The same rule the server enforces. Checking only the length here meant a password with no
// lowercase letter passed, went to the server, and came back refused — the round trip was the
// only way to find out what was actually required.
function strongPassword(value){return typeof value==='string'&&value.length>=12&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value)&&/[^A-Za-z0-9]/.test(value)}
// Where a masjid manages how it appears. Until now a photo could only be attached during
// registration, so every masjid already on the platform had no way to add one.
(async function () {
  const session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null');
  if (!session?.reference) return;

  const state = await MasjidDB.state();
  const applications = state.masjidPointAdminApplications || [];
  const masjid = applications.find(app => app.type === 'masjid'
    && (app.reference === session.reference || app.id === session.reference));
  if (!masjid) return;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const details = masjid.details || {};
  window.MasjidIdentity?.apply(masjid);
  document.querySelector('#view-public').href = `masjid-adverts?reference=${encodeURIComponent(masjid.reference)}`;

  const toast = message => {
    const element = document.querySelector('#portal-toast');
    element.textContent = message;
    element.hidden = false;
    setTimeout(() => element.hidden = true, 2600);
  };

  // Saving writes the whole applications collection back, so it is always re-read first to avoid
  // overwriting a change an administrator made in the meantime.
  async function persist(mutate) {
    const latest = await MasjidDB.state();
    const list = latest.masjidPointAdminApplications || [];
    const record = list.find(app => app.reference === masjid.reference || app.id === masjid.reference);
    if (!record) throw Error('This masjid record no longer exists.');
    mutate(record);
    const response = await fetch('/api/account/profile', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({details: record.details, photo: record.photo || ''})
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Your profile could not be saved.');
  }

  // ---- photo ----
  const MAX_BYTES = 3 * 1024 * 1024;
  const input = document.querySelector('#masjid-photo');
  const image = document.querySelector('#photo-current');
  const empty = document.querySelector('#photo-empty');
  const removeButton = document.querySelector('#remove-photo');
  const error = document.querySelector('#photo-error');
  const hint = document.querySelector('#photo-hint');

  function showPhoto(dataUrl) {
    if (dataUrl) {
      image.src = dataUrl;
      image.hidden = false;
      empty.hidden = true;
      removeButton.hidden = false;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      empty.hidden = false;
      removeButton.hidden = true;
    }
    // Reflect changes in the sidebar immediately instead of reverting to initials.
    window.MasjidIdentity?.apply({ ...masjid, photo: dataUrl || '' });
  }
  showPhoto(masjid.photo);

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    error.hidden = true;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      error.textContent = 'Choose a PNG, JPG or WebP image.';
      error.hidden = false;
      input.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      error.textContent = 'That photo is larger than 3 MB. Choose a smaller image.';
      error.hidden = false;
      input.value = '';
      return;
    }
    hint.textContent = 'Resizing and saving…';
    try {
      const photo = await ImageDownscale.fromFile(file);
      // An unreadable or empty file produces nothing. Saving that would replace a good photo with
      // a blank one and still report success.
      if (!photo || !photo.startsWith('data:image/')) throw Error('That image could not be read.');
      await persist(record => { record.photo = photo; });
      masjid.photo = photo;
      showPhoto(photo);
      hint.textContent = `Saved. ${Math.round(photo.length / 1024)} KB stored — visitors see this on the directory.`;
      toast('Photo updated.');
    } catch (failure) {
      error.textContent = `${failure.message} Your photo was not saved.`;
      error.hidden = false;
      hint.textContent = 'Your photo is resized automatically before it is saved.';
    } finally {
      input.value = '';
    }
  });

  removeButton.addEventListener('click', async () => {
    try {
      await persist(record => { delete record.photo; });
      delete masjid.photo;
      showPhoto('');
      hint.textContent = 'Photo removed. The directory shows the illustration again.';
      toast('Photo removed.');
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    }
  });

  // ---- contact details ----
  const form = document.querySelector('#contact-form');
  const FIELDS = {
    masjidPhone: 'Masjid phone',
    primaryContact: 'Primary contact',
    contactNumber: 'Contact number',
    role: 'Role'
  };
  for (const [field, key] of Object.entries(FIELDS)) form.elements[field].value = details[key] || '';

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const problem = document.querySelector('#contact-error');
    const saved = document.querySelector('#contact-saved');
    problem.hidden = true;
    saved.hidden = true;

    // Checked here rather than left to the pattern attribute: the browser reports these values as
    // valid against it, so a three-digit phone number would otherwise be saved without complaint.
    const phones = ['masjidPhone', 'contactNumber'];
    const invalid = phones.map(name => form.elements[name])
      .find(field => field.value.trim() && field.value.replace(/\D/g, '').length < 10);
    if (invalid) {
      problem.textContent = 'Enter a full phone number — at least 10 digits.';
      problem.hidden = false;
      invalid.classList.add('invalid');
      invalid.focus();
      return;
    }
    phones.forEach(name => form.elements[name].classList.remove('invalid'));

    try {
      await persist(record => {
        record.details = record.details || {};
        for (const [field, key] of Object.entries(FIELDS)) {
          const value = form.elements[field].value.trim();
          if (value) record.details[key] = value; else delete record.details[key];
        }
      });
      saved.hidden = false;
      setTimeout(() => saved.hidden = true, 2600);
      toast('Contact details saved.');
    } catch (failure) {
      problem.textContent = failure.message;
      problem.hidden = false;
    }
  });

  // ---- password ----
  // A masjid could set a password at activation and never change it again, short of the
  // forgotten-password email. Verified against the stored hash before anything is written.
  const hash = async value => masjidSha256(value);
  const passwordForm = document.querySelector('#password-form');
  if (passwordForm) passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const problem = document.querySelector('#password-error');
    const done = document.querySelector('#password-saved');
    problem.hidden = true; done.hidden = true;
    const fail = message => { problem.textContent = message; problem.hidden = false; };

    const current = passwordForm.elements.current.value;
    const next = passwordForm.elements.next.value;
    const confirm = passwordForm.elements.confirm.value;
    if (!current || !next) return fail('Fill in your current and new password.');
    if (!strongPassword(next)) return fail('Use at least 12 characters with uppercase, lowercase, a number and a symbol.');
    if (next !== confirm) return fail('The new passwords do not match.');
    if (next === current) return fail('Your new password is the same as your current one.');

    const fresh = await MasjidDB.state();
    const accounts = fresh.masjidPointActivatedAccounts || [];
    const account = accounts.find(a => a.reference === masjid.reference);
    if (!account) return fail('This masjid has not completed activation yet, so there is no password to change.');
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
      done.hidden = false;
      setTimeout(() => done.hidden = true, 3200);
      toast('Password changed.');
    } catch {
      fail('Your password could not be saved. Try again.');
    }
  });

  // ---- registered details (read-only) ----
  document.querySelector('#registered-details').innerHTML = [
    ['Masjid name', masjid.name],
    ['Reference', masjid.reference],
    ['Address', details.Address],
    ['Postcode', details.Postcode],
    ['Account email', masjid.email],
    ['Status', masjid.status === 'activated' ? 'Activated' : 'Approved']
  ].filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
})();
