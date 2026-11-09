import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { matchCard } from '../../vehicle-matcher/modes/result-card.js';
import { syntheticNote } from '../kit/synthetic-note.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { routeAfterRelease } from '../employee/portal-navigation.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';
import { labelledField, errorSummary } from '../kit/form-controls.js';
import { bodyStyleLabel, longDate } from '../kit/plain-copy.js';
import { demoTime } from '../kit/activity-timeline.js';
import { createManualReviewController } from './review-controller.js';
import { createManualReviewHttpAdapter } from './http-adapter.js';

let serial = 0;
const label = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
// Data codes that are not words: the label already names them (FUCQ-197).
const HIDDEN_UNITS = new Set(['insurance-group']);
function shown(value) {
  if (value == null || value === '' || value?.status === 'unknown') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(shown).filter((item) => item != null).join(', ') || null;
  if (typeof value === 'object') {
    if ('value' in value) {
      const amount = shown(value.value);
      return amount == null ? null : [amount, HIDDEN_UNITS.has(value.unit) ? null : value.unit, value.basis].filter(Boolean).join(' ');
    }
    return Object.entries(value).filter(([key]) => !['provenance', 'source'].includes(key))
      .map(([key, item]) => `${label(key)}: ${shown(item) ?? 'Not supplied'}`).join('; ') || null;
  }
  return String(value);
}
const rows = (values) => factList(values.map(([name, value, unit]) => ({ label: name, value: shown(value), unit })));
const known = (value) => value?.status === 'known' ? shown(value) : null;
const bodyFact = (fact) => fact?.status === 'known' && typeof fact.value === 'string' ? { ...fact, value: bodyStyleLabel(fact.value) } : fact;

// Display the pinned quote, with no selection or claim action.
export function reviewVehicleView(model) {
  const quote = model.quote; const snapshot = quote.facts ?? {}; const display = snapshot.display ?? {};
  const facts = snapshot.facts ?? {}; const image = display.images?.find((item) => item.src === display.photo);
  const terms = quote.terms?.kind === 'employee-scheme' ? quote.terms : null;
  const points = (value) => value?.unit === 'points' && Number.isFinite(value.value) ? value.value : null;
  const member = { id: quote.orderUuid, identity: { orderUuid: quote.orderUuid, configurationId: quote.configurationId },
    display: { name: display.name || 'Car name not supplied', line: `Car order ${model.orderNumber}` },
    media: { src: display.photo || '', alt: image?.alt || `${display.name || 'Car'}: representative image`,
      caption: image?.caption || 'Representative image, not your exact car' },
    facts: [['Model', facts.model ?? facts.marketingModelRange ?? facts.modelRange], ['Body style', bodyFact(facts.body ?? facts.bodyType)],
      ['Engine', facts.engine], ['Exterior', facts.exterior ?? facts.colour], ['Interior', facts.interior ?? facts.upholsteryCode],
      ['Transmission', facts.transmission], ['Insurance group', facts.insuranceGroup]]
      .map(([name, value]) => ({ label: name, value: known(value) })).concat([{ label: 'Car order number', value: model.orderNumber }]),
    terms: [{ kind: 'points-monthly', value: points(terms?.points), allowance: points(terms?.allowanceInputs?.allowance) }],
    decision: { gateStatus: ['eligible', 'ineligible', 'needs-confirmation'].includes(quote.eligibility?.state) ? quote.eligibility.state : null, reasons: [], blockers: [], unknowns: [], tradeOffs: [] }, actions: [] };
  return { schemaVersion: 1, selectedId: member.id, members: [member] };
}
const messages = {
  loading: 'Checking your current claim.', saving: 'Saving your details.',
  continuing: 'Checking your details and order review.', releasing: 'Releasing this car.',
  locked: 'Your details are locked while selection is checked.',
  pending: 'The outcome is still being checked. Check again before continuing.',
  expired: 'Your reservation has expired. Your entries are retained. Refresh stock to choose again.',
  released: 'This car has been released. Refresh stock to choose again.',
  unavailable: 'The current claim could not be confirmed. Your entries are retained. Check again.',
  conflict: 'Your saved review has changed. Your local entries are retained. Review the newer details.',
};

