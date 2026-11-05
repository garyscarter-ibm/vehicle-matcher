import { applyBrowseFeedback, applyConfirmedFeedbackChange, createFeedbackState, matchesFeedbackPredicate, reduceFeedback } from './feedback-actions.js';
import { el } from './ui.js';
import { feedbackButton, feedbackScope, feedbackUndo, matchCard } from './modes/result-card.js';

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
  root.append(heading, sections);

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
