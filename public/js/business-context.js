(async function(){const session=JSON.parse(sessionStorage.getItem('masjidPointSession')||'null');if(session?.role!=='business')return;const state=await MasjidDB.state(),app=(state.masjidPointAdminApplications||[]).find(a=>a.reference===session.reference);if(!app)return;const name=app.name,details=app.details||{},initials=name.split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();document.querySelector('.business-identity>span').textContent=initials;document.querySelector('.business-identity strong').textContent=name;document.querySelector('.business-identity small').textContent=`Ref: ${app.businessCode||app.reference}`;document.querySelector('.business-welcome .eyebrow').innerHTML=`<span></span> ${name} portal`;document.querySelector('#profile-name').textContent=name;document.querySelector('.profile-logo').textContent=initials;document.querySelector('#profile-category').textContent=details.Category||'Other';document.querySelector('#profile-email').textContent=app.email;document.querySelector('#profile-phone').textContent=details['Business phone']||'Not provided';document.querySelector('#profile-website').textContent=details.Website||'Not provided';
// The greeting shipped with a demo first name baked into the markup, so every business was
// welcomed as someone else. Use the contact this account actually belongs to.
const contact=details['Contact name']||details.Contact||'';const greeting=document.querySelector('.business-topbar h1');
if(greeting)greeting.textContent=contact?`Assalamu Alaikum, ${contact.split(/\s+/)[0]}`:'Assalamu Alaikum';
// The profile form itself is filled by business-isolation.js from the same record; an empty
// contact number there means none is on file, which is left empty rather than guessed at.document.querySelector('#listing-cards').innerHTML='<div class="business-empty">No active mosque advertising yet.</div>';document.querySelector('#masjid-total').textContent='0';document.querySelector('#listing-total').textContent='0';
// "View all invoices" was a button with nothing behind it. The panel shows the most recent few,
// so it now expands to the rest and collapses again — and stays hidden when there is no more.
// Only this panel's rows. Job applicants and payment history are drawn as .invoice-panel with an
// .invoice-table inside them, so a document-wide selector counted their rows as invoices four,
// five and six — and hid them. With three invoices on the account that emptied both tables
// completely, which is why Job applicants said "1 total" above an empty list.
const toggle=document.querySelector('#toggle-invoices');
const invoicePanel=toggle&&toggle.closest('.invoice-panel');
if(toggle&&invoicePanel){const VISIBLE=3;const rows=()=>[...invoicePanel.querySelectorAll('.invoice-table tbody tr')];
 let expanded=false;
 const apply=()=>{const all=rows();toggle.hidden=all.length<=VISIBLE;all.forEach((row,index)=>{row.hidden=!expanded&&index>=VISIBLE});toggle.textContent=expanded?'Show fewer invoices':`View all invoices (${all.length}) →`};
 toggle.onclick=()=>{expanded=!expanded;apply()};
 apply();
 const panel=invoicePanel.querySelector('.invoice-table tbody');
 if(panel)new MutationObserver(()=>{if(!expanded)apply()}).observe(panel,{childList:true});}})();
