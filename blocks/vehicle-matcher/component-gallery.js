import { experienceChoice, brandSelector } from '../demo-launcher/components.js';
import { renderOptionList, renderRangeSlider } from './modes/question-ui.js';
import { createPreviewFeed } from './modes/preview-feed.js';
import { employeeCardFixture } from './employee-card-fixture.js';
import { applyBrowseFeedback, applyConfirmedFeedbackChange, createFeedbackState, matchesFeedbackPredicate, reduceFeedback } from './feedback-actions.js';
import { el, screenIntro, button, statusScreen, factList } from './ui.js';
import { feedbackButton, feedbackScope, feedbackUndo, matchCard, mediaWell, previewTile } from './modes/result-card.js';
import { portalShell, accountNavigation } from '../gcsp/shell/portal-shell.js';
import { EMPLOYEE_NAVIGATION } from '../gcsp/employee/gcsp-employee.js';
import { messageList } from '../gcsp/presenter/message-list.js';
import { fixtureMessages } from '../gcsp/presenter/fixtures.js';
import { metricTile } from '../gcsp/kit/metric-tile.js';
import { dataTable } from '../gcsp/kit/data-table.js';

const browseSession = `gallery-${Date.now().toString(36)}`;
let sessionSequence = 0;
const nextId = (kind) => `${kind}:${++sessionSequence}`;

const listing = (id, shade, priceMin, mileage, transmission, features = []) => ({
  id, shade, colour: shade, priceMin, mileage, transmission, features,
  photo: '', link: '#', retailerName: 'Gallery Retailer',
});

const initialPool = [
  {
    score: 88, reasons: [], tradeOffs: [],
    car: {
      id: 'gallery-320i', name: 'BMW 320i Touring', body: 'estate', fuel: 'petrol',
      colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' },
      priceMin: 32000, priceMax: 32000, priceFrom: 29000, priceTo: 32000,
      mileage: 10000, transmission: 'auto', listingCount: 3, features: ['heatedSeats'],
      retailerName: 'Gallery Retailer', distance: null,
    },
    listings: [
      listing('listing-blue', 'Blue', 32000, 10000, 'auto', ['heatedSeats']),
      listing('listing-white', 'White', 29000, 7000, 'auto', ['heatedSeats']),
      listing('listing-black', 'Black', 31000, null, 'manual'),
    ],
  },
  {
    score: 84, reasons: [], tradeOffs: [],
    car: {
      id: 'gallery-118i', name: 'BMW 118i Hatchback', body: 'hatchback', fuel: 'petrol',
      colour: { colour: 'Grey', manufacturerColour: 'Brooklyn Grey' },
      priceMin: 23000, priceMax: 23000, priceFrom: 23000, priceTo: 23000,
      mileage: 9000, transmission: 'auto', listingCount: 1, features: ['parkingCamera'],
      retailerName: 'Gallery Retailer', distance: null,
    },
    listings: [listing('listing-grey', 'Grey', 23000, 9000, 'auto', ['parkingCamera'])],
  },
];

// Display fixtures for R1, whose independent engine regression is in
// exact-listing-decision.test.js. This gallery performs no scoring or writes.
export function exactListingExample({ legacy = false } = {}) {
  const car = { id: 'r1-gallery', name: 'BMW Probe Touring with Individual extended leather and comfort specification',
    line: 'Probe Touring', body: 'estate', fuel: 'petrol', seats: 5, boot: 560,
    transmission: 'auto', priceMin: 30000, priceMax: 30000, priceFrom: 30000, priceTo: 39000,
    photo: '/assets/brand-hero/bmw.jpg', colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' },
    listingCount: 2, features: ['heatedSeats', 'parkingCamera'], colours: ['Portimao Blue', 'Chili Red'],
    mileage: 10000, link: '#r1-blue', retailerName: 'Fictional Gallery Retailer' };
  const first = { score: 96, stretch: false, reasons: ['Within the budget you set'], tradeOffs: [] };
  const second = { score: 87, stretch: true,
    reasons: ['Practical estate space', 'A stretch at £39k+, over the budget you set'], tradeOffs: [] };
  const listings = [{ ...listing('r1-blue', 'Blue', 30000, 10000, 'auto', ['heatedSeats']),
    name: car.name, line: car.line, colour: 'Portimao Blue', photo: car.photo, link: '#r1-blue', decision: first },
  { ...listing('r1-red', 'Red', 39000, 18000, 'manual', ['parkingCamera']),
    name: car.name, line: car.line, colour: 'Chili Red', link: '#r1-red', decision: second }];
  if (legacy) listings.forEach((item) => { delete item.decision; });
  return { car, ...first, listings };
}

