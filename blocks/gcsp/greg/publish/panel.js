import { el, cardinal, screenIntro, button, statusScreen, factList } from '../../../vehicle-matcher/ui.js';
import { renderRangeSlider, formatSliderValue } from '../../../vehicle-matcher/modes/question-ui.js';
import { labelledField, errorSummary } from '../../kit/form-controls.js';
import { dataTable } from '../../kit/data-table.js';
import { metricTile } from '../../kit/metric-tile.js';
import { isRunRestarted, runRestartedNotice } from '../../kit/run-restarted.js';
import { formatDemoTime } from '../demand-copy.js';
import { validPolicy, validPreview, validPublished } from './http-adapter.js';

let sequence = 0;
const note = (text) => el('p', 'gcsp-note', text);
const when = (iso) => formatDemoTime(iso) ?? 'Time not available';
const fieldName = (f) => f.label;
const nowHint = (f) => `Now ${f.value}${f.kind === 'price' ? ` ${f.unitLabel}` : ''}`;
const unitText = (f) => f.kind === 'price' ? ` ${f.unitLabel}` : '';
// Mirrors the server versionLabel rule; names come from the projected policy.
const versionLabel = (id, names) => String(id).split('+').map((part) => (Object.hasOwn(names, part) ? names[part]
  : part.startsWith('greg-') ? "Greg's change" : 'Unnamed update')).join(' with ');
const safeNumber = (v) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= 0;
const countValue = (c) => ({ label: c.label, isBand: c.kind === 'band' });
const scoreValue = (s) => s.status === 'available' ? `${s.value.toFixed(1)} / 100` : 'Suppressed for privacy';
const difference = (a, b) => a.kind === 'exact' && b.kind === 'exact' ? String(b.value - a.value) : 'Unknown (privacy bands)';

