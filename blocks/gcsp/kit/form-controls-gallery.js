import { el, button, factList } from '../../vehicle-matcher/ui.js';
import { renderOptionList } from '../../vehicle-matcher/modes/question-ui.js';
import { labelledField, errorSummary, checkboxField } from './form-controls.js';
import { categoryPreferences, preferenceCategories } from './category-preferences.js';
import { understandingMeter } from './understanding-meter.js';
import { stageList } from './stage-list.js';
import { rangeBar } from './range-bar.js';
import { showMore } from './show-more.js';
import { tabs } from './tabs.js';
import { notificationBell } from './notification-bell.js';
import { sideDrawer } from './side-drawer.js';
import { notificationModel } from '../activity/notification-source.js';
import { releaseGrid } from './release-grid.js';
import { loadingSkeleton } from './loading-skeleton.js';
import { installArrivalFocus, focusHeading } from './arrival-focus.js';
import { runRestartedScreen, runRestartedNotice, accessLapsedScreen } from './run-restarted.js';

export function formControlsExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-form-controls';
  section.append(el('h2', 'vm-gallery-title', 'GCSP native forms'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  const control = el('input', ''); control.type = 'date';
  const field = labelledField({ id: 'gallery-requested-date', label: 'Requested collection date', control,
    hint: 'A requested date, not a confirmed appointment.' });
  const summary = errorSummary({ id: 'gallery-form-errors', errors: [] });
  const validate = button({ label: 'Show validation example', onClick: () => {
    field.setError('Choose a permitted date.');
    summary.update([{ id: control.id, message: 'Choose a permitted date.' }]); summary.focus();
  } });
  const reset = button({ label: 'Clear validation example', variant: 'ghost', onClick: () => { field.setError(''); summary.update([]); } });
  const declaration = checkboxField({ id: 'gallery-declaration', label: 'The nominated driver and licence details are correct.' });
  const sw = checkboxField({ id: 'gallery-switch', label: 'This is really important', switch: true });
  const off = checkboxField({ id: 'gallery-switch-off', label: 'Unavailable until a choice is made', switch: true, disabled: true });
  const reasons = renderOptionList({ id: 'gallery-fixed-reason', label: 'Fixed reason radio rows', options: [{ value: 'one', label: 'First supplied reason' }, { value: 'two', label: 'Second supplied reason with a longer label' }] }, null, { value: null, variant: 'rows', onValueChange() {} });
  const openDrawer = button({ label: 'Open shared drawer example', variant: 'ghost', onClick: () => {
    let drawer; const keep = button({ label: 'Keep reviewing', variant: 'ghost', onClick: () => drawer.close() });
    drawer = sideDrawer({ host: scope, context: 'Shared record review', title: 'Review your details', opener: openDrawer,
      body: [el('p', 'gcsp-note', 'The background is contained while you review. Tab stays in this panel; Escape returns to its opener.')], footer: [keep] });
  } });
  body.append(summary.root, field.root, declaration.root, sw.root, off.root, reasons.list, validate, reset, openDrawer); scope.append(body); section.append(scope); return section;
}

export function stageListExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-stage-list';
  section.append(el('h2', 'vm-gallery-title', 'GCSP stage list'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  const sets = [['Acknowledged', [['selection received', 'complete'], ['HR approval', 'waiting'], ['sales-manager approval', 'not-started']]],
    ['Sending', [['selection received', 'pending'], ['sales-manager approval', 'not-started']]],
    ['Not accepted', [['selection received', 'failed'], ['sales-manager approval', 'not-started']]]];
  for (const [heading, stages] of sets) body.append(stageList({ heading, level: 3, stages: stages.map(([name, state]) => ({ name, state })) }));
  scope.append(body); section.append(scope); return section;
}

export function rangeBarExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-range-bar';
  section.append(el('h2', 'vm-gallery-title', 'Range bar'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm'); const share = (value) => `${Math.round(value * 100)}%`;
  body.append(
    rangeBar({ label: 'Coverage before renewal', format: share, scale: { min: 0, max: 1 }, rows: [
      { label: "Today's release route", mean: 0.62, min: 0.58, max: 0.66 },
      { label: 'Buddy route', mean: 0.74, min: 0.70, max: 0.79 }] }),
    rangeBar({ label: 'Retries before release', rows: [
      { label: "Today's release route", mean: 12, min: 9, max: 15 },
      { label: 'Buddy route', mean: 10, min: 8, max: 14 }] }),
    rangeBar({ label: 'Fit of accepted cars', format: share, scale: { min: 0, max: 1 }, rows: [
      { label: "Today's release route", mean: 0.81, min: 0.77, max: 0.86 },
      { label: 'Buddy route', mean: null, min: null, max: null }] }));
  scope.append(body); section.append(scope); return section;
}

export function runRestartedExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-run-restarted';
  section.append(el('h2', 'vm-gallery-title', 'GCSP demo restarted'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm');
  body.append(runRestartedScreen({ reload: () => {} }), runRestartedNotice({ reload: () => {} }).root, accessLapsedScreen());
  scope.append(body); section.append(scope); return section;
}

export function showMoreExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-show-more';
  section.append(el('h2', 'vm-gallery-title', 'GCSP show more and narrow values'));
  const scope = el('div', 'gcsp'); const body = el('div', 'vm'); const list = el('ul', ''); const total = 14; const page = 5; let limit = page;
  const paging = showMore({ onShowMore() { const first = limit; limit += page; draw(); list.children[first]?.focus(); } });
  function draw() {
    list.replaceChildren(...Array.from({ length: Math.min(limit, total) }, (_, i) => { const row = el('li', '', `Example car ${i + 1}`); row.tabIndex = -1; return row; }));
    paging.update({ shown: Math.min(limit, total), total });
  }
  draw();
  body.append(list, paging.root, factList([{ label: 'Contact email', value: 'employee-paula@example.invalid' }, { label: 'Licence number', value: 'FICTIONAL-NOMINEE' },
    { label: 'Collection point', value: 'Fictional collection centre' }, { label: 'Requested collection date', value: '13 November 2026' }]));
  scope.append(body); section.append(scope); return section;
}

export function arrivalFocusExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-arrival-focus';
  section.append(el('h2', 'vm-gallery-title', 'GCSP arrival focus'));
  const scope = el('div', 'gcsp'); const main = el('main', 'gcsp-main'); main.append(el('h1', 'vm-title', 'Page heading'));
  const note = el('p', 'gcsp-note', 'Move focus to the heading with the button. A pointer click shows no ring; press Tab first and it shows.');
  const move = button({ label: 'Move focus to the heading', variant: 'ghost', onClick: () => focusHeading(main.querySelector('h1')) });
  main.append(note, move); scope.append(main); section.append(scope);
  installArrivalFocus({ root: scope, main });
  return section;
}

export function tabsExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-tabs';
  section.append(el('h2', 'vm-gallery-title', 'GCSP tabs'));
  const scope = el('div', 'gcsp'); const panel = (text) => { const node = el('div'); node.append(el('p', 'gcsp-note', text)); return node; };
  const set = tabs({ label: 'Settings groups', items: [{ id: 'one', label: 'First', panel: panel('First panel. Arrow keys, Home and End move between tabs.') },
    { id: 'two', label: 'Second', panel: panel('Second panel.') }, { id: 'three', label: 'Third', panel: panel('Third panel.') }] });
  scope.append(set.root); section.append(scope); return section;
}

const BELL_CAR = { offerRef: { offerId: 'gallery-1' }, title: 'BMW i5 Touring eDrive40, Sophisto Grey',
  images: [{ src: '/assets/gcsp-vehicle-evidence/00419fa06ad620a42de6311039c7df679f692b7f2af52d5a7daba46cd034dc93.webp', alt: 'Front three quarters', fidelity: 'representative-configuration' }] };
const BELL_CHANGE = { eventId: 'gallery-e1', operation: 'confirmed', occurredAt: '2026-11-10T09:12:00.000Z' };
const bellOffer = (state) => ({ offerRef: { offerId: 'gallery-1' }, state, version: 1, createdAt: '2026-11-10T09:30:00.000Z',
  expiresAt: '2026-11-10T16:40:00.000Z', href: '/gcsp-offer.html' });

export function notificationBellExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-notification-bell';
  section.append(el('h2', 'vm-gallery-title', 'GCSP notification bell'));
  const activity = (state) => ({ currentOffer: bellOffer(state), offers: [bellOffer(state)], stateChanges: [BELL_CHANGE] });
  const states = [['None waiting', { ...notificationModel(activity('accepted'), BELL_CAR), waiting: 0, rows: [] }, false],
    ['One car offer waiting', notificationModel(activity('active'), BELL_CAR), false],
    ['New offer note', { ...notificationModel(activity('active'), BELL_CAR), note: { id: 'gallery-note', title: 'Your buddy found a car', text: 'BMW i5 Touring. Respond by 16:40.' } }, false],
    ['Open, offer waiting', notificationModel(activity('active'), BELL_CAR), true],
    ['Open, nothing waiting', notificationModel(activity('accepted'), BELL_CAR), true],
    ['Open, unavailable', { status: 'unavailable', waiting: 0, rows: [] }, true]];
  for (const [label, model, open] of states) {
    const scope = el('div', 'gcsp'); scope.style.minHeight = '0'; const frame = el('div', ''); frame.style.cssText = `display: flex; align-items: flex-start; justify-content: flex-end; padding: 8px 24px; min-height: ${open ? 400 : 120}px`;
    const bell = notificationBell({ pinned: open, schedule: () => 0, cancel() {} }); frame.append(bell.root); scope.append(el('p', 'gcsp-note', label), frame);
    bell.update(model); if (open) bell.open(); section.append(scope);
  }
  return section;
}

