import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { labelledField, errorSummary } from '../kit/form-controls.js';
import { syntheticNote } from '../kit/synthetic-note.js';
import { createManualSetupController } from './setup-controller.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';

let sequence = 0;
const text = (value) => value == null || value === '' ? 'Not supplied' : String(value);
const facts = (rows) => factList(rows.map(([label, value, unit]) => ({ label, value, unit })));

export function mountManualSetup(root, { adapter = createAccountHttpAdapter(), brand = 'bmw', hint,
  onBack, onSupport, commandId } = {}) {
  const prefix = `gcsp-setup-${++sequence}`; const controls = {}; const fields = {};
  let main; let panel; let summary; let state; let nodes; let disposed = false; let actionPending = false; let emitted = null;
  const notify = (name, detail) => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent(name,
    { detail, bubbles: true, composed: true }));
  const support = (route) => button({ label: route === 'hr-support' ? 'Correct employee details' : route === 'driver-support'
    ? 'Get help with drivers and licences' : 'Get scheme help', variant: 'ghost', onClick: () => {
      onSupport?.(route); notify('gcsp:support', { route });
      const message = route === 'hr-support' ? 'Contact HR support to correct employee details. No request has been sent.'
        : route === 'driver-support' ? 'Contact driver support to correct driver or licence details. No request has been sent.'
          : 'Contact scheme support to confirm your ordering details. No request has been sent.';
      if (nodes) nodes.notice.textContent = message;
      else main.append(el('p', 'gcsp-note', message));
    } });
  const controller = createManualSetupController({ adapter, commandId, onChange: (next) => { state = next; draw(); } });
  function field(key, label, tag = 'input', type = 'text', hintText = '') {
    const control = el(tag, ''); if (tag === 'input') control.type = type;
    controls[key] = control; control.name = key;
    const presentation = labelledField({ id: `${prefix}-${key}`, label, control, hint: hintText }); fields[key] = presentation;
    control.addEventListener(tag === 'select' ? 'change' : 'input', () => {
      if (['phone', 'email'].includes(key)) controller.update('contact', { phone: controls.phone.value, email: controls.email.value });
      else controller.update(key, key === 'expectedReturnMileage' ? control.value === '' ? null : Number(control.value) : control.value);
    });
    return presentation.root;
  }
  function group(title, ...children) {
    const section = el('section', 'gcsp-setup-group'); section.append(el('h2', 'gcsp-h2', title), ...children); return section;
  }
  function build() {
    panel = el('div', 'vm gcsp-setup-body');
    nodes = { notice: el('p', 'gcsp-setup-notice'), context: el('div', 'gcsp-setup-context'),
      allowance: el('div', 'gcsp-setup-allowance'), driverFacts: el('div', 'gcsp-setup-source'),
      reasons: el('ul', 'gcsp-setup-reasons'), invalidation: el('p', 'gcsp-setup-invalidation'),
      availability: el('section', 'gcsp-setup-availability'), recovery: el('div', 'gcsp-setup-actions'),
      count: el('p', 'gcsp-field-hint'), employee: el('details', 'gcsp-details'), employeeFacts: el('div', '') };
    nodes.notice.setAttribute('role', 'status'); nodes.invalidation.setAttribute('role', 'status');
    nodes.availability.setAttribute('aria-live', 'polite'); nodes.availability.tabIndex = -1;
    summary = errorSummary({ id: `${prefix}-errors`, onSelect: (id) => root.ownerDocument.getElementById(id)?.focus() });
    nodes.notice.tabIndex = -1; nodes.notice.id = `${prefix}-context`;
    const employeeSummary = el('summary', '', 'Employee details');
    nodes.employee.append(employeeSummary, nodes.employeeFacts, support('hr-support'));
    const form = el('form', 'gcsp-setup-form'); form.noValidate = true;
    const driver = group('Driver and licence', field('driverId', 'Driver', 'select'), nodes.driverFacts, support('driver-support'));
    const collection = group('Term and collection', field('contractOptionId', 'Contract term and annual mileage', 'select'),
      field('requestedCollectionDate', 'Requested collection date', 'input', 'date',
        'A requested date, not stock availability or a confirmed appointment.'),
      field('collectionLocationId', 'Collection location', 'select'), field('brand', 'Brand', 'select'), nodes.reasons);
    const contact = group('Contact and return', field('phone', 'Contact phone', 'input', 'tel'), field('email', 'Contact email', 'input', 'email'),
      field('expectedReturnMileage', 'Expected returning-car mileage (miles)', 'input', 'number', 'For the car you are replacing.'),
      field('specialRequirements', 'Special requirements (optional)', 'textarea', 'text', 'Requests do not change released stock.'), nodes.count);
    controls.phone.autocomplete = 'tel'; controls.email.autocomplete = 'email';
    controls.expectedReturnMileage.min = '0'; controls.expectedReturnMileage.step = '1';
    for (const key of ['driverId', 'contractOptionId', 'requestedCollectionDate', 'collectionLocationId', 'brand', 'phone', 'email']) controls[key].required = true;
    nodes.save = button({ label: 'Save choices', variant: 'ghost', onClick: () => save('save') });
    nodes.continue = button({ label: 'Continue', onClick: () => save('continue') });
    nodes.back = button({ label: 'Back to account', variant: 'ghost', onClick: () => save('back') });
    const actions = el('div', 'gcsp-setup-actions'); actions.append(nodes.back, nodes.save, nodes.continue);
    form.append(driver, collection, contact, actions);
    form.addEventListener('submit', (event) => { event.preventDefault(); save('continue'); });
    panel.append(screenIntro({ title: 'Your order choices', level: 1 }), nodes.context, nodes.allowance, nodes.employee,
      nodes.notice, nodes.recovery, summary.root, form, nodes.invalidation, nodes.availability, syntheticNote());
    main.replaceChildren(panel);
  }
  function select(key, rows, idKey, label) {
    const control = controls[key]; const values = [{ value: '', label: 'Choose an option', disabled: false }, ...rows.map((row) => ({
      value: row[idKey], label: label(row), disabled: !!row.disabled }))];
    const signature = JSON.stringify(values);
    if (control.dataset.options !== signature) {
      control.replaceChildren(...values.map((row) => { const option = el('option', '', row.label); option.value = row.value;
        option.disabled = row.disabled; return option; })); control.dataset.options = signature;
    }
  }
  function draw() {
    if (disposed || !main || !state) return;
    if (!state.choices) {
      if (panel) return;
      main.replaceChildren(statusScreen({ title: state.status === 'loading' ? 'Loading your choices' : 'Ordering choices unavailable',
        message: state.status === 'loading' ? 'Loading your account and saved choices.' : 'Review your account or retry. Your current car is unchanged.',
        actions: [button({ label: 'Retry', onClick: () => controller.refresh() }), button({ label: 'Back to account', variant: 'ghost',
          onClick: () => { onBack?.(); notify('gcsp:setup-back', {}); } })] })); return;
    }
    if (!panel || !panel.isConnected) build();
    const { choices: c, options: o, account: a } = state;
    // Raw ids are not copy (FUCQ-197): a slot shows only with a supplied label; scheme and contract ids are omitted.
    const slot = (a.slots ?? []).find((s) => s.entitlementSlotId === c.slotId)?.label;
    nodes.context.replaceChildren(facts([['Journey', c.mode === 'replacement' ? 'Replacement' : 'New order'],
      ...(slot ? [['Vehicle slot', slot]] : []), ...(c.mode === 'replacement' ? [['Current car', a.currentContract?.model]] : [])]));
    nodes.allowance.replaceChildren(el('h2', 'gcsp-h2', 'Your monthly allowance'),
      facts([['Monthly allowance', o.allowanceReady ? o.allowance.monthlyPoints : null, 'points a month']]),
      el('p', 'gcsp-note', 'Cars must fit your monthly points allowance. Monthly points are checked before selection.'),
      ...(o.allowanceReady ? [] : [el('p', 'gcsp-field-hint', 'Allowance needs confirmation.')]));
    nodes.employeeFacts.replaceChildren(el('p', 'gcsp-field-hint', 'Employee facts are read-only. Contact details below are editable.'),
      facts([['Name', a.account?.name], ...(a.account?.company ? [['Company', a.account.company]] : []), ['Grade', a.account?.gradeId],
      ['Employee number', a.account?.employeeNumber]]));
    select('driverId', o.drivers, 'driverId', (d) => `${d.kind === 'employee' ? 'You' : 'Nominated'}: ${text(d.name)}`);
    select('contractOptionId', o.contractOptions, 'contractOptionId', (d) => `${d.months} months, ${d.annualMileage} ${d.mileageUnit}`);
    select('collectionLocationId', o.collectionLocations, 'locationId', (d) => text(d.label)); // never the raw location id
    select('brand', o.brands.map((value) => ({ value })), 'value', (d) => d.value.toUpperCase());
    for (const [key, control] of Object.entries(controls)) {
      const value = ['phone', 'email'].includes(key) ? c.contact?.[key] : c[key];
      if (control.value !== String(value ?? '')) control.value = value ?? '';
      control.disabled = state.pending || actionPending || key === 'brand' && o.brands.length === 1;
      fields[key].setError(state.errors[key] ?? (['phone', 'email'].includes(key) ? state.errors.contact : ''));
    }
    controls.requestedCollectionDate.min = o.collectionWindow.min ?? ''; controls.requestedCollectionDate.max = o.collectionWindow.max ?? '';
    controls.expectedReturnMileage.max = o.rules?.maximumReturnMileage ?? ''; controls.expectedReturnMileage.required = c.mode === 'replacement';
    fields.expectedReturnMileage.root.hidden = c.mode !== 'replacement';
    controls.specialRequirements.maxLength = o.rules?.maximumSpecialRequirements ?? 0;
    nodes.count.textContent = `${c.specialRequirements.length} / ${o.rules?.maximumSpecialRequirements ?? 0} characters`;
    const driver = o.selectedDriver; const licence = driver?.licence;
    // Licence facts and their hint wait for a chosen driver, so an empty form never reads "Not supplied".
    nodes.driverFacts.replaceChildren(...(driver ? [el('p', 'gcsp-field-hint', 'Driver and licence facts are read-only.'),
      facts([['Relationship', driver.relationship ?? (driver.kind === 'employee' ? 'Self' : null)],
        ['Licence number', licence?.displayNumber], ['Categories', licence?.categories?.join(', ')], ['Valid from', licence?.validFrom], ['Valid until', licence?.validUntil]])] : []));
    const reasons = [...o.drivers, ...o.contractOptions, ...o.collectionLocations].filter((row) => row.disabled && row.reason);
    // Name each unavailable choice as its select does, never by its raw id (FUCQ-197).
    const caption = (row) => row.contractOptionId ? `${row.months} months, ${row.annualMileage} ${row.mileageUnit}` : text(row.name ?? row.label);
    nodes.reasons.replaceChildren(...reasons.map((row) => el('li', '', `${caption(row)}: ${row.reason}`)));
    nodes.reasons.hidden = !reasons.length;
    const errors = Object.entries(state.errors).map(([key, message]) => ({
      id: controls[key === 'contact' ? 'phone' : key]?.id ?? nodes.notice.id, message })); summary.update(errors);
    nodes.notice.textContent = state.pending ? state.status === 'saving' ? 'Saving your choices.' : 'Refreshing your context.'
      : state.reviewRequired ? state.conflictingDraft ? 'A newer saved draft exists. Your local edits are retained.' : 'Your ordering context needs review.'
        : state.failure ? 'Your choices are retained. Retry or review your context.' : state.dirty ? 'You have unsaved choices.'
          : state.draft?.draftStage === 'complete' ? 'Your choices are saved.' : '';
    nodes.recovery.replaceChildren();
    if (state.reviewRequired || state.failure) nodes.recovery.append(button({ label: 'Review fresh context', variant: 'ghost', onClick: () => controller.refresh() }));
    if (state.conflictingDraft) nodes.recovery.append(button({ label: 'Discard local edits and load newer draft', variant: 'ghost',
      onClick: () => controller.refresh({ discardEdits: true }) }));
    if (state.failure?.reason === 'ordering-action-changed') nodes.recovery.append(button({ label: 'Return to account without saving', variant: 'ghost',
      onClick: () => { onBack?.(); notify('gcsp:setup-back', {}); } }));
    if (state.errors.allowance || !o.allowanceReady) nodes.recovery.append(support('scheme-support'));
    for (const control of [nodes.save, nodes.continue, nodes.back]) control.disabled = state.pending || actionPending;
    nodes.invalidation.textContent = state.invalidationMessage ?? ''; nodes.invalidation.hidden = !state.invalidationMessage;
    nodes.availability.replaceChildren();
    if (state.availability?.status === 'loading') nodes.availability.append(el('p', 'gcsp-note', 'Refreshing availability.'));
    else if (state.availability?.status === 'ok') nodes.availability.append(el('h2', 'gcsp-h2', 'Availability refreshed'),
      el('p', 'gcsp-note', `${state.availability.value.total} eligible cars for your saved choices. Browsing does not reserve a car.`));
    else if (state.availability) nodes.availability.append(el('h2', 'gcsp-h2', 'Availability could not be refreshed'),
      el('p', 'gcsp-note', 'Your saved choices are retained.'), button({ label: 'Retry availability', variant: 'ghost', onClick: () => controller.refresh() }));
  }
  async function save(action) {
    if (actionPending || disposed) return;
    actionPending = true; draw();
    try {
      const result = await controller.save(); state = controller.getState();
      if (result.status !== 'ok') { draw(); summary?.focus(); return; }
      if (action === 'back') { onBack?.(); notify('gcsp:setup-back', {}); return; }
      const ready = !state.reviewRequired && !state.dirty && state.availability?.status === 'ok'
        && state.versions?.draft === state.draft.draftVersion && state.versions.context === state.account.contextVersion;
      if (action === 'continue' && ready) {
        const key = `${state.draft.draftVersion}:${state.draft.contextVersion}`;
        if (emitted !== key) { emitted = key; const { mode, oldContractId, slotId, schemeId } = state.choices;
          notify('gcsp:setup-ready', { mode, oldContractId, slotId, schemeId, draftVersion: state.draft.draftVersion,
            contextVersion: state.draft.contextVersion }); }
        nodes.availability.focus();
      }
    } finally { actionPending = false; draw(); }
  }
  const teardown = mountEmployee(root, { brand, loadAccount: async () => {
    state = await controller.load({ hint }); const account = state.account?.account;
    return { status: account ? 'ready' : 'unavailable', name: account?.name ?? 'Account unavailable',
      context: [account?.company, account?.gradeId && `Grade ${account.gradeId}`].filter(Boolean).join(', ') };
  }, renderBody(target) { main = target; draw(); } });
  const destroy = () => { disposed = true; controller.destroy(); teardown(); };
  destroy.controller = controller; destroy.refresh = (options) => controller.refresh(options);
  return destroy;
}

export class GcspManualSetupElement extends HTMLElement {
  constructor() { super(); if (Object.hasOwn(this, 'adapter')) { const adapter = this.adapter; delete this.adapter; this._adapter = adapter; } }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  _mount() { this._teardown?.(); this._teardown = mountManualSetup(this, { adapter: this._adapter, brand: this.getAttribute('brand') ?? 'bmw' }); }
}
export function defineGcspManualSetup(registry = globalThis.customElements) {
  if (registry && !registry.get('gcsp-manual-setup')) registry.define('gcsp-manual-setup', GcspManualSetupElement);
  return registry?.get('gcsp-manual-setup');
}
export default function decorate(block, options) { return mountManualSetup(block, options); }