/** Hosts connect subscribeClock to presenter ticks and own gallery/submission navigation. */
export function mountManualReviewBody(root, { adapter = createManualReviewHttpAdapter(), handoff,
  onContinue, onReleased, onBrowse, commandId, subscribeClock } = {}) {
  const prefix = `gcsp-review-${++serial}`; const fields = {}; const controls = {};
  let disposed = false; let panel; let nodes; let summary; let lastVehicle; let announcementId;
  const notify = (type, detail) => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent(type,
    { detail, bubbles: true, composed: true }));
  const controller = createManualReviewController({ adapter, commandId, onChange: draw,
    onContinue: (detail) => { if (!disposed) { onContinue?.(detail); notify('gcsp:manual-review-ready', detail); } },
    onReleased: (detail) => { if (!disposed) { onReleased?.(detail); notify('gcsp:manual-review-released', detail); } } });
  function field(key, title, type, hint = '') {
    const control = el(type === 'textarea' ? 'textarea' : 'input', '');
    if (type !== 'textarea') control.type = type;
    control.name = key; controls[key] = control;
    const presentation = labelledField({ id: `${prefix}-${key.replaceAll('.', '-')}`, label: title, control, hint }); fields[key] = presentation;
    control.addEventListener('input', () => controller.edit(key, key === 'expectedReturnMileage'
      ? control.value === '' ? null : Number(control.value) : control.value));
    return presentation.root;
  }
  async function action(run) {
    const result = await run(); if (disposed) return;
    if (result?.status === 'invalid') summary?.focus(); else if (result?.status !== 'ok') nodes?.notice.focus();
  }
  function build() {
    panel = el('div', 'vm gcsp-review-body');
    nodes = { vehicle: el('div', 'gcsp-review-vehicle'), context: el('section', 'gcsp-review-context'),
      notice: el('p', 'gcsp-note'), timer: el('p', 'gcsp-review-countdown'), consequence: el('p', 'gcsp-note'),
      live: el('p', 'gcsp-review-announcement'), counter: el('p', 'gcsp-field-hint'), recovery: el('div', 'gcsp-review-actions') };
    nodes.notice.id = `${prefix}-notice`; nodes.notice.tabIndex = -1;
    nodes.live.setAttribute('role', 'status'); nodes.live.setAttribute('aria-live', 'polite'); nodes.live.setAttribute('aria-atomic', 'true');
    summary = errorSummary({ id: `${prefix}-errors`, title: 'Check your review details' });
    const form = el('form', 'gcsp-review-form'); form.noValidate = true;
    form.append(el('h2', 'gcsp-h2', 'Contact and return details'),
      field('contact.phone', 'Contact phone', 'tel'), field('contact.email', 'Contact email', 'email'),
      field('expectedReturnMileage', 'Expected returning-car mileage (miles)', 'number', 'For the car you are replacing.'),
      field('specialRequirements', 'Special requirements (optional)', 'textarea', 'Requests do not change the selected car.'), nodes.counter);
    controls['contact.phone'].autocomplete = 'tel'; controls['contact.email'].autocomplete = 'email';
    controls['contact.phone'].required = true; controls['contact.email'].required = true;
    controls.expectedReturnMileage.min = '0'; controls.expectedReturnMileage.step = '1';
    const actions = el('div', 'gcsp-review-actions');
    nodes.back = button({ label: 'Back', variant: 'ghost', onClick: () => action(() => controller.release('back')) });
    nodes.change = button({ label: 'Change car', variant: 'ghost', onClick: () => action(() => controller.release('change')) });
    nodes.cancel = button({ label: 'Cancel review', variant: 'ghost', onClick: () => action(() => controller.release('cancel')) });
    nodes.save = button({ label: 'Save details', variant: 'ghost', onClick: () => action(() => controller.save()) });
    nodes.continue = button({ label: 'Continue to order review', onClick: () => action(() => controller.continue()) });
    actions.append(nodes.back, nodes.change, nodes.cancel, nodes.save, nodes.continue); form.append(actions);
    form.addEventListener('submit', (event) => { event.preventDefault(); action(() => controller.continue()); });
    const time = el('section', 'gcsp-review-time'); time.append(nodes.timer, nodes.consequence, nodes.live);
    const layout = el('div', 'gcsp-review-layout'); const vehicle = el('div', 'gcsp-review-column');
    const review = el('div', 'gcsp-review-column'); vehicle.append(nodes.vehicle, nodes.context); review.append(summary.root, form);
    layout.append(vehicle, review); panel.append(screenIntro({ title: 'Review your car', level: 1 }), nodes.notice, time, nodes.recovery, layout, syntheticNote());
    root.replaceChildren(panel);
  }
  function draw(state = controller.getState()) {
    if (disposed) return;
    if (!state.model) {
      root.replaceChildren(statusScreen({ title: state.status === 'loading' ? 'Checking your car' : 'Review unavailable',
        message: messages[state.status] || messages.unavailable,
        actions: [button({ label: 'Check current claim', disabled: state.busy, onClick: () => controller.reconcile() })] })); return;
    }
    if (!panel?.isConnected) build();
    const model = state.model; const details = state.details ?? {}; panel.setAttribute('aria-busy', String(state.busy));
    const signature = JSON.stringify([model.quote, model.orderNumber]);
    if (lastVehicle !== signature || !nodes.vehicle.childNodes.length) {
      lastVehicle = signature;
      const technical = el('details', 'gcsp-details'); technical.append(el('summary', '', 'Pinned vehicle details'),
        rows(Object.entries(model.quote.facts?.facts ?? {}).map(([key, value]) => [label(key), ['body', 'bodyType'].includes(key) ? bodyFact(value) : value])),
        rows([['Quote valid until', Number.isFinite(Date.parse(model.quote.validUntil)) ? `${demoTime(model.quote.validUntil)} (demo time)` : model.quote.validUntil], ['Scheme contribution', model.quote.terms?.contribution]]));
      nodes.vehicle.replaceChildren(
        matchCard(null, { view: reviewVehicleView(model), showScore: false }), technical);
    }
    nodes.context.replaceChildren(el('h2', 'gcsp-h2', 'Collection and current contract'), rows([
      ['Journey', model.mode === 'replacement' ? 'Replacement' : 'New order'], ['Requested collection date', longDate(model.requestedCollection?.date) ?? model.requestedCollection?.date],
      ['Contract term', model.contract?.months, 'months'], ['Annual mileage', model.contract?.annualMileage, model.contract?.mileageUnit],
      ...(model.mode === 'replacement' ? [['Returning car', model.currentContract?.model], ['Registration', model.currentContract?.registration]] : [])]),
    el('p', 'gcsp-field-hint', 'Collection is requested, not a confirmed appointment.'));
    const errors = new Map((state.errors ?? []).map((entry) => [entry.field, entry.reason]));
    for (const [key, control] of Object.entries(controls)) {
      const value = key.startsWith('contact.') ? details.contact?.[key.split('.')[1]] : details[key];
      if (control.value !== String(value ?? '')) control.value = value ?? '';
      control.disabled = !state.editable || state.busy;
      fields[key].setError(errors.get(key) || errors.get(key.startsWith('contact.') ? 'contact' : key) || '');
    }
    controls.expectedReturnMileage.required = model.mode === 'replacement'; controls.expectedReturnMileage.max = model.constraints.maximumReturnMileage;
    fields.expectedReturnMileage.root.hidden = model.mode !== 'replacement'; controls.specialRequirements.maxLength = model.constraints.maximumSpecialRequirements;
    nodes.counter.textContent = `${details.specialRequirements?.length ?? 0} / ${model.constraints.maximumSpecialRequirements} characters`;
    summary.update((state.errors ?? []).map((entry) => ({ id: controls[entry.field]?.id ?? nodes.notice.id, message: entry.reason })));
    // An unconfirmed read keeps the last model, so never show its countdown as a live hold.
    const unconfirmed = state.status === 'unavailable'; const c = unconfirmed ? null : state.countdown; const seconds = c?.secondsRemaining;
    nodes.timer.textContent = unconfirmed ? 'Reservation not confirmed' : Number.isFinite(seconds) ? `${c.phase === 'order-review' ? 'Order review' : 'Car reservation'}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Reservation time unavailable';
    nodes.consequence.textContent = unconfirmed ? 'This car is not shown as reserved until the claim is confirmed. Check current claim.'
      : state.status === 'pending' || model.hold.state.endsWith('-pending')
      ? 'This action is still being checked. This car stays unavailable until its status is confirmed.' : c?.expired ? 'This deadline has passed. You cannot continue with this reservation.'
      : 'This car is reserved until the deadline. Continuing does not place an order.';
    if (state.announcement?.id !== announcementId) { announcementId = state.announcement?.id; nodes.live.textContent = state.announcement?.text ?? ''; }
    nodes.notice.textContent = state.conflict ? messages.conflict : messages[state.status]
      || (state.retryAction ? messages.pending : model.frozen ? 'Your details are locked while selection is checked.'
        : state.dirty ? 'You have unsaved details.' : '');
    nodes.save.disabled = state.busy || !state.editable; nodes.continue.disabled = state.busy || !state.canContinue;
    for (const node of [nodes.back, nodes.change, nodes.cancel]) node.disabled = state.busy || !state.canRelease;
    // A confirmed, settled claim needs no re-check control; every other state keeps it.
    const settled = !unconfirmed && !state.conflict && !state.retryAction && !messages[state.status] && !model.frozen
      && !/-pending$/.test(model.hold.state) && !['released', 'cancelled', 'expired', 'claim-failed'].includes(model.hold.state);
    nodes.recovery.replaceChildren(...settled ? [] : [button({ label: 'Check current claim', variant: 'ghost', disabled: state.busy, onClick: () => controller.reconcile() })]);
    if (state.conflict) nodes.recovery.append(button({ label: 'Discard local edits and load newer details', variant: 'ghost', disabled: state.busy, onClick: () => controller.discardLocalChanges() }));
    if (state.retryAction) nodes.recovery.append(button({ label: 'Retry the same action', disabled: state.busy, onClick: () => action(() =>
      state.retryAction === 'release' ? controller.release() : state.retryAction === 'continue' ? controller.continue() : controller.save()) }));
    if (state.status === 'expired' || !['pending', 'unavailable'].includes(state.status) && ['released', 'cancelled', 'expired', 'claim-failed'].includes(model.hold.state)) nodes.recovery.append(button({ label: 'Refresh stock', variant: 'ghost', onClick: () => { onBrowse?.(); notify('gcsp:manual-review-browse', {}); } }));
  }
  const unsubscribe = subscribeClock?.(() => { if (!disposed) controller.reconcile(); }); controller.load({ handoff });
  const destroy = () => { if (disposed) return; disposed = true; unsubscribe?.(); controller.destroy(); root.replaceChildren(); };
  destroy.controller = controller; destroy.refresh = () => controller.reconcile(); destroy.handoff = (detail) => controller.load({ handoff: detail });
  destroy.leave = (reason = 'back') => controller.release(reason); return destroy;
}

export function mountManualReview(root, { loadAccount = createAccountHttpAdapter().loadAccount, brand = 'bmw', location, ...options } = {}) {
  let body; let disposed = false;
  const held = () => { const state = body?.controller.getState(); return !state?.model || state.canRelease; };
  const where = location || root.ownerDocument.defaultView?.location;
  const shell = mountEmployee(root, { brand, loadAccount,
    onNavigate: (key) => routeAfterRelease(key, { held, release: () => body?.leave('back'), location: where }),
    renderBody(main) { if (disposed) return; body?.(); body = mountManualReviewBody(main, options); } });
  const destroy = () => { disposed = true; body?.(); shell(); };
  Object.defineProperty(destroy, 'controller', { get: () => body?.controller });
  destroy.refresh = () => body?.refresh(); destroy.handoff = (detail) => body?.handoff(detail); destroy.leave = (reason) => body?.leave(reason); return destroy;
}
export class GcspManualReviewElement extends HTMLElement {
  constructor() { super(); if (Object.hasOwn(this, 'adapter')) { const value = this.adapter; delete this.adapter; this._adapter = value; } }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  _mount() { this._teardown?.(); this._teardown = mountManualReview(this, { adapter: this._adapter, brand: this.getAttribute('brand') || 'bmw', loadAccount: this.loadAccount }); }
}
export function defineGcspManualReview(registry = globalThis.customElements) {
  if (registry && !registry.get('gcsp-manual-review')) registry.define('gcsp-manual-review', GcspManualReviewElement);
  return registry?.get('gcsp-manual-review');
}
export default function decorate(root, options) { return mountManualReview(root, options); }
