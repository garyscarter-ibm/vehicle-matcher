import { accountIdentity } from '../shell/account-runtime.js';
// Account page composition. Account authority and durable journey state stay in the adapter.
import { el, screenIntro, button, statusScreen, factList, formatTerm } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { runRestartedScreen, isRunRestarted } from '../kit/run-restarted.js';
import { countdown } from '../employee/representative-body.js';
import { toAccountView, journeyIntent } from './account-view.js';
import { createAccountHttpAdapter } from './http-adapter.js';
import { viewStatus } from '../kit/view-status.js';
import { latestOrderId } from '../order-progress/order-progress-controller.js';
import { orderCar } from '../order-progress/order-car.js';
import { sentence, orderCopy } from '../order-progress/order-progress-copy.js';
import { orderIdentityRows, orderReferenceOf } from '../kit/order-identity.js';
import { focusKeyOf, findByFocusKey, keepScroll } from '../kit/focus-key.js';
import { dataTable } from '../kit/data-table.js';
import { sideDrawer } from '../kit/side-drawer.js';
import { NO_IMAGE_TEXT } from '../kit/plain-copy.js';
import { demoTime } from '../kit/activity-timeline.js';
import { routePortal, PORTAL_ROUTES } from '../employee/portal-navigation.js';

let serial = 0;
const MISSING = 'Not supplied';
const failure = { status: 'unavailable', code: 'account-transport-unavailable' };
const states = {
  'absent-hr-account': ['Your HR account is missing', 'Contact HR support to check your employee account.'],
  'not-yet-eligible': ['Replacement is not available yet', 'Your supplied collection window does not permit a replacement now.'],
  'ordering-closed': ['Too late to order before renewal', 'No collection date fits before your contract ends. Scheme support can help with your renewal.'],
  'no-entitlement': ['No ordering entitlement', 'Scheme support can check your entitlement.'],
  'unsupported-scheme': ['Ordering is not supported for this scheme', 'Your supplied contracts and history remain available below.'],
  'no-contract': ['Your current contract is missing', 'Scheme support must check the contract linked to your vehicle slot.'],
  'source-failure': ['Your account is unavailable', 'Refresh to try again, or contact scheme support.'],
  refused: ['This account cannot be opened', 'Reopen your employee session or contact scheme support.'],
  conflict: ['Your account has changed', 'Refresh your account before starting a journey.'],
};

function shown(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-GB');
  if (Array.isArray(value)) return value.map(shown).filter((part) => part != null).join(', ') || null;
  if (typeof value === 'object') {
    if ('value' in value) {
      if (value.status === 'unknown') return null;
      const amount = value.kind === 'purchase-money' ? formatTerm(value) : `${shown(value.value) ?? MISSING}${value.unit ? ` ${value.unit}` : value.currency ? ` ${value.currency}` : ''}`;
      const basis = value.basis ?? value.measurementBasis;
      return `${amount}${basis ? ` (${shown(basis)})` : ''}`;
    }
    return Object.entries(value).map(([key, part]) => `${label(key)}: ${shown(part) ?? MISSING}`).join('; ') || null;
  }
  return value;
}
const label = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
const row = (name, value, unit) => ({ label: name, value: shown(value), ...(value != null && unit ? { unit } : {}) });
const facts = (rows, hideMissing) => factList(rows, { className: 'gcsp-facts', hideMissing });
const supplied = (value) => value != null && value !== '';
// Raw ids are not copy (FUCQ-195/197): statuses read as words; slots, schemes and sources show only a supplied label.
const statusLabels = { current: 'Current car', returned: 'Returned' };
const status = (value) => statusLabels[value] ?? (/^[a-z]+(-[a-z]+)*$/.test(value ?? '') ? sentence(value.replace(/-/g, ' ')) : value);
const slotRows = (model, slotId) => {
  const name = model?.slots?.find((slot) => slot.entitlementSlotId === slotId)?.label;
  return name ? [row('Vehicle slot', name)] : [];
};
const sourceLabel = (source) => typeof source === 'string' ? source
  : source?.label ?? null;
const technicalLabels = { insuranceGroup: 'Insurance group', nedcCo2: 'NEDC CO2', wltpCo2: 'WLTP CO2',
  fuelConsumptionLow: 'Fuel consumption, low', fuelConsumptionMedium: 'Fuel consumption, medium',
  fuelConsumptionHigh: 'Fuel consumption, high', fuelConsumptionExtraHigh: 'Fuel consumption, extra high',
  fuelConsumptionCombinedWeighted: 'Fuel consumption, combined weighted', electricityConsumption: 'Electricity consumption',
  electricRange: 'Electric range', electricCityRange: 'Electric city range' };
const technicalLabel = (key) => technicalLabels[key] ?? label(key);
const asOf = (value) => Number.isNaN(Date.parse(value ?? '')) ? MISSING
  : new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
