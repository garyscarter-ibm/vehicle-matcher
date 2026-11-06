// Safe display binding for FUCQ-102 schemaVersion 1, reviewed at 4a56d38.
import { decisionView } from '../brief/brief-view-model.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0;
const scalar = (v) => v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v);
const simple = (v) => scalar(v) || Array.isArray(v) && v.every(scalar);
const positive = (v) => Number.isInteger(v) && v > 0;
const instant = (v) => text(v) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v))
  && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const copy = (v) => structuredClone(v);
const refuse = () => { throw new TypeError('Invalid offer display response.'); };
const need = (condition) => { if (!condition) refuse(); };
const facts = new Set(['eligibilityModelKey', 'body', 'fuel', 'seats', 'doors', 'boot', 'zeroTo62', 'mileage', 'evRange', 'mpg',
  'cc', 'year', 'sizeClass', 'tags', 'frontIsofix', 'rearIsofix', 'gearbox', 'transmission', 'colour', 'interior', 'co2', 'power', 'torque',
  'electricRange', 'equipment', 'options', 'availableFrom']);
const assurance = new Set(['unknown', 'confirmed-listing', 'confirmed-build', 'model-reference', 'derived', 'synthetic-scenario']);
const states = new Set(['pending', 'accepted', 'declined', 'expired', 'superseded']);
const explanations = ['code', 'text', 'key', 'field', 'keys', 'attribute', 'preference', 'direction', 'expected', 'actual', 'target',
  'desired', 'observed', 'unit', 'allowance', 'monthlyPoints', 'score', 'weight', 'importance', 'ruleIds', 'requiredBy', 'availableFrom'];