function displayName(match) {
  return match.car.name;
}

function gcspExamples() {
  const section = el('section', 'vm-gallery-section vm-gallery-gcsp-section');
  section.setAttribute('aria-label', 'GCSP');
  section.append(
    el('h2', 'vm-gallery-title', 'GCSP'),
    el('p', 'vm-gallery-copy', 'Shared primitives and the portal shell under the scoped GCSP tokens. Synthetic examples only; retail examples above are unchanged.'),
    button({ label: 'Density reference preview', variant: 'ghost', href: './docs/gcsp/density/preview.html' }),
  );
  const scope = el('div', 'gcsp vm-gallery-gcsp');
  const group = (title) => {
    const box = el('div', 'vm-gallery-gcsp-group');
    box.append(el('h3', 'vm-gallery-gcsp-title', title));
    const body = el('div', 'vm vm-gallery-gcsp-body');
    box.append(body);
    scope.append(box);
    return body;
  };
  group('screenIntro').append(screenIntro({ kicker: 'Choices', title: 'Your cars', lede: 'A kicker, a title and a short lede.', level: 3 }));
  const typography = group('Density typography');
  typography.append(
    screenIntro({ title: 'Large page title', lede: 'Regular body text uses the system font.', level: 1 }),
    el('h2', '', 'Smaller heading uses system semibold'),
    el('p', '', 'Labels, navigation and form values use the system font.'),
    el('code', '', 'Plain text uses the Density monospace stack.'),
  );
  const buttons = group('button');
  buttons.append(
    button({ label: 'Primary', variant: 'primary' }),
    button({ label: 'Ghost', variant: 'ghost' }),
    button({ label: 'Disabled', variant: 'primary', disabled: true, describedBy: 'gallery-gcsp-why' }),
    el('span', 'vm-gallery-gcsp-why', 'Disabled actions say why.'),
  );
  buttons.lastChild.id = 'gallery-gcsp-why';
  group('statusScreen').append(statusScreen({ kicker: 'Choices', title: 'Nothing to show', message: 'A status screen explains the state and offers the next step.', actions: [button({ label: 'Try again', variant: 'primary' })] }));
  group('factList').append(factList([
    { label: 'Registration', value: 'SY25 DEM' },
    { label: 'Monthly cost', value: 1100, unit: 'points a month' },
    { label: 'WLTP CO2', value: null },
  ]));
  const well = group('mediaWell placeholder');
  well.append(mediaWell({ name: 'Synthetic car', line: '', photo: '' }, 'vm-gallery-gcsp-media', { placeholder: 'No image for this car yet' }).media);
  const accounts = [
    ['portalShell: account loading', { status: 'loading' }],
    ['portalShell: ready, long name', { status: 'ready', name: 'Bartholomew Featherstonehaugh-Cholmondeley-Wolverstone III (synthetic)', context: 'Choices, grade G7' }],
    ['portalShell: account unavailable', { status: 'unavailable', message: 'Your account could not be loaded.' }],
  ];
  for (const [title, account] of accounts) {
    const frame = el('div', 'vm-gallery-gcsp-frame');
    const shell = portalShell({ navigation: EMPLOYEE_NAVIGATION, active: 'cars', breadcrumbs: ['Your cars'], account });
    shell.main.append(el('p', 'gcsp-note', 'Page content goes here.'));
    frame.append(shell.root);
    group(title).append(frame);
  }
  for (const expanded of [false, true]) {
    const frame = el('div', 'vm-gallery-gcsp-frame vm-gallery-gcsp-nav');
    frame.append(accountNavigation({ items: EMPLOYEE_NAVIGATION, active: 'cars', expanded }).root);
    group(`accountNavigation: ${expanded ? 'expanded' : 'collapsed'}, with unavailable items`).append(frame);
  }
  group('messageList: sent, retrying and failed, first message open').append(messageList({ messages: fixtureMessages(), selectedId: 'job-004' }).root);
  section.append(scope);
  return section;
}

