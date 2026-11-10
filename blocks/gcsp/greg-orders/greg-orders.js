// Operate: extend Greg's Density/shared-kit language. Intent, acknowledgement
// and released cars remain separate facts; stable native forms preserve focus.
import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { labelledField } from '../kit/form-controls.js';
import { dataTable } from '../kit/data-table.js';
import { RUN_RESTARTED_MESSAGE, runRestartedScreen } from '../kit/run-restarted.js';

let instance = 0;
const stages = Object.freeze({ requested: 'Requested', 'partly-confirmed': 'Partly confirmed', confirmed: 'Confirmed',
  delayed: 'Delayed', 'partly-released': 'Partly released', released: 'Released' });
const date = (value) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London',
}).format(new Date(value)) : 'Date unavailable';
const unavailable = { status: 'unavailable', reason: 'Order requests are unavailable. Use Refresh to try again.' };
const refused = new Set(['forbidden', 'missing-session', 'unknown-session', 'expired-session', 'stale-run']);
const option = (value, label) => { const node = el('option', '', label); node.value = value; return node; };
const validProjection = (value) => value && value.versions && value.adapter && Array.isArray(value.requests)
  && ['ready', 'unavailable'].includes(value.adapter.status)
  && (value.adapter.status !== 'ready' || Array.isArray(value.adapter.choices))
  && value.requests.every((r) => r && typeof r.requestId === 'string' && typeof r.model === 'string'
    && typeof r.derivative === 'string' && Array.isArray(r.supplies) && r.supplies.every((s) => s && Number.isSafeInteger(s.quantity))
    && ['quantity', 'confirmedQuantity', 'releasedQuantity', 'outstandingQuantity'].every((k) => Number.isSafeInteger(r[k]) && r[k] >= 0));
function setOptions(control, values) {
  const selected = control.value;
  control.replaceChildren(...values.map(([value, label]) => option(value, label)));
  if (values.some(([value]) => value === selected)) control.value = selected;
}
function numberInput() { const node = el('input'); node.type = 'number'; node.min = '1'; node.step = '1'; node.value = '1'; node.required = true; return node; }
function message(out) {
  if (out.status === 'access-required') return RUN_RESTARTED_MESSAGE;
  if (refused.has(out.status)) return out.status === 'stale-run' ? 'This page was restarted. Reopen the scheme ordering lead session.'
    : 'This action needs the scheme ordering lead and, for production controls, a presenter session.';
  if (['conflict', 'stale-version'].includes(out.status)) return 'The request or its inputs changed. Refresh before trying again.';
  if (out.status === 'invalid') return out.reasons?.map((r) => r.reason).filter(Boolean).join(' ') || 'Check your choices and try again.';
  return out.reason || unavailable.reason;
}

