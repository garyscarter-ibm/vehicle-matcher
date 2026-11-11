import { accountIdentity } from '../shell/account-runtime.js';
// Account page composition. Account authority and durable journey state stay in the adapter.
import { el, screenIntro, button, statusScreen, factList, formatTerm, formatPointsCost } from '../../vehicle-matcher/ui.js';
import { mediaWell, FUEL_SPEC } from '../../vehicle-matcher/modes/result-card.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { runRestartedScreen, isRunRestarted } from '../kit/run-restarted.js';
import { countdown } from '../employee/representative-body.js';
import { toAccountView, journeyIntent } from './account-view.js';
import { createAccountHttpAdapter } from './http-adapter.js';
import { viewStatus } from '../kit/view-status.js';
import { starRating } from '../kit/star-rating.js';
import { latestOrderId } from '../order-progress/order-progress-controller.js';
import { orderCar } from '../order-progress/order-car.js';
import { sentence, orderCopy } from '../order-progress/order-progress-copy.js';
import { orderIdentityRows, orderReferenceOf } from '../kit/order-identity.js';
import { focusKeyOf, findByFocusKey, keepScroll } from '../kit/focus-key.js';
import { dataTable } from '../kit/data-table.js';
import { sideDrawer } from '../kit/side-drawer.js';
import { NO_IMAGE_TEXT, NO_IMAGE_YOUR_CAR } from '../kit/plain-copy.js';
import { routePortal, PORTAL_ROUTES } from '../employee/portal-navigation.js';

let serial = 0;
const MISSING = 'Not supplied';
const failure = { status: 'unavailable', code: 'account-transport-unavailable' };
const states = {
  'absent-hr-account': ['Your HR account is missing', 'Contact HR support to check your employee account.'],
  'not-yet-eligible': ['Replacement is not available yet', 'Your collection window doesn\u2019t allow a replacement yet.'],
  'ordering-closed': ['Too late to order before renewal', 'No collection date fits before your contract ends. Scheme support can help with your renewal.'],
  'no-entitlement': ['No ordering entitlement', 'Scheme support can check your entitlement.'],
  'unsupported-scheme': ['Ordering is not supported for this scheme', null],
  'no-contract': ['Your current contract is missing', 'Scheme support must check the contract linked to your vehicle slot.'],
  'source-failure': ['Your account is unavailable', 'Refresh to try again, or contact scheme support.'],
  refused: ['This account cannot be opened', 'Reopen your employee session or contact scheme support.'],
  conflict: ['Your account has changed', 'Refresh to see the latest.'],
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
    row('Specification provenance', sourceLabel(technical.provenance ?? technical.source ?? contract.source)),
    row('Image source', contract.media?.provenance)];
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

const points = (value) => Number.isFinite(value) ? value.toLocaleString('en-GB') : null;

const mediaColumn = (media) => { const column = el('div', 'gcsp-feature-media'); column.append(media); return column; };

// Authoritative terms only: the contract's own, else its vehicle points; the account allowance fills the trusted scheme alone.
function pointsTerms(contract, model) {
  const terms = { kind: 'points-monthly', ...contract.terms };
  if (!Object.hasOwn(terms, 'value') && Number.isFinite(contract.vehicle?.points)) terms.value = contract.vehicle.points;
  if (!Object.hasOwn(terms, 'allowance') && contract.schemeId === model.choices?.schemeId && model.allowance?.status !== 'unknown') {
    terms.allowance = model.allowance?.monthlyPoints ?? model.allowance?.value;
  }
  return terms;
}

