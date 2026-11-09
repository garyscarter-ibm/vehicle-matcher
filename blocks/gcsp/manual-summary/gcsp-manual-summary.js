import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { matchCard } from '../../vehicle-matcher/modes/result-card.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { routeAfterRelease } from '../employee/portal-navigation.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';
import { checkboxField, errorSummary } from '../kit/form-controls.js';
import { stageList } from '../kit/stage-list.js';
import { syntheticNote } from '../kit/synthetic-note.js';
import { viewStatus } from '../kit/view-status.js';
import { orderIdentityRows } from '../kit/order-identity.js';
import { reviewVehicleView } from '../manual-review/gcsp-manual-review.js';
import { createManualSummaryController } from './summary-controller.js';
import { createManualSummaryHttpAdapter } from './http-adapter.js';
import { licenceLabel, longDate, outcomeView, readbackFor, relationshipLabel, stageLabel } from './summary-model.js';

let serial = 0;
const HIDE = 'gcsp-print-hidden';
const claimMessages = {
  loading: 'Checking your current claim.', releasing: 'Releasing this car.',
  pending: 'The outcome is still being checked. Check again before continuing.',
  expired: 'Your reservation has expired. Your entries are retained. Refresh stock to choose again.',
  released: 'This car has been released. Refresh stock to choose again.',
  unavailable: 'The current claim could not be confirmed. Your entries are retained. Check again.',
  conflict: 'Your saved review has changed. Check the current claim.',
};
const rows = (list) => factList(list.filter((r) => !(r.omit && (r.value == null || r.value === ''))));
const row = (label, value, extra = {}) => ({ label, value, ...extra });
const absent = { missingLabel: 'Not recorded' }; const required = { missingLabel: 'Required' };

// Fact rows per section, shared by the live review and the placed order.
function sectionRows(rb) {
  const e = rb.employee ?? {}; const d = rb.driver; const l = d?.licence; const c = rb.details.contact; const o = rb.old ?? {};
  return {
    employee: [row('Name', e.name)],
    driver: [row('Driver', d?.name), row('Relationship', relationshipLabel(d), { omit: true }),
      row('Licence number', l?.displayNumber), row('Licence categories', licenceLabel(l?.categories), { omit: true }),
      row('Valid from', longDate(l?.validFrom)), row('Valid until', longDate(l?.validUntil))],
    terms: [row('Points cost', rb.points.cost, { unit: 'points a month' }), row('Monthly allowance', rb.points.allowance, { unit: 'points a month' }),
      row('Cash contribution', 'None'), row('Contract term', rb.contract?.months, { unit: 'months' }),
      row('Annual mileage', rb.contract?.annualMileage, { unit: rb.contract?.mileageUnit })],
    collection: [row('Requested collection date', longDate(rb.requested)), row('Earliest collection date', longDate(rb.earliest), absent),
      row('Collection location', rb.location, { omit: true })],
    contact: [row('Contact phone', c.phone, required), row('Contact email', c.email, required),
      row('Special requirements', rb.details.specialRequirements, { missingLabel: 'None' })],
    returns: [row('Returning car', o.model, absent), row('Registration', o.registration, absent),
      row('Contract end date', longDate(o.contractEndDate), absent), row('Recorded odometer', o.currentOdometer?.value, { unit: o.currentOdometer?.unit, ...absent }),
      row('Expected return mileage', rb.details.expectedReturnMileage, { unit: 'miles', ...required })],
  };
}
const heading = (text) => el('h2', 'gcsp-h2', text);
function section(title, body, edit) {
  const card = el('section', 'gcsp-card gcsp-summary-section'); const inner = el('div', 'gcsp-card-body');
  inner.append(heading(title), body); if (edit) inner.append(edit); card.append(inner); return card;
}

