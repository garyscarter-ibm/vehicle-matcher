import { el, screenIntro, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { labelledField, errorSummary } from '../kit/form-controls.js';
import { mountEmployee, EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';
import { createCaseHttpAdapter } from './http-adapter.js';
import { renderCaseContent, preferenceLabel, shown, caseNotice } from './case-content.js';

let serial = 0;
const unavailable = { status: 'unavailable', reason: 'Renewal help could not be loaded. Try again.' };
export function caseFailure(envelope) {
  const status = envelope?.status;
  if (status === 'access-required') return { title: 'Demo access needed', text: 'Your demo access has lapsed. Enter the access key again.' };
  const titles = { forbidden: 'You cannot open these cases', 'stale-run': 'Your demo run has changed',
    'stale-version': 'The case or brief has changed', conflict: 'The case or brief has changed', invalid: 'Review your request' };
  const detail = envelope?.reason ?? envelope?.reasons?.map((r) => r.reason).join(' ');
  return { title: titles[status] ?? 'Renewal help is unavailable', text: detail || (['stale-run', 'forbidden'].includes(status)
    ? 'Reopen the current employee session.' : 'Refresh to review the current server state before trying again.') };
}
const emit = (root, type, detail) => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent(type,
  { detail, bubbles: true, composed: true }));

export function mountHelpBody(root, { adapter = createCaseHttpAdapter(), signal, headingLevel = 1, commandId = () => `case-${globalThis.crypto.randomUUID()}` } = {}) {
  headingLevel = Number.isInteger(headingLevel) && headingLevel >= 1 && headingLevel <= 4 ? headingLevel : 1;
  const childLevel = headingLevel + 1;
  const abort = new AbortController();
  const externalAbort = () => destroy();
  signal?.addEventListener('abort', externalAbort, { once: true });
  let done = false; let generation = 0; let loading = true; let saving = false;
  let cases = []; let failure = null; let message = ''; let reason = ''; let error = ''; let editing = false;
  let review = null; let relaxation = null; let opened = false;
  const commands = new Map();
  const id = `gcsp-help-${++serial}`;
  const wrap = el('div', 'gcsp');
  const page = el('div', 'vm gcsp-cases-body');
  const status = el('p', 'gcsp-case-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.tabIndex = -1;
  const content = el('div', 'gcsp-case-content');
  page.append(screenIntro({ title: 'Renewal help', level: headingLevel }), el('p', 'gcsp-note', caseNotice), status, content); wrap.append(page); root.replaceChildren(wrap);
  const current = (version) => !done && !abort.signal.aborted && version === generation;
  const commandFor = (input) => {
    const key = JSON.stringify(input);
    if (!commands.has(key)) commands.set(key, commandId());
    return commands.get(key);
  };
  async function read(name) {
    try { return await adapter[name]({ signal: abort.signal }); } catch { return unavailable; }
  }
  const blocked = () => ['forbidden', 'stale-run'].includes(failure?.status);
  function focusStatus() { if (!done) status.focus(); }
  function focus(selector) { content.querySelector(selector)?.focus(); }
  function draw(focusTo) {
    if (done) return;
    status.textContent = saving ? 'Saving your confirmed request.' : loading ? 'Loading renewal help.' : failure ? caseFailure(failure).title : message;
    content.setAttribute('aria-busy', String(loading || saving));
    content.replaceChildren();
    if (loading) { content.append(statusScreen({ title: 'Loading your cases', message: 'Reading the current demonstration run.' })); return; }
    if (failure) {
      const shown = caseFailure(failure);
      content.append(statusScreen({ title: shown.title, message: shown.text, role: 'alert',
        actions: [button({ label: 'Refresh cases', variant: 'ghost', disabled: saving, onClick: () => refresh() })] }));
      if (!cases.length && !review && !relaxation) return;
      if (cases.length) content.append(el('p', 'gcsp-note', 'Previously loaded case information is shown below. Refresh to check its current state.'));
    }
    const entry = el('details', 'gcsp-case-entry'); entry.open = opened;
    entry.addEventListener('toggle', () => { opened = entry.open; });
    entry.append(el('summary', '', 'Get help with your renewal'),
      el('p', 'gcsp-note', 'The scheme team can review a delayed or uncertain renewal and explain the next action. Opening help changes nothing.'));
    if (!editing && !review) entry.append(button({ label: 'Ask for help', disabled: saving || blocked(), onClick: () => {
      editing = true; opened = true; draw('textarea');
    } }));
    if (editing && !review) {
      const textarea = el('textarea', ''); textarea.value = reason; textarea.maxLength = 2000; textarea.disabled = saving || blocked();
      textarea.addEventListener('input', () => { reason = textarea.value; });
      const field = labelledField({ id: `${id}-reason`, label: 'What do you need help with?', control: textarea,
        hint: 'Your reason will be shared with the scheme team.', error });
      const summary = errorSummary({ id: `${id}-errors`, errors: error ? [{ id: textarea.id, message: error }] : [] });
      const form = el('form', 'gcsp-case-form');
      form.addEventListener('submit', (event) => { event.preventDefault(); prepareRequest(); });
      const actions = el('div', 'gcsp-case-actions');
      actions.append(button({ label: 'Review help request', disabled: saving || blocked(), onClick: prepareRequest }),
        button({ label: 'Cancel', variant: 'ghost', disabled: saving, onClick: () => { editing = false; error = ''; draw('summary'); } }));
      form.append(summary.root, field.root, actions); entry.append(form);
    }
    if (review) {
      const confirmation = el('section', 'gcsp-case-confirmation');
      confirmation.append(screenIntro({ title: 'Confirm your help request', level: childLevel }),
        el('p', 'gcsp-note', 'This opens a scheme-team case or adds to your existing case and shares the reason below.'),
        el('p', 'gcsp-case-reason', review.reason));
      const actions = el('div', 'gcsp-case-actions');
      actions.append(button({ label: 'Confirm help request', disabled: saving || blocked(), onClick: submitRequest }),
        button({ label: 'Cancel', variant: 'ghost', disabled: saving, onClick: () => { review = null; editing = false; draw('summary'); } }));
      confirmation.append(actions); entry.append(confirmation);
    }
    content.append(entry);
    if (!cases.length) content.append(statusScreen({ title: 'No renewal case', message: 'Help is available if you need the scheme team to review your renewal.' }));
    else {
      for (const c of cases) content.append(renderCaseContent(c, { headingLevel: childLevel, pending: saving || !!failure, onReviewRelaxation: (value) => {
        relaxation = value; draw('[data-confirm-relaxation]');
      } }));
    }
    if (relaxation) {
      const remedy = relaxation.remedy;
      const confirmation = el('section', 'gcsp-case-confirmation');
      confirmation.append(screenIntro({ title: 'Confirm one preference change', level: childLevel }),
        el('p', 'gcsp-note', `${preferenceLabel(remedy.path)}: ${shown(relaxation.relaxation.before)} → ${shown(remedy.value)}.`),
        el('p', 'gcsp-note', 'This confirms only this preference value in a new brief version. All other preferences, essentials and importance weights stay the same. It does not resolve your case or guarantee a car.'));
      const confirm = button({ label: 'Confirm preference change', disabled: saving, onClick: submitRelaxation });
      confirm.dataset.confirmRelaxation = '';
      const actions = el('div', 'gcsp-case-actions'); actions.append(confirm,
        button({ label: 'Cancel preference change', variant: 'ghost', disabled: saving, onClick: () => { relaxation = null; draw('.gcsp-case-remedy .vm-btn'); } }));
      confirmation.append(actions); content.append(confirmation);
    }
    if (focusTo) focus(focusTo);
  }
  function prepareRequest() {
    if (done || saving || blocked()) return;
    if (!reason.trim() || reason.length > 2000) { error = 'Describe your renewal problem in 1 to 2,000 characters.'; draw('textarea'); return; }
    error = ''; review = { reason: reason.trim() }; review.commandId = commandFor({ request: review.reason });
    opened = true; draw('.gcsp-case-confirmation button');
  }
  async function refresh({ keepMessage = false, focusAfter = true } = {}) {
    if (done || saving) return;
    const version = ++generation; loading = true; failure = null; relaxation = null;
    if (!keepMessage) message = '';
    draw();
    const [help, own] = await Promise.all([read('readHelp'), read('readCases')]);
    if (!current(version)) return;
    loading = false;
    if (help?.status !== 'ok' || help.value?.opensCase !== false) failure = help?.status === 'ok' ? unavailable : help;
    else if (own?.status !== 'ok' || !Array.isArray(own.value?.cases)) failure = own?.status === 'ok' ? unavailable : own;
    else { cases = own.value.cases; failure = null; if (focusAfter && !keepMessage) message = 'Cases refreshed.'; }
    draw();
    if (focusAfter) focusStatus();
    if (failure) emit(root, 'gcsp:unavailable', { reason: failure.status });
    else emit(root, 'gcsp:ready', { view: 'renewal-help' });
  }
  async function save(operation, input, success, valid) {
    if (done || saving || blocked()) return;
    const version = ++generation; saving = true; failure = null; message = ''; draw(); focusStatus();
    let response;
    try { response = await adapter[operation](input, { signal: abort.signal }); } catch { response = unavailable; }
    if (!current(version)) return;
    saving = false;
    if (response?.status === 'ok' && valid(response.value)) {
      message = success; review = null; editing = false; relaxation = null; reason = '';
      await refresh({ keepMessage: true });
    } else {
      failure = response?.status === 'ok' ? unavailable : response ?? unavailable;
      if (['stale-run', 'forbidden', 'stale-version', 'conflict'].includes(failure.status)) { review = null; relaxation = null; editing = false; }
      draw(); focusStatus(); emit(root, 'gcsp:unavailable', { reason: failure.status });
    }
  }
  function submitRequest() {
    if (!review || blocked()) return;
    return save('requestHelp', { ...review }, 'Your help request was recorded.', (value) => !!value?.case?.caseId);
  }
  function submitRelaxation() {
    if (!relaxation || relaxation.relaxation?.applicable !== true
      || relaxation.relaxation.currentBriefVersion !== relaxation.remedy.expectedBriefVersion) return;
    const { remedy } = relaxation;
    const input = { decisionId: remedy.decisionId, expectedBriefVersion: relaxation.relaxation.currentBriefVersion,
      change: { path: remedy.path, value: remedy.value } };
    return save('changeAfterDecline', { ...input, commandId: commandFor(input) },
      'Your preference change was confirmed. The scheme team will review the current case.', (value) => Number.isSafeInteger(value?.brief?.briefVersion));
  }
  function destroy() {
    if (done) return;
    done = true; generation += 1; abort.abort(); signal?.removeEventListener('abort', externalAbort); wrap.remove();
  }
  destroy.refresh = refresh;
  if (signal?.aborted) destroy(); else refresh({ focusAfter: false });
  return destroy;
}

export function mountHelp(root, { adapter = createCaseHttpAdapter(), accountAdapter = createAccountHttpAdapter(), embedded = false, headingLevel = embedded ? 2 : 1, brand = 'bmw' } = {}) {
  if (embedded) return mountHelpBody(root, { adapter, headingLevel });
  let body;
  const shell = mountEmployee(root, { brand, view: 'help',
    navigation: EMPLOYEE_NAVIGATION.map((item) => item.key === 'help' ? { ...item, available: true, label: 'Renewal help' } : item),
    onNavigate: (to) => emit(root, 'gcsp:navigate', { to }), loadAccount: (options) => accountAdapter.loadAccount(options),
    renderBody: (main) => { body = mountHelpBody(main, { adapter, headingLevel }); return body; },
    onUnavailable: (reason) => emit(root, 'gcsp:unavailable', { reason }) });
  const destroy = () => shell(); destroy.refresh = () => body?.refresh(); return destroy;
}

export class GcspHelpElement extends HTMLElement {
  static get observedAttributes() { return ['embedded', 'brand', 'heading-level']; }
  constructor() {
    super();
    for (const key of ['adapter', 'accountAdapter']) if (Object.hasOwn(this, key)) { const value = this[key]; delete this[key]; this[`_${key}`] = value; }
  }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  get accountAdapter() { return this._accountAdapter; }
  set accountAdapter(value) { this._accountAdapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  attributeChangedCallback(name, before, after) { if (before !== after && this.isConnected) this._mount(); }
  _mount() {
    this._teardown?.(); this._teardown = mountHelp(this, { adapter: this._adapter, accountAdapter: this._accountAdapter,
      embedded: this.hasAttribute('embedded'),
      ...(this.hasAttribute('heading-level') ? { headingLevel: Number(this.getAttribute('heading-level')) } : {}), brand: this.getAttribute('brand') ?? 'bmw' });
  }
  refresh() { return this._teardown?.refresh(); }
}
export function defineGcspHelp(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-help')) registry.define('gcsp-help', GcspHelpElement);
  return registry.get('gcsp-help');
}
export default function decorate(root, options) { return mountHelp(root, options); }
