import { createManualReviewController } from '../manual-review/review-controller.js';
import { applicableDeclarations, missingInputs, submitBody, refusalFor } from './summary-model.js';

const clone = (v) => structuredClone(v);
const delivered = (r) => ['ok', 'pending'].includes(r?.status) && r.value?.operationId;
const LIVE = new Set(['ready', 'loading']);

/** Composes the review controller (claim, details, release) with terms, account and the order port. */
export function createManualSummaryController({ adapter, onChange = () => {}, onReleased = () => {},
  commandId = () => globalThis.crypto.randomUUID() } = {}) {
  let destroyed = false; let attempt = null; let loading = null; let submitting = null; let review = null;
  let state = { phase: 'loading', status: 'loading', busy: false, claim: null, account: null, draft: null, terms: null, termsOk: false,
    ticks: {}, unresolved: false, notice: null, actions: [], errors: [], order: null, orderStatus: null,
    required: [], missing: [], canSubmit: false, countdown: null };
  const call = async (method, ...args) => { try { return await adapter[method](...args); } catch { return { status: 'unavailable', uncertain: true }; } };
  const claim = createManualReviewController({ adapter, commandId, onChange: (next) => { review = next; emit(); },
    onReleased: (detail) => { if (!destroyed) onReleased(detail); } });

  function emit(patch = {}) {
    if (destroyed) return;
    state = { ...state, ...patch, claim: review };
    const model = review?.model; const required = state.terms && model ? applicableDeclarations(state.terms, model.mode) : [];
    const countdown = review?.countdown; const missing = model ? missingInputs(model) : [];
    const claimOk = Boolean(model) && LIVE.has(review.status) && model.hold.state === 'active' && model.hold.phase === 'order-review'
      && !review.conflict && countdown && !countdown.expired;
    state.required = required; state.missing = missing; state.unresolved = attempt !== null; state.countdown = countdown ?? null;
    state.canSubmit = state.phase === 'summary' && !state.busy && claimOk && state.termsOk && required.length > 0
      && required.every((entry) => state.ticks[entry.id] === true) && missing.length === 0 && Boolean(state.account) && Boolean(state.draft);
    onChange(clone(state));
  }
  function outcome(envelope, account) {
    attempt = null;
    emit({ phase: 'outcome', status: 'outcome', busy: false, order: clone(envelope.value), orderStatus: envelope.status,
      account: account ?? state.account, notice: null, actions: [], errors: [] });
    return envelope;
  }
  async function showOutcome(envelope) {
    // Labels only; the stored selection carries every fact, so a failed account read is not fatal.
    let account = state.account;
    if (!account) { const read = await call('readAccount'); if (read.status === 'ok') account = read.value; }
    return destroyed ? envelope : outcome(envelope, account);
  }
  async function readTerms() {
    const read = await call('readTerms');
    return read.status === 'ok' ? { terms: read.value, termsOk: true } : { terms: state.terms, termsOk: false };
  }
  async function loadSummary() {
    const [, terms, account, draft] = await Promise.all([claim.load(), readTerms(), call('readAccount'), call('readDraft')]);
    if (destroyed) return;
    emit({ phase: 'summary', status: 'ready', busy: false, terms: terms.terms, termsOk: terms.termsOk, ticks: {},
      account: account.status === 'ok' ? account.value : null, draft: draft.status === 'ok' ? draft.value : null,
      notice: terms.termsOk ? null : { code: 'terms-unavailable', message: 'The terms could not be loaded. Submit is unavailable until they are.' },
      actions: terms.termsOk ? [] : ['terms'] });
  }
  function load() {
    if (loading) return loading;
    emit({ status: 'loading', busy: true });
    const flight = (async () => {
      const found = await call('readOrder'); if (destroyed) return found;
      if (delivered(found)) return showOutcome(found);
      if (found.status !== 'not-found') { emit({ phase: 'unavailable', status: 'unavailable', busy: false }); return found; }
      await loadSummary(); return found;
    })().finally(() => { if (loading === flight) loading = null; });
    loading = flight; return flight;
  }
  async function checkOrder({ quiet = false } = {}) {
    emit({ busy: true, status: 'checking' });
    const found = await call('readOrder'); if (destroyed) return found;
    if (delivered(found)) return showOutcome(found);
    if (quiet) { emit({ busy: false, status: 'refused' }); return found; }
    emit({ busy: false, status: state.phase === 'outcome' ? 'outcome' : 'ready',
      notice: found.status === 'not-found' ? { code: 'no-order', message: attempt ? 'No order is recorded yet. Retry the same submission.' : 'No order has been placed yet.' }
        : { code: 'order-unavailable', message: 'The order status could not be checked. Try again.' }, actions: ['status'] });
    return found;
  }
  async function reloadTerms({ clearTicks = true } = {}) {
    if (attempt) return null;
    const terms = await readTerms(); if (destroyed) return null;
    emit({ ...terms, ticks: clearTicks ? {} : state.ticks });
    return terms;
  }
  async function refused(outcomeEnvelope) {
    attempt = null;
    const reason = outcomeEnvelope.reason ?? outcomeEnvelope.status; const [message, actions] = refusalFor(reason);
    const invalid = outcomeEnvelope.status === 'invalid';
    emit({ busy: false, status: 'refused', notice: { code: reason, message: invalid ? 'Check your declarations and details.' : message },
      actions: invalid ? [] : actions, errors: invalid ? (outcomeEnvelope.reasons ?? []).map((entry) => ({ field: entry.field, message: entry.reason })) : [],
      ticks: reason === 'terms-changed' ? {} : state.ticks });
    if (reason === 'active-selection-exists') return checkOrder({ quiet: true });
    if (reason === 'terms-changed') await reloadTerms();
    await claim.reconcile();
    return outcomeEnvelope;
  }
  function submit() {
    if (submitting) return submitting;
    if (destroyed || state.phase !== 'summary' || !state.canSubmit) return Promise.resolve({ status: 'conflict', reason: 'submit-unavailable' });
    // One command per attempt: a retry resends this exact body until the outcome is definite.
    attempt ??= { body: submitBody(commandId(), review.model, state.terms, state.ticks) };
    const flight = (async () => {
      emit({ busy: true, status: 'submitting', notice: null, actions: [], errors: [] });
      const result = await call('submitOrder', clone(attempt.body)); if (destroyed) return result;
      if (delivered(result)) return showOutcome(result);
      if (result.status === 'unavailable' || result.status === 'pending') {
        emit({ busy: false, status: 'unconfirmed', actions: ['status'],
          notice: { code: 'unconfirmed', message: 'We could not confirm whether your order was placed. Check the order status, or retry the same submission. Neither creates a second order.' } });
        return result;
      }
      return refused(result);
    })().finally(() => { if (submitting === flight) submitting = null; });
    submitting = flight; return flight;
  }
  function reconcile() {
    if (destroyed) return Promise.resolve(null);
    if (state.phase === 'outcome') return state.orderStatus === 'pending' && !state.busy ? checkOrder() : Promise.resolve(null);
    if (state.phase === 'summary') return claim.reconcile().then(() => !destroyed && ['allocated', 'selection-pending'].includes(review?.model?.hold.state) ? checkOrder() : null);
    return state.phase === 'unavailable' ? load() : Promise.resolve(null);
  }
  const controller = {
    load, reconcile, submit, checkOrder, reloadTerms, release: (reason) => claim.release(reason), retryRelease: () => claim.release(),
    tick(id, checked) {
      if (destroyed || attempt || state.busy || state.phase !== 'summary' || !state.required.some((entry) => entry.id === id)) return false;
      emit({ ticks: { ...state.ticks, [id]: checked === true }, errors: [], notice: state.notice?.code === 'terms-unavailable' ? state.notice : null });
      return true;
    },
    getState: () => clone(state),
    destroy() { destroyed = true; claim.destroy(); },
  };
  return Object.freeze(controller);
}
