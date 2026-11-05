import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { createEmployeeRecommendationService } from '../recommendation/index.js';
import { confirmedFact } from '../../scenarios/employee/index.js';

const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => object(v) && Object.keys(v).every((key) => keys.includes(key));
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const invalid = (field, reason, code = 'invalid-manual-draft') => result('invalid', { code, reasons: [{ field, reason }],
  view: { state: 'validation', editable: true, supportOwner: 'employee', action: 'correct-fields' } });
const unavailable = (source) => result('unavailable', { code: 'manual-source-unavailable', source, retryable: true,
  reason: 'This source is unavailable. Your saved choices have been retained.',
  view: { state: 'unavailable', editable: false, supportOwner: 'scheme-support', action: 'retry' } });
const stale = (resource, expectedVersion, currentVersion) => result('stale-version', {
  resource, expectedVersion, currentVersion, action: 'refresh',
  view: { state: 'conflict', editable: false, supportOwner: 'employee', action: 'refresh-review' } });
const sourceValid = (v) => object(v) && ['synthetic', 'dated-snapshot', 'authorised-live'].includes(v.mode)
  && ['sourceRef', 'sourceVersion', 'schemaVersion'].every((key) => text(v[key]))
  && validInstant(v.effectiveFrom) && validInstant(v.observedAt);
const consumer = (context) => `manual:draft:${context.employeeId}`;
const latest = (rows) => rows.map((r) => r.outcome.value).sort((a, b) => a.draftVersion - b.draftVersion).at(-1) ?? null;
const fields = ['mode', 'oldContractId', 'slotId', 'schemeId', 'driverId', 'contractOptionId', 'requestedCollectionDate',
  'collectionLocationId', 'brand', 'contact', 'expectedReturnMileage', 'specialRequirements'];
const dependencyFields = ['mode', 'oldContractId', 'slotId', 'schemeId', 'driverId', 'contractOptionId',
  'requestedCollectionDate', 'collectionLocationId', 'brand'];

export class ManualContextService {
  #repository; #policy; #clock; #identity; #ports;
  constructor({ repository, policy, clock, identity, ports } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity; this.#ports = ports;
  }

