import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const bindingValid = (binding) => ['environmentId', 'runId', 'offerId'].every((key) =>
  typeof binding?.[key] === 'string' && binding[key].length > 0);
const tokenValid = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
const localLandingBase = 'https://gcsp-landing.invalid'; // Parsing only; never emitted as a destination.

// Trusted deployment input, shared by both producers. The local demo keeps its
// same-origin alias; a static deployment can supply its full HTTPS page URL.
export function resolveOfferLandingUrl(value = '/gcsp/offer') {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || /[\u0000-\u0020\u007f\\#]/.test(value)) throw new TypeError('Invalid offer landing URL.');
  const relative = /^\/(?!\/)/.test(value);
  const url = new URL(value, relative ? localLandingBase : undefined);
  if (url.protocol !== 'https:' || url.username || url.password
    || ['token', 'offerId', 'runId'].some((key) => url.searchParams.has(key))) throw new TypeError('Invalid offer landing URL.');
  return relative ? `${url.pathname}${url.search}` : url.href;
}

export function hashOfferToken(token, binding) {
  if (!tokenValid(token) || !bindingValid(binding)) throw new TypeError('Invalid offer token binding.');
  return createHash('sha256').update(JSON.stringify(['gcsp:offer-access:v1',
    binding.environmentId, binding.runId, binding.offerId, token])).digest('hex');
}

export function mintOfferToken(binding, { offerLandingUrl } = {}) {
  const landing = resolveOfferLandingUrl(offerLandingUrl);
  const url = new URL(landing, localLandingBase);
  url.searchParams.set('offerId', binding.offerId);
  url.searchParams.set('runId', binding.runId);
  const token = randomBytes(32).toString('base64url');
  url.hash = `token=${token}`;
  return { tokenHash: hashOfferToken(token, binding),
    tokenMetadata: { scheme: 'gcsp:offer-access:v1', randomBytes: 32 },
    offerLink: landing.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.href };
}

export function verifyOfferToken(token, binding, expectedHash) {
  if (!tokenValid(token) || !bindingValid(binding) || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) return false;
  return timingSafeEqual(Buffer.from(hashOfferToken(token, binding), 'hex'), Buffer.from(expectedHash, 'hex'));
}
