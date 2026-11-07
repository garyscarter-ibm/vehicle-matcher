import { inputDigest } from '../../server/gcsp/repository/core.js';
import { requireValue } from './configuration-key.mjs';

export const BMW_BATCH_SOURCE_VERSION = 'f59-batch-20261107.v1';
export const BMW_CONTEXT_SOURCE_VERSION = 'f59-context-qualification-20261107.v1';
export const BMW_MODEL_OPTIONS_SOURCE_VERSION = 'f59-model-options-qualification-20261107.v1';
export const BMW_OPTIONS_SOURCE_VERSION = 'f59-options-qualification-20261107.v1';
export const BMW_INVENTORY_SOURCE_VERSION = 'f59-range-inventory-20261107.v1';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => inputDigest(a) === inputDigest(b);
const bounded = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const token = (v) => typeof v === 'string' && /^[A-Z0-9]{1,16}$/.test(v);
const code = (v) => typeof v === 'string' && /^[A-Z0-9]{4,12}$/.test(v);
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Trusted plan data pins a context; its later full response still has to corroborate it. */
export function validateBmwModelRegistration(value) {
  const fields = ['schemaVersion', 'modelCode', 'agModelCode', 'catalogueRangeKey', 'rawModelRange', 'aliases',
    'market', 'locale', 'steering', 'catalogueDate', 'orderDate', 'effectDate', 'optionsTrim'];
  requireValue(object(value) && Object.keys(value).every((key) => fields.includes(key))
    && value.schemaVersion === 'bmw-public-model-registration.v1' && code(value.modelCode) && code(value.agModelCode)
    && token(value.catalogueRangeKey) && token(value.rawModelRange) && value.market === 'GB' && value.locale === 'en-GB'
    && value.steering === 'RL' && ['catalogueDate', 'orderDate', 'effectDate'].every((key) => date(value[key]))
    && Array.isArray(value.aliases) && bounded(value.aliases.length, 1, 8) && value.aliases.every(token)
    && new Set(value.aliases).size === value.aliases.length && (value.optionsTrim === undefined || code(value.optionsTrim)),
  'source-model-registration', 'Pin a bounded GB/RL model context, exact full aliases and separate source dates.');
  return structuredClone(value);
}

/** Qualification has no trim default, candidate allowlist or construction capability. */
export function validateBmwContextRequestRegistration(value) {
  requireValue(object(value) && same(Object.keys(value), ['model']) && object(value.model)
    && !Object.hasOwn(value.model, 'optionsTrim'), 'source-context-plan', 'Inspect direct model facts before allocating trim or candidate requests.');
  validateBmwModelRegistration(value.model);
  return structuredClone(value);
}

/** Inventory inputs identify requests only; all returned vehicle facts remain unqualified observations. */
export function validateBmwInventoryRequestRegistration(value) {
  requireValue(object(value) && same(Object.keys(value).sort(), ['catalogueRangeKey', 'locale', 'market', 'pageModelCode',
    'schemaVersion', 'treeEffectDate', 'treeOrderDate'])
    && value.schemaVersion === 'bmw-public-range-inventory-registration.v1'
    && token(value.catalogueRangeKey) && code(value.pageModelCode) && value.market === 'GB' && value.locale === 'en-GB'
    && date(value.treeEffectDate) && date(value.treeOrderDate),
  'source-inventory-plan', 'Pin only the literal GB page seed, one range and explicit tree query dates.');
  return structuredClone(value);
}

export function bmwInventoryRequestUrls(input) {
  const r = validateBmwInventoryRequestRegistration(input);
  return {
    page: `https://configure.bmw.co.uk/en_GB/configure/${r.catalogueRangeKey}/${r.pageModelCode}`,
    discover: `https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/${r.treeEffectDate}/order-dates/${r.treeOrderDate}?${new URLSearchParams({
      'gfs-policy': 'none', cluster: 'default', 'model-ranges': r.catalogueRangeKey, 'future-models': 'true', 'closest-fallback': 'true' })}`,
  };
}

