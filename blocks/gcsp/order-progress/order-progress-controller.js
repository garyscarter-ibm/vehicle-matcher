// Client sequencing only. Each section keeps its producer envelope; every command ends in a fresh server read.
import { notDone } from './order-progress-copy.js';

const unavailable = () => ({ status: 'unavailable' });
const clone = (out) => { try { return typeof out?.status === 'string' ? structuredClone(out) : unavailable(); } catch { return unavailable(); } };
const usable = (out) => out?.status === 'ok' && out.value && typeof out.value === 'object';
const text = (value) => typeof value === 'string' && value.trim() !== '';
const stamp = (order) => { const at = Date.parse(order?.source?.receivedAt); return Number.isFinite(at) ? at : -Infinity; };
const outcomes = { requestAppointment: 'Handover time requested.', acceptAppointment: 'New handover time accepted.',
  requestReturn: 'Return requested.', acceptReturn: 'New return time accepted.', completeTask: 'Task completed.' };

// The newest selection wins (source.receivedAt); equal times fall back to the larger order id so the pick is stable.
export function latestOrderId(orders) {
  const rows = (Array.isArray(orders) ? orders : []).filter((order) => text(order?.orderUuid));
  rows.sort((a, b) => stamp(b) - stamp(a) || (a.orderUuid < b.orderUuid ? 1 : -1));
  return rows[0]?.orderUuid ?? null;
}

function message(operation, out) {
  if (out?.status === 'ok') return { text: outcomes[operation], error: false };
  if (out?.status === 'unsupported' && text(out.reason)) return { text: notDone(out.reason), error: true };
  if (['conflict', 'stale-version', 'stale-run'].includes(out?.status)) return { text: 'Your order changed. Showing the latest.', error: true };
  return { text: 'Not saved. Try again.', error: true };
}

export function createOrderProgressController({ adapter = {}, orderUuid, onChange, createCommandId = () => globalThis.crypto?.randomUUID?.() } = {}) {
  const fixed = text(orderUuid) ? orderUuid : null;
  let state = { phase: 'loading', orderUuid: fixed, progress: { phase: 'loading' }, pending: false, message: null };
  let generation = 0; let disposed = false; let readAbort; let commandAbort;
  const getState = () => structuredClone(state);
  function publish(next) { state = next; if (!disposed) onChange?.(getState()); }
  async function call(name, input) { try { return await adapter[name]?.(input); } catch { return unavailable(); } }

  async function load({ keep = false, message: shown = null } = {}) {
    if (disposed) return getState();
    const current = ++generation; readAbort?.abort(); const abort = new AbortController(); readAbort = abort;
    const { signal } = abort; const stale = () => disposed || signal.aborted || current !== generation;
    let uuid = fixed ?? (keep ? state.orderUuid : null);
    if (!keep) publish({ phase: 'loading', orderUuid: uuid, progress: { phase: 'loading' }, pending: false, message: null });
    const fail = () => publish({ phase: 'unavailable', orderUuid: uuid, progress: { phase: 'unavailable' }, pending: false, message: shown });
    if (!uuid) {
      const listed = clone(await call('listOrders', { signal }));
      if (stale()) return getState();
      if (!usable(listed) || !Array.isArray(listed.value.orders)) { fail(); return getState(); }
      uuid = latestOrderId(listed.value.orders);
      if (!uuid) { publish({ phase: 'none', orderUuid: null, progress: { phase: 'none' }, pending: false, message: shown }); return getState(); }
    }
    const [stages, documents, appointment, returnPlan] = (await Promise.all([call('readStages', { orderUuid: uuid, signal }),
      call('readDocuments', { signal }), call('readAppointment', { orderUuid: uuid, signal }), call('readReturnPlan', { orderUuid: uuid, signal })])).map(clone);
    if (stale()) return getState();
    if (!usable(stages) || stages.value.orderUuid !== uuid) { fail(); return getState(); }
    publish({ phase: 'ready', orderUuid: uuid, progress: { phase: 'ready', stages, documents, appointment, returnPlan }, pending: false, message: shown });
    return getState();
  }
  const refresh = () => (state.pending ? Promise.resolve(getState()) : load());

  async function command(operation, args) {
    if (disposed || state.pending || state.phase !== 'ready' || typeof adapter[operation] !== 'function') return getState();
    const input = { orderUuid: state.orderUuid, ...args };
    if (operation === 'completeTask') {
      try { input.commandId = createCommandId(); } catch { input.commandId = null; }
      if (!text(input.commandId)) { publish({ ...state, message: message(operation, null) }); return getState(); }
    }
    const current = generation; const abort = new AbortController(); commandAbort = abort;
    publish({ ...state, pending: true, message: null });
    const out = await call(operation, { ...input, signal: abort.signal });
    if (disposed || abort.signal.aborted || current !== generation) return getState();
    await load({ keep: true, message: message(operation, out) }); commandAbort = null;
    return getState();
  }
  return { getState, refresh,
    completeTask: (itemId) => command('completeTask', { itemId }), requestAppointment: (slotId) => command('requestAppointment', { slotId }),
    acceptAppointment: (proposalId) => command('acceptAppointment', { proposalId }),
    requestReturn: ({ choice, slotId } = {}) => command('requestReturn', { choice, slotId }), acceptReturn: (proposalId) => command('acceptReturn', { proposalId }),
    destroy() { if (disposed) return; disposed = true; generation += 1; readAbort?.abort(); commandAbort?.abort(); } };
}