// Native controls are built once per loaded projection and remain mounted throughout edits and async actions.
export function mountGregPublish(root, { adapter, commandId = () => globalThis.crypto.randomUUID(), signal } = {}) {
  const abort = new AbortController();
  const stop = () => abort.abort(); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  let disposed = false; let generation = 0; let revision = 0; let busy = false; let policy; let preview; let original; let names = {};
  let validationErrors = [];
  let values = new Map(); let controls = new Map(); let selected; let points; let selector;
  const base = `greg-publish-${++sequence}`;
  const page = el('div', 'vm gcsp-publish');
  const intro = screenIntro({ kicker: 'Policy', title: 'Preview and publish', level: 2,
    lede: 'Try points costs or recommendation weights, compare the preview, then publish on purpose.' });
  const facts = el('div', 'gcsp-publish-facts');
  const summary = errorSummary({ id: `${base}-errors`, onSelect: (id, selectionId) => {
    const error = validationErrors.find((e) => e.selectionId === selectionId);
    const row = error ? controls.get(error.field.id) : [...controls.values()].find((c) => c.input.id === id);
    if (error?.field.kind === 'price') { selector.value = error.field.id; selectPrice(); row.wrapped.setError(error.message); }
    row?.input.focus();
  } });
  const form = el('div', 'gcsp-publish-form');
  const sources = el('details', 'gcsp-publish-sources'); sources.hidden = true;
  const results = el('div', 'gcsp-publish-results');
  const message = note('Loading policy controls.'); message.setAttribute('role', 'status');
  const actions = el('div', 'gcsp-publish-actions');
  const previewButton = button({ label: 'Preview changes', variant: 'ghost', onClick: () => runPreview() });
  const publishButton = button({ label: 'Publish this preview', variant: 'primary', onClick: () => runPublish() });
  const retry = button({ label: 'Retry original publication', variant: 'primary', onClick: () => runPublish(true) });
  const refresh = button({ label: 'Refresh policy', variant: 'ghost', onClick: () => load() });
  actions.append(previewButton, publishButton, retry, refresh);
  page.append(intro, facts, summary.root, form, sources, actions, message, results); root.replaceChildren(page);
  function state(name, text) {
    page.dataset.state = name; message.textContent = text;
    const locked = busy || !!original || !policy;
    for (const control of new Set(controls.values())) { control.input.disabled = locked; control.syncSlider?.(locked); }
    if (selector) selector.disabled = locked;
    previewButton.disabled = !policy || locked; publishButton.disabled = !preview || locked;
    refresh.disabled = busy || !!original; retry.hidden = !original || busy;
    page.setAttribute('aria-busy', String(busy));
  }
  function invalidate() {
    revision += 1; generation += 1; preview = null; results.replaceChildren(); summary.update([]);
    state('draft', 'Draft changes. Preview again before publishing.');
  }
  function selectPrice() {
    selected = policy.fields.find((f) => f.id === selector.value);
    points.input.value = values.get(selected.id);
    points.field = selected;
    for (const f of policy.fields.filter((f) => f.kind === 'price')) controls.set(f.id, points);
    points.wrapped.setError(''); points.syncSlider?.();
    const hint = points.wrapped.root.querySelector('.gcsp-field-hint');
    hint.textContent = nowHint(selected);
  }
  function numberField(field) {
    const input = el('input', ''); input.type = 'number'; input.min = '0'; input.step = '1'; input.max = String(Number.MAX_SAFE_INTEGER);
    input.value = values.get(field.id);
    const wrapped = labelledField({ id: `${base}-field-${controls.size}`, label: field.kind === 'price' ? 'Monthly points cost' : fieldName(field),
      control: input, hint: nowHint(field) });
    const control = { field, input, wrapped, root: el('div', 'gcsp-publish-control') };
    control.root.append(wrapped.root);
    if (field.presentationRange) {
      const initialRange = field.presentationRange;
      const sliderHost = el('div', 'gcsp-publish-slider');
      const outside = note('');
      const descriptor = { id: `${input.id}-slider`, label: `${fieldName(field)} slider`,
        min: initialRange.minimum, max: initialRange.maximum, step: initialRange.step, unit: unitText(field) };
      const sliderLabel = el('label', 'gcsp-field-label', descriptor.label); sliderLabel.htmlFor = descriptor.id;
      sliderHost.append(sliderLabel);
      const slider = renderRangeSlider(sliderHost, descriptor, {}, {
        single: true, value: field.value, valueState: 'confirmed', ariaLabel: `${fieldName(field)} slider`,
        onValueChange(value) {
          input.value = String(value); values.set(control.field.id, input.value); wrapped.setError(''); invalidate();
        },
      });
      const sliderInput = sliderHost.querySelector('input'); sliderInput.id = descriptor.id;
      control.syncSlider = (locked = busy || !!original) => {
        const range = control.field.presentationRange;
        if (!range) { sliderHost.hidden = true; outside.hidden = false;
          outside.textContent = 'Use exact values. A slider range is not supplied for this policy row.'; return; }
        Object.assign(descriptor, { min: range.minimum, max: range.maximum, step: range.step, unit: unitText(control.field) });
        sliderLabel.textContent = `${fieldName(control.field)} slider`;
        sliderInput.min = String(range.minimum); sliderInput.max = String(range.maximum); sliderInput.step = String(range.step);
        sliderHost.querySelector('.vm-slider-min').textContent = formatSliderValue(range.minimum, descriptor);
        sliderHost.querySelector('.vm-slider-max').textContent = formatSliderValue(range.maximum, descriptor);
        const value = safeNumber(input.value) ? Number(input.value) : null;
        const within = value !== null && value >= range.minimum && value <= range.maximum;
        sliderHost.hidden = !within;
        outside.hidden = within;
        outside.textContent = value === null ? 'Enter an exact whole number to use the slider.'
          : `Exact value ${value} is outside the slider range ${range.minimum} to ${range.maximum}. It is retained. Use the exact input to adjust it.`;
        slider.update({ value: within ? value : null, valueState: within ? 'confirmed' : 'unknown', disabled: locked || !within });
        sliderInput.setAttribute('aria-label', sliderLabel.textContent);
      };
      control.root.append(sliderHost, outside); control.syncSlider();
    }
    input.addEventListener('input', () => { values.set(control.field.id, input.value); wrapped.setError(''); invalidate(); control.syncSlider?.(); });
    controls.set(field.id, control); return control;
  }
  function build() {
    names = policy.versionNames; values = new Map(policy.fields.map((f) => [f.id, String(f.value)])); controls = new Map();
    facts.replaceChildren(factList([{ label: 'Active version', value: policy.activeVersionLabel }, { label: 'Effective from', value: when(policy.effectiveFrom) },
      { label: 'Demo time', value: when(policy.asOf) }]), note(policy.heldOffers.message));
    const prices = policy.fields.filter((f) => f.kind === 'price'); const rows = [];
    if (prices.length) {
      selector = el('select', '');
      const groups = new Map();
      for (const f of prices) {
        if (!groups.has(f.schemeId)) { const group = el('optgroup', ''); group.label = f.schemeLabel; groups.set(f.schemeId, group); selector.append(group); }
        const option = el('option', '', fieldName(f)); option.value = f.id; groups.get(f.schemeId).append(option);
      }
      const wrapped = labelledField({ id: `${base}-price`, label: 'Published points row', control: selector,
        hint: 'Switch rows to edit another cost. Your pending edits are retained.' });
      points = numberField(prices[0]); selector.addEventListener('change', selectPrice); selectPrice();
      rows.push(wrapped.root, points.root);
    }
    const weights = el('div', 'gcsp-publish-weights');
    for (const f of policy.fields.filter((f) => f.kind === 'weight')) weights.append(numberField(f).root);
    if (policy.weightsAdoptionRequired) rows.push(note('Weights start at 1. Publishing a weight change saves all six.'));
    form.replaceChildren(...rows, weights); drawSources();
  }
  function drawSources() {
    const groups = new Map();
    const add = (cover, p) => {
      const key = [p.status, p.source, p.sourceDate, p.basis].join('\n'); const group = groups.get(key) ?? { p, covers: new Set() };
      group.covers.add(cover); groups.set(key, group);
    };
    for (const f of policy.fields) {
      add(f.kind === 'price' ? 'Points costs' : 'Recommendation weights', f);
      if (f.presentationRange) add('Slider ranges', f.presentationRange);
    }
    const status = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
    const list = el('div', 'gcsp-publish-facts');
    list.append(...[...groups.values()].map(({ p, covers }) => factList([
      { label: 'Covers', value: [...covers].join(', ') }, { label: 'Status', value: status(p.status) }, { label: 'Source', value: p.source },
      { label: 'Date', value: p.sourceDate }, { label: 'Basis', value: p.basis }])), factList([{ label: 'Version reference', value: policy.activeVersion }]));
    sources.replaceChildren(el('summary', '', 'Sources and assumptions'), list);
    sources.hidden = false;
  }
  function changes() {
    const errors = []; const changed = [];
    for (const field of policy.fields) {
      const control = controls.get(field.id); const raw = values.get(field.id);
      const error = safeNumber(raw) ? '' : 'Enter a whole number of zero or more, within the safe integer limit.';
      if (error) errors.push({ id: control.input.id, selectionId: field.id, message: `${fieldName(field)}: ${error}`, field });
      if (control.field.id === field.id) control.wrapped.setError(error);
      if (!error && Number(raw) !== field.value) changed.push({ id: field.id, value: Number(raw) });
    }
    validationErrors = errors;
    summary.update(errors);
    if (errors.length) { summary.focus(); return null; }
    if (!changed.length) { state('rejected', 'Change at least one value before previewing.'); return null; }
    return changed;
  }
  async function call(method, input) {
    try { return await adapter?.[method]?.(...(method === 'readPolicy' ? [{ signal: abort.signal }] : [input, { signal: abort.signal }])); }
    catch { return { status: 'unavailable', message: 'The request could not be confirmed. Retry in a moment.' }; }
  }
  function failure(reply) {
    const restarted = isRunRestarted(reply);
    const name = restarted ? 'restarted' : ['refused', 'rejected'].includes(reply?.status) ? reply.status : 'unavailable';
    if (name === 'refused' || restarted) { policy = null; form.hidden = true; sources.hidden = true; }
    if (restarted) { state(name, 'Demo restarted.'); results.replaceChildren(runRestartedNotice().root); return; }
    state(name, reply?.message || 'Policy controls are unavailable. Retry in a moment.');
    if (!policy) results.replaceChildren(statusScreen({ kicker: 'Policy', title: name === 'refused' ? 'Access refused' : 'Policy unavailable',
      message: message.textContent, role: 'alert' }));
  }
  async function load() {
    if (busy || original) return;
    const mine = ++generation; busy = true; preview = null; state('loading', 'Loading policy controls.');
    const reply = await call('readPolicy');
    if (disposed || abort.signal.aborted || mine !== generation) return;
    busy = false;
    if (reply?.status !== 'ready' || !validPolicy(reply.value)) { failure(reply); return; }
    policy = reply.value; form.hidden = false; build(); results.replaceChildren(); summary.update([]); state('draft', 'Draft. Change values, then preview their effect.');
  }
  function drawPreview(value) {
    const active = value.active; const draft = value.draft;
    const metrics = el('div', 'gcsp-publish-metrics');
    metrics.append(metricTile({ label: 'Preview: eligible stock cohort', count: countValue(draft.fit.employeesWithEligibleStock),
      note: 'Employees with a suitable released car. Privacy bands stay hidden.' }));
    const a = active.demand.demand.unmet.total.count; const b = draft.demand.demand.unmet.total.count;
    results.replaceChildren(screenIntro({ kicker: 'Preview only', title: 'Compare with the active policy', level: 3,
      lede: 'No policy or offer has been changed. Recommendation fit is not predicted acceptance.' }), metrics,
    dataTable({ caption: 'Preview outcomes', columns: [{ key: 'name', label: 'Measure' }, { key: 'active', label: 'Active' },
      { key: 'draft', label: 'Preview' }, { key: 'change', label: 'Difference' }], rows: [
      { name: 'Briefs with unmet demand', active: countValue(a), draft: countValue(b), change: difference(a, b) },
      { name: 'Employees with eligible stock', active: countValue(active.fit.employeesWithEligibleStock), draft: countValue(draft.fit.employeesWithEligibleStock),
        change: difference(active.fit.employeesWithEligibleStock, draft.fit.employeesWithEligibleStock) },
      { name: 'Scored saved briefs', active: countValue(active.fit.scoredBriefs), draft: countValue(draft.fit.scoredBriefs), change: difference(active.fit.scoredBriefs, draft.fit.scoredBriefs) },
      { name: 'Mean best recommendation fit', active: scoreValue(active.fit.meanBestScore), draft: scoreValue(draft.fit.meanBestScore),
        change: active.fit.meanBestScore.status === 'available' && draft.fit.meanBestScore.status === 'available'
          ? `${(draft.fit.meanBestScore.value - active.fit.meanBestScore.value).toFixed(1)} / 100` : 'Unknown (privacy suppression)' },
    ] }), dataTable({ caption: 'Changed values in this preview', columns: [{ key: 'name', label: 'Policy field' }, { key: 'before', label: 'Active' },
      { key: 'after', label: 'Preview' }, { key: 'unit', label: 'Unit' }], rows: value.differences.map((d) => ({
      name: fieldName(policy.fields.find((f) => f.id === d.id)), before: d.before, after: d.after,
      unit: policy.fields.find((f) => f.id === d.id).unitLabel })) }), note(value.heldOffers.message));
  }
  async function runPreview() {
    if (busy || original || !policy) return;
    const edits = changes(); if (!edits) return;
    const input = { expectedActiveVersion: policy.activeVersion, changes: edits };
    const mine = ++generation; const editRevision = revision; busy = true; preview = null; results.replaceChildren(); state('preview-loading', 'Calculating preview. Nothing is being published.');
    const reply = await call('preview', input);
    if (disposed || abort.signal.aborted) return;
    busy = false;
    if (mine !== generation || editRevision !== revision) { state('draft', 'Draft changed. Preview again before publishing.'); return; }
    const value = reply?.value;
    if (reply?.status !== 'ready' || !validPreview(value)) { failure(reply); return; }
    const matches = value.activeVersion === input.expectedActiveVersion && value.differences.length === edits.length
      && edits.every((e) => value.differences.some((d) => d.id === e.id && d.after === e.value
        && d.before === policy.fields.find((f) => f.id === e.id)?.value));
    if (!matches) { failure(); return; }
    preview = { input, value }; drawPreview(value); state('preview-ready', `Preview ready: ${cardinal(edits.length)} changed ${edits.length === 1 ? 'value' : 'values'}. Review before publishing.`);
  }
  async function runPublish(replaying = false) {
    if (busy || (!replaying && (!preview || original)) || (replaying && !original)) return;
    if (!replaying) {
      const id = commandId();
      original = { ...preview.input, changes: preview.input.changes.map((f) => ({ ...f })), commandId: id,
        policyVersion: `greg-${id}`, effectiveFrom: preview.value.asOf };
    }
    const mine = ++generation; busy = true; state('publishing', 'Publishing the reviewed preview.');
    const reply = await call('publish', original);
    if (disposed || abort.signal.aborted || mine !== generation) return;
    busy = false;
    if (reply?.status === 'ready' && validPublished(reply.value)) {
      const value = reply.value;
      if (value.policyVersion !== original.policyVersion || value.effectiveFrom !== original.effectiveFrom) {
        state('unavailable', 'The publication response could not be confirmed. Retry the original publication safely.'); return;
      }
      const pending = value.activationRequired || value.activation.status === 'pending';
      results.replaceChildren(statusScreen({ kicker: 'Published', title: pending ? 'Saved, waiting for activation' : 'Policy published',
        message: pending ? 'The version is saved. Retry the original publication to activate it without publishing twice.'
          : value.activation.publishedVersionActive === false ? 'The saved version was published. A later policy is now active.' : 'New previews and allocations use the active policy.' }),
      factList([{ label: 'Published version', value: versionLabel(value.policyVersion, names) }, { label: 'Effective from', value: when(value.effectiveFrom) },
        { label: 'Publisher', value: value.publisher }, { label: 'Active version', value: versionLabel(value.activation.policyVersion, names) }]), note(value.heldOffers.message));
      preview = null;
      if (!pending) { original = null; policy = null; }
      state('published', pending ? 'Publication saved. Activation pending.' : 'Publication complete. Refresh policy before another change.');
      const Ev = root.ownerDocument.defaultView.CustomEvent;
      root.dispatchEvent(new Ev('gcsp:policy-published', { bubbles: true, composed: true, detail: {
        policyVersion: value.policyVersion, activation: value.activation.status } }));
    } else if (reply?.status === 'rejected') {
      original = null; preview = null; failure(reply);
    } else if (reply?.status === 'refused' || isRunRestarted(reply)) {
      preview = null; failure(reply);
    } else {
      state('unavailable', 'The publication could not be confirmed. Keep these values and retry the original publication safely.');
    }
  }
  load();
  return Object.assign(() => { disposed = true; generation += 1; abort.abort(); signal?.removeEventListener('abort', stop); root.replaceChildren(); }, { refresh: load });
}
