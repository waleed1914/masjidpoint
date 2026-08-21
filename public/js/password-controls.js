(function(){
  const rules=[['length','At least 12 characters',v=>v.length>=12],['upper','One uppercase letter',v=>/[A-Z]/.test(v)],['lower','One lowercase letter',v=>/[a-z]/.test(v)],['number','One number',v=>/\d/.test(v)],['symbol','One symbol',v=>/[^A-Za-z0-9]/.test(v)]];
  const eyeIcon=visible=>visible
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 5.1 9 5.1a13.7 13.7 0 0 1-2.3 2.8M6.2 6.2C4.2 7.5 3 9.1 3 9.1S6.5 14.2 12 14.2c1 0 2-.2 2.8-.5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-5.2 9-5.2 9 5.2 9 5.2-3.5 5.2-9 5.2S3 12 3 12Z"/><circle cx="12" cy="12" r="2.4"/></svg>';
  function addEye(input){
    if(input.parentElement?.classList.contains('password-field-wrap'))return;
    const wrap=document.createElement('span');wrap.className='password-field-wrap';input.before(wrap);wrap.appendChild(input);
    const button=document.createElement('button');button.type='button';button.className='password-visibility';button.setAttribute('aria-label','Show password');button.setAttribute('aria-pressed','false');button.innerHTML=eyeIcon(false);
    button.onclick=()=>{const visible=input.type==='text';input.type=visible?'password':'text';button.setAttribute('aria-label',visible?'Show password':'Hide password');button.setAttribute('aria-pressed',String(!visible));button.innerHTML=eyeIcon(!visible)};
    wrap.appendChild(button);
  }
  const inputs=[...document.querySelectorAll('input[type="password"]')];inputs.forEach(addEye);
  const primary=inputs.find(input=>input.autocomplete==='new-password'&&!/confirm/i.test(input.name||''))||inputs.find(input=>/password/i.test(input.name||'')&&!/confirm/i.test(input.name||'')&&input.minLength>=12);if(!primary)return;
  const list=document.createElement('ul');list.className='password-checklist';list.setAttribute('aria-live','polite');list.innerHTML=rules.map(([key,label])=>`<li data-rule="${key}">${label}</li>`).join('');primary.closest('label')?.before(list);
  const update=()=>rules.forEach(([key,,test])=>list.querySelector(`[data-rule="${key}"]`).classList.toggle('met',test(primary.value)));primary.addEventListener('input',update);update();
})();
