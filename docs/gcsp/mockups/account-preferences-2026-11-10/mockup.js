// Discussion artifact only. Reuses the application kit; never calls an application API.
import { el, screenIntro, button, factList } from '../../../../blocks/vehicle-matcher/ui.js';
import { mediaWell } from '../../../../blocks/vehicle-matcher/modes/result-card.js';
import { renderOptionList } from '../../../../blocks/vehicle-matcher/modes/question-ui.js';
import { portalShell, svgIcon } from '../../../../blocks/gcsp/shell/portal-shell.js';
import { PORTAL_NAVIGATION } from '../../../../blocks/gcsp/employee/portal-navigation.js';
import { checkboxField } from '../../../../blocks/gcsp/kit/form-controls.js';
import { ACCOUNT_SNAPSHOT } from '../../../../blocks/gcsp/account/fixtures.js';

const KEY = 'gcsp:account-preferences-discussion:2026-11-10:v1';
const mode = new URL(location.href).searchParams.get('state');
const EMPTY = { values: {}, weights: {}, same: false, rating: 0 };
const SELECTED = { values: { body: 'estate', fuel: 'petrol', comfort: '100' }, weights: {}, same: false, rating: 4 };
const ICONS = {
  body: ['M3 14l2-5h14l2 5', 'M3 14h18v4H3z', 'M6 18v2', 'M18 18v2'],
  fuel: ['M5 21V4h9v17', 'M7 7h5v5H7z', 'M3 21h13', 'M14 8h3l3 3v6a2 2 0 0 1-4 0v-4'],
  sportiness: ['M4 18a9 9 0 1 1 16 0', 'M12 13l5-5', 'M7 16h10'],
  comfort: ['M7 3v9h10v8', 'M7 12l-2 7h14', 'M9 5h4v5', 'M4 21h16'],
  economy: ['M20 4C9 2 3 9 5 16c8 5 16-2 15-12Z', 'M5 20l10-10'],
  size: ['M4 5h16v14H4z', 'M7 12h10', 'M10 9l-3 3 3 3', 'M14 9l3 3-3 3'],
  bin: ['M3 6h18', 'M9 6V3h6v3', 'M5 6l1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
  check: ['M5 12l4 4L19 6'],
  star: ['m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z'],
};
const options = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const CATEGORIES = [
  { id: 'body', label: 'Body', question: 'Which body styles feel right?', multi: true,
    options: options(['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Touring / Estate'], ['suv', 'SUV'], ['coupe', 'Coupé'], ['convertible', 'Convertible'], ['mpv', 'MPV']) },
  { id: 'fuel', label: 'Fuel', question: 'What would you like to drive?', multi: true,
    options: options(['petrol', 'Petrol'], ['diesel', 'Diesel'], ['phev', 'Plug-in hybrid'], ['ev', 'Electric']) },
  { id: 'sportiness', label: 'Sportiness', question: 'How do you like your car to feel?',
    options: options(['0', 'Relaxed'], ['50', 'A little of both'], ['100', 'Sporty']) },
  { id: 'comfort', label: 'Comfort', question: 'How much comfort would you like?',
    options: options(['0', 'Simple and functional'], ['50', 'A comfortable balance'], ['100', 'As comfortable as possible']) },
  { id: 'economy', label: 'Economy', question: 'Where would you put the balance?',
    options: options(['0', 'Driving comes first'], ['50', 'A balance of both'], ['100', 'Economy comes first']) },
  { id: 'size', label: 'Size', question: 'What size works for your life?',
    options: options(['0', 'Compact'], ['50', 'Mid-size'], ['100', 'Spacious']) },
];

function validState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY);
  const values = {};
  for (const category of CATEGORIES) {
    const supplied = value.values?.[category.id];
    const allowed = new Set(category.options.map((o) => o.value));
    if (Array.isArray(supplied) && category.multi) {
      const selected = [...new Set(supplied.filter((v) => allowed.has(v)))];
      if (selected.length) values[category.id] = selected;
    } else if (allowed.has(supplied)) values[category.id] = category.multi ? [supplied] : supplied;
  }
  const weights = Object.fromEntries(Object.entries(value.weights ?? {}).filter(([key, v]) => CATEGORIES.some((c) => c.id === key) && ['low', 'medium', 'high'].includes(v)));
  return { values, weights, same: value.same === true, rating: Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5 ? value.rating : 0 };
}

