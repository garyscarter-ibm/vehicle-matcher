import { el, button, factList } from '../../vehicle-matcher/ui.js';
import { renderOptionList } from '../../vehicle-matcher/modes/question-ui.js';
import { presenterBar } from '../kit/presenter-bar.js';
import { labelledField } from '../kit/form-controls.js';
import { createPresenterHttpAdapter } from './http-adapter.js';

let sequence = 0;
const explain = (value) => typeof value === 'string' ? value : JSON.stringify(value);
const reason = (reply) => [reply?.status, reply?.code, reply?.reason,
  ...(Array.isArray(reply?.reasons) ? reply.reasons.filter((row) => typeof row?.reason === 'string')
    .map((row) => `${typeof row.field === 'string' ? `${row.field}: ` : ''}${row.reason}`) : []),
].filter(Boolean).map(explain).join(': ');
const workspace = () => new URL('../../../gcsp-presenter.html', import.meta.url).href;
const text = (value) => typeof value === 'string' && value.length > 0;
const exactOrderId = (value) => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

function releasedCarCount(state) {
  const tick = state.lastTick;
  if (!text(state.runId) || tick?.runId !== state.runId || !text(tick.tickId) || tick.eventId !== tick.tickId
    || !Array.isArray(tick.handlerOrder) || !Array.isArray(tick.outcomes) || !Array.isArray(tick.missingStages)
    || tick.missingStages.includes('release-pull')) return null;
  const isRelease = (row) => row?.handlerId === 'stock-release' || row?.stage === 'release-pull';
  const registrations = tick.handlerOrder.filter(isRelease);
  const results = tick.outcomes.filter(isRelease);
  if (registrations.length !== 1 || results.length !== 1
    || registrations[0].handlerId !== 'stock-release' || registrations[0].stage !== 'release-pull'
    || results[0].handlerId !== 'stock-release' || results[0].stage !== 'release-pull'
    || results[0].outcome?.status !== 'ok') return null;
  const value = results[0].outcome.value;
  if (!['stock-released', 'no-release'].includes(value?.kind) || value.runId !== state.runId || value.tickId !== tick.tickId
    || !Array.isArray(value.orderUuids) || !value.orderUuids.every(exactOrderId)
    || new Set(value.orderUuids).size !== value.orderUuids.length
    || value.kind === 'no-release' && value.orderUuids.length !== 0) return null;
  // The committed producer result lists newly released cars, not cumulative visible stock.
  return value.orderUuids.length;
}

