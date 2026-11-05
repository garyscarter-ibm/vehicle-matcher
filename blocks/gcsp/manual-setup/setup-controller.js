import { createAccountHttpAdapter } from '../account/http-adapter.js';
import { deriveSetupModel, initialChoices, permittedIntent, matchesIntent, setupFields, dependentFields, same } from './setup-model.js';

const copy = (value) => structuredClone(value);
const unavailable = () => ({ status: 'unavailable', code: 'manual-setup-transport-unavailable', retryable: true });
const invalidated = 'Your choices changed. Availability, selection and quote context need refreshing.';

export function createManualSetupController({ adapter = createAccountHttpAdapter(), onChange = () => {},
  commandId = () => globalThis.crypto.randomUUID() } = {}) {
  let state = { status: 'idle', pending: false, account: null, draft: null, choices: null, options: null,
    errors: {}, availability: null, dirty: false, invalidations: [], invalidationMessage: null,
    reviewRequired: false, reviewedContextVersion: null, conflictingDraft: null, failure: null, versions: null };
  let destroyed = false; let generation = 0; let operation = null; let saving = null; let retry = null;
  const emit = () => { if (!destroyed) onChange(copy(state)); };
  const derive = () => { state.options = deriveSetupModel(state.account, state.choices); };
  const cancel = () => { generation += 1; operation?.abort(); operation = null; };
  const invalidate = (fields = []) => {
    cancel(); state.availability = null; state.versions = null;
    state.invalidations = [...new Set([...state.invalidations, ...fields, 'selection', 'quote', 'eligible-stock'])];
    state.invalidationMessage = invalidated;
  };
  async function call(work) { try { return await work(); } catch { return unavailable(); } }

  async function browse() {
    if (!adapter.browseStock || destroyed || state.dirty || state.reviewRequired) return;
    const token = ++generation; operation?.abort(); operation = new AbortController();
    state.availability = { status: 'loading' }; emit();
    const result = await call(() => adapter.browseStock({ signal: operation.signal }));
    if (destroyed || token !== generation) return;
    if (result.status === 'ok' && (result.value?.versions?.draft !== state.draft?.draftVersion
      || result.value?.versions?.context !== state.account?.contextVersion)) {
      state.availability = { status: 'stale-version', action: 'refresh' };
      state.reviewRequired = true; state.status = 'review';
    } else {
      state.availability = result;
      state.versions = result.status === 'ok' ? copy(result.value.versions) : null;
      if (result.status === 'ok') state.invalidationMessage = state.invalidations.length
        ? 'Availability refreshed. Previous selection and quote context are no longer valid.' : null;
      if (['stale-version', 'conflict'].includes(result.status)) {
        state.reviewRequired = true; state.status = 'review'; state.failure = result;
      }
    }
    emit();
  }

  async function read({ hint = null, refresh = false, discardEdits = false } = {}) {
    if (destroyed || saving && state.pending) return getState();
    cancel(); const token = generation; operation = new AbortController();
    const previous = { choices: copy(state.choices), draft: copy(state.draft), dirty: state.dirty,
      contextVersion: state.account?.contextVersion };
    state.status = 'loading'; state.pending = true; state.errors = {}; state.failure = null; emit();
    const [account, draft] = await Promise.all([
      call(() => adapter.readAccount({ signal: operation.signal })), call(() => adapter.readDraft({ signal: operation.signal })),
    ]);
    if (destroyed || token !== generation) return getState();
    state.pending = false;
    if (account.status !== 'ok' || !['ok', 'not-found'].includes(draft.status)) {
      state.status = 'error'; state.failure = account.status !== 'ok' ? account : draft; emit(); return getState();
    }
    state.account = account.value; state.draft = draft.status === 'ok' ? draft.value : null;
    const intent = permittedIntent(state.account);
    const mismatch = !intent || state.draft && !matchesIntent(state.draft.choices, intent)
      || previous.dirty && !discardEdits && !matchesIntent(previous.choices, intent);
    const hintMismatch = hint && (!matchesIntent(hint, intent)
      || hint.contextVersion != null && hint.contextVersion !== state.account.contextVersion
      || hint.draftVersion != null && hint.draftVersion !== state.draft?.draftVersion);
    const sourceChanged = !!(state.draft && (state.draft.requiresRefresh || state.draft.contextVersion !== state.account.contextVersion)
      || previous.contextVersion && previous.contextVersion !== state.account.contextVersion);
    const newerDraft = previous.dirty && (previous.draft?.draftVersion ?? 0) !== (state.draft?.draftVersion ?? 0);
    const retain = previous.dirty && !discardEdits;
    state.choices = retain ? previous.choices : initialChoices(state.account, mismatch ? null : state.draft);
    state.dirty = retain;
    state.reviewRequired = !!(mismatch || hintMismatch || newerDraft && !discardEdits || sourceChanged && !refresh);
    state.reviewedContextVersion = refresh && !state.reviewRequired ? state.account.contextVersion : null;
    state.conflictingDraft = newerDraft && !discardEdits ? copy(state.draft) : null;
    if (state.conflictingDraft) state.draft = previous.draft;
    if (sourceChanged || mismatch || hintMismatch || newerDraft) invalidate(['context']);
    state.status = state.reviewRequired ? 'review' : 'ready';
    state.failure = mismatch ? { status: 'conflict', reason: 'ordering-action-changed', action: 'back-to-account' }
      : newerDraft && !discardEdits ? { status: 'stale-version', resource: 'manual-draft', action: 'refresh-review' } : null;
    retry = null; derive(); emit();
    if (!state.reviewRequired && !state.dirty && state.draft?.draftStage === 'complete' && !sourceChanged) await browse();
    return getState();
  }

  function update(field, value) {
    if (destroyed || !state.choices || state.pending || !setupFields.includes(field)) return false;
    if (same(state.choices[field], value)) return true;
    state.choices[field] = copy(value); state.dirty = true; retry = null;
    if (dependentFields.includes(field)) invalidate([field]);
    state.errors = {}; derive(); emit(); return true;
  }

  async function performSave() {
    if (destroyed || state.pending || !state.choices) return { status: 'invalid', reasons: [{ field: 'context', reason: 'Load your ordering context first.' }] };
    derive(); state.errors = copy(state.options.errors);
    if (state.reviewRequired || !state.options.valid) {
      if (state.reviewRequired) state.errors.context = 'Refresh and review your ordering context before saving.';
      state.status = state.reviewRequired ? 'review' : 'validation'; emit();
      return { status: 'invalid', reasons: Object.entries(state.errors).map(([field, reason]) => ({ field, reason })) };
    }
    const payload = retry ?? { commandId: typeof commandId === 'function' ? commandId() : commandId,
      expectedDraftVersion: state.draft?.draftVersion ?? 0, expectedContextVersion: state.account.contextVersion,
      choices: copy(state.choices) };
    retry = payload; state.pending = true; state.status = 'saving'; state.failure = null; emit();
    const result = await call(() => adapter.saveDraft(copy(payload)));
    if (destroyed) return result;
    state.pending = false;
    if (result.status !== 'ok') {
      state.failure = result; state.status = ['stale-version', 'conflict'].includes(result.status) ? 'review' : 'error';
      state.reviewRequired ||= state.status === 'review';
      state.errors = Object.fromEntries((result.reasons ?? []).map(({ field, reason }) => [field, reason]));
      if (result.status !== 'unavailable') retry = null;
      emit(); return result;
    }
    if (!matchesIntent(result.value?.choices, permittedIntent(state.account)) || !same(result.value?.choices, payload.choices)
      || result.value?.contextVersion !== payload.expectedContextVersion || result.value?.draftVersion !== payload.expectedDraftVersion + 1) {
      state.status = 'error'; state.failure = unavailable(); emit(); return state.failure;
    }
    retry = null; state.draft = result.value; state.dirty = false; state.errors = {}; state.status = 'saved';
    state.invalidations = copy(result.value.invalidations ?? []); emit();
    // The same complete-save seam serves Save/Back and progression; browsing never reserves stock.
    await browse();
    return result;
  }

  function save(options) {
    if (saving) return saving;
    saving = performSave(options).finally(() => { saving = null; });
    return saving;
  }
  const getState = () => copy(state);
  return { load: (options) => read(options), update, save, refresh: (options = {}) => read({ ...options, refresh: true }), getState,
    destroy() { destroyed = true; cancel(); } };
}
