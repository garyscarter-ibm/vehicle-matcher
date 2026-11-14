import { createVehicleSnapshot, createEmployeeTerms, freezeVehicleData, reusableVehicleSnapshot } from '../../vehicles/index.js';
import { validInstant } from '../policy/file-provider.js';
import { currentCarRatingValid } from '../brief/rating.js';
import { sameAgainValid } from '../brief/same-again.js';
import { validateBrief, validateBriefContent, evaluateEssentials, scorePreferences, rankEmployeeRecommendations, confirmedFact, chargingGates, unselectedPracticalAnswer } from '../../scenarios/employee/index.js';
import { FEEDBACK_KEY, baselineOf, feedbackPolicyValid, ratingClass, matchDimensions, compareImprovement } from './current-car.js';

const result = (status, fields) => ({ status, ...fields, contractVersion: '1.0.0' });
const unavailable = (code) => result('unavailable', { code, reason: 'The employee recommendation source is unavailable.', retryable: true });
const invalid = (code, reasons) => result('invalid', { code, reasons });
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).every((key) => keys.includes(key));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const refused = () => result('stale-run', { reason: 'The supplied employee data does not belong to this current context.' });

// Brief schema v1 fixes the public slider scale; conflicting policy configuration fails closed.
function configurationValid(config, slider) {
  return typeof config?.driverEligibilityRequired === 'boolean' && config.retailBudgetEnabled === false && Number.isSafeInteger(config.displayLimit) && config.displayLimit > 0
    && Number.isFinite(config.termValiditySeconds) && config.termValiditySeconds > 0
    && ['confirmedAssurances', 'plugInFuels', 'chargingAccess', 'availabilityStates'].every((key) => Array.isArray(config[key]) && config[key].every(text))
    && config.preferences && config.essentials && config.tuning?.weights && config.tuning?.hardFilter
    && Number.isFinite(slider.minimum) && Number.isFinite(slider.maximum) && slider.minimum === 0 && slider.maximum === 100;
}

const plainDataRecord = (value) => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every((key) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));

function cloneSource(source) {
  if (!plainDataRecord(source)) return structuredClone(source);
  const stock = Object.getOwnPropertyDescriptor(source, 'stock');
  if (!stock?.enumerable || !Object.hasOwn(stock, 'value') || !Array.isArray(stock.value)) return structuredClone(source);
  if (Object.getPrototypeOf(stock.value) !== Array.prototype || Reflect.ownKeys(stock.value).some((key) => key !== 'length'
    && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= stock.value.length
      || !Object.getOwnPropertyDescriptor(stock.value, key).enumerable
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(stock.value, key), 'value')))) return structuredClone(source);
  if (!stock.value.every(plainDataRecord)) return structuredClone(source);
  const snapshots = stock.value.map((row) => {
    const snapshot = Object.getOwnPropertyDescriptor(row, 'snapshot');
    return snapshot?.enumerable && Object.hasOwn(snapshot, 'value') ? reusableVehicleSnapshot(snapshot.value) : undefined;
  });
  if (!snapshots.some(Boolean)) return structuredClone(source);
  // Exclude only admitted snapshot graphs; clone all employee and operational facts together as before.
  const copy = structuredClone({ ...source, stock: stock.value.map((row, index) => snapshots[index] ? { ...row, snapshot: null } : row) });
  snapshots.forEach((snapshot, index) => { if (snapshot) copy.stock[index].snapshot = snapshot; });
  return copy;
}

function validateSource(source) {
  if (!text(source?.factsVersion) || !text(source.stockVersion) || !source.employeeFacts || typeof source.employeeFacts !== 'object' || Array.isArray(source.employeeFacts) || !Array.isArray(source.stock)) throw Error('Invalid provider facts');
  const seen = new Set();
  return source.stock.map((row) => {
    if (!uuid(row.orderUuid) || !text(row.configurationId) || seen.has(row.orderUuid) || !row.availability || !text(row.availability.version)) throw Error('Invalid exact stock');
    seen.add(row.orderUuid);
    const snapshot = createVehicleSnapshot(row.snapshot);
    if (snapshot.identityKind !== 'exact-stock' || snapshot.sourceKeys.stockId !== row.orderUuid || snapshot.vin !== undefined) throw Error('Invalid stock identity');
    return { orderUuid: row.orderUuid, configurationId: row.configurationId, snapshot, availability: structuredClone(row.availability) };
  });
}

