const jobsKey='masjidPointJobs';const sample=[{id:'JOB-2041',title:'Junior Accounts Assistant',employmentType:'Full time',arrangement:'On-site',city:'Birmingham',postcode:'B12 0XS',salaryFrom:'22000',salaryTo:'26000',description:'Support our friendly accounts team with bookkeeping, client records and general office administration. You will work alongside experienced colleagues and receive structured training.',masjid:'Central Masjid',status:'live',enabled:true,submittedAt:'2026-07-28T09:00:00Z',business:'Amanah Accounting',email:'jobs@amanahaccounts.co.uk'},{id:'JOB-2032',title:'Weekend Catering Assistant',employmentType:'Part time',arrangement:'On-site',city:'Birmingham',postcode:'B10 0RX',salaryFrom:'',salaryTo:'',description:'Help prepare and organise catering orders for community events and family celebrations. Previous kitchen experience is helpful but not essential.',masjid:'Central Masjid',status:'live',enabled:true,submittedAt:'2026-07-25T09:00:00Z',business:'Barakah Bakes',email:'hello@barakahbakes.co.uk'},{id:'JOB-2028',title:'Online Maths Tutor',employmentType:'Contract',arrangement:'Remote',city:'Manchester',postcode:'M14 5TB',salaryFrom:'25',salaryTo:'35',description:'Deliver engaging online maths tuition to secondary school pupils. Applicants should have strong subject knowledge and clear communication skills.',masjid:'Masjid Al-Noor',status:'live',enabled:true,submittedAt:'2026-07-21T09:00:00Z',business:'Noor Learning Centre',email:'careers@noorlearning.co.uk'}];let jobs=JSON.parse(localStorage.getItem(jobsKey)||'null')||sample;let visibleJobs=[];const byId=id=>jobs.find(job=>job.id===id);
function formatSalary(job){if(!job.salaryFrom&&!job.salaryTo)return'Salary not specified';if(Number(job.salaryFrom)<100)return`£${job.salaryFrom}${job.salaryTo?`–£${job.salaryTo}`:''} per hour`;return`£${Number(job.salaryFrom).toLocaleString('en-GB')}${job.salaryTo?`–£${Number(job.salaryTo).toLocaleString('en-GB')}`:''} per year`}function daysAgo(date){const days=Math.max(0,Math.floor((Date.now()-new Date(date))/86400000));return days===0?'Today':`${days} day${days===1?'':'s'} ago`}
function render(){const keyword=document.querySelector('#keyword').value.toLowerCase().trim(),location=document.querySelector('#location').value.toLowerCase().trim(),masjid=document.querySelector('#masjid-job-filter').value,type=document.querySelector('#type-filter').value,arrangement=document.querySelector('#arrangement-filter').value;visibleJobs=jobs.filter(job=>job.status==='live'&&job.enabled&&(masjid==='all'||job.masjid===masjid)&&(type==='all'||job.employmentType===type)&&(arrangement==='all'||job.arrangement===arrangement)&&(!keyword||`${job.title} ${job.business||'Amanah Accounting'} ${job.description}`.toLowerCase().includes(keyword))&&(!location||`${job.city} ${job.postcode}`.toLowerCase().includes(location)));if(document.querySelector('#sort-jobs').value==='title')visibleJobs.sort((a,b)=>a.title.localeCompare(b.title));else visibleJobs.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));document.querySelector('#hero-job-count').textContent=jobs.filter(j=>j.status==='live'&&j.enabled).length;document.querySelector('#result-summary').textContent=`${visibleJobs.length} approved job${visibleJobs.length===1?'':'s'} found`;document.querySelector('#public-job-list').innerHTML=visibleJobs.map(job=>`<article class="public-job-card"><div class="job-card-main"><span class="company-initials">${(job.business||'Amanah Accounting').split(' ').map(w=>w[0]).slice(0,2).join('')}</span><div class="job-copy"><h3>${job.title}</h3><p>${job.business||'Amanah Accounting'} · ${job.city}</p><div class="public-job-tags"><span>${job.employmentType}</span><span>${job.arrangement}</span><span class="masjid-tag">⌂ ${job.masjid}</span></div></div></div><div class="job-card-side"><small>Posted ${daysAgo(job.submittedAt)}</small><button data-public-job="${job.id}">View opportunity →</button></div></article>`).join('');document.querySelector('#public-job-empty').hidden=visibleJobs.length>0;document.querySelectorAll('[data-public-job]').forEach(button=>button.onclick=()=>openJob(button.dataset.publicJob))}
function openJob(id){const job=byId(id),business=job.business||'Amanah Accounting';document.querySelector('#public-job-title').textContent=job.title;document.querySelector('#public-job-company').textContent=`${business} · ${job.city}`;document.querySelector('.drawer-company').textContent=business.split(' ').map(w=>w[0]).slice(0,2).join('');document.querySelector('#public-job-tags').className='public-job-tags';document.querySelector('#public-job-tags').innerHTML=`<span>${job.employmentType}</span><span>${job.arrangement}</span><span>${job.masjid}</span>`;document.querySelector('#public-job-description').textContent=job.description;document.querySelector('#public-job-details').innerHTML=`<div><dt>Location</dt><dd>${job.city}, ${job.postcode}</dd></div><div><dt>Salary</dt><dd>${formatSalary(job)}</dd></div><div><dt>Employment</dt><dd>${job.employmentType}</dd></div><div><dt>Work arrangement</dt><dd>${job.arrangement}</dd></div><div><dt>Advertised through</dt><dd>${job.masjid}</dd></div><div><dt>Reference</dt><dd>${job.id}</dd></div>`;document.querySelector('#apply-job').href=`mailto:${job.email||'jobs@amanahaccounts.co.uk'}?subject=${encodeURIComponent(`Application: ${job.title} (${job.id})`)}`;document.querySelector('#public-job-backdrop').hidden=false;document.querySelector('#public-job-drawer').classList.add('open')}
function closeJob(){document.querySelector('#public-job-backdrop').hidden=true;document.querySelector('#public-job-drawer').classList.remove('open')}document.querySelector('#public-job-search').onsubmit=e=>{e.preventDefault();render();document.querySelector('.jobs-directory').scrollIntoView({behavior:'smooth'})};['masjid-job-filter','type-filter','arrangement-filter','sort-jobs'].forEach(id=>document.querySelector(`#${id}`).onchange=render);document.querySelector('#clear-filters').onclick=()=>{document.querySelector('#public-job-search').reset();['masjid-job-filter','type-filter','arrangement-filter'].forEach(id=>document.querySelector(`#${id}`).value='all');render()};document.querySelector('#close-public-job').onclick=closeJob;document.querySelector('#public-job-backdrop').onclick=closeJob;render();

