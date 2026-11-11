import { isBuddyEngaged } from './permission.js';
import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { validateBrief, unselectedPracticalAnswer, unselectedPreference } from '../../scenarios/employee/index.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { storedFeedback } from '../recommendation/current-car.js';
import { applyConfirmedFeedbackChange } from '../../../blocks/vehicle-matcher/feedback-actions.js';
import { FOLLOWUP_QUESTIONS_KEY, equipmentListValid } from '../offers/followup-policy.js';
import { currentCarRatingValid } from './rating.js';
import { sameAgainValid } from './same-again.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const only = (v, keys) => object(v) && Object.keys(v).every((key) => keys.includes(key));
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const invalid = (field, reason, code = 'invalid-brief') => result('invalid', { code, reasons: [{ field, reason }] });
const unavailable = () => result('unavailable', { reason: 'The brief service is unavailable.', retryable: true });
const stale = (field, expectedVersion, currentVersion) => result('stale-version', {
  expectedVersion, currentVersion, resource: { table: field === 'draft' ? 'brief-draft' : 'briefs' }, action: 'refresh',
});
const engagedNow = (b) => isBuddyEngaged(b?.buddy);
const ENGAGEMENT_KEY = 'brief.engagement.v1';
const draftConsumer = (context) => `brief:draft:${context.employeeId}`;
const sorted = (rows) => rows.filter((b) => b.status === 'confirmed').sort((a, b) => a.briefVersion - b.briefVersion);
const draftRows = (rows) => rows.map((r) => r.outcome.value).sort((a, b) => a.draftVersion - b.draftVersion);
const projection = (b) => ({ schemaVersion: 1, briefVersion: b.briefVersion, preferences: b.preferences,
  essentials: Object.fromEntries(Object.entries(b.essentials).filter(([key]) => key !== 'charging')) });

// Business data lives only behind the repository. Draft receipts are a separate append-only
// stream; confirmed versions never acquire draft/inferred fields through an update.
export class BriefService {
  #repository; #policy; #clock; #identity;
  constructor({ repository, policy, clock, identity } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
  }