  async #prepare(context) {
    if (!this.#repository || !this.#policy || !this.#clock || !this.#identity || !this.#ports) return { error: unavailable('configuration') };
    const guard = await this.#identity.requireRole(context, 'employee');
    if (guard.status !== 'ok') return { error: guard };
    const clock = await this.#clock.now(context);
    if (clock.status !== 'ok') return { error: clock };
    if (clock.value.runId !== context.runId || !validInstant(clock.value.now)) return { error: unavailable('clock') };
    const read = { runId: context.runId, asOf: clock.value.now, policyVersion: context.policyVersion };
    const p = { now: clock.value.now, clockVersion: clock.value.clockVersion, read };
    try {
      const account = await this.#ports.employeeContract.read(context, read);
      if (account.status === 'not-found') return { ...p, state: 'absent-hr-account', account: null };
      if (account.status !== 'ok') return { error: unavailable('employee-contract') };
      const a = account.value;
      if (!this.#scope(context, a) || !sourceValid(a.source) || !text(a.recordSetId) || !Array.isArray(a.contracts)
        || !Array.isArray(a.histories) || !Array.isArray(a.slots) || !object(a.account)
        || a.account.employeeId !== context.employeeId || ['companyId', 'gradeId', 'schemeId'].some((key) => a.account[key] !== context[key])
        || a.contracts.some((c) => c.employeeId !== context.employeeId || !text(c.contractId) || !text(c.schemeId) || !text(c.slotId))
        || a.slots.some((s) => s.runId !== context.runId || s.employeeId !== context.employeeId)
        || a.histories.some((h) => !text(h.schemeId) || !Array.isArray(h.entries)
          || h.entries.some((e) => e.employeeId !== context.employeeId || e.schemeId !== h.schemeId))) return { error: unavailable('employee-contract-invalid') };
      if (Date.parse(a.source.effectiveFrom) > Date.parse(p.now)) return { error: unavailable('employee-not-effective') };
      p.account = a;
      const drivers = await this.#ports.driver.read(context, read);
      if (drivers.status !== 'ok' || !this.#scope(context, drivers.value) || !sourceValid(drivers.value.source)
        || Date.parse(drivers.value.source.effectiveFrom) > Date.parse(p.now)
        || a.repositoryVersion !== undefined && drivers.value.repositoryVersion !== undefined
          && a.repositoryVersion !== drivers.value.repositoryVersion
        || drivers.value.recordSetId !== a.recordSetId || !Array.isArray(drivers.value.drivers)
        || !object(drivers.value.employeeFacts) || drivers.value.drivers.some((d) => !text(d.driverId) || d.employeeId !== context.employeeId)
        || new Set(drivers.value.drivers.map((d) => d.driverId)).size !== drivers.value.drivers.length) return { error: unavailable('driver') };
      p.drivers = drivers.value;
      const [scheme, collection] = await Promise.all([this.#ports.schemeTerms.read(context, read), this.#ports.collectionRule.read(context, read)]);
      if (scheme.status === 'invalid' && ['unknown-scheme', 'unknown-company', 'unknown-grade'].includes(scheme.code)) return { ...p, state: scheme.code, policyError: scheme };
      if (scheme.status !== 'ok' || collection.status !== 'ok' || scheme.value.policyVersion !== context.policyVersion
        || collection.value.policyVersion !== context.policyVersion || inputDigest(scheme.value.configuration) !== inputDigest(collection.value.configuration)) return { error: unavailable('scheme-collection') };
      p.rules = scheme.value.configuration.value; p.configuration = scheme.value.configuration; p.allowance = scheme.value.allowance;
      if (!this.#validRules(p.rules)) return { error: unavailable('manual-policy-invalid') };
      p.slot = a.slots.find((s) => s.entitlementSlotId === context.entitlementSlotId && s.employeeId === context.employeeId);
      p.contract = a.contracts.find((c) => c.contractId === p.slot?.contractId && c.slotId === p.slot.entitlementSlotId && c.schemeId === context.schemeId) ?? null;
      p.state = !p.rules.enabledSchemes.includes(context.schemeId) ? 'unsupported-scheme'
        : !p.slot || !Number.isSafeInteger(p.slot.capacity) || p.slot.capacity < 1 || p.slot.state === 'disabled' ? 'no-entitlement'
          : p.slot.contractId && !p.contract ? 'no-contract' : 'ready';
      p.contextVersion = inputDigest({ runId: context.runId, employeeId: context.employeeId, schemeId: context.schemeId,
        companyId: context.companyId, gradeId: context.gradeId, slot: p.slot ?? null, accountSource: a.source,
        driverSource: p.drivers.source, repositoryVersion: a.repositoryVersion ?? null, recordSetId: a.recordSetId,
        policyVersion: context.policyVersion, configuration: p.configuration });
      return p;
    } catch { return { error: unavailable('invalid-source') }; }
  }

  #scope(context, value) { return ['runId', 'environmentId', 'employeeId'].every((key) => value?.[key] === context[key]); }
  #validRules(r) {
    return object(r) && Array.isArray(r.enabledSchemes) && Array.isArray(r.brands) && Array.isArray(r.contractOptions)
      && r.contractOptions.every((c) => text(c.contractOptionId) && Array.isArray(c.schemeIds) && Array.isArray(c.driverKinds)
        && Number.isSafeInteger(c.months) && c.months > 0 && Number.isSafeInteger(c.annualMileage) && c.annualMileage > 0 && c.mileageUnit === 'mi/year')
      && Array.isArray(r.locations) && r.locations.every((l) => text(l.locationId) && Array.isArray(l.contractOptionIds) && Array.isArray(l.driverKinds))
      && Number.isSafeInteger(r.minimumLeadDays) && r.minimumLeadDays >= 0 && Number.isSafeInteger(r.maximumLeadDays) && r.maximumLeadDays >= r.minimumLeadDays
      && Number.isSafeInteger(r.maximumSpecialRequirements) && r.maximumSpecialRequirements > 0
      && Number.isSafeInteger(r.maximumReturnMileage) && r.maximumReturnMileage > 0 && object(r.insuranceMaximumByGrade);
  }
  #presentation(p) {
    const orderable = p.state === 'ready';
    return { state: p.state, editable: orderable, supportOwner: orderable ? 'employee' : 'scheme-support',
      action: orderable ? 'choose-order-options' : 'contact-support',
      fields: { account: { editable: false, supportOwner: 'hr-support' }, licence: { editable: false, supportOwner: 'driver-support' },
        driver: { editable: orderable, supportOwner: 'driver-support' }, contract: { editable: orderable, supportOwner: 'scheme-support' },
        collection: { editable: orderable, supportOwner: 'collection-support' }, contact: { editable: orderable, supportOwner: 'employee' },
        expectedReturnMileage: { editable: orderable, supportOwner: 'employee' }, specialRequirements: { editable: orderable, supportOwner: 'employee' } } };
  }
  #projection(context, p) {
    const view = this.#presentation(p);
    if (!p.account) return { state: p.state, account: null, drivers: [], histories: [], actions: [], view };
    const actions = p.state === 'ready' ? [{ action: p.contract ? 'replace' : 'order', slotId: p.slot.entitlementSlotId,
      schemeId: context.schemeId, oldContractId: p.contract?.contractId ?? null, enabled: true }] : [];
    return { state: p.state, account: p.account.account, drivers: p.drivers.drivers,
      currentContract: p.contract ?? null, contractState: p.contract ? 'current-contract' : 'no-contract', histories: p.account.histories.map((h) => ({ ...h,
        state: h.entries.length ? 'history' : 'empty-history', count: h.entries.length,
        orderingSupported: p.rules?.enabledSchemes.includes(h.schemeId) ?? false })), actions,
      choices: p.rules ? { schemeId: context.schemeId, slotId: p.slot?.entitlementSlotId ?? null,
        drivers: p.drivers.drivers.map(({ driverId, name, kind }) => ({ driverId, name, kind })),
        contractOptions: p.rules.contractOptions, collectionLocations: p.rules.locations, brands: p.rules.brands } : null,
      allowance: p.allowance ?? null, assumptions: p.configuration ? [p.configuration] : [], contextVersion: p.contextVersion ?? null,
      versions: { policy: context.policyVersion, employeeContract: p.account.source, driver: p.drivers.source, recordSetId: p.account.recordSetId,
        employee: p.account.repositoryVersion ?? null,
        slot: p.slot?.version ?? null, clock: p.clockVersion }, view };
  }
  async readAccount(context) {
    const p = await this.#prepare(context);
    return p.error ?? ok(this.#projection(context, p));
  }
  async readDraft(context) {
    const p = await this.#prepare(context); if (p.error) return p.error;
    const rows = await this.#repository.query(context, 'event_receipts', { consumerId: consumer(context) });
    if (rows.status !== 'ok') return rows;
    const draft = latest(rows.value);
    if (!draft) return result('not-found', { resourceType: 'manual-draft' });
    const changed = draft.contextVersion !== p.contextVersion;
    return ok({ ...draft, requiresRefresh: changed,
      invalidations: changed ? [...new Set([...draft.invalidations, 'context', 'selection', 'quote', 'eligible-stock'])] : draft.invalidations,
      selection: changed ? null : draft.selection, quote: changed ? null : draft.quote,
      view: changed ? { state: 'context-changed', editable: false, supportOwner: 'employee', action: 'refresh-review' } : draft.view });
  }

  #validate(context, choices, p) {
    if (!only(choices, fields) || !['new', 'replacement'].includes(choices.mode)) return invalid('choices', 'Supply registered manual choices and new or replacement mode.');
    if (choices.schemeId !== context.schemeId || choices.slotId !== context.entitlementSlotId || choices.slotId !== p.slot.entitlementSlotId) return invalid('choices', 'Choose the server-owned scheme and entitled vehicle slot.', 'authority-override');
    if (choices.mode === 'replacement' && (!p.contract || choices.oldContractId !== p.contract.contractId)
      || choices.mode === 'new' && (p.contract || choices.oldContractId != null)) return invalid('oldContractId', 'Keep the current contract separate; use the permitted Order or Replace action.');
    const driver = p.drivers.drivers.find((d) => d.driverId === choices.driverId);
    if (!driver) return invalid('driverId', 'Choose a supplied permitted driver.');
    const contract = p.rules.contractOptions.find((c) => c.contractOptionId === choices.contractOptionId && c.schemeIds.includes(context.schemeId) && c.driverKinds.includes(driver.kind));
    if (!contract) return invalid('contractOptionId', 'Choose a permitted term and annual-mileage combination.');
    if (!p.rules.brands.includes(choices.brand)) return invalid('brand', 'Choose a supported ordering brand.');
    const location = p.rules.locations.find((l) => l.locationId === choices.collectionLocationId
      && l.contractOptionIds.includes(contract.contractOptionId) && l.driverKinds.includes(driver.kind));
    if (!location) return invalid('collectionLocationId', 'This location is not permitted for the selected driver and contract.');
    if (typeof choices.requestedCollectionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(choices.requestedCollectionDate)
      || !validInstant(`${choices.requestedCollectionDate}T00:00:00.000Z`)) return invalid('requestedCollectionDate', 'Supply a valid requested collection date.');
    const date = Date.parse(`${choices.requestedCollectionDate}T00:00:00.000Z`);
    const today = Date.parse(`${p.now.slice(0, 10)}T00:00:00.000Z`); const day = 86400000;
    if (date < today + p.rules.minimumLeadDays * day || date > today + p.rules.maximumLeadDays * day
      || p.contract?.earliestCollectionDate && date < Date.parse(`${p.contract.earliestCollectionDate}T00:00:00.000Z`)
      || p.contract?.latestCollectionDate && date > Date.parse(`${p.contract.latestCollectionDate}T00:00:00.000Z`)
      || location.closedDates?.includes(choices.requestedCollectionDate)) return invalid('requestedCollectionDate', 'Choose a date inside the supplied collection and renewal window.');
    if (!only(choices.contact, ['phone', 'email']) || !/^\+?[0-9 ()-]{7,30}$/.test(choices.contact.phone ?? '')
      || typeof choices.contact.email !== 'string' || choices.contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(choices.contact.email)) return invalid('contact', 'Supply a contact telephone and email address.');
    if (choices.mode === 'replacement' && (!Number.isSafeInteger(choices.expectedReturnMileage) || choices.expectedReturnMileage < 0
      || choices.expectedReturnMileage > p.rules.maximumReturnMileage)
      || choices.mode === 'new' && choices.expectedReturnMileage != null) return invalid('expectedReturnMileage', 'Supply returning-car mileage only for a replacement, in miles.');
    if (typeof choices.specialRequirements !== 'string' || choices.specialRequirements.length > p.rules.maximumSpecialRequirements
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(choices.specialRequirements)) return invalid('specialRequirements', `Use at most ${p.rules.maximumSpecialRequirements} characters. Requests do not change released stock.`);
    return { driver, contract, location };
  }