const RELEASE_CARS = [
  ['07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp', '3 Series Touring', 'Alpine White'],
  ['ed60cefd049e7293423575b5f0fcee802dbab14083dea2480211ab272896281a.webp', '1 Series Sports Hatch', 'BMW Individual Frozen Pure Grey'],
  ['00419fa06ad620a42de6311039c7df679f692b7f2af52d5a7daba46cd034dc93.webp', 'i5 Touring', 'Sophisto Grey'],
  ['719a549c1b6019c31850059f4331754756168ac4cc88c4513679fcae8bf6fc72.webp', '1 Series Sports Hatch', 'Cape York Green'],
  ['89f72e0b5dd9b487f22164a9321d5c03f7762ffd8e15adc18e11a77ab755adfc.webp', '1 Series Sports Hatch', 'Alpine White'],
  ['4489e430feeb042f1786c5b4ddc86ef1540a4d0eb960c4cf0faaa83b968a6f22.webp', '1 Series Sports Hatch', 'Jet Black'],
  ['1b01d4a62fa0d1ffa153371d38fdeac84adbbc674227dd1b853c3af8306ef027.webp', '1 Series Sports Hatch', 'Thundernight'],
  ['d3245036c6bbd7f1fa324be738862422605095735dd3ec6a4fa175ffafaa6976.webp', '1 Series Sports Hatch', 'BMW Individual Frozen Portimao Blue'],
  ['ae3c7e57cb59a0d97040263751763f2323876109501abfb8f3d64a9f518e7306.webp', '1 Series Sports Hatch', 'Black Sapphire'],
  ['44056f6b4aca840e77ed3ba3a1eda63d2056af2ec9ce3832bbdd76d59085db47.webp', '1 Series Sports Hatch', 'Brooklyn Grey'],
  ['8a391dd4cc66221e1cd4259784215122f5b862c30e7a315c27a3991870dfc2b3.webp', '1 Series Sports Hatch', 'Skyscraper Grey'],
  ['5ce2febb1d0c3b7409caed6a1001ae9cce69cc9466760d47b23f284dcdaee3d3.webp', '1 Series Sports Hatch', 'Storm Bay'],
];