export function mountManualSummaryBody(root, { adapter = createManualSummaryHttpAdapter(), commandId, subscribeClock, onEditDetails,
  onChangeCar, onChangeChoices, onFinish, onBrowse, onReleased } = {}) {
  const prefix = `gcsp-summary-${++serial}`; let disposed = false; let leaving = null; let panel; let nodes; let outcomePanel; let outcome;
  let signatures = {}; let declarationKey; let boxes = []; let announcedId; let outcomeKey; let spokenNotice;
  const status = viewStatus({ className: 'gcsp-vh gcsp-review-announcement' });
  const win = () => root.ownerDocument.defaultView;
  const notify = (type, detail) => root.dispatchEvent(new (win().CustomEvent)(type, { detail, bubbles: true, composed: true }));
  const controller = createManualSummaryController({ adapter, commandId, onChange: draw, onReleased(detail) {
    if (disposed) return;
    const to = leaving; leaving = null;
    if (to === 'car') { onChangeCar?.(detail); notify('gcsp:manual-summary-change-car', detail); }
    else if (to === 'choices') { onChangeChoices?.(detail); notify('gcsp:manual-summary-change-choices', detail); }
    else { onReleased?.(detail); notify('gcsp:manual-summary-released', detail); }
  } });
  const finish = () => { onFinish?.(); notify('gcsp:manual-summary-finish', {}); };
  const browse = () => { onBrowse?.(); notify('gcsp:manual-summary-browse', {}); };
  const leave = (to) => { leaving = to; return controller.release('change'); };
  const fill = (key, signature, host, build) => {
    if (signatures[key] === signature) return; signatures[key] = signature; host.replaceChildren(...build());
  };
  function statusFor(state) {
    const c = state.claim; const ready = c?.model && state.account && state.draft;
    if (state.phase === 'loading') return { title: 'Checking your order', message: 'Checking your order and reservation.', actions: [] };
    if (state.phase === 'unavailable') return { title: 'Order unavailable', message: 'We could not check your order. Your entries are retained. Check again.',
      actions: [button({ label: 'Check again', disabled: state.busy, onClick: () => controller.load() })] };
    const actions = [button({ label: 'Check current claim', disabled: state.busy, onClick: () => controller.load() })];
    if (['expired', 'released'].includes(c?.status)) actions.push(button({ label: 'Refresh stock', variant: 'ghost', onClick: browse }));
    return { title: ready ? 'Order unavailable' : 'Review unavailable',
      message: c?.model ? 'Your account or saved choices could not be read. Check again.' : claimMessages[c?.status] ?? claimMessages.unavailable, actions };
  }
  function drawStatus(state) {
    const s = statusFor(state); panel = null; outcomePanel = null; signatures = {};
    root.replaceChildren(statusScreen({ title: s.title, message: s.message, actions: s.actions }));
  }
  function build() {
    panel = el('div', 'vm gcsp-summary-body'); signatures = {}; declarationKey = null; boxes = [];
    nodes = { notice: el('p', 'gcsp-note'), timer: el('p', 'gcsp-review-countdown'), consequence: el('p', 'gcsp-note'),
      recovery: el('div', `gcsp-review-actions ${HIDE}`), vehicle: el('div', 'gcsp-review-vehicle'), left: el('div', 'gcsp-review-column'),
      right: el('div', 'gcsp-review-column'), declarations: el('div', 'gcsp-summary-declarations'), hint: el('p', 'gcsp-field-hint'),
      facts: {}, summary: errorSummary({ id: `${prefix}-errors`, title: 'Check your order', onSelect: (id) => root.ownerDocument.getElementById(id)?.focus() }) };
    nodes.notice.id = `${prefix}-notice`; nodes.notice.tabIndex = -1;
    nodes.hint.id = `${prefix}-hint`;
    const edit = (label, hintText, run, ariaLabel) => {
      const area = el('div', `gcsp-summary-edit ${HIDE}`); const control = button({ label, variant: 'ghost', onClick: run });
      if (ariaLabel) control.setAttribute('aria-label', ariaLabel);
      area.append(control, el('p', 'gcsp-field-hint', hintText)); return { area, control };
    };
    const edits = { car: edit('Change car', 'Releases this car so you can choose another.', () => leave('car')),
      choices: edit('Change order choices', 'Releases this car. Your choices are kept and you choose a car again.', () => leave('choices'), 'Change order choices: term, collection and driver'),
      details: edit('Change contact or requirements', 'Keeps your reservation. You tick the declarations again.', () => { onEditDetails?.(); notify('gcsp:manual-summary-edit-details', {}); }),
      mileage: edit('Change return mileage', 'Keeps your reservation. You tick the declarations again.', () => { onEditDetails?.(); notify('gcsp:manual-summary-edit-details', {}); }) };
    nodes.edits = edits;
    for (const key of ['employee', 'driver', 'terms', 'collection', 'contact', 'returns']) nodes.facts[key] = el('div', 'gcsp-summary-facts');
    nodes.sections = { order: section('Your order', nodes.facts.employee), driver: section('Driver and licence', nodes.facts.driver),
      terms: section('Points and contract', nodes.facts.terms, edits.choices.area),
      collection: section('Collection', nodes.facts.collection), contact: section('Contact and requirements', nodes.facts.contact, edits.details.area),
      returns: section('Car you are returning', nodes.facts.returns, edits.mileage.area) };
    nodes.sections.collection.querySelector('.gcsp-card-body').append(el('p', 'gcsp-field-hint', 'Collection is requested, not a confirmed appointment.'));
    nodes.left.append(nodes.vehicle, edits.car.area, nodes.sections.terms, nodes.sections.collection);
    nodes.right.append(nodes.sections.order, nodes.sections.driver, nodes.sections.contact, nodes.sections.returns);
    nodes.submit = button({ label: 'Submit order', describedBy: nodes.hint.id, onClick: () => controller.submit().then(after) });
    const actions = el('div', `gcsp-review-actions ${HIDE}`); actions.append(nodes.submit);
    const time = el('section', 'gcsp-review-time'); time.append(nodes.timer, nodes.consequence, status.root);
    const layout = el('div', 'gcsp-review-layout'); layout.append(nodes.left, nodes.right);
    nodes.declarationsCard = section('Before you submit', nodes.declarations);
    nodes.declarationsCard.querySelector('.gcsp-card-body').append(nodes.hint, actions);
    panel.append(screenIntro({ title: 'Review your order', level: 1 }), nodes.notice, time, nodes.recovery, nodes.summary.root, layout, nodes.declarationsCard, syntheticNote());
    root.replaceChildren(panel);
  }
  function after() {
    if (disposed) return;
    const state = controller.getState();
    if (state.phase === 'summary') { if (state.errors.length) nodes.summary.focus(); else if (state.notice) nodes.notice.focus(); }
  }
  function drawDeclarations(state) {
    const terms = state.terms; const key = JSON.stringify([terms?.termsDigest, state.claim.model.mode]);
    if (declarationKey !== key) {
      declarationKey = key; boxes = [];
      const group = el('div', 'gcsp-summary-checks'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Declarations');
      for (const entry of state.required) {
        const field = checkboxField({ id: `${prefix}-declaration-${entry.id}`, label: entry.label, onChange: (checked) => controller.tick(entry.id, checked) });
        field.input.dataset.declaration = entry.id; boxes.push(field.input); group.append(field.root);
      }
      const stages = terms?.approvalStages?.length ? `After you submit: ${terms.approvalStages.map(stageLabel).join(', ')}.` : '';
      nodes.declarations.replaceChildren(...(terms ? [el('p', 'gcsp-note', terms.wordingByMode?.[state.claim.model.mode] ?? terms.wording),
        // The terms version is sent with the submission, never shown: it is a code, not copy (FUCQ-197).
        ...(terms.fictional ? [el('p', 'gcsp-field-hint', 'Synthetic demonstration wording, not BMW terms.')] : []), group, ...(stages ? [el('p', 'gcsp-field-hint', stages)] : [])] : [el('p', 'gcsp-note', 'The terms could not be loaded.')]));
    }
    for (const box of boxes) { box.checked = state.ticks[box.dataset.declaration] === true; box.disabled = state.busy || state.unresolved; }
  }
  function drawSummary(state) {
    if (!panel?.isConnected) build();
    const c = state.claim; const model = c.model; panel.setAttribute('aria-busy', String(state.busy));
    const rb = readbackFor({ model, account: state.account, draft: state.draft });
    const view = JSON.stringify([model.quote, model.orderNumber]);
    fill('vehicle', view, nodes.vehicle, () => [matchCard(null, { view: reviewVehicleView(model), showScore: false, hideMissing: 'More details not supplied' })]);
    const data = sectionRows(rb);
    for (const key of ['employee', 'driver', 'terms', 'collection', 'contact', 'returns']) fill(key, JSON.stringify(data[key]), nodes.facts[key], () => [rows(data[key])]);
    nodes.sections.order.querySelector('.gcsp-h2').textContent = rb.mode === 'replacement' ? 'Your replacement order' : 'Your new order';
    nodes.sections.returns.hidden = rb.mode !== 'replacement';
    drawDeclarations(state);
    const idle = !state.busy && !state.unresolved; const release = !state.busy && c.canRelease && !state.unresolved;
    nodes.edits.car.control.disabled = nodes.edits.choices.control.disabled = !release;
    nodes.edits.details.control.disabled = nodes.edits.mileage.control.disabled = !idle;
    nodes.summary.update(state.errors.map((e) => ({ id: boxes[0]?.id ?? nodes.notice.id, message: e.message })));
    const unconfirmed = c.status === 'unavailable'; const t = unconfirmed ? null : c.countdown; const seconds = t?.secondsRemaining;
    nodes.timer.textContent = unconfirmed ? 'Reservation not confirmed' : Number.isFinite(seconds)
      ? `Order review: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Reservation time unavailable';
    nodes.consequence.textContent = unconfirmed ? 'This car is not shown as reserved until the claim is confirmed. Check current claim.'
      : t?.expired ? 'This deadline has passed. You cannot submit with this reservation.'
        : 'This car is reserved until the deadline. Submitting places your order.';
    const spoken = [];
    if (c.announcement?.id !== announcedId) { announcedId = c.announcement?.id; if (c.announcement?.text) spoken.push(c.announcement.text); }
    // A lapsed server deadline stays visible with its recovery while a slow recheck runs.
    const lapsed = !unconfirmed && Boolean(t?.expired);
    nodes.notice.textContent = state.status === 'submitting' ? 'Submitting your order.' : state.notice?.message
      ?? (lapsed && c.status === 'loading' ? claimMessages.expired : claimMessages[c.status])
      ?? (state.missing.length ? `Add the required details: ${state.missing.join(', ')}.` : '');
    if (spokenNotice !== undefined && nodes.notice.textContent && nodes.notice.textContent !== spokenNotice) spoken.push(nodes.notice.textContent);
    spokenNotice = nodes.notice.textContent; status.announce(spoken.join(' '));
    const why = state.canSubmit ? '' : state.missing.length ? `Add ${state.missing.join(', ').toLowerCase()} before you submit.`
      : !state.termsOk ? 'Submit is unavailable until the terms load.' : t?.expired ? 'Your reservation has expired.'
        : state.required.some((e) => state.ticks[e.id] !== true) ? 'Tick every declaration to submit.' : '';
    nodes.hint.textContent = why; nodes.hint.hidden = !why;
    nodes.submit.disabled = !state.canSubmit;
    nodes.submit.textContent = state.status === 'submitting' ? 'Submitting order' : state.unresolved ? 'Retry the same submission' : 'Submit order';
    // A confirmed, settled claim needs no re-check control; every other state keeps it.
    const hold = c.model?.hold?.state ?? '';
    const settled = !unconfirmed && !lapsed && !state.unresolved && !state.notice && !state.actions.length && !claimMessages[c.status] && !c.retryAction
      && !/-pending$/.test(hold) && !['released', 'cancelled', 'expired', 'claim-failed'].includes(hold);
    const extra = settled ? [] : [button({ label: 'Check current claim', variant: 'ghost', disabled: state.busy, onClick: () => controller.reconcile() })];
    if (state.actions.includes('status')) extra.push(button({ label: 'Check order status', variant: 'ghost', disabled: state.status === 'submitting', onClick: () => controller.checkOrder() }));
    if (state.actions.includes('terms')) extra.push(button({ label: 'Reload terms', variant: 'ghost', disabled: state.busy, onClick: () => controller.reloadTerms({ clearTicks: false }) }));
    if (state.actions.includes('browse') || lapsed || ['expired', 'released'].includes(c.status)) extra.push(button({ label: 'Refresh stock', variant: 'ghost', onClick: browse }));
    if (c.retryAction === 'release') extra.push(button({ label: 'Retry the same action', disabled: c.busy, onClick: () => controller.retryRelease() }));
    nodes.recovery.replaceChildren(...extra);
  }
  function drawOutcome(state) {
    const order = state.order; const selection = order.selection; const v = outcomeView(order);
    const rb = readbackFor({ selection, account: state.account });
    const key = JSON.stringify([order.progress, order.operationState, order.order, state.account ? 1 : 0, state.busy]);
    if (!outcomePanel?.isConnected) {
      outcomePanel = el('div', 'vm gcsp-summary-body gcsp-summary-outcome'); outcome = { body: el('div', 'gcsp-summary-outcome-body') }; outcomePanel.append(status.root, outcome.body);
      panel = null; outcomeKey = null; root.replaceChildren(outcomePanel);
    }
    const announcement = `${v.title}. ${v.status}. ${rb.orderReference ? `Order reference ${rb.orderReference}. ` : ''}Car order number ${rb.orderNumber}.`;
    status.announce(announcement);
    if (outcomeKey === key) return; outcomeKey = key;
    const focused = root.ownerDocument.activeElement?.textContent; const first = !outcome.body.childNodes.length;
    const data = sectionRows(rb); const mode = rb.mode === 'replacement';
    const next = el('section', 'gcsp-card gcsp-summary-section gcsp-summary-next'); const inner = el('div', 'gcsp-card-body');
    const steps = v.key === 'awaiting-approval' ? [`Next step: ${stageLabel(order.progress.current)}.`, 'Your requested collection date is not an appointment.', 'Your account shows progress as it changes.']
      : v.key === 'handoff-failed' ? [`Contact scheme support and quote your ${rb.orderReference ? 'order reference' : 'car order number'}.`]
        : ['Check again to see whether ordering has received it.', 'Do not submit again. Checking never creates another order.'];
    const list = el('ul', 'gcsp-summary-steps'); for (const text of steps) list.append(el('li', '', text));
    inner.append(heading('Next steps'), list); next.append(inner);
    const stages = stageList({ heading: 'Order progress', stages: order.progress.stages.map((s) => ({ ...s, name: stageLabel(s.name) })) });
    const facts = rows([...orderIdentityRows(rb.orderReference, rb.orderNumber), row('Status', v.status), row('Journey', mode ? 'Replacement' : 'New order')]);
    const actions = el('div', `gcsp-review-actions ${HIDE}`);
    actions.append(button({ label: 'Finish', onClick: finish }), button({ label: 'Print order', variant: 'ghost', onClick: () => { try { win().print(); } catch { /* No printer is not an order failure. */ } } }));
    if (!v.final) actions.append(button({ label: 'Check order status', variant: 'ghost', disabled: state.busy, onClick: () => controller.checkOrder() }));
    const left = el('div', 'gcsp-review-column'); const right = el('div', 'gcsp-review-column');
    left.append(matchCard(null, { view: reviewVehicleView({ quote: rb.quote, orderNumber: rb.orderNumber }), showScore: false, hideMissing: 'More details not supplied' }),
      section('Points and contract', rows(data.terms)), section('Requested collection', rows(data.collection)));
    left.lastChild.querySelector('.gcsp-card-body').append(el('p', 'gcsp-field-hint', 'Collection is requested, not a confirmed appointment.'));
    right.append(section('Order', facts), stages, next, section('Employee', rows(data.employee)), section('Driver and licence', rows(data.driver)),
      section('Contact and requirements', rows(data.contact)), ...(mode ? [section('Car you are returning', rows(data.returns))] : []));
    const layout = el('div', 'gcsp-review-layout'); layout.append(left, right);
    const intro = screenIntro({ title: v.title, lede: v.message, level: 1 }); intro.querySelector('h1').tabIndex = -1;
    if (v.key === 'handoff-failed') intro.append(el('p', 'gcsp-note', 'No request has been sent from this page.'));
    outcome.body.replaceChildren(intro, actions, layout);
    if (first) intro.querySelector('h1').focus();
    else if (focused) [...outcome.body.querySelectorAll('button')].find((b) => b.textContent === focused)?.focus();
  }
  function draw(state = controller.getState()) {
    if (disposed) return;
    if (state.phase === 'outcome') drawOutcome(state);
    else if (state.phase !== 'summary' || !state.claim?.model || !state.account || !state.draft) drawStatus(state);
    else drawSummary(state);
  }
  const unsubscribe = subscribeClock?.(() => { if (!disposed) controller.reconcile(); }); controller.load();
  const destroy = () => { if (disposed) return; disposed = true; unsubscribe?.(); controller.destroy(); root.replaceChildren(); };
  destroy.controller = controller; destroy.refresh = () => controller.reconcile();
  destroy.leave = (reason) => controller.getState().phase === 'outcome' ? finish() : (leaving = null, controller.release(reason));
  return destroy;
}

export function mountManualSummary(root, { loadAccount = createAccountHttpAdapter().loadAccount, brand = 'bmw', location, ...options } = {}) {
  let body; let disposed = false;
  const held = () => { const state = body?.controller.getState(); return !state || (state.phase !== 'outcome' && (!state.claim?.model || state.claim.canRelease)); };
  const where = location || root.ownerDocument.defaultView?.location;
  const shell = mountEmployee(root, { brand, loadAccount,
    onNavigate: (key) => routeAfterRelease(key, { held, release: () => body?.leave('back'), location: where }),
    renderBody(main) { if (disposed) return; body?.(); body = mountManualSummaryBody(main, options); } });
  const destroy = () => { disposed = true; body?.(); shell(); };
  Object.defineProperty(destroy, 'controller', { get: () => body?.controller });
  destroy.refresh = () => body?.refresh(); destroy.leave = (reason) => body?.leave(reason); return destroy;
}
export class GcspManualSummaryElement extends HTMLElement {
  constructor() { super(); if (Object.hasOwn(this, 'adapter')) { const value = this.adapter; delete this.adapter; this._adapter = value; } }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  _mount() { this._teardown?.(); this._teardown = mountManualSummary(this, { adapter: this._adapter, brand: this.getAttribute('brand') || 'bmw', loadAccount: this.loadAccount }); }
}
export function defineGcspManualSummary(registry = globalThis.customElements) {
  if (registry && !registry.get('gcsp-manual-summary')) registry.define('gcsp-manual-summary', GcspManualSummaryElement);
  return registry?.get('gcsp-manual-summary');
}
export default function decorate(root, options) { return mountManualSummary(root, options); }
