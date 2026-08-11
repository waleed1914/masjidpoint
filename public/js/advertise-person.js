(function(){
  const input=document.querySelector('#contact-photo-input'),label=document.querySelector('#contact-photo-label'),preview=document.querySelector('#contact-photo-preview');
  if(!input)return;
  input.addEventListener('change',()=>{
    const file=input.files?.[0];
    if(!file){label.textContent='Choose a clear photo of yourself';preview.textContent='+';preview.style.backgroundImage='';return}
    if(file.size>3*1024*1024){input.value='';label.textContent='Choose a file smaller than 3 MB';preview.textContent='!';return}
    label.textContent=`Selected: ${file.name}`;preview.textContent='';preview.style.backgroundImage=`url("${URL.createObjectURL(file)}")`;
  });
})();
