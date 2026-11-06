// Presentation port only. HTTP access and decision authority are injected by the host.
const copy = (value) => structuredClone(value);
const states = new Set(['pending', 'accepted', 'declined', 'expired', 'superseded', 'earlier-run', 'not-found', 'uncertain', 'refused']);
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function remainingTime(expiresAt, serverNow) {
  if (!instant(expiresAt) || !instant(serverNow)) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.parse(serverNow)) / 1000));
}

export function countdownText(seconds) {
  if (seconds === null) return 'Time remaining unavailable';
  if (seconds === 0) return 'Checking the current offer state';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining`;
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} min` : ''} remaining`;
}

function project(value, hasDecisionPort, hasReasonPort, declineReason) {
  if (!value || !states.has(value.state)) throw new TypeError('Missing authoritative offer state.');
  const model = copy(value);
  const seconds = remainingTime(model.expiresAt, model.now);
  const reference = model.reference;
  const bound = Boolean(reference && typeof reference.offerId === 'string' && reference.offerId.length > 0
    && typeof reference.runId === 'string' && reference.runId.length > 0
    && ['offerVersion', 'holdVersion', 'quoteVersion'].every((key) => Number.isSafeInteger(reference[key]) && reference[key] > 0));
  const actionable = model.state === 'pending' && model.actionable === true && bound && seconds !== null && seconds > 0;
  return { ...model, seconds, countdown: countdownText(seconds),
    canAccept: actionable && hasDecisionPort && model.actions?.accept === true && !declineReason.open,
    canDecline: actionable && hasDecisionPort && hasReasonPort && model.actions?.decline === true,
    declineUnavailable: model.state === 'pending' && hasDecisionPort && !hasReasonPort && model.actions?.decline === true,
    declineReason: copy(declineReason),
    decisionUnavailable: model.state === 'pending' && !hasDecisionPort,
    checkingExpiry: model.state === 'pending' && seconds === 0 };
}

/** read() returns a server-backed presentation projection. No local time advances business state. */
export function createOfferController({ read, decide, readReasons, createCommandId = () => globalThis.crypto.randomUUID(), onChange } = {}) {
  if (typeof read !== 'function') throw new TypeError('Supply an offer read port.');
  let state = { state: 'loading', canAccept: false, canDecline: false };
  let sequence = 0; let alive = true; let deciding = false; let abort;
  const emptyReason = () => ({ open: false, status: 'idle', choices: [], selectedCode: '', error: '' });
  let declineReason = emptyReason(); let reasonTurn = 0; let reasonAbort;
  const listeners = new Set(onChange ? [onChange] : []);
  const snapshot = () => copy(state);
  const emit = () => { if (alive) for (const listener of listeners) listener(snapshot()); };
  const blocked = (next) => ({ ...next, canAccept: false, canDecline: false });
  const decorate = (value) => project(value, typeof decide === 'function', typeof readReasons === 'function', declineReason);
  const invalidateReasons = () => { ++reasonTurn; reasonAbort?.abort(); };
  const closeReasons = () => { invalidateReasons(); declineReason = emptyReason(); };
  const sameOffer = (one, two) => one?.runId === two?.runId && one?.offerId === two?.offerId;
  const presentReason = () => { state = decorate(state); emit(); return snapshot(); };

  async function refreshDeclineReasons() {
    if (!alive || deciding || !state.canDecline || typeof readReasons !== 'function') return snapshot();
    const offer = copy(state.reference); const turn = ++reasonTurn;
    reasonAbort?.abort(); reasonAbort = new AbortController();
    declineReason = { ...declineReason, open: true, status: 'loading', error: '' }; presentReason();
    let outcome;
    try { outcome = await readReasons({ offer }, { signal: reasonAbort.signal }); } catch { /* No provider text reaches the view. */ }
    if (!alive || deciding || turn !== reasonTurn || state.state !== 'pending' || !sameOffer(offer, state.reference)) return snapshot();
    const registry = outcome?.value; const choices = registry?.reasons;
    if (outcome?.status === 'ok' && registry.schemaVersion === 1 && registry.key === 'offer.declineReasons.v1'
      && typeof registry.policyVersion === 'string' && registry.policyVersion.trim()
      && Array.isArray(choices) && choices.length > 0 && choices.length <= 128
      && choices.every((row) => ['code', 'label', 'attribute'].every((key) => typeof row?.[key] === 'string'
        && row[key].trim().length > 0 && row[key].length <= 128))
      && new Set(choices.map((row) => row.code)).size === choices.length) {
      const selected = choices.some((row) => row.code === declineReason.selectedCode) ? declineReason.selectedCode : '';
      declineReason = { open: true, status: 'ready', policyVersion: registry.policyVersion,
        choices: choices.map(({ code, label, attribute }) => ({ code, label, attribute })), selectedCode: selected,
        error: declineReason.selectedCode && !selected ? 'Choose a reason from the current list.' : '' };
    } else declineReason = { open: true, status: 'unavailable', choices: [], selectedCode: '', error: '' };
    return presentReason();
  }

  function selectDeclineReason(code) {
    if (!alive || deciding || !declineReason.open || declineReason.status !== 'ready') return snapshot();
    const valid = code === '' || declineReason.choices.some((row) => row.code === code);
    declineReason = { ...declineReason, selectedCode: valid ? code : '', error: valid ? '' : 'Choose a reason from the current list.' };
    return presentReason();
  }

  function cancelDecline() {
    if (!alive || deciding) return snapshot();
    closeReasons(); return state.state === 'pending' ? presentReason() : snapshot();
  }

  async function refresh({ afterDecision = false, expiryReread = false } = {}) {
    if (!alive || deciding && !afterDecision) return snapshot();
    const turn = ++sequence;
    invalidateReasons();
    abort?.abort(); abort = new AbortController();
    try {
      const outcome = await read({ signal: abort.signal });
      if (!alive || turn !== sequence) return snapshot();
      if (outcome?.status !== 'ok') {
        const failureState = outcome?.status === 'not-found' ? 'not-found'
          : outcome?.status === 'stale-run' ? 'earlier-run' : outcome?.status === 'forbidden' ? 'refused' : 'error';
        // A failed read cannot turn an uncertain command into confirmed absence/failure.
        state = blocked({ state: afterDecision ? 'uncertain' : failureState,
          message: afterDecision ? 'Your decision could not be confirmed. Check the offer again.'
            : outcome?.accessExchange === 'failed' ? 'Open the original email link or open this offer from your account.' : 'The current offer could not be loaded.' });
      } else {
        if (!sameOffer(state.reference, outcome.value?.reference) || outcome.value?.state !== 'pending'
          || outcome.value?.actions?.decline !== true) closeReasons();
        state = decorate(outcome.value);
        if (state.checkingExpiry && !expiryReread) {
          state = blocked(state); emit();
          return refresh({ afterDecision, expiryReread: true });
        }
      }
    } catch {
      if (!alive || turn !== sequence) return snapshot();
      state = blocked({ state: afterDecision ? 'uncertain' : 'error',
        message: afterDecision ? 'Your decision could not be confirmed. Check the offer again.' : 'The current offer could not be loaded.' });
    }
    if (state.state !== 'pending') closeReasons();
    emit();
    if (!deciding && declineReason.open && state.canDecline) return refreshDeclineReasons();
    return snapshot();
  }

  async function decision(kind, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || !alive || deciding || !['accept', 'decline'].includes(kind)
      || !(kind === 'accept' ? state.canAccept : state.canDecline)) return snapshot();
    if (kind === 'decline') {
      if (!Object.hasOwn(options, 'reasonCode')) return refreshDeclineReasons();
      if (!declineReason.open || declineReason.status !== 'ready') return snapshot();
      if (!declineReason.choices.some((row) => row.code === options.reasonCode)) {
        declineReason = { ...declineReason, error: options.reasonCode ? 'Choose a reason from the current list.' : 'Choose a reason.' };
        return presentReason();
      }
    }
    deciding = true; ++sequence; abort?.abort();
    const current = snapshot();
    closeReasons();
    abort = new AbortController();
    state = blocked({ ...state, state: 'uncertain', message: 'Checking your decision. Please wait.' }); emit();
    let outcome;
    try {
      // Identity, expected revisions and idempotency binding remain the decision adapter's responsibility.
      outcome = await decide({ kind, offer: current.reference, commandId: createCommandId(),
        ...(kind === 'decline' ? { reasonCode: options.reasonCode } : {}) }, { signal: abort.signal });
    } catch { /* A transport error cannot establish whether the command committed. Read back. */ }
    if (alive) await refresh({ afterDecision: true });
    deciding = false;
    if (alive && state.state === 'pending') {
      state = { ...state, message: 'Review the current offer before trying again.' }; emit();
      if (kind === 'decline' && ['invalid', 'conflict', 'stale-version'].includes(outcome?.status) && state.canDecline) {
        await refreshDeclineReasons();
        if (alive && declineReason.status === 'ready') {
          declineReason = { ...declineReason, error: 'The offer changed. Choose a reason from the current list.' }; presentReason();
        }
      }
    }
    return snapshot();
  }

  return { snapshot, refresh, decision, selectDeclineReason, cancelDecline, refreshDeclineReasons,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { alive = false; ++sequence; abort?.abort(); closeReasons(); listeners.clear(); } };
}
