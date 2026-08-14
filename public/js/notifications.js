(function(){
  if(document.querySelector('.notification-centre'))return;
  function baseRole(){if(document.body.classList.contains('admin-page'))return'admin';if(document.body.classList.contains('business-page'))return'business';if(document.body.classList.contains('portal-page'))return'masjid';return null}
  const role=baseRole();if(!role)return;const header=document.querySelector('main > header');if(!header)return;
  const wrap=document.createElement('div');wrap.className='notification-centre';wrap.innerHTML='<button class="notification-bell" type="button" aria-label="Notifications">&#128276;<b hidden>0</b></button><section class="notification-menu" hidden><header><strong>Notifications</strong><button type="button">Close</button></header><div></div></section>';header.appendChild(wrap);
  const bell=wrap.querySelector('.notification-bell'),menu=wrap.querySelector('.notification-menu'),list=menu.querySelector('div');
  async function render(){
    const state=await MasjidDB.state(),session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null'),account=(state.masjidPointAdminApplications||[]).find(a=>a.reference===session?.reference),allowed=new Set([role]);
    if(role==='business'&&account){allowed.add(`business:${account.businessCode}`);allowed.add(`business:${account.email}`)}
    // The server addresses a masjid sometimes by name and sometimes by reference — a business
    // applying to advertise is sent to the reference, for one. Only the name was accepted here, so
    // every reference-addressed notification was written and never delivered to anybody. Accept
    // both, rather than hunting each caller and waiting for the next one to pick the other form.
    if(role==='masjid'&&account){allowed.add(`masjid:${account.name}`);allowed.add(`masjid:${account.reference}`)}
    if(role==='business'&&account)allowed.add(`business:${account.reference}`);
    const items=(state.masjidPointNotifications||[]).filter(n=>allowed.has(n.audience)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,8),unread=items.filter(n=>!n.read).length;
    bell.querySelector('b').hidden=!unread;bell.querySelector('b').textContent=unread;
    list.innerHTML=items.length?items.map(n=>`<a href="${n.href}" data-id="${n.id}" class="${n.read?'':'unread'}"><strong>${n.title}</strong><span>${n.message}</span><small>${new Date(n.createdAt).toLocaleString('en-GB')}</small></a>`).join(''):'<p class="notification-empty">No notifications yet.</p>';
    list.querySelectorAll('[data-id]').forEach(a=>a.onclick=()=>fetch('/api/notifications/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.dataset.id})}))
  }
  bell.onclick=async()=>{menu.hidden=!menu.hidden;if(!menu.hidden)await render()};menu.querySelector('header button').onclick=()=>menu.hidden=true;addEventListener('masjidpoint:ready',render);setTimeout(render,400);setInterval(render,10000)
})();
