import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { validateBrief } from '../../scenarios/employee/index.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';

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
    if (!only(brief, ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback']) || brief.schemaVersion !== 1
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
    if (confirming && (Object.values(brief.preferences).some((p) => p.valueState === 'inferred' || p.importanceState === 'inferred')
      || Object.values(brief.essentials).some((e) => e.state === 'inferred') || feedback?.state === 'inferred')) {
      return invalid('brief', 'Review inferred suggestions in a new draft before confirming.', 'confirmation-required');
    }
    return null;
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
    return ok({ canSearch: brief.buddy.searchConsent === true && !brief.buddy.paused,
      canHold: brief.buddy.searchConsent === true && brief.buddy.holdConsent === true && !brief.buddy.paused,
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
      unknownEssentials: Object.entries(brief.essentials).filter(([, e]) => e.state !== 'confirmed' || e.value === null).map(([key]) => key),
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

  async saveDraft(context, input) { return this.#write(context, input, 'draft'); }
  async confirm(context, input) { return this.#write(context, input, 'confirmed'); }
  async pause(context, input) { return this.#write(context, input, 'paused'); }
  async resume(context, input) { return this.#write(context, input, 'resumed'); }
  async changeAfterDecline(context, input) { return this.#write(context, input, 'changed-after-decline'); }

  async #write(context, input, operation) {
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const drafting = operation === 'draft'; const confirming = operation === 'confirmed'; const decline = operation === 'changed-after-decline';
    const fields = ['commandId', 'expectedBriefVersion', ...(drafting || confirming ? ['expectedDraftVersion'] : []),
      ...(drafting ? ['brief'] : confirming ? ['consent'] : decline ? ['decisionId', 'change'] : [])];
    if (!only(input, fields) || !text(input.commandId) || !revision(input.expectedBriefVersion)
      || (drafting || confirming) && !revision(input.expectedDraftVersion)) return invalid('command', 'Supply a command ID and expected versions.', 'invalid-command');
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
      if ((drafting || confirming) && input.expectedDraftVersion !== (state.draft?.draftVersion ?? 0)) return stale('draft', input.expectedDraftVersion, state.draft?.draftVersion ?? 0);
      if (drafting) {
        const facts = await this.#knownFacts(tx, context, prepared.now); if (facts.status !== 'ok') return facts;
        const value = { runId: context.runId, employeeId: context.employeeId, draftVersion: (state.draft?.draftVersion ?? 0) + 1,
          baseBriefVersion: version, brief: input.brief, knownFacts: facts.value, validation: this.#validation(input.brief, prepared),
          savedBy: context.principalId, savedAt: prepared.now };
        const stored = await tx.recordReceipt({ consumerId: draftConsumer(context), eventId: String(value.draftVersion), inputDigest: digest,
          eventType: 'brief-draft-saved', state: 'completed', outcome: ok(value), createdAt: prepared.now, updatedAt: prepared.now });
        return stored.status === 'ok' ? ok(value) : stored;
      }
      if (!confirming && !state.current || confirming && !state.draft) return result('not-found', { resourceType: confirming ? 'brief-draft' : 'brief' });
      if (confirming && state.draft.baseBriefVersion !== version) return stale('brief', state.draft.baseBriefVersion, version);
      let brief = structuredClone(confirming ? state.draft.brief : state.current);
      if (confirming) {
        const error = this.#validate(brief, prepared, true); if (error) return error;
        brief.preferences = Object.fromEntries(Object.entries(brief.preferences).map(([key, p]) => [key, { ...p, valueState: 'confirmed', importanceState: 'confirmed', confirmedAt: prepared.now }]));
        brief.essentials = Object.fromEntries(Object.entries(brief.essentials).map(([key, e]) => [key, e.state === 'needs-confirmation' ? e : { ...e, state: 'confirmed', confirmedAt: prepared.now }]));
        if (brief.currentCarFeedback) brief.currentCarFeedback.state = 'confirmed';
        brief.buddy = { enabled: input.consent?.search === true, searchConsent: input.consent?.search === true,
          holdConsent: input.consent?.hold === true, paused: false, permissionVersion: version + 1,
          confirmedBy: context.principalId, confirmedAt: prepared.now };
        const facts = await this.#knownFacts(tx, context, prepared.now); if (facts.status !== 'ok') return facts;
        brief.knownFacts = facts.value;
      } else if (operation === 'paused' || operation === 'resumed') {
        if (brief.buddy.paused === (operation === 'paused')) return result('conflict', { reason: operation === 'paused' ? 'already-paused' : 'already-resumed', current: { briefVersion: version } });
        brief.buddy = { ...brief.buddy, paused: operation === 'paused', permissionVersion: version + 1,
          ...(operation === 'paused' ? { pausedAt: prepared.now } : { resumedAt: prepared.now }) };
      } else {
        const decision = await tx.get({ table: 'decisions', key: { runId: context.runId, decisionId: input.decisionId } });
        if (decision.status !== 'ok') return decision;
        if (decision.value.employeeId !== context.employeeId) return result('forbidden', { reason: 'The decline belongs to another employee.' });
        if (decision.value.decision !== 'decline' || !text(decision.value.offerId)) return invalid('decisionId', 'A recorded decline is required.');
        if (state.history.some((b) => b.postDeclineChange?.decisionId === input.decisionId)) return result('conflict', { reason: 'decline-change-already-recorded', current: { briefVersion: version } });
        if (!state.history.some((b) => b.briefVersion === decision.value.versions?.brief)) return invalid('decisionId', 'The decline must reference an approved brief version.');
        const [section, key] = input.change.path.split('.');
        if (!Object.hasOwn(brief[section], key)) return invalid('change.path', 'Change an existing registered field.');
        const before = structuredClone(section === 'preferences' ? brief.preferences[key].value : brief.essentials[key]);
        if (inputDigest(before) === inputDigest(input.change.value)) return invalid('change.value', 'Confirm a different value.');
        if (section === 'preferences') brief.preferences[key] = { ...brief.preferences[key], value: input.change.value, source: 'employee', valueState: 'confirmed', confirmedAt: prepared.now };
        else brief.essentials[key] = { ...input.change.value, source: 'employee', confirmedAt: prepared.now };
        const error = this.#validate({ schemaVersion: brief.schemaVersion, preferences: brief.preferences, essentials: brief.essentials,
          ...(brief.currentCarFeedback ? { currentCarFeedback: brief.currentCarFeedback } : {}) }, prepared, true);
        if (error) return error;
        if (section === 'essentials' && brief.essentials[key].state !== 'confirmed') return invalid('change.value', 'The changed essential must be explicitly confirmed.');
        brief.postDeclineChange = { decisionId: input.decisionId, offerId: decision.value.offerId, fromBriefVersion: version,
          path: input.change.path, before, after: section === 'preferences' ? input.change.value : brief.essentials[key], confirmedBy: context.principalId, confirmedAt: prepared.now };
      }
      brief = { ...brief, runId: context.runId, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
        renewalId: context.renewalId ?? null, schemaVersion: 1, briefVersion: version + 1, previousBriefVersion: version || null,
        status: 'confirmed', policyVersion: context.policyVersion, confirmedBy: context.principalId, confirmedAt: prepared.now,
        version: 1, createdAt: prepared.now, updatedAt: prepared.now };
      const stored = await tx.insert('briefs', brief); if (stored.status !== 'ok') return stored;
      const activity = await this.#activity(reader, context, stored.value); if (activity.status !== 'ok') return activity;
      const event = { eventId: `brief:${context.employeeId}:${version + 1}`, eventType: 'brief-changed', operation,
        runId: context.runId, employeeId: context.employeeId, briefVersion: version + 1, previousBriefVersion: version || null, occurredAt: prepared.now };
      const receipt = await tx.recordReceipt({ consumerId: 'brief:changes', eventId: event.eventId, inputDigest: digest,
        eventType: event.eventType, inputVersions: { brief: version + 1, policy: context.policyVersion }, state: 'completed', outcome: ok(event),
        createdAt: prepared.now, updatedAt: prepared.now });
      return receipt.status === 'ok' ? ok({ brief: stored.value, activity: activity.value, validation: this.#validation(stored.value, prepared), event }) : receipt;
    });
  }

  // Allocation can call this gate before claiming. It creates no search, hold or offer.
  // FUCQ-29 remains the one owner of driver/points/eligibility/essential/availability gates.
  async evaluateCandidate(context, { candidate, employeeFacts } = {}) {
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const current = await this.readCurrent(context); if (current.status !== 'ok') return current;
    const brief = current.value.brief;
    if (!current.value.activity.canSearch) return result('conflict', { reason: 'buddy-not-searching', current: { briefVersion: brief.briefVersion } });
    const facts = structuredClone(employeeFacts ?? {});
    const charging = brief.essentials.charging;
    facts.charging = { status: charging?.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown', value: charging?.value ?? null,
      unit: null, provenance: { sourceRef: charging?.source ?? 'brief:unresolved', version: String(brief.briefVersion), observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
    const provider = { async resolve() { return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
      factsVersion: String(brief.briefVersion), stockVersion: candidate?.availability?.version, employeeFacts: facts, stock: [candidate] }); } };
    const recommendation = createEmployeeRecommendationService({ provider, policy: this.#policy, time: this.#clock });
    const evaluated = await recommendation.recommend(context, projection(brief));
    return evaluated.status === 'ok' ? ok(evaluated.value.decisions[0]) : evaluated;
  }
}

export const createBriefService = (configuration) => new BriefService(configuration);