  async saveDraft(context, input) {
    if (!this.#repository || !this.#identity) return unavailable('configuration');
    const guard = await this.#identity.requireRole(context, 'employee'); if (guard.status !== 'ok') return guard;
    if (!only(input, ['commandId', 'expectedDraftVersion', 'expectedContextVersion', 'choices']) || !text(input.commandId)
      || input.commandId.length > 128 || !revision(input.expectedDraftVersion) || !text(input.expectedContextVersion)) return invalid('command', 'Supply a command ID, expected draft and context versions.');
    let digest;
    try { digest = inputDigest(input); } catch { return invalid('command', 'Supply JSON data for the registered manual fields.'); }
    const commandId = `manual:${context.employeeId}:${input.commandId}`;
    // Recover a committed outcome before mutable sources or collection dates can reject
    // an identical retry. Trusted identity/current-run checks still precede receipt access.
    const replay = await this.#repository.read(context, { table: 'event_receipts', key: {
      runId: context.runId, consumerId: 'command:transaction', eventId: commandId } });
    if (replay.status === 'ok') return replay.value.inputDigest === digest ? structuredClone(replay.value.outcome)
      : result('conflict', { reason: 'idempotency-input-changed', current: {} });
    if (replay.status !== 'not-found') return replay;
    const p = await this.#prepare(context);
    return this.#repository.transaction(context, { commandId, inputDigest: digest }, async (tx) => {
      // The repository resolves a concurrent committed replay before this callback.
      // All provider reads stay outside its transaction; mutable refusals occur here.
      if (p.error) return p.error;
      if (p.state !== 'ready') return result('conflict', { reason: p.state, view: this.#presentation(p) });
      if (input.expectedContextVersion !== p.contextVersion) return stale('manual-context', input.expectedContextVersion, p.contextVersion);
      const validated = this.#validate(context, input.choices, p);
      if (validated.status) return validated;
      // Conditional local source checks close the read-to-write race for this adapter.
      // External providers retain their own versioned snapshot and are revalidated at claim.
      if (p.account.repositoryVersion !== undefined) {
        const employee = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
        if (employee.status !== 'ok') return employee;
        if (employee.value.version !== p.account.repositoryVersion) return stale('employee-context', p.account.repositoryVersion, employee.value.version);
      }
      const slot = await tx.get({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } });
      if (slot.status !== 'ok') return slot;
      if (slot.value.version !== p.slot.version) return stale('entitlement-slot', p.slot.version, slot.value.version);
      const rows = await tx.list('event_receipts', { consumerId: consumer(context) }); if (rows.status !== 'ok') return rows;
      const previous = latest(rows.value); const version = previous?.draftVersion ?? 0;
      if (input.expectedDraftVersion !== version) return stale('manual-draft', input.expectedDraftVersion, version);
      const changes = previous ? dependencyFields.filter((key) => inputDigest(previous.choices[key] ?? null) !== inputDigest(input.choices[key] ?? null)) : [];
      if (previous && previous.contextVersion !== p.contextVersion) changes.push('context');
      const invalidations = changes.length ? [...changes, 'selection', 'quote', 'eligible-stock'] : [];
      const value = { schemaVersion: 1, runId: context.runId, employeeId: context.employeeId, draftVersion: version + 1,
        previousDraftVersion: version || null, contextVersion: p.contextVersion, choices: structuredClone(input.choices),
        currentContract: p.contract, renewalId: p.slot.renewalId ?? null, entitlementSlotId: p.slot.entitlementSlotId,
        contract: validated.contract, sources: this.#projection(context, p).versions, policyVersion: context.policyVersion,
        invalidations, dependentGeneration: (previous?.dependentGeneration ?? 0) + (changes.length ? 1 : 0),
        selection: changes.length ? null : previous?.selection ?? null, quote: changes.length ? null : previous?.quote ?? null,
        savedAt: p.now, savedBy: context.principalId, view: { state: 'draft', editable: true, supportOwner: 'employee', action: 'browse-stock' } };
      const stored = await tx.recordReceipt({ consumerId: consumer(context), eventId: String(value.draftVersion), inputDigest: digest,
        eventType: 'manual-draft-saved', state: 'completed', outcome: ok(value) });
      return stored.status === 'ok' ? ok(value) : stored;
    });
  }

  async browseStock(context) {
    const p = await this.#prepare(context); if (p.error) return p.error;
    if (p.state !== 'ready') return result('conflict', { reason: p.state, view: this.#presentation(p) });
    const saved = await this.readDraft(context); if (saved.status !== 'ok') return saved;
    if (saved.value.requiresRefresh || saved.value.contextVersion !== p.contextVersion) return stale('manual-context', saved.value.contextVersion, p.contextVersion);
    const draft = saved.value; const selected = this.#validate(context, draft.choices, p); if (selected.status) return selected;
    try {
      const source = await this.#ports.releasedStock.read(context, p.read);
      if (source.status !== 'ok' || !this.#scope(context, source.value) || !text(source.value.sourceVersion)
        || !Array.isArray(source.value.stock) || source.value.stock.some((r) => !/^\d{7}$/.test(r.orderNumber ?? ''))) return unavailable('released-stock');
      const facts = { ...p.drivers.employeeFacts, driverEligible: selected.driver.eligible };
      const evaluator = createEmployeeRecommendationService({ policy: this.#policy, time: this.#clock, provider: { async resolve() {
        return ok({ ...source.value, factsVersion: inputDigest({ employee: p.account.source, driver: p.drivers.source, driverId: selected.driver.driverId }),
          stockVersion: source.value.sourceVersion, employeeFacts: facts });
      } } });
      const checked = await evaluator.recommend(context, { schemaVersion: 1, briefVersion: draft.draftVersion, preferences: {}, essentials: {},
        requiredBy: `${draft.choices.requestedCollectionDate}T23:59:59.999Z` });
      if (checked.status !== 'ok') return checked;
      const calibration = await this.#policy.getAssumption('employee.recommendation.v1', p.read);
      if (calibration.status !== 'ok') return unavailable('policy');
      const decisions = checked.value.decisions.map((decision) => {
        const maximum = p.rules.insuranceMaximumByGrade[context.gradeId];
        const insurance = decision.snapshot.facts.insuranceGroup;
        const unknowns = [...decision.unknowns]; const blockers = [...decision.blockers];
        const licence = selected.driver.licence;
        if (!sourceValid(licence?.source) || !validInstant(`${licence?.validFrom}T00:00:00.000Z`)
          || !validInstant(`${licence?.validUntil}T00:00:00.000Z`) || !Array.isArray(licence.categories)) unknowns.push({ code: 'licence-unconfirmed' });
        else if (licence.validFrom > draft.choices.requestedCollectionDate || licence.validUntil < draft.choices.requestedCollectionDate
          || !licence.categories.includes('car')) blockers.push({ code: 'licence-not-valid-at-collection' });
        if (!Number.isFinite(maximum) || !confirmedFact(insurance, calibration.value.value) || !Number.isFinite(insurance.value)) unknowns.push({ code: 'insurance-unconfirmed' });
        else if (insurance.value > maximum) blockers.push({ code: 'insurance-grade-limit', maximum, actual: insurance.value, assumptionKey: 'manual.context.v1' });
        const gateStatus = blockers.length ? 'ineligible' : unknowns.length ? 'needs-confirmation' : 'eligible';
        const record = source.value.stock.find((row) => row.orderUuid === decision.orderUuid);
        return { ...decision, score: null, components: [], gateStatus, suitable: gateStatus === 'eligible', blockers, unknowns,
          orderNumber: record.orderNumber, draftVersion: draft.draftVersion,
          view: { state: gateStatus, editable: false, supportOwner: gateStatus === 'needs-confirmation' ? 'scheme-support' : 'employee',
            action: gateStatus === 'eligible' ? 'review-car' : gateStatus === 'needs-confirmation' ? 'request-confirmation' : 'choose-another-car' } };
      });
      const eligible = decisions.filter((d) => d.gateStatus === 'eligible').sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
      return ok({ state: decisions.length ? eligible.length ? 'available-stock' : 'no-eligible-stock' : 'empty-stock',
        decisions, cars: eligible, total: eligible.length, ranked: false, browsingReservesStock: false,
        versions: { ...checked.value.versions, draft: draft.draftVersion, context: p.contextVersion },
        assumptions: [p.configuration], view: { state: eligible.length ? 'available' : 'empty', editable: false, supportOwner: 'scheme-support',
          action: eligible.length ? 'review-car' : 'retry-or-contact-support' } });
    } catch { return unavailable('released-stock-invalid'); }
  }
}

export const createManualContextService = (options) => new ManualContextService(options);
export { createRepositoryManualPorts } from './ports.js';
