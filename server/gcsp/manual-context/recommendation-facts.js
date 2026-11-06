import { inputDigest, ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const revision = (value) => Number.isSafeInteger(value) && value > 0;
const unavailable = () => result('unavailable', { code: 'source-invalid', retryable: true,
  reason: 'The employee recommendation source is unavailable.' });
const sourceValid = (source, now) => object(source)
  && ['synthetic', 'dated-snapshot', 'authorised-live'].includes(source.mode)
  && ['sourceRef', 'sourceVersion', 'schemaVersion'].every((key) => text(source[key]))
  && ['effectiveFrom', 'observedAt'].every((key) => validInstant(source[key]) && Date.parse(source[key]) <= Date.parse(now));

// Pure read projection. The caller keeps the Greg guard and fences these exact rows.
// A flattened fact cannot supply the missing binding to a persisted driver.
export function projectRecommendationFacts({ context, employee, brief, slots, now } = {}) {
  if (!validInstant(now) || !context || !employee || !brief || !Array.isArray(slots)
    || !revision(employee.version)
    || ['runId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId']
      .some((key) => !text(context[key]) || employee[key] !== context[key])
    || ['runId', 'employeeId', 'entitlementSlotId'].some((key) => brief[key] !== context[key])) return unavailable();
  if (slots.some((row) => !object(row))) return unavailable();
  const matchingSlots = slots.filter((row) => row.entitlementSlotId === context.entitlementSlotId);
  if (matchingSlots.length !== 1) return unavailable();
  const slot = matchingSlots[0];
  if (slot.runId !== context.runId || slot.employeeId !== context.employeeId || !revision(slot.version)
    || slot.contractId != null && !text(slot.contractId)) return unavailable();
  const stored = employee.contract?.manualContext;
  if (stored != null && !object(stored) || stored?.employeeFacts != null && !object(stored.employeeFacts)) return unavailable();
  const employeeFacts = structuredClone(stored?.employeeFacts ?? {});
  delete employeeFacts.driverEligible;
  const projected = (driver = null) => {
    if (driver?.eligible !== undefined) employeeFacts.driverEligible = structuredClone(driver.eligible);
    return ok({ employeeFacts, factsVersion: inputDigest({ employeeId: context.employeeId,
      employeeVersion: employee.version, entitlementSlotId: slot.entitlementSlotId, slotVersion: slot.version,
      recordSetId: stored?.recordSetId ?? null, driverId: driver?.driverId ?? null }) });
  };
  if (!stored) return unavailable();
  if (!sourceValid(stored.source, now) || !object(stored.account)
    || ['employeeId', 'companyId', 'schemeId', 'gradeId'].some((key) => stored.account[key] !== context[key])
    || !text(stored.recordSetId) || !Array.isArray(stored.drivers)
    || stored.contracts != null && !Array.isArray(stored.contracts)) return unavailable();
  if (stored.drivers.some((driver) => !object(driver) || !text(driver.driverId)
    || driver.employeeId !== context.employeeId)) return unavailable();
  if (new Set(stored.drivers.map((driver) => driver.driverId)).size !== stored.drivers.length) return unavailable();
  if (stored.contracts && (stored.contracts.some((contract) => !object(contract) || !text(contract.contractId)
    || contract.employeeId !== context.employeeId || !text(contract.slotId) || !text(contract.schemeId))
    || new Set(stored.contracts.map((contract) => contract.contractId)).size !== stored.contracts.length)) return unavailable();
  let drivers;
  if (slot.contractId != null) {
    if (!Array.isArray(stored.contracts)) return unavailable();
    const contracts = stored.contracts.filter((contract) => contract?.contractId === slot.contractId);
    if (contracts.length !== 1) return unavailable();
    const contract = contracts[0];
    if (contract.employeeId !== context.employeeId || contract.slotId !== context.entitlementSlotId
      || contract.schemeId !== context.schemeId || contract.status !== 'current'
      || !sourceValid(contract.source, now) || !text(contract.driverId)) return unavailable();
    drivers = stored.drivers.filter((driver) => driver.driverId === contract.driverId);
    if (drivers.length !== 1) return unavailable();
  } else drivers = stored.drivers.filter((driver) => driver.kind === 'employee');
  return projected(drivers.length === 1 ? drivers[0] : null);
}
