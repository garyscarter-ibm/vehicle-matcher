// Account page composition. Account authority and durable journey state stay in the adapter.
import { el, screenIntro, button, statusScreen, factList, formatTerm } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { runRestartedScreen, isRunRestarted } from '../kit/run-restarted.js';
import { countdown } from '../employee/representative-body.js';
import { toAccountView, journeyIntent } from './account-view.js';
import { createAccountHttpAdapter } from './http-adapter.js';
import { mountOrderProgress } from '../order-progress/gcsp-order-progress.js';
import { latestOrderId } from '../order-progress/order-progress-controller.js';
import { orderCar } from '../order-progress/order-car.js';
import { sentence } from '../order-progress/order-progress-copy.js';
import { orderIdentityRows, orderReferenceOf } from '../kit/order-identity.js';
import { focusKeyOf, findByFocusKey, keepScroll } from '../kit/focus-key.js';

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
const facts = (rows) => factList(rows, { className: 'gcsp-facts' });
// Raw ids are not copy (FUCQ-195/197): statuses read as words; slots, schemes and sources show only a supplied label.
const statusLabels = { current: 'Current car', returned: 'Returned' };
const status = (value) => statusLabels[value] ?? (/^[a-z]+(-[a-z]+)*$/.test(value ?? '') ? sentence(value.replace(/-/g, ' ')) : value);
const slotRows = (model, slotId) => {
  const name = model?.slots?.find((slot) => slot.entitlementSlotId === slotId)?.label;
  return name ? [row('Vehicle slot', name)] : [];
};
const sourceLabel = (source) => typeof source === 'string' ? source
  : source?.label ?? (source?.mode === 'synthetic' ? 'Synthetic example data' : null);
const technicalLabels = { insuranceGroup: 'Insurance group', nedcCo2: 'NEDC CO2', wltpCo2: 'WLTP CO2',
  fuelConsumptionLow: 'Fuel consumption, low', fuelConsumptionMedium: 'Fuel consumption, medium',
  fuelConsumptionHigh: 'Fuel consumption, high', fuelConsumptionExtraHigh: 'Fuel consumption, extra high',
  fuelConsumptionCombinedWeighted: 'Fuel consumption, combined weighted', electricityConsumption: 'Electricity consumption',
  electricRange: 'Electric range', electricCityRange: 'Electric city range' };
const technicalLabel = (key) => technicalLabels[key] ?? label(key);
const asOf = (value) => Number.isNaN(Date.parse(value ?? '')) ? MISSING
  : new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
// Raw ids are not copy: a scheme row shows only the policy-supplied name; groups fall back to "Scheme N".
const schemeTitle = (history, index) => history.label ?? `Scheme ${index + 1}`;
const schemeRows = (model, schemeId) => {
  const name = model.histories.find((history) => history.schemeId === schemeId)?.label;
  return name ? [row('Scheme', name)] : [];
};
const contractModel = (model, id) => [...model.currentContracts, ...model.histories.flatMap((history) => history.entries)]
  .find((contract) => contract.contractId === id)?.model;
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : shown(value);

function details(title, ...content) {
  const node = el('details', 'gcsp-details');
  node.append(el('summary', 'gcsp-details-summary', title), ...content);
  return node;
}

// Earlier contracts name the car's own number; a reference shows only when the record supplies one.
const orderRows = (contract) => orderIdentityRows(contract.orderReference, contract.orderNumber).map(({ label, value }) => row(label, value));

const printLabel = (contract) => {
  const id = orderReferenceOf(contract.orderReference) ?? contract.orderNumber;
  return id ? `Print record ${id}` : 'Print record';
};

