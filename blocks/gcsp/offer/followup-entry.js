/** A verified read supplies a selector only; the follow-up still needs its own employee session. */
export function followupHandle(value, state) {
  if (state !== 'declined' || value === null || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const keys = Reflect.ownKeys(value);
  return keys.length === 1 && keys[0] === 'decisionId' && typeof value.decisionId === 'string' && value.decisionId.length === 79
    && /^offer-decision:[a-f0-9]{64}$/.test(value.decisionId) ? { decisionId: value.decisionId } : null;
}