function gregKitExamples() {
  const section = el('section', 'vm-gallery-section vm-gallery-greg-section');
  section.setAttribute('aria-label', 'GCSP Greg kit');
  section.append(
    el('h2', 'vm-gallery-title', 'GCSP Greg kit'),
    el('p', 'vm-gallery-copy', 'Dense operational figures for the Greg dashboard: metricTile and dataTable. A privacy band shows its own text and is never turned into a number. Synthetic examples only.'),
  );
  const scope = el('div', 'gcsp vm-gallery-gcsp');
  const group = (title) => {
    const box = el('div', 'vm-gallery-gcsp-group');
    box.append(el('h3', 'vm-gallery-gcsp-title', title));
    const body = el('div', 'vm vm-gallery-gcsp-body');
    box.append(body);
    scope.append(box);
    return body;
  };
  const tiles = group('metricTile: exact, privacy band and with a note');
  const tileRow = el('div', 'gcsp-tile-row');
  tileRow.append(
    metricTile({ label: 'Active briefs', count: { label: '28', isBand: false }, level: 'headline' }),
    metricTile({ label: 'Declined', count: { label: 'fewer than 5', isBand: true }, note: 'Small counts are banded.' }),
    metricTile({ label: 'Offers made', count: { label: '30', isBand: false }, note: 'Counted once each.', level: 'compact' }),
  );
  tiles.append(tileRow);
  const rows = [
    { name: 'U06 Active Tourer Plug-in Hybrid xDrive25e M Sport Pro with extended range', released: { label: '7', isBand: false }, held: { label: 'fewer than 5', isBand: true }, allocated: { label: '3', isBand: false } },
    { name: 'G21 Touring', released: { label: '12', isBand: false }, held: { label: '3', isBand: false }, allocated: { label: '4', isBand: false } },
  ];
  const columns = [{ key: 'name', label: 'Model line' }, { key: 'released', label: 'Released', numeric: true },
    { key: 'held', label: 'Held', numeric: true }, { key: 'allocated', label: 'Allocated', numeric: true }];
  group('dataTable: long model name and a band cell').append(dataTable({ caption: 'Stock by model line', columns, rows, id: 'gallery-greg-table' }));
  group('dataTable: empty state').append(dataTable({ caption: 'Stock by model line (empty)', columns, rows: [], emptyText: 'No stock has been released yet', id: 'gallery-greg-empty' }));
  section.append(scope);
  return section;
}

export function employeeDecisionExample() {
  const section = el('section', 'vm-gallery-section vm-gallery-employee-decision gcsp');
  section.setAttribute('aria-label', 'Employee decision card');
  const scope = el('div', 'vm vm-gallery-decision-body');
  scope.append(screenIntro({ kicker: 'Choices', title: 'Exact employee decisions', level: 2,
    lede: 'Synthetic display snapshot from the FUCQ-29 recommendation service and canonical policy. Inspect each exact car to see its facts, points and eligibility together.' }));
  const status = feedbackScope({ text: 'Selections and feedback affect this preview only. Nothing is saved or reserved.' });
  status.setAttribute('role', 'status');
  const view = structuredClone(employeeCardFixture);
  const card = matchCard(null, { view,
    onListingSelect: (member) => { status.textContent = `Inspecting ${member.display.name}. Preview only.`; },
    onAction: (action, member) => {
      status.replaceChildren(document.createTextNode(`${action.kind === 'feedback' ? 'Feedback shown for' : 'Selected for this preview:'} ${member.display.name}. Nothing is saved or reserved.`));
      if (action.kind === 'feedback') status.append(feedbackUndo({ text: 'local feedback', onUndo: () => { status.textContent = 'Local feedback undone. Nothing is saved or reserved.'; } }));
    },
  });
  const examples = el('div', 'vm-gallery-decision-states');
  for (const [title, message] of [
    ['Loading your matches', 'Checking exact vehicle facts and scheme terms.'],
    ['No matching cars', 'No exact cars meet the current essentials. Review your choices.'],
    ['Some details need confirmation', 'Unknown exact facts cannot establish eligibility.'],
  ]) examples.append(statusScreen({ kicker: 'Choices', title, message }));
  scope.append(status, card, examples);
  section.append(scope);
  return section;
}

