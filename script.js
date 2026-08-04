// Home page interactions. Business cards and category chips are rendered from live data after
// this file runs, so everything here queries the DOM at event time rather than caching lists.
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.main-nav');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const masjidFilter = document.querySelector('#masjid-filter');
const emptyState = document.querySelector('#empty-state');

menuButton?.addEventListener('click', () => {
  const isOpen = navigation.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
});

navigation?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  navigation.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

function filterCards(category = document.querySelector('.chip.active')?.dataset.category || 'all') {
  const query = (searchInput?.value || '').trim().toLowerCase();
  const masjid = (masjidFilter?.value || '').toLowerCase();
  const cards = document.querySelectorAll('.business-card');
  let visible = 0;
  cards.forEach(card => {
    const content = card.textContent.toLowerCase();
    const categoryMatch = category === 'all' || card.dataset.category === category;
    const queryMatch = !query || content.includes(query);
    const masjidMatch = !masjid || (card.dataset.masjid || '').toLowerCase() === masjid;
    const show = categoryMatch && queryMatch && masjidMatch;
    card.hidden = !show;
    if (show) visible += 1;
  });
  if (emptyState) emptyState.hidden = visible !== 0 || cards.length === 0;
}
window.filterBusinessCards = filterCards;

// Delegated so chips added after load still work.
document.querySelector('#category-chips')?.addEventListener('click', event => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#category-chips .chip').forEach(item => item.classList.remove('active'));
  chip.classList.add('active');
  filterCards(chip.dataset.category);
});

searchForm?.addEventListener('submit', event => {
  event.preventDefault();
  filterCards();
  document.querySelector('#discover')?.scrollIntoView({ behavior: 'smooth' });
});

masjidFilter?.addEventListener('change', () => filterCards());
searchInput?.addEventListener('input', () => filterCards());
