(function(){
  const viewer=document.createElement('div');viewer.className='business-image-viewer';viewer.hidden=true;
  viewer.innerHTML='<div class="business-image-dialog" role="dialog" aria-modal="true" aria-labelledby="business-image-title"><header><h2 id="business-image-title"></h2><button type="button" aria-label="Close image preview">×</button></header><div><img alt=""></div></div>';document.body.appendChild(viewer);
  const image=viewer.querySelector('img'),title=viewer.querySelector('h2'),close=()=>{viewer.hidden=true;image.removeAttribute('src');document.body.classList.remove('image-viewer-open')};
  document.addEventListener('click',event=>{const trigger=event.target.closest('[data-business-image]');if(!trigger)return;event.preventDefault();event.stopPropagation();title.textContent=trigger.dataset.businessImageTitle||'Business image';image.src=trigger.dataset.businessImage;image.alt=title.textContent;viewer.hidden=false;document.body.classList.add('image-viewer-open');viewer.querySelector('button').focus()});
  viewer.querySelector('button').onclick=close;viewer.onclick=event=>{if(event.target===viewer)close()};document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!viewer.hidden)close()});
})();
