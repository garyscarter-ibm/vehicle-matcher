import { toManualGallery } from './gallery-model.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';

/** Reads the shared manual endpoint. Only the host callback can proceed beyond browsing. */
export function createManualGalleryController({ adapter = createAccountHttpAdapter(), onChange = () => {}, onReview,
  commandId = () => globalThis.crypto.randomUUID() } = {}) {
  let destroyed = false; let generation = 0; let request; let envelope; let controls = {};
  let selectedId = null; const attempts = new Map(); let extras = {};
  let state = { ...toManualGallery(null), state: 'idle', selectedId: null, detail: null };
  const snapshot = () => structuredClone(state);
  function publish(view, selected = selectedId) {
    if (destroyed) return snapshot();
    selectedId = selected;
    const car = view.allCars.find((item) => item.id === selectedId);
    state = { ...view, selectedId: car?.id ?? null, detail: car?.detail ?? null };
    selectedId = state.selectedId;
    onChange(snapshot()); return snapshot();
  }
  async function refresh() {
    if (destroyed) return snapshot();
    const ticket = ++generation; request?.abort(); request = new AbortController();
    publish({ ...toManualGallery(null, controls), state: 'loading' }, null);
    let response;
    try { response = await adapter.browseStock({ signal: request.signal }); }
    catch { response = { status: 'unavailable', retryable: true }; }
    if (destroyed || ticket !== generation) return snapshot();
    envelope = response; extras = {};
    return publish(toManualGallery(envelope, controls, extras));
  }
  function setControls(changes) {
    controls = { ...controls, ...Object.fromEntries(Object.entries(changes).filter(([key]) => ['query', 'body', 'series', 'sort'].includes(key))) };
    if (destroyed || state.state === 'loading' || !envelope) return snapshot();
    return publish(toManualGallery(envelope, controls, extras));
  }
  function openDetail(orderUuid) {
    if (destroyed || !state.allCars.some((car) => car.id === orderUuid)) return null;
    publish(state, orderUuid); return snapshot().detail;
  }
  function review(orderUuid = selectedId) {
    const car = state.allCars.find((item) => item.id === orderUuid);
    if (destroyed || !car || car.gateStatus !== 'eligible' || car.view.members[0].actions[0].disabled || typeof onReview !== 'function') return { status: 'unavailable', reason: 'review-unavailable' };
    const revision = JSON.stringify(car.review);
    if (attempts.get(orderUuid)?.revision !== revision) attempts.set(orderUuid, { revision, commandId: commandId() });
    const handoff = { ...structuredClone(car.review), commandId: attempts.get(orderUuid).commandId,
      claimAvailable: true };
    onReview(handoff);
    return { status: 'ok', value: handoff };
  }
  // A single-car conflict keeps the list: the offer-held reason or the taken car is overlaid on the last browse (FUCQ-278).
  function reportOutcome(outcome, selection = null) {
    if (destroyed) return snapshot();
    generation += 1; request?.abort();
    if (outcome?.status === 'conflict' && envelope?.status === 'ok') {
      extras = outcome.reason === 'offer-held' ? { heldOffer: { offerId: outcome.offerId, runId: outcome.runId } }
        : { carTaken: true, takenIds: [...(extras.takenIds ?? []), ...(selection?.orderUuid ? [selection.orderUuid] : [])] };
      return publish(toManualGallery(envelope, controls, extras));
    }
    const next = outcome?.status === 'stale-version' || outcome?.status === 'stale-run' ? 'context-refresh'
      : outcome?.status === 'conflict' ? 'car-taken' : 'source-unavailable';
    extras = {}; envelope = { ...outcome, view: { ...outcome?.view, state: next } };
    return publish({ ...toManualGallery(null, controls), state: next, outcome: structuredClone(outcome) }, null);
  }
  return { load: refresh, refresh, getState: snapshot, setControls, openDetail, resetReviewAttempts: () => attempts.clear(),
    closeDetail: () => publish(state, null), review, reportOutcome,
    destroy() { destroyed = true; generation += 1; request?.abort(); attempts.clear(); } };
}
