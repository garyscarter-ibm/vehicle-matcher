import { AccountDriver, AccountProjection, EvidenceRecord, JourneyIntent, ManualChoices, ManualDraft } from './account.types';

const record = (value: unknown): EvidenceRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as EvidenceRecord : {};
const rows = (value: unknown): EvidenceRecord[] => Array.isArray(value) ? value.map(record) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, ordered(part)])) : value;
export const sameChoices = (a: unknown, b: unknown): boolean => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
export const validCollectionDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
export const matchesJourney = (choices: JourneyIntent | null, intent: JourneyIntent): boolean => choices !== null
  && (['mode', 'oldContractId', 'slotId', 'schemeId'] as const).every((key) => choices[key] === intent[key]);

export function permittedJourney(account: AccountProjection, intent: JourneyIntent): boolean {
  return account.state === 'ready' && account.choices?.['slotId'] === intent.slotId && account.choices?.['schemeId'] === intent.schemeId
    && account.actions.some((action) => action.enabled && action.action === (intent.mode === 'replacement' ? 'replace' : 'order')
      && action.slotId === intent.slotId && action.schemeId === intent.schemeId && action.oldContractId === intent.oldContractId);
}

export function initialManualChoices(account: AccountProjection, intent: JourneyIntent, draft: ManualDraft | null): ManualChoices {
  const saved = draft && matchesJourney(draft.choices, intent) ? draft.choices : {};
  const brands = strings(account.choices?.['brands']);
  return { ...intent, driverId: '', contractOptionId: '', requestedCollectionDate: '', collectionLocationId: '',
    brand: brands.length === 1 ? brands[0] : '', contact: { phone: account.account?.contact?.phone ?? '', email: account.account?.contact?.email ?? '' },
    expectedReturnMileage: null, specialRequirements: '', ...structuredClone(saved) };
}

function driverReason(driver: AccountDriver | undefined, date: string | undefined, asOf: string | null | undefined): string | null {
  const eligible = record(driver?.['eligible']);
  if (eligible['status'] !== 'known' || typeof eligible['value'] !== 'boolean') return 'Driver eligibility needs confirmation. Contact driver support.';
  if (!eligible['value']) return 'This driver is not eligible. Contact driver support.';
  const licence = record(driver?.licence); const source = record(licence['source']);
  if (!['synthetic', 'dated-snapshot', 'authorised-live'].includes(text(source['mode']))
    || !['sourceRef', 'sourceVersion', 'schemaVersion'].every((key) => text(source[key]).trim())
    || !Number.isFinite(Date.parse(text(source['effectiveFrom']))) || !Number.isFinite(Date.parse(text(source['observedAt'])))
    || !Number.isFinite(Date.parse(asOf ?? '')) || Date.parse(text(source['effectiveFrom'])) > Date.parse(asOf ?? '')
    || !validCollectionDate(licence['validFrom']) || !validCollectionDate(licence['validUntil']) || !Array.isArray(licence['categories'])) {
    return 'Licence facts need confirmation. Contact driver support.';
  }
  if (!strings(licence['categories']).includes('car') || licence['validFrom'] > licence['validUntil']
    || validCollectionDate(date) && (licence['validFrom'] > date || licence['validUntil'] < date)) {
    return 'This licence is not valid for a car at the requested collection date. Contact driver support.';
  }
  return null;
}

export interface ChoiceOption { readonly id: string; readonly label: string; readonly disabled: boolean; readonly reason: string | null }
export interface ManualChoicesModel {
  readonly drivers: readonly ChoiceOption[]; readonly contracts: readonly ChoiceOption[]; readonly locations: readonly ChoiceOption[];
  readonly brands: readonly string[]; readonly minDate: string | null; readonly maxDate: string | null;
  readonly errors: Readonly<Record<string, string>>; readonly valid: boolean; readonly allowance: number | null;
  readonly maximumText: number | null; readonly maximumMileage: number | null;
}

