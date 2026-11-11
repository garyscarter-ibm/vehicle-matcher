import { rankCars } from '../../engine.js';
import { validInstant } from '../../gcsp/policy/file-provider.js';
import { scoreOptionEvidence } from './option-evidence.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const only = (value, fields) => object(value) && Object.keys(value).every((key) => fields.includes(key));
const states = ['draft', 'inferred', 'confirmed'];
export const confirmedFact = (fact, config) => fact?.status === 'known' && fact.value !== null
  && text(fact.provenance?.sourceRef) && text(fact.provenance?.version) && validInstant(fact.provenance?.observedAt)
  && config.confirmedAssurances.includes(fact.provenance?.assurance);

// Editor placeholders describe an unanswered optional control, not an employee requirement.
// Keep this exact: an employee's explicit unknown and authoritative source unknowns still gate.
export const unselectedPracticalAnswer = (answer) => answer?.source === 'policy:brief.editor.v1'
  && answer.state === 'needs-confirmation' && answer.value === null;
export const unselectedPreference = (preference) => preference?.source === 'policy:brief.editor.v1'
  && preference.valueState === 'draft' && preference.importanceState === 'draft';

export function chargingGates(snapshot, employeeFacts, config, required) {
  if (!required) return { blockers: [], unknowns: [], reasons: [] };
  const fuel = snapshot.facts.fuel;
  if (!confirmedFact(fuel, config) || !config.preferences.fuel.values.includes(fuel.value)) return { blockers: [], unknowns: [{ code: 'fuel-unconfirmed', fact: fuel ?? null }], reasons: [] };
  if (!config.plugInFuels.includes(fuel.value)) return { blockers: [], unknowns: [], reasons: [] };
  const charging = employeeFacts.charging;
  if (!confirmedFact(charging, config)) return { blockers: [], unknowns: [{ code: 'charging-unconfirmed', fact: charging ?? null }], reasons: [] };
  return config.chargingAccess.includes(charging.value)
    ? { blockers: [], unknowns: [], reasons: [{ code: 'charging-ready', fact: charging }] }
    : { blockers: [{ code: 'charging-unavailable', fact: charging }], unknowns: [], reasons: [] };
}

export function validateBrief(request, config, slider) {
  if (!only(request, ['schemaVersion', 'briefVersion', 'preferences', 'essentials', 'requiredBy'])
    || !Number.isSafeInteger(request.briefVersion) || request.briefVersion <= 0) return [{ field: 'brief', reason: 'Supply the supported read-only brief contract.' }];
  const { briefVersion, ...content } = request;
  return validateBriefContent(content, config, slider);
}

// A multiple enum takes a legacy scalar or unique registered values in registry order (stable digests).
export const validChoice = (value, definition) => !Array.isArray(definition.values) ? false
  : definition.multiple === true && Array.isArray(value)
    ? value.length > 0 && value.every((v, i) => definition.values.includes(v)
      && (i === 0 || definition.values.indexOf(v) > definition.values.indexOf(value[i - 1])))
    : definition.values.includes(value);
// Compatible read: a scalar x reads as [x] for a multiple enum.
export const choiceList = (value) => Array.isArray(value) ? value : [value];
// Intent comparison: a scalar x and [x] are the same choice.
export const intentValue = (value) => Array.isArray(value) && value.length === 1 ? value[0] : value;

