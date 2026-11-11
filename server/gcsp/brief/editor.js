import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { validateBriefContent, choiceList } from '../../scenarios/employee/index.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const only = (v, fields) => object(v) && Reflect.ownKeys(v).every((key) => fields.includes(key));
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const unavailable = () => result('unavailable', { reason: 'The brief editor context is unavailable.', retryable: true });
const invalid = (field) => result('invalid', { code: 'invalid-preview', reasons: [{ field, reason: 'Use the registered editable brief and current saved versions.' }] });
const stale = (resource, expectedVersion, currentVersion) => result('stale-version', { resource, expectedVersion, currentVersion, action: 'refresh' });
const editable = (b) => ({ schemaVersion: 1, preferences: b.preferences, essentials: b.essentials,
  ...(b.currentCarFeedback === undefined ? {} : { currentCarFeedback: b.currentCarFeedback }) });
const semantic = (b) => ({ preferences: Object.fromEntries(Object.entries(b.preferences).map(([key, p]) => [key, { value: p.value, importance: p.importance }])),
  essentials: Object.fromEntries(Object.entries(b.essentials).map(([key, e]) => [key, { value: e.operator === 'includes' && Array.isArray(e.value) ? [...e.value].sort() : e.value, operator: e.operator, unit: e.unit }])),
  feedback: b.currentCarFeedback ? { preserve: [...b.currentCarFeedback.preserve].sort(), change: [...b.currentCarFeedback.change].sort() } : null });

const LEVELS = ['medium', 'high'];
const integer = (v) => Number.isSafeInteger(v);

// The one canonical Account category projection; null when the policy entry is missing or malformed.
function accountPolicy(row, config, slider) {
  const v = row?.value;
  if (!['assumed', 'verified'].includes(row?.status) || !only(v, ['schemaVersion', 'minimumCategories', 'importance', 'order', 'categories'])
    || v.schemaVersion !== 1 || !only(v.importance, ['medium', 'high', 'highFrom'])) return null;
  const { medium, high, highFrom } = v.importance;
  if (![medium, high, highFrom].every((n) => integer(n) && n >= slider.minimum && n <= slider.maximum)
    || !(medium > slider.minimum && medium < highFrom && highFrom <= high)) return null;
  if (!Array.isArray(v.order) || !v.order.length || new Set(v.order).size !== v.order.length || !object(v.categories)
    || Object.keys(v.categories).length !== v.order.length || !integer(v.minimumCategories) || v.minimumCategories < 1
    || v.minimumCategories > v.order.length) return null;
  const categories = {};
  for (const key of v.order) {
    const c = Object.hasOwn(v.categories, key) ? v.categories[key] : null; const d = Object.hasOwn(config.preferences, key) ? config.preferences[key] : null;
    if (!d || !text(c?.label) || !text(c.question)) return null;
    if (c.kind === 'multi') {
      if (!only(c, ['label', 'question', 'kind', 'options']) || d.type !== 'enum' || d.multiple !== true || !Array.isArray(c.options) || !c.options.length) return null;
      let last = -1;
      for (const o of c.options) {
        const at = only(o, ['value', 'label']) && text(o.label) ? d.values.indexOf(o.value) : -1;
        if (at <= last) return null;
        last = at;
      }
      categories[key] = { label: c.label, question: c.question, kind: 'multi', options: c.options.map(({ value, label }) => ({ value, label })) };
    } else if (c.kind === 'stops') {
      if (!only(c, ['label', 'question', 'kind', 'openDefault', 'stops']) || d.type !== 'slider' || !Array.isArray(c.stops) || c.stops.length < 2) return null;
      let last = slider.minimum - 1;
      for (const o of c.stops) {
        if (!only(o, ['value', 'label']) || !text(o.label) || !integer(o.value) || o.value <= last || o.value > slider.maximum) return null;
        last = o.value;
      }
      if (!c.stops.some((o) => o.value === c.openDefault)) return null;
      categories[key] = { label: c.label, question: c.question, kind: 'stops', openDefault: c.openDefault, stops: c.stops.map(({ value, label }) => ({ value, label })) };
    } else return null;
  }
  return { levels: { medium, high, highFrom }, minimumCategories: v.minimumCategories, order: [...v.order], categories };
}
const accountProjection = (a, version) => ({ schemaVersion: 1, policyVersion: version, order: a.order, minimumCategories: a.minimumCategories,
  importance: { medium: a.levels.medium, high: a.levels.high }, categories: a.categories });