// All controls retain their DOM identity while readback and results update.
export function mountPresenterControls(host, { adapter = createPresenterHttpAdapter(),
  commandId = () => globalThis.crypto.randomUUID(), navigate = (url) => { const link = el('a'); link.href = url; link.click(); } } = {}) {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let disposed = false; let busy = false; let authorized = false; let state; let context; let catalogue;
  let focusAfterBusy = null;
  let original = null; let uncertain = false; let confirming = false;
  const bar = presenterBar();
  const { root, summary, panel } = bar; root.classList.add('gcsp-presenter-controls'); root.hidden = true;
  const results = el('div', 'gcsp-presenter-results');
  const message = el('p', 'gcsp-note', 'Loading presenter controls'); message.setAttribute('role', 'status');
  const readMessage = el('p', 'gcsp-note'); readMessage.setAttribute('role', 'status');
  const actions = el('div', 'gcsp-presenter-actions');
  const controls = [];
  const action = (label, run) => { const node = button({ label, variant: 'ghost', onClick: run }); controls.push(node); return node; };
  function field(label, type = 'input') {
    const input = el(type, 'gcsp-presenter-input'); controls.push(input);
    const wrapped = labelledField({ id: `presenter-${++sequence}`, label, control: input });
    return { input, root: wrapped.root };
  }
  const target = field('Named time or UTC target', 'input'); target.input.type = 'text'; target.input.placeholder = 'UTC ISO time or named cue';
  const named = el('datalist', ''); named.id = `presenter-times-${++sequence}`; target.input.setAttribute('list', named.id);
  // Rebuild only changed catalogue rows; ordinary reads project through update().
  function picker(label) {
    const root = el('fieldset', 'gcsp-presenter-picker');
    root.append(el('legend', 'gcsp-field-label', label));
    const body = el('div'); root.append(body);
    let signature; let control;
    const picker = { root, value: null, initial: false, describedBy: null,
      project(rows, initialValue, disabled) {
        if (!picker.initial && rows.some((row) => row.value === initialValue)) {
          picker.value = initialValue; picker.initial = true;
        }
        const nextSignature = JSON.stringify(rows);
        if (signature !== nextSignature) {
          signature = nextSignature;
          if (!rows.some((row) => row.value === picker.value)) picker.value = null;
          control = renderOptionList({ label, options: rows }, null, {
            value: picker.value, ariaLabel: label, disabled,
            onValueChange(value) { picker.value = value; picker.initial = true; update(); },
          });
          if (picker.describedBy) control.list.setAttribute('aria-describedby', picker.describedBy);
          [...control.list.children].forEach((node, index) => { node.dataset.value = rows[index].value; });
          body.replaceChildren(control.list);
        }
        control.update({ value: picker.value, disabled });
      },
    };
    return picker;
  }
  const scenario = picker('Scenario'); const principal = picker('Acting principal');
  const availability = el('p', 'gcsp-note'); availability.id = `presenter-availability-${++sequence}`;
  scenario.describedBy = availability.id;
  const tick = action('Tick', () => start('tick', { expectedClockVersion: state.clockVersion, mode: 'step' }));
  const to = action('Tick to target', () => start('tick', { expectedClockVersion: state.clockVersion, mode: 'to', to: target.input.value }));
  const next = action('Next release', () => start('tick', { expectedClockVersion: state.clockVersion, mode: 'next-release' }));
  const nextReason = el('p', 'gcsp-note'); nextReason.id = `presenter-release-${++sequence}`; next.setAttribute('aria-describedby', nextReason.id);
  const reset = action('Reset scenario', () => { confirming = true; confirmation.hidden = false; update(); confirm.focus(); });
  const confirmation = el('div', 'gcsp-presenter-confirmation'); confirmation.hidden = true;
  const confirmText = el('p', 'gcsp-note');
  const confirm = action('Confirm reset', () => {
    const selected = catalogue?.scenarios?.find((row) => row.scenarioId === scenario.value);
    if (!selected?.availability?.available) return;
    confirming = false; confirmation.hidden = true;
    start('reset', { expectedRunId: state.runId, expectedRunVersion: state.runVersion, scenarioId: selected.scenarioId,
      scenarioVersion: selected.scenarioVersion, fixtureVersion: selected.fixtureVersion, policyVersion: catalogue.policyVersion });
  });
  const cancel = action('Cancel reset', () => { confirming = false; confirmation.hidden = true; update(); reset.focus(); });
  confirmation.append(confirmText, confirm, cancel);
  const switchButton = action('Switch principal', () => start('switchPrincipal', { principalId: principal.value }));
  const retry = action('Retry original action', () => execute()); retry.hidden = true;
  const fresh = action('Issue selected principal again', () => {
    original = null; uncertain = false; start('switchPrincipal', { principalId: principal.value });
  }); fresh.hidden = true;
  const refresh = action('Refresh readback', () => refreshState());
  actions.append(tick, target.root, named, to, next, nextReason, scenario.root, availability, reset, confirmation,
    principal.root, switchButton, retry, fresh, refresh);
  panel.append(actions, message, readMessage, results); host.append(root);
  function update() {
    if (disposed || !authorized) return;
    root.hidden = false; root.setAttribute('aria-busy', String(busy));
    if (busy && !focusAfterBusy && root.contains(root.ownerDocument.activeElement)) focusAfterBusy = root.ownerDocument.activeElement;
    controls.forEach((node) => { node.disabled = busy || uncertain && ![retry, fresh, refresh].includes(node); });
    if (!state) return;
    bar.setReadback([
      { label: 'Scenario', value: state.currentScenario?.name, missingLabel: 'Scenario not supplied' },
      { label: 'Run', value: state.runId }, { label: 'DemoClock (UTC)', value: state.now },
      { label: 'Acting principal', value: context?.principalId ? `${context.name || context.principalId} (${context.roles?.join(', ') || 'role not supplied'})` : null, missingLabel: 'Context unavailable' },
    ]);
    principal.project((state.principals || []).map((row) => ({ value: row.principalId,
      label: `${row.name} (${row.roles.join(', ')})` })), context?.principalId, busy || uncertain);
    scenario.project((catalogue?.scenarios || []).map((row) => ({ value: row.scenarioId, label: row.name,
      sub: row.availability?.available ? 'Available' : `Not available yet: ${row.availability?.missingCapabilities?.join(', ') || 'Capabilities not supplied'}`,
    })), state.currentScenario?.scenarioId, busy || uncertain);
    named.replaceChildren(...Object.keys(state.controls?.namedTimes || {}).map((name) => { const option = el('option'); option.value = name; return option; }));
    tick.textContent = `Tick (${state.controls?.step?.value ?? 'unavailable'} ${state.controls?.step?.unit ?? ''})`;
    tick.disabled ||= !state.controls?.step; to.disabled ||= !target.input.value.trim();
    next.disabled ||= state.controls?.nextRelease?.status !== 'available';
    nextReason.textContent = state.controls?.nextRelease?.status === 'available'
      ? `Release cue: ${state.controls.nextRelease.at}` : `Next release unavailable: ${state.controls?.nextRelease?.reason || 'No future cue'}`;
    const chosen = catalogue?.scenarios?.find((row) => row.scenarioId === scenario.value);
    availability.textContent = chosen?.availability?.available ? 'Available' : `Not available yet: ${chosen?.availability?.missingCapabilities?.join(', ') || reason(catalogue) || 'Scenario catalogue unavailable'}`;
    reset.disabled ||= !chosen?.availability?.available; confirm.disabled ||= !chosen?.availability?.available;
    switchButton.disabled ||= !principal.value;
    confirmText.textContent = `Reset into ${chosen?.name || 'selected scenario'}? This starts a new run.`;
    const last = state.lastTick;
    results.replaceChildren(el('h3', '', 'Last tick'));
    if (!last) results.append(el('p', 'gcsp-note', 'No tick reported'));
    else {
      results.append(factList([{ label: 'Event', value: last.eventId || last.tickId }, { label: 'State', value: last.state }]));
      const order = el('ol', 'gcsp-presenter-handlers');
      const handlers = Array.isArray(last.outcomes) ? last.outcomes : [];
      for (const descriptor of Array.isArray(last.handlerOrder) ? last.handlerOrder : []) {
        if (!descriptor || typeof descriptor !== 'object') continue;
        const outcome = handlers.find((row) => row?.handlerId === descriptor.handlerId);
        order.append(el('li', '', `${descriptor.stage} / ${descriptor.handlerId}: ${outcome ? explain(outcome.outcome) : 'Pending, no result reported'}`));
      }
      results.append(order);
      if (Array.isArray(last.missingStages) && last.missingStages.length) results.append(el('p', 'gcsp-note', `Missing stages: ${last.missingStages.join(', ')}`));
      const count = releasedCarCount(state);
      results.append(el('p', 'gcsp-note', count === null ? 'Release unavailable: no verified release result reported' : `${count} cars released`));
    }
    retry.hidden = !original || !uncertain; fresh.hidden = !(uncertain && original?.kind === 'switchPrincipal');
    if (!busy && focusAfterBusy) {
      if (root.ownerDocument.activeElement === root.ownerDocument.body) {
        const target = !focusAfterBusy.disabled && !focusAfterBusy.closest('[hidden]') ? focusAfterBusy : summary; target.focus();
      }
      focusAfterBusy = null;
    }
  }
  async function refreshState() {
    if (busy || disposed) return;
    busy = true; readMessage.textContent = 'Loading readback'; update();
    try {
      const read = await adapter.readControls(options); if (disposed) return;
      if (read.status !== 'ok') {
        if (!authorized) return;
        if (['forbidden', 'missing-session', 'unknown-session', 'expired-session'].includes(read.status)) { authorized = false; root.hidden = true; return; }
        readMessage.textContent = read.code === 'presenter-transport-unavailable' ? 'Backend unavailable. Refresh readback.' : `Readback ${reason(read)}`; return;
      }
      authorized = true; state = read.value; update();
      const [acting, scenarios] = await Promise.all([adapter.readContext(options), adapter.readScenarios(options)]);
      if (disposed) return;
      context = acting.status === 'ok' ? acting.value : null; catalogue = scenarios.status === 'ok' ? scenarios.value : scenarios;
      readMessage.textContent = acting.status === 'ok' ? '' : `Acting context ${reason(acting)}`;
      if (!original) message.textContent = 'Presenter controls ready';
      if (acting.status === 'ok') return { controls: read.value, context: acting.value };
    } catch { if (!disposed && authorized) readMessage.textContent = 'Backend unavailable'; }
    finally { busy = false; update(); }
  }
  function start(kind, payload) {
    if (busy || disposed || uncertain || !authorized) return;
    original = Object.freeze({ kind, payload: Object.freeze({ commandId: commandId(), ...payload }) });
    execute();
  }
  async function execute() {
    if (!original || busy || disposed) return;
    busy = true; message.textContent = 'Action in progress'; update();
    const command = original;
    const retrying = uncertain;
    try {
      const reply = await adapter[command.kind](command.payload, options); if (disposed) return;
      const value = reply.status === 'ok' ? reply.value : reply;
      if (value.advance) state = { ...state, ...value.advance };
      if (command.kind === 'reset' && reply.status === 'ok') {
        state = { ...state, ...value };
      }
      if (value.tick) state = { ...state, lastTick: value.tick };
      uncertain = Boolean(reply.lostResponse || reply.status !== 'ok' && reply.retryable);
      message.textContent = reply.status === 'ok' ? command.kind === 'reset' ? `Reset done. New run: ${value.runId}` : 'Action recorded' : `Action ${reason(reply)}`;
      if (reply.lostResponse) message.textContent = 'Backend unavailable or response lost. Retry the original action.';
      if (command.kind === 'reset' && value.presenterSession?.status === 'unavailable') {
        message.textContent += ` Presenter session unavailable. ${value.presenterSession.action || 'Use trusted backend bootstrap.'}`;
      }
      if (reply.handlerOutcome) message.textContent += ` Handler: ${reason(reply.handlerOutcome)}`;
      if (command.kind === 'reset' && reply.status === 'ok') {
        original = null;
        navigate(workspace());
        return;
      }
      if (command.kind === 'switchPrincipal') {
        const acting = await adapter.readContext(options); if (disposed) return;
        context = acting.status === 'ok' ? acting.value : null;
        if (context?.principalId === command.payload.principalId) {
          uncertain = false; message.textContent = 'Principal confirmed'; navigate(workspace());
        } else {
          uncertain = true; message.textContent = `Switch uncertain or refused: ${reason(reply)}. Selected principal is not confirmed. Retry original or deliberately issue again.`;
        }
      }
      if (reply.status === 'ok' && command.kind !== 'reset' && command.kind !== 'switchPrincipal') {
        const Event = host.ownerDocument?.defaultView?.CustomEvent;
        if (Event) host.dispatchEvent(new Event('gcsp:presenter-action', { bubbles: true, detail: { kind: command.kind } }));
      }
      busy = false;
      const fresh = await refreshState();
      if (retrying && command.kind === 'reset' && reply.status === 'stale-run'
        && typeof fresh?.controls?.runId === 'string' && fresh.controls.runId !== command.payload.expectedRunId
        && fresh.context.runId === fresh.controls.runId) {
        original = null;
        navigate(workspace());
        return;
      }
      if (!uncertain) original = null;
    } catch { if (!disposed) { uncertain = true; message.textContent = 'Backend unavailable. Retry the original action.'; } }
    finally { busy = false; update(); }
  }
  const onChange = () => update();
  target.input.addEventListener('input', onChange);
  const escape = (event) => {
    if (event.key !== 'Escape') return;
    if (confirming) { confirming = false; confirmation.hidden = true; reset.focus(); }
    else { root.open = false; summary.focus(); }
  };
  root.addEventListener('keydown', escape);
  refreshState();
  return { root, refresh: refreshState, destroy() { disposed = true; abort.abort(); root.removeEventListener('keydown', escape);
    target.input.removeEventListener('input', onChange); root.remove(); } };
}

export class GcspPresenterControlsElement extends HTMLElement {
  set adapter(value) { this._adapter = value; if (this.isConnected) this.connectedCallback(); }
  get adapter() { return this._adapter; }
  connectedCallback() { this._controls?.destroy(); this._controls = mountPresenterControls(this, { adapter: this._adapter }); }
  disconnectedCallback() { this._controls?.destroy(); this._controls = null; }
}
export function defineGcspPresenterControls(registry = globalThis.customElements) {
  if (!registry.get('gcsp-presenter-controls')) registry.define('gcsp-presenter-controls', GcspPresenterControlsElement);
  return registry.get('gcsp-presenter-controls');
}