let state;
try { state = validState(JSON.parse(localStorage.getItem(KEY))); } catch { state = structuredClone(EMPTY); }
if (mode === 'empty') state = structuredClone(EMPTY);
if (['selected', 'long', 'missing', 'same'].includes(mode)) state = validState(SELECTED);
if (mode === 'same') state.same = true;
let openCategory = null;
let pendingRemoval = null;
const categoryNodes = new Map();
const contract = ACCOUNT_SNAPSHOT.value.contracts[0];
const account = ACCOUNT_SNAPSHOT.value.account;
const say = (text) => { message.textContent = text; message.classList.remove('is-error'); };
const count = () => Object.keys(state.values).length;
// Illustrative input completeness, not a model-confidence calculation. See README.
const score = () => state.same ? 11 : [1, 3, 4, 6, 7, 9, 10][count()];
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { say('Your changes could not be kept. Check your browser storage.'); } };

const shell = portalShell({ account: { status: 'ready', name: account.name, email: account.contact.email, context: 'BMW Choices' },
  navigation: PORTAL_NAVIGATION.filter((item) => ['cars', 'brief'].includes(item.key)), active: 'cars',
  breadcrumbs: ['Your account'], signOut: false, presenterControls: false,
  onNavigate: (key) => {
    const target = key === 'brief' ? preferences : page;
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    target.querySelector('h1,h2')?.focus();
  } });
shell.root.classList.add('account-concept');
document.getElementById('account-mockup').append(shell.root);
const page = el('div', 'vm concept-page');
const pageHead = el('div', 'concept-page-head');
const intro = screenIntro({ title: 'Your cars', level: 1 });
intro.querySelector('h1').tabIndex = -1;
const allowance = el('p', 'concept-allowance');
allowance.append(el('strong', '', '1,300 points a month'), 'Your BMW Choices allowance');
pageHead.append(intro, allowance);

const car = el('section', 'concept-car'); car.setAttribute('aria-labelledby', 'current-car-title');
const photo = el('div', 'concept-photo');
const { media } = mediaWell({ name: contract.model, photo: mode === 'missing' ? '' : contract.media.src,
  alt: 'BMW 3 Series Touring', caption: '' }, 'gcsp-media', { placeholder: 'No image available for your car' });
photo.append(media);

const rating = el('div', 'concept-rating');
const ratingGroup = el('fieldset');
ratingGroup.append(el('legend', '', 'How do you feel about your car?'));
const stars = el('div', 'concept-stars');
const ratingCaption = el('p', 'concept-rating-caption'); ratingCaption.id = 'rating-description';
const ratingWords = ['', 'Not for me', 'Ready for a change', 'It’s okay', 'I really like it', 'I love it'];
const labels = [];
function updateRating() {
  labels.forEach((label, i) => { label.classList.toggle('is-filled', i < state.rating); label.querySelector('input').checked = i + 1 === state.rating; });
  ratingCaption.textContent = state.rating ? `${state.rating} of 5 · ${ratingWords[state.rating]}` : 'Choose 1–5 stars';
}
for (let value = 1; value <= 5; value++) {
  const label = el('label', 'concept-star'); const input = el('input');
  input.type = 'radio'; input.name = 'current-car-rating'; input.value = String(value);
  input.setAttribute('aria-label', `${value} ${value === 1 ? 'star' : 'stars'}: ${ratingWords[value]}`);
  input.setAttribute('aria-describedby', ratingCaption.id);
  input.addEventListener('change', () => { state.rating = value; updateRating(); store(); });
  label.append(input, svgIcon(ICONS.star)); labels.push(label); stars.append(label);
}
ratingGroup.append(stars, ratingCaption); rating.append(ratingGroup); photo.append(rating); updateRating();
const carCopy = el('div', 'concept-car-copy');
const carTitle = el('h2', 'concept-car-title', mode === 'long' ? 'BMW 3 Series 330e xDrive M Sport Pro Touring' : 'BMW 3 Series Touring');
carTitle.id = 'current-car-title'; carTitle.append(el('span', '', mode === 'long' ? 'M Sport Pro · Plug-in hybrid · BMW Individual specification' : '320i M Sport · Petrol'));
const details = el('details', 'gcsp-details'); details.append(el('summary', 'gcsp-details-summary', 'Order, collection and vehicle details'),
  factList([{ label: 'Car order number', value: contract.orderNumber ?? '8074261' }, { label: 'Annual mileage', value: 12000, unit: 'mi/year' }, { label: 'Collected', value: '1 June 2026' }]));
