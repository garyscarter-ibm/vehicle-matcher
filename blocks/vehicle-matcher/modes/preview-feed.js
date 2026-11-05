// Each consumer owns a feed; only its newest scheduled answer may deliver a result.
// Painting and loading presentation remain the consumer's responsibility.

import { apiPreview } from '../engine.js';

// How long after an answer changes before the preview refetches. Multi-select
// rapid taps collapse into one call; a fresh answer resets the timer.
export const PREVIEW_DEBOUNCE_MS = 250;

// schedule() invalidates earlier callbacks immediately, including during debounce.
// cancel() invalidates timers and dispatched callbacks; consumers call it on teardown.
export function createPreviewFeed({
  api, retailer, brand, scope, group = false, load, onError,
} = {}) {
  let timer = null;
  let seq = 0;

  return {
    schedule(answers, onResult, handleError = onError) {
      const mine = (seq += 1);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Deep-copy at dispatch so later nested edits cannot change the request.
        let pending;
        try {
          const snapshot = structuredClone(answers);
          pending = load ? load(snapshot) : apiPreview(api, snapshot, retailer, brand, scope, group);
        } catch (error) { pending = Promise.reject(error); }
        Promise.resolve(pending).then((matches) => {
          if (mine === seq) onResult(matches);
        }, (error) => {
          if (mine !== seq) return;
          if (handleError) handleError(error);
          else onResult([]);
        });
      }, PREVIEW_DEBOUNCE_MS);
    },
    cancel() {
      seq += 1;
      clearTimeout(timer);
      timer = null;
    },
  };
}