function currentCar(contract, model, controls, explained = false) {
  const terms = pointsTerms(contract, model);
  const feature = el('section', 'gcsp-feature');
  feature.dataset.contractId = contract.contractId;
  const heading = el('h2', 'gcsp-h2', contract.model ?? 'Current car: model not supplied');
  heading.id = `gcsp-account-car-${++serial}`;
  feature.setAttribute('aria-labelledby', heading.id);
  const source = contract.media;
  const { media } = mediaWell({ name: contract.model ?? 'Current car', photo: source?.src ?? source?.photo ?? '',
    line: '', alt: source?.alt ?? contract.model ?? 'Car' }, 'gcsp-media gcsp-media-whole', { placeholder: NO_IMAGE_YOUR_CAR });
  const scheme = schemeName(model, contract.schemeId);
  const title = el('div', 'gcsp-account-title');
  title.append(heading);
  const spec = [contract.vehicle?.configuration, FUEL_SPEC[contract.vehicle?.fuel]].filter(Boolean).join(' \u00b7 ');
  if (spec) title.append(el('p', 'gcsp-account-spec', spec));
  const state = contract.daysRemaining == null ? el('p', 'gcsp-note', 'Contract end: Not supplied')
    : el('p', 'gcsp-countdown', `Contract ${countdown(model.asOf.slice(0, 10), contract.contractEndDate)} \u00b7 ${date(contract.contractEndDate)}`);
  const copy = el('div', 'gcsp-feature-copy');
  copy.append(title, state);
  // The countdown already says the end date and the panel is the current car, so neither repeats as a fact (Gary, 11 Nov).
  const list = suppliedFacts([row('Driver', contract.driver?.name), row('Term', contract.months, 'months'), row('Annual mileage', contract.annualMileage, contract.mileageUnit), row('Scheme', scheme),
    row('Registration', contract.registration), row('Current mileage', contract.currentOdometer), ...slotRows(model, contract.slotId),
    row('Points cost', formatPointsCost(terms))], 'gcsp-account-facts gcsp-account-car-facts');
  copy.append(list);
  const override = Number.isFinite(terms.allowance) ? overrideText(model) : null;
  if (override) copy.append(el('p', 'gcsp-synthetic', override));
  const more = suppliedFacts([row('Collected', date(contract.actualCollectionDate)), row('Replacement collection', windowText(contract)),
    ...orderRows(contract), row('Delivered VIN', contract.vin)], 'gcsp-account-facts');
  if (more) {
    const details = el('details', 'gcsp-details');
    details.append(el('summary', 'gcsp-details-summary', 'Order, collection and vehicle details'), more);
    copy.append(details);
  }
  if (contract.action) { const actions = el('div', 'gcsp-actions'); actions.append(controls.startButton(contract.action)); copy.append(actions); }
  else if (!explained) copy.append(el('p', 'gcsp-note', 'Replacement isn\u2019t available for this car.'));
  feature.append(mediaColumn(media), copy);
  controls.rateCar?.(feature);
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
    alt: name ?? 'Car' }, 'gcsp-media gcsp-media-whole', { placeholder: NO_IMAGE_YOUR_CAR });
  const copy = el('div', 'gcsp-feature-copy');
  const title = el('div', 'gcsp-account-title');
  title.append(heading);
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

// One labelled summary: a heading, plain lines and the state's actions.
function heroBlock(title, lines, actions) {
  const card = el('section', 'gcsp-summary'); card.setAttribute('aria-label', title);
  card.append(el('h2', 'gcsp-h2', title), ...lines.map((line) => el('p', 'gcsp-note', line)), ...actions);
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
  const only = model.histories.flatMap((history, index) => !history.orderingSupported && history.count ? [schemeTitle(history, index)] : []);
  // Empty schemes say nothing (Paula P10); a history-only scheme says so once.
  if (only.length && model.state !== 'unsupported-scheme') section.append(el('p', 'gcsp-synthetic', `${join(only, 'and')} ${only.length === 1 ? 'shows' : 'show'} history only; you can't order through ${only.length === 1 ? 'it' : 'them'} here.`));
  return section;
}

