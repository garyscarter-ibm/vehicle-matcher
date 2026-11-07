import { inputDigest, ok, result } from '../repository/core.js';

export const FOLLOWUP_QUESTIONS_KEY = 'offer.followupQuestions.v1';

const POLICY_KEYS = [FOLLOWUP_QUESTIONS_KEY, 'employee.recommendation.v1', 'brief.slider.minimum',
  'brief.slider.maximum', 'offer.declineReasons.v1'];
const MAX_PROMPT_LENGTH = 240;
const MAX_OPTION_LABEL_LENGTH = 120;
const MAX_EQUIPMENT_ITEMS = 100;
const MAX_EQUIPMENT_ITEM_LENGTH = 256;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const only = (value, keys) => plain(value) && Reflect.ownKeys(value).every((key) => keys.includes(key));
const unavailable = (code = 'followup-policy-unavailable') => result('unavailable', {
  code, reason: code === 'followup-target-unavailable'
    ? 'The current brief target is unavailable.' : 'The follow-up policy is unavailable.', retryable: true,
});
const invalid = (code, field, reason) => result('invalid', { code, reasons: [{ field, reason }] });

function keyPath(path) {
  const preference = /^preferences\.([A-Za-z0-9_-]+)\.value$/.exec(path ?? '');
  if (preference) return { kind: 'preference', key: preference[1] };
  const essential = /^essentials\.([A-Za-z0-9_-]+)$/.exec(path ?? '');
  if (essential) return { kind: 'essential', key: essential[1] };
  return null;
}

function safeKey(key) {
  return !['__proto__', 'prototype', 'constructor'].includes(key);
}

function attributeMatchesPreference(attribute, key, definition) {
  if (attribute === key || key === 'size' && attribute === 'sizeClass') return true;
  const fields = [definition.fact, definition.factKey, definition.attribute, definition.field,
    ...(Array.isArray(definition.facts) ? definition.facts : []),
    ...(Array.isArray(definition.factKeys) ? definition.factKeys : []),
    ...(Array.isArray(definition.attributes) ? definition.attributes : []),
    ...(Array.isArray(definition.fields) ? definition.fields : [])];
  return fields.includes(attribute);
}

function reasonRows(value) {
  if (!only(value, ['schemaVersion', 'reasons']) || value.schemaVersion !== 1 || !Array.isArray(value.reasons)
    || value.reasons.length === 0) return null;
  const rows = new Map();
  for (const row of value.reasons) {
    if (!only(row, ['code', 'label', 'attribute']) || !text(row.code) || row.code.length > 80
      || !text(row.label) || row.label.length > MAX_OPTION_LABEL_LENGTH
      || !text(row.attribute) || row.attribute.length > 120 || rows.has(row.code)) return null;
    rows.set(row.code, row);
  }
  return rows;
}

