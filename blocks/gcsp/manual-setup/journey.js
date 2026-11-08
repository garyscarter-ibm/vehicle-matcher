import { mountAccount } from '../account/gcsp-account.js';
import { mountManualSetup } from './gcsp-manual-setup.js';
import { mountManualGallery } from '../manual-gallery/gcsp-manual-gallery.js';
import { mountManualReview } from '../manual-review/gcsp-manual-review.js';
import { createManualClaimController } from '../manual-gallery/claim-controller.js';
import { createManualGalleryHttpAdapter } from '../manual-gallery/http-adapter.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { statusScreen } from '../../vehicle-matcher/ui.js';

export function mountManualJourney(root, options = {}) {
  const { galleryAdapter, reviewAdapter, subscribeClock, onReviewContinue, ...shared } = options;
  const claimAdapter = galleryAdapter ?? createManualGalleryHttpAdapter();
  let teardown; let disconnectFocus; let disposed = false; let generation = 0; let view; let hint;
  function mount(next, render) {
    if (disposed) return;
    generation += 1; view = next;
    disconnectFocus?.();
    teardown?.();
    const ticket = generation; let focused = null;
    // Refocus when a transient loading heading is replaced and focus falls to the body.
    const focus = () => {
      if (disposed || ticket !== generation || focused?.isConnected) return;
      const active = root.ownerDocument.activeElement;
      if (focused && active && active !== root.ownerDocument.body) return;
      const heading = root.querySelector('main h1, main h2');
      if (!heading) return;
      heading.tabIndex = -1; heading.focus(); focused = heading;
    };
    const observer = new root.ownerDocument.defaultView.MutationObserver(focus);
    observer.observe(root, { childList: true, subtree: true });
    disconnectFocus = () => observer.disconnect();
    teardown = render(ticket);
    focus();
  }
  // Let the emitting controller finish before disposing its screen.
  function later(ticket, work) {
    queueMicrotask(() => { if (!disposed && ticket === generation) work(); });
  }
  function account() { mount('account', () => mountAccount(root, shared)); }
  function enter(nextHint) {
    hint = nextHint;
    mount('checking', (ticket) => {
      const reader = createManualClaimController({ adapter: claimAdapter });
      const shell = mountEmployee(root, { brand: shared.brand,
        async loadAccount({ signal }) {
          const result = await (shared.adapter ?? claimAdapter).readAccount({ signal });
          return result?.status === 'ok' ? { status: 'ready', name: result.value.account?.name,
            context: [result.value.account?.companyId, result.value.account?.gradeId].filter(Boolean).join(', ') }
            : { status: 'unavailable' };
        },
        renderBody(main) {
          const status = statusScreen({ title: 'Checking your saved journey',
            message: 'Reading your current reservation.' });
          status.setAttribute('aria-busy', 'true'); main.replaceChildren(status);
        },
      });
      const recover = (state) => later(ticket, () => {
        // Only the existing reader's explicit nonoccupying proof permits a
        // draft-editing screen. Gallery and review reread all claim authority.
        if (state?.blocked === false && ['ready', 'released'].includes(state.state)) setup();
        else gallery();
      });
      reader.load().then(recover, () => recover(null));
      return () => { reader.destroy(); shell(); };
    });
  }
  function setup(nextHint = hint) {
    hint = nextHint;
    mount('setup', (ticket) => mountManualSetup(root, { ...shared, hint, onBack: () => later(ticket, account) }));
  }
  function gallery() {
    mount('gallery', (ticket) => mountManualGallery(root, { brand: shared.brand, adapter: claimAdapter,
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
    if (!disposed && event.target === root && view === 'account') later(generation, () => enter(event.detail));
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
    disposed = true; generation += 1; unsubscribe?.(); disconnectFocus?.();
    root.removeEventListener('gcsp:journey-start', start);
    root.removeEventListener('gcsp:setup-ready', ready); teardown?.();
  };
}
