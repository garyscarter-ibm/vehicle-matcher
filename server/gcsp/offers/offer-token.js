import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const bindingValid = (binding) => ['environmentId', 'runId', 'offerId'].every((key) =>
  typeof binding?.[key] === 'string' && binding[key].length > 0);
const tokenValid = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

export function hashOfferToken(token, binding) {
  if (!tokenValid(token) || !bindingValid(binding)) throw new TypeError('Invalid offer token binding.');
  return createHash('sha256').update(JSON.stringify(['gcsp:offer-access:v1',
    binding.environmentId, binding.runId, binding.offerId, token])).digest('hex');
}

export function mintOfferToken(binding) {
  const token = randomBytes(32).toString('base64url');
  return { tokenHash: hashOfferToken(token, binding),
    tokenMetadata: { scheme: 'gcsp:offer-access:v1', randomBytes: 32 },
    offerLink: `/gcsp/offer?offerId=${encodeURIComponent(binding.offerId)}&runId=${encodeURIComponent(binding.runId)}#token=${token}` };
}

export function verifyOfferToken(token, binding, expectedHash) {
  if (!tokenValid(token) || !bindingValid(binding) || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) return false;
  return timingSafeEqual(Buffer.from(hashOfferToken(token, binding), 'hex'), Buffer.from(expectedHash, 'hex'));
}
