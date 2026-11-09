import { inputDigest } from '../../repository/core.js';
import { validInstant } from '../../policy/file-provider.js';

export const FORECAST_CONTRACT_VERSION = '1.0.0';
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = (values) => new Set(values).size === values.length;
const unavailable = (code) => ({ status: 'unavailable', code, contractVersion: FORECAST_CONTRACT_VERSION });
const known = (configuration, key) => {
  const f = configuration.facts?.[key];
  return f?.status === 'known' && f.value !== null ? f.value : null;
};
const period = (instant) => new Date(Date.parse(instant)).toISOString().slice(0, 7);

// Builds the PredictionInput from the expressed forecast and its saved briefs. The permitted
// choices are exactly the FUCQ-29 gate result; any unreadable term makes the input unavailable.
export async function createPredictionInput(context, { expressed, catalog, terms, read } = {}) {
  const contexts = expressed?.predictionContext?.entitlements;
  if (!Array.isArray(contexts) || !Array.isArray(expressed.forecast?.entitlements) || !Array.isArray(catalog?.derivatives)
    || typeof terms?.readFutureTerms !== 'function' || !text(catalog.version) || !validInstant(read?.asOf) || !validInstant(read.horizonEnd)) return unavailable('prediction-input-sources-missing');
  try {
    const termsVersions = []; const entitlements = [];
    for (const e of expressed.forecast.entitlements) {
      const saved = contexts.find((c) => c.entitlementId === e.entitlementId);
      if (!saved) return unavailable('prediction-input-context-missing');
      const permittedChoices = [];
      for (const derivativeId of [...e.acceptableDerivativeIds].sort(compare)) {
        const derivative = catalog.derivatives.find((d) => d.derivativeId === derivativeId);
        const configuration = catalog.configurations.find((c) => c.configurationId === derivative?.configurationIds?.[0]);
        if (!configuration) return unavailable('prediction-input-catalog-mismatch');
        const provided = await terms.readFutureTerms(context, { read, employee: saved.employee, brief: saved.brief,
          catalogVersion: catalog.version, configuration, renewalAt: e.renewalAt });
        if (provided?.status !== 'ok') return unavailable('prediction-input-terms-unavailable');
        const termsVersion = provided.value?.version;
        const points = provided.value?.terms?.points?.value; const allowance = provided.value?.terms?.allowanceInputs?.allowance?.value;
        if (!text(termsVersion) || !Number.isFinite(points) || !Number.isFinite(allowance)) return unavailable('prediction-input-terms-invalid');
        termsVersions.push(termsVersion);
        permittedChoices.push({ derivativeId, configurationId: configuration.configurationId, vehicleClass: known(configuration, 'body') ?? 'unknown',
          attributes: { body: known(configuration, 'body'), fuel: known(configuration, 'fuel'), seats: known(configuration, 'seats'),
            boot: known(configuration, 'boot'), monthlyPoints: points, allowance }, termsVersion });
      }
      entitlements.push({ entitlementId: e.entitlementId, employeeId: e.employeeId, cohortKey: saved.employee.gradeId, renewalAt: e.renewalAt,
        ...(e.requiredBy === undefined ? {} : { requiredBy: e.requiredBy }), period: period(e.requiredBy ?? e.renewalAt),
        brief: { preferences: structuredClone(saved.brief.preferences ?? {}), essentials: structuredClone(saved.brief.essentials ?? {}) }, permittedChoices });
    }
    const value = { contractVersion: FORECAST_CONTRACT_VERSION, runId: context.runId, asOf: read.asOf, policyVersion: context.policyVersion,
      horizon: { start: read.asOf, end: read.horizonEnd }, cohort: { version: expressed.cohortVersion, entitlements },
      terms: { version: inputDigest([...new Set(termsVersions)].sort(compare)) } };
    const reasons = validatePredictionInput(value);
    return reasons.length ? unavailable('prediction-input-invalid') : { status: 'ok', contractVersion: FORECAST_CONTRACT_VERSION, value };
  } catch { return unavailable('prediction-input-unavailable'); }
}

// Returns a list of {field, reason}; empty when the input is usable by the provider.
export function validatePredictionInput(input) {
  const reasons = []; const reject = (field, reason) => reasons.push({ field, reason });
  try { inputDigest(input); } catch { return [{ field: 'input', reason: 'Supply finite JSON data.' }]; }
  if (!object(input) || input.contractVersion !== FORECAST_CONTRACT_VERSION) return [{ field: 'contractVersion', reason: 'Supply a version 1.0.0 prediction input.' }];
  if (!text(input.runId) || !text(input.policyVersion) || !validInstant(input.asOf)) reject('runId/asOf/policyVersion', 'Supply a run, instant and policy version.');
  if (!validInstant(input.horizon?.start) || !validInstant(input.horizon?.end)) reject('horizon', 'Supply a start and end instant.');
  if (!text(input.cohort?.version) || !Array.isArray(input.cohort.entitlements)) reject('cohort', 'Supply a versioned cohort.');
  if (!text(input.terms?.version)) reject('terms', 'Supply a terms version.');
  if (reasons.length) return reasons;
  const nullableNumber = (v) => v === null || Number.isFinite(v) && v >= 0;
  const rows = input.cohort.entitlements;
  const bad = rows.some((e) => !object(e) || !text(e.entitlementId) || !text(e.employeeId) || !text(e.cohortKey) || !validInstant(e.renewalAt)
    || e.requiredBy !== undefined && !validInstant(e.requiredBy) || !/^\d{4}-\d{2}$/.test(e.period ?? '')
    || !object(e.brief) || !object(e.brief.preferences) || !object(e.brief.essentials) || !Array.isArray(e.permittedChoices)
    || !unique(e.permittedChoices.map((c) => c?.derivativeId))
    || e.permittedChoices.some((c) => !object(c) || !text(c.derivativeId) || !text(c.configurationId) || !text(c.vehicleClass) || !text(c.termsVersion)
      || !object(c.attributes) || !['seats', 'boot', 'monthlyPoints', 'allowance'].every((k) => nullableNumber(c.attributes[k]))
      || !['body', 'fuel'].every((k) => c.attributes[k] === null || text(c.attributes[k]))));
  if (bad || !unique(rows.map((e) => e.entitlementId)) || !unique(rows.map((e) => e.employeeId))) reject('cohort.entitlements', 'Each employee occurs once with valid permitted choices and brief.');
  return reasons;
}