function provenance(v) {
  need(object(v) && text(v.sourceRef) && instant(v.observedAt) && text(v.version) && assurance.has(v.assurance));
  return { sourceRef: v.sourceRef, observedAt: v.observedAt, version: v.version, assurance: v.assurance };
}
function fact(v) {
  need(object(v) && ['known', 'unknown'].includes(v.status) && simple(v.value)
    && (v.status !== 'unknown' || v.value === null) && (v.unit === null || typeof v.unit === 'string'));
  return { status: v.status, value: copy(v.value), unit: v.unit, provenance: provenance(v.provenance) };
}
function factMap(v) {
  need(object(v));
  return Object.fromEntries(Object.entries(v).filter(([key]) => facts.has(key)).map(([key, value]) => [key, fact(value)]));
}
function explanation(v) {
  if (typeof v === 'string') return v;
  need(object(v));
  const out = {};
  for (const key of explanations) if (Object.hasOwn(v, key)) { need(simple(v[key])); out[key] = copy(v[key]); }
  if (Object.hasOwn(v, 'facts')) out.facts = object(v.facts) ? factMap(v.facts) : (need(simple(v.facts)), copy(v.facts));
  if (facts.has(v.field)) {
    if (v.fact !== undefined) out.fact = fact(v.fact);
    if (v.requirement !== undefined) {
      need(object(v.requirement)); out.requirement = {};
      for (const key of ['value', 'operator', 'unit']) if (Object.hasOwn(v.requirement, key)) {
        need(simple(v.requirement[key])); out.requirement[key] = copy(v.requirement[key]);
      }
    }
  }
  return out;
}
function decision(v) {
  need(object(v) && ['eligible', 'ineligible', 'needs-confirmation'].includes(v.gateStatus)
    && (v.score === null || typeof v.score === 'number' && Number.isFinite(v.score)));
  const out = { gateStatus: v.gateStatus, score: v.score };
  for (const key of ['reasons', 'tradeOffs', 'blockers', 'unknowns']) { need(Array.isArray(v[key])); out[key] = v[key].map(explanation); }
  return out;
}
function imageURL(value) {
  need(value === null || typeof value === 'string');
  if (value === null || value === '') return null;
  const url = new URL(value, 'https://offer-display.invalid/');
  need(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
  return value;
}
function snapshot(v, orderUuid) {
  need(object(v) && v.contractVersion === 'vehicle-snapshot-v1' && v.identityKind === 'exact-stock'
    && ['candidateKey', 'sourceNamespace', 'snapshotVersion'].every((key) => text(v[key]))
    && instant(v.observedAt) && object(v.sourceKeys) && v.sourceKeys.stockId === orderUuid
    && object(v.display) && text(v.display.name) && Array.isArray(v.display.images));
  const display = { name: v.display.name, photo: imageURL(v.display.photo), images: v.display.images.map((image) => {
    need(object(image) && text(image.src)); const out = { src: imageURL(image.src) };
    for (const key of ['alt', 'caption', 'fidelity', 'sourceRef']) if (image[key] !== undefined) { need(typeof image[key] === 'string'); out[key] = image[key]; }
    return out;
  }) };
  for (const key of ['manufacturer', 'model', 'derivative', 'colour']) if (v.display[key] !== undefined) {
    need(typeof v.display[key] === 'string'); display[key] = v.display[key];
  }
  return { contractVersion: v.contractVersion, identityKind: v.identityKind, candidateKey: v.candidateKey,
    sourceNamespace: v.sourceNamespace, snapshotVersion: v.snapshotVersion, observedAt: v.observedAt,
    sourceKeys: { stockId: orderUuid }, display, facts: factMap(v.facts) };
}
function points(v) {
  need(object(v) && v.unit === 'points' && typeof v.value === 'number' && Number.isFinite(v.value) && v.value >= 0);
  return { value: v.value, unit: 'points' };
}
function allowance(v) {
  need(object(v)); return v.allowance === undefined ? {} : { allowance: points(v.allowance) };
}
function terms(v) {
  need(object(v) && v.kind === 'employee-scheme' && text(v.termsVersion) && instant(v.validFrom) && instant(v.validUntil));
  if (v.contribution !== null) need(object(v.contribution) && Number.isFinite(v.contribution.amount) && v.contribution.amount >= 0
    && /^[A-Z]{3}$/.test(v.contribution.currency) && ['month', 'year', 'one-off'].includes(v.contribution.period));
  return { kind: v.kind, termsVersion: v.termsVersion, validFrom: v.validFrom, validUntil: v.validUntil,
    points: points(v.points), allowanceInputs: allowance(v.allowanceInputs), provenance: provenance(v.provenance) };
}
const valueText = (v) => Array.isArray(v) ? v.length ? v.map((entry) => entry === null ? 'Not supplied' : String(entry)).join(', ') : 'None listed' : v;
const detailFact = (label, source, missingLabel = 'Not supplied') => ({ label, value: source?.status === 'known' ? valueText(source.value) : null,
  unit: source?.unit, missingLabel, ...(source?.provenance ? { provenance: copy(source.provenance) } : {}) });

const comparisonFields = { configuration: 'Configuration', body: 'Body', fuel: 'Fuel', seats: 'Seats', boot: 'Boot',
  mpg: 'MPG', zeroTo62: '0–62 mph', points: 'Points a month' };
const sourceModes = { synthetic: 'Synthetic', 'dated-snapshot': 'Dated snapshot', 'authorised-live': 'Authorised live' };

function noLaterThan(value, limit) {
  const [a, b] = [value, limit].map((v) => v.slice(0, 19) + (v[19] === '.' ? v.slice(19, -1) : '.'));
  const length = Math.max(a.length, b.length);
  return a.padEnd(length, '0') <= b.padEnd(length, '0');
}

function currentCarFor(v, quotedAt) {
  const car = v?.currentCar; const source = car?.source;
  if (!object(v) || v.status !== 'partial' || v.reason !== 'current-car-facts-unavailable' || v.comparisonAvailable !== false
    || !Array.isArray(v.unknowns) || v.unknowns.length !== 8 || new Set(v.unknowns).size !== 8
    || !v.unknowns.every((key) => typeof key === 'string' && Object.hasOwn(comparisonFields, key))
    || !object(car) || !text(car.model) || !car.model.trim() || car.model.length > 256
    || !object(source) || typeof source.mode !== 'string' || !Object.hasOwn(sourceModes, source.mode)
    || !text(source.sourceVersion) || !source.sourceVersion.trim()
    || !instant(source.observedAt) || !noLaterThan(source.observedAt, quotedAt)) return null;
  // Only the reviewed model/source metadata crosses. Specifications and current points remain unknown.
  return { status: 'partial', display: { name: car.model }, media: {},
    facts: Object.values(comparisonFields).map((label) => ({ label, value: null, missingLabel: 'Unknown' })),
    source: { mode: source.mode, sourceVersion: source.sourceVersion, observedAt: source.observedAt },
    provenance: `${sourceModes[source.mode]} source: ${source.sourceVersion}. Observed ${source.observedAt}.` };
}

function cardFor(quote) {
  const card = decisionView({ ...quote.decision, snapshot: quote.facts, orderUuid: quote.orderUuid,
    configurationId: quote.configurationId, candidateKey: quote.facts.candidateKey, terms: quote.terms, versions: quote.revisions });
  const member = card.members[0];
  const display = quote.facts.display; const details = quote.facts.facts;
  member.display.line = quote.orderNumber === null ? 'Order number not supplied' : `Order no. ${quote.orderNumber}`;
  const photo = display.images.find((image) => image.src === display.photo);
  member.media = { src: display.photo, alt: photo?.alt || display.name,
    caption: display.photo ? photo?.caption || 'Representative image; exact appearance and equipment unconfirmed.' : null };
  member.facts.unshift({ label: 'Model', value: display.model ?? null }, { label: 'Derivative', value: display.derivative ?? null },
    details.colour ? detailFact('Colour', details.colour) : { label: 'Colour', value: display.colour ?? null },
    detailFact('Options', details.options ?? details.equipment, 'Fitted equipment unknown'));
  member.facts.push(detailFact('Interior', details.interior), detailFact('Gearbox', details.gearbox ?? details.transmission));
  member.terms[0].provenance = quote.terms.provenance;
  member.provenance = { quoteId: quote.quoteId, briefVersion: quote.briefVersion, policyVersion: quote.policyVersion,
    revisions: quote.revisions, quotedAt: quote.quotedAt, sourceNamespace: quote.facts.sourceNamespace,
    snapshotVersion: quote.facts.snapshotVersion, observedAt: quote.facts.observedAt };
  return card;
}

/** Validate the approved public contract, preserving supplied pins and omitting unsupported/private fields. */
export function toOfferPresentation(envelope, { reference } = {}) {
  if (envelope?.status !== 'ok') return { status: ['not-found', 'stale-run', 'forbidden'].includes(envelope?.status) ? envelope.status : 'unavailable' };
  try {
    const v = envelope.value; const q = v?.quote;
    need(object(v) && v.schemaVersion === 1 && text(v.offerId) && text(v.runId) && states.has(v.state) && text(v.reason)
      && instant(v.serverNow) && instant(v.expiresAt) && text(v.clockVersion) && positive(v.offerVersion) && positive(v.holdVersion)
      && text(v.holdState) && text(v.offerState) && Array.isArray(v.availableActions)
      && v.availableActions.every((action) => ['accept', 'decline'].includes(action)) && new Set(v.availableActions).size === v.availableActions.length
      && (!v.availableActions.includes('accept') || v.availableActions.includes('decline'))
      && (v.state === 'pending' || v.availableActions.length === 0));
    need(!reference || v.offerId === reference.offerId && (!reference.runId || v.runId === reference.runId));
    need(object(q) && ['quoteId', 'configurationId', 'orderUuid', 'policyVersion'].every((key) => text(q[key]))
      && positive(q.briefVersion) && (q.orderNumber === null || typeof q.orderNumber === 'string' && /^\d{7}$/.test(q.orderNumber))
      && instant(q.quotedAt) && instant(q.validUntil) && object(q.revisions) && positive(q.revisions.quote));
    const revisions = { quote: q.revisions.quote };
    for (const key of ['brief', 'facts', 'policy', 'stock', 'snapshot', 'terms', 'clock', 'availability']) if (q.revisions[key] !== undefined) {
      need(scalar(q.revisions[key]) && typeof q.revisions[key] !== 'boolean'); revisions[key] = q.revisions[key];
    }
    const quote = { quoteId: q.quoteId, configurationId: q.configurationId, orderUuid: q.orderUuid, orderNumber: q.orderNumber,
      briefVersion: q.briefVersion, policyVersion: q.policyVersion, quotedAt: q.quotedAt, validUntil: q.validUntil, revisions,
      facts: snapshot(q.facts, q.orderUuid), decision: decision(q.decision), terms: terms(q.terms), allowance: allowance(q.allowance) };
    need(JSON.stringify(quote.allowance) === JSON.stringify(quote.terms.allowanceInputs));
    const currentCar = currentCarFor(v.comparison, quote.quotedAt);
    const uncertain = v.state === 'pending' && ['decision-pending', 'release-pending'].includes(v.reason);
    const actions = { accept: !uncertain && v.availableActions.includes('accept'), decline: !uncertain && v.availableActions.includes('decline') };
    return { status: 'ok', value: { state: uncertain ? 'uncertain' : v.state, reason: v.reason,
      ...(uncertain ? { message: v.reason === 'release-pending' ? 'The release is being confirmed. Actions are unavailable.'
        : 'Your decision is being confirmed. Actions are unavailable.' } : {}),
      reference: { offerId: v.offerId, runId: v.runId, offerVersion: v.offerVersion, holdVersion: v.holdVersion },
      now: v.serverNow, clockVersion: v.clockVersion, expiresAt: v.expiresAt, actionable: v.state === 'pending' && !uncertain,
      actions, card: cardFor(quote), comparisonAvailable: false, currentCar } };
  } catch { return { status: 'unavailable', retryable: true }; }
}
