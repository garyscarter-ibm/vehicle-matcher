import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { loadCasePolicy, unavailable } from './policy.js';
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => object(v) && Object.keys(v).every((key) => keys.includes(key));
const text = (v, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const currentBrief = (rows) => rows.filter((b) => b.status === 'confirmed').sort((a, b) => b.briefVersion - a.briefVersion)[0];
const active = (c) => ['open', 'in-progress', 'remedy-proposed'].includes(c.status);
const invalid = (field, reason, code = 'invalid-case-command') => result('invalid', { code, reasons: [{ field, reason }], action: 'review-and-retry' });
const forbidden = () => result('forbidden', { reason: 'Only the scheme team can record renewal-case updates and remedies.' });
const ref = (context, caseId) => ({ table: 'renewal_cases', key: { runId: context.runId, caseId } });
const same = (a, b) => inputDigest(a) === inputDigest(b);
const confirmedRelaxation = (briefs, remedy, principalId) => {
  const before = briefs.find((b) => b.status === 'confirmed' && b.briefVersion === remedy.expectedBriefVersion);
  const current = currentBrief(briefs); const change = current?.postDeclineChange;
  return !!(before && change && change.decisionId === remedy.decisionId && change.fromBriefVersion === remedy.expectedBriefVersion
    && change.path === remedy.path && same(change.after, remedy.value) && change.confirmedBy === principalId && validInstant(change.confirmedAt)
    && current.confirmedBy === principalId && current.confirmedAt === change.confirmedAt
    && same(current.essentials, before.essentials) && current.briefVersion === before.briefVersion + 1);
};
const transitions = { open: ['in-progress', 'closed'], 'in-progress': ['remedy-proposed', 'resolved', 'closed'],
  'remedy-proposed': ['in-progress', 'resolved', 'closed'], resolved: ['closed'], closed: [] };
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const deadline = (employee) => {
  const contract = employee.contract?.manualContext?.contracts?.find((c) => c.status === 'current') ?? employee.contract;
  const value = contract?.contractEndDate;
  return date(value) ? { value, instant: `${value}T23:59:59.999Z` } : null;
};
const caseUpdate = (c) => ({ caseId: c.caseId, runId: c.runId, employeeId: c.employeeId, renewalId: c.renewalId, caseVersion: c.version,
  status: c.status, owner: c.owner, nextAction: c.nextAction, dueAt: c.dueAt, reason: c.history.at(-1).reason,
  occurredAt: c.history.at(-1).at, remedy: c.remedy ?? null, fictional: true });

export class RenewalCaseService {
  #repository; #policy; #clock; #identity; #start;
  constructor({ repository, policy, clock, identity } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
  }
  async #authorized(context, owner = false) {
    if (!this.#identity) return unavailable();
    if (!owner) return this.#identity.requireRole(context, 'employee');
    const greg = await this.#identity.requireRole(context, 'greg');
    return greg.status === 'ok' ? greg : this.#identity.requireRole(context, 'presenter');
  }
  async #prepare(context) {
    if (!this.#repository || !this.#clock || !this.#policy) return { error: unavailable() };
    const time = await this.#clock.now(context); if (time.status !== 'ok') return { error: time };
    const run = await this.#repository.read(context, { table: 'runs', key: { runId: context.runId } });
    if (run.status !== 'ok') return { error: run };
    const read = { runId: context.runId, asOf: time.value.now, policyVersion: run.value.policyVersion };
    const config = await loadCasePolicy(this.#policy, read); if (config.status !== 'ok') return { error: config };
    return { now: time.value.now, clockVersion: time.value.clockVersion, read, config: config.value };
  }
  async #fresh(tx, context, prepared) {
    const run = await tx.get({ table: 'runs', key: { runId: context.runId } });
    if (run.status !== 'ok') return run;
    return run.value.clockInstant === prepared.now && run.value.policyVersion === prepared.read.policyVersion ? ok(null)
      : result('stale-version', { reason: 'Demonstration time or policy changed. Refresh this case before retrying.', action: 'refresh' });
  }
  async #renewal(tx, context, employeeId) {
    const found = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId } }); if (found.status !== 'ok') return found;
    const employee = found.value;
    const slots = await tx.list('entitlement_slots', { employeeId }); if (slots.status !== 'ok') return slots;
    const slot = slots.value.find((s) => s.entitlementSlotId === employee.entitlementSlotId);
    const renewalId = employee.renewalId ?? slot?.renewalId;
    return text(renewalId, 128) ? ok({ employee, renewalId }) : invalid('renewalId', 'The actual renewal has not been supplied. Ask the scheme team to check your contract.', 'renewal-context-required');
  }
  async readHelp(context) {
    const allowed = await this.#authorized(context); if (allowed.status !== 'ok') return allowed;
    const p = await this.#prepare(context); if (p.error) return p.error;
    return ok({ opensCase: false, ownerRole: p.config.ownerRole, extensionPermitted: p.config.extensionPermitted,
      nextAction: 'Ask for help to open an owned renewal case.', automaticRecoveryPriority: false,
      policyVersion: p.read.policyVersion, assumptions: p.config.assumptions });
  }
  async readOwn(context, input = {}) {
    const allowed = await this.#authorized(context); if (allowed.status !== 'ok') return allowed;
    if (!only(input, ['caseId']) || input.caseId !== undefined && !text(input.caseId, 128)) return invalid('caseId', 'Use your current case reference.');
    const p = await this.#prepare(context); if (p.error) return p.error;
    if (input.caseId) {
      const found = await this.#repository.read(context, ref(context, input.caseId));
      if (found.status !== 'ok') return found;
      if (found.value.employeeId !== context.employeeId) return result('forbidden', { reason: 'This renewal case belongs to another employee.' });
      const projection = await this.#ownProjection(context, [found.value]);
      return projection.status === 'ok' ? ok({ case: projection.value[0], asOf: p.now, policyVersion: p.read.policyVersion }) : projection;
    }
    const rows = await this.#repository.query(context, 'renewal_cases', { employeeId: context.employeeId });
    if (rows.status !== 'ok') return rows;
    const projection = await this.#ownProjection(context, rows.value);
    return projection.status === 'ok' ? ok({ cases: projection.value, asOf: p.now, policyVersion: p.read.policyVersion }) : projection;
  }
  async #ownProjection(context, cases) {
    if (!cases.some((c) => c.remedy?.type === 'preference-relaxation')) return ok(cases);
    const rows = await this.#repository.query(context, 'briefs', { employeeId: context.employeeId });
    if (rows.status !== 'ok') return rows;
    const brief = currentBrief(rows.value);
    return ok(cases.map((c) => c.remedy?.type !== 'preference-relaxation' ? c : { ...c, relaxation: {
      currentBriefVersion: brief?.briefVersion ?? null,
      before: brief?.preferences?.[c.remedy.path.split('.')[1]]?.value ?? null,
      applicable: brief?.briefVersion === c.remedy.expectedBriefVersion,
      confirmed: confirmedRelaxation(rows.value, c.remedy, context.principalId),
    } }));
  }
  async list(context) {
    const allowed = await this.#authorized(context, true); if (allowed.status !== 'ok') return allowed;
    const p = await this.#prepare(context); if (p.error) return p.error;
    const rows = await this.#repository.query(context, 'renewal_cases'); if (rows.status !== 'ok') return rows;
    const employees = await this.#repository.query(context, 'employees'); if (employees.status !== 'ok') return employees;
    const names = new Map(employees.value.map((employee) => [employee.employeeId, employee.name]));
    return ok({ cases: rows.value.map((c) => ({ ...c, employeeName: text(names.get(c.employeeId)) ? names.get(c.employeeId) : c.employeeId })),
      asOf: p.now, policyVersion: p.read.policyVersion });
  }
  async readOptions(context, input = {}) {
    const allowed = await this.#authorized(context, true); if (allowed.status !== 'ok') return allowed;
    if (!only(input, ['caseId']) || !text(input.caseId, 128)) return invalid('caseId', 'Choose a current renewal case.');
    const p = await this.#prepare(context); if (p.error) return p.error;
    const reader = { get: (reference) => this.#repository.read(context, reference),
      list: (table, filter) => this.#repository.query(context, table, filter) };
    const found = await reader.get(ref(context, input.caseId)); if (found.status !== 'ok') return found;
    const c = found.value;
    const renewal = await this.#renewal(reader, context, c.employeeId); if (renewal.status !== 'ok') return renewal;
    if (renewal.value.renewalId !== c.renewalId) return result('conflict', { reason: 'The current renewal differs from this case. Review the employee contract.' });
    const briefs = await reader.list('briefs', { employeeId: c.employeeId }); if (briefs.status !== 'ok') return briefs;
    const brief = currentBrief(briefs.value);
    const stock = await reader.list('stock'); if (stock.status !== 'ok') return stock;
    const cars = [];
    for (const car of brief ? stock.value : []) {
      const checked = await this.#remedy(reader, context, renewal.value, p, { type: 'alternative-car', orderUuid: car.orderUuid }, false, true);
      if (checked.status === 'ok') cars.push(checked.value);
      else if (checked.status !== 'invalid') return checked;
    }
    const decisions = await reader.list('decisions', { employeeId: c.employeeId }); if (decisions.status !== 'ok') return decisions;
    const decline = decisions.value.filter((d) => d.decision === 'decline' && text(d.offerId, 128)
      && briefs.value.some((b) => b.status === 'confirmed' && b.briefVersion === d.versions?.brief)
      && !briefs.value.some((b) => b.postDeclineChange?.decisionId === d.decisionId))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || a.decisionId.localeCompare(b.decisionId))[0];
    const relaxation = [];
    if (brief && decline) {
      const values = await Promise.all(['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum']
        .map((key) => this.#policy.getAssumption(key, p.read)));
      if (values.some((v) => v.status !== 'ok' || v.policyVersion !== p.read.policyVersion)) return unavailable();
      const [registry, minimum, maximum] = values.map((v) => v.value.value);
      if (!object(registry?.preferences) || minimum !== 0 || maximum !== 100) return unavailable();
      for (const [key, preference] of Object.entries(brief.preferences)) {
        const definition = registry.preferences[key];
        if (!definition || !['enum', 'slider'].includes(definition.type)
          || definition.type === 'enum' && !Array.isArray(definition.values)) return unavailable();
        const alternatives = definition.type === 'enum' ? definition.values.filter((v) => !same(v, preference.value)) : null;
        if (alternatives?.length === 0) continue;
        relaxation.push({ type: 'preference-relaxation', decisionId: decline.decisionId, expectedBriefVersion: brief.briefVersion,
          path: `preferences.${key}.value`, before: preference.value, valueType: definition.type,
          ...(definition.type === 'enum' ? { values: alternatives } : { minimum, maximum }), unit: definition.unit ?? null });
      }
    }
    const releases = [c.remedy, ...c.history.map((h) => h.remedy)].filter((r) => r?.type === 'later-release');
    const later = [];
    for (const release of releases) {
      const checked = await this.#remedy(reader, context, renewal.value, p, release, false);
      if (checked.status === 'ok' && !later.some((r) => same(r, checked.value))) later.push(checked.value);
    }
    const actual = deadline(renewal.value.employee);
    const available = (items, reason) => ({ available: items.length > 0, items, ...(items.length ? {} : { reason }) });
    const fresh = await this.#fresh(reader, context, p); if (fresh.status !== 'ok') return fresh;
    return ok({ case: { ...c, employeeName: text(renewal.value.employee.name) ? renewal.value.employee.name : c.employeeId },
      nextStatuses: [...(transitions[c.status] ?? [])], asOf: p.now, policyVersion: p.read.policyVersion, automaticRecoveryPriority: false,
      options: { alternativeCars: available(cars, brief ? 'No suitable available car is currently recorded.' : 'A confirmed brief is required to evaluate suitable available cars.'),
        preferenceRelaxations: available(relaxation, 'A current confirmed brief and an unused recorded decline are required.'),
        laterRelease: available(later, 'No reviewed future release date and source are recorded for this case.'),
        manualDecision: { available: true, type: 'manual-decision', requiresDecision: true },
        contractExtension: { available: p.config.extensionPermitted && !!actual, type: 'contract-extension',
          contractEndDate: actual?.value ?? null, requiresUntil: true,
          ...(!p.config.extensionPermitted ? { reason: 'The current policy does not permit a contract extension.' }
            : !actual ? { reason: 'The actual contract end date needs confirmation.' } : {}) } } });
  }
  async #notify(tx, c) {
    const payload = { caseUpdate: caseUpdate(c) };
    return tx.enqueueNotification({ runId: c.runId, jobId: `case-${inputDigest([c.caseId, c.version]).slice(0, 40)}`,
      idempotencyKey: `case:${c.caseId}:update:${c.version}`, inputDigest: inputDigest(payload), recipientId: c.employeeId,
      messageKind: 'renewal-case-update', messageVersion: '1', payload, state: 'pending', attempts: 0 });
  }
  async #open(tx, context, renewal, prepared, trigger, reason, actorId) {
    const found = await tx.list('renewal_cases', { employeeId: renewal.employee.employeeId, renewalId: renewal.renewalId }); if (found.status !== 'ok') return found;
    const current = found.value.find(active);
    const at = prepared.now;
    const history = { at, actorId, actorRole: actorId === 'renewal-risk-clock' ? 'system' : 'employee', status: current?.status ?? 'open', reason, trigger,
      nextAction: current?.nextAction ?? 'Scheme team to review your renewal and contact you.',
      dueAt: current?.dueAt ?? new Date(Date.parse(at) + prepared.config.dueHours * 3600000).toISOString() };
    const actual = deadline(renewal.employee);
    const stored = current ? await tx.compareAndSwap(ref(context, current.caseId), current.version, {
      history: [...current.history, history], lastUpdatedAt: at,
    }) : await tx.insert('renewal_cases', { runId: context.runId, caseId: `renewal-${inputDigest([renewal.employee.employeeId, renewal.renewalId, trigger]).slice(0, 40)}`,
      employeeId: renewal.employee.employeeId, renewalId: renewal.renewalId, owner: { role: prepared.config.ownerRole, name: 'Scheme team' },
      status: 'open', reason, trigger, nextAction: 'Scheme team to review your renewal and contact you.',
      dueAt: new Date(Date.parse(at) + prepared.config.dueHours * 3600000).toISOString(), openedAt: at, lastUpdatedAt: at,
      renewalDeadline: actual?.value ?? null, renewalDeadlineState: actual ? 'supplied-demo-fact' : 'needs-confirmation',
      policyVersion: prepared.read.policyVersion, history: [history], remedy: null, fictional: true });
    if (stored.status !== 'ok') return stored;
    const queued = await this.#notify(tx, stored.value);
    return queued.status === 'ok' ? ok({ case: stored.value }) : queued;
  }
  async requestHelp(context, input) {
    const allowed = await this.#authorized(context); if (allowed.status !== 'ok') return allowed;
    if (!only(input, ['commandId', 'reason']) || !text(input.commandId, 128) || !text(input.reason)) return invalid('reason', 'Describe the renewal problem and supply a command ID.');
    const p = await this.#prepare(context); if (p.error) return p.error;
    return this.#repository.transaction(context, { commandId: `case:request:${context.employeeId}:${input.commandId}`, inputDigest: inputDigest(input) }, async (tx) => {
      const fresh = await this.#fresh(tx, context, p); if (fresh.status !== 'ok') return fresh;
      const renewal = await this.#renewal(tx, context, context.employeeId); if (renewal.status !== 'ok') return renewal;
      return this.#open(tx, context, renewal.value, p, { type: 'employee-request', requestId: input.commandId }, input.reason, context.principalId);
    });
  }
  async #remedy(tx, context, renewal, p, remedy, resolving, projection = false) {
    if (!object(remedy) || !text(remedy.type, 128)) return invalid('remedy', 'The scheme team must record a remedy before resolving this case.');
    if (remedy.type === 'manual-decision') return only(remedy, ['type', 'decision']) && text(remedy.decision) ? ok(remedy) : invalid('remedy.decision', 'Record the authorised scheme-team decision.');
    if (remedy.type === 'contract-extension') {
      if (!p.config.extensionPermitted) return result('forbidden', { reason: 'The scheme does not permit a contract extension under this policy.' });
      return only(remedy, ['type', 'until']) && date(remedy.until) && Date.parse(remedy.until+'T23:59:59.999Z') > Date.parse(p.now)
        && deadline(renewal.employee) && remedy.until > deadline(renewal.employee).value ? ok(remedy) : invalid('remedy.until', 'Supply a permitted extension date after the actual contract end.');
    }
    if (remedy.type === 'later-release') return only(remedy, ['type', 'releaseAt', 'source']) && validInstant(remedy.releaseAt)
      && Date.parse(remedy.releaseAt) > Date.parse(p.now) && text(remedy.source) ? ok(remedy) : invalid('remedy.releaseAt', 'Supply a realistic future release date and the reviewed plan it came from.');
    if (remedy.type === 'preference-relaxation') {
      const fields = ['type', 'decisionId', 'expectedBriefVersion', 'path', 'value', 'confirmationState', 'confirmedBy', 'confirmedAt', 'briefVersion'];
      if (!only(remedy, fields) || !text(remedy.decisionId, 128) || !Number.isSafeInteger(remedy.expectedBriefVersion) || remedy.expectedBriefVersion < 1
        || !/^preferences\.[^.]+\.value$/.test(remedy.path) || !Object.hasOwn(remedy, 'value')) return invalid('remedy', 'Propose exactly one preference value. Essentials and allowance remain unchanged.');
      const briefs = await tx.list('briefs', { employeeId: renewal.employee.employeeId }); if (briefs.status !== 'ok') return briefs;
      const before = briefs.value.find((b) => b.briefVersion === remedy.expectedBriefVersion);
      if (!before || !Object.hasOwn(before.preferences, remedy.path.split('.')[1])) return invalid('remedy.path', 'Choose a preference in the confirmed employee brief.');
      const decision = await tx.get({ table: 'decisions', key: { runId: context.runId, decisionId: remedy.decisionId } }); if (decision.status !== 'ok') return decision;
      if (decision.value.employeeId !== renewal.employee.employeeId || decision.value.decision !== 'decline') return result('forbidden', { reason: 'A recorded decline for this employee is required.' });
      const current = currentBrief(briefs.value); const change = current?.postDeclineChange;
      const confirmed = confirmedRelaxation(briefs.value, remedy, renewal.employee.principalId);
      if (resolving && !confirmed) return invalid('remedy', 'Paula must confirm the single preference change through her brief before this case can be resolved.', 'employee-confirmation-required');
      return ok({ type: remedy.type, decisionId: remedy.decisionId, expectedBriefVersion: remedy.expectedBriefVersion, path: remedy.path, value: remedy.value,
        confirmationState: confirmed ? 'employee-confirmed' : 'employee-confirmation-required',
        ...(confirmed ? { confirmedBy: change.confirmedBy, confirmedAt: change.confirmedAt, briefVersion: current.briefVersion } : {}) });
    }
    if (remedy.type === 'alternative-car') {
      if (!only(remedy, ['type', 'orderUuid']) || !text(remedy.orderUuid, 128)) return invalid('remedy.orderUuid', 'Choose a current suitable available car.');
      const car = await tx.get({ table: 'stock', key: { runId: context.runId, orderUuid: remedy.orderUuid } }); if (car.status !== 'ok') return car;
      const holds = await tx.list('holds', { orderUuid: remedy.orderUuid }); if (holds.status !== 'ok') return holds;
      const claims = await tx.list('claims', { orderUuid: remedy.orderUuid }); if (claims.status !== 'ok') return claims;
      if (car.value.state !== 'available' || car.value.available === false || car.value.allocated === true || [...holds.value, ...claims.value].some((h) => ['active', 'claim-pending', 'release-pending', 'selection-pending'].includes(h.state))) return invalid('remedy.orderUuid', 'This car is unavailable. Review current stock.');
      const briefs = await tx.list('briefs', { employeeId: renewal.employee.employeeId }); if (briefs.status !== 'ok') return briefs;
      const brief = currentBrief(briefs.value);
      const candidate = car.value.facts?.recommendationCandidate;
      if (projection && (!brief || !candidate || candidate.orderUuid !== car.value.orderUuid || candidate.configurationId !== car.value.configurationId)) return unavailable();
      if (!brief || !candidate || candidate.orderUuid !== car.value.orderUuid || candidate.configurationId !== car.value.configurationId) return invalid('remedy.orderUuid', 'The confirmed brief or exact vehicle facts are missing. Ask the scheme team to check them.');
      const employeeContext = { ...context, ...renewal.employee, roles: ['employee'], runId: context.runId, policyVersion: p.read.policyVersion };
      const employeeFacts = structuredClone(renewal.employee.contract?.manualContext?.employeeFacts ?? {});
      const charging = brief.essentials.charging;
      employeeFacts.charging = { status: charging?.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown', value: charging?.value ?? null,
        unit: null, provenance: { sourceRef: charging?.source ?? 'brief:unresolved', version: String(brief.briefVersion), observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
      const service = createEmployeeRecommendationService({ policy: this.#policy, time: { async now() {
        return ok({ now: p.now, runId: context.runId, clockVersion: p.clockVersion });
      } }, provider: { async resolve() {
        return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: renewal.employee.employeeId, factsVersion: String(renewal.employee.version),
          stockVersion: String(car.value.version), employeeFacts, stock: [candidate] });
      } } });
      const evaluated = await service.recommend(employeeContext, { schemaVersion: 1, briefVersion: brief.briefVersion, preferences: brief.preferences,
        essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) });
      const decision = evaluated.value?.decisions?.[0];
      if (evaluated.status !== 'ok') return projection && evaluated.status === 'invalid' ? unavailable() : evaluated;
      return decision?.suitable ? ok(projection ? { ...remedy, configurationId: car.value.configurationId, snapshot: decision.snapshot } : remedy) : invalid('remedy.orderUuid', 'This car does not satisfy the current eligibility, essential, points and timing constraints.');
    }
    return invalid('remedy.type', 'Choose a supported scheme-team remedy.');
  }
  async update(context, input) {
    const allowed = await this.#authorized(context, true); if (allowed.status !== 'ok') return allowed;
    if (!only(input, ['commandId','caseId','expectedVersion','status','reason','nextAction','dueAt','remedy']) || !text(input.commandId,128)
      || !text(input.caseId,128) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !text(input.reason) || !text(input.nextAction)
      || !validInstant(input.dueAt)) return invalid('update', 'Supply the current version, status, reason, next action and due date.');
    const p = await this.#prepare(context); if (p.error) return p.error;
    if (Date.parse(input.dueAt) <= Date.parse(p.now)) return invalid('dueAt', 'Choose a future due time on the demonstration clock.');
    return this.#repository.transaction(context, { commandId: `case:update:${context.principalId}:${input.commandId}`, inputDigest: inputDigest(input) }, async (tx) => {
      const fresh = await this.#fresh(tx, context, p); if (fresh.status !== 'ok') return fresh;
      const found = await tx.get(ref(context,input.caseId)); if (found.status !== 'ok') return found;
      const c = found.value;
      if (c.version !== input.expectedVersion) return result('stale-version', { expectedVersion: input.expectedVersion, currentVersion: c.version, action: 'refresh' });
      if (!transitions[c.status]?.includes(input.status)) return invalid('status', 'Choose the next permitted case status.');
      const renewal = await this.#renewal(tx, context, c.employeeId); if (renewal.status !== 'ok') return renewal;
      if (renewal.value.renewalId !== c.renewalId) return result('conflict', { reason: 'The current renewal differs from this case. Review the employee contract.' });
      let remedy = input.remedy ?? c.remedy;
      if (input.remedy !== undefined || ['remedy-proposed','resolved'].includes(input.status)) {
        const checked = await this.#remedy(tx, context, renewal.value, p, remedy, input.status === 'resolved'); if (checked.status !== 'ok') return checked;
        remedy = checked.value;
      }
      const changed = await tx.compareAndSwap(ref(context,c.caseId), c.version, { status: input.status, nextAction: input.nextAction, dueAt: input.dueAt,
        remedy, lastUpdatedAt: p.now, history: [...c.history, { at: p.now, actorId: context.principalId, actorRole: p.config.ownerRole, status: input.status,
          reason: input.reason, nextAction: input.nextAction, dueAt: input.dueAt, remedy }] });
      if (changed.status !== 'ok') return changed;
      const queued = await this.#notify(tx,changed.value); return queued.status === 'ok' ? ok({ case: changed.value }) : queued;
    });
  }
  start() {
    this.#start ??= this.#clock.registerHandler({ handlerId: 'renewal-risk-cases', stage: 'pending-reconciliation', handle: (tick) => this.#tick(tick) });
    return this.#start;
  }
  async #tick({ context, now, transaction }) {
    const p = await this.#prepare(context); if (p.error) return p.error;
    if (p.now !== now) return result('stale-version', { reason: 'Clock changed during this tick. Refresh and retry.' });
    return transaction(async (tx) => {
      const fresh = await this.#fresh(tx, context, p); if (fresh.status !== 'ok') return fresh;
      const employees = await tx.list('employees'); if (employees.status !== 'ok') return employees;
      const events = await tx.list('event_receipts'); if (events.status !== 'ok') return events;
      let opened = 0;
      for (const employee of employees.value.filter((e) => e.roles?.includes('employee'))) {
        const renewal = await this.#renewal(tx,context,employee.employeeId);
        if (renewal.status === 'invalid' && renewal.code === 'renewal-context-required') continue;
        if (renewal.status !== 'ok') return renewal;
        const belongs = (r) => r.state === 'completed' && r.outcome?.status === 'ok' && r.outcome.value?.employeeId === employee.employeeId
          && r.outcome.value.renewalId === renewal.value.renewalId && text(r.outcome.value.orderUuid,128) && validInstant(r.outcome.value.occurredAt)
          && Date.parse(r.outcome.value.occurredAt) <= Date.parse(now);
        const triggers = [];
        const actual = deadline(employee);
        if (p.config.deadlineEnabled && actual && Date.parse(actual.instant)-Date.parse(now) <= p.config.withinDays*86400000
          && !events.value.some((e) => p.config.acknowledgedTypes.includes(e.eventType) && belongs(e))) triggers.push({ type: 'renewal-deadline', sourceId: 'deadline:'+renewal.value.renewalId, reason: 'The renewal deadline is close and no selection has been acknowledged.' });
        if (p.config.lifecycleEnabled) for (const event of events.value.filter((e) => p.config.eventTypes.includes(e.eventType) && belongs(e))) triggers.push({
          type: 'lifecycle-exception', eventType: event.eventType, sourceId: `${event.consumerId}:${event.eventId}`, orderUuid: event.outcome.value.orderUuid,
          reason: 'A configured lifecycle exception needs scheme-team review.' });
        for (const trigger of triggers) {
          const eventId = inputDigest([employee.employeeId,renewal.value.renewalId,trigger.sourceId]);
          const receipt = await tx.getReceipt('renewal-case-trigger',eventId);
          if (receipt.status === 'ok') continue;
          if (receipt.status !== 'not-found') return receipt;
          const outcome = await this.#open(tx,context,renewal.value,p,trigger,trigger.reason,'renewal-risk-clock'); if (outcome.status !== 'ok') return outcome;
          const recorded = await tx.recordReceipt({ consumerId: 'renewal-case-trigger',eventId,inputDigest: inputDigest(trigger),eventType: 'renewal-case-opened',
            state: 'completed',outcome: ok({ caseId: outcome.value.case.caseId }),inputVersions: { policy: p.read.policyVersion },createdAt: now,updatedAt: now });
          if (recorded.status !== 'ok') return recorded;
          opened += 1;
        }
      }
      return ok({ opened });
    });
  }
}
export const createRenewalCaseService = (options) => new RenewalCaseService(options);
