(function(){
  const list=document.querySelector('#admin-user-list');if(!list)return;
  const session=JSON.parse(sessionStorage.getItem('masjidPointAdminSession')||'null');
  const headers=()=>({'Content-Type':'application/json','X-MasjidPoint-Session':session?.token||''});
  async function decorate(){
    const response=await fetch('/api/admin/users',{headers:headers()});if(!response.ok)return;
    const {users=[]}=await response.json();
    [...list.querySelectorAll('.admin-user-row')].forEach(row=>{
      const id=row.querySelector('small')?.textContent,admin=users.find(item=>item.id===id);if(!admin||row.querySelector('[data-admin-2fa]'))return;
      const button=document.createElement('button');button.type='button';button.dataset.admin2fa=admin.id;button.dataset.enabled=String(!admin.twoFactorEnabled);button.textContent=admin.twoFactorEnabled?'Disable email 2FA':'Enable email 2FA';row.appendChild(button);
    });
  }
  list.addEventListener('click',async event=>{const button=event.target.closest('[data-admin-2fa]');if(!button)return;button.disabled=true;const response=await fetch('/api/admin/users/2fa',{method:'POST',headers:headers(),body:JSON.stringify({id:button.dataset.admin2fa,enabled:button.dataset.enabled==='true'})}),result=await response.json();if(!response.ok){button.disabled=false;return alert(result.error)}location.reload()});
  new MutationObserver(decorate).observe(list,{childList:true});decorate();
})();
