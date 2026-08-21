(function(){
  'use strict';
  const overlaySelector=['.invoice-modal','.proof-modal','.confirm-modal','.job-review-modal','.donation-modal','.cart-drawer','.customer-drawer','.product-modal','.proof-review','.account-modal','.business-image-viewer','.public-image-viewer'].join(',');
  const backdropSelector='.portal-backdrop,.business-backdrop,.public-job-backdrop';
  const closeSelector='[aria-label="Close"],[id^="close-"],[id^="cancel-"],.modal-close,.drawer-close,.close-modal';
  const visible=node=>node&&!node.hidden&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden';
  function close(node){if(!node)return;const button=node.querySelector(closeSelector);if(button){button.click();return}node.hidden=true;node.classList.remove('open');node.setAttribute('aria-hidden','true');document.body.classList.remove('modal-open','image-viewer-open')}
  document.addEventListener('click',event=>{const overlay=event.target.closest(overlaySelector);if(overlay&&event.target===overlay){close(overlay);return}const backdrop=event.target.closest(backdropSelector);if(backdrop&&event.target===backdrop){const drawer=[...document.querySelectorAll('aside.open,[aria-hidden="false"]')].filter(visible).pop();if(drawer)close(drawer)}});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=[...document.querySelectorAll(`${overlaySelector},aside.open,[aria-hidden="false"]`)].filter(visible).pop();if(open){event.preventDefault();close(open)}});
})();