function timingGates(candidate, employeeFacts, brief, now, config) {
  const blockers = []; const unknowns = []; const reasons = [];
  const available = candidate.availability;
  if (!config.availabilityStates.includes(available.state)) throw Error('Unsupported stock availability');
  if (available.state === 'unknown') unknowns.push({ code: 'availability-unconfirmed', availability: available });
  else if (available.state !== 'available') blockers.push({ code: 'not-available', availability: available });
  for (const key of ['availableFrom', 'availableUntil']) {
    if (!validInstant(available[key])) unknowns.push({ code: 'availability-date-unconfirmed', field: key });
  }
  const from = Date.parse(available.availableFrom); const until = Date.parse(available.availableUntil);
  if (Number.isFinite(from) && Number.isFinite(until) && from >= until) throw Error('Invalid availability interval');
  const required = employeeFacts.requiredBy;
  if (!confirmedFact(required, config) || !validInstant(required.value)) unknowns.push({ code: 'required-by-unconfirmed', fact: required ?? null });
  else {
    const deadline = Math.min(Date.parse(required.value), brief.requiredBy ? Date.parse(brief.requiredBy) : Infinity);
    if (from > deadline || Date.parse(now) > deadline) blockers.push({ code: 'required-by', requiredBy: new Date(deadline).toISOString(), availableFrom: available.availableFrom });
    else reasons.push({ code: 'required-by-met', requiredBy: new Date(deadline).toISOString() });
  }
  if (Date.parse(now) >= until) blockers.push({ code: 'availability-expired', availableUntil: available.availableUntil });
  if (from > Date.parse(now)) blockers.push({ code: 'not-yet-available', availableFrom: available.availableFrom });
  return { blockers, unknowns, reasons };
}

const EMPTY_SCORES = { score: null, components: [], reasons: [], tradeOffs: [], unknowns: [] };
const typedFields = ['currentCarRating', 'sameAgain'];
const typedValid = { currentCarRating: currentCarRatingValid, sameAgain: sameAgainValid };
const plainRequest = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

// Typed feedback only gates which cars stay in the shortlist; gates have already passed for any car reaching here.
function judgeFeedback({ fb, gated, candidate, scored, brief, employeeFacts, config, slider }) {
  const { policy: rules, rating, sameOn, usable, baseline } = fb;
  const facts = candidate.snapshot.facts;
  const base = { policyKey: FEEDBACK_KEY, policyVersion: fb.policyVersion, applied: true, rating: { value: rating.value, class: usable.rating ? ratingClass(rating.value, rules.rating) : 'neutral' },
    sameAgain: sameOn, baseline: baseline ? { contractId: baseline.contractId, sourceVersion: baseline.source.sourceVersion } : null,
    similarity: null, improvement: null, continuity: null, effect: 'none', reasonCode: fb.inertCode };
  if (gated) return { record: { ...base, reasonCode: 'gate-not-passed' }, reasons: [] };
  if (!baseline || !(sameOn || usable.rating)) return { record: base, reasons: [] };
  const dims = rules.similarity.dimensions;
  if (sameOn) {
    const continuity = matchDimensions(baseline.facts, facts, rules.sameAgain.dimensions, config, 'same', candidate.configurationId);
    const record = { ...base, continuity, similarity: matchDimensions(baseline.facts, facts, dims, config, 'similar') };
    return continuity === 'same'
      ? { record: { ...record, effect: 'kept', reasonCode: 'same-again-match' }, reasons: [{ code: 'same-again-match', keys: rules.sameAgain.dimensions }] }
      : { record: { ...record, effect: 'omitted', reasonCode: 'same-again-different' }, omit: { code: 'same-again-different', keys: rules.sameAgain.dimensions } };
  }
  const similarity = matchDimensions(baseline.facts, facts, dims, config, 'similar');
  const record = { ...base, similarity };
  if (base.rating.class === 'negative') {
    return similarity === 'similar'
      ? { record: { ...record, effect: 'omitted', reasonCode: 'feedback-similar-omitted' }, omit: { code: 'feedback-similar-omitted', keys: dims } }
      : { record: { ...record, effect: 'kept', reasonCode: similarity === 'unknown' ? 'feedback-similarity-unknown' : 'feedback-different' },
        reasons: similarity === 'different' ? [{ code: 'feedback-different', keys: dims }] : [] };
  }
  if (base.rating.class !== 'positive') return { record, reasons: [] };
  if (similarity === 'similar') return { record: { ...record, effect: 'kept', reasonCode: 'feedback-similar' }, reasons: [{ code: 'feedback-similar', keys: dims }] };
  const better = compareImprovement({ snapshot: candidate.snapshot, scored, baseline, brief, employeeFacts, config, slider, rule: rules.improvement });
  if (better.result === 'proven') return { record: { ...record, improvement: 'proven', effect: 'kept', reasonCode: 'feedback-improvement' }, reasons: [{ code: 'feedback-improvement', keys: better.keys }] };
  return { record: { ...record, improvement: better.result, effect: 'omitted', reasonCode: 'feedback-not-similar-or-better' }, omit: { code: 'feedback-not-similar-or-better', keys: dims } };
}

