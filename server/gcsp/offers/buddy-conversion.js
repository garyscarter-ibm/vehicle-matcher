import { ok, result } from '../repository/index.js';
import { validContact } from '../manual-context/index.js';

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const conflict = (reason) => result('conflict', { reason, view: { state: 'review-required', action: 'review-selection' } });

// Pure over the stored employee row: what a buddy handoff needs, without a manual draft.
export function deriveBuddyHandoffInputs(employee, { entitlementSlotId, today } = {}) {
  const manual = employee?.contract?.manualContext;
  const account = manual?.account ?? null;
  const contact = validContact(account?.contact) ? structuredClone(account.contact) : null;
  const driver = manual?.drivers?.find((d) => d.kind === 'employee' && d.employeeId === employee.employeeId) ?? null;
  const licence = driver?.licence;
  const driverOk = driver?.eligible?.value === true && Array.isArray(licence?.categories) && licence.categories.includes('car')
    && text(licence.validUntil) && (!today || licence.validUntil >= today);
  const contract = manual?.contracts?.find((c) => c.status === 'current' && c.slotId === entitlementSlotId && c.returnedDate == null) ?? null;
  const odometer = contract?.currentOdometer;
  const returnOk = !contract || (text(contract.model) && text(contract.contractEndDate)
    && Number.isFinite(odometer?.value) && odometer.value >= 0 && text(odometer.unit));
  return { account, contact, driver: driverOk ? driver : null, mode: contract ? 'replacement' : 'new', contract, returnOk,
    returnCar: contract ? { model: contract.model ?? null, contractEndDate: contract.contractEndDate ?? null,
      currentOdometer: odometer ?? null } : null };
}

// The buddy source's `prepare`: verifies contact, driver and return data from stored records, as the manual route does from its draft.
export async function prepareBuddySelection({ repository, clock }, context, source) {
  const found = await repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } });
  if (found.status !== 'ok') return found;
  const time = await clock.now(context); if (time.status !== 'ok') return time;
  const derived = deriveBuddyHandoffInputs(found.value, { entitlementSlotId: context.entitlementSlotId, today: time.value.now.slice(0, 10) });
  if (!derived.contact) return conflict('contact-required');
  if (!derived.driver) return conflict('driver-review-required');
  if (!derived.returnOk) return conflict('return-data-required');
  const replacement = derived.mode === 'replacement';
  return ok({ draft: { draftVersion: source.expectedDraftVersion, choices: { mode: derived.mode, driverId: derived.driver.driverId,
      contact: derived.contact, returnOdometer: replacement ? derived.contract.currentOdometer : null } },
    employee: derived.account, driver: derived.driver, oldContract: replacement ? derived.contract : null,
    versions: { employee: found.value.version, brief: source.expectedDraftVersion } });
}
