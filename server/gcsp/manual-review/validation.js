import { result } from '../repository/core.js';

export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const only = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
export const identifier = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
export const revision = (value) => Number.isSafeInteger(value) && value >= 0;
export const invalid = (field, reason) => result('invalid', { code: 'invalid-review-details', reasons: [{ field, reason }],
  view: { state: 'validation', editable: true, action: 'correct-fields', supportOwner: 'employee' } });
export function validateCommand(input) {
  if (!only(input, ['commandId', 'holdId', 'quoteId', 'expectedHoldVersion', 'expectedDraftVersion',
    'expectedReviewDetailsVersion', 'details'])) return invalid('command', 'Use only the documented review fields.');
  for (const field of ['commandId', 'holdId', 'quoteId']) if (!identifier(input[field])) return invalid(field, 'Supply a nonempty identifier of at most 100 characters.');
  for (const field of ['expectedHoldVersion', 'expectedDraftVersion', 'expectedReviewDetailsVersion']) {
    if (!revision(input[field]) || field !== 'expectedReviewDetailsVersion' && input[field] === 0) return invalid(field, 'Supply the current integer revision.');
  }
  return null;
}
export function validateDetails(details, mode, constraints) {
  if (!only(details, ['contact', 'expectedReturnMileage', 'specialRequirements'])) return invalid('details', 'Use only the documented detail fields.');
  if (!only(details.contact, ['phone', 'email'])) return invalid('contact', 'Supply only phone and email.');
  if (typeof details.contact.phone !== 'string' || !/^\+?[0-9 ()-]{7,30}$/.test(details.contact.phone)) return invalid('contact.phone', 'Supply a contact telephone.');
  if (typeof details.contact.email !== 'string' || details.contact.email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.contact.email)) return invalid('contact.email', 'Supply a contact email address.');
  if (mode === 'replacement' && (!Number.isSafeInteger(details.expectedReturnMileage) || details.expectedReturnMileage < 0
    || details.expectedReturnMileage > constraints.maximumReturnMileage)
    || mode === 'new' && details.expectedReturnMileage != null) return invalid('expectedReturnMileage',
    mode === 'replacement' ? `Supply returning-car mileage from 0 to ${constraints.maximumReturnMileage} miles.` : 'Returning-car mileage applies only to a replacement.');
  if (typeof details.specialRequirements !== 'string' || details.specialRequirements.length > constraints.maximumSpecialRequirements
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(details.specialRequirements)) return invalid('specialRequirements',
    `Use at most ${constraints.maximumSpecialRequirements} characters. Requests do not change released stock.`);
  return null;
}
export const safeDetails = (details) => ({ contact: { phone: details.contact.phone, email: details.contact.email },
  expectedReturnMileage: details.expectedReturnMileage ?? null, specialRequirements: details.specialRequirements });
