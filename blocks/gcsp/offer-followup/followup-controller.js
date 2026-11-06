const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const revision = (v) => Number.isSafeInteger(v) && v > 0;
const copy = (v) => structuredClone(v);
const equal = (a, b) => Array.isArray(a) && Array.isArray(b)
  ? a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]) : a === b;
const saved = (v, decisionId) => v?.schemaVersion === 1 && v.state === 'change-saved' && v.decisionId === decisionId
  && revision(v.briefVersion) && text(v.policyVersion) && object(v.change) && object(v.event)
  && /^brief-change:[a-f0-9]{64}$/.test(v.event.receiptReference ?? '')
  && v.event.eventType === 'brief-changed' && v.event.briefVersion === v.briefVersion;
const unavailable = () => ({ status: 'unavailable' });

function validQuestion(v, decisionId) {
  const q = v?.question;
  if (v?.schemaVersion !== 1 || v.state !== 'question' || v.decisionId !== decisionId || !revision(v.briefVersion)
    || q?.schemaVersion !== 1 || !text(q.questionVersion) || !text(q.policyVersion)
    || typeof q.prompt !== 'string' || !q.prompt.trim() || q.prompt.length > 240 || !object(q.control)) return false;
  if (q.control.kind === 'options') return Array.isArray(q.control.options) && q.control.options.length > 0
    && q.control.options.every((o) => text(o.value) && typeof o.label === 'string' && o.label.trim() && o.label.length <= 120)
    && new Set(q.control.options.map((o) => o.value)).size === q.control.options.length
    && q.control.options.some((o) => o.value === q.currentValue);
  if (q.control.kind === 'slider') return q.control.minimum === 0 && q.control.maximum === 100
    && q.control.unit === 'percent' && Number.isSafeInteger(q.currentValue)
    && q.currentValue >= q.control.minimum && q.currentValue <= q.control.maximum;
  if (q.control.kind === 'equipment') return Number.isSafeInteger(q.control.maximumItems) && q.control.maximumItems > 0
    && q.control.maximumItems <= 100 && Number.isSafeInteger(q.control.maximumItemLength)
    && q.control.maximumItemLength > 0 && q.control.maximumItemLength <= 256
    && Array.isArray(q.currentValue) && q.currentValue.length <= q.control.maximumItems
    && q.currentValue.every((v) => typeof v === 'string' && v.trim() && v === v.trim() && v.length <= q.control.maximumItemLength)
    && new Set(q.currentValue).size === q.currentValue.length;
  return false;
}

const simple = (v) => v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v)
  || Array.isArray(v) && v.every((x) => x === null || ['string', 'boolean'].includes(typeof x) || typeof x === 'number' && Number.isFinite(x));
const facts = (v) => object(v) && Object.values(v).every((f) => object(f) && ['known', 'unknown'].includes(f.status)
  && simple(f.value) && (f.status !== 'unknown' || f.value === null) && (f.unit === null || typeof f.unit === 'string')
  && (f.provenance === null || object(f.provenance)));
const requirements = (rows) => Array.isArray(rows) && rows.every((r) => object(r) && ['preference', 'essential'].includes(r.kind)
  && text(r.key) && simple(r.value) && facts(r.previousFacts) && facts(r.nextFacts)
  && Object.keys(r.previousFacts).sort().join(',') === Object.keys(r.nextFacts).sort().join(',')
  && (r.kind === 'preference' ? Number.isSafeInteger(r.importance) && r.importance >= 0 && r.importance <= 100
    : text(r.operator) && (r.unit === null || typeof r.unit === 'string')));

function validComparison(v, decisionId) {
  const c = v?.comparison;
  return v?.schemaVersion === 1 && v.state === 'ready' && v.decisionId === decisionId && saved(v.savedChange, decisionId)
    && object(c) && revision(c.currentBriefVersion) && c.currentBriefVersion >= v.savedChange.briefVersion
    && requirements(c.requirements) && object(c.previous?.offer) && object(c.next?.offer)
    && text(c.previous.offer.offerId) && text(c.next.offer.offerId) && c.previous.offer.offerId !== c.next.offer.offerId
    && c.next.offer.quote?.briefVersion === c.currentBriefVersion;
}

function valueError(question, value) {
  const control = question.control;
  if (control.kind === 'options' && !control.options.some((o) => o.value === value)) return 'Choose one of the options.';
  if (control.kind === 'slider' && (!Number.isSafeInteger(value) || value < control.minimum || value > control.maximum)) {
    return `Choose a whole number from ${control.minimum} to ${control.maximum}.`;
  }
  if (control.kind === 'equipment' && (!Array.isArray(value) || value.length > control.maximumItems
    || value.some((v) => typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > control.maximumItemLength)
    || new Set(value).size !== value.length)) return 'Use unique equipment names within the displayed limits.';
  return equal(value, question.currentValue) ? 'Choose a different value before confirming.' : '';
}