export function releaseGridExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-release-grid';
  section.append(el('h2', 'vm-gallery-title', 'GCSP release grid'));
  const scope = el('div', 'gcsp'); const grid = releaseGrid({ label: 'Released cars', columns: 6 });
  const tiles = RELEASE_CARS.map(([hash, model, paint], at) => ({ id: at, imageSrc: `./assets/gcsp-vehicle-evidence/${hash}`, label: `${model}, ${paint}` }));
  const replay = button({ label: 'Replay', variant: 'ghost', onClick: () => grid.show(tiles) });
  const row = el('p'); row.append(replay); scope.append(row, grid.root); section.append(scope); grid.show(tiles, { animate: false }); return section;
}

export function releaseSkeletonExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-release-skeletons';
  section.append(el('h2', 'vm-gallery-title', 'GCSP release skeletons'));
  const scope = el('div', 'gcsp');
  scope.append(loadingSkeleton({ layout: 'release-grid', role: null }), el('h3', '', 'Release totals'),
    loadingSkeleton({ layout: 'stats', labels: ['Latest release', 'Total released', 'Unallocated', 'Buddy Allocated', 'Manually Allocated'], role: null }),
    el('h3', '', 'Latest release stats'), loadingSkeleton({ layout: 'bars', role: null }));
  section.append(scope); return section;
}

