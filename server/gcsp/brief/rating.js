import { validInstant } from '../policy/file-provider.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const RATING_FIELDS = ['value', 'contractId', 'source', 'ratedAt'];

// The stored current-car star rating: an integer 1-5, or null once the employee clears it.
export const currentCarRatingValid = (r) => plain(r) && Reflect.ownKeys(r).every((k) => RATING_FIELDS.includes(k))
  && RATING_FIELDS.every((k) => Object.hasOwn(r, k)) && (r.value === null || Number.isSafeInteger(r.value) && r.value >= 1 && r.value <= 5)
  && typeof r.contractId === 'string' && r.contractId.trim().length > 0 && r.contractId.length <= 128
  && r.source === 'employee' && validInstant(r.ratedAt);