// Raw ids are not copy: a scheme shows only the policy-supplied name; tables and records fall back to "Scheme N".
const schemeTitle = (history, index) => history.label ?? `Scheme ${index + 1}`;
const schemeTitleFor = (model, schemeId) => {
  const index = model.histories.findIndex((history) => history.schemeId === schemeId);
  return index < 0 ? null : schemeTitle(model.histories[index], index);
};
const schemeName = (model, schemeId) => model.histories.find((history) => history.schemeId === schemeId)?.label ?? null;
const contractModel = (model, id) => [...model.currentContracts, ...model.histories.flatMap((history) => history.entries)]
  .find((contract) => contract.contractId === id)?.model;
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
const date = (value) => isoDate(value)
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : shown(value);
const shortDate = (value, year = false) => isoDate(value) ? new Date(`${value}T00:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }), timeZone: 'UTC' }) : null;
const windowText = (contract) => shortDate(contract.earliestCollectionDate) && shortDate(contract.latestCollectionDate)
  ? `${shortDate(contract.earliestCollectionDate)} to ${shortDate(contract.latestCollectionDate)}` : null;

// Earlier contracts name the car's own number; a reference shows only when the record supplies one.
const orderRows = (contract) => orderIdentityRows(contract.orderReference, contract.orderNumber).map(({ label, value }) => row(label, value));

const printLabel = (contract) => {
  const id = orderReferenceOf(contract.orderReference) ?? contract.orderNumber;
  return id ? `Print record ${id}` : 'Print record';
};

// The page and the record show only supplied facts (Gary, 10 November).
const suppliedFacts = (rows, className) => {
  const kept = rows.filter((item) => supplied(item.value));
  return kept.length ? factList(kept, { className }) : null;
};

function recordSection(title, ...parts) {
  const section = el('section', 'gcsp-record-section');
  section.append(el('h3', undefined, title), ...parts);
  return section;
}

// The car record: headed sections of supplied facts, built for the drawer and again for print.
function recordSections({ contract, model }) {
  const technical = contract.technical ?? {};
  const standard = ['insuranceGroup', 'transmission', 'nedcCo2', 'wltpCo2', 'fuelConsumptionLow', 'fuelConsumptionMedium',
    'fuelConsumptionHigh', 'fuelConsumptionExtraHigh', 'fuelConsumptionCombinedWeighted', 'electricityConsumption',
    'electricRange', 'electricCityRange', 'exterior', 'interior', 'price', 'options'];
  const window = windowText(contract);
  const blocks = [
    ['Contract', [row('Status', status(contract.status)), row('Driver', contract.driver?.name), row('Term', contract.months, 'months'),
      row('Annual mileage', contract.annualMileage, contract.mileageUnit), row('Contract end', date(contract.contractEndDate)),
      row('Returned', date(contract.returnedDate))]],
    ['Collection', [row('Collected', date(contract.actualCollectionDate)),
      ...(window ? [row('Replacement window', `${date(contract.earliestCollectionDate)} to ${date(contract.latestCollectionDate)}`)]
        : [row('Earliest collection', date(contract.earliestCollectionDate)), row('Latest collection', date(contract.latestCollectionDate))]),
      row('Requested collection', date(contract.requestedCollectionDate)), row('Collection location', contract.collectionLocation),
      row('Current mileage', contract.currentOdometer), row('Expected return mileage', contract.expectedReturnMileage, contract.returnMileageUnit ?? 'mi'),
      row('Returned mileage', contract.returnedMileage, contract.returnMileageUnit ?? 'mi')]],
    ['Order and vehicle', [...orderRows(contract), row('Order date', date(contract.orderDate)), row('Order status', status(contract.orderStatus)),
      row('Registration', contract.registration), row('Delivered VIN', contract.vin), row('Chassis number', contract.chassisNumber),
      row('Registration date', date(contract.registrationDate)), ...slotRows(model, contract.slotId), row('Phone', contract.contact?.phone),
      row('Email', contract.contact?.email), row('Special requirements', contract.specialRequirements)]],
  ];
  const sections = blocks.map(([title, rows]) => recordSection(title, suppliedFacts(rows, 'gcsp-record-facts')
    ?? el('p', 'gcsp-note', 'Not supplied for this car.')));
  const specRows = [...standard.map((key) => row(technicalLabel(key), technical[key] ?? contract[key])),
    ...Object.entries(technical).filter(([key]) => !['provenance', 'source', ...standard].includes(key)).map(([key, value]) => row(technicalLabel(key), value)),
    row('Specification provenance', sourceLabel(technical.provenance ?? technical.source ?? contract.source))];
  sections.push(recordSection('Technical specification and options', el('p', 'gcsp-note', 'Model or handbook evidence does not confirm the fitted equipment on your car.'),
    suppliedFacts(specRows, 'gcsp-record-facts') ?? el('p', 'gcsp-note', 'Not supplied for this car.')));
  return sections;
}

// What print clones: the context label, the model and the sections, with no controls.
function recordPrintNode(record) {
  const node = el('div', 'gcsp-account-record');
  node.append(el('p', 'gcsp-note', record.context), el('h2', 'gcsp-h2', record.title), ...recordSections(record));
  return node;
}

const lineOf = (...parts) => parts.filter((part) => part != null && part !== '').join(' \u00b7 ');
const addressLine = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.values(value).map(shown).filter(supplied).join(', ') : shown(value);

function yourDetails(model, controls) {
  const section = el('section', 'gcsp-account-section');
  section.setAttribute('aria-labelledby', 'gcsp-account-details-title');
  const title = el('h2', 'gcsp-h2', 'Your details'); title.id = 'gcsp-account-details-title';
  const rows = el('ul', 'gcsp-account-rows');
  const item = (heading, content, help) => {
    const node = el('li', 'gcsp-account-row'); const copy = el('div', 'gcsp-account-lines');
    copy.append(...content); node.append(el('h3', 'gcsp-account-row-label', heading), copy, help); return node;
  };
  const line = (...parts) => { const node = el('p', 'gcsp-account-line'); node.append(...parts); return node; };
  const muted = (text) => el('span', 'gcsp-note', text);
  const idf = (name) => model.identityFacts.find((fact) => fact.label === name)?.value;
  const text = (value) => supplied(value) ? shown(value) : null;
  const first = lineOf(text(idf('Employee number')) && `Employee number ${text(idf('Employee number'))}`,
    text(idf('Band or grade')) && `Band ${text(idf('Band or grade'))}`, text(idf('Company')));
  const override = text(idf('Allowance override'));
  const overrideEnd = date(idf('Override end'));
  const employee = [line(el('strong', undefined, idf('Name') ?? 'Employee'), ...(first ? [muted(` \u00b7 ${first}`)] : [])),
    ...[lineOf(text(idf('Email')), text(idf('Phone'))), addressLine(idf('Address')), text(date(idf('Date of birth'))) && `Date of birth ${date(idf('Date of birth'))}`,
      override && `Allowance override: ${override}${overrideEnd ? ` (ends ${overrideEnd})` : ''}`]
      .filter(supplied).map((value) => line(muted(value)))];
  rows.append(item('Employee', employee, controls.supportButton('hr-support', 'Get help with your details')));
  const drivers = model.drivers.map((driver) => {
    const licence = driver.licence ?? {};
    const valid = (name, label) => {
      const found = licence[name] ?? licence.categories?.find?.((entry) => typeof entry === 'object' && entry.category === name);
      const until = date(found?.validUntil ?? ((found || licence.categories?.includes(name)) ? licence.validUntil : null));
      return until ? `${label} licence valid until ${until}` : null;
    };
    const role = driver.kind === 'employee' ? 'You' : `Nominated driver${supplied(driver.relationship) ? `, ${shown(driver.relationship)}` : ''}`;
    const rest = lineOf(role, valid('car', 'Car'), valid('bike', 'Bike'), text(licence.displayNumber));
    // Supplied licence and profile values beyond the headline stay visible on a second line.
    const type = (name, label) => { const found = licence[name] ?? licence.categories?.find?.((entry) => typeof entry === 'object' && entry.category === name); return text(found?.type) && `${label} licence type ${found.type}`; };
    const extra = lineOf(text(driver.status) && `Status ${driver.status}`, text(date(driver.dateOfBirth)) && `Date of birth ${date(driver.dateOfBirth)}`,
      addressLine(driver.address) && `Address ${addressLine(driver.address)}`, type('car', 'Car'), type('bike', 'Bike'));
    return [line(el('strong', undefined, driver.name ?? 'Driver'), ...(rest ? [muted(` \u00b7 ${rest}`)] : [])), ...(extra ? [line(muted(extra))] : [])];
  }).flat();
  rows.append(item(`Drivers (${model.drivers.length})`, drivers.length ? drivers : [el('p', 'gcsp-note', 'No driver or licence details supplied.')],
    controls.supportButton('driver-support', 'Get help with drivers')));
  section.append(title, rows);
  return section;
}

function keyFigure(label, value, unit) {
  const cell = el('div'); const figure = el('dd', value == null ? 'is-missing' : undefined, value ?? 'Not supplied');
  if (value != null && unit) figure.append(' ', el('span', 'gcsp-account-unit', unit));
  cell.append(el('dt', undefined, label), figure); return cell;
}
const points = (value) => Number.isFinite(value) ? value.toLocaleString('en-GB') : null;

function mediaColumn(media, ...extra) {
  const column = el('div', 'gcsp-feature-media');
  column.append(media, ...extra); return column;
}

function currentCar(contract, model, controls, buddy = false, hero = null) {
  const terms = { kind: 'points-monthly', ...contract.terms };
  // The contract's vehicle record carries its monthly points (points-per-month in the offer comparison).
  if (!Object.hasOwn(terms, 'value') && Number.isFinite(contract.vehicle?.points)) terms.value = contract.vehicle.points;
  if (!Object.hasOwn(terms, 'allowance') && contract.schemeId === model.choices?.schemeId) {
    terms.allowance = model.allowance?.monthlyPoints ?? model.allowance?.value;
  }
  const feature = el('section', 'gcsp-feature');
  feature.dataset.contractId = contract.contractId;
  const heading = el('h2', 'gcsp-h2', contract.model ?? 'Current car: model not supplied');
  heading.id = `gcsp-account-car-${++serial}`;
  feature.setAttribute('aria-labelledby', heading.id);
  const source = contract.media;
  const { media } = mediaWell({ name: contract.model ?? 'Current car', photo: source?.src ?? source?.photo ?? '',
    line: '', alt: source?.alt ?? contract.model ?? 'Car',
    caption: source?.caption }, 'gcsp-media', { placeholder: NO_IMAGE_TEXT });
  const scheme = schemeName(model, contract.schemeId);
  const state = el('p', 'gcsp-account-state');
  if (contract.daysRemaining == null) state.append('Contract end: Not supplied');
  else {
    if (contract.daysRemaining <= 90) { const dot = el('span', 'gcsp-account-dot'); dot.setAttribute('aria-hidden', 'true'); state.append(dot); }
    state.append(el('strong', undefined, `Contract ${countdown(model.asOf.slice(0, 10), contract.contractEndDate)}`), el('span', 'gcsp-note', ` on ${date(contract.contractEndDate)}`));
  }
  const key = el('dl', 'gcsp-account-key');
  const window = windowText(contract);
  key.append(keyFigure('This car', points(terms.value), 'points a month'), keyFigure('Your allowance', points(terms.allowance), 'points a month'),
    window ? keyFigure('Collect a replacement', window) : keyFigure('Contract end', date(contract.contractEndDate)));
  const copy = el('div', 'gcsp-feature-copy');
  const title = el('div', 'gcsp-account-title');
  title.append(el('p', 'gcsp-account-context', scheme ? `Current car \u00b7 ${scheme}` : 'Current car'), heading, state);
  copy.append(title, key);
  const override = Number.isFinite(terms.allowance) ? overrideText(model) : null;
  if (override) copy.append(el('p', 'gcsp-synthetic', override));
  const quiet = suppliedFacts([row('Driver', contract.driver?.name), row('Term', contract.months, 'months'),
    row('Annual mileage', contract.annualMileage, contract.mileageUnit), row('Collected', date(contract.actualCollectionDate)),
    row('Current mileage', contract.currentOdometer), row('Registration', contract.registration), ...slotRows(model, contract.slotId)], 'gcsp-account-facts');
  if (quiet) copy.append(quiet);
  if (hero) copy.append(hero(3));
  if (!contract.action) copy.append(el('p', 'gcsp-note', 'Replacement is unavailable for this contract and slot.'));
  const actions = el('div', 'gcsp-actions');
  if (contract.action) actions.append(controls.startButton(contract.action, buddy));
  const view = button({ label: 'View car record', variant: 'ghost', onClick: () => controls.openRecord(recordFor(contract, model, scheme), view) });
  view.dataset.focusKey = `View car record ${contract.contractId}`;
  actions.append(view);
  copy.append(actions);
  feature.append(mediaColumn(media, ...(source?.provenance ? [el('p', 'gcsp-synthetic', `Image source: ${shown(source.provenance)}`)] : [])), copy);
  return feature;
}

const recordFor = (contract, model, scheme) => ({ contract, model, title: contract.model ?? 'Model not supplied',
  context: ['Car record', scheme].filter(Boolean).join(' \u00b7 ') });

// FUCQ-252: a collected order the server reports as the current car; its name and image come from the order read.
function orderCurrentCar(car, order, orderVehicle) {
  const same = order?.orderUuid === car.orderUuid;
  const name = same ? orderVehicle?.name : null;
  const feature = el('section', 'gcsp-feature');
  feature.dataset.orderUuid = car.orderUuid;
  const heading = el('h2', 'gcsp-h2', name ?? 'Current car: model not supplied');
  heading.id = `gcsp-account-car-${++serial}`;
  feature.setAttribute('aria-labelledby', heading.id);
  const { media } = mediaWell({ name: name ?? 'Current car', photo: same ? orderVehicle?.photo ?? '' : '', line: '',
    alt: name ?? 'Car' }, 'gcsp-media', { placeholder: NO_IMAGE_TEXT });
  const copy = el('div', 'gcsp-feature-copy');
  const title = el('div', 'gcsp-account-title');
  title.append(el('p', 'gcsp-account-context', 'Current car'), heading);
  copy.append(title, ...[suppliedFacts([row('Collected', date(car.collectedAt?.slice(0, 10))), row('Delivered VIN', car.vin),
    ...(same ? orderIdentityRows(order.source?.orderReference, order.source?.orderNumber).map(({ label, value }) => row(label, value)) : [])], 'gcsp-account-facts')].filter(Boolean));
  feature.append(mediaColumn(media), copy);
  return feature;
}

export { orderCar };

// Outcomes the projection reports (FUCQ-253 adds handed-over); any other outcome is still in progress.
const orderTitles = Object.freeze({ declined: 'Your order was declined', 'handed-over': 'Your car has been handed over' });

// The slot is allocated to this order, so one row replaces "No ordering entitlement" and the embedded tracker.
function newCarRow(order, vehicle, controls) {
  const declined = order.outcome === 'declined';
  const node = el('section', 'gcsp-summary gcsp-account-order-status'); node.setAttribute('aria-label', 'Your new car');
  const { media } = mediaWell({ name: vehicle?.name ?? 'New car', photo: vehicle?.photo ?? '', line: '',
    alt: vehicle?.name ?? 'Car' }, 'gcsp-order-media', { placeholder: NO_IMAGE_TEXT });
  const copy = el('div', 'gcsp-order-car-details gcsp-summary-live');
  copy.append(el('h2', 'gcsp-h2', orderTitles[order.outcome] ?? 'Your new car'), el('p', 'gcsp-summary-name', vehicle?.name ?? orderCopy.noCar));
  if (order.currentStage) copy.append(el('p', 'gcsp-note', `Current step: ${sentence(order.currentStage)}.`));
  const { orderReference, orderNumber } = order.source ?? {};
  if (orderNumber || orderReferenceOf(orderReference)) copy.append(facts(orderIdentityRows(orderReference, orderNumber)));
  copy.append(button({ label: declined ? 'View order progress' : 'Track your order', variant: declined ? 'ghost' : 'primary', href: PORTAL_ROUTES['order-progress'],
    onClick: (event) => { event.preventDefault(); controls.go?.('order-progress'); } }));
  const row = el('div', 'gcsp-order-car'); row.append(media, copy); node.append(row);
  return node;
}

// FUCQ-278: a pending newest offer is the one decision; manual car choices step back until it is made.
const offerHeld = (offers) => offers?.[0]?.state === 'pending';

// The hero block tells Paula what her buddy is doing; copy and buttons follow the saved permission.
function buddyCard(value, { pending, controls }) {
  const permission = value?.permission;
  const check = value?.lastSuccessfulCheck; const lines = [];
  const looking = permission?.canSearch === true && permission.paused !== true;
  let text; let actions;
  const go = (label, key, variant) => button({ label, variant, disabled: pending, onClick: () => controls.go(key) });
  if (!permission) { text = 'Tell your buddy what matters and it will keep looking for a suitable car for you.'; actions = [go('Set your preferences', 'brief', 'primary')]; }
  else if (looking) {
    text = 'Your buddy is looking for a car for you.';
    if (check && Number.isFinite(Date.parse(check.checkedAt))) lines.push(`Last check ${demoTime(check.checkedAt)}: ${check.carsChecked} ${check.carsChecked === 1 ? 'car' : 'cars'} checked, ${check.suitableCars} suitable.`);
    actions = [go('See buddy activity', 'activity', 'primary'), go('Change your preferences', 'brief', 'ghost')];
  } else { text = 'Your buddy is paused, so it is not looking for cars.'; actions = [go('Change your preferences', 'brief', 'primary'), go('See buddy activity', 'activity', 'ghost')]; }
  return { build: (level) => heroBlock('Your buddy', [text, ...lines], actions, level), primary: !permission || looking };
}

// One labelled block: a heading, plain lines and the state's actions (the first is the primary).
function heroBlock(title, lines, actions, level = 2) {
  const card = el(level === 2 ? 'section' : 'div', level === 2 ? 'gcsp-summary' : 'gcsp-summary-live'); card.setAttribute('aria-label', title);
  if (level !== 2) card.setAttribute('role', 'group');
  card.append(el(`h${level}`, 'gcsp-h2', title), ...lines.map((line) => el('p', 'gcsp-note', line)), ...actions);
  return card;
}

const overrideText = (model) => {
  const value = shown(model.account?.allowanceOverride);
  if (!supplied(value)) return null;
  const end = date(model.account.allowanceOverrideEndDate);
  return `Allowance override: ${value}${supplied(end) ? `, ends ${end}` : ''}`;
};

// One table across schemes (FUCQ-218 names them); a placed order (FUCQ-239) is a row, and its numbers show in its record.
function orderHistory(model, { order, orderVehicle, controls }) {
  const section = el('section', 'gcsp-account-history');
  section.setAttribute('aria-labelledby', 'gcsp-account-history-title');
  const title = el('h2', 'gcsp-h2', 'Order history'); title.id = 'gcsp-account-history-title';
  section.append(title);
  const rows = [];
  const add = (contract, scheme, ended, tag) => {
    const car = contract.model ?? 'Model not supplied';
    rows.push({ car: contract.model ? car : { label: car, missing: true }, scheme, collected: date(contract.actualCollectionDate), ended,
      status: tag, record: recordFor(contract, model, scheme), name: `View record for ${[car, scheme, ended].filter(Boolean).join(', ')}` });
  };
  const placed = order && model.slots.some((slot) => slot.entitlementSlotId === order.entitlementSlotId);
  if (placed) {
    const car = orderVehicle?.name ?? null;
    add({ model: car, status: order.outcome, slotId: order.entitlementSlotId, orderReference: order.source?.orderReference, orderNumber: order.source?.orderNumber },
      schemeTitleFor(model, model.account?.schemeId), null, status(order.outcome));
  }
  model.histories.forEach((history, index) => {
    for (const contract of history.entries) {
      const when = (prefix, value) => shortDate(value, true) && `${prefix}${shortDate(value, true)}`;
      const ended = contract.status === 'current' ? when('Ends ', contract.contractEndDate)
        : contract.status === 'returned' ? when('Returned ', contract.returnedDate) : when('', contract.contractEndDate);
      add(contract, schemeTitle(history, index), ended, contract.status === 'current' ? { label: 'Current car', emphasis: true, tone: 'success' } : status(contract.status));
    }
  });
  if (!rows.length) { section.append(el('p', 'gcsp-note', 'No order history.')); return section; }
  const columns = [{ key: 'car', label: 'Car' }, { key: 'scheme', label: 'Scheme' }, { key: 'collected', label: 'Collected' },
    { key: 'ended', label: 'Ended' }, { key: 'status', label: 'Status' }];
  section.append(dataTable({ caption: 'Order history', columns, rows, stack: true, rowAction: { header: 'Record', label: 'View record',
    name: (data) => data.name, onSelect: (data, index) => controls.openRecord(data.record, section.querySelectorAll('tbody .gcsp-table-action')[index]) } }));
  const join = (list, word) => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${word} ${list.at(-1)}`;
  const empty = model.histories.flatMap((history, index) => history.count ? [] : [schemeTitle(history, index)]);
  const only = model.histories.flatMap((history, index) => !history.orderingSupported && history.count ? [schemeTitle(history, index)] : []);
  const note = [empty.length && `No ${join(empty, 'or')} orders.`,
    only.length && `${join(only, 'and')} ${only.length === 1 ? 'shows' : 'show'} history only; you can't order through ${only.length === 1 ? 'it' : 'them'} here.`].filter(Boolean).join(' ');
  if (note) section.append(el('p', 'gcsp-synthetic', note));
  return section;
}