/** Options inspection pins an explicit source trim and grants no candidate/solver capability. */
export function validateBmwOptionsRequestRegistration(value) {
  requireValue(object(value) && same(Object.keys(value), ['model']) && object(value.model)
    && code(value.model.optionsTrim), 'source-options-plan', 'Pin an explicit observed trim before allocating options inspection.');
  try { validateBmwModelRegistration(value.model); }
  catch { requireValue(false, 'source-options-plan', 'Use the complete registered model context and explicit trim.'); }
  return structuredClone(value);
}

/** Model-options inspection binds an observed line and explicit query without borrowing its default model. */
export function validateBmwModelOptionsRequestRegistration(value) {
  const line = value?.line; const query = line?.optionsQuery;
  requireValue(object(value) && same(Object.keys(value).sort(), ['line', 'model']) && object(value.model)
    && !Object.hasOwn(value.model, 'optionsTrim') && object(line)
    && same(Object.keys(line).sort(), ['defaultModel', 'includedIndex', 'lineKey', 'optionsQuery'])
    && typeof line.lineKey === 'string' && /^[A-Z0-9_]{1,64}$/.test(line.lineKey)
    && object(line.defaultModel) && same(Object.keys(line.defaultModel).sort(), ['agModelCode', 'modelCode'])
    && code(line.defaultModel.modelCode) && code(line.defaultModel.agModelCode) && bounded(line.includedIndex, 0, 255)
    && object(query) && (query.kind === 'untrimmed' && same(Object.keys(query), ['kind'])
      || query.kind === 'trim' && same(Object.keys(query).sort(), ['code', 'kind']) && code(query.code) && query.code === line.lineKey),
  'source-options-plan', 'Pin the exact line/default/included variant and an explicit trim or no-trim query.');
  try { validateBmwModelRegistration(value.model); }
  catch { requireValue(false, 'source-options-plan', 'Use the complete registered full model context without a borrowed trim.'); }
  return structuredClone(value);
}

export function bmwModelOptionsRequestUrls(input) {
  const registration = validateBmwModelOptionsRequestRegistration(input);
  const urls = bmwPublicRequestUrls(registration.model);
  // Remove the legacy candidate default before constructing this independently registered route.
  const options = new URL(urls.options); options.search = '';
  if (registration.line.optionsQuery.kind === 'trim') options.searchParams.set('trim', registration.line.optionsQuery.code);
  return { page: urls.page, discover: urls.discover, options: options.href };
}

export function validateBmwCandidateRequest(value) {
  requireValue(object(value) && same(Object.keys(value).sort(), ['includedElements', 'mandatoryElements'])
    && Array.isArray(value.includedElements) && bounded(value.includedElements.length, 3, 24)
    && Array.isArray(value.mandatoryElements) && bounded(value.mandatoryElements.length, 1, 4)
    && [value.includedElements, value.mandatoryElements].every((rows) => rows.every((entry) => code(entry) && !entry.startsWith('SE'))
      && new Set(rows).size === rows.length && same([...rows].sort(), rows))
    && value.mandatoryElements.every((entry) => value.includedElements.includes(entry)),
  'source-candidate-registration', 'Register exact sorted factory request codes and their included mandatory inputs.');
  return structuredClone(value);
}

export function bmwPublicRequestUrls(registration, candidate) {
  const r = validateBmwModelRegistration(registration);
  const base = 'https://prod.ucp.bmw.cloud';
  const dates = `/effect-dates/${r.effectDate}/order-dates/${r.orderDate}`;
  const result = {
    page: `https://configure.bmw.co.uk/en_GB/configure/${r.catalogueRangeKey}/${r.modelCode}`,
    discover: `${base}/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/${r.catalogueDate}/order-dates/${r.orderDate}?${new URLSearchParams({ 'gfs-policy': 'none', cluster: 'default', 'model-ranges': r.catalogueRangeKey, 'future-models': 'true', 'closest-fallback': 'true' })}`,
    options: `${base}/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb${dates}/applications/connext/models/${r.modelCode}/options/languages/en?${new URLSearchParams({ trim: r.optionsTrim || 'S0337' })}`,
  };
  if (candidate) {
    const request = validateBmwCandidateRequest(candidate);
    result.solve = `${base}/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb${dates}/models/${r.modelCode}?${new URLSearchParams({
      'add-rules-for-mandatory-element-classes': 'fabric,paint,rim', application: 'connext',
      'included-elements': request.includedElements.join(','), 'mandatory-elements': request.mandatoryElements.join(',') })}`;
  }
  return result;
}

