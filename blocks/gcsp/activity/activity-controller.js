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
  async function load({ pending = false, message = '' } = {}) {
    if (disposed) return getState();
    const current = ++generation; readAbort?.abort(); const abort = new AbortController(); readAbort = abort;
    if (!pending) publish({ phase: 'loading', result: null, pending: false, message: '' });
    let out;
    try { out = await adapter.readActivity?.({ signal: abort.signal }); } catch { out = unavailable(); }
    if (disposed || abort.signal.aborted || current !== generation) return getState();
    if (isRunRestarted(out)) { publish({ phase: 'restarted', result: null, pending: false, message: '' }); return getState(); }
    let snapshot;
    try { if (projection(out)) snapshot = structuredClone(out); } catch { snapshot = null; }
    if (snapshot) publish({ phase: 'ready', result: snapshot, pending: false, message });
    else publish({ phase: 'unavailable', result: null, pending: false, message: 'Activity unavailable. Try again.' });
    return getState();
  }
  const refresh = () => state.pending ? Promise.resolve(getState()) : load();
  async function command(operation) {
    const value = state.result?.value;
    if (disposed || state.pending || state.phase !== 'ready' || !positive(value?.briefVersion)
      || !value.permission || typeof adapter[operation] !== 'function'
      || operation === 'pause' && value.permission.canSearch !== true
      || operation === 'resume' && value.permission.paused !== true) return getState();
    let commandId;
    try { commandId = createCommandId(); } catch { commandId = null; }
    if (typeof commandId !== 'string' || !commandId.trim()) {
      publish({ ...state, message: 'Search could not be updated. Try again.' }); return getState();
    }
    const current = generation; const abort = new AbortController(); commandAbort = abort;
    const expectedBriefVersion = value.briefVersion;
    publish({ ...state, pending: true, message: 'Updating search.' });
    let out;
    try { out = await adapter[operation]({ commandId, expectedBriefVersion, signal: abort.signal }); } catch { out = unavailable(); }
    if (disposed || abort.signal.aborted || current !== generation) return getState();
    if (isRunRestarted(out)) { publish({ phase: 'restarted', result: null, pending: false, message: '' }); commandAbort = null; return getState(); }
    const message = out?.status === 'ok' ? operation === 'pause' ? 'Search paused.' : 'Search resumed.'
      : ['stale-version', 'conflict'].includes(out?.status) ? 'Search changed. Showing current status.' : 'Search could not be updated. Try again.';
    await load({ pending: true, message }); commandAbort = null;
    return getState();
  }
  return { getState, refresh, pause: () => command('pause'), resume: () => command('resume'),
    destroy() { if (disposed) return; disposed = true; generation += 1; readAbort?.abort(); commandAbort?.abort(); } };
}
