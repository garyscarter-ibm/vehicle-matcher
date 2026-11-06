const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => revision(v) && v > 0;
const instant = (v) => typeof v === 'string' && /Z$/.test(v) && Number.isFinite(Date.parse(v));
const only = (v, fields) => object(v) && Object.keys(v).every((k) => fields.includes(k));
export const copyReviewDetails = (v) => ({ contact: { phone: v?.contact?.phone ?? '', email: v?.contact?.email ?? '' },
  expectedReturnMileage: v?.expectedReturnMileage ?? null, specialRequirements: v?.specialRequirements ?? '' });
export const sameReviewDetails = (a, b) => JSON.stringify(copyReviewDetails(a)) === JSON.stringify(copyReviewDetails(b));
export const reviewIdentity = (v) => JSON.stringify(['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId'].map((k) => v.binding[k]));
const unavailable = (code) => ({ status: 'unavailable', code, retryable: true });

export function validateReviewDetails(details, mode, constraints) {
  const fail = (field, reason) => [{ field, reason }];
  if (!only(details, ['contact', 'expectedReturnMileage', 'specialRequirements'])) return fail('details', 'Use only the documented detail fields.');
  if (!only(details.contact, ['phone', 'email'])) return fail('contact', 'Supply only phone and email.');
  if (typeof details.contact.phone !== 'string' || !/^\+?[0-9 ()-]{7,30}$/.test(details.contact.phone)) return fail('contact.phone', 'Supply a contact telephone.');
  if (typeof details.contact.email !== 'string' || details.contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.contact.email)) return fail('contact.email', 'Supply a contact email address.');
  if (!['replacement', 'new'].includes(mode) || !positive(constraints?.maximumSpecialRequirements) || !positive(constraints?.maximumReturnMileage)) return fail('details', 'Refresh the review rules.');
  if (mode === 'replacement' && (!revision(details.expectedReturnMileage) || details.expectedReturnMileage > constraints.maximumReturnMileage)
    || mode === 'new' && details.expectedReturnMileage != null) return fail('expectedReturnMileage', mode === 'replacement'
    ? `Supply returning-car mileage from 0 to ${constraints.maximumReturnMileage} miles.` : 'Returning-car mileage applies only to a replacement.');
  if (typeof details.specialRequirements !== 'string' || details.specialRequirements.length > constraints.maximumSpecialRequirements
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(details.specialRequirements)) return fail('specialRequirements', `Use at most ${constraints.maximumSpecialRequirements} characters. Requests do not change released stock.`);
  return [];
}

export function reviewCountdown(model) {
  const hold = model?.hold; const timing = model?.quote?.eligibility?.timing;
  const durationSeconds = hold?.phase === 'preview' ? timing?.preview : hold?.phase === 'order-review' ? timing?.review : null;
  if (!positive(durationSeconds) || !instant(model?.now) || !instant(hold?.expiresAt)) return null;
  const secondsRemaining = Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - Date.parse(model.now)) / 1000));
  return { secondsRemaining, durationSeconds, expired: secondsRemaining === 0, lowTime: secondsRemaining > 0 && secondsRemaining <= durationSeconds / 4,
    phase: hold.phase, expiresAt: hold.expiresAt, now: model.now };
}

// These are two server reads, never a gallery-held flag. Require one exact identity and revision.
export function toManualReviewModel(claim, details, { handoff, expectedIdentity } = {}) {
  if (claim?.status !== 'ok') return claim?.status === 'pending' ? { status: 'pending', code: 'claim-pending', claim } : claim ?? unavailable('claim-unavailable');
  if (details?.status !== 'ok') return details ?? unavailable('details-unavailable');
  const c = claim.value; const d = details.value; const b = d?.binding; const h = c?.hold; const q = c?.quote;
  if (!object(c) || !object(d) || !object(b) || !object(h) || !object(q) || !object(d.hold) || !object(d.quote)
    || !['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId'].every((key) => text(b[key]))
    || !positive(b.expectedHoldVersion) || !positive(b.expectedDraftVersion) || !revision(d.reviewDetailsVersion)
    || !['replacement', 'new'].includes(d.mode) || !object(d.details) || !object(d.details.contact)
    || !['phone', 'email'].every((key) => typeof d.details.contact[key] === 'string') || typeof d.details.specialRequirements !== 'string'
    || !/^[0-9]{7}$/.test(d.orderNumber) || !instant(c.now) || c.now !== d.now || !/^[1-9][0-9]*$/.test(d.clockVersion)
    || c.clockVersion !== d.clockVersion || !instant(h.expiresAt) || !instant(q.validUntil)
    || ['runId', 'employeeId', 'entitlementSlotId'].some((key) => h[key] !== b[key] || q[key] !== b[key] || d.hold[key] !== b[key] || d.quote[key] !== b[key])
    || h.holdId !== b.holdId || d.hold.holdId !== b.holdId || h.quoteId !== b.quoteId || d.hold.quoteId !== b.quoteId
    || q.quoteId !== b.quoteId || d.quote.quoteId !== b.quoteId || h.version !== b.expectedHoldVersion || d.hold.version !== h.version
    || !positive(q.version) || d.quote.version !== q.version
    || q.draftVersion !== b.expectedDraftVersion || d.quote.draftVersion !== q.draftVersion
    || !text(h.orderUuid) || [q.orderUuid, d.hold.orderUuid, d.quote.orderUuid].some((v) => v !== h.orderUuid)
    || !text(q.configurationId) || d.quote.configurationId !== q.configurationId || h.expiresAt !== d.hold.expiresAt
    || h.phase !== d.hold.phase || h.state !== d.hold.state || h.type !== 'cart'
    || !text(q.policyVersion) || [h.policyVersion, d.quote.policyVersion].some((v) => v !== q.policyVersion)
    || !positive(d.constraints?.maximumSpecialRequirements) || !positive(d.constraints?.maximumReturnMileage)
    || d.constraints.provenance?.policyVersion !== q.policyVersion || d.constraints.provenance?.key !== 'manual.context.v1'
    || d.constraints.mileageUnit !== 'mi' || d.constraints.textLengthUnit !== 'UTF-16 code units') return unavailable('review-authority-invalid');
  const model = { ...structuredClone(d), claim: structuredClone(c) };
  if (expectedIdentity && reviewIdentity(model) !== expectedIdentity) return { status: 'conflict', code: 'review-identity-changed' };
  if (handoff) {
    const selected = handoff.claim?.value;
    if (handoff.claim?.status !== 'ok' || !selected?.hold || !selected?.quote
      || ['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId', 'orderUuid'].some((key) => selected.hold[key] !== h[key])
      || ['quoteId', 'orderUuid', 'configurationId', 'draftVersion', 'policyVersion'].some((key) => selected.quote[key] !== q[key])) return { status: 'conflict', code: 'review-handoff-mismatch' };
  }
  const countdown = reviewCountdown(model);
  if (!countdown || !positive(q.eligibility?.timing?.preview) || !positive(q.eligibility?.timing?.review)) return unavailable('review-timing-unavailable');
  const pending = c.pendingOperation !== null && c.pendingOperation !== undefined || h.state.endsWith('-pending');
  const active = h.state === 'active' && !pending && !d.frozen && d.editable === true && d.canContinue === true
    && !countdown.expired && Date.parse(d.now) < Date.parse(q.validUntil);
  return { status: 'ok', value: model, countdown, active, pending,
    state: pending ? 'pending' : d.frozen ? 'locked' : countdown.expired && h.state === 'active' ? 'expired' : h.state === 'active' ? active ? 'ready' : 'unavailable' : h.state };
}