function contractDetails(contract, model) {
  const technical = contract.technical ?? {};
  const standard = ['insuranceGroup', 'transmission', 'nedcCo2', 'wltpCo2', 'fuelConsumptionLow', 'fuelConsumptionMedium',
    'fuelConsumptionHigh', 'fuelConsumptionExtraHigh', 'fuelConsumptionCombinedWeighted', 'electricityConsumption',
    'electricRange', 'electricCityRange', 'exterior', 'interior', 'price', 'options'];
  return details('Order, collection and vehicle details', facts([
    ...slotRows(model, contract.slotId), ...orderRows(contract), row('Order date', date(contract.orderDate)),
    row('Order status', status(contract.orderStatus)), row('Registration', contract.registration),
    row('Delivered VIN', contract.vin), row('Chassis number', contract.chassisNumber), row('Registration date', date(contract.registrationDate)),
    row('Requested collection', date(contract.requestedCollectionDate)), row('Collection location', contract.collectionLocation),
    row('Actual collection', date(contract.actualCollectionDate)), row('Contract end', date(contract.contractEndDate)),
    row('Earliest collection', date(contract.earliestCollectionDate)), row('Latest collection', date(contract.latestCollectionDate)),
    row('Returned', date(contract.returnedDate)), row('Expected return mileage', contract.expectedReturnMileage, contract.returnMileageUnit ?? 'mi'),
    row('Returned mileage', contract.returnedMileage, contract.returnMileageUnit ?? 'mi'),
    row('Current mileage', contract.currentOdometer), row('Phone', contract.contact?.phone), row('Email', contract.contact?.email),
    row('Special requirements', contract.specialRequirements),
  ]), details('Technical specification and options',
    el('p', 'gcsp-note', 'Model or handbook evidence does not confirm the fitted equipment on your car.'),
    facts([...standard.map((key) => row(technicalLabel(key), technical[key] ?? contract[key])),
      ...Object.entries(technical).filter(([key]) => !['provenance', 'source', ...standard].includes(key))
        .map(([key, value]) => row(technicalLabel(key), value)),
      row('Specification provenance', sourceLabel(technical.provenance ?? technical.source ?? contract.source))])));
}

function driverDetails(driver) {
  const licence = driver.licence ?? {};
  const category = (name) => licence[name] ?? licence.categories?.find?.((item) => typeof item === 'object' && item.category === name);
  const categoryRows = (name, title) => {
    const supplied = category(name);
    const present = supplied || licence.categories?.includes(name);
    return [row(`${title} licence type`, supplied?.type),
      row(`${title} valid from`, date(supplied?.validFrom ?? (present ? licence.validFrom : null))),
      row(`${title} valid until`, date(supplied?.validUntil ?? (present ? licence.validUntil : null)))];
  };
  return details(`${driver.name ?? 'Driver'} · ${driver.kind ?? 'driver'}`, facts([
    row('Status', driver.status), row('Eligible', driver.eligible), row('Relationship', driver.relationship),
    row('Date of birth', date(driver.dateOfBirth)), row('Address', driver.address),
    row('Licence number', licence.displayNumber), row('Licence categories', licence.categories), ...categoryRows('car', 'Car'), ...categoryRows('bike', 'Bike'),
  ]));
}

