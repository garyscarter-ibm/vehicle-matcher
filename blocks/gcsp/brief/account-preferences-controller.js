import { isRunRestarted, ACCESS_LAPSED_MESSAGE, RUN_RESTARTED_MESSAGE } from '../kit/run-restarted.js';

export const PREFERENCE_COPY = Object.freeze({
  pending: 'Saving your preferences.',
  saved: 'Preferences saved automatically.',
  failed: 'Your changes were not saved.',
  rejected: 'That change could not be saved.',
  stale: 'Your preferences changed elsewhere. Reload to see the latest.',
  loading: 'Loading your preferences.',
  loadFailed: 'Your preferences could not be loaded.',
  readOnly: 'Your buddy found your car, so your preferences can no longer be changed.',
  sameAgainOn: 'More like your current car. Preferences save automatically.',
  sameAgainFailed: 'Same again was not saved.',
});

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const clone = (v) => structuredClone(v);
const has = (map) => Object.keys(map).length > 0;
const stars = (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 5);
const signature = (changes, intent, again) => JSON.stringify([Object.keys(changes).sort().map((key) => [key, changes[key] === null ? null
  : { value: changes[key].value, importance: changes[key].importance }]), intent ? [intent.value] : 0, again ? [again.on] : 0]);
// Newer edits win per category. A value after a removal restarts at medium, since the server would otherwise keep the old weight.
const fold = (older, newer) => {
  const out = { ...older };
  for (const [key, change] of Object.entries(newer)) {
    if (change === null || !Object.hasOwn(older, key)) out[key] = change;
    else out[key] = older[key] === null ? { importance: 'medium', ...change } : { ...older[key], ...change };
  }
  return out;
};
const unavailable = () => ({ status: 'unavailable', retryable: true });

