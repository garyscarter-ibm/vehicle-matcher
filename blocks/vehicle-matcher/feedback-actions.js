/**
 * Local feedback contract v1. Actions are JSON data, never persisted predicates.
 * Scenario adapters own identity, authority and policy. Nothing here owns stock,
 * offers, holds, account learning or persistence.
 *
 * @typedef {{kind: 'browse'|'employee-draft', id: string}} FeedbackScope
 * @typedef {{field: 'shade'|'purchase-price'|'odometer'|'transmission'|'feature', operator: 'equals'|'not-equals'|'less-than'|'includes', value: string|number}} FeedbackPredicate
 * @typedef {{schemaVersion: 1, id: string, type: 'exclude-candidate'|'exclude-group'|'filter'|'confirm-change'|'undo'|'reset', target: object, reason: string, scope: FeedbackScope, expectedVersion: number, confirmation?: {actor: 'employee', confirmed: true, at: string}}} FeedbackAction
 */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const only = (v, keys) => object(v) && Object.keys(v).every((key) => keys.includes(key));
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const version = (v) => Number.isSafeInteger(v) && v >= 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failure = (code) => ({ status: 'invalid', code });
const scopeValid = (s) => only(s, ['kind', 'id']) && ['browse', 'employee-draft'].includes(s.kind) && text(s.id);
const scopeEqual = (a, b) => a.kind === b.kind && a.id === b.id;
const json = (v, ancestors = new Set()) => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return true;
  if ((!Array.isArray(v) && !object(v)) || ancestors.has(v)) return false;
  ancestors.add(v);
  const valid = Object.entries(v).every(([key, value]) => !['__proto__', 'prototype', 'constructor'].includes(key) && json(value, ancestors));
  ancestors.delete(v);
  return valid;
};
const instant = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));

export function validFeedbackPredicate(p) {
  if (!only(p, ['field', 'operator', 'value'])) return false;
  if (['purchase-price', 'odometer'].includes(p.field)) return p.operator === 'less-than' && Number.isFinite(p.value);
  if (p.field === 'feature') return p.operator === 'includes' && text(p.value);
  return ['shade', 'transmission'].includes(p.field) && ['equals', 'not-equals'].includes(p.operator) && text(p.value);
}

export function validateFeedbackAction(a) {
  if (!json(a) || !only(a, ['schemaVersion', 'id', 'type', 'target', 'reason', 'scope', 'expectedVersion', 'confirmation'])
    || a.schemaVersion !== 1 || !text(a.id) || !text(a.reason) || !scopeValid(a.scope) || !version(a.expectedVersion)) return failure('invalid-action');
  const t = a.target;
  if (a.type === 'filter') return validFeedbackPredicate(t) ? null : failure('invalid-predicate');
  if (a.type === 'exclude-candidate' || a.type === 'exclude-group') return only(t, ['id']) && text(t.id) ? null : failure('invalid-target');
  if (a.type === 'undo') return only(t, ['actionIds']) && Array.isArray(t.actionIds) && t.actionIds.length > 0 && t.actionIds.every(text) ? null : failure('invalid-target');
  if (a.type === 'reset') return only(t, []) ? null : failure('invalid-target');
  if (a.type !== 'confirm-change' || a.scope.kind !== 'employee-draft' || !only(t, ['path', 'value']) || !Object.hasOwn(t, 'value')
    || !/^preferences\.[a-zA-Z][a-zA-Z0-9]*\.(value|importance)$|^essentials\.[a-zA-Z][a-zA-Z0-9]*$/.test(t.path)) return failure('invalid-target');
  if (!only(a.confirmation, ['actor', 'confirmed', 'at']) || a.confirmation.actor !== 'employee' || a.confirmation.confirmed !== true
    || !instant(a.confirmation.at)) return { status: 'confirmation-required', code: 'employee-confirmation-required' };
  return null;
}

export function createFeedbackState(scope, initialVersion = 0) {
  if (!scopeValid(scope) || !version(initialVersion)) throw TypeError('Supply a local feedback scope and version.');
  return { schemaVersion: 1, scope: structuredClone(scope), version: initialVersion, actions: [] };
}

/** Atomic local reducer: failed actions return no partial state or next version. */
export function reduceFeedback(state, action) {
  const error = validateFeedbackAction(action); if (error) return error;
  if (!scopeValid(state?.scope) || !version(state.version) || !Array.isArray(state.actions)) return failure('invalid-state');
  if (!scopeEqual(state.scope, action.scope)) return failure('scope-mismatch');
  if (state.version !== action.expectedVersion) return { status: 'stale-version', expectedVersion: action.expectedVersion, currentVersion: state.version };
  let actions = state.actions;
  if (action.type === 'undo') {
    if (action.target.actionIds.some((id) => !actions.some((a) => a.id === id))) return failure('unknown-action');
    actions = actions.filter((a) => !action.target.actionIds.includes(a.id));
  } else if (action.type === 'reset') actions = [];
  else {
    if (actions.some((a) => a.id === action.id)) return failure('duplicate-action');
    actions = [...actions, action];
  }
  const nextVersion = state.version + 1;
  return { status: 'ok', nextVersion, state: structuredClone({ ...state, version: nextVersion, actions }) };
}

