import { mountAccount } from '../account/gcsp-account.js';
import { mountManualSetup } from './gcsp-manual-setup.js';
import { mountManualGallery } from '../manual-gallery/gcsp-manual-gallery.js';
import { mountManualReview } from '../manual-review/gcsp-manual-review.js';

export function mountManualJourney(root, options = {}) {
  const { galleryAdapter, reviewAdapter, subscribeClock, onReviewContinue, ...shared } = options;
  let teardown; let disposed = false; let generation = 0; let view; let hint;
  function mount(next, render) {
    if (disposed) return;
    generation += 1; view = next;
    teardown?.(); teardown = render(generation);
  }
  // Let the emitting controller finish before disposing its screen.
  function later(ticket, work) {
    queueMicrotask(() => { if (!disposed && ticket === generation) work(); });
  }
  function account() { mount('account', () => mountAccount(root, shared)); }
  function setup(nextHint = hint) {
    hint = nextHint;
    mount('setup', (ticket) => mountManualSetup(root, { ...shared, hint, onBack: () => later(ticket, account) }));
  }
  function gallery() {
    mount('gallery', (ticket) => mountManualGallery(root, { brand: shared.brand, adapter: galleryAdapter,
      commandId: shared.commandId,
      onBack() {
        // Keep the unresolved attempt and its retry command in its existing controller.
        if (teardown?.claim.getState().blocked !== false) return;
        later(ticket, () => setup());
      },
      onClaimState(state) {
        // Reloaded claims have no new selection descriptor; review rereads authority.
        if (state.state === 'existing-claim' && state.claim?.status === 'ok'
          && state.claim.value?.state === 'quoted' && state.claim.value.pendingOperation === null
          && state.claim.value.hold?.state === 'active') later(ticket, () => review());
      },
      onClaimConfirmed(detail) { later(ticket, () => review(detail)); },
    }));
  }
  function review(handoff) {
    mount('review', (ticket) => mountManualReview(root, { brand: shared.brand, adapter: reviewAdapter,
      commandId: shared.commandId, handoff,
      onContinue(detail) { if (!disposed && ticket === generation) onReviewContinue?.(detail); },
      onReleased() { later(ticket, gallery); },
      onBrowse() { later(ticket, gallery); },
    }));
  }
  const start = (event) => {
    if (!disposed && event.target === root && view === 'account') setup(event.detail);
  };
  const ready = (event) => {
    if (!disposed && event.target === root && view === 'setup') {
      hint = event.detail; later(generation, gallery);
    }
  };
  root.addEventListener('gcsp:journey-start', start);
  root.addEventListener('gcsp:setup-ready', ready);
  const unsubscribe = subscribeClock?.(() => {
    if (disposed) return;
    if (view === 'gallery') { teardown?.gallery.refresh(); teardown?.claim.checkStatus(); }
    else if (view === 'review' || view === 'setup') teardown?.refresh();
  });
  account();
  return () => {
    if (disposed) return;
    disposed = true; generation += 1; unsubscribe?.();
    root.removeEventListener('gcsp:journey-start', start);
    root.removeEventListener('gcsp:setup-ready', ready); teardown?.();
  };
}
