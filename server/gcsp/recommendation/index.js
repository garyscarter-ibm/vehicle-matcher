import { createVehicleSnapshot, createEmployeeTerms, freezeVehicleData } from '../../vehicles/index.js';
import { validInstant } from '../policy/file-provider.js';
import { validateBrief, evaluateEssentials, scorePreferences, confirmedFact, chargingGates } from '../../scenarios/employee/index.js';

const result = (status, fields) => ({ status, ...fields, contractVersion: '1.0.0' });
const unavailable = (code) => result('unavailable', { code, reason: 'The employee recommendation source is unavailable.', retryable: true });
const invalid = (code, reasons) => result('invalid', { code, reasons });
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

export function createEmployeeRecommendationService({ provider, policy, time } = {}) {
  return {
    async recommend(context, request) {
      if (!provider || typeof provider.resolve !== 'function' || !policy || typeof time?.now !== 'function') return unavailable('provider-not-configured');
      if (!context?.roles?.includes('employee')) return result('forbidden', { reason: 'An employee context is required.' });
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
        const errors = validateBrief(request, config, slider);
        if (errors.length) return invalid('invalid-brief', errors);
        const brief = structuredClone(request);
        const provided = await provider.resolve(context);
        if (provided?.status === 'stale-run' || provided?.status === 'forbidden') return provided;
        if (provided?.status !== 'ok') return unavailable('employee-source-unavailable');
        const source = structuredClone(provided.value);
        if (['runId', 'environmentId', 'employeeId'].some((key) => source?.[key] !== context[key])) return refused();
        const candidates = validateSource(source);
        const providerEssentials = source.employeeFacts.essentials;
        if (providerEssentials !== undefined && validateBrief({ schemaVersion: 1, briefVersion: 1, preferences: {}, essentials: providerEssentials }, config, slider).length) return unavailable('employee-facts-invalid');
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
          for (const gate of [providerGates, evaluateEssentials(candidate.snapshot, brief, config), timingGates(candidate, source.employeeFacts, brief, now, config),
            chargingGates(candidate.snapshot, source.employeeFacts, config, charging.value)]) {
            blockers.push(...gate.blockers); unknowns.push(...gate.unknowns); reasons.push(...gate.reasons);
          }
          const gateStatus = blockers.length ? 'ineligible' : unknowns.length ? 'needs-confirmation' : 'eligible';
          const scores = gateStatus === 'eligible' ? scorePreferences(candidate.snapshot, brief, source.employeeFacts, config, slider)
            : { score: null, components: [], reasons: [], tradeOffs: [], unknowns: [] };
          decisions.push({ candidateKey: candidate.snapshot.candidateKey, orderUuid: candidate.orderUuid, configurationId: candidate.configurationId,
            gateStatus, suitable: gateStatus === 'eligible', evaluatedAt: now, score: scores.score, components: scores.components,
            reasons: [...reasons, ...scores.reasons], tradeOffs: scores.tradeOffs, blockers, unknowns: [...unknowns, ...scores.unknowns],
            snapshot: candidate.snapshot, terms, brief, employeeFacts: source.employeeFacts,
            versions: { brief: brief.briefVersion, facts: source.factsVersion, policy: allowance.policyVersion, stock: source.stockVersion,
              snapshot: candidate.snapshot.snapshotVersion, terms: terms?.termsVersion ?? null, clock: clock.value.clockVersion, availability: candidate.availability.version },
            evidence: { eligibility: eligibility.value, allowance: allowance.value, points: points.status === 'ok' ? points.value : null,
              assumptions: assumptionResults.map((row) => row.value), availability: candidate.availability } });
        }
        const ranked = decisions.filter((entry) => entry.gateStatus === 'eligible').sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.orderUuid.localeCompare(b.orderUuid));
        return freezeVehicleData(result('ok', { value: { scenarioId: 'employee-scheme-demo-v1', runId: context.runId,
          state: !decisions.length ? 'no-stock' : ranked.length ? 'recommendations' : 'no-viable-stock', evaluatedAt: now,
          versions: { brief: brief.briefVersion, facts: source.factsVersion, policy: allowance.policyVersion, stock: source.stockVersion, clock: clock.value.clockVersion },
          decisions, recommendations: ranked.slice(0, config.displayLimit), eligibleCount: ranked.length } }));
      } catch { return unavailable('employee-source-invalid'); }
    },
  };
}
