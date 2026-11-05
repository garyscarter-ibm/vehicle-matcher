// Each consumer owns a feed; only its newest scheduled answer may deliver a result.
// Painting and loading presentation remain the consumer's responsibility.

import { apiPreview } from '../engine.js';

// How long after an answer changes before the preview refetches. Multi-select
// rapid taps collapse into one call; a fresh answer resets the timer.
export const PREVIEW_DEBOUNCE_MS = 250;

// schedule() invalidates earlier callbacks immediately, including during debounce.
// cancel() invalidates timers and dispatched callbacks; consumers call it on teardown.
export function createPreviewFeed({
  api, retailer, brand, scope, group = false,
}) {
  let timer = null;
  let seq = 0;

  return {
    schedule(answers, onResult) {
      const mine = (seq += 1);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Keep the request about the answers at dispatch, as the caller keeps editing.
        const snapshot = { ...answers };
        apiPreview(api, snapshot, retailer, brand, scope, group).then((matches) => {
          // apiPreview maps failures to []; stale failures must be dropped too.
          if (mine !== seq) return;
          onResult(matches);
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
