import { ok, result } from '../repository/index.js';
import { validContact } from '../manual-context/index.js';

const calendar = (value) => /^\d{4}-\d\d-\d\d$/.test(value ?? '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const conflict = (reason) => result('conflict', { reason, view: { state: 'review-required', action: 'review-selection' } });

// Pure over the stored employee row: what a buddy handoff needs, without a manual draft.
export function deriveBuddyHandoffInputs(employee, { entitlementSlotId, today } = {}) {
  const manual = employee?.contract?.manualContext;
  const account = manual?.account ?? null;
  const contact = validContact(account?.contact) ? structuredClone(account.contact) : null;
  const driver = manual?.drivers?.find((d) => d.kind === 'employee' && d.employeeId === employee.employeeId) ?? null;
  const licence = driver?.licence;
  const driverOk = text(driver?.name) && text(licence?.displayNumber) && driver?.eligible?.value === true && Array.isArray(licence?.categories) && licence.categories.includes('car')
    && calendar(licence.validFrom) && calendar(licence.validUntil) && licence.validFrom <= licence.validUntil
    && (!today || licence.validFrom <= today && licence.validUntil >= today);
  const contract = manual?.contracts?.find((c) => c.status === 'current' && c.slotId === entitlementSlotId && c.returnedDate == null) ?? null;
  const odometer = contract?.currentOdometer;
  const returnOk = !contract || (text(contract.model) && calendar(contract.contractEndDate)
    && Number.isFinite(odometer?.value) && odometer.value >= 0 && text(odometer.unit));
  return { account, contact, driver: driverOk ? driver : null, driverRecord: driver, mode: contract ? 'replacement' : 'new', contract, returnOk,
    returnCar: contract ? { model: contract.model ?? null, contractEndDate: contract.contractEndDate ?? null,
      currentOdometer: odometer ?? null } : null };
}

// The buddy source's `prepare`: verifies contact, driver and return data from stored records, as the manual route does from its draft.
export async function prepareBuddySelection({ repository, clock, policy, expectedReturnMileage }, context, source) {
  const found = await repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
  if (found.status !== 'ok') return found;
  const time = await clock.now(context); if (time.status !== 'ok') return time;
  const derived = deriveBuddyHandoffInputs(found.value, { entitlementSlotId: context.entitlementSlotId, today: time.value.now.slice(0, 10) });
  if (!derived.contact) return conflict('contact-required');
  if (!derived.driver) return conflict('driver-review-required');
  if (!derived.returnOk) return conflict('return-data-required');
  const replacement = derived.mode === 'replacement';
  if (replacement) {
    const rules = await policy?.getAssumption('manual.context.v1', { runId: context.runId, policyVersion: context.policyVersion, asOf: time.value.now });
    const maximum = rules?.value?.value?.maximumReturnMileage;
    if (rules?.status !== 'ok' || rules.policyVersion !== context.policyVersion || !Number.isSafeInteger(maximum)) return conflict('return-mileage-requirements-unavailable');
    if (!Number.isSafeInteger(expectedReturnMileage) || expectedReturnMileage < 0 || expectedReturnMileage > maximum) return result('invalid', { code: 'expected-return-mileage-required',
      reasons: [{ field: 'expectedReturnMileage', reason: `Enter a whole expected return mileage from 0 to ${maximum.toLocaleString('en-GB')} miles.` }] });
  } else if (expectedReturnMileage !== undefined) return conflict('return-mileage-not-applicable');
  return ok({ draft: { draftVersion: source.expectedDraftVersion, choices: { mode: derived.mode, driverId: derived.driver.driverId,
      contact: derived.contact, returnOdometer: replacement ? { value: expectedReturnMileage, unit: 'mi' } : null } },
    employee: derived.account, driver: derived.driver, oldContract: replacement ? derived.contract : null,
    versions: { employee: found.value.version, brief: source.expectedDraftVersion } });
}
