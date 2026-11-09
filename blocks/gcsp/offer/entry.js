import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { mountOffer } from './gcsp-offer.js';
import { createOfferHttpAdapter } from './http-adapter.js';
import { toOfferPresentation } from './offer-projection.js';
import { mountFollowupBody } from '../offer-followup/gcsp-offer-followup.js';
import { mountOrderProgress } from '../order-progress/gcsp-order-progress.js';
import { createOrderProgressHttpAdapter } from '../order-progress/order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { PORTAL_ROUTES, signedInPortal } from './portal-links.js';

// Both account reads use the ordinary employee session; offer access remains independently scoped.
export function mountOfferEntry(root, { fetch: request = globalThis.fetch, location = globalThis.location,
  history = globalThis.history } = {}) {
  const abort = new AbortController(); let disposed = false; let cleanup;
  // Capture and remove any email fragment synchronously, before the first account request.
  // Loopback http is allowed so the hosted entry works on http://localhost; any other host needs https.
  const offer = createOfferHttpAdapter({ fetch: request, location, history, enableDecisions: true, allowInsecureLocalhost: true });
  const account = createAccountHttpAdapter({ fetch: request });
  const progress = createOrderProgressHttpAdapter({ fetch: request });
  const helpAdapter = createCaseHttpAdapter({ fetchImpl: request });
  root.textContent = 'Loading your offer.';
  root.setAttribute('aria-busy', 'true');
  void (async () => {
    const current = await account.loadAccount({ signal: abort.signal });
    if (disposed) return;
    root.removeAttribute('aria-busy');
    cleanup = mountOffer(root, { ...offer, account: current, ...signedInPortal(current, location),
      order: { mount: (host, { orderUuid, car, announce }) => mountOrderProgress(host, { adapter: progress, helpAdapter, orderUuid, car, announce,
        embedded: true, headingLevel: 2, signal: abort.signal }) },
      followup: { loadAccount: account.loadAccount,
        mount: (host, { decisionId, signal, announce }) => mountFollowupBody(host, { decisionId, signal, announce, hostRefresh: true, headingLevel: 2, activityHref: PORTAL_ROUTES.activity,
          fetchImpl: request, projectOffer: toOfferPresentation,
          openOffer: ({ offerId, runId }) => location.assign(`/gcsp/offer?offerId=${encodeURIComponent(offerId)}&runId=${encodeURIComponent(runId)}`) }) } });
  })();
  return () => {
    if (disposed) return;
    disposed = true; abort.abort(); cleanup?.(); root.removeAttribute('aria-busy'); root.replaceChildren();
  };
}
