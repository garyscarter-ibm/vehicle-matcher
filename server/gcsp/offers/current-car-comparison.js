import { validInstant } from '../policy/file-provider.js';

const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const revision = (value) => Number.isSafeInteger(value) && value > 0;
const sourceKeys = ['mode', 'sourceRef', 'sourceVersion', 'schemaVersion', 'effectiveFrom', 'observedAt'];
const unknowns = ['configuration', 'body', 'fuel', 'seats', 'boot', 'mpg', 'zeroTo62', 'points'];
const freeze = (value) => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
};
const validSource = (source, now) => source && ['synthetic', 'dated-snapshot', 'authorised-live'].includes(source.mode)
  && ['sourceRef', 'sourceVersion', 'schemaVersion'].every((key) => text(source[key]))
  && ['effectiveFrom', 'observedAt'].every((key) => validInstant(source[key]) && Date.parse(source[key]) <= Date.parse(now));

const units = { boot: 'L', mpg: 'mpg-imperial', zeroTo62: 's', points: 'points-per-month', seats: 'count' };
// Copy only recorded current-contract facts of the expected type; anything else stays unknown.
function currentFacts(vehicle) {
  const facts = {};
  if (!vehicle || typeof vehicle !== 'object' || Array.isArray(vehicle)) return facts;
  for (const key of unknowns) {
    const value = vehicle[key];
    if (['configuration', 'body', 'fuel'].includes(key) ? text(value) : Number.isFinite(value) && value > 0) {
      facts[key] = { value, unit: units[key] ?? null };
    }
  }
  return facts;
}

// Pure projection of rows already read under the producer's authenticated transaction.
// binding is internal quote evidence. Public readers explicitly project display only.
// Facts come only from the recorded current contract; a model label alone establishes none.
export function createCurrentCarComparison({ context, employee, slot, now } = {}) {
  const binding = { contractId: null, employeeVersion: revision(employee?.version) ? employee.version : null,
    slotVersion: revision(slot?.version) ? slot.version : null, source: null };
  const unavailable = () => freeze({ schemaVersion: '1', comparisonAvailable: false, binding,
    display: { state: 'unavailable', model: null, source: null, unknowns: [...unknowns] } });
  if (!validInstant(now) || !context || !employee || !slot
    || ['runId', 'employeeId', 'companyId', 'schemeId', 'entitlementSlotId'].some((key) => !text(context[key]) || employee[key] !== context[key])
    || employee.runId !== slot.runId || slot.employeeId !== employee.employeeId
    || slot.entitlementSlotId !== context.entitlementSlotId || !text(slot.contractId)
    || !revision(employee.version) || !revision(slot.version)) return unavailable();
  const stored = employee.contract?.manualContext;
  if (!Array.isArray(stored?.contracts) || !validSource(stored.source, now)) return unavailable();
  const matches = stored.contracts.filter((row) => row?.contractId === slot.contractId);
  if (matches.length !== 1) return unavailable();
  const contract = matches[0];
  if (contract.employeeId !== context.employeeId || contract.slotId !== context.entitlementSlotId
    || contract.schemeId !== context.schemeId || contract.status !== 'current' || !text(contract.model)
    || !validSource(contract.source, now)) return unavailable();
  binding.contractId = contract.contractId;
  binding.source = Object.fromEntries(sourceKeys.map((key) => [key, contract.source[key]]));
  const facts = currentFacts(contract.vehicle);
  const missing = unknowns.filter((key) => !Object.hasOwn(facts, key));
  return freeze({ schemaVersion: '1', comparisonAvailable: missing.length < unknowns.length, binding,
    display: { state: missing.length ? 'partial' : 'available', model: contract.model,
      source: { mode: contract.source.mode, sourceVersion: contract.source.sourceVersion, observedAt: contract.source.observedAt },
      ...(missing.length < unknowns.length ? { facts } : {}), unknowns: missing } });
}