// These are projected policy choices. Java repeats the authority checks at save and stock read.
export function deriveManualChoices(account: AccountProjection, choices: ManualChoices): ManualChoicesModel {
  const rules = record(account.assumptions?.find((item) => item['key'] === 'manual.context.v1')?.['value']);
  const minimumLead = rules['minimumLeadDays']; const maximumLead = rules['maximumLeadDays'];
  const maximumMileage = rules['maximumReturnMileage']; const maximumText = rules['maximumSpecialRequirements'];
  const configured = typeof minimumLead === 'number' && Number.isSafeInteger(minimumLead) && minimumLead >= 0
    && typeof maximumLead === 'number' && Number.isSafeInteger(maximumLead) && maximumLead >= minimumLead
    && typeof maximumMileage === 'number' && Number.isSafeInteger(maximumMileage) && maximumMileage > 0
    && typeof maximumText === 'number' && Number.isSafeInteger(maximumText) && maximumText > 0;
  const errors: Record<string, string> = {};
  const permitted = permittedJourney(account, choices); const supplied = account.choices;
  const allowance = account.allowance;
  const allowanceReady = typeof allowance?.['monthlyPoints'] === 'number' && Number.isFinite(allowance['monthlyPoints']) && allowance['monthlyPoints'] >= 0
    && allowance['unit'] === 'points/month' && ['assumed', 'verified'].includes(text(allowance['status']))
    && allowance['schemeId'] === choices.schemeId && allowance['companyId'] === account.account?.companyId && allowance['gradeId'] === account.account?.gradeId;
  const selectedDriver = account.drivers?.find((driver) => driver.driverId === choices.driverId);
  const drivers = rows(supplied?.['drivers']).map((driver) => { const reason = driverReason(account.drivers?.find((source) => source.driverId === driver['driverId']), choices.requestedCollectionDate, account.asOf);
    return { id: text(driver['driverId']), label: text(driver['name']) || 'Name not supplied', disabled: !!reason, reason }; });
  const contractRows = rows(supplied?.['contractOptions']);
  const contracts = contractRows.map((option) => {
    const reason = !selectedDriver ? 'Choose a driver first.' : !strings(option['schemeIds']).includes(choices.schemeId)
      || !strings(option['driverKinds']).includes(selectedDriver.kind ?? '') ? 'Not available for this driver and scheme.' : null;
    const months = typeof option['months'] === 'number' ? option['months'].toLocaleString('en-GB') : 'Term not supplied';
    const mileage = typeof option['annualMileage'] === 'number' ? option['annualMileage'].toLocaleString('en-GB') : 'Mileage not supplied';
    return { id: text(option['contractOptionId']), label: `${months} months, ${mileage} ${text(option['mileageUnit']) || 'annual mileage'}`, disabled: !!reason, reason };
  });
  const selectedContract = contracts.find((option) => option.id === choices.contractOptionId && !option.disabled);
  const locations = rows(supplied?.['collectionLocations']).filter((location) => !selectedContract
    || strings(location['contractOptionIds']).includes(selectedContract.id) && strings(location['driverKinds']).includes(selectedDriver?.kind ?? ''))
    .map((location) => { const reason = !selectedContract ? 'Choose a contract length and annual mileage first.'
      : strings(location['closedDates']).includes(choices.requestedCollectionDate ?? '') ? 'Closed on the requested collection date.' : null;
      return { id: text(location['locationId']), label: text(location['label']) || 'Location name not supplied', disabled: !!reason, reason }; });
  const window = account.contracts?.find((contract) => contract.contractId === choices.oldContractId)
    ?? (account.currentContract?.contractId === choices.oldContractId ? account.currentContract : null)
    ?? account.slots?.find((slot) => slot.entitlementSlotId === choices.slotId);
  const today = validCollectionDate(account.asOf?.slice(0, 10)) ? Date.parse(`${account.asOf!.slice(0, 10)}T00:00:00.000Z`) : NaN;
  const leadDate = (days: unknown): string | null => Number.isFinite(today) && configured && typeof days === 'number'
    ? new Date(today + days * 86400000).toISOString().slice(0, 10) : null;
  const minDate = [leadDate(minimumLead), text(window?.['earliestCollectionDate'])].filter((value): value is string => !!value).sort().at(-1) ?? null;
  const maxDate = [leadDate(maximumLead), text(window?.['latestCollectionDate'])].filter((value): value is string => !!value).sort()[0] ?? null;
  if (!configured || !supplied || !permitted) errors['context'] = 'Refresh and review the trusted ordering context.';
  if (!allowanceReady) errors['allowance'] = 'Monthly points allowance needs confirmation. Contact scheme support.';
  if (!drivers.some((driver) => driver.id === choices.driverId)) errors['driverId'] = 'Choose who will drive the car.';
  else { const reason = driverReason(selectedDriver, choices.requestedCollectionDate, account.asOf); if (reason) errors['driverId'] = reason; }
  if (!selectedContract) errors['contractOptionId'] = 'Choose a contract length and annual mileage.';
  if (!strings(supplied?.['brands']).includes(choices.brand ?? '')) errors['brand'] = 'Choose a brand.';
  if (!locations.some((location) => location.id === choices.collectionLocationId && !location.disabled)) errors['collectionLocationId'] = 'Choose where to collect the car.';
  if (!validCollectionDate(choices.requestedCollectionDate)) errors['requestedCollectionDate'] = 'Enter the date you want to collect the car.';
  else if (!minDate || !maxDate || choices.requestedCollectionDate < minDate || choices.requestedCollectionDate > maxDate) {
    errors['requestedCollectionDate'] = minDate && maxDate ? `Choose a collection date between ${minDate} and ${maxDate}.` : 'Choose a date inside your collection window.';
  }
  if (!choices.contact || !/^\+?[0-9 ()-]{7,30}$/.test(choices.contact.phone) || choices.contact.email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(choices.contact.email)) errors['contact'] = 'Enter a phone number and an email address.';
  if (choices.mode !== 'replacement') { if (choices.expectedReturnMileage != null) errors['expectedReturnMileage'] = 'Mileage applies only when you replace a car.'; }
  else if (!Number.isSafeInteger(choices.expectedReturnMileage) || (choices.expectedReturnMileage ?? -1) < 0) errors['expectedReturnMileage'] = 'Enter the mileage your current car will have when you return it.';
  else if (typeof maximumMileage === 'number' && choices.expectedReturnMileage! > maximumMileage) errors['expectedReturnMileage'] = `Enter a mileage of up to ${maximumMileage.toLocaleString('en-GB')} miles.`;
  if (typeof choices.specialRequirements !== 'string' || typeof maximumText !== 'number' || choices.specialRequirements.length > maximumText
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(choices.specialRequirements)) errors['specialRequirements'] = `Use at most ${typeof maximumText === 'number' ? maximumText : 0} characters.`;
  return { drivers, contracts, locations, brands: strings(supplied?.['brands']), minDate, maxDate, errors, valid: !Object.keys(errors).length,
    allowance: allowanceReady ? allowance!['monthlyPoints'] as number : null,
    maximumText: typeof maximumText === 'number' ? maximumText : null, maximumMileage: typeof maximumMileage === 'number' ? maximumMileage : null };
}
