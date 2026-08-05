// Lets a signed-in administrator rotate their own password. Creating and suspending profiles is
// restricted to the Platform Owner, but changing your own credentials should not be — and before
// this there was no route to do it at all once a password had been set.
(function () {
  const form = document.querySelector('#own-password-form');
  if (!form) return;

  const session = JSON.parse(sessionStorage.getItem('masjidPointAdminSession') || 'null');
  if (!session?.email) { form.closest('section')?.remove(); return; }

  const error = document.querySelector('#own-password-error');
  const saved = document.querySelector('#own-password-saved');
  const hash = async value => masjidSha256(value);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true; saved.hidden = true;
    const fail = message => { error.textContent = message; error.hidden = false; };

    const current = form.elements.current.value;
    const next = form.elements.next.value;
    const confirm = form.elements.confirm.value;
    if (!current || !next) return fail('Fill in your current and new password.');
    if (next.length < 8) return fail('Your new password needs at least 8 characters.');
    if (next !== confirm) return fail('The new passwords do not match.');
    if (next === current) return fail('Your new password is the same as your current one.');

    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const response = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Name': session.name || session.email },
        body: JSON.stringify({ email: session.email, currentHash: await hash(current), nextHash: await hash(next) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return fail(result.error || 'Your password could not be changed.');
      form.reset();
      saved.hidden = false;
      setTimeout(() => saved.hidden = true, 3200);
    } catch {
      fail('Your password could not be changed. Check your connection and try again.');
    } finally {
      button.disabled = false;
    }
  });
})();