// This is page layout rather than a stock decision card: a delivered car has no stock eligibility decision.
export function renderAccountBody(main, { model, draft, offers = [], activity, pending = false, message, journey = false, controls, order, orderVehicle, restarted = false, reload } = {}) {
  const wrap = el('div', 'vm gcsp-rep gcsp-account-body');
  wrap.setAttribute('aria-busy', String(pending));
  const head = el('div', 'gcsp-account-head');
  head.append(screenIntro({ kicker: 'Choices', title: journey ? 'Your saved journey' : 'Your cars', level: 1, className: 'gcsp-intro' }));
  wrap.append(head);
  // A restarted run needs a reload, so nothing else on the page can work.
  if (restarted || model.state === 'restarted' || isRunRestarted(draft)) {
    wrap.append(runRestartedScreen({ reload })); main.replaceChildren(wrap); return () => wrap.remove();
  }
  const fresh = el('div', 'gcsp-account-fresh');
  const provenance = model.account ? model.versions?.employeeContract : null;
  if (provenance) fresh.append(el('p', 'gcsp-synthetic', `${provenance.label ? `Source: ${provenance.label}. ` : ''}Account as of ${asOf(model.asOf)}.`));
  // Presenter actions refresh the page; a manual refresh shows only after a failure, a conflict or a stale saved journey.
  const stale = ['source-failure', 'conflict', 'refused'].includes(model.state) || message?.error || draft?.value?.requiresRefresh
    || (draft && !['ok', 'not-found'].includes(draft.status));
  if (stale) fresh.append(button({ label: 'Refresh account', variant: 'ghost', disabled: pending, onClick: controls.refresh }));
  if (fresh.childElementCount) head.append(fresh);
  if (message) { const note = statusScreen({ title: message.title, message: message.text, role: null }); note.classList.add('gcsp-account-message'); wrap.append(note); }
  const ordered = !journey && model.state === 'no-entitlement' && order
    && model.slots.some((slot) => slot.entitlementSlotId === order.entitlementSlotId);
  if (!journey && order) wrap.append(newCarRow(order, orderVehicle, controls));
  if (!ordered && states[model.state]) {
    const [title, text] = states[model.state];
    wrap.append(statusScreen({ title, message: text, role: null, actions: [controls.supportButton(model.state === 'absent-hr-account'
      ? 'hr-support' : model.supportOwner, 'Contact support')] }));
  }
  const held = !journey && offerHeld(offers) && Boolean(controls.openOffer);
  // An accepted newest offer has become an order, so its progress replaces the offer link.
  const offerShown = !journey && offers.length && offers[0].state !== 'accepted' && controls.openOffer;
  let buddy = false; let hero = null;
  if (!journey && !offerShown && !ordered && offers[0]?.state !== 'accepted' && activity?.status === 'ok' && controls.go) {
    const built = buddyCard(activity.value, { pending, controls }); hero = built.build; buddy = built.primary;
  }
  if (offerShown) {
    hero = (level) => heroBlock('Your car offer', ['Your buddy found a car for you. Check its details and deadline.',
      ...(held ? ['Decide on your car offer before choosing another car.'] : [])],
    [button({ label: 'View your offer', disabled: pending, onClick: () => controls.openOffer(offers[0]) })], level);
  }
  // FUCQ-224: once the slot has an order, its progress replaces the saved journey card.
  const superseded = ordered && draft?.status === 'ok' && draft.value.choices?.slotId === order.entitlementSlotId;
  if (draft?.status === 'ok' && !superseded) {
    const value = draft.value;
    const choices = value.choices;
    const saved = el('section', 'gcsp-summary');
    saved.append(el('h2', 'gcsp-h2', choices.mode === 'replacement' ? 'Replacement journey saved' : 'New order journey saved'),
      el('p', 'gcsp-note', value.draftStage === 'intent' ? 'Your starting context is saved. No car has been selected or ordered.'
        : 'Your order choices are saved. This is not an order confirmation.'),
      facts([row('Current car', contractModel(model, choices.oldContractId)), ...slotRows(model, choices.slotId)]));
    if (value.requiresRefresh) saved.append(el('p', 'gcsp-note', 'Your saved context has changed. Refresh, review the account below, then start the permitted journey again.'));
    else saved.append(button({ label: 'Resume saved journey', variant: held ? 'ghost' : 'primary', disabled: pending, onClick: controls.resume }));
    if (journey) saved.append(button({ label: 'Back to account', variant: 'ghost', disabled: pending, onClick: controls.back }));
    wrap.append(saved);
  } else if (draft && !['ok', 'not-found'].includes(draft.status)) {
    wrap.append(statusScreen({ title: 'Saved journey could not be read', message: 'Refresh before starting or resuming a journey.', role: null }));
  }
  if (model.account) {
    // FUCQ-237: an order in progress replaces "No current car"; a declined order keeps it. A confirmed return (FUCQ-252) shows it.
    const none = !model.currentContracts.length && !model.currentOrders.length;
    // Without a current car there is no key strip, so the allowance (and any override, FUCQ-277) gets one line here.
    if (none) {
      const base = model.allowance?.monthlyPoints ?? model.allowance?.value;
      const line = [Number.isFinite(base) && `Your allowance: ${points(base)} points a month`, overrideText(model)].filter(Boolean).join('. ');
      if (line) wrap.append(el('p', 'gcsp-note', `${line}.`));
    }
    // The hero (buddy or offer) sits in the first current car; with no car it stands alone.
    model.currentContracts.forEach((contract, index) => wrap.append(currentCar(contract, model, controls, buddy, index === 0 ? hero : null)));
    if (!model.currentContracts.length && hero) wrap.append(hero(2));
    for (const car of model.currentOrders) wrap.append(orderCurrentCar(car, order, orderVehicle));
    if (none && model.carReturned) wrap.append(statusScreen({ title: 'No current car', message: 'Your previous car has been returned. Your new car becomes current at handover.', role: null }));
    else if (none && !(ordered && order.outcome !== 'declined')) wrap.append(statusScreen({ title: 'No current car', message: 'No current vehicle is supplied for your account.', role: null }));
    for (const action of model.actions.filter((item) => item.action === 'order')) wrap.append(controls.startButton(action, buddy));
    wrap.append(orderHistory(model, { order, orderVehicle, controls }), yourDetails(model, controls));
  }
  main.replaceChildren(wrap);
  return () => wrap.remove();
}

