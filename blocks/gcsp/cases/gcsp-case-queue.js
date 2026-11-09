import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { labelledField, errorSummary } from '../kit/form-controls.js';
import { dataTable } from '../kit/data-table.js';
import { caseStatus, clockTime, preferenceLabel, renderCaseContent, caseNotice, shown, carNameText, carOptionNames, roleLabel } from './case-content.js';
import { caseFailure } from './gcsp-help.js';
import { createCaseHttpAdapter, isCaseRecord, isCaseOptionsProjection } from './http-adapter.js';
import { gateInfo } from '../greg/demand-copy.js';
import { isRunRestarted, runRestartedNotice, runRestartedScreen } from '../kit/run-restarted.js';

let serial = 0;
const unavailable = { status: 'unavailable', reason: 'The renewal-case source could not be reached. Try again.' };
const triggerLabel = (c) => c.trigger?.type === 'employee-request' ? 'Help request' : shown(c.trigger?.type);
const deadlineKey = (c) => c.renewalDeadline ?? '9999-99-99';
const ranks = ['open', 'in-progress', 'remedy-proposed'];
const terminal = (c) => ['resolved', 'closed'].includes(c.status);
// Actionable statuses first, unknown ones next, then resolved and closed.
const statusRank = (c) => ranks.includes(c.status) ? ranks.indexOf(c.status) : c.status === 'resolved' ? 4 : c.status === 'closed' ? 5 : 3;
export function sortCases(cases, order = 'deadline') {
  const deadline = (a, b) => deadlineKey(a).localeCompare(deadlineKey(b));
  const rank = (a, b) => statusRank(a) - statusRank(b);
  const active = (a, b) => Number(terminal(a)) - Number(terminal(b));
  return [...cases].sort((a, b) => (order === 'status' ? rank(a, b) || deadline(a, b) : active(a, b) || deadline(a, b) || rank(a, b))
    || a.caseId.localeCompare(b.caseId));
}
function nativeSelect(items, value, placeholder) {
  const select = el('select', '');
  if (placeholder) { const option = el('option', '', placeholder); option.value = ''; select.append(option); }
  for (const [key, label] of items) { const option = el('option', '', label); option.value = key; select.append(option); }
  select.value = value ?? ''; return select;
}
const facts = (rows) => factList(rows.map(([label, value]) => ({ label, value: shown(value) })), { className: 'gcsp-case-facts' });
const remedyLabels = { alternativeCars: 'Suitable available cars', preferenceRelaxations: 'One preference change', laterRelease: 'Reviewed later release',
  manualDecision: 'Manual decision', contractExtension: 'Contract extension' };