export function validateBriefContent(request, config, slider) {
  const errors = [];
  const add = (field) => errors.push({ field, reason: 'Unsupported or invalid brief field.' });
  if (!only(request, ['schemaVersion', 'preferences', 'essentials', 'requiredBy']) || request.schemaVersion !== 1)
    return [{ field: 'brief', reason: 'Supply the supported brief content contract.' }];
  if (!object(request.preferences) || !object(request.essentials)) return [{ field: 'brief', reason: 'Supply preferences and essentials maps.' }];
  const within = (v) => Number.isInteger(v) && v >= slider.minimum && v <= slider.maximum;
  for (const [key, p] of Object.entries(request.preferences)) {
    const definition = Object.hasOwn(config.preferences, key) ? config.preferences[key] : null;
    if (!definition || !only(p, ['value', 'importance', 'valueState', 'importanceState', 'source', 'confirmedAt'])
      || !within(p.importance) || !states.includes(p.valueState) || !states.includes(p.importanceState) || !text(p.source)
      || (p.confirmedAt !== undefined && !validInstant(p.confirmedAt))
      || (definition.type === 'slider' ? !within(p.value) : !validChoice(p.value, definition))) add(`preferences.${key}`);
  }
  for (const [key, e] of Object.entries(request.essentials)) {
    const d = Object.hasOwn(config.essentials, key) ? config.essentials[key] : null;
    if (!d || !only(e, ['value', 'operator', 'unit', 'state', 'source', 'confirmedAt'])
      || e.operator !== d.operator || e.unit !== d.unit || ![...states, 'needs-confirmation'].includes(e.state) || !text(e.source)
      || (e.confirmedAt !== undefined && !validInstant(e.confirmedAt))
      || (e.value === null ? e.state !== 'needs-confirmation'
        : (d.type === 'number' && (!Number.isFinite(e.value) || e.value < 0 || key === 'seats' && !Number.isInteger(e.value)))
        || (d.type === 'enum' && !d.values.includes(e.value))
        || (d.type === 'boolean' && typeof e.value !== 'boolean') || (d.type === 'string' && !text(e.value))
        || (d.type === 'list' && (!Array.isArray(e.value) || !e.value.every(text))))) add(`essentials.${key}`);
  }
  if (request.requiredBy !== undefined && !validInstant(request.requiredBy)) add('requiredBy');
  return errors;
}

export function evaluateEssentials(snapshot, brief, config, { optionalDefaults = false } = {}) {
  const blockers = []; const unknowns = []; const reasons = [];
  for (const [field, requirement] of Object.entries(brief.essentials)) {
    if (optionalDefaults && unselectedPracticalAnswer(requirement)) continue;
    const fact = snapshot.facts[field];
    if (requirement.state === 'confirmed' && (requirement.operator === 'includes' && requirement.value.length === 0
      || requirement.operator === 'gte' && requirement.value === 0)) {
      reasons.push({ code: 'essential-met', field, requirement, fact: fact ?? null }); continue;
    }
    if (requirement.state !== 'confirmed' || !confirmedFact(fact, config)) {
      unknowns.push({ code: 'essential-unconfirmed', field, requirement, fact: fact ?? null }); continue;
    }
    let met;
    if (requirement.operator === 'gte') met = typeof fact.value === 'number' && fact.value >= requirement.value;
    else if (requirement.operator === 'equals') met = fact.value === requirement.value;
    else {
      const missing = requirement.value.filter((key) => !Object.hasOwn(fact.value ?? {}, key) || typeof fact.value[key] !== 'boolean');
      if (missing.length) { unknowns.push({ code: 'equipment-unconfirmed', field, keys: missing, fact }); continue; }
      met = requirement.value.every((key) => fact.value[key] === true);
    }
    (met ? reasons : blockers).push({ code: met ? 'essential-met' : 'essential-unmet', field, requirement, fact });
  }
  return { blockers, unknowns, reasons };
}

