document.querySelector('#forgot-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),message=document.querySelector('#forgot-message'),original='Send reset link →';
  button.disabled=true;message.classList.remove('success');
  try{
    const response=await fetch('/api/auth/password-reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value})}),result=await response.json();
    if(!response.ok)throw new Error(result.error||'The reset email could not be sent.');
    message.textContent=result.message||'If an activated account matches that email, a reset link has been sent.';message.classList.add('success');message.hidden=false;
    let remaining=30;form.elements.email.disabled=true;button.textContent=`Send again in ${remaining}s`;
    const timer=setInterval(()=>{remaining-=1;if(remaining>0){button.textContent=`Send again in ${remaining}s`;return}clearInterval(timer);button.disabled=false;button.textContent=original;form.elements.email.disabled=false},1000);
  }catch(error){message.textContent=error.message||'The request could not be completed. Please try again.';message.hidden=false;form.elements.email.disabled=false;button.disabled=false;button.textContent=original}
};