export function mountAccount(root, { adapter = createAccountHttpAdapter(), brand = 'bmw', onSupport, onNavigate, print, orderAdapter, helpAdapter, reload, signOut = adapter.readOnly !== true } = {}) {
  const abort = new AbortController();
  let envelope; let draft; let offers; let activity; let main; let pending = false; let message = null; let journey = false; let disposed = false;
  let generation = 0; let teardown; let loading; let finishPrint; let drawer; let orderRow; let orderVehicle; let restarted = false;
  let syncVersion = 0; const live = viewStatus();
  const notify = (type, detail) => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent(type,
    { detail, bubbles: true, composed: true }));
  const read = async (name) => {
    try { return await adapter[name]({ signal: abort.signal }); } catch { return failure; }
  };
  const controls = {
    refresh: () => refresh(),
    back: () => { journey = false; draw(true); },
    openOffer: ({ offerId, runId }) => root.ownerDocument.defaultView.location.assign(
      `/gcsp/offer?offerId=${encodeURIComponent(offerId)}&runId=${encodeURIComponent(runId)}`),
    resume: () => resume(),
    supportButton: (route, text) => button({ label: text, variant: 'ghost', onClick: () => {
      onSupport?.(route); notify('gcsp:support', { route });
      message = { title: 'Support route', text: `Support route: ${route}.` }; live.clear(); draw(true);
    } }),
    go: (key) => (onNavigate ?? ((to) => routePortal(to, root.ownerDocument.defaultView.location)))(key),
    startButton: (action, buddy = false) => button({ label: action.action === 'replace' ? 'Choose a replacement' : 'Start a new order',
      variant: !journey && (offerHeld(offers) || buddy) ? 'ghost' : 'primary',
      disabled: pending || draft?.status !== 'ok' && draft?.status !== 'not-found', onClick: () => start(action) }),
    openRecord: (record, opener) => {
      drawer?.close(false);
      const key = opener?.dataset.focusKey;
      const host = main?.closest('.gcsp') ?? root;
      const contract = record.contract;
      const printButton = button({ label: printLabel(contract), variant: 'ghost', onClick: () => controls.print(recordPrintNode(record)) });
      drawer = sideDrawer({ host, context: record.context, title: record.title, body: recordSections(record), footer: [printButton],
        closeLabel: 'Close', opener: () => (key && main ? [...main.querySelectorAll('button')].find((node) => node.dataset.focusKey === key) : opener),
        onClose: () => { drawer = null; } });
    },
    print: (record) => {
      if (print) { print(record); return; }
      finishPrint?.();
      const preview = el('div', 'gcsp gcsp-account-print-record');
      preview.append(screenIntro({ title: 'Account contract record', level: 1 }), record);
      root.append(preview); root.classList.add('gcsp-account-printing');
      finishPrint = () => {
        preview.remove(); root.classList.remove('gcsp-account-printing');
        root.ownerDocument.defaultView.removeEventListener('afterprint', finishPrint); finishPrint = null;
      };
      root.ownerDocument.defaultView.addEventListener('afterprint', finishPrint, { once: true });
      try { root.ownerDocument.defaultView.print(); } catch { finishPrint(); }
    },
  };
  function draw(focus = false) {
    if (!main || disposed) return;
    renderAccountBody(main, { model: toAccountView(envelope), draft, offers, activity, pending, message, journey, controls, order: orderRow, orderVehicle, restarted, reload });
    if (message) live.announce(`${message.title}. ${message.text}`);
    if (focus) { const title = main.querySelector('h1'); title.tabIndex = -1; title.focus(); }
  }
  // Only a listed order shows the area; a failed list leaves the account as it was (null = failed, orderUuid null = none).
  async function listLatest() {
    if (typeof orderAdapter?.listOrders !== 'function') return { orderUuid: null };
    try {
      const listed = await orderAdapter.listOrders({ signal: abort.signal });
      return listed?.status === 'ok' ? { orderUuid: latestOrderId(listed.value?.orders), orders: listed.value?.orders } : null;
    } catch { return null; }
  }
  async function describeOrder({ orderUuid, orders }) {
    try {
      const order = typeof adapter.readOrder === 'function' ? await read('readOrder') : null;
      return { orderUuid, car: orderCar(order, orderUuid), row: orders.find((item) => item?.orderUuid === orderUuid) };
    } catch { return null; }
  }
  async function findOrder() {
    const latest = await listLatest();
    return latest?.orderUuid ? describeOrder(latest) : null;
  }
  // The order's progress lives on its own page; the account keeps only its row and car.
  function holdOrder({ row, car }) { orderRow = row; orderVehicle = car; }
  async function loadAccount() {
    const version = ++generation;
    const [accountResult, draftResult, offerResult, activityResult, found] = await Promise.all([read('readAccount'), read('readDraft'),
      typeof adapter.readOffers === 'function' ? read('readOffers') : null,
      typeof adapter.readActivity === 'function' ? read('readActivity') : null, findOrder()]);
    if (disposed || version !== generation) return { status: 'unavailable' };
    orderRow = null; orderVehicle = null;
    if (found) holdOrder(found);
    envelope = accountResult; draft = draftResult; offers = offerResult?.status === 'ok' ? offerResult.value.offers : [];
    activity = activityResult;
    const model = toAccountView(envelope);
    if (isRunRestarted(envelope)) return { status: envelope.status };
    return { status: envelope.status === 'ok' ? 'ready' : 'unavailable', ...accountIdentity(model.account),
      context: [model.account?.company, model.account?.gradeId && `Grade ${model.account.gradeId}`].filter(Boolean).join(', ') };
  }
  async function refresh() {
    if (pending || disposed) return;
    pending = true; message = null; restarted = false; live.clear(); draw();
    drawer?.close(false); teardown(); main = null;
    teardown = mountEmployee(root, { brand, ...shellAdapter }); keepLive();
    try { await loading; } finally { pending = false; draw(true); }
  }
  // Quiet re-read after a presenter action: the shell and order card stay mounted; a failed read leaves the view as it was.
  const FOCUSABLE = 'button, a[href]';
  const keepLive = () => { if (!live.root.isConnected) root.append(live.root); };
  async function sync() {
    if (pending || disposed || !main) return;
    const version = ++syncVersion; const base = generation;
    const [accountResult, draftResult, offerResult, activityResult, latest] = await Promise.all([read('readAccount'), read('readDraft'),
      typeof adapter.readOffers === 'function' ? read('readOffers') : null,
      typeof adapter.readActivity === 'function' ? read('readActivity') : null, listLatest()]);
    if (disposed || pending || !main || version !== syncVersion || base !== generation) return;
    if (accountResult?.status !== 'ok' || !['ok', 'not-found'].includes(draftResult?.status) || !latest) return;
    const before = JSON.stringify([envelope, draft, offers, activity, orderRow?.orderUuid]);
    const same = Boolean(latest.orderUuid) && latest.orderUuid === orderRow?.orderUuid;
    const next = latest.orderUuid && !same ? await describeOrder(latest) : null;
    if (disposed || pending || !main || version !== syncVersion || base !== generation || latest.orderUuid && !same && !next) return;
    if (same) orderRow = latest.orders.find((item) => item?.orderUuid === latest.orderUuid) ?? orderRow;
    else { orderRow = null; orderVehicle = null; if (next) holdOrder(next); }
    envelope = accountResult; draft = draftResult; if (offerResult?.status === 'ok') offers = offerResult.value.offers;
    if (activityResult?.status === 'ok') activity = activityResult;
    if (JSON.stringify([envelope, draft, offers, activity, orderRow?.orderUuid]) === before) return;
    const win = root.ownerDocument.defaultView; const held = main.contains(root.ownerDocument.activeElement) && root.ownerDocument.activeElement.closest(FOCUSABLE);
    const key = held ? focusKeyOf(held) : null;
    keepScroll(win, () => draw());
    if (key) { const target = findByFocusKey(main, key, FOCUSABLE) || main.querySelector('h1'); if (target?.tagName === 'H1') target.tabIndex = -1; target?.focus(); }
    keepLive(); live.clear(); live.announce('Account updated.');
  }
  function emitSaved() {
    const value = draft.value;
    const { mode, oldContractId, slotId, schemeId } = value.choices;
    journey = true; message = null; draw(true);
    notify('gcsp:journey-start', { mode, oldContractId: oldContractId ?? null, slotId, schemeId,
      draftVersion: value.draftVersion, contextVersion: value.contextVersion });
  }
  function failed(result) {
    if (isRunRestarted(result)) { restarted = true; message = null; return; }
    if (result?.code === 'read-only-visual-fixture') {
      message = { title: 'Read-only account preview', text: 'This preview is read-only, so the journey cannot be saved.' }; return;
    }
    const stale = ['stale-version', 'conflict'].includes(result?.status) || result?.value?.requiresRefresh;
    message = { error: true, title: stale ? 'Your context has changed' : 'Journey could not be saved',
      text: stale ? 'Refresh and review your account before trying again.' : 'Your current car is unchanged. Refresh to recover your saved journey.' };
  }
  async function start(action) {
    if (pending || disposed) return;
    pending = true; message = null; draw();
    try {
      draft = await read('readDraft');
      if (disposed) return;
      const same = draft.status === 'ok' && !draft.value.requiresRefresh && draft.value.contextVersion === envelope.value?.contextVersion
        && Object.entries(journeyIntent(action)).every(([key, value]) => (draft.value.choices[key] ?? null) === value);
      if (same) { emitSaved(); return; }
      const result = await adapter.startJourney({ account: envelope, action, draft,
        reviewedContextVersion: draft?.value?.requiresRefresh && draft.value.contextVersion !== envelope.value?.contextVersion
          ? envelope.value?.contextVersion : null, commandId: `account-${globalThis.crypto.randomUUID()}` }, { signal: abort.signal });
      if (disposed) return;
      if (result?.status === 'ok') { draft = result; emitSaved(); } else failed(result);
    } catch { if (!disposed) failed(failure); }
    finally { pending = false; draw(true); }
  }
  async function resume() {
    if (pending || disposed) return;
    pending = true; message = null; draw();
    try {
      draft = await read('readDraft');
      if (disposed) return;
      const action = envelope?.value?.actions?.find((item) => item.enabled && Object.entries(journeyIntent(item))
        .every(([key, value]) => (draft?.value?.choices?.[key] ?? null) === value));
      if (draft.status === 'ok' && !draft.value.requiresRefresh && draft.value.contextVersion === envelope.value.contextVersion && action) emitSaved();
      else failed(draft);
    } finally { pending = false; draw(true); }
  }
  const shellAdapter = { signOut, loadAccount: () => { loading = loadAccount(); return loading; },
    renderBody: (target) => { main = target; draw(); } };
  teardown = mountEmployee(root, { brand, ...shellAdapter }); keepLive();
  const destroy = () => { disposed = true; generation += 1; abort.abort(); drawer?.close(false); finishPrint?.(); teardown(); live.root.remove(); };
  destroy.refresh = refresh;
  destroy.sync = sync;
  return destroy;
}

export class GcspAccountElement extends HTMLElement {
  static get observedAttributes() { return ['brand']; }
  constructor() {
    super();
    if (Object.hasOwn(this, 'adapter')) { const adapter = this.adapter; delete this.adapter; this._adapter = adapter; }
  }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  attributeChangedCallback(name, oldValue, newValue) { if (oldValue !== newValue && this.isConnected) this._mount(); }
  _mount() { this._teardown?.(); this._teardown = mountAccount(this, { adapter: this._adapter, brand: this.getAttribute('brand') ?? 'bmw' }); }
  refresh() { return this._teardown?.refresh(); }
}

export function defineGcspAccount(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-account')) registry.define('gcsp-account', GcspAccountElement);
  return registry.get('gcsp-account');
}

export default function decorate(block, options) { return mountAccount(block, options); }