function currentCar(contract, model, controls) {
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
    line: '', alt: source?.alt ?? `${contract.model ?? 'Car'}: representative image`,
    caption: source?.caption ?? 'Representative image, not your exact car' }, 'gcsp-media', { placeholder: 'No image for this car yet' });
  const copy = el('div', 'gcsp-feature-copy');
  copy.append(el('p', 'gcsp-eyebrow', 'Your current car'), heading,
    el('p', 'gcsp-countdown', contract.daysRemaining == null ? 'Contract end: Not supplied'
      : `Contract ${countdown(model.asOf.slice(0, 10), contract.contractEndDate)}, on ${date(contract.contractEndDate)}`),
    facts([row('Status', status(contract.status)), row('Driver', contract.driver?.name),
      row('Contract end', date(contract.contractEndDate)), row('Term', contract.months, 'months'),
      row('Annual mileage', contract.annualMileage, contract.mileageUnit), ...schemeRows(model, contract.schemeId), ...slotRows(model, contract.slotId),
      row('Registration', contract.registration)]),
    el('p', 'gcsp-account-terms', formatTerm(terms)),
    el('p', 'gcsp-note', 'Exact specification is not supplied unless confirmed by delivered-car evidence.'));
  if (source?.provenance) copy.append(el('p', 'gcsp-synthetic', `Image source: ${shown(source.provenance)}`));
  if (contract.action) copy.append(controls.startButton(contract.action));
  else copy.append(el('p', 'gcsp-note', 'Replacement is unavailable for this contract and slot.'));
  copy.append(contractDetails(contract, model));
  feature.append(media, copy);
  return feature;
}

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
    alt: `${name ?? 'Car'}: representative image`, caption: 'Representative image, not your exact car' }, 'gcsp-media', { placeholder: 'No image for this car yet' });
  const copy = el('div', 'gcsp-feature-copy');
  copy.append(el('p', 'gcsp-eyebrow', 'Your current car'), heading,
    facts([row('Status', status('current')), row('Collected', date(car.collectedAt?.slice(0, 10))), ...(car.vin ? [row('Delivered VIN', car.vin)] : []),
      ...(same ? orderIdentityRows(order.source?.orderReference, order.source?.orderNumber).map(({ label, value }) => row(label, value)) : [])]));
  feature.append(media, copy);
  return feature;
}

export { orderCar };

// Outcomes the projection reports (FUCQ-253 adds handed-over); any other outcome is still in progress.
const orderTitles = Object.freeze({ declined: 'Your order was declined', 'handed-over': 'Your car has been handed over' });

// The slot is allocated to this order, so its state replaces "No ordering entitlement". The link moves focus to the progress.
function orderStatus(order, host) {
  const link = button({ label: 'View order progress', variant: 'ghost', href: `#${host.id}`, onClick: (event) => {
    event.preventDefault(); host.tabIndex = -1; host.focus(); } });
  const node = statusScreen({ title: orderTitles[order.outcome] ?? 'Your order is in progress',
    message: order.currentStage ? `Current step: ${sentence(order.currentStage)}.` : null, actions: [link] });
  node.classList.add('gcsp-account-order-status');
  const { orderReference, orderNumber } = order.source ?? {};
  if (orderNumber || orderReferenceOf(orderReference)) node.querySelector('.vm-title').after(facts(orderIdentityRows(orderReference, orderNumber)));
  return node;
}