function evaluateRecommendation(ports, context, request, preview = null) {
  const work = () => evaluateScopedRecommendation(ports, context, request, preview);
  return typeof ports.policy?.withReadScope === 'function' ? ports.policy.withReadScope(work) : work();
}

async function evaluateScopedRecommendation({ provider, policy, time }, context, request, preview = null) {
      if (!provider || typeof provider.resolve !== 'function' || !policy || typeof time?.now !== 'function') return unavailable('provider-not-configured');
      if (!['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion'].every((key) => text(context[key]))) return invalid('invalid-context', [{ field: 'context', reason: 'The server must resolve a complete employee context.' }]);
      try {
        const clock = await time.now(context);
        if (clock?.status === 'stale-run') return clock;
        if (clock?.status !== 'ok' || !validInstant(clock.value?.now) || !text(clock.value.clockVersion)) return unavailable('clock-unavailable');
        if (clock.value.runId !== context.runId) return refused();
        const now = new Date(clock.value.now).toISOString();
        const read = { runId: context.runId, asOf: now, policyVersion: context.policyVersion };
        const allowance = await policy.getAllowance(context, read);
        if (allowance.status === 'invalid' && ['unknown-scheme', 'unknown-company', 'unknown-grade', 'invalid-context', 'run-mismatch'].includes(allowance.code)) return allowance;
        if (allowance.status !== 'ok') return unavailable('allowance-unavailable');
        const assumptionResults = await Promise.all(['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum',
          'eligibility.homeCharging.requiredForPlugIn'].map((key) => policy.getAssumption(key, read)));
        if (assumptionResults.some((row) => row.status !== 'ok' || row.policyVersion !== allowance.policyVersion)) return unavailable('policy-configuration-unavailable');
        const [calibration, minimum, maximum, charging] = assumptionResults.map((row) => row.value);
        const config = calibration.value; const slider = { minimum: minimum.value, maximum: maximum.value };
        if (!configurationValid(config, slider) || typeof charging.value !== 'boolean') return unavailable('policy-configuration-invalid');
        // Typed current-car feedback rides beside the brief; the strict brief validator never sees it.
        const typed = {}; let content = request;
        if (!preview && plainRequest(request)) {
          content = Object.fromEntries(Object.entries(request).filter(([key]) => !typedFields.includes(key)));
          for (const key of typedFields) if (Object.hasOwn(request, key)) typed[key] = request[key];
        } else if (preview) for (const key of typedFields) if (preview.original[key] !== undefined) typed[key] = preview.original[key];
        const typedErrors = Object.keys(typed).filter((key) => !typedValid[key](typed[key]))
          .map((field) => ({ field, reason: 'Unsupported or invalid current-car feedback.' }));
        let errors = preview ? validateBriefContent(request, config, slider) : validateBrief(content, config, slider);
        if (preview) {
          const lifecycle = await policy.getAssumption('brief.lifecycle.v1', read);
          if (lifecycle.status !== 'ok' || lifecycle.policyVersion !== allowance.policyVersion
            || !Array.isArray(lifecycle.value?.value?.charging?.values)) return unavailable('policy-configuration-unavailable');
          assumptionResults.push(lifecycle);
          const { currentCarFeedback, currentCarRating, sameAgain, ...content } = preview.original;
          errors = validateBriefContent(content, { ...config, essentials: { ...config.essentials, charging: lifecycle.value.value.charging } }, slider);
        }
        if (errors.length || typedErrors.length) return invalid('invalid-brief', [...errors, ...typedErrors]);
        const brief = structuredClone(content);
        if (preview) {
          for (const p of Object.values(brief.preferences)) {
            if (p.source === 'employee' && p.valueState === 'draft') p.valueState = 'confirmed';
            if (p.source === 'employee' && p.importanceState === 'draft') p.importanceState = 'confirmed';
          }
          for (const e of Object.values(brief.essentials)) if (e.source === 'employee' && e.state === 'draft') e.state = 'confirmed';
        }
        const briefVersion = preview ? preview.baseBriefVersion || null : brief.briefVersion;
        const provided = await provider.resolve(context);
        if (provided?.status === 'stale-run' || provided?.status === 'forbidden') return provided;
        if (provided?.status !== 'ok') return unavailable('employee-source-unavailable');
        const source = cloneSource(provided.value);
        if (['runId', 'environmentId', 'employeeId'].some((key) => source?.[key] !== context[key])) return refused();
        const candidates = validateSource(source);
        if (preview && !unselectedPracticalAnswer(preview.charging)) {
          const answer = preview.charging;
          const known = answer && answer.value !== null && (answer.state === 'confirmed' || answer.state === 'draft' && answer.source === 'employee');
          source.employeeFacts.charging = { status: known ? 'known' : 'unknown', value: known ? answer.value : null,
            provenance: { sourceRef: 'employee-preview:charging', version: `draft:${preview.baseDraftVersion}`,
              observedAt: now, assurance: 'synthetic-scenario' }, preview: { kind: 'unsaved-draft', approved: false } };
        }
        // Feedback is read at the same policy read, only when the request carries it; otherwise nothing changes.
        let fb = null; let feedbackRecord = null;
        if (Object.keys(typed).length) {
          const row = await policy.getAssumption(FEEDBACK_KEY, read);
          if (row.status !== 'ok' || row.policyVersion !== allowance.policyVersion || !feedbackPolicyValid(row.value?.value)) {
            if (typed.sameAgain?.on === true || typed.currentCarRating?.value != null) return unavailable('feedback-policy-unavailable');
            feedbackRecord = { applied: false, reason: 'feedback-policy-unavailable' };
          } else {
            assumptionResults.push(row);
            const baseline = baselineOf(source.currentCar);
            const matches = (entry) => entry !== undefined && baseline !== null && entry.contractId === baseline.contractId;
            const rating = typed.currentCarRating ?? { value: null };
            if (!baseline && (typed.sameAgain?.on === true || ratingClass(rating.value, row.value.value.rating) === 'positive'))
              return unavailable('feedback-baseline-unavailable');
            const usable = { rating: matches(typed.currentCarRating), sameAgain: matches(typed.sameAgain) };
            const inertCode = !baseline ? 'feedback-baseline-unavailable' : Object.keys(typed).some((key) => !matches(typed[key])) ? 'feedback-contract-mismatch' : 'feedback-neutral';
            fb = { policy: row.value.value, policyVersion: row.policyVersion, baseline, rating, usable, inertCode,
              sameOn: usable.sameAgain && typed.sameAgain.on === true,
              identity: `${FEEDBACK_KEY}@${row.policyVersion}${baseline ? `+${baseline.source.sourceVersion}` : ''}` };
          }
        }
        const providerEssentials = source.employeeFacts.essentials;
        if (providerEssentials !== undefined && validateBriefContent({ schemaVersion: 1, preferences: {}, essentials: providerEssentials }, config, slider).length) return unavailable('employee-facts-invalid');
        const decisions = [];
        for (const candidate of candidates) {
          const matchFacts = Object.fromEntries(Object.entries(candidate.snapshot.facts).filter(([, fact]) => fact.status === 'known').map(([key, fact]) => [key, fact.value]));
          const car = { ...matchFacts, configurationId: candidate.configurationId };
          const eligibility = await policy.getEligibility(context, car, read);
          const points = await policy.getPointsCost(context, car, read);
          if (eligibility.status !== 'ok' || !['ok', 'not-found'].includes(points.status)
            || eligibility.policyVersion !== allowance.policyVersion || points.policyVersion !== allowance.policyVersion) return unavailable('candidate-policy-unavailable');
          const blockers = []; const unknowns = []; const reasons = [];
          if (providerEssentials === undefined) unknowns.push({ code: 'employee-essentials-unconfirmed' });
          if (config.driverEligibilityRequired) {
            const driver = source.employeeFacts.driverEligible;
            if (!confirmedFact(driver, config) || typeof driver.value !== 'boolean') unknowns.push({ code: 'driver-unconfirmed', fact: driver ?? null });
            else (driver.value ? reasons : blockers).push({ code: driver.value ? 'driver-eligible' : 'driver-ineligible', fact: driver });
          }
          if (eligibility.value.state === 'ineligible') blockers.push({ code: 'policy-exclude', ruleIds: eligibility.value.ruleIds });
          else if (eligibility.value.state !== 'eligible') unknowns.push({ code: 'eligibility-unconfirmed', reasons: eligibility.value.reasons });
          else reasons.push({ code: 'policy-include', ruleIds: eligibility.value.ruleIds });
          let terms = null;
          if (points.status !== 'ok') unknowns.push({ code: 'points-unavailable', configurationId: candidate.configurationId });
          else {
            const affordable = allowance.value.monthlyPoints >= points.value.monthlyPoints;
            (affordable ? reasons : blockers).push({ code: affordable ? 'allowance-sufficient' : 'allowance-exceeded',
              allowance: allowance.value.monthlyPoints, monthlyPoints: points.value.monthlyPoints, unit: 'points/month' });
            terms = createEmployeeTerms({ termsVersion: `${allowance.policyVersion}:${points.value.priceEntryId}:${allowance.value.allowanceId}:${now}`,
              points: { value: points.value.monthlyPoints, unit: 'points' }, allowanceInputs: { allowance: { value: allowance.value.monthlyPoints, unit: 'points' } },
              contribution: null, validFrom: now, validUntil: new Date(Date.parse(now) + config.termValiditySeconds * 1000).toISOString(),
              provenance: { sourceRef: points.value.source, version: allowance.policyVersion, observedAt: now,
                assurance: points.value.status === 'assumed' ? 'synthetic-scenario' : 'derived' } });
          }
          const providerGates = evaluateEssentials(candidate.snapshot, { essentials: providerEssentials ?? {} }, config);
          for (const entries of Object.values(providerGates)) entries.forEach((entry) => { entry.authority = 'employee-provider'; });
          for (const gate of [providerGates, evaluateEssentials(candidate.snapshot, brief, config, { optionalDefaults: true }), timingGates(candidate, source.employeeFacts, brief, now, config),
            chargingGates(candidate.snapshot, source.employeeFacts, config, charging.value)]) {
            blockers.push(...gate.blockers); unknowns.push(...gate.unknowns); reasons.push(...gate.reasons);
          }
          let gateStatus = blockers.length ? 'ineligible' : unknowns.length ? 'needs-confirmation' : 'eligible';
          let scores = gateStatus === 'eligible' ? scorePreferences(candidate.snapshot, brief, source.employeeFacts, config, slider) : EMPTY_SCORES;
          let feedback = feedbackRecord;
          if (fb) {
            const judged = judgeFeedback({ fb, gated: gateStatus !== 'eligible', candidate, scored: scores, brief, employeeFacts: source.employeeFacts, config, slider });
            feedback = judged.record;
            if (judged.omit) { blockers.push(judged.omit); gateStatus = 'ineligible'; scores = EMPTY_SCORES; }
            else {
              reasons.push(...(judged.reasons ?? []));
              if (fb.sameOn && fb.baseline) scores = EMPTY_SCORES;
            }
          }
          decisions.push({ candidateKey: candidate.snapshot.candidateKey, orderUuid: candidate.orderUuid, configurationId: candidate.configurationId,
            gateStatus, suitable: gateStatus === 'eligible', evaluatedAt: now, score: scores.score, components: scores.components,
            reasons: [...reasons, ...scores.reasons], tradeOffs: scores.tradeOffs, blockers, unknowns: [...unknowns, ...scores.unknowns],
            snapshot: candidate.snapshot, terms, brief: preview ? preview.original : brief, ...(preview ? { preview: preview.metadata } : {}), employeeFacts: source.employeeFacts,
            ...(feedback ? { feedback } : {}),
            versions: { brief: briefVersion, facts: source.factsVersion, policy: allowance.policyVersion, stock: source.stockVersion,
              snapshot: candidate.snapshot.snapshotVersion, terms: terms?.termsVersion ?? null, clock: clock.value.clockVersion, availability: candidate.availability.version,
              ...(fb ? { feedback: fb.identity } : {}) },
            evidence: { eligibility: eligibility.value, allowance: allowance.value, points: points.status === 'ok' ? points.value : null,
              assumptions: assumptionResults.map((row) => row.value), availability: candidate.availability } });
        }
        // Same again nulls every kept score, so the shared ranker ignores category fit for continuity matches.
        const ranked = rankEmployeeRecommendations(decisions, config);
        return freezeVehicleData(result('ok', { value: { scenarioId: 'employee-scheme-demo-v1', runId: context.runId,
          ...(preview ? { preview: preview.metadata, brief: preview.original } : {}),
          state: !decisions.length ? 'no-stock' : ranked.length ? 'recommendations' : 'no-viable-stock', evaluatedAt: now,
          versions: { brief: briefVersion, facts: source.factsVersion, policy: allowance.policyVersion, stock: source.stockVersion, clock: clock.value.clockVersion,
            ...(fb ? { feedback: fb.identity } : {}) },
          // The brief gallery shows best fit first; stored evaluations keep provider order for allocation records.
          decisions: preview ? [...ranked, ...decisions.filter((entry) => entry.gateStatus !== 'eligible')] : decisions,
          recommendations: ranked.slice(0, config.displayLimit), eligibleCount: ranked.length,
          ...(config.ranking ? { ranking: config.ranking } : {}) } }));
      } catch { return unavailable('employee-source-invalid'); }
}

