// Pure helpers: submit body, refusal copy and one readback shared by the live review and the placed order.
import { orderReferenceOf } from '../kit/order-identity.js';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => v != null && v !== '';
const points = (v) => v?.unit === 'points' && Number.isFinite(v.value) ? v.value : null;

export const longDate = (value) => /^\d{4}-\d\d-\d\d$/.test(value ?? '') && Number.isFinite(Date.parse(value))
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : value ?? null;

// Words come from these maps, never from raw data codes. An unmapped value is omitted.
const RELATIONSHIPS = { spouse: 'Spouse', partner: 'Partner', parent: 'Parent', child: 'Child', sibling: 'Sibling' };
const LICENCE = { car: 'Car' };
const STAGES = { 'selection received': 'Selection received', 'HR approval': 'HR approval', 'sales-manager approval': 'Sales manager approval',
  'sent to ordering': 'Sent to ordering' };
export const relationshipLabel = (driver) => driver ? driver.kind === 'employee' ? 'Self' : RELATIONSHIPS[driver.relationship] ?? null : null;
export const licenceLabel = (categories) => (Array.isArray(categories) ? categories.map((c) => LICENCE[c]).filter(Boolean).join(', ') : '') || null;
export const stageLabel = (name) => STAGES[name] ?? name;

export const applicableDeclarations = (terms, mode) => (terms?.declarations ?? [])
  .filter((entry) => entry.appliesTo === 'all' || entry.appliesTo === mode);

// Required inputs the employee must supply, as opposed to historic values that may simply be absent.
export function missingInputs(model) {
  const details = model?.details ?? {}; const missing = [];
  if (!present(details.contact?.phone)) missing.push('Contact phone');
  if (!present(details.contact?.email)) missing.push('Contact email');
  if (model?.mode === 'replacement' && !Number.isFinite(details.expectedReturnMileage)) missing.push('Expected returning-car mileage');
  return missing;
}

export function submitBody(commandId, model, terms, ticks) {
  const b = model.binding;
  return { commandId, source: { type: 'cart', holdId: b.holdId, expectedHoldVersion: b.expectedHoldVersion, expectedDraftVersion: b.expectedDraftVersion },
    expectedQuoteId: b.quoteId, expectedStockVersion: model.stockVersion, termsDigest: terms.termsDigest,
    declarations: Object.fromEntries(applicableDeclarations(terms, model.mode).map((entry) => [entry.id, ticks[entry.id] === true])),
    expectedReviewDetailsVersion: model.reviewDetailsVersion };
}

const expired = ['Your reservation has expired. Your entries are retained. Refresh stock to choose again.', ['browse']];
const changed = ['Your reservation or details changed. Check the current claim before trying again.', []];
// Message and extra recovery actions per refusal. The claim reread is always offered.
export const REFUSALS = Object.freeze({
  'terms-changed': ['The terms have changed. Read the updated terms and tick each declaration again.', []],
  'claim-expired': expired, 'quote-expired': expired,
  'claim-changed': changed, 'quote-changed': changed, 'stale-version': changed,
  'review-details-locked': ['Your details are locked while an order is checked. Check the order status.', ['status']],
  'stock-changed': ['This car has changed or been taken. Change car, or refresh stock to choose again.', ['browse']],
  'active-selection-exists': ['You already have an order in progress. Check its status.', ['status']],
  default: ['This order could not be placed. Check the current claim, then try again or change your choices.', []],
});
export const refusalFor = (reason) => REFUSALS[reason] ?? REFUSALS.default;

// The returned state only. An order is never "approved" here: approval belongs to the lifecycle service.
export function outcomeView(order) {
  const state = order?.progress?.selectionState;
  if (state === 'acknowledged') return { key: 'awaiting-approval', title: 'Order received', status: 'Awaiting approval',
    message: 'Your order has reached ordering and is awaiting approval.', final: true };
  if (state === 'handoff-failed') return { key: 'handoff-failed', title: 'Order not sent', status: 'Handoff failed', final: true,
    message: 'Your order is saved, but it could not be sent to ordering. Contact scheme support.' };
  return { key: 'handoff-pending', title: 'Order saved', status: 'Handoff pending', final: false,
    message: order?.operationState === 'unknown' ? 'We could not confirm the handoff to ordering yet. Check again. Checking never creates another order.'
      : 'Your order is saved and is being sent to ordering. Check again shortly.' };
}

/** One normalised readback. `live` comes from the review read plus account and draft; `order` from the stored selection. */
export function readbackFor({ model, selection, account, draft }) {
  const a = account?.value ?? account ?? null; const live = Boolean(model);
  const locations = a?.choices?.collectionLocations ?? [];
  const choices = live ? draft?.choices : selection?.draft?.choices;
  const locationId = live ? model.requestedCollection?.locationId : choices?.collectionLocationId;
  const driver = live ? a?.drivers?.find((entry) => entry.driverId === draft?.choices?.driverId) : selection?.driver;
  const mode = live ? model.mode : choices?.mode;
  const frozen = selection?.reviewDetails?.details;
  const details = live ? model.details : frozen ?? { contact: choices?.contact, expectedReturnMileage: choices?.expectedReturnMileage, specialRequirements: choices?.specialRequirements };
  const old = live ? model.currentContract : selection?.oldContract;
  const slot = (a?.slots ?? []).find((entry) => entry.entitlementSlotId === (live ? model.binding.entitlementSlotId : selection?.vehicleSlot?.entitlementSlotId));
  const quote = live ? model.quote : selection?.quote; const terms = quote?.terms?.kind === 'employee-scheme' ? quote.terms : null;
  return { mode, orderNumber: live ? model.orderNumber : selection?.stock?.orderNumber, orderReference: orderReferenceOf(selection?.orderReference), quote,
    employee: live ? a?.account : selection?.employee, driver,
    contract: live ? model.contract : selection?.draft?.contract,
    requested: live ? model.requestedCollection?.date : choices?.requestedCollectionDate,
    earliest: old?.earliestCollectionDate ?? slot?.earliestCollectionDate ?? a?.currentContract?.earliestCollectionDate ?? null,
    location: locations.find((entry) => entry.locationId === locationId)?.label ?? null,
    details: { contact: details?.contact ?? {}, expectedReturnMileage: details?.expectedReturnMileage ?? null, specialRequirements: details?.specialRequirements ?? '' },
    old: mode === 'replacement' && object(old) ? old : null,
    points: { cost: points(terms?.points), allowance: points(terms?.allowanceInputs?.allowance) } };
}