carCopy.append(carTitle, el('p', 'gcsp-countdown', 'Contract ends in 21 days · 1 December 2026'),
  factList([{ label: 'Status', value: 'Current car' }, { label: 'Driver', value: account.name },
    { label: 'Contract end', value: '1 December 2026' }, { label: 'Term', value: 6, unit: 'months' },
    { label: 'Annual mileage', value: 12000, unit: 'mi/year' }, { label: 'Scheme', value: 'BMW Choices' },
    { label: 'Registration', value: contract.registration ?? null, missingLabel: 'Not supplied' }, { label: 'Current mileage', value: 5200, unit: 'mi' }]),
  el('p', 'concept-car-terms', '1,100 points a month'), details);
car.append(photo, carCopy);

const preferences = el('section', 'concept-preferences'); preferences.id = 'your-preferences'; preferences.setAttribute('aria-labelledby', 'preferences-heading');
const preferenceHead = el('div', 'concept-pref-head'); const preferenceIntro = el('div');
const preferenceTitle = el('h2', 'gcsp-h2', 'Your preferences'); preferenceTitle.id = 'preferences-heading'; preferenceTitle.tabIndex = -1;
const instruction = el('p', 'gcsp-note', 'Choose at least 3 categories. Tell your buddy what matters.');
preferenceIntro.append(preferenceTitle, instruction);
const scorePanel = el('div', 'concept-score'); const scoreValue = el('strong', 'concept-score-value');
const meter = el('span', 'concept-score-meter'); meter.setAttribute('aria-hidden', 'true');
for (let i = 1; i <= 11; i++) meter.append(el('i'));
scorePanel.append(el('span', 'concept-score-label', 'Buddy understanding'), scoreValue, meter);
preferenceHead.append(preferenceIntro, scorePanel);

const modeRow = el('div', 'concept-mode');
const toggle = checkboxField({ id: 'same-again', label: 'Same again, please!', checked: state.same,
  onChange: (same) => { state.same = same; openCategory = null; pendingRemoval = null; say(''); renderOptions(); update(); store(); } });
toggle.input.setAttribute('role', 'switch'); toggle.input.setAttribute('aria-describedby', 'same-again-consequence');
const modeNote = el('p', 'gcsp-note'); modeNote.id = 'same-again-consequence';
modeRow.append(toggle.root, modeNote);

