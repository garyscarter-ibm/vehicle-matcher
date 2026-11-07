import { inputDigest } from '../../repository/core.js';
import { createEmployeeTerms } from '../../../vehicles/index.js';
import { validateBriefContent, evaluateEssentials, chargingGates, scorePreferences, confirmedFact } from '../../../scenarios/employee/index.js';
import { CONTRACT_VERSION, text, instant, compare, integer } from './input.js';
import { renewalInstant } from './renewal.js';

const unavailable = (code) => ({ status: 'unavailable', code, contractVersion: CONTRACT_VERSION });
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unique = (values) => new Set(values).size === values.length;
const keys = ['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum', 'brief.lifecycle.v1',
  'eligibility.homeCharging.requiredForPlugIn', 'offer.declinedCar.exclusion'];

// F99's business-value comparison: timestamps, sources and equipment list order
// cannot reopen a declined exact car. Future configurations are not that car.
const intent = (brief) => ({
  preferences: Object.fromEntries(Object.entries(brief.preferences ?? {}).map(([k, p]) => [k,
    { value: p.value, importance: p.importance, valueState: p.valueState, importanceState: p.importanceState }])),
  essentials: Object.fromEntries(Object.entries(brief.essentials ?? {}).map(([k, e]) => [k,
    { value: e.operator === 'includes' && Array.isArray(e.value) ? [...new Set(e.value)].sort(compare) : e.value,
      operator: e.operator, unit: e.unit, state: e.state }])),
});

function confirmedIntent(brief, previous) {
  const value = intent(brief); const before = intent(previous);
  for (const [key, preference] of Object.entries(brief.preferences ?? {})) {
    if (preference.valueState === 'confirmed' && preference.importanceState === 'confirmed') continue;
    if (Object.hasOwn(before.preferences, key)) value.preferences[key] = before.preferences[key];
    else delete value.preferences[key];
  }
  for (const [key, essential] of Object.entries(brief.essentials ?? {})) {
    if (essential.state === 'confirmed') continue;
    if (Object.hasOwn(before.essentials, key)) value.essentials[key] = before.essentials[key];
    else delete value.essentials[key];
  }
  return value;
}

function excludedStock(history, brief) {
  if (!history || !['decisions', 'offers', 'briefs'].every((key) => Array.isArray(history[key]))) return null;
  const excluded = [];
  for (const decision of history.decisions.filter((d) => d.employeeId === brief.employeeId && d.decision === 'decline')) {
    const offer = history.offers.find((o) => o.offerId === decision.offerId && o.employeeId === brief.employeeId);
    if (!offer || !text(offer.orderUuid)) return null;
    const previous = history.briefs.find((b) => b.employeeId === brief.employeeId && b.briefVersion === decision.versions?.brief);
    if (!previous || previous.status !== 'confirmed' || inputDigest(intent(previous)) === inputDigest(confirmedIntent(brief, previous))) excluded.push(offer.orderUuid);
  }
  return [...new Set(excluded)].sort(compare);
}

function factsValid(facts, config, asOf) {
  return object(facts) && Object.entries(facts).every(([key, f]) => object(f) && ['known', 'unknown'].includes(f.status)
    && (f.status === 'unknown') === (f.value === null) && text(f.provenance?.sourceRef) && text(f.provenance.version)
    && instant(f.provenance.observedAt) && Date.parse(f.provenance.observedAt) <= Date.parse(asOf)
    && (f.status === 'unknown') === (f.provenance.assurance === 'unknown')
    && (f.unit === null || text(f.unit)) && (typeof f.value !== 'number' || Number.isFinite(f.value) && text(f.unit))
    && (!Object.hasOwn(config.essentials, key) || f.unit === config.essentials[key].unit));
}