// Considered: an entry with importance above the minimum that the employee set or that is confirmed (never a policy default).
const considered = (p, slider) => object(p) && p.importance > slider.minimum && (p.source === 'employee' || p.valueState === 'confirmed');
function nearestStop(stops, value) {
  const middle = stops[Math.floor(stops.length / 2)].value;
  const best = Math.min(...stops.map((o) => Math.abs(o.value - value)));
  return stops.filter((o) => Math.abs(o.value - value) === best).sort((a, b) => Math.abs(a.value - middle) - Math.abs(b.value - middle))[0].value;
}
function accountState(brief, a, slider) {
  const categories = {}; let count = 0;
  for (const key of a.order) {
    const p = brief.preferences?.[key]; const c = a.categories[key];
    if (!considered(p, slider)) { categories[key] = { state: 'unset' }; continue; }
    count += 1;
    const importance = p.importance >= a.levels.highFrom ? 'high' : 'medium';
    if (c.kind === 'multi') categories[key] = { state: 'considered', value: [...choiceList(p.value)], importance, exact: true };
    else {
      const exact = c.stops.some((o) => o.value === p.value);
      categories[key] = { state: 'considered', value: exact ? p.value : nearestStop(c.stops, p.value), importance, exact };
    }
  }
  return { considered: count, categories };
}

const PATCH_FIELDS = ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'changes'];
const refusal = (field, reason) => result('invalid', { code: 'invalid-preferences', reasons: [{ field, reason }] });
const validValue = (c, value) => c.kind === 'multi'
  ? Array.isArray(value) && value.length > 0 && value.every((v, i) => {
    const at = c.options.findIndex((o) => o.value === v);
    return at >= 0 && (i === 0 || at > c.options.findIndex((o) => o.value === value[i - 1]));
  })
  : c.stops.some((o) => o.value === value);

// Validates the sparse patch against the policy projection; returns a refusal, or null when acceptable.
function checkChanges(changes, rules) {
  if (!object(changes) || !Object.keys(changes).length) return refusal('changes', 'Change at least one category.');
  for (const [key, change] of Object.entries(changes)) {
    const c = Object.hasOwn(rules.categories, key) ? rules.categories[key] : null;
    if (!c) return refusal(`changes.${key}`, 'Use one of the registered categories.');
    if (change === null) continue;
    if (!only(change, ['value', 'importance']) || !Object.keys(change).length) return refusal(`changes.${key}`, 'Supply a value, an importance, or null to remove it.');
    if (Object.hasOwn(change, 'importance') && !LEVELS.includes(change.importance)) return refusal(`changes.${key}.importance`, 'Use medium or high.');
    if (Object.hasOwn(change, 'value') && !validValue(c, change.value)) return refusal(`changes.${key}.value`, c.kind === 'multi'
      ? 'Choose at least one registered option, listed once and in the registered order.' : 'Use one of the registered stops.');
  }
  return null;
}

function applyChanges(base, changes, rules, slider) {
  const preferences = structuredClone(base.preferences);
  for (const [key, change] of Object.entries(changes)) {
    const existing = Object.hasOwn(preferences, key) && considered(preferences[key], slider) ? preferences[key] : null;
    if (change === null) { delete preferences[key]; continue; }
    const importance = Object.hasOwn(change, 'importance') ? rules.levels[change.importance] : (existing?.importance ?? rules.levels.medium);
    if (Object.hasOwn(change, 'value')) {
      preferences[key] = { value: change.value, importance, valueState: 'draft', importanceState: 'draft', source: 'employee' };
    } else if (!existing) return refusal(`changes.${key}.importance`, 'Choose a preference before setting its importance.');
    else preferences[key] = { ...existing, importance, importanceState: 'draft', source: 'employee' };
  }
  return { ...base, preferences };
}

function jsonCopy(value) {
  if (value !== null && typeof value === 'object') {
    if (!Array.isArray(value) && !object(value)) throw Error('plain data required');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw Error('plain data required');
      jsonCopy(value[key]);
    }
  } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)
    || typeof value === 'number' && !Number.isFinite(value)) throw Error('JSON required');
  return structuredClone(value);
}