const categories = el('div', 'concept-categories');
for (const category of CATEGORIES) {
  const root = el('div', 'concept-category'); const open = el('button', 'concept-category-open'); open.type = 'button';
  open.id = `category-${category.id}`; open.setAttribute('aria-controls', 'category-options');
  const top = el('span', 'concept-category-top'); top.append(svgIcon(ICONS[category.id]), el('span', '', category.label));
  const value = el('span', 'concept-category-value', 'Choose');
  open.append(top, value);
  open.addEventListener('click', () => { openCategory = openCategory === category.id ? null : category.id; pendingRemoval = null; say(''); renderOptions(); update(); });
  const remove = el('button', 'concept-category-remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${category.label} preference`); remove.append(svgIcon(ICONS.bin));
  remove.addEventListener('click', () => { pendingRemoval = category.id; openCategory = null; renderOptions(); update(); removal.querySelector('button').focus(); });
  root.append(open, remove); categories.append(root); categoryNodes.set(category.id, { root, open, value, remove });
}
const optionPanel = el('div', 'concept-option-panel'); optionPanel.id = 'category-options';
const removal = el('div', 'concept-removal'); removal.setAttribute('role', 'group'); removal.setAttribute('aria-labelledby', 'remove-title');
const foot = el('div', 'concept-foot');
const message = el('p', 'concept-save-message'); message.id = 'preference-status'; message.setAttribute('role', 'status');
const save = button({ label: 'Save preferences', variant: 'primary', onClick: () => {
  if (!state.same && count() < 3) {
    message.textContent = `Choose ${3 - count()} more ${count() === 2 ? 'category' : 'categories'} to save your preferences.`;
    message.classList.add('is-error'); message.tabIndex = -1; message.focus(); return;
  }
  store(); say(state.same ? 'Saved. Your buddy will look for more of what you love.' : 'Saved. Your buddy knows what matters to you.');
} });
save.setAttribute('aria-describedby', message.id); foot.append(message, save);
preferences.append(preferenceHead, modeRow, categories, removal, optionPanel, foot);

function renderOptions() {
  optionPanel.replaceChildren(); optionPanel.hidden = !openCategory || state.same;
  if (!openCategory || state.same) return;
  const category = CATEGORIES.find((c) => c.id === openCategory);
  const heading = el('div', 'concept-option-heading'); const title = el('h3', '', category.question);
  title.id = 'open-category-heading';
  const close = button({ label: 'Done', variant: 'ghost', onClick: () => { openCategory = null; renderOptions(); update(); categoryNodes.get(category.id).open.focus(); } });
  heading.append(title, close);
  const choice = renderOptionList(category, null, { value: state.values[category.id] ?? (category.multi ? [] : null),
    ariaLabel: category.question, onValueChange: (value) => {
      if (Array.isArray(value) && !value.length) delete state.values[category.id]; else state.values[category.id] = value;
      say(''); update(); store();
    } });
  choice.list.classList.add('concept-options');
  const importance = el('details', 'concept-importance'); importance.append(el('summary', '', 'How much does this matter?'));
  const weight = renderOptionList({ id: `importance-${category.id}`, options: options(['low', 'A little'], ['medium', 'Quite a bit'], ['high', 'A lot']) }, null,
    { value: state.weights[category.id] ?? null, ariaLabel: `Importance of ${category.label}`, onValueChange: (value) => { state.weights[category.id] = value; store(); } });
  importance.append(weight.list); optionPanel.append(heading, choice.list, importance);
}

function update() {
  scoreValue.textContent = `${score()} / 11`; scoreValue.setAttribute('aria-label', `Buddy understanding ${score()} out of 11`);
  [...meter.children].forEach((segment, i) => segment.classList.toggle('is-filled', i < score()));
  toggle.input.checked = state.same;
  modeNote.textContent = state.same ? 'Your current car leads. Your other choices are kept.' : 'Love your current car? Let it guide your next one.';
  categories.classList.toggle('is-disabled', state.same);
  for (const category of CATEGORIES) {
    const nodes = categoryNodes.get(category.id); const selected = state.values[category.id];
    const values = Array.isArray(selected) ? selected : selected === undefined ? [] : [selected];
    const considered = values.length > 0;
    nodes.root.classList.toggle('is-considered', considered); nodes.root.classList.toggle('is-open', openCategory === category.id);
    nodes.open.disabled = state.same; nodes.remove.disabled = state.same;
    nodes.open.setAttribute('aria-expanded', String(openCategory === category.id && !state.same));
    nodes.open.setAttribute('aria-label', `${category.label}${considered ? ', considered' : ''}`);
    nodes.value.textContent = considered ? values.map((v) => category.options.find((o) => o.value === v)?.label).join(', ') : 'Choose';
    nodes.remove.hidden = !considered;
  }
  removal.replaceChildren(); removal.hidden = !pendingRemoval || state.same;
  if (pendingRemoval && !state.same) {
    const category = CATEGORIES.find((c) => c.id === pendingRemoval);
    const prompt = el('p', '', `Remove your ${category.label.toLowerCase()} preference?`); prompt.id = 'remove-title';
    const actions = el('div', 'gcsp-actions');
    actions.append(button({ label: 'Keep it', variant: 'ghost', onClick: () => { pendingRemoval = null; update(); categoryNodes.get(category.id).remove.focus(); } }),
      button({ label: 'Remove preference', variant: 'ghost', onClick: () => { delete state.values[category.id]; delete state.weights[category.id]; pendingRemoval = null; update(); store(); say(`${category.label} preference removed.`); categoryNodes.get(category.id).open.focus(); } }));
    removal.append(prompt, actions);
  }
  if (!message.textContent || /categor(?:y|ies) considered/.test(message.textContent)) message.textContent = state.same ? 'Your buddy understands: more like your current car.' : count() >= 3 ? `${count()} categories considered · Ready to save` : `${count()} of 3 categories considered`;
}

const secondary = el('div', 'concept-secondary');
for (const [title, rows] of [
  ['Employee and contact details', [{ label: 'Name', value: account.name }, { label: 'Email', value: account.contact.email }, { label: 'Employee number', value: account.employeeNumber }]],
  ['Drivers and licences', [{ label: 'Employee', value: account.name }, { label: 'Additional driver', value: 'Casey Ward' }]],
  ['Order history', [{ label: 'Previous car', value: 'BMW 1 Series 118i M Sport' }, { label: 'Scheme', value: 'BMW Choices' }]],
]) {
  const disclosure = el('details', 'gcsp-details'); disclosure.append(el('summary', 'gcsp-details-summary', title), factList(rows)); secondary.append(disclosure);
}
page.append(pageHead, car, preferences, secondary); shell.main.replaceChildren(page); renderOptions(); update();
window.addEventListener('pagehide', () => shell.destroy(), { once: true });