// Trusted in-process seam. The explicit catalogue contains configuration facts,
// never stock identities. The future-terms port must attest the exact employee,
// configuration, renewal and policy; missing sources have no runtime defaults.
export function createFutureChoiceEvaluator({ policy, identity, terms } = {}) {
  return Object.freeze({
    async evaluateChoices(context, input) {
      if (!['getAssumption', 'getEligibility', 'getAllowance', 'getPointsCost'].every((key) => typeof policy?.[key] === 'function')
        || typeof identity?.requireRole !== 'function' || typeof terms?.readFutureTerms !== 'function') return unavailable('planning-future-evaluator-not-configured');
      const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return allowed;
      try {
        const { read, employee, brief, catalog, history } = structuredClone(input);
        const renewalAt = renewalInstant(employee);
        if (read?.runId !== context.runId || read.policyVersion !== context.policyVersion || !instant(read.asOf) || !instant(read.horizonEnd)
          || employee?.runId !== context.runId || brief?.runId !== context.runId || brief.employeeId !== employee.employeeId
          || brief.status !== 'confirmed' || !integer(brief.briefVersion) || brief.briefVersion === 0
          || !['employeeId', 'companyId', 'schemeId', 'gradeId', 'renewalId', 'entitlementSlotId'].every((k) => text(employee[k]))
          || brief.renewalId != null && brief.renewalId !== employee.renewalId
          || brief.entitlementSlotId !== employee.entitlementSlotId || !renewalAt
          || Date.parse(renewalAt) > Date.parse(read.horizonEnd)) return unavailable('planning-future-input-invalid');
        if (catalog?.runId !== context.runId || catalog.asOf !== read.asOf || catalog.policyVersion !== read.policyVersion || !text(catalog.version)
          || !Array.isArray(catalog.derivatives) || !catalog.derivatives.length || !Array.isArray(catalog.configurations)
          || catalog.configurations.length > 256 || !unique(catalog.configurations.map((c) => c.configurationId))
          || !unique(catalog.derivatives.map((d) => d.derivativeId))
          || catalog.derivatives.some((d) => !text(d.derivativeId) || !Array.isArray(d.configurationIds) || !d.configurationIds.length
            || !d.configurationIds.every(text) || !unique(d.configurationIds)
            || d.configurationIds.some((id) => !catalog.configurations.some((c) => c.configurationId === id && c.derivativeId === d.derivativeId)))
          || catalog.configurations.some((c) => !text(c.configurationId) || !text(c.version) || !text(c.display?.name)
            || ['orderUuid', 'availability', 'identityKind', 'stockId', 'vin'].some((k) => Object.hasOwn(c, k))
            || !catalog.derivatives.some((d) => d.derivativeId === c.derivativeId && d.configurationIds.includes(c.configurationId)))) return unavailable('planning-future-catalog-invalid');
        const rows = await Promise.all(keys.map((key) => policy.getAssumption(key, read)));
        if (rows.some((row, i) => row.status !== 'ok' || row.policyVersion !== context.policyVersion || row.value?.key !== keys[i])) return unavailable('planning-future-policy-unavailable');
        const [config, minimum, maximum, lifecycle, charging, decline] = rows.map((row) => row.value.value);
        if (!object(config?.preferences) || !object(config.essentials) || !object(config.tuning) || config.retailBudgetEnabled !== false
          || typeof config.driverEligibilityRequired !== 'boolean' || !Array.isArray(config.confirmedAssurances)
          || !Array.isArray(config.plugInFuels) || !Array.isArray(config.chargingAccess) || minimum !== 0 || maximum !== 100
          || !object(lifecycle?.charging) || typeof charging !== 'boolean' || decline !== 'untilRelevantConfirmedBriefChange') return unavailable('planning-future-policy-invalid');
        if (catalog.configurations.some((c) => !factsValid(c.facts, config, read.asOf))) return unavailable('planning-future-catalog-invalid');
        const slider = { minimum, maximum };
        const content = { schemaVersion: brief.schemaVersion, preferences: brief.preferences, essentials: brief.essentials,
          ...(brief.requiredBy === undefined ? {} : { requiredBy: brief.requiredBy }) };
        if (validateBriefContent(content, { ...config, essentials: { ...config.essentials, charging: lifecycle.charging } }, slider).length) return unavailable('planning-future-brief-invalid');
        const employeeFacts = structuredClone(employee.contract?.manualContext?.employeeFacts);
        if (!object(employeeFacts)) return unavailable('planning-future-employee-facts-unavailable');
        if (employeeFacts.essentials !== undefined && validateBriefContent({ schemaVersion: 1, preferences: {}, essentials: employeeFacts.essentials }, config, slider).length) return unavailable('planning-future-employee-facts-invalid');
        const suppliedCharging = brief.essentials.charging;
        if (suppliedCharging) employeeFacts.charging = { status: suppliedCharging.state === 'confirmed' && suppliedCharging.value !== null ? 'known' : 'unknown',
          value: suppliedCharging.value, unit: null, provenance: { sourceRef: 'saved-brief', version: String(brief.briefVersion),
            observedAt: brief.confirmedAt, assurance: 'synthetic-scenario' } };
        const statedDeadline = employeeFacts.requiredBy;
        const deadlineUnknown = statedDeadline !== undefined && (!confirmedFact(statedDeadline, config) || !instant(statedDeadline.value));
        const requiredBy = new Date(Math.min(Date.parse(renewalAt),
          !deadlineUnknown && statedDeadline ? Date.parse(statedDeadline.value) : Infinity,
          brief.requiredBy ? Date.parse(brief.requiredBy) : Infinity)).toISOString();
        const excludedStockIds = excludedStock(history, brief);
        if (excludedStockIds === null) return unavailable('planning-future-decline-history-incomplete');
        const employeeContext = { ...context, ...Object.fromEntries(['employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId'].map((k) => [k, employee[k]])), roles: ['employee'] };
        const allowance = await policy.getAllowance(employeeContext, read);
        if (allowance.status !== 'ok' || allowance.policyVersion !== context.policyVersion) return unavailable('planning-future-policy-unavailable');
        const decisions = []; const termVersions = [];
        for (const configuration of [...catalog.configurations].sort((a, b) => compare(a.configurationId, b.configurationId))) {
          // These pure functions use display/facts only; no VehicleSnapshot or
          // fabricated exact-stock/availability identity is constructed.
          const snapshot = { display: configuration.display, facts: configuration.facts };
          const car = { ...Object.fromEntries(Object.entries(configuration.facts).filter(([, f]) => confirmedFact(f, config)).map(([k, f]) => [k, f.value])), configurationId: configuration.configurationId };
          const eligibility = await policy.getEligibility(employeeContext, car, read);
          const points = await policy.getPointsCost(employeeContext, car, read);
          if (eligibility.status !== 'ok' || !['ok', 'not-found'].includes(points.status)
            || eligibility.policyVersion !== context.policyVersion || points.policyVersion !== context.policyVersion) return unavailable('planning-future-policy-unavailable');
          const blockers = []; const unknowns = []; const reasons = [];
          if (deadlineUnknown) unknowns.push({ code: 'required-by-unconfirmed' });
          if (employeeFacts.essentials === undefined) unknowns.push({ code: 'employee-essentials-unconfirmed' });
          if (config.driverEligibilityRequired) {
            const driver = employeeFacts.driverEligible;
            if (!confirmedFact(driver, config) || typeof driver.value !== 'boolean') unknowns.push({ code: 'driver-unconfirmed' });
            else (driver.value ? reasons : blockers).push({ code: driver.value ? 'driver-eligible' : 'driver-ineligible' });
          }
          if (eligibility.value.state === 'ineligible') blockers.push({ code: 'policy-exclude', ruleIds: eligibility.value.ruleIds });
          else if (eligibility.value.state !== 'eligible') unknowns.push({ code: 'eligibility-unconfirmed', reasons: eligibility.value.reasons });
          else reasons.push({ code: 'policy-include', ruleIds: eligibility.value.ruleIds });
          let futureTerms = null;
          if (points.status !== 'ok') unknowns.push({ code: 'points-unavailable' });
          else {
            const provided = await terms.readFutureTerms(context, { read, employee, brief, catalogVersion: catalog.version, configuration, renewalAt });
            if (provided?.status !== 'ok') return unavailable('planning-future-terms-unavailable');
            const value = provided.value;
            if (value?.runId !== context.runId || value.asOf !== read.asOf || value.policyVersion !== context.policyVersion
              || value.employeeId !== employee.employeeId || value.renewalId !== employee.renewalId || value.briefVersion !== brief.briefVersion
              || value.catalogVersion !== catalog.version || value.configurationId !== configuration.configurationId || !text(value.version)) return unavailable('planning-future-terms-invalid');
            try { futureTerms = createEmployeeTerms(value.terms); } catch { return unavailable('planning-future-terms-invalid'); }
            if (Date.parse(futureTerms.validFrom) > Date.parse(read.asOf) || Date.parse(futureTerms.validUntil) <= Date.parse(renewalAt)
              || futureTerms.points.value !== points.value.monthlyPoints || futureTerms.allowanceInputs.allowance?.value !== allowance.value.monthlyPoints
              || !config.confirmedAssurances.includes(futureTerms.provenance.assurance)) return unavailable('planning-future-terms-invalid');
            termVersions.push(value);
            (allowance.value.monthlyPoints >= points.value.monthlyPoints ? reasons : blockers).push({
              code: allowance.value.monthlyPoints >= points.value.monthlyPoints ? 'allowance-sufficient' : 'allowance-exceeded' });
          }
          const essentials = Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging'));
          for (const gate of [evaluateEssentials(snapshot, { essentials: employeeFacts.essentials ?? {} }, config),
            evaluateEssentials(snapshot, { essentials }, config), chargingGates(snapshot, employeeFacts, config, charging)]) {
            blockers.push(...gate.blockers); unknowns.push(...gate.unknowns); reasons.push(...gate.reasons);
          }
          if (Date.parse(requiredBy) < Date.parse(read.asOf)) blockers.push({ code: requiredBy === renewalAt ? 'renewal-already-passed' : 'required-by-already-passed' });
          const gateStatus = blockers.length ? 'ineligible' : unknowns.length ? 'needs-confirmation' : 'eligible';
          const scored = gateStatus === 'eligible' ? scorePreferences(snapshot, brief, employeeFacts, config, slider)
            : { score: null, components: [], reasons: [], tradeOffs: [], unknowns: [] };
          decisions.push({ configurationId: configuration.configurationId, derivativeId: configuration.derivativeId,
            gateStatus, score: scored.score, components: scored.components, blockers, unknowns: [...unknowns, ...scored.unknowns],
            reasons: [...reasons, ...scored.reasons], tradeOffs: scored.tradeOffs, terms: futureTerms,
            evidence: { eligibility: eligibility.value, points: points.value ?? null, allowance: allowance.value, factsVersion: configuration.version } });
        }
        const acceptableDerivativeIds = []; const gates = new Set(decisions.flatMap((d) => [...d.blockers, ...d.unknowns].map((g) => g.code)));
        for (const derivative of catalog.derivatives) {
          const represented = decisions.filter((d) => derivative.configurationIds.includes(d.configurationId));
          if (represented.every((d) => d.gateStatus === 'eligible')) acceptableDerivativeIds.push(derivative.derivativeId);
          else gates.add(`derivative-representation-not-fully-eligible:${derivative.derivativeId}`);
        }
        const final = await identity.requireRole(context, 'greg'); if (final.status !== 'ok') return final;
        return { status: 'ok', contractVersion: CONTRACT_VERSION, value: { runId: context.runId, policyVersion: context.policyVersion,
          employeeId: employee.employeeId, briefVersion: brief.briefVersion, catalogVersion: catalog.version,
          version: inputDigest({ input, policy: rows, allowance, decisions, termVersions }),
          acceptableDerivativeIds: acceptableDerivativeIds.sort(compare), excludedStockIds, requiredBy, gates: [...gates].sort(compare), decisions,
          limitations: ['All represented configurations must pass before a derivative-only quantity can promise coverage.',
            'Preference fit is advisory; no acceptance threshold or acceptance probability is inferred.',
            'Exact declined stock exclusions do not exclude other vehicles or future configurations of that derivative.'] } };
      } catch { return unavailable('planning-future-evaluation-unavailable'); }
    },
  });
}