export function employeeControlsExample() {
  const section = el('section', 'vm-gallery-section vm-gallery-employee-controls gcsp');
  section.setAttribute('aria-label', 'Employee question controls and preview');
  const scope = el('div', 'vm vm-gallery-decision-body');
  scope.append(screenIntro({ kicker: 'Shared controls', title: 'Preference, importance and indifference', level: 2,
    lede: 'Display-only controls. These local callbacks do not save a brief or recalculate the unchanged decision snapshot.' }));
  let draft = { position: 70, importance: 50, preferenceMode: 'consider' };
  const controls = el('div', 'vm-gallery-control-grid');
  const ranges = new Map();
  let preferenceMode;
  const status = feedbackScope({ text: 'Local control values only. No saved state.' });
  status.setAttribute('role', 'status');
  const change = (key, value) => {
    draft = { ...draft, [key]: value };
    status.textContent = `Local position ${draft.position}%; importance ${draft.importance}%; ${draft.preferenceMode === 'indifferent' ? 'explicitly indifferent' : 'preference considered'}. Decision snapshot unchanged. No saved state.`;
    if (key === 'preferenceMode') ranges.forEach((control) => control.update({ disabled: value === 'indifferent' }));
  };
  function renderControls() {
    controls.replaceChildren();
    for (const [key, title] of [['position', 'Sportiness preference position'], ['importance', 'Sportiness importance']]) {
      const field = el('fieldset', 'vm-control-field');
      field.append(el('legend', null, title));
      ranges.set(key, renderRangeSlider(field, { id: key, min: 0, max: 100, step: 1 }, null, { single: true,
        value: draft[key], unit: { kind: 'percent' }, ariaLabel: title,
        disabled: draft.preferenceMode === 'indifferent', onValueChange: (value) => change(key, value) }));
      controls.append(field);
    }
    const field = el('fieldset', 'vm-control-field');
    field.append(el('legend', null, 'Sportiness indifference'));
    preferenceMode = renderOptionList({ id: 'preferenceMode', options: [
      { value: 'consider', label: 'Consider this preference' }, { value: 'indifferent', label: 'I am indifferent' },
    ] }, null, { value: draft.preferenceMode, ariaLabel: 'Sportiness indifference', onValueChange: (value) => change('preferenceMode', value) });
    field.append(preferenceMode.list, feedbackScope({ text: 'Zero importance is a stated weight. Indifference is a separate choice; an unknown preference still needs confirmation.' }));
    controls.append(field);
  }
  const preview = el('div', 'vm-gallery-injected-preview');
  const feed = createPreviewFeed({ load: () => ({ ...structuredClone(employeeCardFixture), members: [structuredClone(employeeCardFixture.members[0])] }) });
  const load = button({ label: 'Load unchanged display snapshot', variant: 'ghost', onClick: () => {
    preview.replaceChildren(statusScreen({ title: 'Loading display snapshot', message: 'This uses an injected local loader. No matching or saving is performed.' }));
    feed.schedule(draft, (view) => {
      preview.replaceChildren(previewTile(null, { view }), feedbackScope({ text: 'Unchanged FUCQ-29 decision snapshot. These controls have not recalculated this result.' }));
    }, () => preview.replaceChildren(statusScreen({ title: 'Snapshot unavailable', message: 'Try loading the local display snapshot again.' })));
  } });
  renderControls();
  const project = button({ label: 'Project unknown display', variant: 'ghost', onClick: () => {
    ranges.forEach((control) => control.update({ value: null, valueState: 'unknown' }));
    preferenceMode.update({ value: null });
    status.textContent = 'Unknown display projected without changing local answers or emitting input callbacks. Decision snapshot unchanged. No saved state.';
  } });
  const restore = button({ label: 'Restore local display', variant: 'ghost', onClick: () => {
    ranges.forEach((control, key) => control.update({ value: draft[key], valueState: 'confirmed', disabled: draft.preferenceMode === 'indifferent' }));
    preferenceMode.update({ value: draft.preferenceMode });
    status.textContent = `Local position ${draft.position}%; importance ${draft.importance}%. Projection restored without emitting input callbacks. No saved state.`;
  } });
  scope.append(controls, status, project, restore, load, preview);
  section.append(scope);
  return section;
}

