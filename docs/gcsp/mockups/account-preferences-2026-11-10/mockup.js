// Discussion artifact only. Reuses the application kit; never calls an application API.
import { el, screenIntro, button, factList } from '../../../../blocks/vehicle-matcher/ui.js';
import { mediaWell } from '../../../../blocks/vehicle-matcher/modes/result-card.js';
import { renderOptionList, renderRangeSlider } from '../../../../blocks/vehicle-matcher/modes/question-ui.js';
import { portalShell, svgIcon } from '../../../../blocks/gcsp/shell/portal-shell.js';
import { PORTAL_NAVIGATION } from '../../../../blocks/gcsp/employee/portal-navigation.js';
import { checkboxField } from '../../../../blocks/gcsp/kit/form-controls.js';
import { ACCOUNT_SNAPSHOT } from '../../../../blocks/gcsp/account/fixtures.js';

const KEY = 'gcsp:account-preferences-discussion:2026-11-10:v1';
const mode = new URL(location.href).searchParams.get('state');
const EMPTY = { values: {}, weights: {}, same: false, rating: 0, engaged: false };
const SELECTED = { values: { body: 'estate', fuel: 'petrol', comfort: '100' }, weights: {}, same: false, rating: 4, engaged: false };
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
  info: ['M12 16v-4', 'M12 8h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
};
const options = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const CATEGORIES = [
  { id: 'body', label: 'Body', question: 'Which body styles feel right?', multi: true,
    options: options(['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Touring / Estate'], ['suv', 'SUV'], ['coupe', 'Coupé'], ['convertible', 'Convertible'], ['mpv', 'MPV']) },
  { id: 'fuel', label: 'Fuel', question: 'What would you like to drive?', multi: true,
    options: options(['petrol', 'Petrol'], ['diesel', 'Diesel'], ['phev', 'Plug-in hybrid'], ['ev', 'Electric']) },
  { id: 'sportiness', label: 'Sportiness', question: 'How do you like your car to feel?',
    options: options(['0', 'Relaxed'], ['50', 'A bit of both'], ['100', 'Sporty']) },
  { id: 'comfort', label: 'Comfort', question: 'How much comfort would you like?',
    options: options(['0', 'Simple and functional'], ['50', 'A bit of both'], ['100', 'As comfortable as possible']) },
  { id: 'economy', label: 'Economy', question: 'Where would you put the balance?',
    options: options(['0', 'Driving comes first'], ['50', 'A bit of both'], ['100', 'Economy comes first']) },
  { id: 'size', label: 'Size', question: 'What size works for your life?',
    options: options(['0', 'Compact'], ['50', 'A bit of both'], ['100', 'Spacious']) },
];

// No selected preference means no importance. Chosen preferences default to medium.
const preferenceWeights = (values, weights) => Object.fromEntries(Object.keys(values)
  .map((id) => [id, weights?.[id] === 'high' ? 'high' : 'medium']));

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
  const weights = preferenceWeights(values, value.weights);
  return { values, weights, same: value.same === true, rating: Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5 ? value.rating : 0,
    engaged: value.engaged === true && (value.same === true || Object.keys(values).length >= 3) };
}

let state;
try { state = validState(JSON.parse(localStorage.getItem(KEY))); } catch { state = structuredClone(EMPTY); }
if (mode === 'empty') state = structuredClone(EMPTY);
if (['selected', 'long', 'missing', 'same', 'engaged'].includes(mode)) state = validState(SELECTED);
if (mode === 'same') state.same = true;
if (mode === 'engaged') state.engaged = true;
let openCategory = null;
let pendingRemoval = null;
const categoryNodes = new Map();
const contract = ACCOUNT_SNAPSHOT.value.contracts[0];
const account = ACCOUNT_SNAPSHOT.value.account;
const modelName = mode === 'long' ? 'BMW 3 Series 330e xDrive M Sport Pro Touring' : 'BMW 3 Series Touring';
const specification = mode === 'long' ? 'M Sport Pro · Plug-in hybrid · BMW Individual specification' : '320i M Sport · Petrol';
const currentCarDescription = `${modelName} ${specification}`;