// This is page layout rather than a stock decision card: a delivered car has no stock eligibility decision.
export function renderAccountBody(main, { model, draft, offers = [], pending = false, message, journey = false, controls, orderHost, order, orderVehicle, restarted = false, reload } = {}) {
  const wrap = el('div', 'vm gcsp-rep gcsp-account-body');
  wrap.setAttribute('aria-busy', String(pending));
  wrap.append(screenIntro({ kicker: 'Choices', title: journey ? 'Your saved journey' : 'Your cars', level: 1, className: 'gcsp-intro' }));
  // A restarted demo needs a reload, so nothing else on the page can work.
  if (restarted || model.state === 'restarted' || isRunRestarted(draft)) {
    wrap.append(runRestartedScreen({ reload })); main.replaceChildren(wrap); return () => wrap.remove();
  }
  const toolbar = el('div', 'gcsp-actions');
  toolbar.append(button({ label: 'Refresh account', variant: 'ghost', disabled: pending, onClick: controls.refresh }));
  wrap.append(toolbar);
  if (message) wrap.append(statusScreen({ title: message.title, message: message.text, role: message.error ? 'alert' : 'status' }));
  const ordered = !journey && orderHost && model.state === 'no-entitlement' && order
    && model.slots.some((slot) => slot.entitlementSlotId === order.entitlementSlotId);
  if (ordered) wrap.append(orderStatus(order, orderHost));
  else if (states[model.state]) {
    const [title, text] = states[model.state];
    wrap.append(statusScreen({ title, message: text, actions: [controls.supportButton(model.state === 'absent-hr-account'
      ? 'hr-support' : model.supportOwner, 'Contact support')] }));
  }
  if (!journey && orderHost) wrap.append(orderHost);
  // An accepted newest offer has become an order, so its progress replaces the offer link.
  if (!journey && offers.length && offers[0].state !== 'accepted' && controls.openOffer) {
    const offer = el('section', 'gcsp-summary'); offer.setAttribute('aria-label', 'Your car offer');
    offer.append(el('h2', 'gcsp-h2', 'Your car offer'), el('p', 'gcsp-note', 'Your buddy found a car for you. Check its details and deadline.'),
      button({ label: 'View your offer', disabled: pending, onClick: () => controls.openOffer(offers[0]) }));
    wrap.append(offer);
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
    else saved.append(button({ label: 'Resume saved journey', disabled: pending, onClick: controls.resume }));
    if (journey) saved.append(button({ label: 'Back to account', variant: 'ghost', disabled: pending, onClick: controls.back }));
    wrap.append(saved);
  } else if (draft && !['ok', 'not-found'].includes(draft.status)) {
    wrap.append(statusScreen({ title: 'Saved journey could not be read', message: 'Refresh before starting or resuming a journey.' }));
  }
  if (model.account) {
    for (const contract of model.currentContracts) wrap.append(currentCar(contract, model, controls));
    for (const car of model.currentOrders) wrap.append(orderCurrentCar(car, order, orderVehicle));
    // FUCQ-237: an order in progress replaces "No current car"; a declined order keeps it. A confirmed return (FUCQ-252) shows it.
    const none = !model.currentContracts.length && !model.currentOrders.length;
    if (none && model.carReturned) wrap.append(statusScreen({ title: 'No current car', message: 'Your previous car has been returned. Your new car becomes current at handover.' }));
    else if (none && !(ordered && order.outcome !== 'declined')) wrap.append(statusScreen({ title: 'No current car', message: 'No current vehicle is supplied for your account.' }));
    for (const action of model.actions.filter((item) => item.action === 'order')) wrap.append(controls.startButton(action));
    const allowance = el('section', 'gcsp-allowance');
    allowance.append(el('h2', 'gcsp-h2', 'Your allowance'), facts([
      row('Monthly allowance', model.allowance?.monthlyPoints ?? model.allowance?.value, 'points a month'),
      row('Allowance override', model.account.allowanceOverride), row('Override end', date(model.account.allowanceOverrideEndDate)),
      row('Allowance basis', model.allowance?.basis),
    ]));
    wrap.append(allowance, details('Employee and contact details',
      facts(model.identityFacts.map((item) => row(item.label, item.value, item.unit))),
      controls.supportButton('hr-support', 'Get help with employee details')));
    const drivers = details(`Drivers and licences (${model.drivers.length})`, ...model.drivers.map(driverDetails),
      controls.supportButton('driver-support', 'Get help with drivers and licences'));
    if (!model.drivers.length) drivers.append(el('p', 'gcsp-note', 'No driver or licence details supplied.'));
    wrap.append(drivers);
    const histories = el('section', 'gcsp-account-histories');
    histories.append(el('h2', 'gcsp-h2', 'Order history'));
    // FUCQ-239: a placed order is listed in Order history; the scheme groups list contract records only.
    const placed = order && model.slots.some((slot) => slot.entitlementSlotId === order.entitlementSlotId);
    if (placed) {
      const entry = el('article', 'gcsp-account-history');
      entry.append(el('h3', 'gcsp-h2', orderVehicle?.name ?? 'Model not supplied'),
        facts([row('Status', status(order.outcome)), ...slotRows(model, order.entitlementSlotId),
          ...orderIdentityRows(order.source?.orderReference, order.source?.orderNumber).map(({ label, value }) => row(label, value))]));
      histories.append(entry);
    }
    if (model.historyState === 'no-history' && !placed) histories.append(el('p', 'gcsp-note', 'No order history.'));
    for (const [index, history] of model.histories.entries()) {
      const group = details(`${schemeTitle(history, index)} (${history.count} record${history.count === 1 ? '' : 's'})`);
      if (!history.orderingSupported) group.append(el('p', 'gcsp-note', 'History is available. Ordering is not supported for this scheme.'));
      if (!history.count) group.append(el('p', 'gcsp-note', 'No orders in this scheme.'));
      for (const contract of history.entries) {
        const entry = el('article', 'gcsp-account-history');
        entry.append(el('h3', 'gcsp-h2', contract.model ?? 'Model not supplied'),
          facts([row('Status', status(contract.status)), row('Driver', contract.driver?.name), ...schemeRows(model, history.schemeId), ...slotRows(model, contract.slotId),
            row('Registration', contract.registration), row('Actual collection', date(contract.actualCollectionDate)),
            row('Contract end', date(contract.contractEndDate)), row('Returned', date(contract.returnedDate))]), contractDetails(contract, model),
          button({ label: printLabel(contract), variant: 'ghost',
            onClick: () => controls.print(entry) }));
        const action = model.actions.find((item) => item.oldContractId === contract.contractId && item.slotId === contract.slotId
          && item.schemeId === history.schemeId);
        if (history.orderingSupported && action) entry.append(controls.startButton(action));
        group.append(entry);
      }
      histories.append(group);
    }
    wrap.append(histories);
    const provenance = model.versions?.employeeContract;
    if (provenance) wrap.append(el('p', 'gcsp-synthetic', `${provenance.mode === 'synthetic' ? 'Synthetic example data. ' : ''}${provenance.label ? `Source: ${provenance.label}. ` : ''}Account as of ${asOf(model.asOf)}.`));
  }
  main.replaceChildren(wrap);
  return () => wrap.remove();
}