const jobDetailsAnchor=document.querySelector('#public-job-details').closest('section');[['responsibilities-section','Key responsibilities','public-job-responsibilities'],['requirements-section','Requirements and experience','public-job-requirements'],['benefits-section','Benefits','public-job-benefits']].reverse().forEach(([id,title,textId])=>{const section=document.createElement('section');section.id=id;section.hidden=true;section.innerHTML=`<h3>${title}</h3><p id="${textId}"></p>`;jobDetailsAnchor.before(section)});const detailedOpenJob=openJob;openJob=function(id){detailedOpenJob(id);const job=byId(id);[['responsibilities-section','public-job-responsibilities','responsibilities'],['requirements-section','public-job-requirements','requirements'],['benefits-section','public-job-benefits','benefits']].forEach(([sectionId,textId,key])=>{document.querySelector(`#${sectionId}`).hidden=!job[key];document.querySelector(`#${textId}`).textContent=job[key]||''});const details=document.querySelector('#public-job-details');if(job.industry)details.insertAdjacentHTML('beforeend',`<div><dt>Industry</dt><dd>${job.industry}</dd></div>`);if(job.educationLevel)details.insertAdjacentHTML('beforeend',`<div><dt>Education</dt><dd>${job.educationLevel}</dd></div>`);if(job.experienceLevel)details.insertAdjacentHTML('beforeend',`<div><dt>Experience</dt><dd>${job.experienceLevel}</dd></div>`);if(job.closingDate)details.insertAdjacentHTML('beforeend',`<div><dt>Closing date</dt><dd>${new Intl.DateTimeFormat('en-GB').format(new Date(job.closingDate))}</dd></div>`);if(job.encouraged?.length)details.insertAdjacentHTML('beforeend',`<div><dt>Encouraged to apply</dt><dd>${job.encouraged.join(', ')}</dd></div>`);document.querySelector('#apply-job').href=job.applicationMethod==='external'&&job.applicationUrl?job.applicationUrl:`mailto:${job.applicationEmail||job.email||'jobs@amanahaccounts.co.uk'}?subject=${encodeURIComponent(`Application: ${job.title} (${job.id})`)}`};
const candidateApplyOpenJob=openJob;openJob=function(id){candidateApplyOpenJob(id);document.querySelector('#apply-job').href=`candidate-apply?job=${encodeURIComponent(id)}`};
formatSalary=function(job){if(!job.salaryFrom)return'Salary not specified';const period={hour:'hour',day:'day',week:'week',month:'month',year:'year'}[job.payPeriod]||'year';const amount=value=>Number(value).toLocaleString('en-GB',{minimumFractionDigits:period==='hour'?2:0,maximumFractionDigits:2});return`£${amount(job.salaryFrom)}${job.salaryTo?`–£${amount(job.salaryTo)}`:''} per ${period}`};

