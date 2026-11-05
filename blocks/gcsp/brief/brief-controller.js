import { createPreviewFeed } from '../../vehicle-matcher/modes/preview-feed.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const only = (v, keys) => object(v) && Reflect.ownKeys(v).every((key) => keys.includes(key));
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const states = ['draft', 'inferred', 'confirmed'];
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'runId', 'employeeId', 'identity',
  'policy', 'policyVersion', 'knownFacts', 'cash', 'contribution', 'buddy']);
const invalid = (field) => ({ status: 'invalid', field });
const unavailable = () => ({ status: 'unavailable', retryable: true });

function clone(value) {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && !object(value)) throw new TypeError('Use plain JSON data.');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new TypeError('Use plain JSON data.');
      clone(value[key]);
    }
  } else if (value !== null && !['string', 'boolean', 'number'].includes(typeof value)
    || typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Use plain JSON data.');
  return structuredClone(value);
}

function typed(value, definition, slider) {
  if (definition.type === 'slider') return Number.isInteger(value) && value >= slider.minimum && value <= slider.maximum;
  if (definition.type === 'enum') return Array.isArray(definition.values) && definition.values.includes(value);
  if (definition.type === 'boolean') return typeof value === 'boolean';
  if (definition.type === 'number') return Number.isFinite(value) && value >= (definition.minimum ?? 0)
    && (definition.maximum === undefined || value <= definition.maximum) && (!definition.integer || Number.isInteger(value));
  if (definition.type === 'string') return text(value);
  if (definition.type === 'list') return Array.isArray(value) && value.length > 0 && value.every(text);
  return false;
}