function questionRows(value, config, minimum, maximum, reasons) {
  if (!only(value, ['schemaVersion', 'questions']) || value.schemaVersion !== 1 || !Array.isArray(value.questions)
    || value.questions.length !== reasons.size || !plain(config?.preferences) || !plain(config?.essentials)
    || minimum !== 0 || maximum !== 100) return null;
  const questions = new Map(); const paths = new Set();
  for (const question of value.questions) {
    if (!only(question, ['reasonCode', 'path', 'prompt', 'control']) || !text(question.reasonCode)
      || !text(question.path) || !text(question.prompt) || question.prompt.trim().length > MAX_PROMPT_LENGTH
      || questions.has(question.reasonCode) || paths.has(question.path)) return null;
    const reason = reasons.get(question.reasonCode);
    const path = keyPath(question.path);
    if (!reason || !path || !safeKey(path.key)) return null;
    if (path.kind === 'preference') {
      const definition = config.preferences[path.key];
      if (!plain(definition) || !attributeMatchesPreference(reason.attribute, path.key, definition)) return null;
      if (!plain(question.control)) return null;
      if (question.control.kind === 'options') {
        if (!only(question.control, ['kind', 'options']) || !Array.isArray(question.control.options)
          || question.control.options.length === 0 || !Array.isArray(definition.values)
          || definition.type === 'slider') return null;
        const values = new Set(); const labels = new Set();
        for (const option of question.control.options) {
          if (!only(option, ['value', 'label']) || !text(option.value) || !text(option.label)
            || option.label.trim().length > MAX_OPTION_LABEL_LENGTH || !definition.values.includes(option.value)
            || values.has(option.value) || labels.has(option.label)) return null;
          values.add(option.value); labels.add(option.label);
        }
      } else if (question.control.kind === 'slider') {
        if (!only(question.control, ['kind', 'unit']) || definition.type !== 'slider'
          || question.control.unit !== 'percent') return null;
      } else return null;
    } else {
      const definition = config.essentials[path.key];
      if (path.key !== reason.attribute || !plain(definition) || definition.type !== 'list'
        || definition.operator !== 'includes' || definition.unit !== 'equipment-key'
        || !only(question.control, ['kind', 'maximumItems', 'maximumItemLength'])
        || question.control.kind !== 'equipment' || !Number.isSafeInteger(question.control.maximumItems)
        || question.control.maximumItems <= 0 || question.control.maximumItems > MAX_EQUIPMENT_ITEMS
        || !Number.isSafeInteger(question.control.maximumItemLength) || question.control.maximumItemLength <= 0
        || question.control.maximumItemLength > MAX_EQUIPMENT_ITEM_LENGTH) return null;
    }
    questions.set(question.reasonCode, question);
    paths.add(question.path);
  }
  if ([...reasons.keys()].some((code) => !questions.has(code))) return null;
  return questions;
}

function targetValue(question, brief, config, minimum, maximum) {
  const path = keyPath(question.path);
  if (!path || !safeKey(path.key)) return undefined;
  if (path.kind === 'preference') {
    const definition = config.preferences[path.key]; const target = brief.preferences[path.key];
    if (!plain(target) || !plain(definition) || target.valueState !== 'confirmed'
      || target.importanceState !== 'confirmed' || !text(target.source)
      || !Number.isSafeInteger(target.importance) || target.importance < minimum || target.importance > maximum) return undefined;
    if (question.control.kind === 'options') {
      if (!question.control.options.some(({ value }) => value === target.value)) return undefined;
    } else if (!Number.isSafeInteger(target.value) || target.value < minimum || target.value > maximum) return undefined;
    return target.value;
  }
  const definition = config.essentials[path.key]; const target = brief.essentials[path.key];
  if (question.control.kind !== 'equipment' || !plain(definition) || !plain(target)
    || definition.operator !== 'includes' || definition.unit !== 'equipment-key'
    || target.operator !== definition.operator || target.unit !== definition.unit || target.state !== 'confirmed'
    || !text(target.source) || !Array.isArray(target.value)
    || target.value.length > question.control.maximumItems
    || !target.value.every((item) => text(item) && item === item.trim()
      && item.length <= question.control.maximumItemLength)
    || new Set(target.value).size !== target.value.length) return undefined;
  return target.value;
}

function validAssumption(response, key, policyVersion) {
  const row = response?.value;
  return response?.status === 'ok' && response.policyVersion === policyVersion && plain(row)
    && row.key === key && Object.hasOwn(row, 'value') && text(row.status) && text(row.basis)
    && text(row.source) && text(row.sourceDate);
}

async function readAssumptions(policy, read) {
  if (!policy || typeof policy.getAssumption !== 'function' || !plain(read)
    || !text(read.runId) || !text(read.asOf) || !text(read.policyVersion)) return null;
  try {
    const responses = await Promise.all(POLICY_KEYS.map((key) => policy.getAssumption(key, read)));
    if (responses.some((response, index) => !validAssumption(response, POLICY_KEYS[index], read.policyVersion))) return null;
    return Object.fromEntries(POLICY_KEYS.map((key, index) => [key, responses[index].value]));
  } catch {
    return null;
  }
}