// A role opened from a masjid directory, a shared link or a bookmark arrives as ?job=<id>.
// Open its details straight away rather than dropping the visitor on the unfiltered list.
{
  const wanted = new URLSearchParams(location.search).get('job');
  if (wanted) {
    const job = typeof byId === 'function' ? byId(wanted) : null;
    if (job) {
      // Clear any filter that would hide the role, so closing the drawer still shows it.
      const keyword = document.querySelector('#keyword'), place = document.querySelector('#location');
      if (keyword) keyword.value = '';
      if (place) place.value = '';
      ['#masjid-job-filter', '#type-filter', '#arrangement-filter'].forEach(id => {
        const select = document.querySelector(id);
        if (select) select.value = 'all';
      });
      if (typeof render === 'function') render();
      openJob(wanted);
    }
  }
}

// A signed-in community member should be able to see, at a glance, which roles they have
// already applied for — on the list and inside the role itself.
(async function () {
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem('masjidPointSession') || 'null'); } catch (_) {}
  if (session?.role !== 'customer' || !session.email) return;

  const state = window.MasjidDB ? await MasjidDB.state() : null;
  const source = state?.masjidPointJobApplications
    || JSON.parse(localStorage.getItem('masjidPointJobApplications') || '[]');
  const email = String(session.email).toLowerCase();
  const applied = new Map();
  source.filter(a => String(a.email || '').toLowerCase() === email)
    .forEach(a => applied.set(a.jobId, a));
  if (!applied.size) return;

  const list = document.querySelector('#public-job-list');
  const when = value => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  function mark() {
    if (!list) return;
    [...list.querySelectorAll('.public-job-card')].forEach(card => {
      if (card.querySelector('.applied-flag')) return;
      // The card carries no id, so match on the title shown in its heading.
      const title = card.querySelector('h3')?.textContent?.trim();
      const match = [...applied.values()].find(a => (a.jobTitle || '').trim() === title);
      if (!match) return;
      card.classList.add('already-applied');
      const flag = document.createElement('span');
      flag.className = 'applied-flag';
      flag.textContent = `✓ Applied ${when(match.submittedAt)}`.trim();
      (card.querySelector('.job-copy') || card).appendChild(flag);
    });
  }

  // The list re-renders on every filter change.
  if (list) { new MutationObserver(mark).observe(list, { childList: true }); mark(); }

  // Inside the role, replace the apply button with the application's status.
  const previousOpenJob = openJob;
  openJob = function (id) {
    previousOpenJob(id);
    const match = applied.get(id);
    const apply = document.querySelector('#apply-job');
    const existing = document.querySelector('.drawer-applied');
    if (existing) existing.remove();
    // The drawer is reused for every role, so always restore the apply button before deciding —
    // otherwise viewing one applied role would hide it for every role opened afterwards.
    if (apply) apply.hidden = false;
    if (!match || !apply) return;
    apply.hidden = true;
    const note = document.createElement('div');
    note.className = 'drawer-applied';
    note.innerHTML = `<strong>✓ You applied for this role</strong>
      <small>${when(match.submittedAt)} · ${match.reference} · ${match.status || 'Submitted'}</small>
      <a href="my-account">Track it in your account →</a>`;
    apply.parentElement.insertBefore(note, apply);
  };

  // A ?job= deep link opens the drawer before this block finishes loading the applications, so it
  // has to be re-opened once we know whether it was already applied for. Which of the two wins the
  // race varies, so rather than checking once, wait for the drawer and act when it appears.
  const wanted = new URLSearchParams(location.search).get('job');
  if (wanted && applied.has(wanted)) {
    const drawer = document.querySelector('#public-job-drawer');
    const applyState = () => {
      if (!drawer?.classList.contains('open')) return false;
      openJob(wanted);
      return true;
    };
    if (!applyState() && drawer) {
      const observer = new MutationObserver(() => { if (applyState()) observer.disconnect(); });
      observer.observe(drawer, { attributes: true, attributeFilter: ['class'] });
      // The drawer may already have been opening when this ran, so stop waiting eventually.
      setTimeout(() => observer.disconnect(), 8000);
    }
  }
})();