/** Retail units are explicit: purchase price and odometer never mean annual usage. */
export function matchesFeedbackPredicate(listing, p) {
  if (!validFeedbackPredicate(p)) return false;
  const value = p.field === 'shade' ? listing.shade || listing.colour
    : p.field === 'purchase-price' ? listing.priceMin : p.field === 'odometer' ? listing.mileage
      : p.field === 'transmission' ? listing.transmission : listing.features || [];
  if (p.operator === 'less-than') return value != null && value < p.value;
  if (p.operator === 'includes') return value.includes(p.value);
  return p.operator === 'equals' ? value === p.value : value !== p.value;
}

export function candidateSurvivesFeedback(state, { candidateId, groupId, listing }) {
  return state.actions.every((a) => a.type === 'exclude-group' ? a.target.id !== groupId
    : a.type === 'exclude-candidate' ? a.target.id !== candidateId
      : a.type !== 'filter' || matchesFeedbackPredicate(listing, a.target));
}

/** Rebuild all displayed claims from exact surviving retail listings. */
export function regroupFeedbackCar(car, kept) {
  const head = kept[0];
  const prices = kept.map((l) => l.priceMin).filter(Number.isFinite);
  return { ...car, photo: head.photo,
    colour: head.colour ? { manufacturerColour: head.colour, colour: head.shade } : undefined,
    priceMin: head.priceMin ?? car.priceMin, priceMax: head.priceMax ?? head.priceMin ?? car.priceMax,
    mileage: head.mileage ?? null,
    transmission: head.transmission, link: head.link,
    listingCount: kept.length, priceFrom: prices.length ? Math.min(...prices) : car.priceFrom,
    priceTo: prices.length ? Math.max(...prices) : car.priceTo,
    colours: [...new Set(kept.map((l) => l.colour).filter(Boolean))],
    features: [...new Set(kept.flatMap((l) => l.features || []))] };
}

export function applyBrowseFeedback(matches, state) {
  return matches.flatMap((match) => {
    const all = match.listings || [];
    const kept = all.filter((listing) => candidateSurvivesFeedback(state, { groupId: match.car.id,
      candidateId: listing.id ?? listing.link, listing }));
    if (!kept.length) return [];
    if (kept.length === all.length) return [match];
    // Decisions belong to listings, just like price and equipment. A mixed
    // deployment may omit them; only the original first listing can then use
    // the representative fields. Never infer a missing score in the client.
    const exact = kept[0].decision;
    const selected = exact || (kept[0] === all[0] ? match : {
      score: undefined, fit: undefined, taste: undefined, stretch: undefined,
      reasons: [], tradeOffs: [], decisionUnavailable: true,
    });
    const { score, fit, taste, stretch, reasons, tradeOffs, decisionUnavailable } = selected;
    return [{ ...match, score, fit, taste, stretch, reasons, tradeOffs, decisionUnavailable,
      car: regroupFeedbackCar(match.car, kept), listings: kept }];
  });
}

const essentialMeaning = ({ operator, value, unit, state }) => ({ operator,
  value: operator === 'includes' && Array.isArray(value) ? [...new Set(value)].sort() : value, unit, state });

/** Canonical confirmed change shared by ephemeral drafts and the persistence owner. */
export function applyConfirmedFeedbackChange(brief, action, currentVersion = brief.briefVersion) {
  const error = validateFeedbackAction(action); if (error) return error;
  if (action.type !== 'confirm-change') return failure('invalid-change-action');
  if (currentVersion !== action.expectedVersion) return { status: 'stale-version', expectedVersion: action.expectedVersion, currentVersion };
  const [section, key, field] = action.target.path.split('.');
  if (!object(brief[section]) || !Object.hasOwn(brief[section], key)) return failure('unknown-field');
  const before = structuredClone(field ? brief[section][key][field] : brief[section][key]);
  const value = structuredClone(action.target.value);
  if (section === 'essentials' && (!object(value) || value.state !== 'confirmed' || value.value === null || value.value === undefined)) return failure('confirmed-essential-required');
  const after = section === 'preferences' ? value : { ...value, source: 'employee', confirmedAt: action.confirmation.at };
  if (same(section === 'essentials' ? essentialMeaning(before) : before, section === 'essentials' ? essentialMeaning(after) : after)) return failure('unchanged-value');
  const next = structuredClone(brief);
  if (section === 'preferences') next.preferences[key] = { ...next.preferences[key], [field]: after, source: 'employee',
    [field === 'importance' ? 'importanceState' : 'valueState']: 'confirmed', confirmedAt: action.confirmation.at };
  else next.essentials[key] = after;
  const nextVersion = currentVersion + 1;
  next.briefVersion = nextVersion;
  return { status: 'ok', brief: next, before, after, nextVersion };
}