// Inline confirmation; Escape acts as Keep it. Focus lands here when it opens.
function discardConfirm(controls, pending) {
  const box = el('div', 'gcsp-discard-confirm');
  box.tabIndex = -1; box.setAttribute('role', 'group');
  const question = el('p', 'gcsp-note', 'Discard this journey? Your current car and any offers are not affected.');
  question.id = `gcsp-discard-question-${++serial}`; box.setAttribute('aria-labelledby', question.id);
  const actions = el('div', 'gcsp-actions');
  actions.append(button({ label: 'Discard journey', disabled: pending, onClick: controls.confirmDiscard }),
    button({ label: 'Keep it', variant: 'ghost', disabled: pending, onClick: controls.keep }));
  box.append(question, actions);
  box.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !pending) { event.preventDefault(); controls.keep(); } });
  return box;
}

// This is page layout rather than a stock decision card: a delivered car has no stock eligibility decision.
export function renderAccountBody(main, { model, draft, offers = [], pending = false, message, journey = false, confirmDiscard = false, controls, order, orderVehicle, restarted = false, reload, preferences } = {}) {
  const wrap = el('div', 'vm gcsp-rep gcsp-account-body');
  wrap.setAttribute('aria-busy', String(pending));
  const head = el('div', 'gcsp-account-head');
  head.append(screenIntro({ title: journey ? 'Your saved journey' : 'Your cars', level: 1, className: 'gcsp-intro' }));
  wrap.append(head);
  // A restarted run needs a reload, so nothing else on the page can work.
  if (restarted || model.state === 'restarted' || isRunRestarted(draft)) {
    wrap.append(runRestartedScreen({ reload })); main.replaceChildren(wrap); return () => wrap.remove();
  }
  // Presenter actions refresh the page; Refresh shows only after a failure, a conflict or a stale saved journey.
  const failedRead = ['source-failure', 'conflict', 'refused'].includes(model.state);
  const refreshButton = (variant) => button({ label: 'Refresh', variant, disabled: pending, onClick: controls.refresh });
  const stale = message?.error || draft?.value?.requiresRefresh || (draft && !['ok', 'not-found'].includes(draft.status));
  if (stale && !failedRead) head.append(refreshButton('ghost'));
  if (message) { const note = statusScreen({ title: message.title, message: message.text, role: null }); note.classList.add('gcsp-account-message'); wrap.append(note); }
  const ordered = !journey && model.state === 'no-entitlement' && order
    && model.slots.some((slot) => slot.entitlementSlotId === order.entitlementSlotId);
  if (!journey && order) wrap.append(newCarRow(order, orderVehicle, controls));
  if (!ordered && states[model.state]) {
    const [title, text] = states[model.state];
    // A failed read gets one region: Refresh is its primary and support the outline.
    const actions = el('div', 'gcsp-actions');
    actions.append(...(failedRead ? [refreshButton('primary')] : []),
      controls.supportButton(model.state === 'absent-hr-account' ? 'hr-support' : model.supportOwner, 'Contact support'));
    wrap.append(statusScreen({ title, message: text, role: null, actions: [actions] }));
  }
  const held = !journey && offerHeld(offers) && Boolean(controls.openOffer);
  // An accepted newest offer has become an order, so its progress replaces the offer link.
  const offerShown = !journey && offers.length && offers[0].state !== 'accepted' && controls.openOffer;
  if (offerShown && model.account) {
    wrap.append(heroBlock('Your car offer', ['Your buddy found a car for you. Check its details and deadline.',
      ...(held ? ['Decide on your car offer before choosing another car.'] : [])],
    [button({ label: 'View your offer', disabled: pending, onClick: () => controls.openOffer(offers[0]) })]));
  }
  // FUCQ-224: once the slot has an order, its progress replaces the saved journey card.
  const superseded = ordered && draft?.status === 'ok' && draft.value.choices?.slotId === order.entitlementSlotId;
  if (draft?.status === 'ok' && !superseded) {
    const value = draft.value;
    const choices = value.choices;
    const saved = el('section', 'gcsp-summary');
    saved.append(el('h2', 'gcsp-h2', choices.mode === 'replacement' ? 'You started choosing a replacement' : 'You started a new car order'),
      el('p', 'gcsp-note', value.draftStage === 'intent' ? 'Nothing is held or ordered yet.' : 'Your order choices are saved. Nothing is ordered yet.'),
      facts([row('Current car', contractModel(model, choices.oldContractId)), ...slotRows(model, choices.slotId)]));
    if (value.requiresRefresh) saved.append(el('p', 'gcsp-note', 'Your saved context has changed. Refresh, review the account below, then start the permitted journey again.'));
    else if (confirmDiscard && controls.discard) saved.append(discardConfirm(controls, pending));
    else {
      const actions = el('div', 'gcsp-actions');
      actions.append(button({ label: 'Carry on', variant: held ? 'ghost' : 'primary', disabled: pending, onClick: controls.resume }));
      if (controls.discard) actions.append(button({ label: 'Discard', variant: 'ghost', disabled: pending, onClick: controls.askDiscard }));
      saved.append(actions);
    }
    if (journey) saved.append(button({ label: 'Back to account', variant: 'ghost', disabled: pending, onClick: controls.back }));
    wrap.append(saved);
  } else if (draft && !['ok', 'not-found'].includes(draft.status) && !failedRead) {
    wrap.append(statusScreen({ title: 'Saved journey could not be read', message: 'Refresh before starting or resuming a journey.', role: null }));
  }
  if (model.account) {
    // FUCQ-237: an order in progress replaces "No current car" for an employee with no current car; a declined order keeps it.
    const none = !model.currentContracts.length && !model.currentOrders.length;
    // Without a current car there is no Points cost row, so the allowance (and any override, FUCQ-277) joins the one region.
    const base = model.allowance?.monthlyPoints ?? model.allowance?.value;
    const line = none ? [Number.isFinite(base) && `Your allowance is ${points(base)} points a month`, overrideText(model)].filter(Boolean).join('. ') : '';
    const starts = model.actions.filter((item) => item.action === 'order').map((action) => controls.startButton(action));
    const startRow = () => { const row = el('div', 'gcsp-actions'); row.append(...starts); return row; };
    const noCar = (message) => statusScreen({ title: 'No current car', message: [message, line && `${line}.`].filter(Boolean).join(' ') || null,
      role: null, actions: starts.length ? [startRow()] : [] });
    for (const contract of model.currentContracts) wrap.append(currentCar(contract, model, controls, Boolean(states[model.state])));
    for (const car of model.currentOrders) wrap.append(orderCurrentCar(car, order, orderVehicle));
    const shownNoCar = none && (model.carReturned || !(ordered && order.outcome !== 'declined'));
    if (shownNoCar) wrap.append(noCar(model.carReturned ? 'Your previous car has been returned. Your new car becomes current at handover.'
      : null));
    else { if (line) wrap.append(el('p', 'gcsp-note', `${line}.`)); wrap.append(...starts); }
    if (preferences) wrap.append(preferences);
    const secondary = el('div', 'gcsp-account-secondary');
    secondary.append(orderHistory(model, { order, orderVehicle, controls }), yourDetails(model, controls));
    wrap.append(secondary);
  }
  main.replaceChildren(wrap);
  return () => wrap.remove();
}