// Discussion-only composition around native controls; no tooltip primitive exists in the kit.
function attachTooltip({ root, triggers, id, text, className = '' }) {
  const tip = el('p', `concept-tooltip ${className}`, text); tip.id = id;
  tip.setAttribute('role', 'tooltip'); tip.hidden = true; root.append(tip);
  const show = () => { tip.hidden = false; };
  const hide = () => { tip.hidden = true; };
  for (const trigger of triggers) {
    const descriptions = new Set((trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
    descriptions.add(id); trigger.setAttribute('aria-describedby', [...descriptions].join(' '));
    trigger.addEventListener('pointerenter', show); trigger.addEventListener('focus', show);
    trigger.addEventListener('click', show);
  }
  tip.addEventListener('pointerenter', show);
  root.addEventListener('pointerleave', () => { if (!triggers.includes(document.activeElement)) hide(); });
  root.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget) && !root.matches(':hover')) hide(); });
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  const outside = (event) => { if (!root.contains(event.target)) hide(); };
  document.addEventListener('pointerdown', outside);
  window.addEventListener('pagehide', () => document.removeEventListener('pointerdown', outside), { once: true });
  return tip;
}
const say = (text) => { message.textContent = text; message.classList.remove('is-error'); };
const count = () => Object.keys(state.values).length;
// Illustrative input completeness, not a model-confidence calculation. See README.
const score = () => state.same ? 11 : [1, 3, 4, 6, 7, 9, 10][count()];
const store = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch { say('Your changes could not be saved. Check your browser storage.'); message.classList.add('is-error'); return false; }
};
const savePreferences = (confirmation = 'Preferences saved automatically.') => {
  state.weights = preferenceWeights(state.values, state.weights);
  const mustDisengage = state.engaged && !state.same && count() < 3;
  if (mustDisengage) state.engaged = false;
  update();
  if (store()) say(mustDisengage ? 'Preferences saved. Buddy disengaged: choose at least 3 categories to engage again.' : confirmation);
};

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
const buddyStatus = el('p', 'concept-buddy-status'); buddyStatus.id = 'buddy-status'; buddyStatus.setAttribute('role', 'status'); buddyStatus.setAttribute('aria-atomic', 'true');
const buddyLamp = el('span', 'concept-buddy-lamp'); buddyLamp.setAttribute('aria-hidden', 'true');
const buddyStatusText = el('span'); buddyStatus.append(buddyLamp, buddyStatusText);
pageHead.append(intro, buddyStatus);

const car = el('section', 'concept-car'); car.setAttribute('aria-labelledby', 'current-car-title');
const photo = el('div', 'concept-photo');
const { media } = mediaWell({ name: contract.model, photo: mode === 'missing' ? '' : contract.media.src,
  alt: 'BMW 3 Series Touring', caption: '' }, 'gcsp-media', { placeholder: 'No image available for your car' });
photo.append(media);

const rating = el('div', 'concept-rating');
const ratingGroup = el('fieldset');
ratingGroup.append(el('legend', '', `How highly do you rate your ${currentCarDescription}?`));
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
ratingGroup.append(stars, ratingCaption); rating.append(ratingGroup); media.append(rating); updateRating();
attachTooltip({ root: rating, triggers: labels.map((label) => label.querySelector('input')), id: 'rating-help',
  text: `How highly do you rate your ${currentCarDescription}?`, className: 'concept-rating-tooltip' });
const carCopy = el('div', 'concept-car-copy');
const carTitle = el('h2', 'concept-car-title', modelName);
carTitle.id = 'current-car-title'; carTitle.append(el('span', '', specification));
const details = el('details', 'gcsp-details'); details.append(el('summary', 'gcsp-details-summary', 'Order, collection and vehicle details'),
  factList([{ label: 'Car order number', value: contract.orderNumber ?? '8074261' }, { label: 'Annual mileage', value: 12000, unit: 'mi/year' }, { label: 'Collected', value: '1 June 2026' }]));
carCopy.append(carTitle, el('p', 'gcsp-countdown', 'Contract ends in 21 days · 1 December 2026'),
  factList([{ label: 'Status', value: 'Current car' }, { label: 'Driver', value: account.name },
    { label: 'Contract end', value: '1 December 2026' }, { label: 'Term', value: 6, unit: 'months' },
    { label: 'Annual mileage', value: 12000, unit: 'mi/year' }, { label: 'Scheme', value: 'BMW Choices' },
    { label: 'Registration', value: contract.registration ?? null, missingLabel: 'Not supplied' }, { label: 'Current mileage', value: 5200, unit: 'mi' },
    { label: 'Points cost', value: '1,100 / 1,300', unit: 'points per month' }]), details);
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
  onChange: (same) => { state.same = same; openCategory = null; pendingRemoval = null; renderOptions(); savePreferences(); } });
