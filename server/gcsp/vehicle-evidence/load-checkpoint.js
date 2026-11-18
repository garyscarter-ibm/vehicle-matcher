import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';

// File I/O and already-resolved promises do not bound the CPU work between
// timer/HTTP turns. Keep each record's existing validation atomic, then give
// other work a turn after a small elapsed budget while restoring the corpus.
export function createLoadCheckpoint() {
  let resumed = performance.now();
  return async () => {
    if (performance.now() - resumed < 8) return;
    await setImmediate();
    resumed = performance.now();
  };
}