// The role drawer is created before the business-image helper sees it. Rebuild its
// company mark each time a role opens so the same public owner photo/logo used on the
// result cards is available here too.
(function addBusinessImageToJobDrawer() {
  const previousOpenJob = openJob;
  openJob = function (id) {
    previousOpenJob(id);
    const job = typeof byId === 'function' ? byId(id) : null;
    const current = document.querySelector('.drawer-company');
    if (!current || !job) return;

    const business = job.business || 'Business';
    const initials = business.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
    const mark = document.createElement('span');
    mark.className = 'drawer-company';
    mark.textContent = initials;
    const reference = job.businessReference || job.businessCode;
    if (reference) {
      mark.dataset.businessAvatar = '';
      mark.dataset.businessReference = reference;
      mark.dataset.businessName = business;
      mark.dataset.businessImageUrl = job.businessLogoUrl || '';
      mark.dataset.buttonClass = 'drawer-company job-drawer-image-trigger';
      mark.dataset.imageClass = 'job-drawer-business-avatar';
    }
    current.replaceWith(mark);
  };
})();

// Arriving from a masjid page with ?masjid=<name> should land on that masjid's roles, not the
// full list. The filter options are built from the jobs once they load, so this waits for the
// option to exist before selecting it.
(function presetMasjidFilter() {
  const wanted = new URLSearchParams(location.search).get('masjid');
  if (!wanted) return;
  let attempts = 0;
  (function attempt() {
    const select = [...document.querySelectorAll('select')]
      .find(s => [...s.options].some(o => o.value === wanted));
    if (select) {
      select.value = wanted;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (++attempts < 25) setTimeout(attempt, 120);
  })();
})();

// Keep the large search form out of the way until the visitor asks for it, then remember that
// preference on both desktop and mobile. Search text updates the results as it is entered.
(function setupRememberedJobFilters() {
  const hero = document.querySelector('#jobs-directory-hero');
  const toggle = document.querySelector('#jobs-filter-toggle');
  const form = document.querySelector('#public-job-search');
  if (!hero || !toggle || !form) return;

  const preferenceKey = 'masjidPoint.jobsDirectoryFilters';
  let open = false;
  try { open = localStorage.getItem(preferenceKey) === 'open'; } catch (_) {}

  const paint = () => {
    hero.classList.toggle('filters-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    const label = toggle.querySelector('span:last-child');
    if (label) label.textContent = open ? 'Hide search and filters' : 'Show search and filters';
  };
  toggle.addEventListener('click', () => {
    open = !open;
    try { localStorage.setItem(preferenceKey, open ? 'open' : 'closed'); } catch (_) {}
    paint();
  });
  paint();

  let timer;
  ['keyword', 'location'].forEach(id => document.querySelector(`#${id}`)?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (typeof render === 'function') render(); }, 120);
  }));
})();

// Job cards use the business owner's public photo first, then the business logo, and only keep
// their initials when neither image is available. Re-run after every filter render.
(function setupJobBusinessImages() {
  const list = document.querySelector('#public-job-list');
  if (!list) return;
  const hydrate = () => list.querySelectorAll('.company-initials:not([data-business-avatar])').forEach(node => {
    const id = node.closest('.public-job-card')?.querySelector('[data-public-job]')?.dataset.publicJob;
    const job = typeof byId === 'function' ? byId(id) : null;
    const reference = job?.businessReference || job?.businessCode;
    if (!reference) return;
    node.dataset.businessAvatar = '';
    node.dataset.businessReference = reference;
    node.dataset.businessName = job.business || 'Business';
    node.dataset.businessImageUrl = job.businessLogoUrl || '';
    node.dataset.buttonClass = 'job-business-image-trigger';
    node.dataset.imageClass = 'job-business-avatar-image';
    // Replacing the prepared node lets the shared avatar observer resolve its secure image URL.
    node.replaceWith(node.cloneNode(true));
  });
  new MutationObserver(hydrate).observe(list, { childList: true, subtree: true });
  hydrate();
})();

// The masjid filter shipped with two hardcoded demo names, so it could never match a real job.
// It is rebuilt from the masjids that actually have live roles, after which an incoming
// ?masjid=<name> (from a masjid's own page) can select one.
(async function buildMasjidFilter() {
  const select = document.querySelector('#masjid-job-filter');
  if (!select) return;
  let live = [];
  try {
    const state = await MasjidDB.state();
    live = (state.masjidPointJobs || []).filter(job => job.status === 'live' && job.enabled);
  } catch { return; }

  const names = [...new Set(live.flatMap(job =>
    (job.masjids || []).filter(m => m.paymentStatus === 'paid').map(m => m.name)
      .concat(job.masjid ? [job.masjid] : [])
  ).filter(Boolean))].sort();
  if (!names.length) return;

  const keep = select.value;
  select.innerHTML = '<option value="all">All masjids</option>';
  names.forEach(name => select.add(new Option(name, name)));

  const wanted = new URLSearchParams(location.search).get('masjid');
  const target = names.includes(wanted) ? wanted : (names.includes(keep) ? keep : 'all');
  select.value = target;
  select.dispatchEvent(new Event('change', { bubbles: true }));
})();
