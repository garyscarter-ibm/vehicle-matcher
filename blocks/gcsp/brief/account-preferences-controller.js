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
});

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const revision = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const clone = (v) => structuredClone(v);
const has = (map) => Object.keys(map).length > 0;
const signature = (changes) => JSON.stringify(Object.keys(changes).sort().map((key) => [key, changes[key] === null ? null
  : { value: changes[key].value, importance: changes[key].importance }]));
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

  const category = (key) => projection?.categories?.[key] ?? null;
  const entryOf = (key) => view[key] ?? { state: 'unset' };
  const locked = () => destroyed || phase !== 'ready' || Boolean(lock) || reloading || ['stale', 'load'].includes(failure?.kind);

  function status() {
    if (lock) return { kind: lock.kind, text: lock.text };
    if (phase === 'loading') return { kind: 'pending', text: PREFERENCE_COPY.loading };
    if (phase === 'failed') return { kind: 'failed', text: PREFERENCE_COPY.loadFailed, actionLabel: 'Try again', action: 'load' };
    if (failure?.kind === 'stale') return { kind: 'stale', text: PREFERENCE_COPY.stale, actionLabel: 'Reload preferences', action: 'reload' };
    if (failure?.kind === 'load') return { kind: 'failed', text: PREFERENCE_COPY.loadFailed, actionLabel: 'Try again', action: 'reload' };
    if (failure?.kind === 'save') {
      const unsent = Object.keys(pending).filter((key) => category(key));
      const named = unsent.length === 1 ? `Your ${category(unsent[0]).label.toLowerCase()} change was not saved.` : PREFERENCE_COPY.failed;
      return { kind: 'failed', text: named, actionLabel: 'Try again', action: 'retry' };
    }
    if (reloading) return { kind: 'pending', text: PREFERENCE_COPY.loading };
    if (inflight || has(pending)) return { kind: 'pending', text: PREFERENCE_COPY.pending };
    if (rejected) return { kind: 'failed', text: PREFERENCE_COPY.rejected };
    if (saved) return { kind: 'saved', text: saved };
    return { kind: 'idle', text: counted() };
  }
  // The frozen footer copy when nothing is pending: how many categories count toward the minimum.
  function counted() {
    if (!projection) return '';
    const n = projection.order.filter((key) => entryOf(key).state === 'considered').length; const min = projection.minimumCategories ?? 3;
    return n >= min ? `${n} categories considered · Saved automatically` : `${n} of ${min} categories considered · Preferences save automatically`;
  }
  const snapshot = () => clone({ phase, projection, categories: view, open, pendingRemoval, status: status(), disabled: phase !== 'ready' || locked(),
    briefVersion: versions.brief, draftVersion: versions.draft });
  function emit() {
    if (destroyed) return;
    for (const listener of [...listeners]) { try { listener(snapshot()); } catch { /* Observers cannot interrupt state transitions. */ } }
  }

  function stage(key, change) {
    pending = fold(pending, { [key]: change }); rejected = false; saved = null; emit(); flush(false);
  }
  function flush(reuse) {
    if (locked() || inflight || failure || !has(pending)) return;
    send(reuse);
  }
  async function send(reuse) {
    const changes = pending; pending = {};
    const mark = signature(changes); const ticket = epoch;
    let commandId = reuse && retryable?.signature === mark ? retryable.commandId : null;
    if (!commandId) { try { commandId = createCommandId('preferences'); } catch { commandId = null; } }
    inflight = { commandId, changes, signature: mark }; emit();
    let outcome;
    try {
      outcome = text(commandId) ? await transport.savePreferences({ commandId, expectedBriefVersion: versions.brief,
        expectedDraftVersion: versions.draft, changes: clone(changes) }) : unavailable();
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
    if (fields && revision(fields.briefVersion) && revision(fields.draftVersion) && object(fields.accountPreferences?.categories)) {
      versions = { brief: fields.briefVersion, draft: fields.draftVersion }; confirmed = clone(fields.accountPreferences.categories);
      adopt(fields.accountPreferences, true);
      failure = null; retryable = null; rejected = false;
      const removed = Object.keys(sent.changes).filter((key) => sent.changes[key] === null && !Object.hasOwn(pending, key)).pop();
      saved = removed && category(removed) ? `${category(removed).label} preference removed. Saved automatically.` : PREFERENCE_COPY.saved;
      emit(); flush(false); return;
    }
    const status = outcome?.status;
    if (isRunRestarted(outcome)) lock = status === 'access-required' ? { kind: 'access', text: ACCESS_LAPSED_MESSAGE } : { kind: 'restarted', text: RUN_RESTARTED_MESSAGE };
    else if (status === 'conflict' && outcome.reason === 'brief-read-only') lock = { kind: 'idle', text: PREFERENCE_COPY.readOnly };
    else if (status === 'stale-version' || status === 'conflict') { pending = fold(sent.changes, pending); failure = { kind: 'stale' }; }
    else if (status === 'invalid' || status === 'forbidden') {
      // Not retryable: show the last confirmed state for what was refused.
      for (const key of Object.keys(sent.changes)) if (!Object.hasOwn(pending, key)) view[key] = clone(confirmedOf(key));
      rejected = true; emit(); flush(false); return;
    } else { pending = fold(sent.changes, pending); retryable = { commandId: sent.commandId, signature: sent.signature }; failure = { kind: 'save' }; }
    saved = null; emit();
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
    projection = clone({ order: next.order.filter((key) => object(next.categories[key])), categories: next.categories,
      minimumCategories: next.minimumCategories, policyVersion: next.policyVersion });
    versions = { brief: initial.briefVersion, draft: initial.draftVersion };
    confirmed = clone(initial.accountPreferences.categories); view = {}; adopt(initial.accountPreferences, false);
    pending = {}; inflight = null; retryable = null; failure = null; rejected = false; saved = null; open = null; pendingRemoval = null;
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
    const ticket = ++epoch; reloading = true; pending = {}; inflight = null; retryable = null; failure = null; saved = null; emit();
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
    if (destroyed || failure?.kind !== 'save') return;
    failure = null; emit(); flush(true);
  }
  function openCategory(key) {
    const c = category(key); if (!c || locked()) return;
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
    const c = category(key); if (!c || locked() || !object(patch)) return;
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
    if (!category(key) || locked() || entryOf(key).state !== 'considered') return;
    pendingRemoval = key; open = null; emit();
  }
  function keep(key) { if (pendingRemoval === key) { pendingRemoval = null; emit(); } }
  function confirmRemove(key) {
    if (!category(key) || locked() || pendingRemoval !== key) return;
    pendingRemoval = null; view[key] = { state: 'unset' }; stage(key, null);
  }

  return { load, open: openCategory, close() { if (open) { open = null; emit(); } }, change, requestRemove, keep, confirmRemove, retry, reload, snapshot,
    subscribe(listener) { if (destroyed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { destroyed = true; listeners.clear(); } };
}
