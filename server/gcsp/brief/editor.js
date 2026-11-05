import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { validateBriefContent } from '../../scenarios/employee/index.js';

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
    const input = draft.status === 'ok' ? draft.value : null;
    if (current && (!revision(current.briefVersion) || current.briefVersion === 0 || current.status !== 'confirmed')
      || input && (!revision(input.draftVersion) || input.draftVersion === 0 || !revision(input.baseBriefVersion))) return { error: unavailable() };
    return { current, input, briefVersion: current?.briefVersion ?? 0, draftVersion: input?.draftVersion ?? 0 };
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
    const keys = ['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum', 'brief.lifecycle.v1', 'brief.editor.v1'];
    const assumptions = await Promise.all(keys.map((key) => policy.getAssumption(key, read)));
    if (assumptions.some((a) => a.status !== 'ok' || a.policyVersion !== context.policyVersion)) return { error: unavailable() };
    const [config, minimum, maximum, lifecycle, editor] = assumptions.map((a) => a.value.value);
    const slider = { minimum, maximum };
    if (!object(config?.preferences) || !object(config.essentials) || minimum !== 0 || maximum !== 100
      || !object(lifecycle?.charging) || !object(editor?.preferences) || !object(editor?.practicalQuestions)
      || !text(editor.unconfirmedLabel) || !['assumed', 'verified'].includes(assumptions.at(-1).value.status)) return { error: unavailable() };
    const state = await saved(context); if (state.error) return state;
    const [accountResult, provided] = await Promise.all([account.readAccount(context), provider.resolve(context)]);
    for (const found of [accountResult, provided]) if (found?.status !== 'ok') return { error: found ?? unavailable() };
    const a = accountResult.value; const source = provided.value;
    if (!object(a) || !text(a.state) || (a.state !== 'absent-hr-account' && (!object(a.versions) || a.versions.policy !== context.policyVersion))
      || !object(source?.employeeFacts) || !text(source.factsVersion) || !text(source.stockVersion) || !Array.isArray(source.stock)) return { error: unavailable() };
    if (['runId', 'environmentId', 'employeeId'].some((key) => source[key] !== context[key])) return { error: result('stale-run', { reason: 'The facts belong to a different employee context.' }) };
    return { config, slider, lifecycle, editor, state, account: a, source, time: time.value,
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
  return {
    async readEditor(context) {
      try {
        const p = await prepare(context); if (p.error) return p.error;
        const fallback = defaults(p); const { current, input, briefVersion, draftVersion } = p.state;
        const matching = input?.baseBriefVersion === briefVersion;
        if (input && !matching && (!current || inputDigest(semantic(input.brief)) !== inputDigest(semantic(current))))
          return stale('brief', input.baseBriefVersion, briefVersion);
        const initial = matching ? editable(input.brief) : current ? editable(current) : fallback;
        if (!validateEditable(initial, p.config, p.slider, p.lifecycle)) return unavailable();
        const preferences = Object.fromEntries(Object.entries(p.config.preferences).map(([key, d]) => [key, {
          type: d.type, ...(d.values ? { values: d.values } : {}), label: p.editor.preferences[key].label, editable: true,
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
          unconfirmedLabel: p.editor.unconfirmedLabel, assumptions: p.assumptions },
        initial: { brief: initial, briefVersion, draftVersion, consent: {
          search: current?.buddy?.searchConsent === true, hold: current?.buddy?.holdConsent === true,
        } }, versions: { policy: context.policyVersion, context: contextVersion, facts: p.source.factsVersion, clock: p.time.clockVersion },
        provenance: { initial: matching ? 'saved-draft' : current ? 'approved-brief' : 'unconfirmed-policy-defaults', approvedBriefVersion: briefVersion || null } }));
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
