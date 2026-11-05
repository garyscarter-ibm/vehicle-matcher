import { createHash, randomBytes } from 'node:crypto';
import { inputDigest, ok, result } from '../repository/index.js';
import { createVehicleSnapshot, createEmployeeTerms, freezeVehicleData } from '../../vehicles/index.js';

export const OFFER_ACCESS_COOKIE = 'gcsp_offer_access';
export const OFFER_ACCESS_CONSUMER = 'offer-access-session-v1';
const missing = () => result('not-found', { reason: 'Offer not found.' });
const unavailable = () => result('unavailable', { reason: 'Offer access is unavailable.', retryable: true });
const stale = () => result('stale-run', { reason: 'This offer belongs to an earlier demo run.' });
const invalid = () => result('invalid', { code: 'invalid-offer-selector', reason: 'Supply only the exact offer coordinates.' });
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const instant = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).every((key) => keys.includes(key));
const select = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, structuredClone(value[key])]));
const ref = (table, runId, key) => ({ table, key: { runId, ...key } });
const cookieHash = (credential, binding) => createHash('sha256').update(JSON.stringify([
  'gcsp:offer-session:v1', binding.environmentId, binding.runId, binding.offerId, credential,
])).digest('hex');
const cookieValue = (header) => {
  const parts = typeof header === 'string' ? header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${OFFER_ACCESS_COOKIE}=`)) : [];
  const value = parts.length === 1 ? parts[0].slice(OFFER_ACCESS_COOKIE.length + 1) : null;
  return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null;
};
const scalar = (value) => value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value);
const simple = (value) => scalar(value) || Array.isArray(value) && value.every(scalar);
const safeFields = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined && simple(value[key]))
  .map((key) => [key, structuredClone(value[key])]));
const textFields = (value, keys) => Object.fromEntries(keys.filter((key) => typeof value?.[key] === 'string').map((key) => [key, value[key]]));
const publicFacts = new Set(['eligibilityModelKey', 'body', 'fuel', 'seats', 'doors', 'boot', 'zeroTo62', 'mileage',
  'evRange', 'mpg', 'cc', 'year', 'sizeClass', 'tags', 'frontIsofix', 'rearIsofix', 'gearbox', 'transmission',
  'colour', 'interior', 'co2', 'power', 'torque', 'electricRange', 'equipment', 'options', 'availableFrom']);
const projectFact = (fact) => ({ status: fact.status, value: structuredClone(fact.value), unit: fact.unit,
  provenance: textFields(fact.provenance, ['sourceRef', 'observedAt', 'version', 'assurance']) });
const explanation = (rows) => Array.isArray(rows) ? rows.map((row) => {
  if (typeof row === 'string') return row;
  const projected = safeFields(row, ['code', 'text', 'key', 'field', 'keys', 'facts', 'attribute', 'preference', 'direction',
    'expected', 'actual', 'target', 'desired', 'observed', 'unit', 'allowance', 'monthlyPoints', 'score', 'weight', 'importance', 'ruleIds', 'requiredBy', 'availableFrom']);
  if (row?.facts && !Array.isArray(row.facts) && typeof row.facts === 'object') {
    projected.facts = Object.fromEntries(Object.entries(row.facts).filter(([key, fact]) => publicFacts.has(key)
      && fact && ['known', 'unknown'].includes(fact.status) && simple(fact.value)).map(([key, fact]) => [key, projectFact(fact)]));
  }
  if (publicFacts.has(row?.field)) {
    if (row.requirement) projected.requirement = safeFields(row.requirement, ['value', 'operator', 'unit']);
    if (row.fact && ['known', 'unknown'].includes(row.fact.status) && simple(row.fact.value)) projected.fact = projectFact(row.fact);
  }
  return projected;
}) : [];
const comparisonFields = ['configuration', 'body', 'fuel', 'seats', 'boot', 'mpg', 'zeroTo62', 'points'];
function currentCarComparison(quote) {
  const pinned = quote.eligibility?.currentCarComparison;
  const display = pinned?.display;
  const fallback = { status: 'unavailable', reason: 'pinned-current-car-comparison-unavailable', comparisonAvailable: false,
    currentCar: null, unknowns: [...comparisonFields] };
  if (pinned?.schemaVersion !== '1' || pinned.comparisonAvailable !== false || !display
    || !['partial', 'unavailable'].includes(display.state)) return fallback;
  if (display.state !== 'partial' || typeof display.model !== 'string' || !display.model.trim() || display.model.length > 256
    || !['synthetic', 'dated-snapshot', 'authorised-live'].includes(display.source?.mode)
    || !text(display.source.sourceVersion) || !instant(display.source.observedAt)
    || Date.parse(display.source.observedAt) > Date.parse(quote.quotedAt)) return fallback;
  // The producer owns current-contract authentication. Never copy its internal binding.
  return { status: 'partial', reason: 'current-car-facts-unavailable', comparisonAvailable: false,
    currentCar: { model: display.model, source: textFields(display.source, ['mode', 'sourceVersion', 'observedAt']) },
    unknowns: [...comparisonFields] };
}

function presentation(offer, hold, quote, stock, clock) {
  const snapshot = createVehicleSnapshot(quote.facts);
  const terms = createEmployeeTerms(quote.terms);
  if (snapshot.identityKind !== 'exact-stock' || snapshot.sourceKeys.stockId !== offer.orderUuid
    || snapshot.vin !== undefined || terms.termsVersion !== quote.eligibility?.decision?.versions?.terms) throw Error('Invalid pinned facts');
  const decision = quote.eligibility?.decision;
  if (!['eligible', 'ineligible', 'needs-confirmation'].includes(decision?.gateStatus)
    || decision.orderUuid !== offer.orderUuid || decision.configurationId !== quote.configurationId
    || decision.versions.policy !== quote.policyVersion || decision.versions.brief !== quote.briefVersion
    || decision.versions.snapshot !== snapshot.snapshotVersion
    || inputDigest(decision.snapshot) !== inputDigest(quote.facts)
    || inputDigest(decision.terms) !== inputDigest(quote.terms)) throw Error('Inconsistent pinned decision');
  const facts = select(snapshot, ['contractVersion', 'candidateKey', 'sourceNamespace', 'identityKind', 'snapshotVersion', 'observedAt']);
  const image = (entry) => typeof entry === 'string' ? { src: entry }
    : textFields(entry, ['src', 'alt', 'caption', 'fidelity', 'sourceRef']);
  facts.sourceKeys = { stockId: snapshot.sourceKeys.stockId };
  facts.display = { ...textFields(snapshot.display, ['name', 'manufacturer', 'model', 'derivative', 'colour']),
    photo: typeof snapshot.display.photo === 'string' ? snapshot.display.photo : null,
    images: Array.isArray(snapshot.display.images) ? snapshot.display.images.map(image).filter((entry) => typeof entry.src === 'string') : [] };
  facts.facts = Object.fromEntries(Object.entries(snapshot.facts).filter(([key]) => publicFacts.has(key)).map(([key, fact]) => {
    if (!simple(fact.value)) throw Error('Unsupported public vehicle fact');
    return [key, projectFact(fact)];
  }));
  const pinnedTerms = { ...terms, allowanceInputs: select(terms.allowanceInputs, ['allowance']) };
  let state; let reason;
  if (offer.state === 'decision-pending' && hold.state === 'selection-pending') [state, reason] = ['pending', 'decision-pending'];
  else if (offer.state === 'release-pending' && hold.state === 'release-pending') [state, reason] = ['pending', 'release-pending'];
  else if (offer.state === 'accepted' && hold.state === 'allocated') [state, reason] = ['accepted', 'accepted'];
  else if (['rejected', 'declined'].includes(offer.state) && hold.state === 'released') [state, reason] = ['declined', 'declined'];
  else if (offer.state === 'superseded' && ['released', 'expired'].includes(hold.state)) [state, reason] = ['superseded', 'superseded'];
  else if (offer.state === 'expired' && ['expired', 'release-pending'].includes(hold.state)) [state, reason] = ['expired', hold.state === 'release-pending' ? 'release-pending' : 'deadline-passed'];
  else if (offer.state === 'active' && hold.state === 'active') [state, reason] = Date.parse(clock.now) >= Date.parse(hold.expiresAt)
    ? ['expired', 'deadline-passed'] : ['pending', 'awaiting-decision'];
  else throw Error('Inconsistent authority');
  const actionable = reason === 'awaiting-decision' && decision.gateStatus === 'eligible' && Date.parse(clock.now) < Date.parse(quote.validUntil);
  return freezeVehicleData({ schemaVersion: 1, offerId: offer.offerId, runId: offer.runId, state, reason,
    serverNow: clock.now, clockVersion: clock.clockVersion, expiresAt: hold.expiresAt,
    offerVersion: offer.version, holdVersion: hold.version, offerState: offer.state, holdState: hold.state,
    availableActions: actionable ? ['accept', 'decline'] : [],
    quote: { ...select(quote, ['quoteId', 'configurationId', 'orderUuid', 'briefVersion', 'policyVersion', 'quotedAt', 'validUntil']),
      orderNumber: /^\d{7}$/.test(stock.orderNumber ?? '') ? stock.orderNumber : null,
      revisions: { quote: quote.version, ...safeFields(decision.versions, ['brief', 'facts', 'policy', 'stock', 'snapshot', 'terms', 'clock', 'availability']) },
      facts, decision: { gateStatus: decision.gateStatus, score: Number.isFinite(decision.score) ? decision.score : null,
        ...Object.fromEntries(['reasons', 'tradeOffs', 'blockers', 'unknowns'].map((key) => [key, explanation(decision[key])])) },
      terms: pinnedTerms, allowance: structuredClone(pinnedTerms.allowanceInputs) },
    comparison: currentCarComparison(quote) });
}

export class OfferAccessService {
  #repository; #policy; #clock; #identity; #environmentId; #sessionNow; #verify; #secure; #contexts = new WeakMap();

  constructor({ repository, policy, clock, identity, environmentId, sessionNow, verifyOfferToken,
    secureCookies = true, allowInsecureCookiesForTests = false } = {}) {
    if (!repository || !policy || typeof clock?.now !== 'function' || !identity || !text(environmentId)
      || typeof sessionNow !== 'function' || typeof verifyOfferToken !== 'function'
      || !secureCookies && !allowInsecureCookiesForTests) throw TypeError('Inject trusted offer access dependencies.');
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
    this.#environmentId = environmentId; this.#sessionNow = sessionNow; this.#verify = verifyOfferToken; this.#secure = secureCookies;
  }

  #scope(runId) { return { environmentId: this.#environmentId, runId, principalId: 'offer-access-service', roles: [] }; }
  #binding(selector) { return { environmentId: this.#environmentId, runId: selector.runId, offerId: selector.offerId }; }
  #brand(binding, auth) {
    const context = Object.freeze({ ...binding }); this.#contexts.set(context, auth); return context;
  }
  async #current() {
    const current = await this.#repository.currentRun(this.#environmentId);
    if (current.status !== 'ok') return { error: unavailable() };
    const clock = await this.#clock.now(this.#scope(current.value.runId));
    const wall = this.#sessionNow();
    if (clock.status !== 'ok' || clock.value.runId !== current.value.runId || !instant(clock.value.now)
      || !text(clock.value.clockVersion) || !instant(wall)) return { error: unavailable() };
    return { run: current.value, clock: clock.value, wall };
  }
  async #offer(binding) {
    const found = await this.#repository.read(this.#scope(binding.runId), ref('offers', binding.runId, { offerId: binding.offerId }));
    if (found.status !== 'ok') return { error: found.status === 'unavailable' ? unavailable() : missing() };
    if (found.value.environmentId !== binding.environmentId || found.value.runId !== binding.runId || found.value.offerId !== binding.offerId) return { error: missing() };
    return { offer: found.value };
  }

  async exchange(input) {
    if (!only(input, ['runId', 'offerId', 'token']) || !text(input.runId) || !text(input.offerId)) return missing();
    try {
      const binding = this.#binding(input); const located = await this.#offer(binding);
      if (located.error) return located.error;
      if (!this.#verify(input.token, binding, located.offer.tokenHash)) return missing();
      const current = await this.#current(); if (current.error) return current.error;
      if (binding.runId !== current.run.runId) return stale();
      const read = { runId: binding.runId, asOf: current.clock.now, policyVersion: current.run.policyVersion };
      const rules = await Promise.all(['identity.session.durationSeconds', 'identity.session.clock', 'identity.session.sameSite']
        .map((key) => this.#policy.getAssumption(key, read)));
      if (rules.some((rule) => rule.status !== 'ok' || rule.policyVersion !== current.run.policyVersion)) return unavailable();
      const [duration, clockRule, sameSite] = rules.map((rule) => rule.value.value);
      if (!Number.isSafeInteger(duration) || duration <= 0 || clockRule !== 'server-wall-clock'
        || !['Strict', 'Lax', 'None'].includes(sameSite) || sameSite === 'None' && !this.#secure) return unavailable();
      const credential = randomBytes(32).toString('base64url'); const eventId = cookieHash(credential, binding);
      const expiresAt = new Date(Date.parse(current.wall) + duration * 1000).toISOString();
      const record = { schemaVersion: 1, ...binding, expiresAt };
      // Neither transaction input nor its automatic receipt ever contains a plaintext credential.
      const saved = await this.#repository.transaction(this.#scope(binding.runId), {
        commandId: `offer-access:${eventId}`, inputDigest: inputDigest({ record, eventId }),
      }, async (tx) => {
        const latest = await tx.get(ref('offers', binding.runId, { offerId: binding.offerId }));
        if (latest.status !== 'ok' || latest.value.tokenHash !== located.offer.tokenHash) return missing();
        const stored = await tx.recordReceipt({ consumerId: OFFER_ACCESS_CONSUMER, eventId,
          inputDigest: inputDigest(record), outcome: record });
        return stored.status === 'ok' ? ok({ recorded: true }) : unavailable();
      });
      if (saved.status !== 'ok') return saved.status === 'stale-run' ? stale() : saved;
      const context = this.#brand(binding, { kind: 'session', eventId });
      const offered = await this.read(context); if (offered.status !== 'ok') return offered;
      const setCookie = `${OFFER_ACCESS_COOKIE}=${credential}; Path=/api/gcsp/offers; HttpOnly; SameSite=${sameSite}; Expires=${new Date(expiresAt).toUTCString()}${this.#secure ? '; Secure' : ''}`;
      return ok({ context, offer: offered.value, setCookie });
    } catch { return unavailable(); }
  }

  async fromSession(selector, cookie) {
    if (!only(selector, ['runId', 'offerId']) || selector.runId !== undefined && !text(selector.runId) || !text(selector.offerId)) return invalid();
    const credential = cookieValue(cookie); if (!credential) return missing();
    try {
      const current = selector.runId === undefined ? await this.#current() : null;
      if (current?.error) return current.error;
      const binding = this.#binding({ ...selector, runId: selector.runId ?? current.run.runId });
      const context = this.#brand(binding, { kind: 'session', eventId: cookieHash(credential, binding) });
      const offered = await this.read(context);
      return offered.status === 'ok' ? ok({ context, offer: offered.value }) : offered;
    } catch { return unavailable(); }
  }

  async fromAccount(identityContext, selector) {
    if (!only(selector, ['runId', 'offerId']) || !text(selector.offerId) || selector.runId !== undefined && !text(selector.runId)) return invalid();
    try {
      const current = await this.#current(); if (current.error) return current.error;
      const binding = this.#binding({ runId: selector.runId ?? current.run.runId, offerId: selector.offerId });
      const allowed = await this.#identity.authorizeResource(identityContext, ref('offers', binding.runId, { offerId: binding.offerId }), 'read');
      if (allowed.status !== 'ok') return ['forbidden', 'not-found'].includes(allowed.status) ? missing() : allowed;
      const context = this.#brand(binding, { kind: 'account', identityContext });
      const offered = await this.read(context);
      return offered.status === 'ok' ? ok({ context, offer: offered.value }) : offered;
    } catch { return unavailable(); }
  }

  async #guard(context, action = 'read') {
    const auth = context && this.#contexts.get(context); if (!auth) return { error: missing() };
    const binding = this.#binding(context);
    if (auth.kind === 'session') {
      const receipt = await this.#repository.read(this.#scope(binding.runId), ref('event_receipts', binding.runId,
        { consumerId: OFFER_ACCESS_CONSUMER, eventId: auth.eventId }));
      if (receipt.status !== 'ok') return { error: receipt.status === 'unavailable' ? unavailable() : missing() };
      const stored = receipt.value.outcome; const wall = this.#sessionNow();
      if (!instant(wall)) return { error: unavailable() };
      if (stored?.schemaVersion !== 1 || ['environmentId', 'runId', 'offerId'].some((key) => stored[key] !== binding[key])
        || !instant(stored.expiresAt) || Date.parse(wall) >= Date.parse(stored.expiresAt)) return { error: missing() };
    } else {
      const allowed = await this.#identity.authorizeResource(auth.identityContext, ref('offers', binding.runId, { offerId: binding.offerId }), action === 'decide' ? 'write' : 'read');
      if (allowed.status !== 'ok') return { error: ['forbidden', 'not-found'].includes(allowed.status) ? missing() : allowed };
    }
    const located = await this.#offer(binding); if (located.error) return located;
    const current = await this.#current(); if (current.error) return current;
    if (current.run.runId !== binding.runId) return { error: stale() };
    return { ...current, ...located, binding };
  }

  async authorizeOffer(context, selector, action = 'read') {
    if (!only(selector, ['runId', 'offerId']) || !['read', 'decide'].includes(action)
      || selector.runId !== context?.runId || selector.offerId !== context?.offerId) return missing();
    try { const state = await this.#guard(context, action); return state.error ?? ok({ ...state.binding }); } catch { return unavailable(); }
  }

  async read(context) {
    try {
      const state = await this.#guard(context); if (state.error) return state.error;
      const { offer, binding } = state; const scope = this.#scope(binding.runId);
      const refs = [ref('holds', binding.runId, { holdId: offer.holdId }), ref('quotes', binding.runId, { quoteId: offer.quoteId }), ref('stock', binding.runId, { orderUuid: offer.orderUuid })];
      const found = await Promise.all(refs.map((entry) => this.#repository.read(scope, entry)));
      if (found.some((row) => row.status !== 'ok')) return unavailable();
      const [hold, quote, stock] = found.map((row) => row.value);
      if (hold.type !== 'buddy-offer' || !instant(hold.expiresAt) || offer.expiresAt !== hold.expiresAt
        || !instant(quote.validUntil) || ['employeeId', 'orderUuid', 'quoteId', 'policyVersion'].some((key) => hold[key] !== offer[key])
        || ['employeeId', 'orderUuid', 'policyVersion', 'briefVersion'].some((key) => quote[key] !== offer[key])
        || stock.configurationId !== quote.configurationId) return unavailable();
      const value = presentation(offer, hold, quote, stock, state.clock);
      const final = await this.#guard(context); if (final.error) return final.error;
      const again = await Promise.all(refs.map((entry) => this.#repository.read(scope, entry)));
      if (final.offer.version !== offer.version || final.clock.clockVersion !== state.clock.clockVersion
        || final.clock.now !== state.clock.now || again.some((row, i) => row.status !== 'ok' || row.value.version !== found[i].value.version)) return unavailable();
      const latest = await this.#guard(context); if (latest.error) return latest.error;
      if (latest.offer.version !== offer.version || latest.clock.clockVersion !== state.clock.clockVersion || latest.clock.now !== state.clock.now) return unavailable();
      return ok(value);
    } catch { return unavailable(); }
  }
}

export const createOfferAccessService = (options) => new OfferAccessService(options);