export function createEmployeeRecommendationService({ provider, policy, time } = {}) {
  const evaluate = (context, request, preview = null) => {
    if (!provider || typeof provider.resolve !== 'function' || !policy || typeof time?.now !== 'function') return Promise.resolve(unavailable('provider-not-configured'));
    if (!context?.roles?.includes('employee')) return Promise.resolve(result('forbidden', { reason: 'An employee context is required.' }));
    return evaluateRecommendation({ provider, policy, time }, context, request, preview);
  };
  return {
    recommend: (context, request) => evaluate(context, request),
    // This in-process entry is deliberately absent from the public recommendations route.
    previewUnsaved(context, input = {}) {
      if (!only(input, ['brief', 'baseBriefVersion', 'baseDraftVersion'])) return invalid('invalid-preview', [{ field: 'preview', reason: 'Supply only the editable brief and current saved base versions.' }]);
      const { brief, baseBriefVersion, baseDraftVersion } = input;
      if (!Number.isSafeInteger(baseBriefVersion) || baseBriefVersion < 0 || !Number.isSafeInteger(baseDraftVersion)
        || baseDraftVersion < 0 || !only(brief, ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback', 'currentCarRating', 'sameAgain'])
        || brief.schemaVersion !== 1 || brief.currentCarRating !== undefined && !currentCarRatingValid(brief.currentCarRating)
        || brief.sameAgain !== undefined && !sameAgainValid(brief.sameAgain)) return invalid('invalid-preview', [{ field: 'preview', reason: 'Supply current saved base versions.' }]);
      const { charging, ...essentials } = brief.essentials ?? {};
      const { currentCarFeedback, currentCarRating, sameAgain, ...content } = brief;
      const metadata = { kind: 'unsaved-draft', approved: false, baseBriefVersion, baseDraftVersion };
      return evaluate(context, { ...content, essentials }, { charging, baseBriefVersion, baseDraftVersion, metadata, original: structuredClone(brief) });
    },
  };
}

// In-process calculation only. The caller owns persisted-intent authority, current
// consent and transactional source checks. This subject is data, never a session.
// Keep this factory separate from the service object used by public HTTP routes.
export function createStoredSubjectRecommendationEvaluator({ provider, policy, time } = {}) {
  const keys = ['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion'];
  return {
    async evaluate(subject, confirmedBrief) {
      try {
        if (!only(subject, keys) || keys.some((key) => !text(subject[key]))) return invalid('invalid-stored-subject', [
          { field: 'subject', reason: 'Supply only the complete server-owned calculation subject.' }]);
        const bound = Object.freeze(Object.fromEntries(keys.map((key) => [key, subject[key]])));
        const savedBrief = structuredClone(confirmedBrief);
        const ports = { policy,
          provider: provider && { resolve: (candidate) => candidate === bound ? provider.resolve(bound) : unavailable('subject-binding-mismatch') },
          time: time && { now: (candidate) => candidate === bound ? time.now(bound) : unavailable('subject-binding-mismatch') } };
        const outcome = await evaluateRecommendation(ports, bound, savedBrief);
        if (outcome.status === 'ok' && outcome.value.versions.policy !== bound.policyVersion) return unavailable('stored-subject-policy-mismatch');
        return outcome;
      } catch { return unavailable('employee-source-invalid'); }
    },
  };
}
