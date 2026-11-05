import { rankCars } from '../../engine.js';
import { validInstant } from '../../gcsp/policy/file-provider.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const only = (value, fields) => object(value) && Object.keys(value).every((key) => fields.includes(key));
const states = ['draft', 'inferred', 'confirmed'];
export const confirmedFact = (fact, config) => fact?.status === 'known' && fact.value !== null
  && text(fact.provenance?.sourceRef) && text(fact.provenance?.version) && validInstant(fact.provenance?.observedAt)
  && config.confirmedAssurances.includes(fact.provenance?.assurance);

export function validateBrief(request, config, slider) {
  const errors = [];
  const add = (field) => errors.push({ field, reason: 'Unsupported or invalid brief field.' });
  if (!only(request, ['schemaVersion', 'briefVersion', 'preferences', 'essentials', 'requiredBy'])
    || request.schemaVersion !== 1 || !Number.isSafeInteger(request.briefVersion) || request.briefVersion <= 0) return [{ field: 'brief', reason: 'Supply the supported read-only brief contract.' }];
  if (!object(request.preferences) || !object(request.essentials)) return [{ field: 'brief', reason: 'Supply preferences and essentials maps.' }];
  const within = (v) => Number.isInteger(v) && v >= slider.minimum && v <= slider.maximum;
  for (const [key, p] of Object.entries(request.preferences)) {
    const definition = Object.hasOwn(config.preferences, key) ? config.preferences[key] : null;
    if (!definition || !only(p, ['value', 'importance', 'valueState', 'importanceState', 'source', 'confirmedAt'])
      || !within(p.importance) || !states.includes(p.valueState) || !states.includes(p.importanceState) || !text(p.source)
      || (p.confirmedAt !== undefined && !validInstant(p.confirmedAt))
      || (definition.type === 'slider' ? !within(p.value) : !definition.values.includes(p.value))) add(`preferences.${key}`);
  }
  for (const [key, e] of Object.entries(request.essentials)) {
    const d = Object.hasOwn(config.essentials, key) ? config.essentials[key] : null;
    if (!d || !only(e, ['value', 'operator', 'unit', 'state', 'source', 'confirmedAt'])
      || e.operator !== d.operator || e.unit !== d.unit || ![...states, 'needs-confirmation'].includes(e.state) || !text(e.source)
      || (e.confirmedAt !== undefined && !validInstant(e.confirmedAt))
      || (e.value === null ? e.state !== 'needs-confirmation'
        : (d.type === 'number' && (!Number.isFinite(e.value) || e.value < 0 || key === 'seats' && !Number.isInteger(e.value)))
        || (d.type === 'boolean' && typeof e.value !== 'boolean') || (d.type === 'string' && !text(e.value))
        || (d.type === 'list' && (!Array.isArray(e.value) || !e.value.length || !e.value.every(text))))) add(`essentials.${key}`);
  }
  if (request.requiredBy !== undefined && !validInstant(request.requiredBy)) add('requiredBy');
  return errors;
}

export function evaluateEssentials(snapshot, brief, config) {
  const blockers = []; const unknowns = []; const reasons = [];
  for (const [field, requirement] of Object.entries(brief.essentials)) {
    const fact = snapshot.facts[field];
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
  const car = { name: snapshot.display.name, ...Object.fromEntries(Object.entries(snapshot.facts)
    .filter(([, fact]) => fact.status === 'known').map(([key, fact]) => [key, fact.value])) };
  for (const [key, preference] of Object.entries(brief.preferences)) {
    if (preference.importance === slider.minimum) continue;
    if (preference.valueState !== 'confirmed' || preference.importanceState !== 'confirmed') {
      unknowns.push({ code: 'preference-unconfirmed', field: key, preference }); continue;
    }
    const d = config.preferences[key];
    const fields = d.facts.filter((field) => !(key === 'economy' && field === 'mpg' && config.plugInFuels.includes(car.fuel)));
    if (fields.some((field) => snapshot.facts[field]?.status !== 'known')) {
      unknowns.push({ code: 'preference-fact-unknown', field: key, facts: fields }); continue;
    }
    const answers = { ...d.answers, ...(d.answer ? { [d.answer]: [preference.value] } : {}) };
    if (confirmedFact(employeeFacts.charging, config)) answers.charging = employeeFacts.charging.value;
    if (key === 'economy' && confirmedFact(employeeFacts.annualMileage, config)) answers.mileage = employeeFacts.annualMileage.value;
    const tuning = { ...config.tuning, retailBudgetEnabled: config.retailBudgetEnabled,
      weights: { body: d.component === 'taste' ? 1 : 0, economy: 0, performance: 0, [d.dimension]: 1 } };
    const [ranked] = rankCars(answers, [car], tuning);
    const observed = Math.min(slider.maximum, ranked[d.component] * (d.scaleMultiplier ?? 1));
    if (!Number.isFinite(observed)) { unknowns.push({ code: 'preference-fact-unknown', field: key, facts: fields }); continue; }
    const score = d.type === 'slider' ? slider.maximum - Math.abs(preference.value - observed) : observed;
    const evidence = { code: 'preference-fit', field: key, score, importance: preference.importance,
      desired: preference.value, observed, facts: Object.fromEntries(fields.map((field) => [field, snapshot.facts[field]])) };
    components.push(evidence);
    (score === slider.maximum ? reasons : tradeOffs).push(evidence);
  }
  const importance = components.reduce((total, component) => total + component.importance, 0);
  return { score: importance ? Math.round(components.reduce((total, c) => total + c.score * c.importance, 0) / importance) : null,
    components, unknowns, reasons, tradeOffs };
}
