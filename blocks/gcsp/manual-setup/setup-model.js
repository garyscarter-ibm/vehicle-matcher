import { longDate } from '../kit/plain-copy.js';
const list = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
export const setupFields = ['driverId', 'contractOptionId', 'requestedCollectionDate', 'collectionLocationId',
  'brand', 'contact', 'expectedReturnMileage', 'specialRequirements'];
export const dependentFields = ['driverId', 'contractOptionId', 'requestedCollectionDate', 'collectionLocationId', 'brand'];
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export function permittedIntent(account) {
  const actions = list(account?.actions).filter((a) => a.enabled === true && ['order', 'replace'].includes(a.action)
    && a.slotId === account.choices?.slotId && a.schemeId === account.choices?.schemeId
    && (a.action === 'replace' ? a.oldContractId === account.currentContract?.contractId && !!a.oldContractId
      : a.oldContractId === null && !account.currentContract));
  if (account?.state !== 'ready' || actions.length !== 1) return null;
  const action = actions[0];
  return { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId };
}

export function matchesIntent(choices, intent) {
  return !!intent && Object.keys(intent).every((field) => choices?.[field] === intent[field]);
}

export function initialChoices(account, draft = null) {
  const intent = permittedIntent(account);
  if (!intent) return null;
  const saved = draft?.choices ?? {};
  return { ...intent, driverId: '', contractOptionId: '', requestedCollectionDate: '', collectionLocationId: '',
    brand: account.choices.brands?.length === 1 ? account.choices.brands[0] : '',
    contact: { phone: account.account?.contact?.phone ?? '', email: account.account?.contact?.email ?? '' },
    expectedReturnMileage: null, specialRequirements: '',
    ...Object.fromEntries(setupFields.filter((key) => Object.hasOwn(saved, key)).map((key) => [key, structuredClone(saved[key])])) };
}

function licenceReason(driver, date, asOf) {
  const licence = driver?.licence; const source = licence?.source;
  if (!object(source) || !['synthetic', 'dated-snapshot', 'authorised-live'].includes(source.mode)
    || !['sourceRef', 'sourceVersion', 'schemaVersion'].every((key) => typeof source[key] === 'string' && source[key].trim())
    || !Number.isFinite(Date.parse(source.effectiveFrom)) || !Number.isFinite(Date.parse(source.observedAt))
    || Date.parse(source.effectiveFrom) > Date.parse(asOf)
    || !validDate(licence?.validFrom) || !validDate(licence?.validUntil) || !Array.isArray(licence?.categories)) {
    return 'Licence facts need confirmation. Contact driver support.';
  }
  if (!licence.categories.includes('car') || licence.validFrom > licence.validUntil
    || validDate(date) && (licence.validFrom > date || licence.validUntil < date)) {
    return 'This licence is not valid for a car at the requested collection date. Contact driver support.';
  }
  return null;
}

function driverReason(driver, date, asOf) {
  if (driver?.eligible?.status !== 'known' || typeof driver.eligible.value !== 'boolean') return 'Driver eligibility needs confirmation. Contact driver support.';
  if (!driver.eligible.value) return 'This driver is not eligible. Contact driver support.';
  return licenceReason(driver, date, asOf);
}

