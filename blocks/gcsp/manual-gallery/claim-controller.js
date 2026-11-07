const copy = (value) => structuredClone(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sharedScope = (hold, quote) => ['runId', 'employeeId', 'entitlementSlotId'].every((key) =>
  hold[key] == null || quote[key] == null || hold[key] === quote[key]);

/** Only the authenticated, current GET can authorise a handoff. */
export function isConfirmedManualClaim(envelope, selection, receipt = null) {
  if (envelope?.status !== 'ok' || envelope.value?.state !== 'quoted' || envelope.value.pendingOperation !== null) return false;
  const { hold, quote, now } = envelope.value; const expected = selection?.claimInput;
  if (!hold || !quote || !expected || hold.state !== 'active' || hold.type !== 'cart'
    || !hold.holdId || !hold.quoteId || hold.quoteId !== quote.quoteId || !positive(hold.version) || !positive(quote.version)
    || hold.orderUuid !== selection.orderUuid || quote.orderUuid !== selection.orderUuid
    || quote.configurationId !== selection.configurationId || !sharedScope(hold, quote)
    || quote.facts?.identityKind !== 'exact-stock' || quote.facts.sourceKeys?.stockId !== selection.orderUuid
    || quote.facts.snapshotVersion !== selection.snapshot?.snapshotVersion
    || quote.policyVersion != null && selection.versions?.policy != null && quote.policyVersion !== selection.versions.policy
    || quote.draftVersion !== expected.expectedDraftVersion
    || quote.eligibility?.contextVersion !== expected.expectedContextVersion
    || quote.eligibility?.termsDigest !== expected.expectedTermsDigest
    || !positive(quote.eligibility?.stockVersion)) return false;
  const instant = Date.parse(now);
  if (!Number.isFinite(instant) || !(Date.parse(hold.expiresAt) > instant)
    || !(Date.parse(quote.validUntil ?? quote.expiresAt) > instant)) return false;
  const posted = receipt?.status === 'ok' ? receipt.value : null;
  return !posted || (!posted.hold?.holdId || posted.hold.holdId === hold.holdId)
    && (!posted.quote?.quoteId || posted.quote.quoteId === quote.quoteId);
}

/** Owns one unresolved attempt. Reconciliation never repeats its POST. */
export function createManualClaimController({ adapter, onChange = () => {}, onConfirmed = () => {}, onFailure = () => {}, onReleased = () => {} }) {
  let destroyed = false; let generation = 0; let request; let operation; let attempt = null; const emitted = new Set();
  let state = { state: 'checking', blocked: true, claim: null, selection: null, commandId: null };
  const snapshot = () => copy(state);
  function publish(changes) { if (!destroyed) { state = { ...state, ...changes }; onChange(snapshot()); } return snapshot(); }
  const definitive = (result) => ['conflict', 'stale-version', 'stale-run', 'invalid', 'forbidden', 'not-found'].includes(result?.status);
  function nonoccupying(claim) {
    const value = claim?.value; const hold = value?.hold; const quote = value?.quote;
    return claim?.status === 'ok' && ['released', 'expired', 'claim-failed'].includes(value?.state)
      && value.pendingOperation === null && hold?.state === value.state && Boolean(hold.holdId) && positive(hold.version)
      && (!quote || Boolean(hold.quoteId) && positive(quote.version) && hold.quoteId === quote.quoteId && hold.orderUuid === quote.orderUuid && sharedScope(hold, quote));
  }
  function resolvesAttempt(claim) {
    if (!attempt || definitive(attempt.receipt)) return true;
    const posted = attempt.receipt?.status === 'ok' ? attempt.receipt.value : null;
    return Boolean(posted?.hold?.holdId) && Boolean(posted?.quote?.quoteId)
      && posted.hold.holdId === claim.value.hold.holdId && posted.quote.quoteId === claim.value.hold.quoteId
      && claim.value.hold.orderUuid === attempt.selection.orderUuid
      && claim.value.quote?.configurationId === attempt.selection.configurationId;
  }
  async function reconcile(ticket) {
    let claim;
    try { claim = await adapter.readClaim({ signal: request.signal }); } catch { claim = { status: 'unavailable' }; }
    if (destroyed || ticket !== generation) return snapshot();
    if (attempt && isConfirmedManualClaim(claim, attempt.selection, attempt.receipt)) {
      const detail = { selection: copy(attempt.selection), commandId: attempt.commandId, claim: copy(claim) };
      publish({ state: 'confirmed', blocked: true, claim });
      if (!emitted.has(claim.value.hold.holdId)) { emitted.add(claim.value.hold.holdId); onConfirmed(detail); }
    } else if (nonoccupying(claim) && resolvesAttempt(claim)) {
      attempt = null; publish({ state: 'released', blocked: false, claim, selection: null, commandId: null }); onReleased(claim);
    } else if (claim?.status === 'not-found' && (!attempt || definitive(attempt.receipt))) {
      const failure = attempt?.receipt; attempt = null;
      publish({ state: failure ? 'failed' : 'ready', blocked: false, claim, selection: null, commandId: null, failure });
      if (failure) onFailure(failure);
    } else {
      const occupied = claim?.status === 'ok' && ['quoted', 'allocated'].includes(claim.value?.state);
      publish({ state: occupied ? attempt && claim.value.state !== 'allocated' ? 'readback-mismatch' : 'existing-claim'
        : (claim?.status === 'not-found' || nonoccupying(claim)) && attempt ? 'retry-available' : claim?.status === 'pending' ? 'pending' : 'uncertain', blocked: true, claim });
    }
    return snapshot();
  }
  function checkStatus() {
    if (destroyed) return Promise.resolve(snapshot());
    if (operation) return operation;
    const ticket = ++generation; request = new AbortController(); publish({ state: 'checking', blocked: true });
    operation = reconcile(ticket).finally(() => { operation = null; }); return operation;
  }
  function dispatchAttempt() {
    const ticket = ++generation; request = new AbortController();
    publish({ state: 'claiming', blocked: true, selection: attempt.selection, commandId: attempt.commandId, failure: null });
    operation = (async () => {
      try { attempt.receipt = await adapter.claim({ commandId: attempt.commandId, ...copy(attempt.selection.claimInput) }, { signal: request.signal }); }
      catch { if (!destroyed) attempt.receipt = { status: 'unavailable' }; }
      if (destroyed || ticket !== generation) return snapshot();
      return reconcile(ticket);
    })().finally(() => { operation = null; });
    return operation;
  }
  function review(selection) {
    if (operation) return operation;
    if (destroyed || state.blocked || !selection?.commandId || !selection.claimInput) return Promise.resolve(snapshot());
    const { commandId, claimAvailable, ...descriptor } = selection;
    attempt = { selection: copy(descriptor), commandId, receipt: null };
    return dispatchAttempt();
  }
  function retry() {
    if (operation) return operation;
    if (destroyed || !attempt || state.state !== 'retry-available') return Promise.resolve(snapshot());
    return dispatchAttempt();
  }
  return { load: checkStatus, checkStatus, review, retry, getState: snapshot,
    destroy() { destroyed = true; generation += 1; request?.abort(); } };
}
