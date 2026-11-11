import { buddyEngaged } from '../kit/buddy-status.js';
import { isRunRestarted } from '../kit/run-restarted.js';

// Client sequencing only. Server outcomes remain the permission and activity authority.
const unavailable = () => ({ status: 'unavailable' });
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const projection = (out) => out?.status === 'ok' && out.value && Array.isArray(out.value.offers)
  && Array.isArray(out.value.stateChanges) && (out.value.permission === null
    || typeof out.value.permission?.paused === 'boolean' && typeof out.value.permission?.canSearch === 'boolean');

export function createActivityController({ adapter = {}, onChange, createCommandId = () => globalThis.crypto?.randomUUID?.() } = {}) {
  let state = { phase: 'loading', result: null, pending: false, message: '' };
  let generation = 0; let disposed = false; let readAbort; let commandAbort;
  const getState = () => structuredClone(state);
  function publish(next) { state = next; if (!disposed) onChange?.(getState()); }
  const signature = (value) => JSON.stringify([value.result, value.offerDisplay ?? null]);
  async function load({ pending = false, message = '', quiet = false, expectedEngaged } = {}) {
    if (disposed) return getState();
    const current = ++generation; readAbort?.abort(); const abort = new AbortController(); readAbort = abort;
    if (!pending) publish({ phase: 'loading', result: null, pending: false, message: '' });
    let out;
    try { out = await adapter.readActivity?.({ signal: abort.signal }); } catch { out = unavailable(); }
    if (disposed || abort.signal.aborted || current !== generation) return getState();
    if (isRunRestarted(out)) { publish({ phase: 'restarted', result: null, pending: false, message: '' }); return getState(); }
    let snapshot;
    try { if (projection(out)) snapshot = structuredClone(out); } catch { snapshot = null; }
    let offerDisplay = null; const offerId = snapshot?.value.currentOffer?.offerRef?.offerId;
    if (snapshot && offerId && typeof adapter.readOfferDisplay === 'function') {
      try { offerDisplay = await adapter.readOfferDisplay({ offerId, runId: snapshot.value.runId, signal: abort.signal }) ?? null; } catch { offerDisplay = null; }
      if (disposed || abort.signal.aborted || current !== generation) return getState();
    }
    if (snapshot) {
      const next = { phase: 'ready', result: snapshot, pending: false, message, offerDisplay };
      if (typeof expectedEngaged === 'boolean' && buddyEngaged(snapshot.value.permission) !== expectedEngaged) next.message = 'Buddy changed. Showing current status.';
      if (quiet) next.message = state.phase === 'ready' && signature(next) === signature(state) ? '' : 'Activity updated.';
      publish(next);
    }
    else publish({ phase: 'unavailable', result: null, pending: false, message: 'Activity unavailable. Try again.' });
    return getState();
  }
  const refresh = () => state.pending ? Promise.resolve(getState()) : load();
  // A presenter action re-reads without a loading paint; only a changed snapshot is announced.
  const sync = () => state.pending || state.phase === 'restarted' ? Promise.resolve(getState()) : load({ pending: true, quiet: true });
  async function command(operation) {
    const value = state.result?.value;
    const port = operation === 'engage' ? adapter.engage ?? adapter.resume : operation === 'disengage' ? adapter.disengage ?? adapter.pause : adapter[operation];
    if (disposed || state.pending || state.phase !== 'ready' || !positive(value?.briefVersion)
      || !value.permission || typeof port !== 'function'
      || operation === 'pauseSearch' && !buddyEngaged(value.permission)
      || operation === 'resumeSearch' && value.permission.paused !== true
      || operation === 'disengage' && !buddyEngaged(value.permission)
      || operation === 'engage' && buddyEngaged(value.permission)) return getState();
    let commandId;
    try { commandId = createCommandId(); } catch { commandId = null; }
    if (typeof commandId !== 'string' || !commandId.trim()) {
      publish({ ...state, message: 'Buddy could not be updated. Try again.' }); return getState();
    }
    const current = generation; const abort = new AbortController(); commandAbort = abort;
    const expectedBriefVersion = value.briefVersion;
    publish({ ...state, pending: true, message: 'Updating Buddy.' });
    let out;
    try { out = await port({ commandId, expectedBriefVersion, signal: abort.signal }); } catch { out = unavailable(); }
    if (disposed || abort.signal.aborted || current !== generation) return getState();
    if (isRunRestarted(out)) { publish({ phase: 'restarted', result: null, pending: false, message: '' }); commandAbort = null; return getState(); }
    const message = out?.status === 'ok' ? operation === 'pauseSearch' ? 'Search paused.' : operation === 'resumeSearch' ? 'Search resumed.' : operation === 'disengage' ? 'Buddy disengaged.' : 'Buddy engaged.'
      : out?.status === 'invalid' && out.code === 'engagement-minimum' ? 'Choose more preferences or turn on Same again in Account to engage Buddy.'
      : ['stale-version', 'conflict'].includes(out?.status) ? 'Buddy changed. Showing current status.' : 'Buddy could not be updated. Try again.';
    await load({ pending: true, message, ...(out?.status === 'ok' ? { expectedEngaged: ['engage', 'resumeSearch'].includes(operation) } : {}) }); commandAbort = null;
    return getState();
  }
  return { getState, refresh, sync, disengage: () => command('disengage'), engage: () => command('engage'),
    pauseSearch: () => command('pauseSearch'), resumeSearch: () => command('resumeSearch'),
    pause: () => command('disengage'), resume: () => command('engage'),
    destroy() { if (disposed) return; disposed = true; generation += 1; readAbort?.abort(); commandAbort?.abort(); } };
}