function validateBrief(brief, context) {
  if (!only(brief, ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback']) || brief.schemaVersion !== 1
    || !object(brief.preferences) || !object(brief.essentials)) return false;
  for (const [key, p] of Object.entries(brief.preferences)) {
    const d = Object.hasOwn(context.preferences, key) && !forbidden.has(key) && context.preferences[key];
    if (!d || !only(p, ['value', 'importance', 'valueState', 'importanceState', 'source', 'confirmedAt'])
      || !typed(p.value, d, context.slider) || !typed(p.importance, { type: 'slider' }, context.slider)
      || !states.includes(p.valueState) || !states.includes(p.importanceState) || !text(p.source)
      || p.confirmedAt !== undefined && !Number.isFinite(Date.parse(p.confirmedAt))) return false;
  }
  for (const [key, e] of Object.entries(brief.essentials)) {
    const d = Object.hasOwn(context.essentials, key) && !forbidden.has(key) && context.essentials[key];
    if (!d || !only(e, ['operator', 'unit', 'value', 'state', 'source', 'confirmedAt']) || e.operator !== d.operator || e.unit !== d.unit
      || ![...states, 'needs-confirmation'].includes(e.state) || !text(e.source)
      || (e.value === null ? e.state !== 'needs-confirmation' : !typed(e.value, d, context.slider))
      || e.confirmedAt !== undefined && !Number.isFinite(Date.parse(e.confirmedAt))) return false;
  }
  const f = brief.currentCarFeedback;
  return f === undefined || only(f, ['preserve', 'change', 'state', 'source']) && states.includes(f.state) && text(f.source)
    && ['preserve', 'change'].every((k) => Array.isArray(f[k]) && f[k].every((v) => !forbidden.has(v) && Object.hasOwn(context.preferences, v)));
}

function previewState(outcome) {
  if (outcome?.status !== 'ok') return { state: 'unavailable', outcome };
  const v = outcome.value;
  if (!object(v) || !['recommendations', 'no-stock', 'no-viable-stock'].includes(v.state)
    || !Array.isArray(v.recommendations) || !Array.isArray(v.decisions) || !object(v.versions)
    || !revision(v.eligibleCount) || v.eligibleCount < v.recommendations.length
    || v.decisions.some((d) => !object(d) || !['eligible', 'ineligible', 'needs-confirmation'].includes(d.gateStatus)
      || !Array.isArray(d.unknowns) || !Array.isArray(d.reasons) || !Array.isArray(d.tradeOffs) || !Array.isArray(d.blockers) || !object(d.versions))
    || v.recommendations.some((d) => !object(d) || d.gateStatus !== 'eligible' || !text(d.orderUuid)
      || !Array.isArray(d.reasons) || !Array.isArray(d.tradeOffs) || !object(d.versions)
      || !v.decisions.some((e) => e.orderUuid === d.orderUuid && e.gateStatus === 'eligible'))
    || v.eligibleCount !== v.decisions.filter((d) => d.gateStatus === 'eligible').length
    || (v.state === 'recommendations') !== (v.recommendations.length > 0)
    || (v.state === 'no-stock') !== (v.decisions.length === 0)) return { state: 'unavailable', outcome: unavailable() };
  return { state: v.recommendations.length ? 'recommendations'
    : v.decisions.some((d) => d.gateStatus === 'needs-confirmation') ? 'essential-unknown' : 'zero-eligible', outcome };
}

export function createBriefController({ context, initial = {}, transport, createCommandId, onChange } = {}) {
  context = clone(context);
  initial = clone(initial);
  if (!object(context?.preferences) || !object(context.essentials) || !object(context.slider)
    || !Number.isInteger(context.slider.minimum) || !Number.isInteger(context.slider.maximum)
    || context.slider.minimum > context.slider.maximum || !transport
    || !['preview', 'saveDraft', 'confirm'].every((key) => typeof transport[key] === 'function')
    || typeof createCommandId !== 'function') throw new TypeError('Supply editor context and transport ports.');
  if (!only(initial, ['brief', 'briefVersion', 'draftVersion', 'consent'])
    || !revision(initial.briefVersion ?? 0) || !revision(initial.draftVersion ?? 0)) throw new TypeError('Invalid initial versions.');
  const brief = initial.brief ?? { schemaVersion: 1, preferences: {}, essentials: {} };
  if (!validateBrief(brief, context)) throw new TypeError('Invalid initial brief.');
  const validConsent = (v) => only(v, ['search', 'hold']) && typeof v.search === 'boolean' && typeof v.hold === 'boolean';
  if (initial.consent !== undefined && !validConsent(initial.consent)) throw new TypeError('Invalid consent.');
  let state = { brief, briefVersion: initial.briefVersion ?? 0, draftVersion: initial.draftVersion ?? 0,
    knownFacts: context.knownFacts ?? {}, permissions: context.permissions ?? {}, consent: initial.consent ?? { search: false, hold: false },
    dirty: false, preview: { state: 'idle' }, save: { state: 'idle' } };
  let destroyed = false;
  let editVersion = 0;
  let busy = false;
  const listeners = new Set(onChange ? [onChange] : []);
  const snapshot = () => clone(state);
  const emit = () => {
    if (!destroyed) for (const listener of [...listeners]) {
      if (destroyed) break;
      try { listener(snapshot()); } catch { /* Observers cannot interrupt request/state transitions. */ }
    }
  };
  const feed = createPreviewFeed({ load: (input) => transport.preview(input) });
  const receivePreview = (outcome) => {
    if (destroyed) return;
    try { state.preview = previewState(clone(outcome)); } catch { state.preview = { state: 'unavailable', outcome: unavailable() }; }
    emit();
  };
  function requestPreview() {
    if (destroyed) return { status: 'destroyed' };
    state.preview = { state: 'loading' };
    feed.schedule(clone({ kind: 'unsaved-draft', baseBriefVersion: state.briefVersion,
      draftVersion: state.draftVersion, brief: state.brief }), receivePreview, () => receivePreview(unavailable()));
    emit();
    return { status: 'ok' };
  }
  function changed(next) {
    state.brief = next;
    state.dirty = true;
    editVersion += 1;
    return requestPreview();
  }
  const editable = (kind, key) => typeof key === 'string' && !forbidden.has(key) && Object.hasOwn(context[kind], key)
    && context[kind][key].editable === true;
  function updatePreference(key, patch) {
    if (destroyed) return { status: 'destroyed' };
    try {
      patch = clone(patch);
      if (!editable('preferences', key) || !only(patch, ['value', 'importance']) || !Object.keys(patch).length) return invalid('preference');
      const next = clone(state.brief);
      const p = { ...next.preferences[key], ...patch, source: 'employee' };
      if (Object.hasOwn(patch, 'value')) p.valueState = 'draft';
      if (Object.hasOwn(patch, 'importance')) p.importanceState = 'draft';
      delete p.confirmedAt;
      next.preferences[key] = p;
      if (!validateBrief(next, context)) return invalid('preference');
      return changed(next);
    } catch { return invalid('preference'); }
  }
  function updateEssential(key, value) {
    if (destroyed) return { status: 'destroyed' };
    try {
      value = clone(value);
      if (!editable('essentials', key)) return invalid('essential');
      const d = context.essentials[key];
      const next = clone(state.brief);
      next.essentials[key] = { operator: d.operator, unit: d.unit, value,
        state: value === null ? 'needs-confirmation' : 'draft', source: 'employee' };
      if (!validateBrief(next, context)) return invalid('essential');
      return changed(next);
    } catch { return invalid('essential'); }
  }
  function setConsent(consent) {
    if (destroyed) return { status: 'destroyed' };
    try { consent = clone(consent); } catch { return invalid('consent'); }
    if (!validConsent(consent)) return invalid('consent');
    state.consent = consent;
    state.dirty = true;
    editVersion += 1;
    emit();
    return { status: 'ok' };
  }
  async function save() {
    if (destroyed) return { status: 'destroyed' };
    if (busy) return { status: 'busy' };
    busy = true;
    const captured = snapshot();
    const version = editVersion;
    state.save = { state: 'saving' };
    emit();
    if (destroyed) { busy = false; return { status: 'destroyed' }; }
    let outcome;
    let savedDraftVersion;
    try {
      const draftId = createCommandId('draft');
      const confirmId = createCommandId('confirm');
      if (!text(draftId) || !text(confirmId) || draftId === confirmId) throw new TypeError('Use separate command IDs.');
      outcome = clone(await transport.saveDraft(clone({ commandId: draftId, expectedBriefVersion: captured.briefVersion,
        expectedDraftVersion: captured.draftVersion, brief: captured.brief })));
      if (destroyed) return { status: 'destroyed' };
      if (outcome.status === 'ok') {
        if (!revision(outcome.value?.draftVersion) || outcome.value.draftVersion <= captured.draftVersion
          || outcome.value.baseBriefVersion !== captured.briefVersion) throw new TypeError('Invalid draft response.');
        const draftVersion = outcome.value.draftVersion;
        savedDraftVersion = draftVersion;
        outcome = clone(await transport.confirm(clone({ commandId: confirmId, expectedBriefVersion: captured.briefVersion,
          expectedDraftVersion: draftVersion, consent: captured.consent })));
        if (destroyed) return { status: 'destroyed' };
        if (outcome.status === 'ok') {
          const approvedVersion = outcome.value?.brief?.briefVersion;
          if (!revision(approvedVersion) || approvedVersion <= captured.briefVersion) throw new TypeError('Invalid confirmation response.');
          state.briefVersion = approvedVersion;
          state.draftVersion = draftVersion;
          state.dirty = editVersion !== version;
        } else if (!['conflict', 'stale-version'].includes(outcome.status)) state.draftVersion = draftVersion;
      }
    } catch {
      outcome = unavailable();
      if (!destroyed && savedDraftVersion !== undefined) state.draftVersion = savedDraftVersion;
    }
    finally { busy = false; }
    if (destroyed) return { status: 'destroyed' };
    if (!text(outcome?.status)) outcome = unavailable();
    state.save = { state: ['conflict', 'stale-version'].includes(outcome.status) ? 'refresh-required' : outcome.status === 'ok' ? 'saved' : 'failed', outcome };
    emit();
    return clone(outcome);
  }
  return { snapshot, updatePreference, updateEssential, setConsent, requestPreview, save,
    cancelPreview() { if (!destroyed) { feed.cancel(); state.preview = { state: 'idle' }; emit(); } },
    subscribe(listener) { if (destroyed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { destroyed = true; feed.cancel(); listeners.clear(); },
  };
}
