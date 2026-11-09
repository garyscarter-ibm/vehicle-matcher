import { isAccessLapsed } from '../kit/run-restarted.js';
import { toOfferPresentation } from '../offer/offer-projection.js';
// Fixed browser endpoints. Trusted identity/run/access remain server and host responsibilities.
const unavailable = () => ({ status: 'unavailable' });
export function createActivityHttpAdapter({ fetch: request = globalThis.fetch, loadAccount } = {}) {
  async function send(path, method, body, signal) {
    if (typeof request !== 'function') return unavailable();
    try {
      const response = await request(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const out = await response.json().catch(() => null);
      if (isAccessLapsed(response.status, out)) return { status: 'access-required' };
      return typeof out?.status === 'string' && (out.status !== 'ok' || response.ok) ? out : unavailable();
    } catch { return unavailable(); }
  }
  const command = (operation, { commandId, expectedBriefVersion, signal } = {}) => {
    if (typeof commandId !== 'string' || !commandId.trim() || !Number.isSafeInteger(expectedBriefVersion) || expectedBriefVersion < 1) return Promise.resolve({ status: 'invalid' });
    return send(`/api/gcsp/brief/${operation}`, 'POST', { commandId, expectedBriefVersion }, signal);
  };
  // Display only: the offer view's own validation decides trust; anything else is no display.
  async function readOfferDisplay({ offerId, runId, signal } = {}) {
    if (typeof offerId !== 'string' || !offerId.trim() || typeof runId !== 'string' || !runId.trim()) return null;
    const out = await send(`/api/gcsp/offers/${encodeURIComponent(offerId)}?runId=${encodeURIComponent(runId)}`, 'GET', undefined, signal);
    if (toOfferPresentation(out, { reference: { offerId, runId } }).status !== 'ok') return null;
    const display = out.value.quote.facts.display;
    return { offerRef: { offerId }, title: display.name, images: display.images.map(({ src, alt, caption, fidelity }) => ({ src, alt, caption, fidelity })) };
  }
  return { loadAccount, readActivity: ({ signal } = {}) => send('/api/gcsp/activity', 'GET', undefined, signal),
    readOfferDisplay, pause: (input) => command('pause', input), resume: (input) => command('resume', input) };
}