/** DOM-free Account preferences state: optimistic view, one request in flight, edits coalesced behind it, truthful status. */
export function createAccountPreferencesController({ transport, createCommandId, onChange } = {}) {
  if (!transport || typeof transport.loadEditor !== 'function' || typeof transport.savePreferences !== 'function'
    || typeof createCommandId !== 'function') throw new TypeError('Supply the editor transport and a command ID source.');
  const listeners = new Set(onChange ? [onChange] : []);
  let destroyed = false; let epoch = 0; let phase = 'idle'; let reloading = false;
  let projection = null; let versions = { brief: 0, draft: 0 }; let view = {};
  let open = null; let pendingRemoval = null;
  let pending = {}; let inflight = null; let retryable = null;
  let failure = null; let lock = null; let rejected = false; let saved = null; let loadError = null;
  // The current-car rating shares this queue; ratingIntent is the newest unsent value, { value } with value 1-5 or null.
  let rating = null; let ratingIntent = null;
  // Same again shares it too: `same` is the lane (null without one), sameIntent the newest unsent { on }; confirmedScore is the server's figure.
  let same = null; let sameIntent = null; let confirmedScore = null;

  const category = (key) => projection?.categories?.[key] ?? null;
  const entryOf = (key) => view[key] ?? { state: 'unset' };
  const locked = () => destroyed || phase !== 'ready' || Boolean(lock) || reloading || ['stale', 'load'].includes(failure?.kind);

  function status() {
    if (lock) return { kind: lock.kind, text: lock.text };
    if (phase === 'loading') return { kind: 'pending', text: PREFERENCE_COPY.loading };
    if (phase === 'failed') return { kind: 'failed', text: PREFERENCE_COPY.loadFailed, actionLabel: 'Try again', action: 'load' };
    if (failure?.kind === 'stale') return { kind: 'stale', text: PREFERENCE_COPY.stale, actionLabel: 'Reload preferences', action: 'reload' };
    if (failure?.kind === 'load') return { kind: 'failed', text: PREFERENCE_COPY.loadFailed, actionLabel: 'Try again', action: 'reload' };
    if (failure?.kind === 'save' && has(pending)) {
      const unsent = Object.keys(pending).filter((key) => category(key));
      const named = unsent.length === 1 && !sameIntent ? `Your ${category(unsent[0]).label.toLowerCase()} change was not saved.` : PREFERENCE_COPY.failed;
      return { kind: 'failed', text: named, actionLabel: 'Try again', action: 'retry' };
    }
    if (failure?.kind === 'save' && sameIntent) return { kind: 'failed', text: PREFERENCE_COPY.sameAgainFailed, actionLabel: 'Try again', action: 'retry' };
    if (reloading) return { kind: 'pending', text: PREFERENCE_COPY.loading };
    if ((inflight && (has(inflight.changes) || inflight.same)) || has(pending) || sameIntent) return { kind: 'pending', text: PREFERENCE_COPY.pending };
    if (rejected) return { kind: 'failed', text: rejected === 'same' ? PREFERENCE_COPY.sameAgainFailed : PREFERENCE_COPY.rejected };
    if (saved) return { kind: 'saved', text: saved };
    return { kind: 'idle', text: same?.on ? PREFERENCE_COPY.sameAgainOn : counted() };
  }
  // The frozen footer copy when nothing is pending: how many categories count toward the minimum.
  function counted() {
    if (!projection) return '';
    const n = projection.order.filter((key) => entryOf(key).state === 'considered').length; const min = projection.minimumCategories ?? 3;
    return n >= min ? `${n} categories considered · Saved automatically` : `${n} of ${min} categories considered · Preferences save automatically`;
  }
  // Confirmed figure at rest; while a category or Same again change is unsaved, the figure the policy projects for it.
  function understandingView() {
    const policy = projection?.understanding; if (!policy || confirmedScore === null) return null;
    const dirty = has(pending) || Boolean(sameIntent) || Boolean(inflight && (has(inflight.changes) || inflight.same));
    if (!dirty) return { value: confirmedScore, maximum: policy.maximum, pending: false, failed: false };
    const count = projection.order.filter((key) => entryOf(key).state === 'considered').length;
    return { value: same?.on ? policy.sameAgain : policy.byConsidered[count], maximum: policy.maximum, pending: true, failed: ['save', 'stale'].includes(failure?.kind) };
  }
  const snapshot = () => clone({ phase, projection, categories: view, open, pendingRemoval, status: status(), disabled: phase !== 'ready' || locked(),
    rating, sameAgain: same && { available: same.available, on: same.on, reason: same.reason, status: same.status }, understanding: understandingView(),
    briefVersion: versions.brief, draftVersion: versions.draft });
  function emit() {
    if (destroyed) return;
    for (const listener of [...listeners]) { try { listener(snapshot()); } catch { /* Observers cannot interrupt state transitions. */ } }
  }

  function stage(key, change) {
    pending = fold(pending, { [key]: change }); rejected = false; saved = null; emit(); flush(false);
  }
  function flush(reuse) {
    if (locked() || inflight || failure || (!has(pending) && !ratingIntent && !sameIntent)) return;
    send(reuse);
  }
  async function send(reuse) {
    const changes = pending; pending = {}; const intent = ratingIntent; ratingIntent = null;
    let again = sameIntent; sameIntent = null;
    // The server refuses edits while it holds Same again on, so queued edits go out with an explicit off and the on follows.
    if (same?.saved && has(changes) && again?.on === true) { sameIntent = again; again = { on: false }; }
    const mark = signature(changes, intent, again); const ticket = epoch;
    let commandId = reuse && retryable?.signature === mark ? retryable.commandId : null;
    if (!commandId) { try { commandId = createCommandId('preferences'); } catch { commandId = null; } }
    inflight = { commandId, changes, signature: mark, rating: intent, same: again }; emit();
    let outcome;
    try {
      outcome = text(commandId) ? await transport.savePreferences({ commandId, expectedBriefVersion: versions.brief,
        expectedDraftVersion: versions.draft, changes: clone(changes),
        ...(intent ? { currentCarRating: { contractId: rating.contractId, value: intent.value } } : {}),
        ...(again ? { sameAgain: { contractId: same.contractId, on: again.on } } : {}) }) : unavailable();
    } catch { outcome = unavailable(); }
    if (destroyed || ticket !== epoch) return;
    settle(outcome);
  }

  function adopt(server, skipPending) {
    for (const key of projection.order) if (!skipPending || !Object.hasOwn(pending, key)) view[key] = clone(server.categories?.[key] ?? { state: 'unset' });
  }
  function settle(outcome) {
    const sent = inflight; inflight = null;
    const fields = outcome?.status === 'ok' ? outcome.value : null;
    if (fields && revision(fields.briefVersion) && revision(fields.draftVersion) && object(fields.accountPreferences?.categories) && ratingAnswer(fields.currentCarRating, sent) && sameAnswer(fields.sameAgain, sent)) {
      versions = { brief: fields.briefVersion, draft: fields.draftVersion }; confirmed = clone(fields.accountPreferences.categories);
      if (Number.isInteger(fields.accountPreferences.understanding?.value)) confirmedScore = fields.accountPreferences.understanding.value;
      adopt(fields.accountPreferences, true);
      failure = null; retryable = null; if (sent.same && rejected === 'same') rejected = false;
      if (has(sent.changes) || sent.same) {
        rejected = false;
        const removed = Object.keys(sent.changes).filter((key) => sent.changes[key] === null && !Object.hasOwn(pending, key)).pop();
        saved = removed && category(removed) ? `${category(removed).label} preference removed. Saved automatically.` : PREFERENCE_COPY.saved;
      }
      // A late answer never overwrites a newer choice; the visible value only follows the server when nothing newer waits.
      if (rating && fields.currentCarRating?.contractId === rating.contractId) {
        rating.saved = fields.currentCarRating.value;
        if (!ratingIntent) rating.value = rating.saved;
      }
      if (rating && sent.rating && !ratingIntent) rating.status = 'saved';
      const answered = sameFrom(fields.sameAgain);
      if (answered) { same.saved = answered.on; if (!sameIntent) same.on = same.saved; }
      // A newest choice that already matches the saved state needs no request.
      if (same && sameIntent && sameIntent.on === same.saved && !has(pending)) sameIntent = null;
      if (same && !sameIntent && same.status !== 'idle') { same.status = 'saved'; same.on = same.saved; }
      emit(); flush(false); return;
    }
    const status = outcome?.status;
    if (isRunRestarted(outcome)) lock = status === 'access-required' ? { kind: 'access', text: ACCESS_LAPSED_MESSAGE } : { kind: 'restarted', text: RUN_RESTARTED_MESSAGE };
    else if (status === 'conflict' && outcome.reason === 'brief-read-only') lock = { kind: 'idle', text: PREFERENCE_COPY.readOnly };
    else if (status === 'stale-version' || status === 'conflict') { pending = fold(sent.changes, pending); keepRating(sent); keepSame(sent); failure = { kind: 'stale' }; }
    else if (status === 'invalid' || status === 'forbidden') {
      // Not retryable: show the last confirmed state for what was refused.
      for (const key of Object.keys(sent.changes)) if (!Object.hasOwn(pending, key)) view[key] = clone(confirmedOf(key));
      if (has(sent.changes)) rejected = true;
      if (rating && sent.rating && !ratingIntent) { rating.value = rating.saved; rating.status = 'failed'; }
      if (same && sent.same && !sameIntent) { same.on = same.saved; same.status = 'failed'; rejected ||= 'same'; }
      emit(); flush(false); return;
    } else { pending = fold(sent.changes, pending); keepRating(sent); keepSame(sent); retryable = { commandId: sent.commandId, signature: sent.signature }; failure = { kind: 'save' }; }
    if (lock && rating) { rating.value = rating.saved; rating.status = 'idle'; ratingIntent = null; }
    if (lock && same) { same.on = same.saved; same.status = 'idle'; sameIntent = null; }
    if (has(sent.changes)) saved = null;
    emit();
  }
  // A refused rating stays as the attempted value for retry or reload, marked failed, unless a newer choice already waits.
  function keepRating(sent) {
    if (!rating) return;
    if (sent.rating && !ratingIntent) ratingIntent = { value: sent.rating.value };
    if (ratingIntent) rating.status = 'failed';
  }
  // A refused Same again choice stays as the attempted value for retry or reload, unless a newer choice already waits.
  function keepSame(sent) {
    if (!same) return;
    if (sent.same && !sameIntent) sameIntent = { on: sent.same.on };
    if (sameIntent) same.status = 'failed';
  }
  // The answer's Same again view, when it is well formed and names this car.
  function sameFrom(answer) {
    return same && object(answer) && answer.available === true && typeof answer.on === 'boolean' && text(answer.contractId) && answer.contractId === same.contractId ? answer : null;
  }
  // An ok answer to a Same again request must carry the matching view; otherwise it is no save.
  const sameAnswer = (answer, sent) => !sent.same || Boolean(sameFrom(answer));
  // An ok answer is a save only when its rating is well formed and, if one was sent, names the same car.
  function ratingAnswer(answer, sent) {
    if (answer === undefined || answer === null) return !sent.rating;
    if (!object(answer) || !stars(answer.value) || !text(answer.contractId)) return false;
    return !rating || answer.contractId === rating.contractId;
  }
  let confirmed = {};
  const confirmedOf = (key) => confirmed[key] ?? { state: 'unset' };

  async function fetchEditor() {
    let outcome;
    try { outcome = await transport.loadEditor(); } catch { outcome = unavailable(); }
    return outcome;
  }
  function accept(outcome) {
    const value = outcome?.status === 'ok' ? outcome.value : null;
    const next = value?.context?.accountPreferences; const initial = value?.initial;
    if (!object(next) || !Array.isArray(next.order) || !object(next.categories) || !object(initial?.accountPreferences?.categories)
      || !revision(initial.briefVersion) || !revision(initial.draftVersion)) return false;
    const u = next.understanding; const sound = object(u) && Number.isInteger(u.maximum) && u.maximum >= 1 && Array.isArray(u.byConsidered) && Number.isInteger(u.sameAgain)
      && u.byConsidered.length === next.order.length + 1 && u.byConsidered.every(Number.isInteger);
    projection = clone({ order: next.order.filter((key) => object(next.categories[key])), categories: next.categories,
      minimumCategories: next.minimumCategories, policyVersion: next.policyVersion,
      understanding: sound ? { maximum: u.maximum, byConsidered: u.byConsidered, sameAgain: u.sameAgain } : null });
    const score = initial.accountPreferences.understanding?.value; confirmedScore = Number.isInteger(score) ? score : null;
    versions = { brief: initial.briefVersion, draft: initial.draftVersion };
    confirmed = clone(initial.accountPreferences.categories); view = {}; adopt(initial.accountPreferences, false);
    pending = {}; inflight = null; retryable = null; failure = null; rejected = false; saved = null; open = null; pendingRemoval = null;
    const found = initial.currentCarRating;
    rating = object(found) && text(found.contractId) && stars(found.value) ? { value: found.value, contractId: found.contractId, saved: found.value, status: 'idle' } : null;
    ratingIntent = null;
    const again = initial.sameAgain;
    same = object(again) && again.available === true && text(again.contractId) && typeof again.on === 'boolean'
      ? { available: true, on: again.on, saved: again.on, contractId: again.contractId, reason: null, status: 'idle' }
      : object(again) && again.available === false ? { available: false, on: false, saved: false, contractId: null, reason: typeof again.reason === 'string' ? again.reason : 'no-current-car', status: 'idle' } : null;
    sameIntent = null;
    lock = value.selection?.state === 'accepted' ? { kind: 'idle', text: PREFERENCE_COPY.readOnly } : null;
    return true;
  }
  async function load() {
    if (destroyed || phase === 'loading') return;
    const ticket = ++epoch; phase = 'loading'; loadError = null; emit();
    const outcome = await fetchEditor();
    if (destroyed || ticket !== epoch) return;
    if (accept(outcome)) phase = 'ready';
    else {
      phase = 'failed';
      if (isRunRestarted(outcome)) { lock = outcome.status === 'access-required' ? { kind: 'access', text: ACCESS_LAPSED_MESSAGE } : { kind: 'restarted', text: RUN_RESTARTED_MESSAGE }; }
    }
    emit();
  }
  // The explicit reload drops unsent edits and reads the server record again.
  async function reload() {
    if (destroyed || phase !== 'ready' || reloading) return;
    const ticket = ++epoch; reloading = true; pending = {}; ratingIntent = null; sameIntent = null; inflight = null; retryable = null; failure = null; saved = null; emit();
    const outcome = await fetchEditor();
    if (destroyed || ticket !== epoch) return;
    reloading = false;
    if (!accept(outcome)) {
      if (isRunRestarted(outcome)) lock = outcome.status === 'access-required' ? { kind: 'access', text: ACCESS_LAPSED_MESSAGE } : { kind: 'restarted', text: RUN_RESTARTED_MESSAGE };
      else failure = { kind: 'load' };
    }
    emit();
  }

  function retry() {
    if (destroyed) return;
    if (failure?.kind === 'stale') { reload(); return; }
    if (failure?.kind !== 'save') return;
    if (rating && ratingIntent) rating.status = 'pending';
    if (same && sameIntent) same.status = 'pending';
    failure = null; emit(); flush(true);
  }
  function rate(value, contractId) {
    if (!rating || locked() || contractId !== rating.contractId || !stars(value)) return;
    rating.value = value; ratingIntent = { value }; rating.status = failure ? 'failed' : 'pending'; emit(); flush(false);
  }
  // Turning on closes any panel or removal; while on, category intents do nothing (the server keeps the saved choices untouched).
  function toggleSameAgain(on) {
    if (!same?.available || locked() || typeof on !== 'boolean' || on === same.on) return;
    same.on = on; sameIntent = { on }; same.status = failure ? 'failed' : 'pending'; rejected = false; saved = null;
    if (on) { open = null; pendingRemoval = null; }
    // Choosing the saved state again after a failure is nothing to send, so the failure clears with it.
    if (!inflight && on === same.saved) {
      sameIntent = null; same.status = 'idle';
      if (failure?.kind === 'save' && !has(pending) && !ratingIntent) { failure = null; retryable = null; }
    }
    emit(); flush(false);
  }
  function openCategory(key) {
    const c = category(key); if (!c || locked() || same?.on) return;
    if (open === key) { open = null; emit(); return; }
    open = key; pendingRemoval = null;
    if (c.kind === 'stops' && entryOf(key).state !== 'considered') {
      const value = c.openDefault ?? c.stops[Math.floor(c.stops.length / 2)].value;
      view[key] = { state: 'considered', value, importance: 'medium', exact: true };
      stage(key, { value }); return;
    }
    emit();
  }
  function change(key, patch) {
    const c = category(key); if (!c || locked() || same?.on || !object(patch)) return;
    const entry = entryOf(key); const fresh = entry.state !== 'considered';
    if (Object.hasOwn(patch, 'value')) {
      const value = patch.value;
      if (c.kind === 'multi') {
        if (!Array.isArray(value)) return;
        if (!value.length) { view[key] = { state: 'unset' }; stage(key, null); return; }
        if (!value.every((v) => c.options.some((o) => o.value === v))) return;
        view[key] = { state: 'considered', value: [...value], importance: fresh ? 'medium' : entry.importance, exact: true };
      } else {
        if (!c.stops.some((stop) => stop.value === value) || entry.value === value) return;
        view[key] = { state: 'considered', value, importance: fresh ? 'medium' : entry.importance, exact: true };
      }
      stage(key, { value: clone(value) }); return;
    }
    if (!['medium', 'high'].includes(patch.importance) || fresh || entry.importance === patch.importance) return;
    view[key] = { ...entry, importance: patch.importance };
    stage(key, { importance: patch.importance });
  }
  function requestRemove(key) {
    if (!category(key) || locked() || same?.on || entryOf(key).state !== 'considered') return;
    pendingRemoval = key; open = null; emit();
  }
  function keep(key) { if (pendingRemoval === key) { pendingRemoval = null; emit(); } }
  function confirmRemove(key) {
    if (!category(key) || locked() || same?.on || pendingRemoval !== key) return;
    pendingRemoval = null; view[key] = { state: 'unset' }; stage(key, null);
  }

  return { load, open: openCategory, close() { if (open) { open = null; emit(); } }, change, requestRemove, keep, confirmRemove, retry, reload, rate, toggleSameAgain, snapshot,
    subscribe(listener) { if (destroyed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { destroyed = true; listeners.clear(); } };
}