export function mountGregOrders(root, { adapter, productionControls = false, onChanged, signal,
  newCommandId = () => globalThis.crypto.randomUUID() } = {}) {
  const id = `greg-orders-${++instance}`;
  root.classList.add('gcsp', 'gcsp-orders');
  const abort = new AbortController(); let stopped = false; let revision = 0; let busy = false; let projection = null; let choiceKey = '';
  const pending = new Map(); const controls = [];
  const header = el('div', 'gcsp-orders-header'); const heading = el('h2', 'gcsp-h2', 'Order requests');
  heading.id = `${id}-title`; root.setAttribute('aria-labelledby', heading.id);
  const refresh = button({ label: 'Refresh orders', variant: 'ghost', onClick: () => load() });
  header.append(heading, refresh);
  const notice = el('p', 'gcsp-note gcsp-orders-status', 'Loading order requests.'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const source = el('p', 'gcsp-note'); const body = el('div', 'gcsp-orders-tracking');
  const requestForm = el('form', 'gcsp-orders-form'); const requestTitle = el('h3', 'gcsp-h3', 'Request cars');
  const requestFields = el('div', 'gcsp-orders-fields'); const model = el('select'); const derivative = el('select'); const quantity = numberInput();
  model.required = true; derivative.required = true;
  function field(parent, name, control, label, hint = '') {
    controls.push(control); parent.append(labelledField({ id: `${id}-${name}`, label, control, hint }).root); return control;
  }
  field(requestFields, 'model', model, 'Model'); field(requestFields, 'derivative', derivative, 'Derivative'); field(requestFields, 'quantity', quantity, 'Quantity');
  const submit = button({ label: 'Submit request' }); submit.type = 'submit'; controls.push(submit);
  requestForm.append(requestTitle, requestFields, submit);
  const production = el('details', 'gcsp-orders-production'); production.hidden = !productionControls;
  production.append(el('summary', '', 'Production controls'));
  const productionForm = el('form', 'gcsp-orders-form'); const productionFields = el('div', 'gcsp-orders-fields'); const selected = el('select');
  const action = el('select'); action.append(option('confirm', 'Confirm now'), option('delay', 'Delay outstanding quantity'));
  const confirmQuantity = numberInput(); const delayUntil = el('input'); delayUntil.type = 'date'; const reason = el('input'); reason.type = 'text'; reason.maxLength = 512;
  field(productionFields, 'request', selected, 'Request'); field(productionFields, 'action', action, 'Production response');
  const confirmField = labelledField({ id: `${id}-confirmed`, label: 'Quantity to confirm', control: confirmQuantity });
  const delayField = labelledField({ id: `${id}-date`, label: 'Delay until', control: delayUntil });
  const reasonField = labelledField({ id: `${id}-reason`, label: 'Delay reason', control: reason });
  controls.push(confirmQuantity, delayUntil, reason); productionFields.append(confirmField.root, delayField.root, reasonField.root);
  const step = button({ label: 'Save production response' }); step.type = 'submit'; controls.push(step);
  productionForm.append(productionFields, step); production.append(productionForm);
  const queues = el('div', 'gcsp-orders-queues');
  root.replaceChildren(header, notice, source, body, requestForm, queues, production);
  function updateAction() {
    const delay = action.value === 'delay'; confirmField.root.hidden = delay; confirmQuantity.required = !delay;
    delayField.root.hidden = !delay; reasonField.root.hidden = !delay; delayUntil.required = delay; reason.required = delay;
  }
  action.addEventListener('change', updateAction); updateAction();
  function derivatives() { setOptions(derivative, (projection?.adapter.choices ?? []).filter((c) => c.model === model.value).map((c) => [c.derivative, c.derivative])); }
  model.addEventListener('change', derivatives);
  function availability() {
    const ready = !!projection && projection.adapter.status === 'ready';
    for (const control of controls) control.disabled = busy || !ready;
    for (const control of queues.querySelectorAll('button')) control.disabled = busy;
    refresh.disabled = busy;
    if (!selected.options.length) { selected.disabled = true; step.disabled = true; }
    root.setAttribute('aria-busy', String(busy));
  }
  function draw(value) {
    projection = value; body.replaceChildren();
    source.textContent = `Production · as of ${date(value.asOf)}. Only released cars enter supply.`;
    body.append(dataTable({ caption: 'Requested, confirmed and released cars', id: `${id}-table`, columns: [
      { key: 'car', label: 'Car' }, { key: 'stage', label: 'Stage' }, { key: 'requested', label: 'Requested', numeric: true },
      { key: 'confirmed', label: 'Confirmed', numeric: true }, { key: 'released', label: 'Released', numeric: true },
      { key: 'timing', label: 'Expected / delayed' },
    ], rows: value.requests.map((r) => ({ car: `${r.model} ${r.derivative}`, stage: stages[r.stage] ?? 'Status unavailable',
      requested: r.quantity, confirmed: r.confirmedQuantity, released: r.releasedQuantity,
      timing: [r.supplies.length ? `Confirmed: ${r.supplies.map((s) => `${s.quantity} due ${date(s.expectedAt)}`).join('; ')}` : '',
        r.delay ? `${r.outstandingQuantity} delayed until ${date(r.delay.until)}: ${r.delay.reason}` : '',
        r.latestReleasedAt ? `Released ${date(r.latestReleasedAt)}` : ''].filter(Boolean).join('. ') || 'Awaiting production response',
    })), emptyText: 'No requests yet. Choose a model, derivative and quantity to request cars.' }));
    const key = JSON.stringify(value.adapter.choices ?? []);
    if (key !== choiceKey) { choiceKey = key; setOptions(model, [...new Set((value.adapter.choices ?? []).map((c) => c.model))].map((v) => [v, v])); derivatives(); }
    setOptions(selected, value.requests.filter((r) => r.outstandingQuantity > 0).map((r) => [r.requestId, `${r.model} ${r.derivative}: ${r.outstandingQuantity} outstanding`]));
    queues.replaceChildren();
    for (const request of value.requests.filter((r) => r.supplies.some((s) => !s.queued))) {
      const row = el('div', 'gcsp-orders-queue'); row.append(el('p', 'gcsp-note', `${request.model} ${request.derivative}: confirmed supply is saved and awaiting the release queue.`),
        button({ label: 'Retry release queue', variant: 'ghost', onClick: () => operate('queueConfirmed', { requestId: request.requestId }, 'Confirmed supply queued.') }));
      queues.append(row);
    }
    availability();
  }
  async function load({ keepNotice = false } = {}) {
    const mine = ++revision; body.setAttribute('aria-busy', 'true');
    let out; try { out = await adapter?.loadTracking?.({ signal: abort.signal }); } catch { out = unavailable; }
    if (stopped || mine !== revision) return;
    body.removeAttribute('aria-busy');
    if (out?.status === 'ok' && validProjection(out.value)) {
      draw(out.value);
      if (!keepNotice) notice.textContent = out.value.adapter.status === 'ready' ? 'Orders up to date.' : 'Production is unavailable. Saved requests remain visible; use Refresh to retry.';
    } else {
      projection = null; source.textContent = ''; queues.replaceChildren();
      body.replaceChildren(out?.status === 'access-required' ? runRestartedScreen()
        : statusScreen({ title: refused.has(out?.status) ? 'Open the scheme ordering lead session' : 'Orders could not be loaded',
          message: message(out ?? unavailable), role: 'alert' }));
      if (!keepNotice) notice.textContent = 'Orders unavailable.';
      availability();
    }
  }
  async function operate(method, fields, success, queueAfter = false) {
    if (busy || stopped) return;
    const key = JSON.stringify(fields); const prior = pending.get(method);
    const input = prior?.key === key ? prior.input : { ...fields, commandId: newCommandId() };
    pending.set(method, { key, input }); busy = true; availability(); notice.textContent = 'Saving. Please wait.';
    let out;
    try { out = await adapter?.[method]?.(input, { signal: abort.signal }); } catch { out = unavailable; }
    if (stopped) return;
    out ??= unavailable;
    if (out.status !== 'unavailable') pending.delete(method);
    if (out.status === 'ok' && queueAfter) {
      try { const queued = await adapter?.queueConfirmed?.({ commandId: `queue-${input.commandId}`, requestId: input.requestId }, { signal: abort.signal });
        if (queued?.status !== 'ok') out = { status: 'unavailable', reason: 'Confirmation saved. Release queue unavailable; retry queueing below.' };
      } catch { out = { status: 'unavailable', reason: 'Confirmation saved. Release queue unavailable; retry queueing below.' }; }
    }
    notice.textContent = out.status === 'ok' ? success : message(out); busy = false;
    await load({ keepNotice: true });
    if (!stopped) { availability(); if (out.status === 'ok') onChanged?.(method); }
  }
  requestForm.addEventListener('submit', (event) => {
    event.preventDefault(); if (!projection || !requestForm.reportValidity()) return;
    const old = pending.get('submit')?.input;
    const values = { model: model.value, derivative: derivative.value, quantity: Number(quantity.value) };
    const retry = old && ['model', 'derivative', 'quantity'].every((k) => old[k] === values[k]);
    operate('submit', { ...values, expectedPolicyVersion: retry ? old.expectedPolicyVersion : projection.versions.policy,
      expectedStockVersion: retry ? old.expectedStockVersion : projection.versions.stock }, 'Request submitted. Awaiting production response.');
  });
  productionForm.addEventListener('submit', (event) => {
    event.preventDefault(); if (!projection || !productionForm.reportValidity()) return;
    const request = projection.requests.find((r) => r.requestId === selected.value); if (!request) return;
    const fields = { requestId: request.requestId, expectedVersion: request.version, action: action.value,
      ...(action.value === 'confirm' ? { quantity: Number(confirmQuantity.value) }
        : { delayUntil: `${delayUntil.value}T00:00:00.000Z`, reason: reason.value }) };
    const previous = pending.get('stepProduction')?.input;
    if (previous && Object.keys(fields).filter((k) => k !== 'expectedVersion').every((k) => previous[k] === fields[k])) fields.expectedVersion = previous.expectedVersion;
    operate('stepProduction', fields, action.value === 'confirm' ? 'Production confirmed; release is queued for its expected date.' : 'Production delay saved.', action.value === 'confirm');
  });
  function teardown() { if (stopped) return; stopped = true; abort.abort(); signal?.removeEventListener('abort', teardown); root.replaceChildren(); }
  signal?.addEventListener('abort', teardown, { once: true });
  if (signal?.aborted) teardown(); else { availability(); load(); }
  teardown.refresh = load;
  return teardown;
}

export class GcspGregOrdersElement extends HTMLElement {
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this.connectedCallback(); }
  connectedCallback() { this._teardown?.(); this._teardown = mountGregOrders(this, { adapter: this._adapter,
    productionControls: this.hasAttribute('presenter-controls'), onChanged: (action) => this.dispatchEvent(new CustomEvent('gcsp:orders-changed', { bubbles: true, composed: true, detail: { action } })) }); }
  disconnectedCallback() { this._teardown?.(); }
  refresh() { return this._teardown?.refresh(); }
}
export function defineGcspGregOrders(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-greg-orders')) registry.define('gcsp-greg-orders', GcspGregOrdersElement);
  return registry.get('gcsp-greg-orders');
}
