import { validInstant } from '../policy/file-provider.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const SAME_AGAIN_FIELDS = ['on', 'contractId', 'source', 'setAt'];

// The stored Same again intent for the current car: explicit, per contract, never used for ranking.
export const sameAgainValid = (s) => plain(s) && Reflect.ownKeys(s).every((k) => SAME_AGAIN_FIELDS.includes(k))
  && SAME_AGAIN_FIELDS.every((k) => Object.hasOwn(s, k)) && typeof s.on === 'boolean'
  && typeof s.contractId === 'string' && s.contractId.trim().length > 0 && s.contractId.length <= 128
  && s.source === 'employee' && validInstant(s.setAt);
