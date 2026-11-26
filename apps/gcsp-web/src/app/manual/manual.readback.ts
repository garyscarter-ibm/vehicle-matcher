import type { AccountProjection, ManualDraft } from '../account/account.types';
import type { FactRow } from '../kit/fact-list.component';
import type { ManualProjection, ManualRecord } from './manual.types';
import { manualObject } from './manual.projection';

export interface ManualReadbackSource { readonly account: AccountProjection; readonly draft: ManualDraft }
export type ManualEditIntent = 'car' | 'choices' | 'contact' | 'return';
export interface ManualReadbackCard {
  readonly key: string; readonly title: string; readonly rows: readonly FactRow[];
  readonly edit: ManualEditIntent; readonly label: string; readonly hint: string;
}
const text = (value: unknown): string | null => typeof value === 'string' && !!value.trim() ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const record = (value: unknown): ManualRecord => manualObject(value) ? value : {};
const points = (value: unknown): number | null => record(value)['unit'] === 'points' ? number(record(value)['value']) : null;
const row = (label: string, value: FactRow['value'], unit?: string): FactRow => ({ label, value, ...(unit ? { unit } : {}) });
export function manualDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)).replace(',', '');
}
export function manualReadbackMatches(projection: ManualProjection, source: ManualReadbackSource | null): boolean {
  const d = projection.reviewDetails; const q = projection.claim?.quote; if (!d || !q || !source) return false;
  const { account, draft } = source; const choices = draft.choices;
  return account.account?.employeeId === d.binding.employeeId && (account['runId'] === undefined || account['runId'] === d.binding.runId)
    && draft.draftVersion === q.draftVersion && draft.contextVersion === q.contextVersion
    && choices.slotId === d.binding.entitlementSlotId && choices.mode === d.mode && choices.oldContractId === d.oldContractId
    && (q.driverId === null || choices.driverId === q.driverId);
}
export function manualContextRows(projection: ManualProjection, source: ManualReadbackSource | null): readonly FactRow[] {
  const d = projection.reviewDetails; if (!d) return [];
  const account = manualReadbackMatches(projection, source) ? source!.account : null;
  const locations = account?.choices?.['collectionLocations'];
  const location = Array.isArray(locations) ? locations.filter(manualObject).find((entry) => entry['locationId'] === d.requestedCollection.locationId) : null;
  const contract = d.contract ?? {}; const old = d.currentContract ?? {};
  const months = number(contract['months'] ?? contract['termMonths']); const mileage = number(contract['annualMileage']);
  return [row('Journey', d.mode === 'replacement' ? 'Replacement' : 'New order'),
    row('Requested collection', [manualDate(d.requestedCollection.date), text(location?.['label'])].filter(Boolean).join(', ') || null),
    row('Contract term', [months === null ? null : `${months} months`, mileage === null ? null : `${mileage.toLocaleString('en-GB')} ${text(contract['mileageUnit']) ?? 'miles a year'}`].filter(Boolean).join(', ') || null),
    row('Returning car', d.mode === 'replacement' ? [text(old['model']), text(old['registration'])].filter(Boolean).join(', ') || null : 'No car to return')];
}
export function manualReadbackCards(projection: ManualProjection, source: ManualReadbackSource | null): readonly ManualReadbackCard[] {
  const d = projection.reviewDetails; const account = manualReadbackMatches(projection, source) ? source!.account : null;
  const driver = account?.drivers?.find((entry) => entry.driverId === projection.claim?.quote.driverId);
  const licence = record(driver?.licence); const contract = d?.contract ?? {}; const old = d?.currentContract ?? {};
  const terms = projection.claim?.quote.terms ?? {}; const allowance = record(terms['allowanceInputs']);
  const locations = account?.choices?.['collectionLocations'];
  const location = Array.isArray(locations) ? locations.filter(manualObject).find((entry) => entry['locationId'] === d?.requestedCollection.locationId) : null;
  const relationships: Record<string, string> = { spouse: 'Spouse', partner: 'Partner', parent: 'Parent', child: 'Child', sibling: 'Sibling' };
  const choicesHint = 'Releases this car. Your choices are kept and you choose a car again.';
  const detailsHint = 'Keeps your reservation. You tick the declarations again.';
  return [
    { key: 'order', title: projection.claim?.hold.mode === 'replacement' ? 'Your replacement order' : 'Your new order',
      rows: [row('Name', account?.account?.name ?? null)], edit: 'car', label: 'Change car', hint: 'Releases this car so you can choose another.' },
    { key: 'driver', title: 'Driver and licence', rows: [row('Driver', driver?.name ?? null),
      row('Relationship', driver?.kind === 'employee' ? 'Self' : relationships[String(driver?.['relationship'])] ?? null),
      row('Licence number', text(licence['displayNumber'])), row('Licence categories', Array.isArray(licence['categories']) && licence['categories'].includes('car') ? 'Car' : null),
      row('Valid from', manualDate(licence['validFrom'])), row('Valid until', manualDate(licence['validUntil']))], edit: 'choices', label: 'Change order choices', hint: choicesHint },
    { key: 'points', title: 'Points and contract', rows: [row('Points cost', points(terms['points']), 'points a month'),
      row('Monthly allowance', points(allowance['allowance']), 'points a month'),
      row('Cash contribution', terms['contribution'] === null || record(terms['contribution'])['amount'] === 0 ? 'None' : null),
      row('Contract term', number(contract['months'] ?? contract['termMonths']), 'months'), row('Annual mileage', number(contract['annualMileage']), text(contract['mileageUnit']) ?? undefined)],
      edit: 'choices', label: 'Change order choices', hint: choicesHint },
    { key: 'collection', title: 'Collection', rows: [row('Requested collection date', manualDate(d?.requestedCollection.date)),
      row('Earliest collection date', manualDate(old['earliestCollectionDate'] ?? account?.slots?.find((slot) => slot.entitlementSlotId === d?.binding.entitlementSlotId)?.['earliestCollectionDate'])),
      row('Collection location', text(location?.['label']))], edit: 'choices', label: 'Change order choices', hint: `Collection is requested, not a confirmed appointment. ${choicesHint}` },
    { key: 'contact', title: 'Contact and requirements', rows: [row('Contact phone', d?.details.contact.phone ?? null), row('Contact email', d?.details.contact.email ?? null),
      row('Special requirements', d?.details.specialRequirements || 'None')], edit: 'contact', label: 'Change contact or requirements', hint: detailsHint },
    { key: 'return', title: 'Car you are returning', rows: projection.claim?.hold.mode === 'replacement' ? [row('Returning car', text(old['model'])), row('Registration', text(old['registration'])),
      row('Contract end date', manualDate(old['contractEndDate'])), row('Recorded odometer', number(record(old['currentOdometer'])['value']), text(record(old['currentOdometer'])['unit']) ?? undefined),
      row('Expected return mileage', d?.details.expectedReturnMileage ?? null, 'miles')] : [row('Returning car', 'No car to return')],
      edit: 'return', label: 'Change return mileage', hint: detailsHint },
  ];
}
export function manualCountdown(projection: ManualProjection) {
  const claim = projection.claim; if (!claim || projection.order) return null;
  const { hold, quote } = claim; const duration = hold.phase === 'preview' ? quote.timing?.previewSeconds : quote.timing?.reviewSeconds;
  const now = Math.max(Date.parse(claim.now), Date.parse(projection.reviewDetails?.now ?? claim.now)); const expires = Date.parse(hold.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || !Number.isSafeInteger(duration) || duration <= 0) return null;
  const seconds = Math.max(0, Math.ceil((expires - now) / 1000)); const expired = seconds === 0; const low = !expired && seconds <= duration / 4;
  const confirmed = (claim.state === 'quoted' || claim.state === 'expired') && projection.state !== 'unavailable' && projection.failure?.status !== 'unavailable';
  return { seconds, expired, low, confirmed,
    label: confirmed ? `${hold.phase === 'preview' ? 'Car reservation' : 'Order review'}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Reservation not confirmed',
    consequence: !confirmed ? 'This car is not shown as reserved until the claim is confirmed. Check current claim.'
      : projection.state === 'pending' || projection.state === 'uncertain' ? 'This action is still being checked. This car stays unavailable until its status is confirmed.'
      : expired ? `This deadline has passed. You cannot ${hold.phase === 'preview' ? 'continue' : 'submit'} with this reservation.`
        : `This car is reserved until the deadline. ${hold.phase === 'preview' ? 'Continuing does not place an order.' : 'Submitting places your order.'}`,
    announcementId: confirmed && (expired || low) ? JSON.stringify([hold.holdId, hold.phase, expired ? 'expired' : 'low']) : null,
    announcement: expired ? 'Your hold has expired. Refresh stock to choose a car.' : low ? 'Your hold is nearly over. Continue or cancel before it expires.' : '',
  };
}