export function mountAccount(root, { adapter = createAccountHttpAdapter(), brand = 'bmw', onSupport, onNavigate, print, orderAdapter, helpAdapter, reload, preferences, notifications, signOut = adapter.readOnly !== true } = {}) {
  const abort = new AbortController();
  let envelope; let draft; let offers; let main; let pending = false; let message = null; let journey = false; let disposed = false;
  let generation = 0; let teardown; let loading; let finishPrint; let drawer; let orderRow; let orderVehicle; let restarted = false;
  let confirming = false; let syncVersion = 0; let region; let regionTeardown; const live = viewStatus();
  const ratings = new Map(); let rater; let stopRater;
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
    rateCar: (feature) => rateCar(feature),
    ...(typeof adapter.discardDraft === 'function' ? {
      discard: true, askDiscard: () => askDiscard(), keep: () => keepDraft(), confirmDiscard: () => discardJourney() } : {}),
    supportButton: (route, text) => button({ label: text, variant: 'ghost', onClick: () => {
      onSupport?.(route); notify('gcsp:support', { route });
      message = { title: 'Support route', text: `Support route: ${route}.` }; live.clear(); draw(true);
    } }),
    go: (key) => (onNavigate ?? ((to) => routePortal(to, root.ownerDocument.defaultView.location)))(key),
    startButton: (action) => button({ label: action.action === 'replace' ? 'Choose a replacement' : 'Start a new order',
      variant: !journey && offerHeld(offers) ? 'ghost' : 'primary',
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
  // One region node for the page's life: a mounted capability survives every redraw, and owns the content once supplied.
  function preferencesRegion() {
    if (region) return region;
    region = el('section', 'gcsp-account-preferences'); region.id = 'gcsp-account-preferences';
    if (preferences) {
      region.setAttribute('aria-label', 'Your preferences');
      regionTeardown = preferences(region, { signal: abort.signal });
      const found = regionTeardown?.controller;
      if (['rate', 'subscribe', 'snapshot'].every((name) => typeof found?.[name] === 'function')) { rater = found; stopRater = rater.subscribe(showRatings); }
      return region;
    }
    const title = el('h2', 'gcsp-h2', 'Your preferences'); title.id = 'gcsp-account-preferences-title';
    region.setAttribute('aria-labelledby', title.id);
    region.append(title, el('p', 'gcsp-note', 'Tell your buddy what matters in your next car.'),
      button({ label: 'Edit your preferences', variant: 'ghost', href: PORTAL_ROUTES.brief,
        onClick: (event) => { event.preventDefault(); controls.go('brief'); } }));
    return region;
  }
  // One persistent star rating per current car, from the preferences controller's rating lane; no lane, no stars.
  function rateCar(feature) {
    const lane = rater?.snapshot().rating; const id = feature.dataset.contractId;
    if (!lane || lane.contractId !== id) return;
    if (!ratings.has(id)) {
      const heading = feature.querySelector('.gcsp-h2')?.textContent; const spec = feature.querySelector('.gcsp-account-spec')?.textContent;
      const description = [heading, spec].filter(Boolean).join(' ');
      const question = `How highly do you rate your ${description}?`;
      ratings.set(id, starRating({ label: question, help: question, value: lane.value, overlay: true, onChange: (next) => rater.rate(next, id), onRetry: () => rater.retry(),
        announce: (text) => { live.clear(); live.announce(text); } }));
    }
    feature.querySelector('.vm-card-media')?.append(ratings.get(id).root);
  }
  function showRatings(snap) {
    const lane = snap.rating;
    if (lane && !ratings.has(lane.contractId)) { for (const feature of main?.querySelectorAll('.gcsp-feature[data-contract-id]') ?? []) rateCar(feature); }
    const shown = lane && ratings.get(lane.contractId);
    if (shown) shown.update({ value: lane.value, status: lane.status, disabled: snap.disabled });
  }
  function draw(focus = false) {
    if (!main || disposed) return;
    const inRating = [...ratings.values()].find((item) => item.root.contains(root.ownerDocument.activeElement));
    const focused = inRating && root.ownerDocument.activeElement;
    if (draft?.status !== 'ok') confirming = false;
    const model = toAccountView(envelope);
    renderAccountBody(main, { model, draft, offers, pending, message, journey, confirmDiscard: confirming, controls, order: orderRow, orderVehicle, restarted, reload,
      preferences: model.account ? preferencesRegion() : undefined });
    if (message) live.announce(`${message.title}. ${message.text}`);
    if (focused && focused.isConnected && root.ownerDocument.activeElement !== focused) focused.focus();
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
    const [accountResult, draftResult, offerResult, found] = await Promise.all([read('readAccount'), read('readDraft'),
      typeof adapter.readOffers === 'function' ? read('readOffers') : null, findOrder()]);
    if (disposed || version !== generation) return { status: 'unavailable' };
    orderRow = null; orderVehicle = null;
    if (found) holdOrder(found);
    envelope = accountResult; draft = draftResult; offers = offerResult?.status === 'ok' ? offerResult.value.offers : [];
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
    const [accountResult, draftResult, offerResult, latest] = await Promise.all([read('readAccount'), read('readDraft'),
      typeof adapter.readOffers === 'function' ? read('readOffers') : null, listLatest()]);
    if (disposed || pending || !main || version !== syncVersion || base !== generation) return;
    if (accountResult?.status !== 'ok' || !['ok', 'not-found'].includes(draftResult?.status) || !latest) return;
    const before = JSON.stringify([envelope, draft, offers, orderRow?.orderUuid]);
    const same = Boolean(latest.orderUuid) && latest.orderUuid === orderRow?.orderUuid;
    const next = latest.orderUuid && !same ? await describeOrder(latest) : null;
    if (disposed || pending || !main || version !== syncVersion || base !== generation || latest.orderUuid && !same && !next) return;
    if (same) orderRow = latest.orders.find((item) => item?.orderUuid === latest.orderUuid) ?? orderRow;
    else { orderRow = null; orderVehicle = null; if (next) holdOrder(next); }
    envelope = accountResult; draft = draftResult; if (offerResult?.status === 'ok') offers = offerResult.value.offers;
    if (JSON.stringify([envelope, draft, offers, orderRow?.orderUuid]) === before) return;
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
  const focusIn = (selector) => { const node = main?.querySelector(selector); if (node) node.focus(); };
  const discardButton = () => [...(main?.querySelectorAll('.gcsp-summary .gcsp-actions button') ?? [])].find((node) => node.textContent === 'Discard');
  function askDiscard() {
    if (pending || disposed) return;
    confirming = true; message = null; draw(); focusIn('.gcsp-discard-confirm');
  }
  function keepDraft() {
    if (pending || disposed) return;
    confirming = false; draw(); discardButton()?.focus();
  }
  function discardFailed(result) {
    if (isRunRestarted(result)) { restarted = true; message = null; return; }
    if (result?.code === 'read-only-visual-fixture') {
      message = { title: 'Read-only account preview', text: 'This preview is read-only, so the journey cannot be discarded.' }; return;
    }
    const held = result?.status === 'conflict' && result.reason === 'release-required';
    const stale = ['stale-version', 'conflict'].includes(result?.status) && !held;
    message = { error: true, title: stale ? 'Your journey has changed' : 'Journey could not be discarded',
      text: held ? 'A car is held for you. Release it before discarding this journey.'
        : stale ? 'We have reloaded it. Check it, then try again.' : 'Your journey is unchanged. Try again in a moment.' };
  }
  async function discardJourney() {
    if (pending || disposed || draft?.status !== 'ok') return;
    pending = true; message = null; draw();
    let done = false;
    try {
      const result = await adapter.discardDraft({ commandId: `account-discard-${globalThis.crypto.randomUUID()}`,
        expectedDraftVersion: draft.value.draftVersion }, { signal: abort.signal });
      if (disposed) return;
      // Already gone counts as discarded; stale means the draft moved on, so show the latest.
      done = ['ok', 'not-found'].includes(result?.status);
      if (done) { confirming = false; journey = false; await loadAccount(); }
      else {
        if (['stale-version', 'conflict'].includes(result?.status)) draft = await read('readDraft');
        confirming = false; discardFailed(result);
      }
    } catch { if (!disposed) { confirming = false; discardFailed(failure); } }
    finally { pending = false; if (!disposed) { draw(done); if (!done) discardButton()?.focus(); } }
  }
  const shellAdapter = { signOut, notifications, loadingLayout: 'feature', loadAccount: () => { loading = loadAccount(); return loading; },
    renderBody: (target) => { main = target; draw(); } };
  teardown = mountEmployee(root, { brand, ...shellAdapter }); keepLive();
  const destroy = () => { disposed = true; generation += 1; abort.abort(); drawer?.close(false); finishPrint?.(); stopRater?.(); regionTeardown?.(); for (const item of ratings.values()) item.destroy(); teardown(); live.root.remove(); };
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
