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

function project(value, hasDecisionPort) {
  if (!value || !states.has(value.state)) throw new TypeError('Missing authoritative offer state.');
  const model = copy(value);
  const seconds = remainingTime(model.expiresAt, model.now);
  const reference = model.reference;
  const bound = Boolean(reference && typeof reference.offerId === 'string' && reference.offerId.length > 0
    && typeof reference.runId === 'string' && reference.runId.length > 0
    && Number.isInteger(reference.offerVersion) && reference.offerVersion > 0
    && Number.isInteger(reference.holdVersion) && reference.holdVersion > 0);
  const actionable = model.state === 'pending' && model.actionable === true && bound && seconds !== null && seconds > 0;
  return { ...model, seconds, countdown: countdownText(seconds),
    canAccept: actionable && hasDecisionPort && model.actions?.accept === true,
    canDecline: actionable && hasDecisionPort && model.actions?.decline === true,
    decisionUnavailable: model.state === 'pending' && !hasDecisionPort,
    checkingExpiry: model.state === 'pending' && seconds === 0 };
}

/** read() returns a server-backed presentation projection. No local time advances business state. */
export function createOfferController({ read, decide, createCommandId = () => globalThis.crypto.randomUUID(), onChange } = {}) {
  if (typeof read !== 'function') throw new TypeError('Supply an offer read port.');
  let state = { state: 'loading', canAccept: false, canDecline: false };
  let sequence = 0; let alive = true; let deciding = false; let abort;
  const listeners = new Set(onChange ? [onChange] : []);
  const snapshot = () => copy(state);
  const emit = () => { if (alive) for (const listener of listeners) listener(snapshot()); };
  const blocked = (next) => ({ ...next, canAccept: false, canDecline: false });

  async function refresh({ afterDecision = false, expiryReread = false } = {}) {
    if (!alive || deciding && !afterDecision) return snapshot();
    const turn = ++sequence;
    abort?.abort(); abort = new AbortController();
    try {
      const outcome = await read({ signal: abort.signal });
      if (!alive || turn !== sequence) return snapshot();
      if (outcome?.status !== 'ok') {
        const failureState = outcome?.status === 'not-found' ? 'not-found'
          : outcome?.status === 'stale-run' ? 'earlier-run' : outcome?.status === 'forbidden' ? 'refused' : 'error';
        // A failed read cannot turn an uncertain command into confirmed absence/failure.
        state = blocked({ state: afterDecision ? 'uncertain' : failureState,
          message: afterDecision ? 'Your decision could not be confirmed. Check the offer again.' : 'The current offer could not be loaded.' });
      } else {
        state = project(outcome.value, typeof decide === 'function');
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
    emit(); return snapshot();
  }

  async function decision(kind) {
    if (!alive || deciding || !['accept', 'decline'].includes(kind)
      || !(kind === 'accept' ? state.canAccept : state.canDecline)) return snapshot();
    deciding = true; ++sequence; abort?.abort();
    const current = snapshot();
    abort = new AbortController();
    state = blocked({ ...state, state: 'uncertain', message: 'Checking your decision. Please wait.' }); emit();
    try {
      // Identity, expected revisions and idempotency binding remain the decision adapter's responsibility.
      await decide({ kind, offer: current.reference, commandId: createCommandId() }, { signal: abort.signal });
    } catch { /* A transport error cannot establish whether the command committed. Read back. */ }
    if (alive) await refresh({ afterDecision: true });
    deciding = false; return snapshot();
  }

  return { snapshot, refresh, decision,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { alive = false; ++sequence; abort?.abort(); listeners.clear(); } };
}