/** Selection stays local. An uncertain command keeps its exact ID/body, including across status reads. */
export function createFollowupController({ decisionId, transport, createCommandId = () => globalThis.crypto.randomUUID(), onChange } = {}) {
  if (!text(decisionId) || typeof transport?.read !== 'function' || typeof transport?.confirm !== 'function'
    || typeof createCommandId !== 'function' || onChange !== undefined && typeof onChange !== 'function') {
    throw TypeError('Supply a decision and follow-up transport.');
  }
  let state = { state: 'idle', savedChange: null, error: '', busy: false, question: null, value: null, canConfirm: false };
  let generation = 0; let alive = true; let pending = null;
  const listeners = new Set(onChange ? [onChange] : []);
  const snapshot = () => copy(state);
  const emit = () => { if (alive) for (const fn of listeners) { try { fn(snapshot()); } catch { /* Observer only. */ } } };
  const uncertain = () => {
    state = { ...state, busy: false, state: 'confirmation-uncertain', canConfirm: false,
      error: 'The save could not be confirmed. Retry the same change or check its current status.' }; emit();
  };
  function receive(outcome) {
    const v = outcome?.value;
    if (outcome?.status === 'ok' && validQuestion(v, decisionId)) {
      if (pending) { uncertain(); return; }
      state = { state: 'question', savedChange: null, error: '', busy: false, question: copy(v.question),
        briefVersion: v.briefVersion, value: copy(v.question.currentValue), canConfirm: false };
    } else if (outcome?.status === 'ok' && saved(v, decisionId)) {
      pending = null;
      state = { state: 'change-saved', savedChange: copy(v), question: null, busy: false, error: '', canConfirm: false };
    } else if (outcome?.status === 'ok' && validComparison(v, decisionId)) {
      pending = null;
      state = { state: 'ready', savedChange: copy(v.savedChange), comparison: copy(v.comparison),
        question: null, busy: false, error: '', canConfirm: false };
    } else {
      const stateName = outcome?.status === 'stale-run' ? 'stale-run'
        : ['forbidden', 'missing-session', 'unknown-session', 'expired-session'].includes(outcome?.status) ? 'forbidden'
          : ['stale-version', 'conflict'].includes(outcome?.status) ? 'refresh-required' : 'unavailable';
      const savedChange = ['stale-run', 'forbidden'].includes(stateName) ? null
        : saved(outcome?.savedChange, decisionId) ? copy(outcome.savedChange) : state.savedChange;
      if (stateName !== 'unavailable' || savedChange) pending = null;
      if (pending) { uncertain(); return; }
      state = { state: stateName, savedChange, question: null, busy: false, canConfirm: false,
        error: savedChange ? 'Your change is saved. The next-offer status could not be checked.' : 'The follow-up could not be loaded.' };
    }
    emit();
  }
  async function refresh() {
    if (!alive || state.busy) return;
    const token = ++generation;
    state = { ...state, state: 'loading', busy: true, canConfirm: false, error: '' }; emit();
    let outcome;
    try { outcome = await transport.read({ decisionId }); } catch { outcome = unavailable(); }
    if (alive && token === generation) receive(outcome);
  }
  function choose(value) {
    if (!alive || state.state !== 'question' || state.busy || pending) return { status: 'conflict' };
    try {
      const next = copy(value); const error = valueError(state.question, next);
      state = { ...state, value: next, error, canConfirm: !error }; emit();
      return { status: error ? 'invalid' : 'ok' };
    } catch { return { status: 'invalid' }; }
  }
  async function confirm() {
    if (!alive || state.busy || !pending && (state.state !== 'question' || !state.canConfirm)) return;
    if (!pending) {
      let commandId;
      try { commandId = createCommandId(); } catch { receive(unavailable()); return; }
      if (!text(commandId)) { receive(unavailable()); return; }
      pending = { commandId, decisionId, expectedBriefVersion: state.briefVersion,
        questionVersion: state.question.questionVersion, value: copy(state.value) };
    }
    state = { ...state, busy: true, error: '', canConfirm: false }; emit();
    const token = ++generation;
    let outcome;
    try { outcome = await transport.confirm(copy(pending)); } catch { outcome = unavailable(); }
    if (!alive || token !== generation) return;
    if (outcome?.status === 'ok' && saved(outcome.value, decisionId)) { receive(outcome); return; }
    if (outcome?.status === 'unavailable' || !outcome || outcome.status === 'ok') { uncertain(); return; }
    if (outcome.status === 'invalid') {
      pending = null;
      state = { ...state, busy: false, state: 'question', error: 'Review your answer and choose a different value.', canConfirm: false }; emit(); return;
    }
    pending = null;
    receive(outcome);
  }
  return { snapshot, refresh, choose, confirm,
    subscribe(fn) { if (typeof fn !== 'function') throw TypeError('Supply an observer.'); listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { alive = false; generation += 1; listeners.clear(); pending = null; } };
}