/** The executor retains this finite allowlist in its checkpoint identity. No caller URL is registered. */
export function bmwBatchRequestRegistration(plan) {
  validateBmwBatchPlan(plan);
  requireValue(Array.isArray(plan.candidates) && plan.candidates.length === plan.candidateCount,
    'source-candidate-registration', 'Persist the finite candidate list in the exact allocated plan before traffic.');
  return { model: structuredClone(plan.modelRegistration), candidates: plan.candidates.map((row) => structuredClone(row.request)) };
}

export function validateBmwBatchRequestRegistration(value) {
  requireValue(object(value) && same(Object.keys(value).sort(), ['candidates', 'model'])
    && Array.isArray(value.candidates) && bounded(value.candidates.length, 1, 200),
  'source-candidate-registration', 'Use the finite registered model/request list.');
  validateBmwModelRegistration(value.model); value.candidates.forEach(validateBmwCandidateRequest);
  requireValue(new Set(value.candidates.map(inputDigest)).size === value.candidates.length,
    'source-candidate-registration', 'Registered requests must be distinct.');
  return structuredClone(value);
}

export function validateBmwBatchPlan(plan) {
  const r = validateBmwModelRegistration(plan?.modelRegistration); const l = plan?.limits;
  requireValue(plan.source?.id === 'bmw-uk-public' && plan.source?.version === BMW_BATCH_SOURCE_VERSION
    && plan.source.kind === 'public-bmw-uk' && same(plan.models, [r.modelCode])
    && same(plan.context, { catalogueDate: r.catalogueDate, market: r.market, locale: r.locale, orderDate: r.orderDate, effectDate: r.effectDate })
    && plan.captureVersion === 'bmw-complete-selection.v1' && date(plan.qualificationDate)
    && (plan.candidateBaseElements === undefined || Array.isArray(plan.candidateBaseElements) && plan.candidateBaseElements.length <= 16
      && plan.candidateBaseElements.every((value) => code(value) && !value.startsWith('SE')))
    && bounded(plan.candidateCount, 1, 200) && bounded(plan.target, 1, plan.candidateCount)
    && object(l) && l.maxAttempts === 1 && l.retryDelayMs === 0 && l.concurrency === 1 && l.imageRequests === 0
    && bounded(l.sourceAttempts, 1, plan.candidateCount + 4) && bounded(l.sourceBytes, 1, 16777216)
    && bounded(l.responseBytes, 1, 1048576) && bounded(l.operationTimeoutMs, 1, 10000)
    && bounded(l.deadlineMs, 1, 300000) && bounded(l.checkpointBytes, 1024, 16777216)
    && bounded(l.cacheEntries, 1, 256) && bounded(l.cacheRetentionMs, 1, 86400000)
    && object(l.requestBudgets) && ['page', 'settings', 'discover', 'options'].every((key) => l.requestBudgets[key] === 1)
    && l.requestBudgets.solve === plan.candidateCount,
  'public-source-plan-refused', 'Use a finite explicit batch allocation with a pinned full model context and source budgets.');
  if (plan.candidates !== undefined) {
    requireValue(Array.isArray(plan.candidates) && plan.candidates.length === plan.candidateCount
      && plan.candidates.every((row) => object(row) && same(Object.keys(row).sort(), ['candidateId', 'request'])
        && typeof row.candidateId === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(row.candidateId))
      && new Set(plan.candidates.map((row) => row.candidateId)).size === plan.candidates.length,
    'source-candidate-registration', 'Every planned candidate needs its exact unique identity and request.');
    plan.candidates.forEach((row) => validateBmwCandidateRequest(row.request));
    requireValue(new Set(plan.candidates.map((row) => inputDigest(row.request))).size === plan.candidates.length,
      'source-candidate-registration', 'Allocate distinct candidate requests.');
  }
  return structuredClone(plan);
}