export function deriveSetupModel(account, choices) {
  const rules = list(account?.assumptions).find((a) => a.key === 'manual.context.v1')?.value;
  const intent = permittedIntent(account); const supplied = account?.choices;
  const configured = object(rules) && Number.isSafeInteger(rules.minimumLeadDays) && rules.minimumLeadDays >= 0
    && Number.isSafeInteger(rules.maximumLeadDays) && rules.maximumLeadDays >= rules.minimumLeadDays
    && Number.isSafeInteger(rules.maximumReturnMileage) && rules.maximumReturnMileage > 0
    && Number.isSafeInteger(rules.maximumSpecialRequirements) && rules.maximumSpecialRequirements > 0;
  const errors = {}; const fail = (field, reason) => { errors[field] = reason; };
  const allowance = account?.allowance;
  const allowanceReady = Number.isFinite(allowance?.monthlyPoints) && allowance.monthlyPoints >= 0
    && allowance.unit === 'points/month' && ['assumed', 'verified'].includes(allowance.status)
    && allowance.schemeId === intent?.schemeId && allowance.companyId === account?.account?.companyId
    && allowance.gradeId === account?.account?.gradeId;
  const selectedDriver = list(account?.drivers).find((d) => d.driverId === choices?.driverId);
  const drivers = list(supplied?.drivers).map((d) => ({ ...d,
    disabled: !!driverReason(list(account?.drivers).find((source) => source.driverId === d.driverId), choices?.requestedCollectionDate, account?.asOf),
    reason: driverReason(list(account?.drivers).find((source) => source.driverId === d.driverId), choices?.requestedCollectionDate, account?.asOf) }));
  const contractOptions = list(supplied?.contractOptions).map((option) => {
    const reason = !selectedDriver ? 'Choose a driver first.' : !option.schemeIds?.includes(intent?.schemeId)
      || !option.driverKinds?.includes(selectedDriver.kind) ? 'Not available for this driver and scheme.' : null;
    return { ...option, disabled: !!reason, reason };
  });
  const selectedContract = contractOptions.find((c) => c.contractOptionId === choices?.contractOptionId && !c.disabled);
  // A site that can never apply to this contract and driver is left out, not listed as unavailable (FUCQ-237).
  const collectionLocations = list(supplied?.collectionLocations)
    .filter((location) => !selectedContract || (location.contractOptionIds?.includes(selectedContract.contractOptionId)
      && location.driverKinds?.includes(selectedDriver?.kind)))
    .map((location) => {
      const reason = !selectedContract ? 'Choose a permitted term and mileage first.'
        : location.closedDates?.includes(choices?.requestedCollectionDate) ? 'Closed on the requested collection date.' : null;
      return { ...location, disabled: !!reason, reason };
    });
  const slot = list(account?.slots).find((s) => s.entitlementSlotId === intent?.slotId);
  const window = account?.currentContract ?? slot;
  const today = validDate(account?.asOf?.slice(0, 10)) ? Date.parse(`${account.asOf.slice(0, 10)}T00:00:00.000Z`) : NaN;
  const leadDate = (days) => Number.isFinite(today) && configured ? new Date(today + days * 86400000).toISOString().slice(0, 10) : null;
  const min = [leadDate(rules?.minimumLeadDays), window?.earliestCollectionDate].filter(Boolean).sort().at(-1) ?? null;
  const max = [leadDate(rules?.maximumLeadDays), window?.latestCollectionDate].filter(Boolean).sort()[0] ?? null;
  if (!configured || !supplied || !intent || !choices || !matchesIntent(choices, intent)) fail('context', 'Refresh and review the trusted ordering context.');
  if (!allowanceReady) fail('allowance', 'Monthly points allowance needs confirmation. Contact scheme support.');
  if (!drivers.some((d) => d.driverId === choices?.driverId)) fail('driverId', 'Choose who will drive the car.');
  else if (driverReason(selectedDriver, choices.requestedCollectionDate, account?.asOf)) fail('driverId', driverReason(selectedDriver, choices.requestedCollectionDate, account?.asOf));
  if (!selectedContract) fail('contractOptionId', 'Choose a contract length and annual mileage.');
  if (!list(supplied?.brands).includes(choices?.brand)) fail('brand', 'Choose a brand.');
  if (!collectionLocations.some((l) => l.locationId === choices?.collectionLocationId && !l.disabled)) fail('collectionLocationId', 'Choose where to collect the car.');
  if (!validDate(choices?.requestedCollectionDate)) fail('requestedCollectionDate', 'Enter the date you want to collect the car.');
  else if (!min || !max || choices.requestedCollectionDate < min || choices.requestedCollectionDate > max) fail('requestedCollectionDate', min && max ? `Choose a collection date between ${longDate(min)} and ${longDate(max)}.` : 'Choose a date inside your collection window.');
  if (!object(choices?.contact) || Object.keys(choices.contact).some((k) => !['phone', 'email'].includes(k))
    || !/^\+?[0-9 ()-]{7,30}$/.test(choices?.contact?.phone ?? '') || typeof choices?.contact?.email !== 'string'
    || choices.contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(choices.contact.email)) fail('contact', 'Enter a phone number and an email address.');
  if (intent?.mode !== 'replacement') { if (choices?.expectedReturnMileage != null) fail('expectedReturnMileage', 'Mileage applies only when you replace a car.'); }
  else if (!Number.isSafeInteger(choices?.expectedReturnMileage) || choices.expectedReturnMileage < 0) fail('expectedReturnMileage', 'Enter the mileage your current car will have when you return it.');
  else if (choices.expectedReturnMileage > rules?.maximumReturnMileage) fail('expectedReturnMileage', `Enter a mileage of up to ${rules.maximumReturnMileage.toLocaleString('en-GB')} miles.`);
  if (typeof choices?.specialRequirements !== 'string' || choices.specialRequirements.length > rules?.maximumSpecialRequirements
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(choices.specialRequirements)) fail('specialRequirements', `Use at most ${rules?.maximumSpecialRequirements ?? 0} characters.`);
  return { intent, rules: rules ?? null, drivers, selectedDriver: selectedDriver ?? null, contractOptions, collectionLocations,
    brands: list(supplied?.brands), collectionWindow: { min, max }, allowance: allowance ?? null, allowanceReady,
    errors, valid: Object.keys(errors).length === 0 };
}