function validateEditable(b, config, slider, lifecycle) {
  if (!only(b, ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback'])) return false;
  const { currentCarFeedback, ...content } = b;
  const errors = validateBriefContent(content, { ...config, essentials: { ...config.essentials, charging: lifecycle.charging } }, slider);
  if (errors.length) return false;
  const f = currentCarFeedback;
  return f === undefined || only(f, ['preserve', 'change', 'state', 'source']) && text(f.source)
    && ['draft', 'confirmed', 'inferred'].includes(f.state) && ['preserve', 'change'].every((key) => Array.isArray(f[key])
      && f[key].every((value) => Object.hasOwn(config.preferences, value)));
}

export function createBriefEditorService({ brief, account, provider, policy, clock, identity } = {}) {
  const recommendation = createEmployeeRecommendationService({ provider, policy, time: clock });
  async function saved(context) {
    const [approved, draft] = await Promise.all([brief.readCurrent(context), brief.readDraft(context)]);
    for (const found of [approved, draft]) if (!['ok', 'not-found'].includes(found?.status)) return { error: found ?? unavailable() };
    const current = approved.status === 'ok' ? approved.value.brief : null;
    const accepted = approved.status === 'ok' ? approved.value.activity?.existingOffers?.find((o) => o.state === 'accepted') : null;
    const input = draft.status === 'ok' ? draft.value : null;
    if (current && (!revision(current.briefVersion) || current.briefVersion === 0 || current.status !== 'confirmed')
      || input && (!revision(input.draftVersion) || input.draftVersion === 0 || !revision(input.baseBriefVersion))) return { error: unavailable() };
    return { current, input, accepted, briefVersion: current?.briefVersion ?? 0, draftVersion: input?.draftVersion ?? 0 };
  }
  async function prepare(context) {
    if (!brief?.readCurrent || !brief?.readDraft || !account?.readAccount || !provider?.resolve
      || !policy?.getAssumption || !clock?.now || !identity?.requireRole) return { error: unavailable() };
    const guard = await identity.requireRole(context, 'employee');
    if (guard.status !== 'ok') return { error: guard };
    const time = await clock.now(context);
    if (time.status !== 'ok') return { error: time };
    if (!validInstant(time.value?.now) || time.value.runId !== context.runId || !text(time.value.clockVersion)) return { error: unavailable() };
    const read = { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion };
    const keys = ['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum', 'brief.lifecycle.v1', 'brief.editor.v1',
      'brief.accountPreferences.v1'];
    const assumptions = await Promise.all(keys.map((key) => policy.getAssumption(key, read)));
    if (assumptions.some((a) => a.status !== 'ok' || a.policyVersion !== context.policyVersion)) return { error: unavailable() };
    const [config, minimum, maximum, lifecycle, editor] = assumptions.map((a) => a.value.value);
    const slider = { minimum, maximum };
    if (!object(config?.preferences) || !object(config.essentials) || minimum !== 0 || maximum !== 100
      || !object(lifecycle?.charging) || !object(editor?.preferences) || !object(editor?.practicalQuestions)
      || !text(editor.unconfirmedLabel) || !['assumed', 'verified'].includes(assumptions[4].value.status)) return { error: unavailable() };
    const rules = accountPolicy(assumptions[5].value, config, slider);
    if (!rules) return { error: unavailable() };
    const state = await saved(context); if (state.error) return state;
    const [accountResult, provided] = await Promise.all([account.readAccount(context), provider.resolve(context)]);
    for (const found of [accountResult, provided]) if (found?.status !== 'ok') return { error: found ?? unavailable() };
    const a = accountResult.value; const source = provided.value;
    if (!object(a) || !text(a.state) || (a.state !== 'absent-hr-account' && (!object(a.versions) || a.versions.policy !== context.policyVersion))
      || !object(source?.employeeFacts) || !text(source.factsVersion) || !text(source.stockVersion) || !Array.isArray(source.stock)) return { error: unavailable() };
    if (['runId', 'environmentId', 'employeeId'].some((key) => source[key] !== context[key])) return { error: result('stale-run', { reason: 'The facts belong to a different employee context.' }) };
    return { config, slider, lifecycle, editor, state, account: a, source, time: time.value, rules,
      assumptions: assumptions.filter((a) => a.value.key !== 'employee.recommendation.v1').map((a) => a.value) };
  }
  function defaults(p) {
    const preferences = {};
    for (const [key, d] of Object.entries(p.config.preferences)) {
      const initial = p.editor.preferences[key];
      if (!only(initial, ['label', 'value', 'importance']) || !text(initial.label)) throw Error('Missing editor preference');
      preferences[key] = { value: initial.value, importance: initial.importance, valueState: 'draft', importanceState: 'draft', source: 'policy:brief.editor.v1' };
    }
    const essentials = {};
    for (const [key, q] of Object.entries(p.editor.practicalQuestions)) {
      const definition = key === 'charging' ? p.lifecycle.charging : p.config.essentials[key];
      if (!definition || !only(q, ['label', 'yes', 'no', 'unknown']) || !text(q.label) || q.unknown !== null) throw Error('Missing practical question');
      for (const value of [q.yes, q.no]) {
        const values = key === 'charging' && Array.isArray(value) ? value : [value];
        for (const answer of values) if (!validateEditable({ schemaVersion: 1, preferences: {}, essentials: {
          [key]: { operator: definition.operator, unit: definition.unit, value: answer, state: 'draft', source: 'employee' },
        } }, p.config, p.slider, p.lifecycle)) throw Error('Invalid question mapping');
      }
      essentials[key] = { operator: definition.operator, unit: definition.unit, value: null, state: 'needs-confirmation', source: 'policy:brief.editor.v1' };
    }
    const initial = { schemaVersion: 1, preferences, essentials };
    if (!validateEditable(initial, p.config, p.slider, p.lifecycle)) throw Error('Invalid defaults');
    return initial;
  }
  async function consumedDraft(context, input) {
    if (typeof brief.readHistory !== 'function') return unavailable();
    const history = await brief.readHistory(context);
    if (history?.status !== 'ok' || !Array.isArray(history.value?.versions)) return unavailable();
    const digest = inputDigest(semantic(input.brief));
    return history.value.versions.some((v) => v.briefVersion > input.baseBriefVersion && inputDigest(semantic(v)) === digest);
  }
  // The saved-draft / approved-brief / unconfirmed-default choice shared by the read and the autosave.
  async function resolveInitial(context, p) {
    const fallback = defaults(p); const { current, input, briefVersion } = p.state;
    // After an accept the page is read-only from the approved brief, so a pending draft cannot block it.
    const accepted = Boolean(p.state.accepted && current); const matching = !accepted && input?.baseBriefVersion === briefVersion;
    if (input && !matching && !accepted && (!current || inputDigest(semantic(input.brief)) !== inputDigest(semantic(current)))) {
      // A draft already confirmed into a later brief version is consumed, not pending.
      const consumed = current && await consumedDraft(context, input);
      if (consumed?.status) return { error: consumed };
      if (!consumed) return { error: stale('brief', input.baseBriefVersion, briefVersion) };
    }
    const initial = matching ? editable(input.brief) : current ? editable(current) : fallback;
    if (!validateEditable(initial, p.config, p.slider, p.lifecycle)) return { error: unavailable() };
    return { initial, matching, base: matching || current ? initial : null, fallback };
  }
  return {
    async readEditor(context) {
      try {
        const p = await prepare(context); if (p.error) return p.error;
        const { current, input, briefVersion, draftVersion } = p.state;
        const resolved = await resolveInitial(context, p); if (resolved.error) return resolved.error;
        const { initial, matching } = resolved;
        const preferences = Object.fromEntries(Object.entries(p.config.preferences).map(([key, d]) => [key, {
          type: d.type, ...(d.values ? { values: d.values } : {}), ...(d.multiple === true ? { multiple: true } : {}),
          label: p.editor.preferences[key].label, editable: true,
        }]));
        const essentials = Object.fromEntries(Object.entries({ ...p.config.essentials, charging: p.lifecycle.charging }).map(([key, d]) => [key, {
          type: d.type, operator: d.operator, unit: d.unit, ...(d.values ? { values: d.values } : {}),
          ...(d.type === 'number' ? { minimum: 0, ...(key === 'seats' ? { integer: true } : {}) } : {}), editable: true,
        }]));
        const knownFacts = {};
        const fact = (key, value, source, sourceVersion) => { knownFacts[key] = { value, source, sourceVersion, observedAt: p.time.now, editable: false, ...(value === null ? { status: 'missing' } : {}) }; };
        for (const key of ['account', 'currentContract', 'drivers']) if (p.account[key] !== undefined)
          fact(key, p.account[key], 'manual-account', p.account.versions ?? null);
        for (const [key, value] of Object.entries(p.source.employeeFacts)) if (key !== 'essentials')
          fact(key, value, 'employee-provider', p.source.factsVersion);
        const permissions = Object.fromEntries(Object.keys(knownFacts).map((key) => [key, { editable: false }]));
        const contextVersion = inputDigest({ runId: context.runId, employeeId: context.employeeId, policy: context.policyVersion,
          account: p.account.contextVersion ?? null, facts: p.source.factsVersion });
        return ok(jsonCopy({ context: { preferences, essentials, slider: p.slider, knownFacts, permissions,
          policyVersion: context.policyVersion, contextVersion, practicalQuestions: p.editor.practicalQuestions,
          unconfirmedLabel: p.editor.unconfirmedLabel, assumptions: p.assumptions,
          accountPreferences: accountProjection(p.rules, context.policyVersion) },
        initial: { brief: initial, briefVersion, draftVersion, accountPreferences: accountState(initial, p.rules, p.slider), consent: {
          search: current?.buddy?.searchConsent === true, hold: current?.buddy?.holdConsent === true,
        } }, versions: { policy: context.policyVersion, context: contextVersion, facts: p.source.factsVersion, clock: p.time.clockVersion },
        selection: p.state.accepted ? { state: 'accepted', briefVersion: p.state.accepted.briefVersion } : null,
        provenance: { initial: matching ? 'saved-draft' : current ? 'approved-brief' : 'unconfirmed-policy-defaults', approvedBriefVersion: briefVersion || null } }));
      } catch { return unavailable(); }
    },
    async savePreferences(context, input) {
      try { input = jsonCopy(input); } catch { return refusal('input', 'Use plain JSON values.'); }
      if (!only(input, PATCH_FIELDS) || PATCH_FIELDS.some((key) => !Object.hasOwn(input, key))
        || !text(input.commandId) || input.commandId.length > 128 || !revision(input.expectedBriefVersion)
        || !revision(input.expectedDraftVersion)) return refusal('command', 'Supply exactly a command ID, the expected versions and the changes.');
      try {
        const p = await prepare(context); if (p.error) return p.error;
        const refused = checkChanges(input.changes, p.rules); if (refused) return refused;
        if (p.state.accepted && p.state.current) return result('conflict', { reason: 'brief-read-only', current: { briefVersion: p.state.briefVersion } });
        const resolved = await resolveInitial(context, p); if (resolved.error) return resolved.error;
        // A new employee starts sparse: policy essentials stay unconfirmed and no default preference is invented.
        const base = resolved.base ?? { ...resolved.fallback, preferences: {} };
        const merged = applyChanges(base, input.changes, p.rules, p.slider);
        if (merged.status) return merged;
        if (!validateEditable(merged, p.config, p.slider, p.lifecycle)) return refusal('changes', 'Use the registered editable brief.');
        const saved = await brief.saveDraft(context, { commandId: input.commandId, expectedBriefVersion: input.expectedBriefVersion,
          expectedDraftVersion: input.expectedDraftVersion, brief: merged });
        if (saved?.status !== 'ok') return saved ?? unavailable();
        return ok(jsonCopy({ briefVersion: saved.value.baseBriefVersion, draftVersion: saved.value.draftVersion,
          accountPreferences: accountState(saved.value.brief, p.rules, p.slider) }));
      } catch { return unavailable(); }
    },
    async previewDraft(context, input) {
      try { input = jsonCopy(input); } catch { return invalid('input'); }
      if (!only(input, ['kind', 'baseBriefVersion', 'draftVersion', 'brief']) || input.kind !== 'unsaved-draft'
        || !revision(input.baseBriefVersion) || !revision(input.draftVersion)) return invalid('preview');
      try {
        const p = await prepare(context); if (p.error) return p.error;
        defaults(p);
        if (input.baseBriefVersion !== p.state.briefVersion) return stale('brief', input.baseBriefVersion, p.state.briefVersion);
        if (input.draftVersion !== p.state.draftVersion) return stale('draft', input.draftVersion, p.state.draftVersion);
        if (!validateEditable(input.brief, p.config, p.slider, p.lifecycle)) return invalid('brief');
        const outcome = await recommendation.previewUnsaved(context, { brief: input.brief,
          baseBriefVersion: input.baseBriefVersion, baseDraftVersion: input.draftVersion });
        const guard = await identity.requireRole(context, 'employee'); if (guard.status !== 'ok') return guard;
        const latest = await saved(context); if (latest.error) return latest.error;
        if (latest.briefVersion !== p.state.briefVersion) return stale('brief', p.state.briefVersion, latest.briefVersion);
        if (latest.draftVersion !== p.state.draftVersion) return stale('draft', p.state.draftVersion, latest.draftVersion);
        return outcome;
      } catch { return unavailable(); }
    },
  };
}