function carName(options, orderUuid) {
  const items = options?.alternativeCars?.items ?? []; const index = items.findIndex((car) => car.orderUuid === orderUuid);
  return index < 0 ? carNameText(null) : carOptionNames(items)[index];
}
function remedyReview(remedy, options) {
  if (!remedy) return [['Remedy', 'Current remedy retained']];
  if (remedy.type === 'alternative-car') {
    return [['Remedy', 'Alternative car'], ['Proposed car', carName(options, remedy.orderUuid)], ['Exact car reference', remedy.orderUuid]];
  }
  if (remedy.type === 'preference-relaxation') return [['Remedy', 'One preference change'], ['Preference', preferenceLabel(remedy.path)],
    ['Proposed value', remedy.value], ['Employee confirmation', 'Required through the employee brief']];
  if (remedy.type === 'later-release') return [['Remedy', 'Reviewed later release'], ['Reviewed release, demo clock (UTC)', clockTime(remedy.releaseAt)], ['Source', remedy.source]];
  if (remedy.type === 'manual-decision') return [['Remedy', 'Manual decision'], ['Scheme-team decision', remedy.decision]];
  return [['Remedy', 'Contract extension'], ['Proposed contract end (calendar date)', remedy.until]];
}
function remedyChoices(options) {
  const choices = [];
  for (const key of ['alternativeCars', 'preferenceRelaxations', 'laterRelease']) {
    const group = options[key];
    if (!group?.available) continue;
    const names = key === 'alternativeCars' ? carOptionNames(group.items ?? []) : [];
    for (const [index, item] of (group.items ?? []).entries()) choices.push({ key: `${key}:${index}`, item,
      label: key === 'alternativeCars' ? `Alternative car: ${names[index]}`
        : key === 'preferenceRelaxations' ? `Change ${preferenceLabel(item.path).toLowerCase()}` : `Later release: ${clockTime(item.releaseAt)}` });
  }
  if (options.manualDecision?.available) choices.push({ key: 'manualDecision', label: 'Manual decision', item: options.manualDecision });
  if (options.contractExtension?.available) choices.push({ key: 'contractExtension', label: 'Contract extension', item: options.contractExtension });
  return choices;
}
export function mountCaseQueue(root, { adapter = createCaseHttpAdapter(), embedded = false, headingLevel = embedded ? 2 : 1,
  signal, commandId = () => `case-update-${globalThis.crypto.randomUUID()}` } = {}) {
  headingLevel = Number.isInteger(headingLevel) && headingLevel >= 1 && headingLevel <= 3 ? headingLevel : embedded ? 2 : 1;
  const abort = new AbortController(); let done = false; let queueGeneration = 0; let detailGeneration = 0; let saveGeneration = 0;
  let rows = []; let order = 'deadline'; let selection = ''; let selected = ''; let projection = null;
  let queueLoading = true; let detailLoading = false; let saving = false; let queueError = null; let detailError = null;
  let message = ''; let draft = null; let review = null; let errors = {}; let mustRefresh = false;
  const commands = new Map(); const id = `gcsp-case-queue-${++serial}`;
  const wrap = el('div', 'gcsp'); const page = el('div', `vm gcsp-case-queue${embedded ? ' is-embedded' : ''}`);
  const status = el('p', 'gcsp-case-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.tabIndex = -1;
  const content = el('div', 'gcsp-case-queue-content');
  page.append(screenIntro({ title: 'Renewal cases', level: headingLevel }), el('p', 'gcsp-note', caseNotice), status, content);
  wrap.append(page); root.replaceChildren(wrap);
  const emit = (type, reason) => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent(type, { bubbles: true, composed: true,
    detail: type === 'gcsp:ready' ? { view: 'renewal-case-queue' } : { reason } }));
  const focusStatus = () => { if (!done) status.focus(); };
  const blocked = () => mustRefresh || ['forbidden', 'stale-run'].includes(queueError?.status) || ['forbidden', 'stale-run'].includes(detailError?.status);
  const current = (generation, kind) => !done && !abort.signal.aborted && generation === (kind === 'queue' ? queueGeneration : kind === 'detail' ? detailGeneration : saveGeneration);
  async function call(operation, input) {
    try { return await (input === undefined ? adapter[operation]({ signal: abort.signal }) : adapter[operation](input, { signal: abort.signal })); }
    catch { return unavailable; }
  }
  function failureNode(error, title, retry) {
    const failure = caseFailure(error);
    return statusScreen({ title: error.status === 'unavailable' ? title : failure.title, message: failure.text, role: 'alert',
      actions: [button({ label: retry.label, variant: 'ghost', disabled: saving, onClick: retry.action })] });
  }
  function field(name, label, control, hint = '') {
    control.disabled = saving || blocked();
    return labelledField({ id: `${id}-${name}`, label, control, hint, error: errors[name] ?? '' }).root;
  }
  function changeDraft(name, value) { if (draft) { draft[name] = value; errors = {}; } }
  function inputField(name, label, type = 'text', hint = '') {
    const control = el('input', ''); control.type = type; control.value = draft[name] ?? ''; if (type === 'datetime-local') control.step = '1';
    control.addEventListener('input', () => changeDraft(name, control.value)); return field(name, label, control, hint);
  }
  function textField(name, label) {
    const control = el('textarea', ''); control.maxLength = 2000; control.value = draft[name] ?? '';
    control.addEventListener('input', () => changeDraft(name, control.value)); return field(name, label, control);
  }
  function editor() {
    const form = el('form', 'gcsp-case-editor'); form.addEventListener('submit', (event) => { event.preventDefault(); prepare(); });
    form.append(screenIntro({ title: 'Record next action', level: headingLevel + 2 }));
    const summary = errorSummary({ id: `${id}-errors`, errors: Object.entries(errors).map(([name, text]) => ({ id: `${id}-${name}`, message: text })) });
    form.append(summary.root);
    const choices = remedyChoices(projection.options);
    const next = nativeSelect(projection.nextStatuses.map((value) => [value, caseStatus(value)]), draft.status, 'Choose the next status');
    next.addEventListener('change', () => changeDraft('status', next.value));
    form.append(field('status', 'Next case status', next), textField('reason', 'Reason for this update'),
      textField('nextAction', 'Next action'), inputField('dueAt', 'Next action due, demo clock (UTC)', 'datetime-local',
        `Current demo time: ${clockTime(projection.asOf)}.`));
    const remedy = nativeSelect(choices.map((choice) => [choice.key, choice.label]), draft.remedyKey, 'Keep the current remedy, if any');
    remedy.addEventListener('change', () => { changeDraft('remedyKey', remedy.value); draft.preferenceValue = ''; draft.decision = ''; draft.until = ''; draw();
      content.querySelector(`#${id}-remedyKey`)?.focus(); });
    form.append(field('remedyKey', 'Remedy to record', remedy));
    const choice = choices.find((value) => value.key === draft.remedyKey)?.item;
    if (choice?.type === 'preference-relaxation') {
      form.append(el('p', 'gcsp-note', `${preferenceLabel(choice.path)} is currently ${shown(choice.before)}. The employee must confirm this single change through their brief.`));
      if (choice.valueType === 'enum') {
        const value = nativeSelect(choice.values.map((item, i) => [String(i), shown(item)]), draft.preferenceValue, 'Choose the proposed value');
        value.addEventListener('change', () => changeDraft('preferenceValue', value.value));
        form.append(field('preferenceValue', 'Proposed preference value', value));
      } else {
        const value = el('input', ''); value.type = 'number'; value.step = '1'; value.min = choice.minimum; value.max = choice.maximum;
        value.value = draft.preferenceValue; value.addEventListener('input', () => changeDraft('preferenceValue', value.value));
        form.append(field('preferenceValue', 'Proposed preference value', value, `From ${choice.minimum} to ${choice.maximum}${choice.unit ? ` ${choice.unit}` : ''}.`));
      }
    } else if (choice?.type === 'manual-decision') form.append(textField('decision', 'Authorised scheme-team decision'));
    else if (choice?.type === 'contract-extension') form.append(inputField('until', 'Proposed contract end (calendar date)', 'date',
      `Actual contract end: ${shown(projection.options.contractExtension.contractEndDate)}. The server checks the permitted extension date.`));
    else if (choice?.type === 'later-release') form.append(facts([['Reviewed release, demo clock (UTC)', clockTime(choice.releaseAt)], ['Source', choice.source]]));
    else if (choice?.type === 'alternative-car') form.append(facts([['Proposed car', carName(projection.options, choice.orderUuid)],
      ['Exact car reference', choice.orderUuid], ['Configuration', choice.configurationId]]));
    for (const [key, label] of Object.entries(remedyLabels)) if (projection.options[key]?.available === false)
      form.append(el('p', 'gcsp-note', `${label}: ${projection.options[key].reason ?? 'Unavailable.'}`));
    const pending = projection.options.alternativeCars?.needsConfirmation;
    if (Array.isArray(pending) && pending.length) form.append(el('p', 'gcsp-note', 'Cars that need confirmation before they can be proposed:'),
      facts(carOptionNames(pending).map((name, i) => [name, (pending[i].unknowns ?? []).map((code) => gateInfo(code).label).join(', ') || 'Needs confirmation'])));
    const actions = el('div', 'gcsp-case-actions'); actions.append(button({ label: 'Review case update', disabled: saving || blocked(), onClick: prepare }));
    form.append(actions); return form;
  }
  function draw() {
    if (done) return;
    // A lapsed access key or restarted run needs a reload, as on the rest of Greg's dashboard.
    if ([queueError, detailError].some(isRunRestarted)) {
      status.textContent = 'Demo restarted.'; content.removeAttribute('aria-busy');
      content.replaceChildren(embedded ? runRestartedNotice().root : runRestartedScreen()); return;
    }
    status.textContent = saving ? 'Recording the confirmed case update.' : queueLoading ? 'Loading renewal cases.'
      : detailLoading ? 'Loading current case options.' : queueError || detailError ? caseFailure(queueError ?? detailError).title : message;
    content.setAttribute('aria-busy', String(queueLoading || detailLoading || saving)); content.replaceChildren();
    const actions = el('div', 'gcsp-case-actions'); actions.append(button({ label: 'Refresh queue', variant: 'ghost', disabled: saving || queueLoading,
      onClick: () => refresh() })); content.append(actions);
    if (queueLoading) { content.append(statusScreen({ title: 'Loading renewal cases', message: 'Reading the current demonstration run.' })); return; }
    if (queueError) { content.append(failureNode(queueError, 'Renewal cases are unavailable', { label: 'Retry queue', action: () => refresh() })); return; }
    if (!rows.length) { content.append(statusScreen({ title: 'No renewal cases', message: 'There are no renewal-risk cases in this demonstration run.' })); return; }
    const sort = nativeSelect([['deadline', 'Deadline, active cases first'], ['status', 'Status, then deadline']], order);
    sort.disabled = saving; sort.addEventListener('change', () => { order = sort.value; draw(); content.querySelector(`#${id}-sort`)?.focus(); });
    content.append(labelledField({ id: `${id}-sort`, label: 'Sort cases', control: sort }).root);
    const sorted = sortCases(rows, order);
    content.append(dataTable({ caption: 'Renewal-risk cases', columns: [
      { key: 'employee', label: 'Employee' }, { key: 'deadline', label: 'Renewal deadline (calendar date)' }, { key: 'trigger', label: 'Trigger or request' },
      { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' }, { key: 'due', label: 'Next action due, demo clock (UTC)' },
    ], rows: sorted.map((c) => ({ employee: c.employeeName ?? c.employeeId, deadline: c.renewalDeadline ?? 'Needs confirmation', trigger: triggerLabel(c),
      reason: c.reason, status: caseStatus(c.status), owner: [...new Set([c.owner?.name, c.owner?.role && roleLabel(c.owner.role)].filter(Boolean))].join(' · '), due: clockTime(c.dueAt) })) }));
    const picker = nativeSelect(sorted.map((c) => [c.caseId, `${c.employeeName ?? c.employeeId} · ${caseStatus(c.status)} · ${c.renewalDeadline ?? 'Deadline needs confirmation'}`]), selection, 'Choose a case');
    picker.disabled = saving;
    const open = button({ label: 'Open selected case', disabled: saving || !selection, onClick: () => openCase(selection) });
    picker.addEventListener('change', () => { selection = picker.value; open.disabled = saving || !selection; });
    const pickerActions = el('div', 'gcsp-case-actions'); pickerActions.append(open);
    content.append(labelledField({ id: `${id}-selection`, label: 'Case to work', control: picker }).root, pickerActions);
    if (!selected) return;
    const detail = el('section', 'gcsp-case-work');
    const close = button({ label: 'Close case details', variant: 'ghost', disabled: saving, onClick: () => {
      detailGeneration += 1; selected = ''; projection = null; review = null; detailError = null; detailLoading = false; draw();
      content.querySelector(`#${id}-selection`)?.focus();
    } }); detail.append(close);
    if (detailLoading) detail.append(statusScreen({ title: 'Loading case options', message: 'Reading the server’s current options.' }));
    else if (detailError) detail.append(failureNode(detailError, 'Case options are unavailable', { label: 'Refresh case options', action: () => openCase(selected) }));
    if (projection && !detailLoading) {
      detail.append(screenIntro({ title: projection.case.employeeName ?? projection.case.employeeId, level: headingLevel + 1 }),
        renderCaseContent(projection.case, { headingLevel: headingLevel + 2, audience: 'scheme-team' }),
        facts([['Options as of, demo clock (UTC)', clockTime(projection.asOf)], ['Policy version', projection.policyVersion]]));
      if (!mustRefresh && !blocked()) {
        if (review) {
          const confirmation = el('section', 'gcsp-case-confirmation');
          confirmation.append(screenIntro({ title: 'Confirm case update', level: headingLevel + 2 }),
            el('p', 'gcsp-note', 'This records the update and any remedy for the employee to see on reload.'),
            facts([['Next status', caseStatus(review.status)], ['Reason', review.reason], ['Next action', review.nextAction], ['Due, demo clock (UTC)', clockTime(review.dueAt)],
              ...remedyReview(review.remedy, projection.options)]));
          const confirmActions = el('div', 'gcsp-case-actions'); confirmActions.append(
            button({ label: 'Confirm case update', disabled: saving, onClick: save }),
            button({ label: 'Cancel update', variant: 'ghost', disabled: saving, onClick: () => { review = null; draw(); content.querySelector(`#${id}-status`)?.focus(); } }));
          confirmation.append(confirmActions); detail.append(confirmation);
        } else if (projection.nextStatuses.length) detail.append(editor());
        else detail.append(el('p', 'gcsp-note', 'This case has no further permitted status changes.'));
      }
    }
    content.append(detail);
  }
  async function refresh({ keepMessage = false, focusAfter = true } = {}) {
    if (done || saving) return;
    const generation = ++queueGeneration; detailGeneration += 1; queueLoading = true; detailLoading = false; projection = null; queueError = null; detailError = null;
    review = null; draft = null; mustRefresh = false; if (!keepMessage) message = ''; draw();
    const response = await call('listCases'); if (!current(generation, 'queue')) return;
    queueLoading = false;
    if (response?.status !== 'ok' || !Array.isArray(response.value?.cases) || !response.value.cases.every(isCaseRecord)) {
      queueError = response?.status === 'ok' ? unavailable : response ?? unavailable; rows = []; emit('gcsp:unavailable', queueError.status);
    } else {
      rows = response.value.cases;
      if (!rows.some((c) => c.caseId === selection)) selection = '';
      if (!rows.some((c) => c.caseId === selected)) selected = '';
      if (!keepMessage) message = `${rows.length} renewal case${rows.length === 1 ? '' : 's'} loaded.`;
      if (selected) await openCase(selected, { focusAfter: false, keepMessage: true });
      if (!current(generation, 'queue')) return;
      emit('gcsp:ready');
    }
    draw(); if (focusAfter) focusStatus();
  }
  async function openCase(caseId, { focusAfter = true, keepMessage = false } = {}) {
    if (done || saving || !caseId) return;
    const generation = ++detailGeneration; selected = caseId; selection = caseId; projection = null; draft = null; review = null;
    detailLoading = true; detailError = null; errors = {}; mustRefresh = false; if (!keepMessage) message = ''; draw();
    const response = await call('readOptions', { caseId }); if (!current(generation, 'detail')) return;
    detailLoading = false;
    if (response?.status !== 'ok' || response.value?.case?.caseId !== caseId || !isCaseOptionsProjection(response.value)) {
      detailError = response?.status === 'ok' ? unavailable : response ?? unavailable; emit('gcsp:unavailable', detailError.status);
    } else {
      projection = response.value; draft = { status: '', reason: '', nextAction: projection.case.nextAction ?? '', dueAt: projection.case.dueAt?.slice(0, 19) ?? '',
        remedyKey: '', preferenceValue: '', decision: '', until: '' };
      if (!keepMessage) message = 'Current case options loaded.';
    }
    draw(); if (focusAfter) focusStatus();
  }
  function prepare() {
    if (done || saving || blocked() || !draft || !projection) return;
    errors = {};
    if (!projection.nextStatuses.includes(draft.status)) errors.status = 'Choose a status supplied by the server.';
    if (!draft.reason.trim()) errors.reason = 'Describe why this case is changing.';
    if (!draft.nextAction.trim()) errors.nextAction = 'Record the next action.';
    const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(draft.dueAt) ? new Date(`${draft.dueAt}Z`) : null;
    if (!date || !Number.isFinite(date.getTime())) errors.dueAt = 'Supply a UTC demonstration due date and time.';
    const choice = remedyChoices(projection.options).find((value) => value.key === draft.remedyKey)?.item;
    let remedy;
    if (choice?.type === 'manual-decision') {
      if (!draft.decision.trim()) errors.decision = 'Record the authorised scheme-team decision.';
      remedy = { type: choice.type, decision: draft.decision.trim() };
    } else if (choice?.type === 'preference-relaxation') {
      const value = choice.valueType === 'enum' ? choice.values[Number(draft.preferenceValue)] : Number(draft.preferenceValue);
      if (draft.preferenceValue === '' || value === undefined || value === choice.before
        || choice.valueType !== 'enum' && (!Number.isFinite(value) || value < choice.minimum || value > choice.maximum)) errors.preferenceValue = 'Choose a different preference value.';
      remedy = { type: choice.type, decisionId: choice.decisionId, expectedBriefVersion: choice.expectedBriefVersion, path: choice.path, value };
    } else if (choice?.type === 'contract-extension') {
      if (!draft.until) errors.until = 'Supply the proposed contract end date.';
      remedy = { type: choice.type, until: draft.until };
    } else if (choice?.type === 'later-release') remedy = { type: choice.type, releaseAt: choice.releaseAt, source: choice.source };
    else if (choice?.type === 'alternative-car') remedy = { type: choice.type, orderUuid: choice.orderUuid };
    if (Object.keys(errors).length) { draw(); content.querySelector('.gcsp-error-summary h2')?.focus(); return; }
    const input = { caseId: projection.case.caseId, expectedVersion: projection.case.version, status: draft.status,
      reason: draft.reason.trim(), nextAction: draft.nextAction.trim(), dueAt: date.toISOString(), ...(remedy ? { remedy } : {}) };
    const key = JSON.stringify(input); if (!commands.has(key)) commands.set(key, commandId());
    review = { ...input, commandId: commands.get(key) }; draw(); content.querySelector('.gcsp-case-confirmation button')?.focus();
  }
  async function save() {
    if (done || saving || blocked() || !review) return;
    const generation = ++saveGeneration; saving = true; detailError = null; message = ''; draw(); focusStatus();
    const response = await call('updateCase', structuredClone(review)); if (!current(generation, 'save')) return;
    saving = false;
    if (response?.status === 'ok' && response.value?.case?.caseId === selected && isCaseRecord(response.value.case)) {
      message = 'The case update was recorded.'; review = null; await refresh({ keepMessage: true });
    } else {
      detailError = response?.status === 'ok' ? unavailable : response ?? unavailable;
      mustRefresh = ['forbidden', 'stale-run', 'stale-version', 'conflict'].includes(detailError.status);
      if (mustRefresh) review = null;
      draw(); focusStatus(); emit('gcsp:unavailable', detailError.status);
    }
  }
  function destroy() {
    if (done) return;
    done = true; queueGeneration += 1; detailGeneration += 1; saveGeneration += 1; abort.abort(); signal?.removeEventListener('abort', destroy); wrap.remove();
  }
  destroy.refresh = refresh;
  signal?.addEventListener('abort', destroy, { once: true });
  if (signal?.aborted) destroy(); else refresh({ focusAfter: false });
  return destroy;
}
export class GcspCaseQueueElement extends HTMLElement {
  static get observedAttributes() { return ['embedded', 'heading-level']; }
  constructor() { super(); if (Object.hasOwn(this, 'adapter')) { const value = this.adapter; delete this.adapter; this._adapter = value; } }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  attributeChangedCallback(name, before, after) { if (before !== after && this.isConnected) this._mount(); }
  _mount() {
    this._teardown?.(); this._teardown = mountCaseQueue(this, { adapter: this._adapter, embedded: this.hasAttribute('embedded'),
      ...(this.hasAttribute('heading-level') ? { headingLevel: Number(this.getAttribute('heading-level')) } : {}) });
  }
  refresh() { return this._teardown?.refresh(); }
}
export function defineGcspCaseQueue(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-case-queue')) registry.define('gcsp-case-queue', GcspCaseQueueElement);
  return registry.get('gcsp-case-queue');
}