toggle.root.classList.add('concept-switch');
toggle.root.classList.add('concept-same-switch'); toggle.input.setAttribute('role', 'switch');
const sameInfo = button({ label: '', variant: 'ghost' }); sameInfo.classList.add('concept-info-button');
sameInfo.setAttribute('aria-label', 'About Same again, please!'); sameInfo.append(svgIcon(ICONS.info));
const sameLabel = toggle.root.querySelector('label');
toggle.root.replaceChildren(sameLabel, sameInfo, toggle.input);
const sameHelp = attachTooltip({ root: toggle.root, triggers: [sameInfo], id: 'same-again-help',
  text: `Select this option if you just love everything about your current car, and your next best car would be another ${currentCarDescription}`,
  className: 'concept-same-tooltip' });
toggle.input.setAttribute('aria-describedby', sameHelp.id);
modeRow.append(toggle.root);

const categories = el('div', 'concept-categories');
for (const category of CATEGORIES) {
  const root = el('div', 'concept-category'); const open = el('button', 'concept-category-open'); open.type = 'button';
  open.id = `category-${category.id}`; open.setAttribute('aria-controls', 'category-options');
  const top = el('span', 'concept-category-top'); top.append(svgIcon(ICONS[category.id]), el('span', '', category.label));
  const value = el('span', 'concept-category-value', 'Choose');
  open.append(top, value);
  open.addEventListener('click', () => {
    openCategory = openCategory === category.id ? null : category.id; pendingRemoval = null;
    const selectDefault = openCategory && !category.multi && state.values[category.id] === undefined;
    if (selectDefault) state.values[category.id] = '50';
    say(''); renderOptions();
    if (selectDefault) savePreferences(); else update();
  });
  const remove = el('button', 'concept-category-remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${category.label} preference`); remove.append(svgIcon(ICONS.bin));
  remove.addEventListener('click', () => { pendingRemoval = category.id; openCategory = null; renderOptions(); update(); removal.querySelector('button').focus(); });
  root.append(open, remove); categories.append(root); categoryNodes.set(category.id, { root, open, value, remove });
}
const optionPanel = el('div', 'concept-option-panel'); optionPanel.id = 'category-options';
const removal = el('div', 'concept-removal'); removal.setAttribute('role', 'group'); removal.setAttribute('aria-labelledby', 'remove-title');
const foot = el('div', 'concept-foot');
const message = el('p', 'concept-save-message'); message.id = 'preference-status'; message.setAttribute('role', 'status');
const buddyAction = button({ label: 'Engage Buddy', variant: 'primary', onClick: () => {
  if (!state.engaged && !state.same && count() < 3) {
    message.textContent = `Choose ${3 - count()} more ${count() === 2 ? 'category' : 'categories'} to engage Buddy. Your preferences save automatically.`;
    message.classList.add('is-error'); message.tabIndex = -1; message.focus(); return;
  }
  state.engaged = !state.engaged;
  if (store()) say(state.engaged ? 'Buddy engaged. Your preferences will guide the search.' : 'Buddy disengaged. Your preferences are kept.');
  else state.engaged = !state.engaged;
  update();
} });
buddyAction.setAttribute('aria-describedby', `${message.id} ${buddyStatus.id}`); foot.append(message, buddyAction);
preferences.append(preferenceHead, modeRow, categories, removal, optionPanel, foot);

function renderOptions() {
  optionPanel.replaceChildren(); optionPanel.hidden = !openCategory || state.same;
  if (!openCategory || state.same) return;
  const category = CATEGORIES.find((c) => c.id === openCategory);
  const heading = el('div', 'concept-option-heading'); const title = el('h3', '', category.question);
  title.id = 'open-category-heading';
  const close = button({ label: 'Done', variant: 'ghost', onClick: () => {
    openCategory = null; renderOptions(); update(); categoryNodes.get(category.id).open.focus();
  } });
  heading.append(title, close);
  const setValue = (value) => {
      if (Array.isArray(value) && !value.length) delete state.values[category.id]; else state.values[category.id] = value;
      savePreferences();
  };
  let choices;
  if (category.multi) {
    const choice = renderOptionList(category, null, { value: state.values[category.id] ?? [], ariaLabel: category.question, onValueChange: setValue });
    choices = choice.list; choices.classList.add('concept-options');
  } else {
    choices = el('div', 'concept-step-slider');
    const labels = el('div', 'concept-slider-labels'); labels.setAttribute('aria-hidden', 'true');
    const value = Number(state.values[category.id] ?? 50);
    const syncLabels = (position) => {
      [...labels.children].forEach((label, i) => label.classList.toggle('is-current', Number(category.options[i].value) === position));
      choices.querySelector('input').setAttribute('aria-valuetext', category.options.find((option) => Number(option.value) === position).label);
    };
    renderRangeSlider(choices, { id: category.id, min: 0, max: 100, step: 50, default: 50 }, null,
      { single: true, value, ariaLabel: category.question, onValueChange: (position) => { setValue(String(position)); syncLabels(position); } });
    choices.querySelector('.vm-slider-value').hidden = true;
    choices.querySelector('.vm-slider-bounds').hidden = true;
    category.options.forEach((option) => labels.append(el('span', '', option.label)));
    choices.append(labels); syncLabels(value);
  }
  const importance = el('div', 'concept-importance');
  const weight = checkboxField({ id: `importance-${category.id}`, label: 'This is really important',
    checked: state.weights[category.id] === 'high',
    onChange: (important) => { state.weights[category.id] = important ? 'high' : 'medium'; savePreferences(); } });
  weight.root.classList.add('concept-switch'); weight.input.setAttribute('role', 'switch');
  const hint = el('p', 'gcsp-note concept-importance-hint', 'Choose a preference first.'); hint.id = 'importance-hint';
  importance.append(weight.root, hint); optionPanel.append(heading, choices, importance);
}

function update() {
  buddyStatus.classList.toggle('is-engaged', state.engaged);
  buddyStatusText.textContent = state.engaged ? 'Buddy engaged' : 'Buddy disengaged';
  buddyAction.textContent = state.engaged ? 'Disengage Buddy' : 'Engage Buddy';
  scoreValue.textContent = `${score()} / 11`; scoreValue.setAttribute('aria-label', `Buddy understanding ${score()} out of 11`);
  [...meter.children].forEach((segment, i) => segment.classList.toggle('is-filled', i < score()));
  toggle.input.checked = state.same;
  categories.classList.toggle('is-disabled', state.same);
  optionPanel.classList.toggle('is-important', !state.same && state.values[openCategory] !== undefined && state.weights[openCategory] === 'high');
  const importanceInput = optionPanel.querySelector('[role="switch"]');
  if (importanceInput) {
    const considered = state.values[openCategory] !== undefined;
    importanceInput.disabled = !considered || state.same;
    importanceInput.checked = considered && state.weights[openCategory] === 'high';
    optionPanel.querySelector('.concept-importance-hint').hidden = considered;
    if (considered) importanceInput.removeAttribute('aria-describedby');
    else importanceInput.setAttribute('aria-describedby', 'importance-hint');
  }
  for (const category of CATEGORIES) {
    const nodes = categoryNodes.get(category.id); const selected = state.values[category.id];
    const values = Array.isArray(selected) ? selected : selected === undefined ? [] : [selected];
    const considered = values.length > 0;
    const important = considered && state.weights[category.id] === 'high' && !state.same;
    nodes.root.classList.toggle('is-considered', considered); nodes.root.classList.toggle('is-open', openCategory === category.id);
    nodes.root.classList.toggle('is-important', important);
    nodes.open.disabled = state.same; nodes.remove.disabled = state.same;
    nodes.open.setAttribute('aria-expanded', String(openCategory === category.id && !state.same));
    nodes.value.textContent = considered ? values.map((v) => category.options.find((o) => o.value === v)?.label).join(', ') : 'Choose';
    nodes.open.setAttribute('aria-label', `${category.label}, ${considered ? `considered: ${nodes.value.textContent}${important ? ', really important' : ''}` : 'choose a preference'}`);
    nodes.remove.hidden = !considered;
  }
  removal.replaceChildren(); removal.hidden = !pendingRemoval || state.same;
  if (pendingRemoval && !state.same) {
    const category = CATEGORIES.find((c) => c.id === pendingRemoval);
    const prompt = el('p', '', `Remove your ${category.label.toLowerCase()} preference?`); prompt.id = 'remove-title';
    const actions = el('div', 'gcsp-actions');
    actions.append(button({ label: 'Keep it', variant: 'ghost', onClick: () => { pendingRemoval = null; update(); categoryNodes.get(category.id).remove.focus(); } }),
      button({ label: 'Remove preference', variant: 'ghost', onClick: () => { delete state.values[category.id]; delete state.weights[category.id]; pendingRemoval = null; savePreferences(`${category.label} preference removed. Saved automatically.`); categoryNodes.get(category.id).open.focus(); } }));
    removal.append(prompt, actions);
  }
  if (!message.textContent || /categor(?:y|ies) considered/.test(message.textContent)) message.textContent = state.same ? 'More like your current car. Preferences save automatically.' : count() >= 3 ? `${count()} categories considered · Saved automatically` : `${count()} of 3 categories considered · Preferences save automatically`;
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