function sameEquipment(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort(); const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function questionDefinition(question) {
  const control = structuredClone(question.control);
  if (control.kind === 'slider') {
    delete control.minimum;
    delete control.maximum;
  }
  return { reasonCode: question.reasonCode, path: question.path, prompt: question.prompt, control };
}

export async function readFollowupQuestion({ policy, read, reasonCode, brief } = {}) {
  const assumptions = await readAssumptions(policy, read);
  if (!assumptions) return unavailable();
  const reasons = reasonRows(assumptions['offer.declineReasons.v1'].value);
  const config = assumptions['employee.recommendation.v1'].value;
  const questions = reasons && questionRows(assumptions[FOLLOWUP_QUESTIONS_KEY].value, config,
    assumptions['brief.slider.minimum'].value, assumptions['brief.slider.maximum'].value, reasons);
  if (!questions) return unavailable();
  if (!text(reasonCode) || !reasons.has(reasonCode)) return invalid('invalid-followup-reason', 'reasonCode', 'Use a registered decline reason.');
  if (!plain(brief) || brief.schemaVersion !== 1 || !Number.isSafeInteger(brief.briefVersion) || brief.briefVersion <= 0
    || !plain(brief.preferences) || !plain(brief.essentials)) {
    return invalid('invalid-followup-brief', 'brief', 'Supply the current versioned employee brief.');
  }
  const definition = questions.get(reasonCode);
  const currentValue = targetValue(definition, brief, config, assumptions['brief.slider.minimum'].value,
    assumptions['brief.slider.maximum'].value);
  if (currentValue === undefined) return unavailable('followup-target-unavailable');
  const control = structuredClone(definition.control);
  if (control.kind === 'slider') {
    control.minimum = assumptions['brief.slider.minimum'].value;
    control.maximum = assumptions['brief.slider.maximum'].value;
  }
  const policyVersion = read.policyVersion;
  let questionVersion;
  try {
    questionVersion = inputDigest({ policyVersion, definition, briefVersion: brief.briefVersion, currentValue });
  } catch {
    return unavailable();
  }
  const provenanceRow = assumptions[FOLLOWUP_QUESTIONS_KEY];
  return ok({ schemaVersion: 1, reasonCode, path: definition.path, prompt: definition.prompt, control,
    currentValue: structuredClone(currentValue), policyVersion, questionVersion,
    provenance: { key: provenanceRow.key, status: provenanceRow.status, basis: provenanceRow.basis,
      source: provenanceRow.source, sourceDate: provenanceRow.sourceDate } });
}

export function followupChange(question, value, brief) {
  if (!only(question, ['schemaVersion', 'reasonCode', 'path', 'prompt', 'control', 'currentValue',
    'policyVersion', 'questionVersion', 'provenance']) || question.schemaVersion !== 1
    || !text(question.reasonCode) || !text(question.prompt) || question.prompt.trim().length > MAX_PROMPT_LENGTH
    || !text(question.policyVersion) || !text(question.questionVersion)
    || !only(question.provenance, ['key', 'status', 'basis', 'source', 'sourceDate'])
    || question.provenance.key !== FOLLOWUP_QUESTIONS_KEY || !text(question.provenance.status)
    || !text(question.provenance.basis) || !text(question.provenance.source) || !text(question.provenance.sourceDate)) {
    return invalid('invalid-followup-change', 'question', 'Use the current policy question.');
  }
  const path = keyPath(question.path);
  if (!path || !safeKey(path.key) || !plain(brief) || brief.schemaVersion !== 1
    || !Number.isSafeInteger(brief.briefVersion) || brief.briefVersion <= 0
    || !plain(brief.preferences) || !plain(brief.essentials)) {
    return invalid('invalid-followup-change', 'path', 'Use a current registered brief target.');
  }
  let expectedVersion;
  try {
    expectedVersion = inputDigest({ policyVersion: question.policyVersion, definition: questionDefinition(question),
      briefVersion: brief.briefVersion, currentValue: question.currentValue });
  } catch {
    return invalid('invalid-followup-change', 'questionVersion', 'Use the current policy question.');
  }
  if (question.questionVersion !== expectedVersion) return invalid('invalid-followup-change', 'questionVersion', 'Use the current policy question.');
  const current = path.kind === 'preference' ? brief.preferences[path.key] : brief.essentials[path.key];
  if (!plain(current)) return invalid('invalid-followup-change', 'brief', 'The question target is no longer available.');
  const currentValue = path.kind === 'preference' ? current.value : current.value;
  const isEquipment = question.control?.kind === 'equipment';
  if (isEquipment
    ? current.state !== 'confirmed' || current.operator !== 'includes' || current.unit !== 'equipment-key'
      || !sameEquipment(currentValue, question.currentValue)
    : path.kind === 'preference' ? current.valueState !== 'confirmed' || current.importanceState !== 'confirmed'
      || !Object.hasOwn(current, 'value') || current.value !== question.currentValue
      : current.state !== 'confirmed' || !Object.hasOwn(current, 'value') || current.value !== question.currentValue) {
    return invalid('invalid-followup-change', 'brief', 'The question target changed or is no longer confirmed.');
  }
  if (question.control?.kind === 'options') {
    if (path.kind !== 'preference' || !only(question.control, ['kind', 'options'])
      || !Array.isArray(question.control.options) || question.control.options.length === 0
      || !question.control.options.every((option) => only(option, ['value', 'label']) && text(option.value) && text(option.label))
      || typeof value !== 'string' || !question.control.options.some((option) => option.value === value)) {
      return invalid('invalid-followup-change', 'value', 'Choose one of the registered options.');
    }
    if (value === question.currentValue) return invalid('invalid-followup-change', 'value', 'Choose a different value.');
    return ok({ path: question.path, value });
  }
  if (question.control?.kind === 'slider') {
    if (path.kind !== 'preference' || !only(question.control, ['kind', 'unit', 'minimum', 'maximum'])
      || question.control.unit !== 'percent' || question.control.minimum !== 0 || question.control.maximum !== 100
      || !Number.isSafeInteger(value) || value < question.control.minimum || value > question.control.maximum) {
      return invalid('invalid-followup-change', 'value', 'Use a whole-number value within the registered slider range.');
    }
    if (value === question.currentValue) return invalid('invalid-followup-change', 'value', 'Choose a different value.');
    return ok({ path: question.path, value });
  }
  if (question.control?.kind === 'equipment') {
    if (path.kind !== 'essential' || !only(question.control, ['kind', 'maximumItems', 'maximumItemLength'])
      || !Number.isSafeInteger(question.control.maximumItems) || question.control.maximumItems <= 0
      || question.control.maximumItems > MAX_EQUIPMENT_ITEMS || !Number.isSafeInteger(question.control.maximumItemLength)
      || question.control.maximumItemLength <= 0 || question.control.maximumItemLength > MAX_EQUIPMENT_ITEM_LENGTH
      || !Array.isArray(value) || value.length > question.control.maximumItems
      || !value.every((item) => text(item) && item === item.trim() && item.length <= question.control.maximumItemLength)
      || new Set(value).size !== value.length) {
      return invalid('invalid-followup-change', 'value', 'Use unique equipment values within the registered limits.');
    }
    if (sameEquipment(value, question.currentValue)) return invalid('invalid-followup-change', 'value', 'Choose a different equipment set.');
    return ok({ path: question.path, value: { operator: current.operator, unit: current.unit, state: 'confirmed',
      source: 'employee', value: structuredClone(value) } });
  }
  return invalid('invalid-followup-change', 'control', 'Use a supported follow-up control.');
}
