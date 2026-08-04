(function(){
 const surfaceSelectors=['.admin-page tbody tr','.profile-listing-row','.invoice-proof-list>article','.proof-row','.settlement-card','.shop-order-card','.admin-user-row'];
 const interactive='a[href],button:not([disabled]),input,select,textarea,label';
 function primary(surface){return surface.querySelector('[data-edit-product],a.review-link,a[href],[data-review],[data-proof],[data-view],button:not([disabled])')}
 function prepare(){document.querySelectorAll(surfaceSelectors.join(',')).forEach(surface=>{if(surface.dataset.surfaceReady||surface.closest('.admin-audit-card,.audit-panel,.invoice-proof-modal,.product-modal,.proof-review,.account-modal'))return;const action=primary(surface);if(!action)return;surface.dataset.surfaceReady='true';surface.classList.add('admin-clickable-surface');surface.tabIndex=0;surface.setAttribute('role','link');const name=surface.querySelector('strong,h3')?.textContent.trim();if(name)surface.setAttribute('aria-label',`Open ${name}`)})}
 function activate(surface){const action=primary(surface);if(!action)return;if(action.matches('a[href]'))location.href=action.href;else action.click()}
 document.addEventListener('click',event=>{if(event.target.closest(interactive))return;const surface=event.target.closest('.admin-clickable-surface');if(surface)activate(surface)});
 document.addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key)||event.target.closest(interactive))return;const surface=event.target.closest('.admin-clickable-surface');if(!surface)return;event.preventDefault();activate(surface)});
 prepare();new MutationObserver(prepare).observe(document.body,{childList:true,subtree:true});
})();