export function scorePreferences(snapshot, brief, employeeFacts, config, slider) {
  const components = []; const unknowns = []; const reasons = []; const tradeOffs = [];
  const weights = config.preferenceWeights;
  if (weights !== undefined && (!weights || typeof weights !== 'object' || Array.isArray(weights)
    || Object.keys(weights).length !== Object.keys(config.preferences).length
    || Object.keys(config.preferences).some((key) => !Object.hasOwn(weights, key) || !Number.isSafeInteger(weights[key]) || weights[key] < 0))) {
    throw TypeError('Invalid recommendation preference weights');
  }
  const car = { name: snapshot.display.name, ...Object.fromEntries(Object.entries(snapshot.facts)
    .filter(([, fact]) => fact.status === 'known').map(([key, fact]) => [key, fact.value])) };
  const options = scoreOptionEvidence(confirmedFact(snapshot.facts.optionSelection, config)
    ? snapshot.facts.optionSelection.value : null, config.optionEvidence, config.preferences);
  for (const [key, preference] of Object.entries(brief.preferences)) {
    if (unselectedPreference(preference)) continue;
    if (preference.importance === slider.minimum) continue;
    if (preference.valueState !== 'confirmed' || preference.importanceState !== 'confirmed') {
      unknowns.push({ code: 'preference-unconfirmed', field: key, preference }); continue;
    }
    const d = config.preferences[key];
    const fields = d.facts.filter((field) => !(key === 'economy' && field === 'mpg' && config.plugInFuels.includes(car.fuel)));
    const modelFactsIncomplete = fields.some((field) => snapshot.facts[field]?.status !== 'known');
    let modelObserved;
    if (modelFactsIncomplete) {
      unknowns.push({ code: 'preference-fact-unknown', field: key, facts: fields });
      if (d.type !== 'slider' || config.optionEvidence === undefined
        || (key !== 'sportiness' && !options?.adjustment[key])) continue;
      modelObserved = config.optionEvidence.unknownModelAnchor;
    } else {
      const answers = { ...d.answers, ...(d.answer ? { [d.answer]: choiceList(preference.value) } : {}) };
      if (confirmedFact(employeeFacts.charging, config)) answers.charging = employeeFacts.charging.value;
      if (key === 'economy' && confirmedFact(employeeFacts.annualMileage, config)) answers.mileage = employeeFacts.annualMileage.value;
      const tuning = { ...config.tuning, retailBudgetEnabled: config.retailBudgetEnabled,
        weights: { body: d.component === 'taste' ? 1 : 0, economy: 0, performance: 0, [d.dimension]: 1 } };
      const [ranked] = rankCars(answers, [car], tuning);
      modelObserved = Math.min(slider.maximum, ranked[d.component] * (d.scaleMultiplier ?? 1));
    }
    let adjustment = options?.adjustment[key] ?? 0;
    if (d.type === 'enum' && options?.enumEvidence[key]?.some((value) => choiceList(preference.value).includes(value))
      && (key !== 'fuel' || config.plugInFuels.includes(car.fuel))) adjustment = config.optionEvidence.sliderStep;
    const observed = Math.max(slider.minimum, Math.min(slider.maximum, modelObserved + adjustment));
    if (!Number.isFinite(observed)) { unknowns.push({ code: 'preference-fact-unknown', field: key, facts: fields }); continue; }
    const score = d.type === 'slider' ? slider.maximum - Math.abs(preference.value - observed) : observed;
    const policyWeight = weights === undefined ? 1 : weights[key];
    const effectiveImportance = preference.importance * policyWeight;
    const evidence = { code: 'preference-fit', field: key, score, importance: preference.importance,
      ...(weights === undefined ? {} : { policyWeight, effectiveImportance }),
      ...(modelFactsIncomplete ? { modelFactsIncomplete: true } : {}),
      ...(options && adjustment ? { modelObserved, optionEvidence: { version: options.version,
        kind: options.kind, adjustment, groups: options.groups.filter((group) => group.evidence[key]) } } : {}),
      desired: preference.value, observed, facts: Object.fromEntries(fields.map((field) => [field, snapshot.facts[field]])) };
    components.push(evidence);
    (score === slider.maximum ? reasons : tradeOffs).push(evidence);
  }
  // This participates exactly like another importance-100 preference, but it is not
  // employee input and never becomes a visible preference, completion tick or trade-off.
  if (options?.complete) components.push({ code: 'specification-fit', field: 'wellSpecified', hidden: true,
    score: options.score, importance: options.importance, totalWeight: options.totalWeight,
    mappingVersion: options.version, selectionKind: options.kind });
  const importance = components.reduce((total, component) => total + (component.effectiveImportance ?? component.importance), 0);
  return { score: importance ? Math.round(components.reduce((total, c) => total + c.score * (c.effectiveImportance ?? c.importance), 0) / importance) : null,
    components, unknowns, reasons, tradeOffs };
}

// Keep preference percentages intact. A band is anchored to its best remaining
// fit, so a chain of near-ties cannot promote a much worse match to the top.
export function rankEmployeeRecommendations(decisions, config) {
  const ranked = decisions.filter((entry) => entry.gateStatus === 'eligible')
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.orderUuid.localeCompare(b.orderUuid));
  const ranking = config.ranking;
  if (ranking === undefined) return ranked; // Retain the ordering of older policy pins.
  if (ranking.rule !== 'similarFitThenPoints' || !Number.isFinite(ranking.fitTolerance)
    || ranking.fitTolerance < 0 || ranking.fitTolerance > 100) throw TypeError('Invalid employee recommendation ranking');
  const ordered = [];
  for (let start = 0; start < ranked.length;) {
    const best = ranked[start].score;
    let end = start + 1;
    while (end < ranked.length && (best === null ? ranked[end].score === null
      : ranked[end].score !== null && best - ranked[end].score <= ranking.fitTolerance)) end += 1;
    ordered.push(...ranked.slice(start, end).sort((a, b) => b.terms.points.value - a.terms.points.value
      || (b.score ?? -1) - (a.score ?? -1) || a.orderUuid.localeCompare(b.orderUuid)));
    start = end;
  }
  return ordered;
}