const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const stops = (...labels) => labels.map((label, at) => ({ value: at * 50, label }));
const PREFERENCE_CATEGORIES = preferenceCategories({ order: ['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size'], categories: {
  body: { label: 'Body', question: 'Which body styles feel right?', kind: 'multi', options: opts(['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Touring / Estate'], ['suv', 'SUV'], ['coupe', 'Coupé'], ['convertible', 'Convertible'], ['mpv', 'MPV']) },
  fuel: { label: 'Fuel', question: 'What would you like to drive?', kind: 'multi', options: opts(['petrol', 'Petrol'], ['diesel', 'Diesel'], ['phev', 'Plug-in hybrid'], ['ev', 'Electric']) },
  sportiness: { label: 'Sportiness', question: 'How do you like your car to feel?', kind: 'stops', openDefault: 50, stops: stops('Relaxed', 'A bit of both', 'Sporty') },
  comfort: { label: 'Comfort', question: 'How much comfort would you like?', kind: 'stops', openDefault: 50, stops: stops('Simple and functional', 'A bit of both', 'As comfortable as possible') },
  economy: { label: 'Economy', question: 'Where would you put the balance?', kind: 'stops', openDefault: 50, stops: stops('Driving comes first', 'A bit of both', 'Economy comes first') },
  size: { label: 'Size', question: 'What size works for your life?', kind: 'stops', openDefault: 50, stops: stops('Compact', 'A bit of both', 'Spacious') } } });
const considered = (value, importance = 'medium') => ({ state: 'considered', value, importance });
const PREFERENCE_SAMPLE = { body: considered(['estate']), fuel: considered(['petrol']), comfort: considered(100) };