  async #prepare(context) {
    if (!this.#repository || !this.#policy || !this.#clock || !this.#identity) return { error: unavailable() };
    const allowed = await this.#identity.requireRole(context, 'employee');
    if (allowed.status !== 'ok') return { error: allowed };
    const clock = await this.#clock.now(context);
    if (clock.status !== 'ok') return { error: clock };
    if (!validInstant(clock.value?.now) || clock.value.runId !== context.runId) return { error: unavailable() };
    const read = { runId: context.runId, asOf: clock.value.now, policyVersion: context.policyVersion };
    const keys = ['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum',
      'eligibility.homeCharging.requiredForPlugIn', 'brief.lifecycle.v1'];
    const values = await Promise.all(keys.map((key) => this.#policy.getAssumption(key, read)));
    if (values.some((r) => r.status !== 'ok' || r.policyVersion !== context.policyVersion)) return { error: unavailable() };
    const [config, minimum, maximum, charging, lifecycle] = values.map((r) => r.value);
    if (!object(config.value?.preferences) || !object(config.value?.essentials) || minimum.value !== 0 || maximum.value !== 100
      || typeof charging.value !== 'boolean' || !object(lifecycle.value?.charging)
      || !Array.isArray(lifecycle.value.charging.values) || lifecycle.value.postDeclineChangeLimit !== 1) return { error: unavailable() };
    return { now: clock.value.now, read, config: config.value, slider: { minimum: minimum.value, maximum: maximum.value },
      lifecycle: lifecycle.value, assumptions: values.map((r) => r.value) };
  }

  #validate(brief, prepared, confirming = false) {
    if (!only(brief, ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback', 'currentCarRating', 'sameAgain']) || brief.schemaVersion !== 1
      || !object(brief.preferences) || !object(brief.essentials)) return invalid('brief', 'Supply schemaVersion, preferences and essentials.');
    const errors = validateBrief({ ...projection({ ...brief, briefVersion: 1 }),
      essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key, e]) => key !== 'charging' && e?.value !== null)) }, prepared.config, prepared.slider);
    if (errors.length) return result('invalid', { code: 'invalid-brief', reasons: errors });
    for (const [key, e] of Object.entries(brief.essentials)) {
      const d = key === 'charging' ? prepared.lifecycle.charging : prepared.config.essentials[key];
      if (!d || !only(e, ['operator', 'value', 'unit', 'state', 'source', 'confirmedAt']) || e.operator !== d.operator || e.unit !== d.unit
        || !text(e.source) || !['draft', 'inferred', 'confirmed', 'needs-confirmation'].includes(e.state)
        || (e.confirmedAt !== undefined && !validInstant(e.confirmedAt))
        || e.value === null && e.state !== 'needs-confirmation'
        || key === 'charging' && e.value !== null && !d.values.includes(e.value)) return invalid(`essentials.${key}`, 'Use a registered essential; unresolved values stay null and need confirmation.');
    }
    const feedback = brief.currentCarFeedback;
    if (feedback !== undefined && (!only(feedback, ['preserve', 'change', 'state', 'source'])
      || !['preserve', 'change'].every((key) => Array.isArray(feedback[key]) && feedback[key].every((v) => text(v) && Object.hasOwn(prepared.config.preferences, v)))
      || !['draft', 'inferred', 'confirmed'].includes(feedback.state) || !text(feedback.source))) return invalid('currentCarFeedback', 'Supply separate preserve/change preference keys and a source.');
    if (brief.currentCarRating !== undefined && !currentCarRatingValid(brief.currentCarRating)) return invalid('currentCarRating', 'Supply a 1 to 5 rating or null, the current contract, the employee source and the rating time.');
    if (brief.sameAgain !== undefined && !sameAgainValid(brief.sameAgain)) return invalid('sameAgain', 'Supply a boolean on, the current contract, the employee source and the time.');
    if (confirming && (Object.values(brief.preferences).some((p) => p.valueState === 'inferred' || p.importanceState === 'inferred')
      || Object.values(brief.essentials).some((e) => e.state === 'inferred') || feedback?.state === 'inferred')) {
      return invalid('brief', 'Review inferred suggestions in a new draft before confirming.', 'confirmation-required');
    }
    return null;
  }

  // A decline follow-up may add a registered target the brief lacks; null means the key exists (use the shared change).
  async #addTarget(brief, input, prepared, version) {
    const [section, key] = input.change.path.split('.');
    const registered = prepared.config[section];
    if (!object(brief[section]) || Object.hasOwn(brief[section], key) || !object(registered) || !Object.hasOwn(registered, key)) return null;
    // Only an adopted follow-up target can be added (else refused as before), within that question's control.
    const questions = await this.#policy.getAssumption(FOLLOWUP_QUESTIONS_KEY, prepared.read);
    if (questions?.status !== 'ok' || questions.policyVersion !== prepared.read.policyVersion
      || !Array.isArray(questions.value?.value?.questions)) return null;
    const question = questions.value.value.questions.find((q) => q?.path === input.change.path);
    if (!object(question?.control)) return null;
    const next = structuredClone(brief); const value = structuredClone(input.change.value);
    if (section === 'preferences') {
      if (question.control.kind === 'options' ? !Array.isArray(question.control.options) || !question.control.options.some((o) => o?.value === value)
        : question.control.kind !== 'slider' || !Number.isSafeInteger(value) || value < prepared.slider.minimum || value > prepared.slider.maximum) {
        return { status: 'invalid', code: 'invalid-value' };
      }
      const editor = await this.#policy.getAssumption('brief.editor.v1', prepared.read);
      const importance = editor?.value?.value?.preferences?.[key]?.importance;
      if (editor?.status !== 'ok' || editor.policyVersion !== prepared.read.policyVersion || !Number.isSafeInteger(importance)
        || importance < prepared.slider.minimum || importance > prepared.slider.maximum) return unavailable();
      next.preferences[key] = { value, importance, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee', confirmedAt: prepared.now };
      return { status: 'ok', brief: { ...next, briefVersion: version + 1 }, before: null, after: value };
    }
    if (!object(value) || value.state !== 'confirmed' || value.value === null || value.value === undefined) return { status: 'invalid', code: 'confirmed-essential-required' };
    if (question.control.kind !== 'equipment' || value.operator !== 'includes' || value.unit !== 'equipment-key'
      || !equipmentListValid(value.value, question.control)) return { status: 'invalid', code: 'invalid-value' };
    const after = { ...value, source: 'employee', confirmedAt: prepared.now };
    next.essentials[key] = after;
    return { status: 'ok', brief: { ...next, briefVersion: version + 1 }, before: null, after };
  }

  // Grants and the minimum-loss rule; null when the entry is missing or malformed (engagement then fails closed).
  async #engagement(read) {
    const found = await this.#policy.getAssumption(ENGAGEMENT_KEY, read);
    const v = found?.value?.value; const g = v?.grants;
    if (found?.status !== 'ok' || found.policyVersion !== read.policyVersion || !['assumed', 'verified'].includes(found.value?.status)
      || !only(v, ['schemaVersion', 'grants', 'onMinimumLoss']) || v.schemaVersion !== 1 || v.onMinimumLoss !== 'disengage'
      || !only(g, ['search', 'hold']) || typeof g.search !== 'boolean' || typeof g.hold !== 'boolean') return null;
    return { grants: { search: g.search, hold: g.hold } };
  }

  // Confirmed content from a draft's brief: validated for confirmation, states confirmed, known facts refreshed.
  async #confirmedContent(tx, context, prepared, source) {
    const error = this.#validate(source, prepared, true); if (error) return { error };
    const brief = structuredClone(source);
    brief.preferences = Object.fromEntries(Object.entries(brief.preferences).map(([key, p]) => [key, unselectedPreference(p)
      ? p : { ...p, valueState: 'confirmed', importanceState: 'confirmed', confirmedAt: prepared.now }]));
    brief.essentials = Object.fromEntries(Object.entries(brief.essentials).map(([key, e]) => [key, e.state === 'needs-confirmation' ? e : { ...e, state: 'confirmed', confirmedAt: prepared.now }]));
    if (brief.currentCarFeedback) brief.currentCarFeedback.state = 'confirmed';
    const facts = await this.#knownFacts(tx, context, prepared.now); if (facts.status !== 'ok') return { error: facts };
    brief.knownFacts = facts.value;
    return { brief };
  }

  async #state(reader, context) {
    const versions = await reader('briefs', { employeeId: context.employeeId });
    if (versions.status !== 'ok') return { error: versions };
    const drafts = await reader('event_receipts', { consumerId: draftConsumer(context) });
    if (drafts.status !== 'ok') return { error: drafts };
    const history = sorted(versions.value); const inputs = draftRows(drafts.value);
    return { history, current: history.at(-1) ?? null, draft: inputs.at(-1) ?? null };
  }

  async #activity(reader, context, brief) {
    const offers = await reader('offers', { employeeId: context.employeeId });
    if (offers.status !== 'ok') return offers;
    return ok({ canSearch: isBuddyEngaged(brief.buddy),
      canHold: isBuddyEngaged(brief.buddy),
      existingOffersUnaffected: true, existingOffers: offers.value.map(({ offerId, state, briefVersion }) => ({ offerId, state, briefVersion: briefVersion ?? null })) });
  }

  async #knownFacts(tx, context, now) {
    const employee = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
    if (employee.status !== 'ok') return employee;
    return ok(Object.fromEntries(['name', 'companyId', 'schemeId', 'gradeId', 'contract', 'renewalId'].filter((key) => employee.value[key] !== undefined)
      .map((key) => [key, { value: employee.value[key], source: 'repository:employees', sourceVersion: employee.value.version,
        observedAt: now, status: 'supplied-demo-fact' }])));
  }

  #validation(brief, prepared) {
    return { policyVersion: prepared.read.policyVersion,
      unknownEssentials: Object.entries(brief.essentials).filter(([, e]) => !unselectedPracticalAnswer(e)
        && (e.state !== 'confirmed' || e.value === null)).map(([key]) => key),
      assumptions: prepared.assumptions.filter((a) => a.key !== 'employee.recommendation.v1') };
  }

  async #read(context, kind) {
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const reader = (table, filter) => this.#repository.query(context, table, filter);
    const state = await this.#state(reader, context); if (state.error) return state.error;
    if (kind === 'history') return ok({ versions: state.history });
    if (kind === 'draft') return state.draft ? ok(state.draft) : result('not-found', { resourceType: 'brief-draft' });
    if (!state.current) return result('not-found', { resourceType: 'brief' });
    const activity = await this.#activity(reader, context, state.current);
    return activity.status === 'ok' ? ok({ brief: state.current, activity: activity.value, validation: this.#validation(state.current, prepared) }) : activity;
  }
  readCurrent(context) { return this.#read(context, 'current'); }
  readHistory(context) { return this.#read(context, 'history'); }
  readDraft(context) { return this.#read(context, 'draft'); }

  // The options argument is internal (editor to service only); HTTP routes never pass it.
  async saveDraft(context, input, options) { return this.#write(context, input, 'draft', options); }
  async engage(context, input, options) { return this.#write(context, input, 'engaged', options); }
  async disengage(context, input, options) { return this.#write(context, input, 'disengaged', options); }
  async confirm(context, input, options) { return this.#write(context, input, 'confirmed', options); }
  async pause(context, input, options) { return this.#write(context, input, 'paused', options); }
  async resume(context, input, options) { return this.#write(context, input, 'resumed', options); }
  async changeAfterDecline(context, input) { return this.#write(context, input, 'changed-after-decline'); }

  async #write(context, input, operation, options) {
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const drafting = operation === 'draft'; const confirming = operation === 'confirmed'; const decline = operation === 'changed-after-decline';
    const engaging = operation === 'engaged' || operation === 'disengaged';
    const pausing = operation === 'paused' || operation === 'resumed'; const withDraft = drafting || confirming || engaging || pausing && Boolean(options?.gate);
    // Internal gate from the editor: the minimum evaluated on the content at these exact versions.
    const gate = object(options?.gate) && typeof options.gate.ok === 'boolean' && revision(options.gate.briefVersion) && revision(options.gate.draftVersion)
      ? options.gate : null;
    const confirmSource = confirming && gate && options?.source;
    const minimumRefusal = () => { const n = gate.remaining; return result('invalid', { code: 'engagement-minimum', remaining: n, considered: gate.considered, minimumCategories: gate.minimumCategories,
      reasons: [{ field: 'categories', reason: `Choose ${n} more ${n === 1 ? 'category' : 'categories'} or turn on Same again to engage Buddy.` }] }); };
    const fields = ['commandId', 'expectedBriefVersion', ...(withDraft ? ['expectedDraftVersion'] : []),
      ...(drafting ? ['brief'] : confirming ? ['consent'] : decline ? ['decisionId', 'change'] : [])];
    if (!only(input, fields) || !text(input.commandId) || !revision(input.expectedBriefVersion)
      || withDraft && !revision(input.expectedDraftVersion)) return invalid('command', 'Supply a command ID and expected versions.', 'invalid-command');
    if (operation === 'engaged' && !gate) return invalid('engagement', 'Engage Buddy through the Account editor.', 'engagement-gate-required');
    if (drafting) { const error = this.#validate(input.brief, prepared); if (error) return error; }
    if (confirming && input.consent !== undefined && (!only(input.consent, ['search', 'hold'])
      || typeof input.consent.search !== 'boolean' || typeof input.consent.hold !== 'boolean')) return invalid('consent', 'Explicitly choose search and hold permission independently.');
    if (decline && (!text(input.decisionId) || !only(input.change, ['path', 'value']) || !Object.hasOwn(input.change, 'value') || !text(input.change.path)
      || !/^preferences\.[^.]+\.value$|^essentials\.[^.]+$/.test(input.change.path))) return invalid('change', 'Change exactly one registered preference value or essential.');
    let digest;
    try { digest = inputDigest({ operation, input, employeeId: context.employeeId, runId: context.runId }); } catch { return invalid('input', 'Use JSON values.'); }
    return this.#repository.transaction(context, { commandId: `brief:${context.employeeId}:${input.commandId}`, inputDigest: digest }, async (tx) => {
      const reader = (table, filter) => tx.list(table, filter);
      const state = await this.#state(reader, context); if (state.error) return state.error;
      const version = state.current?.briefVersion ?? 0;
      if (input.expectedBriefVersion !== version) return stale('brief', input.expectedBriefVersion, version);
      if (withDraft && input.expectedDraftVersion !== (state.draft?.draftVersion ?? 0)) return stale('draft', input.expectedDraftVersion, state.draft?.draftVersion ?? 0);
      if (gate && gate.briefVersion !== version) return stale('brief', gate.briefVersion, version);
      if (gate && gate.draftVersion !== (state.draft?.draftVersion ?? 0)) return stale('draft', gate.draftVersion, state.draft?.draftVersion ?? 0);
      if (gate && (drafting || confirming || pausing)) {
        const offers = await tx.list('offers', { employeeId: context.employeeId }); if (offers.status !== 'ok') return offers;
        if (offers.value.some((offer) => offer.state === 'accepted')) return result('conflict', { reason: 'brief-read-only', current: { briefVersion: version } });
      }
      let recorded = operation; let draftValue = null; let transition = null; let brief = null;
      const pending = state.draft && state.draft.baseBriefVersion === version ? state.draft : null;
      const heldNow = engagedNow(state.current);
      const canRevoke = ['searchConsent', 'holdConsent', 'paused'].some((key) => state.current?.buddy?.[key] === true);
      const disengaged = (extra) => { const { disengagedReason: _gone, ...rest } = state.current?.buddy ?? {};
        return { ...rest, enabled: false, searchConsent: false, holdConsent: false, paused: false, permissionVersion: version + 1, disengagedAt: prepared.now, ...extra }; };
      if (drafting) {
        const facts = await this.#knownFacts(tx, context, prepared.now); if (facts.status !== 'ok') return facts;
        const value = { runId: context.runId, employeeId: context.employeeId, draftVersion: (state.draft?.draftVersion ?? 0) + 1,
          baseBriefVersion: version, brief: input.brief, knownFacts: facts.value, validation: this.#validation(input.brief, prepared),
          savedBy: context.principalId, savedAt: prepared.now };
        const stored = await tx.recordReceipt({ consumerId: draftConsumer(context), eventId: String(value.draftVersion), inputDigest: digest,
          eventType: 'brief-draft-saved', state: 'completed', outcome: ok(value), createdAt: prepared.now, updatedAt: prepared.now });
        if (stored.status !== 'ok') return stored;
        // While consent is held an autosave is also a confirmed version, so the search never runs on older choices.
        if (!gate || state.current?.buddy?.searchConsent !== true) return ok(value);
        if (!await this.#engagement(prepared.read)) return unavailable();
        const made = await this.#confirmedContent(tx, context, prepared, input.brief); if (made.error) return made.error;
        draftValue = value; brief = made.brief;
        if (gate.ok) { recorded = 'preferences-updated'; brief.buddy = structuredClone(state.current.buddy); }
        else { recorded = 'disengaged'; transition = 'minimum-lost'; brief.buddy = disengaged({ disengagedReason: 'minimum-lost' }); }
      } else if (engaging) {
        const offers = await tx.list('offers', { employeeId: context.employeeId }); if (offers.status !== 'ok') return offers;
        if (operation === 'engaged' && !state.current && !pending) return result('not-found', { resourceType: 'brief' });
        if (offers.value.some((o) => o.state === 'accepted')) return result('conflict', { reason: 'brief-read-only', current: { briefVersion: version } });
        if (operation === 'engaged' ? heldNow : !canRevoke) return result('conflict', { reason: operation === 'engaged' ? 'already-engaged' : 'already-disengaged', current: { briefVersion: version } });
        // A pending draft is the latest saved brief; otherwise the current confirmed brief is copied.
        const base = pending ? await this.#confirmedContent(tx, context, prepared, pending.brief) : { brief: structuredClone(state.current) };
        if (base.error) return base.error;
        if (operation === 'engaged') {
          const grants = await this.#engagement(prepared.read); if (!grants) return unavailable();
          if (!gate.ok) return minimumRefusal();
          brief = base.brief;
          brief.buddy = { enabled: grants.grants.search, searchConsent: grants.grants.search, holdConsent: grants.grants.hold, paused: false, permissionVersion: version + 1,
            engagedBy: context.principalId, engagedAt: prepared.now, confirmedBy: context.principalId, confirmedAt: prepared.now };
        } else {
          brief = base.brief;
          brief.buddy = disengaged();
        }
      } else if (confirming && !state.draft || !confirming && !state.current) return result('not-found', { resourceType: confirming ? 'brief-draft' : 'brief' });
      else if (confirming && !confirmSource && state.draft.baseBriefVersion !== version) return stale('brief', state.draft.baseBriefVersion, version);
      else if (confirming) {
        const made = await this.#confirmedContent(tx, context, prepared, confirmSource || state.draft.brief); if (made.error) return made.error;
        brief = made.brief;
        let consent = input.consent;
        if (gate && consent?.search === true) {
          const policy = await this.#engagement(prepared.read); if (!policy) return unavailable();
          if (!gate.ok) return minimumRefusal();
          consent = policy.grants;
        }
        brief.buddy = { enabled: consent?.search === true, searchConsent: consent?.search === true,
          holdConsent: consent?.hold === true, paused: false, permissionVersion: version + 1,
          confirmedBy: context.principalId, confirmedAt: prepared.now };
      } else if (pausing) {
        if (operation === 'resumed' && gate && !gate.ok) return minimumRefusal();
        brief = structuredClone(state.current);
        if (operation === 'paused' && brief.buddy?.searchConsent !== true) return result('conflict', { reason: 'not-engaged', current: { briefVersion: version } });
        if (brief.buddy.paused === (operation === 'paused')) return result('conflict', { reason: operation === 'paused' ? 'already-paused' : 'already-resumed', current: { briefVersion: version } });
        brief.buddy = { ...brief.buddy, paused: operation === 'paused', permissionVersion: version + 1,
          ...(operation === 'paused' ? { pausedAt: prepared.now } : { resumedAt: prepared.now }) };
      } else {
        brief = structuredClone(state.current);
        const decision = await tx.get({ table: 'decisions', key: { runId: context.runId, decisionId: input.decisionId } });
        if (decision.status !== 'ok') return decision;
        if (decision.value.employeeId !== context.employeeId) return result('forbidden', { reason: 'The decline belongs to another employee.' });
        if (decision.value.decision !== 'decline' || !text(decision.value.offerId)) return invalid('decisionId', 'A recorded decline is required.');
        if (state.history.some((b) => b.postDeclineChange?.decisionId === input.decisionId)) return result('conflict', { reason: 'decline-change-already-recorded', current: { briefVersion: version } });
        if (!state.history.some((b) => b.briefVersion === decision.value.versions?.brief)) return invalid('decisionId', 'The decline must reference an approved brief version.');
        const added = await this.#addTarget(brief, input, prepared, version);
        if (added?.status === 'unavailable') return added;
        const applied = added ?? applyConfirmedFeedbackChange(brief, { schemaVersion: 1, id: input.commandId, type: 'confirm-change',
          target: input.change, reason: 'employee-confirmed-after-decline', scope: { kind: 'employee-draft', id: context.employeeId },
          expectedVersion: version, confirmation: { actor: 'employee', confirmed: true, at: prepared.now } });
        if (applied.status !== 'ok') return invalid(applied.code === 'unknown-field' ? 'change.path' : 'change.value',
          applied.code === 'unchanged-value' ? 'Confirm a different value.' : 'Change an existing registered field with an explicitly confirmed value.');
        brief = applied.brief;
        const error = this.#validate({ schemaVersion: brief.schemaVersion, preferences: brief.preferences, essentials: brief.essentials,
          ...(brief.currentCarFeedback ? { currentCarFeedback: brief.currentCarFeedback } : {}),
          ...(brief.currentCarRating ? { currentCarRating: brief.currentCarRating } : {}),
          ...(brief.sameAgain ? { sameAgain: brief.sameAgain } : {}) }, prepared, true);
        if (error) return error;
        brief.postDeclineChange = { decisionId: input.decisionId, offerId: decision.value.offerId, fromBriefVersion: version,
          path: input.change.path, before: applied.before, after: applied.after, confirmedBy: context.principalId, confirmedAt: prepared.now };
      }
      brief = { ...brief, runId: context.runId, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
        renewalId: context.renewalId ?? null, schemaVersion: 1, briefVersion: version + 1, previousBriefVersion: version || null,
        status: 'confirmed', policyVersion: context.policyVersion, confirmedBy: context.principalId, confirmedAt: prepared.now,
        version: 1, createdAt: prepared.now, updatedAt: prepared.now };
      const stored = await tx.insert('briefs', brief); if (stored.status !== 'ok') return stored;
      const activity = await this.#activity(reader, context, stored.value); if (activity.status !== 'ok') return activity;
      const event = { eventId: `brief:${context.employeeId}:${version + 1}`, eventType: 'brief-changed', operation: recorded,
        runId: context.runId, employeeId: context.employeeId, briefVersion: version + 1, previousBriefVersion: version || null, occurredAt: prepared.now };
      const receipt = await tx.recordReceipt({ consumerId: 'brief:changes', eventId: event.eventId, inputDigest: digest,
        eventType: event.eventType, inputVersions: { brief: version + 1, policy: context.policyVersion }, state: 'completed', outcome: ok(event),
        createdAt: prepared.now, updatedAt: prepared.now });
      if (receipt.status !== 'ok') return receipt;
      return ok(draftValue ? { ...draftValue, confirmed: { briefVersion: version + 1, transition } }
        : { brief: stored.value, activity: activity.value, validation: this.#validation(stored.value, prepared), event });
    });
  }

  // Allocation can call this gate before claiming. It creates no search, hold or offer.
  // FUCQ-29 remains the one owner of driver/points/eligibility/essential/availability gates.
  async evaluateCandidate(context, { candidate, employeeFacts, currentCar } = {}) {
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const current = await this.readCurrent(context); if (current.status !== 'ok') return current;
    const brief = current.value.brief;
    if (!current.value.activity.canSearch) return result('conflict', { reason: 'buddy-not-searching', current: { briefVersion: brief.briefVersion } });
    const facts = structuredClone(employeeFacts ?? {});
    const charging = brief.essentials.charging;
    if (!unselectedPracticalAnswer(charging)) facts.charging = { status: charging?.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown', value: charging?.value ?? null,
      unit: null, provenance: { sourceRef: charging?.source ?? 'brief:unresolved', version: String(brief.briefVersion), observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
    const provider = { async resolve() { return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
      factsVersion: String(brief.briefVersion), stockVersion: candidate?.availability?.version, employeeFacts: facts, stock: [candidate], ...(currentCar ? { currentCar } : {}) }); } };
    const recommendation = createEmployeeRecommendationService({ provider, policy: this.#policy, time: this.#clock });
    const evaluated = await recommendation.recommend(context, { ...projection(brief), ...storedFeedback(brief) });
    return evaluated.status === 'ok' ? ok(evaluated.value.decisions[0]) : evaluated;
  }
}

export const createBriefService = (configuration) => new BriefService(configuration);