function launcherExamples() {
  const section = el('section', 'vm-gallery-section');
  section.setAttribute('aria-label', 'Car experience launcher');
  section.append(el('h2', 'vm-gallery-title', 'Car experience launcher'));
  const scope = el('div', 'gcsp');
  const body = el('div', 'vm');
  const state = el('p', 'vm-gallery-copy', 'A local brand selection, without navigation.');
  body.append(brandSelector({ value: 'motorrad', onChange: (brand) => {
    state.textContent = `Local selection: ${brand || 'all brands'}. Nothing is saved.`;
  } }), state);
  const choices = el('div', 'demo-experience-grid');
  choices.append(
    experienceChoice({ title: 'Employee cars', description: 'A BMW employee scheme experience.',
      reason: 'Employee cars is not available right now. Used cars remains available.',
      status: 'Currently unavailable', action: { label: 'Employee cars unavailable', disabled: true } }),
    experienceChoice({ title: 'Used cars with a long destination name for the component gallery',
      description: 'A loading example with designed absent-image treatment.', status: 'Loading your car experience',
      action: { label: 'Loading Used cars', disabled: true }, reason: 'Please wait while the experience loads.' }),
  );
  body.append(choices);
  scope.append(body);
  section.append(scope);
  return section;
}

export function mountComponentGallery(root) {
  const browseScope = { kind: 'browse', id: browseSession };
  let browseFeedback = createFeedbackState(browseScope);
  const employeeScope = { kind: 'employee-draft', id: 'gallery-employee-fixture' };
  const employeeStart = {
    schemaVersion: 1,
    briefVersion: 1,
    preferences: {
      body: { value: 'estate', importance: 100, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' },
    },
    essentials: {
      seats: { value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee' },
      charging: { operator: 'equals', value: null, unit: null, state: 'needs-confirmation', source: 'employee' },
    },
  };
  let employeeBrief = structuredClone(employeeStart);
  let employeeUndo = null;

  root.replaceChildren();
  root.classList.add('vm', 'vm-bmw', 'vm-component-gallery');
  const heading = el('header', 'vm-gallery-header');
  heading.append(
    el('h1', 'vm-title', 'Feedback actions'),
    el('p', 'vm-gallery-copy', 'Local examples of visible scope, grouped retail feedback and accessible undo.'),
  );
  const sections = el('div', 'vm-gallery-grid');
  const retail = el('section', 'vm-gallery-section');
  retail.append(
    el('h2', 'vm-gallery-title', 'Retail results'),
    el('p', 'vm-gallery-copy', 'Synthetic BMW listings use the shared result card and its rejection menu.'),
  );
  const retailStatus = el('div', 'vm-brief vm-gallery-feedback');
  const retailCards = el('div', 'vm-gallery-cards');
  retail.append(retailStatus, retailCards);

  const employee = el('section', 'vm-gallery-section');
  employee.append(
    el('h2', 'vm-gallery-title', 'Employee fixture'),
    el('p', 'vm-gallery-copy', 'Read-only fixture. A confirmation proposal changes only this page; it does not save a brief, learn an account or create a hold.'),
  );
  const employeeStatus = el('div', 'vm-brief vm-gallery-employee');
  employee.append(employeeStatus);
  sections.append(retail, employee);
  const exact = el('section', 'vm-gallery-section vm-gallery-exact');
  exact.setAttribute('aria-label', 'Exact listing decisions');
  exact.append(el('h2', 'vm-gallery-title', 'Exact listing decisions'),
    el('p', 'vm-gallery-copy', 'Fictional R1 display trial: £30k / 96% and £39k / 87% stretch. The first photo is representative; the second has no image. Choose a listing, refine to its equipment or test an older backend. Reset restores the starting state.'));
  const exactControls = el('div', 'vm-brief');
  const exactCards = el('div', 'vm-gallery-exact-cards');
  let legacy = false;
  let refined = false;
  function renderExact() {
    const match = exactListingExample({ legacy });
    const scope = { kind: 'browse', id: 'gallery-r1' };
    let state = createFeedbackState(scope);
    if (refined) state = reduceFeedback(state, { schemaVersion: 1, id: 'r1-camera', type: 'filter',
      target: { field: 'feature', operator: 'includes', value: 'parkingCamera' },
      reason: 'Parking camera', scope, expectedVersion: 0 }).state;
    exactCards.replaceChildren(...applyBrowseFeedback([match], state).map((m) => matchCard(m, { big: true })));
    legacyButton.setAttribute('aria-pressed', String(legacy));
    refineButton.setAttribute('aria-pressed', String(refined));
  }
  const legacyButton = feedbackButton({ text: 'Older backend', onClick: () => { legacy = !legacy; renderExact(); } });
  const refineButton = feedbackButton({ text: 'Parking camera only', onClick: () => { refined = !refined; renderExact(); } });
  const exactReset = feedbackButton({ text: 'Reset listing trial', onClick: () => { legacy = false; refined = false; renderExact(); } });
  exactControls.append(legacyButton, refineButton, exactReset);
  exact.append(exactControls, exactCards);
  sections.append(exact);
  root.append(heading, sections, employeeDecisionExample(), employeeControlsExample(), gcspExamples(), gregKitExamples(), launcherExamples());

  function dispatchBrowse(type, target, reason) {
    const result = reduceFeedback(browseFeedback, {
      schemaVersion: 1, id: nextId('rule'), type,
      target, reason, scope: browseFeedback.scope, expectedVersion: browseFeedback.version,
    });
    if (result.status !== 'ok') return false;
    browseFeedback = result.state;
    renderRetail();
    return true;
  }

  function resetBrowse() {
    const result = reduceFeedback(browseFeedback, {
      schemaVersion: 1, id: nextId('reset'), type: 'reset', target: {}, reason: 'Reset search',
      scope: browseFeedback.scope, expectedVersion: browseFeedback.version,
    });
    if (result.status !== 'ok') return;
    browseFeedback = result.state;
    renderRetail();
  }

  function rejectionOptions(match, chosen) {
    const shown = chosen || match.listings[0];
    const allListings = applyBrowseFeedback(initialPool, browseFeedback).flatMap((item) => item.listings || []);
    const options = [];
    const offer = (label, target, predicate) => {
      if (!allListings.some((item) => matchesFeedbackPredicate(item, predicate))) return;
      options.push({
        label, scope: 'Whole current search, across all retailers and listings.',
        apply: () => dispatchBrowse('filter', target, label),
      });
    };
    const shade = shown.shade || shown.colour;
    if (shade) offer(`Not the ${shade.toLowerCase()}`, { field: 'shade', operator: 'not-equals', value: shade },
      { field: 'shade', operator: 'not-equals', value: shade });
    if (Number.isFinite(shown.priceMin)) offer(`Under £${shown.priceMin.toLocaleString('en-GB')}`,
      { field: 'purchase-price', operator: 'less-than', value: shown.priceMin },
      { field: 'purchase-price', operator: 'less-than', value: shown.priceMin });
    if (Number.isFinite(shown.mileage)) offer(`Fewer than ${shown.mileage.toLocaleString('en-GB')} miles`,
      { field: 'odometer', operator: 'less-than', value: shown.mileage },
      { field: 'odometer', operator: 'less-than', value: shown.mileage });
    if (shown.transmission && allListings.some((item) => item.transmission && item.transmission !== shown.transmission)) {
      const want = shown.transmission === 'auto' ? 'manual' : 'automatic';
      const target = { field: 'transmission', operator: 'not-equals', value: shown.transmission };
      offer(`Only ${want}`, target, target);
    }
    options.push({
      label: 'Just not this one', scope: 'This exact group and model only.',
      apply: () => dispatchBrowse('exclude-group', { id: match.car.id }, `Not ${displayName(match)}`),
    });
    return options;
  }

  function renderRetail() {
    const matches = applyBrowseFeedback(initialPool, browseFeedback);
    retailStatus.replaceChildren(
      el('p', 'vm-brief-label', 'Current feedback'),
      feedbackScope({ text: 'This is a local search session. Nothing is saved.' }),
    );
    for (const action of browseFeedback.actions) {
      const row = el('p', 'vm-brief-item is-rule');
      row.append(el('span', 'vm-brief-mark', '−'), el('span', 'vm-brief-text', action.reason));
      row.append(feedbackUndo({
        text: action.reason,
        onUndo: () => {
          const result = reduceFeedback(browseFeedback, {
            schemaVersion: 1, id: nextId('undo'), type: 'undo', target: { actionIds: [action.id] },
            reason: 'Undo feedback', scope: browseFeedback.scope, expectedVersion: browseFeedback.version,
          });
          if (result.status === 'ok') { browseFeedback = result.state; renderRetail(); }
        },
      }));
      retailStatus.append(row);
    }
    const reset = feedbackButton({ text: 'Reset local feedback', variant: 'ghost', onClick: resetBrowse });
    reset.classList.add('vm-gallery-reset');
    retailStatus.append(reset);
    retailCards.replaceChildren();
    if (!matches.length) {
      retailCards.append(el('p', 'vm-refine-empty-text', 'No listings remain in this search. Reset to restore the examples.'));
      return;
    }
    for (const match of matches) {
      retailCards.append(matchCard(match, {
        brand: 'bmw', rejectOptions: rejectionOptions,
        rejectLabel: 'Not this one', rejectPrompt: 'What put you off?',
      }));
    }
  }

  function renderEmployee() {
    employeeStatus.replaceChildren(
      el('p', 'vm-brief-label', 'Local employee brief fixture'),
      el('p', 'vm-brief-item', `Body preference: ${employeeBrief.preferences.body.value} (confirmed)`),
      el('p', 'vm-brief-item', `Essential seats: at least ${employeeBrief.essentials.seats.value} (confirmed)`),
      el('p', 'vm-brief-item', `Charging access: ${employeeBrief.essentials.charging.state === 'confirmed' ? `${employeeBrief.essentials.charging.value} (confirmed)` : 'unknown (needs confirmation)'}`),
      feedbackScope({ text: 'No saved brief, account learning or durable hold is involved.' }),
    );
    if (employeeUndo) {
      employeeStatus.append(feedbackUndo({
        text: 'Confirm no charging access',
        onUndo: () => { employeeBrief = employeeUndo; employeeUndo = null; renderEmployee(); },
      }));
      return;
    }
    const confirm = feedbackButton({ text: 'Confirm no charging access', variant: 'primary', onClick: () => {
      const at = new Date().toISOString();
      const result = applyConfirmedFeedbackChange(employeeBrief, {
        schemaVersion: 1, id: nextId('employee-confirm'), type: 'confirm-change',
        target: { path: 'essentials.charging', value: { operator: 'equals', value: 'none', unit: null, state: 'confirmed' } },
        reason: 'Employee confirms no charging access', scope: employeeScope,
        expectedVersion: employeeBrief.briefVersion,
        confirmation: { actor: 'employee', confirmed: true, at },
      });
      if (result.status === 'ok') {
        employeeUndo = structuredClone(employeeBrief);
        employeeBrief = result.brief;
        renderEmployee();
      }
    } });
    employeeStatus.append(confirm);
  }

  renderRetail();
  renderEmployee();
  renderExact();
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('component-gallery');
  if (root) mountComponentGallery(root);
}
