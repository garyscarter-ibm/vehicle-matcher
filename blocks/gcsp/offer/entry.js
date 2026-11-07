import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { mountOffer } from './gcsp-offer.js';
import { createOfferHttpAdapter } from './http-adapter.js';
import { toOfferPresentation } from './offer-projection.js';
import { mountFollowupBody } from '../offer-followup/gcsp-offer-followup.js';

// Both account reads use the ordinary employee session; offer access remains independently scoped.
export function mountOfferEntry(root, { fetch: request = globalThis.fetch, location = globalThis.location,
  history = globalThis.history } = {}) {
  const abort = new AbortController(); let disposed = false; let cleanup;
  // Capture and remove any email fragment synchronously, before the first account request.
  const offer = createOfferHttpAdapter({ fetch: request, location, history, enableDecisions: true });
  const account = createAccountHttpAdapter({ fetch: request });
  root.textContent = 'Loading your offer.';
  root.setAttribute('aria-busy', 'true');
  void (async () => {
    const current = await account.loadAccount({ signal: abort.signal });
    if (disposed) return;
    root.removeAttribute('aria-busy');
    cleanup = mountOffer(root, { ...offer, account: current,
      followup: { loadAccount: account.loadAccount,
        mount: (host, { decisionId, signal }) => mountFollowupBody(host, { decisionId, signal,
          fetchImpl: request, projectOffer: toOfferPresentation,
          openOffer: ({ offerId, runId }) => location.assign(`/gcsp/offer?offerId=${encodeURIComponent(offerId)}&runId=${encodeURIComponent(runId)}`) }) } });
  })();
  return () => {
    if (disposed) return;
    disposed = true; abort.abort(); cleanup?.(); root.removeAttribute('aria-busy'); root.replaceChildren();
  };
}
