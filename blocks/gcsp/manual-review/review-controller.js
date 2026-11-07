import { copyReviewDetails, sameReviewDetails, reviewIdentity, validateReviewDetails, toManualReviewModel } from './review-model.js';

const uncertain = (outcome) => outcome?.status === 'pending' || outcome?.status === 'unavailable';
const refused = (code) => ({ status: 'conflict', code });
const failed = () => ({ status: 'unavailable', code: 'manual-review-operation-unavailable', uncertain: true, retryable: true });
const clone = (v) => structuredClone(v);

export function createManualReviewController({ adapter, onChange = () => {}, onContinue = () => {}, onReleased = () => {},
  commandId = () => globalThis.crypto.randomUUID() } = {}) {
  let destroyed = false; let generation = 0; let identity = null; let inFlight = null;
  const commands = { save: null, review: null, release: null }; const announcements = new Set(); const continuations = new Set();
  let active = false; let reviewSavedVersion = null; let reviewSavedDetails = null;
  let state = { status: 'idle', busy: false, model: null, details: null, dirty: false, errors: [], conflict: false,
    editable: false, canContinue: false, canRelease: false, countdown: null, announcement: null, outcome: null, retryAction: null };
  const current = (token) => !destroyed && token === generation;
  function emit(patch = {}) {
    if (destroyed) return;
    state = { ...state, ...patch };
    const unresolved = Boolean(commands.save || commands.review || commands.release);
    state.editable = active && !state.busy && !state.conflict && !unresolved;
    state.canContinue = state.editable && state.status !== 'continued';
    state.canRelease = Boolean(state.model && ['active', 'claim-pending', 'release-pending', 'selection-pending'].includes(state.model.hold.state));
    onChange(clone(state));
  }
  function outcomeState(outcome, retryAction = null) {
    active = false;
    emit({ status: uncertain(outcome) ? outcome.status === 'pending' || outcome.uncertain ? 'pending' : 'unavailable'
      : outcome.status === 'stale-version' || outcome.status === 'conflict' ? 'conflict' : outcome.status,
    outcome, retryAction, errors: outcome.reasons ?? state.errors, busy: false });
  }
  function announce(result) {
    if (!['ready', 'expired'].includes(result.state)) return null;
    const c = result.countdown; let announcement = null;
    if (c.expired || c.lowTime) {
      const id = `${result.value.binding.holdId}:${c.phase}:${c.expired ? 'expired' : 'low'}`;
      if (!announcements.has(id)) {
        announcements.add(id); announcement = { id, text: c.expired ? 'Your hold has expired. Refresh stock to choose a car.' : 'Your hold is nearly over. Continue or cancel before it expires.' };
      }
    }
    return announcement;
  }
  async function invoke(method, ...args) {
    try { return await adapter[method](...args); } catch { return failed(); }
  }
  async function refresh(token, { handoff, savedVersion = null, savedDetails = null, releaseReason = null } = {}) {
    if (savedVersion === null && commands.review) { savedVersion = reviewSavedVersion; savedDetails = reviewSavedDetails; }
    const [claim, details] = await Promise.all([invoke('readClaim'), invoke('readReviewDetails')]);
    if (!current(token)) return refused('superseded');
    const result = toManualReviewModel(claim, details, { handoff, expectedIdentity: identity });
    if (result.status !== 'ok') { outcomeState(result, commands.release ? 'release' : commands.review ? 'continue' : commands.save ? 'save' : null); return result; }
    const model = result.value;
    identity ??= reviewIdentity(model);
    const previousVersion = state.model?.reviewDetailsVersion;
    const ownsSave = savedVersion !== null && model.reviewDetailsVersion === savedVersion && sameReviewDetails(model.details, savedDetails);
    const raced = savedVersion !== null ? !ownsSave : state.dirty && (model.reviewDetailsVersion !== previousVersion || !sameReviewDetails(model.details, state.model.details));
    const retain = (state.dirty || state.conflict || raced) && !ownsSave;
    active = result.active;
    emit({ model, details: retain ? state.details : copyReviewDetails(model.details), dirty: retain,
      conflict: state.conflict || raced, countdown: result.countdown, announcement: announce(result), outcome: null, errors: [],
      status: raced || state.conflict ? 'conflict' : result.state, busy: Boolean(inFlight && inFlight.kind !== 'load'),
      retryAction: commands.release ? 'release' : commands.review ? 'continue' : commands.save ? 'save' : null });
    if (releaseReason && ['released', 'expired', 'claim-failed'].includes(model.hold.state) && !result.pending) {
      commands.release = null; commands.save = null; commands.review = null;
      emit({ status: 'released', retryAction: null });
      if (current(token)) onReleased({ reason: releaseReason, claim: clone(model.claim), holdId: model.binding.holdId });
    }
    if (releaseReason && commands.release) { const pending = { status: 'pending', code: 'release-not-confirmed' }; outcomeState(pending, 'release'); return pending; }
    return result;
  }
  function start(kind, work) {
    if (destroyed) return Promise.resolve(refused('destroyed'));
    if (inFlight && inFlight.kind === kind) return inFlight.promise;
    if (inFlight && kind !== 'release') return inFlight.promise;
    const token = ++generation;
    emit({ status: kind === 'load' ? 'loading' : kind === 'save' ? 'saving' : kind === 'continue' ? 'continuing' : 'releasing', busy: true, outcome: null, announcement: null });
    const flight = { kind, promise: null };
    flight.promise = Promise.resolve().then(() => work(token)).catch((error) => {
      if (current(token)) outcomeState(failed(), kind === 'load' ? null : kind);
      return failed();
    }).finally(() => { if (inFlight === flight) { inFlight = null; if (current(token) && state.busy) emit({ busy: false }); } });
    inFlight = flight;
    return flight.promise;
  }
  function invalidFields() {
    const errors = validateReviewDetails(state.details, state.model?.mode, state.model?.constraints);
    if (errors.length) { emit({ status: 'invalid', errors, busy: false }); return { status: 'invalid', code: 'invalid-review-details', reasons: errors }; }
    return null;
  }
  async function saveWithin(token) {
    if (!commands.save) {
      if (!active || state.conflict || commands.review || commands.release) return refused('review-not-editable');
      const invalid = invalidFields(); if (invalid) return invalid;
      const b = state.model.binding;
      commands.save = { commandId: commandId(), holdId: b.holdId, quoteId: b.quoteId, expectedHoldVersion: b.expectedHoldVersion,
        expectedDraftVersion: b.expectedDraftVersion, expectedReviewDetailsVersion: state.model.reviewDetailsVersion, details: copyReviewDetails(state.details) };
    }
    const payload = clone(commands.save);
    const outcome = await invoke('saveReviewDetails', clone(payload)); if (!current(token)) return refused('superseded');
    if (outcome.status !== 'ok') {
      if (!uncertain(outcome)) commands.save = null;
      if (outcome.status === 'stale-version' || outcome.status === 'conflict') emit({ conflict: true });
      outcomeState(outcome, commands.save ? 'save' : null); return outcome;
    }
    const expectedVersion = payload.expectedReviewDetailsVersion + 1;
    const confirmed = await refresh(token, { savedVersion: expectedVersion, savedDetails: payload.details });
    if (!current(token)) return refused('superseded');
    if (confirmed.status === 'ok') { commands.save = null; emit({ retryAction: null }); }
    if (confirmed.status !== 'ok' || state.conflict || state.dirty) return confirmed.status === 'ok' ? refused('review-details-changed') : confirmed;
    return outcome;
  }
  function load(options = {}) {
    return start('load', (token) => refresh(token, { handoff: options.handoff, releaseReason: commands.release?.reason }));
  }
  function save() { return start('save', (token) => saveWithin(token)); }
  function continueReview() {
    return start('continue', async (token) => {
      if (commands.release) return refused('release-unresolved');
      if (!commands.review) {
        const saved = await saveWithin(token); if (!current(token) || saved.status !== 'ok') return saved;
        if (!active || state.conflict || state.dirty) return refused('claim-not-active');
        reviewSavedVersion = state.model.reviewDetailsVersion; reviewSavedDetails = copyReviewDetails(state.details);
        if (state.model.hold.phase === 'preview') {
          const b = state.model.binding;
          commands.review = { commandId: commandId(), holdId: b.holdId, expectedHoldVersion: b.expectedHoldVersion,
            expectedDraftVersion: b.expectedDraftVersion };
        }
      }
      if (commands.review) {
        const outcome = await invoke('beginReview', clone(commands.review)); if (!current(token)) return refused('superseded');
        if (outcome.status !== 'ok') {
          if (!uncertain(outcome)) commands.review = null;
          outcomeState(outcome, commands.review ? 'continue' : null); return outcome;
        }
        const checked = await refresh(token); if (!current(token) || checked.status !== 'ok') return checked;
        commands.review = null; emit({ retryAction: null });
      }
      if (!active || state.conflict || state.dirty || state.model.hold.phase !== 'order-review') return refused('order-review-not-confirmed');
      const key = `${state.model.binding.holdId}:${state.model.hold.expiresAt}`;
      emit({ status: 'continued', busy: false });
      if (!continuations.has(key) && current(token)) {
        continuations.add(key);
        onContinue({ binding: clone(state.model.binding), reviewDetailsVersion: state.model.reviewDetailsVersion, snapshot: clone(state.model), details: copyReviewDetails(state.details) });
      }
      return { status: 'ok', value: clone(state.model) };
    });
  }
  function release(reason = commands.release?.reason) {
    if (!['cancel', 'back', 'change'].includes(reason)) return Promise.resolve({ status: 'invalid', code: 'invalid-release-reason' });
    if (commands.release && commands.release.reason !== reason) return Promise.resolve(refused('release-reason-changed'));
    if (!commands.release) {
      if (!state.canRelease) return Promise.resolve(refused('claim-authority-unavailable'));
      const b = state.model.binding;
      commands.release = { commandId: commandId(), holdId: b.holdId, expectedHoldVersion: b.expectedHoldVersion,
        expectedDraftVersion: b.expectedDraftVersion, reason };
    }
    return start('release', async (token) => {
      const outcome = await invoke('release', clone(commands.release)); if (!current(token)) return refused('superseded');
      if (outcome.status !== 'ok') {
        if (!uncertain(outcome)) commands.release = null;
        outcomeState(outcome, commands.release ? 'release' : null); return outcome;
      }
      return refresh(token, { releaseReason: reason });
    });
  }
  const controller = {
    load, reload: load, reconcile: load, save, continue: continueReview, release,
    edit(field, value) {
      if (destroyed || !state.editable || !['contact.phone', 'contact.email', 'expectedReturnMileage', 'specialRequirements'].includes(field)) return false;
      const details = copyReviewDetails(state.details);
      if (field.startsWith('contact.')) details.contact[field.slice(8)] = value; else details[field] = value;
      emit({ details, dirty: !sameReviewDetails(details, state.model.details), errors: [], status: 'ready' }); return true;
    },
    discardLocalChanges() {
      if (destroyed || !state.model || state.busy || commands.save || commands.review || commands.release) return false;
      emit({ details: copyReviewDetails(state.model.details), dirty: false, conflict: false, errors: [], status: active ? 'ready' : state.status }); return true;
    },
    getState: () => clone(state),
    get state() { return clone(state); },
    destroy() { destroyed = true; generation += 1; active = false; state = { ...state, status: 'destroyed', busy: false, editable: false, canContinue: false, canRelease: false }; },
  };
  return Object.freeze(controller);
}