export function categoryPreferencesExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-category-preferences';
  section.append(el('h2', 'vm-gallery-title', 'GCSP category preferences'));
  const states = [['Empty', {}, null], ['Selected', PREFERENCE_SAMPLE, null], ['Open, nothing chosen', {}, 'sportiness'],
    ['Open, medium importance', PREFERENCE_SAMPLE, 'body'], ['Open, really important', { ...PREFERENCE_SAMPLE, body: considered(['estate'], 'high') }, 'body'],
    ['Slider at the midpoint', { ...PREFERENCE_SAMPLE, comfort: considered(50) }, 'comfort'], ['Remove confirmation', PREFERENCE_SAMPLE, null, 'comfort'],
    ['Save failed', PREFERENCE_SAMPLE, null, null, { kind: 'failed', text: 'Your changes were not saved.', actionLabel: 'Try again' }]];
  states.forEach(([label, initial, open, pendingRemoval = null, status = { kind: 'saved', text: 'Preferences saved automatically.' }], at) => {
    const scope = el('div', 'gcsp'); const body = el('div', 'vm'); let current = { categories: structuredClone(initial), open, pendingRemoval, disabled: false, status };
    const patch = (next) => { current = { ...current, ...next }; view.update(current); };
    const view = categoryPreferences({ id: `gallery-prefs-${at}`, categories: PREFERENCE_CATEGORIES, state: current,
      onOpen: (key) => patch({ open: current.open === key ? null : key, pendingRemoval: null }),
      onChange: (key, change) => { const entry = current.categories[key] ?? { state: 'considered', importance: 'medium' };
        patch({ categories: { ...current.categories, [key]: { ...entry, state: 'considered', ...change } } }); },
      onRemove: (key) => patch({ pendingRemoval: key, open: null }), onKeep: () => patch({ pendingRemoval: null }), onClose: () => patch({ open: null }),
      onConfirmRemove: (key) => { const next = { ...current.categories }; delete next[key]; patch({ categories: next, pendingRemoval: null }); view.focusCategory(key); },
      onStatusAction: () => patch({ status: { kind: 'saved', text: 'Preferences saved automatically.' } }) });
    body.append(el('p', 'gcsp-note', label), view.root); scope.append(body); section.append(scope);
  });
  return section;
}

export function sameAgainExample() {
  const section = el('section', 'vm-gallery-section'); section.id = 'gcsp-same-again';
  section.append(el('h2', 'vm-gallery-title', 'GCSP understanding meter and Same again'));
  const row = el('div', 'gcsp'); const strip = el('div', 'vm'); strip.style.display = 'grid'; strip.style.gap = '16px';
  [[1, false], [6, false], [6, true], [11, false]].forEach(([value, pending], at) => strip.append(understandingMeter({ id: `gallery-meter-${at}`, value, maximum: 11, pending }).root));
  row.append(strip); section.append(row);
  const description = 'BMW 3 Series 330e xDrive M Sport Pro Touring';
  const high = { ...PREFERENCE_SAMPLE, body: considered(['estate'], 'high') };
  const states = [['Same again off, 1 of 11', { categories: {}, understanding: { value: 1, maximum: 11 }, sameAgain: { on: false } }],
    ['Same again off, 6 of 11', { categories: high, understanding: { value: 6, maximum: 11 }, sameAgain: { on: false } }],
    ['Same again on, choices kept', { categories: high, understanding: { value: 11, maximum: 11 }, sameAgain: { on: true } }],
    ['Same again unavailable', { categories: PREFERENCE_SAMPLE, understanding: { value: 3, maximum: 11 }, sameAgain: { on: false, available: false, reason: 'no-current-car' } }],
    ['Same again help open', { categories: PREFERENCE_SAMPLE, understanding: { value: 3, maximum: 11 }, sameAgain: { on: false } }, true]];
  states.forEach(([label, extra, helpOpen], at) => {
    const scope = el('div', 'gcsp'); const body = el('div', 'vm');
    let current = { categories: {}, open: null, pendingRemoval: null, disabled: false, status: { kind: 'idle', text: '' }, ...extra };
    const view = categoryPreferences({ id: `gallery-same-${at}`, categories: PREFERENCE_CATEGORIES, state: current, understanding: { maximum: 11 },
      sameAgain: { description, onToggle: (on) => { current = { ...current, sameAgain: { ...current.sameAgain, on }, understanding: { ...current.understanding, value: on ? 11 : 6 } }; view.update(current); } } });
    body.append(el('p', 'gcsp-note', label), view.root); scope.append(body); section.append(scope);
    if (helpOpen) view.root.querySelector('.gcsp-help-tip').hidden = false;
  });
  return section;
}