export function mountAccount(root, { adapter = createAccountHttpAdapter(), brand = 'bmw', onSupport, print, orderAdapter, helpAdapter, reload } = {}) {
  const abort = new AbortController();
  let envelope; let draft; let offers; let main; let pending = false; let message = null; let journey = false; let disposed = false;
  let generation = 0; let teardown; let loading; let finishPrint; let orderHost; let orderRow; let orderVehicle; let stopOrder; let restarted = false;
  let syncVersion = 0; const live = el('p', 'gcsp-vh'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
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
      message = { title: 'Support route', text: `${route}. This demo does not send a support request.` }; draw(true);
    } }),
    startButton: (action) => button({ label: action.action === 'replace' ? 'Choose a replacement' : 'Start a new order',
      disabled: pending || draft?.status !== 'ok' && draft?.status !== 'not-found', onClick: () => start(action) }),
    print: (entry) => {
      const opened = [...entry.querySelectorAll('details')].filter((item) => !item.open);
      opened.forEach((item) => { item.open = true; });
      const done = () => opened.forEach((item) => { item.open = false; });
      if (print) { try { print(entry); } finally { done(); } }
      else {
        finishPrint?.();
        const preview = el('div', 'gcsp gcsp-account-print-record');
        const record = entry.cloneNode(true);
        record.querySelectorAll('button').forEach((node) => node.remove());
        preview.append(screenIntro({ title: 'Account contract record', level: 1 }), record);
        root.append(preview); root.classList.add('gcsp-account-printing');
        finishPrint = () => {
          done(); preview.remove(); root.classList.remove('gcsp-account-printing');
          root.ownerDocument.defaultView.removeEventListener('afterprint', finishPrint); finishPrint = null;
        };
        root.ownerDocument.defaultView.addEventListener('afterprint', finishPrint, { once: true });
        try { root.ownerDocument.defaultView.print(); } catch { finishPrint(); }
      }
    },
  };
  function draw(focus = false) {
    if (!main || disposed) return;
    renderAccountBody(main, { model: toAccountView(envelope), draft, offers, pending, message, journey, controls, orderHost, order: orderRow, orderVehicle, restarted, reload });
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
  function mountOrder({ row, ...mount }) {
    orderRow = row; orderVehicle = mount.car;
    orderHost = el('section', 'gcsp-account-order'); orderHost.setAttribute('aria-label', 'Your order'); orderHost.id = `gcsp-account-order-${++serial}`;
    stopOrder = mountOrderProgress(orderHost, { ...mount, adapter: orderAdapter, helpAdapter, embedded: true, headingLevel: 2, signal: abort.signal });
  }
  async function loadAccount() {
    const version = ++generation;
    const [accountResult, draftResult, offerResult, found] = await Promise.all([read('readAccount'), read('readDraft'),
      typeof adapter.readOffers === 'function' ? read('readOffers') : null, findOrder()]);
    if (disposed || version !== generation) return { status: 'unavailable' };
    stopOrder?.(); stopOrder = null; orderHost = null; orderRow = null; orderVehicle = null;
    if (found) mountOrder(found);
    envelope = accountResult; draft = draftResult; offers = offerResult?.status === 'ok' ? offerResult.value.offers : [];
    const model = toAccountView(envelope);
    if (isRunRestarted(envelope)) return { status: envelope.status };
    return { status: envelope.status === 'ok' ? 'ready' : 'unavailable', name: model.account?.name ?? 'Account unavailable',
      context: [model.account?.company, model.account?.gradeId && `Grade ${model.account.gradeId}`].filter(Boolean).join(', ') };
  }
  async function refresh() {
    if (pending || disposed) return;
    pending = true; message = null; restarted = false; draw();
    teardown(); main = null;
    teardown = mountEmployee(root, { brand, ...shellAdapter }); keepLive();
    try { await loading; } finally { pending = false; draw(true); }
  }
  // Quiet re-read after a presenter action: the shell and order card stay mounted; a failed read leaves the view as it was.
  const FOCUSABLE = 'button, a[href]'; const ORDER_SECTION = '.gcsp-order-section';
  const keepLive = () => { if (!live.isConnected) root.append(live); };
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
    if (same) { orderRow = latest.orders.find((item) => item?.orderUuid === latest.orderUuid) ?? orderRow; void stopOrder?.sync?.(); }
    else { stopOrder?.(); stopOrder = null; orderHost = null; orderRow = null; orderVehicle = null; if (next) mountOrder(next); }
    envelope = accountResult; draft = draftResult; if (offerResult?.status === 'ok') offers = offerResult.value.offers;
    if (JSON.stringify([envelope, draft, offers, orderRow?.orderUuid]) === before) return;
    const win = root.ownerDocument.defaultView; const held = main.contains(root.ownerDocument.activeElement) && root.ownerDocument.activeElement.closest(FOCUSABLE);
    const key = held ? focusKeyOf(held, ORDER_SECTION) : null;
    keepScroll(win, () => draw());
    if (key) { const target = findByFocusKey(main, key, FOCUSABLE, ORDER_SECTION) || main.querySelector('h1'); if (target?.tagName === 'H1') target.tabIndex = -1; target?.focus(); }
    keepLive(); live.textContent = ''; live.textContent = 'Account updated.';
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
      message = { title: 'Read-only account preview', text: 'This example cannot save a journey. Open the connected demo to continue.' }; return;
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
  const shellAdapter = { loadAccount: () => { loading = loadAccount(); return loading; },
    renderBody: (target) => { main = target; draw(); } };
  teardown = mountEmployee(root, { brand, ...shellAdapter }); keepLive();
  const destroy = () => { disposed = true; generation += 1; abort.abort(); finishPrint?.(); stopOrder?.(); teardown(); live.remove(); };
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
