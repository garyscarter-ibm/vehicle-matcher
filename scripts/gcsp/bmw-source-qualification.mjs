import { createHash } from 'node:crypto';
import { requireValue } from './configuration-key.mjs';

const CONTEXT = new Set(['market', 'locale', 'modelCode', 'agModelCode', 'catalogueRangeKey', 'rawModelRange', 'orderDate', 'effectDate', 'trim']);
const DATES = new Set(['catalogueDate', 'orderDate', 'effectDate', 'taxDate', 'productionDate']);
const CODES = new Set(['modelCode', 'agModelCode', 'catalogueRangeKey', 'rawModelRange', 'trim', 'bodyStyle',
  'engineSeries', 'fuelTypeCode', 'hybridCode', 'driveType', 'transmission', 'steeringLiteral']);
const LABELS = new Set(['modelName', 'derivative']);
const PHYSICAL = new Set(['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted']);
const FIELDS = new Set([...DATES, ...CODES, ...LABELS, ...PHYSICAL, 'paint', 'upholstery', 'accessoryQuantity']);
const SOURCE_KEYS = { productionDate: ['prodDate', 'productionDate'], modelCode: ['modelCode', 'vgModelCode'],
  rawModelRange: ['rawModelRange', 'modelRangeField'], modelName: ['modelName', 'modelNameRaw'], steeringLiteral: ['steering', 'steeringLiteral'] };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const code = (value) => typeof value === 'string' && /^[A-Z0-9]{2,16}$/.test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const fail = (condition) => requireValue(condition, 'invalid-qualification-input', 'Supply bounded pinned JSON artifacts, exact context and supported field locators.');

function segments(pointer) {
  if (typeof pointer !== 'string' || pointer.length > 2048 || (pointer !== '' && !pointer.startsWith('/')) || /~(?![01])/u.test(pointer)) return null;
  return pointer === '' ? [] : pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** RFC 6901 traversal never follows an inherited property or a nearby/descendant field. */
function locate(value, pointer) {
  const path = segments(pointer);
  if (!path) return { found: false };
  for (const part of path) {
    if (!object(value) && !Array.isArray(value)) return { found: false };
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(part)) return { found: false };
    if (!Object.hasOwn(value, part)) return { found: false };
    value = value[part];
  }
  return { found: true, value };
}

function within(pointer, root) {
  const path = segments(pointer); const parent = segments(root);
  return path && parent && path.length >= parent.length && parent.every((part, index) => path[index] === part);
}

function channel(artifact, pointer) {
  if (artifact.requestRoots.some((root) => within(pointer, root))) return 'request-input-only';
  return artifact.responseRoots.some((root) => within(pointer, root)) ? null : 'unsupported-source-role';
}

function codeSet(values, accessory = false) {
  if (!Array.isArray(values) || values.length > 256 || !values.every((value) => code(value) && value.startsWith('SE') === accessory)
    || new Set(values).size !== values.length) return null;
  return [...values].sort();
}

function sameSet(a, b) { return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b); }

// JSON.parse has already checked the grammar. Inspect keys before accepting its last-value result.
function duplicateKeys(text) {
  const stack = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],]/gu)) {
    const value = token[0]; const top = stack.at(-1);
    if (value === '{') stack.push({ keys: new Set(), expectingKey: true });
    else if (value === '[') stack.push({});
    else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && top?.keys) top.expectingKey = true;
    else if (value.startsWith('"') && top?.keys && top.expectingKey) {
      const key = JSON.parse(value);
      if (top.keys.has(key)) return true;
      top.keys.add(key); top.expectingKey = false;
    }
  }
  return false;
}

function selectionMatches(artifact, target, selected) {
  const binding = artifact.selection;
  if (!object(binding) || channel(artifact, binding.factoryOptionCodesPointer) || channel(artifact, binding.accessoriesPointer)) return false;
  const options = locate(artifact.json, binding.factoryOptionCodesPointer);
  const accessories = locate(artifact.json, binding.accessoriesPointer);
  return options.found && accessories.found && Array.isArray(accessories.value)
    && accessories.value.length <= 64 && accessories.value.every(object) && accessories.value.includes(selected)
    && sameSet(codeSet(options.value), codeSet(target.factoryOptionCodes))
    && sameSet(codeSet(accessories.value.map((entry) => entry.code), true), codeSet(target.accessoryCodes, true));
}

function valueFor(field, value, claim, artifact, target) {
  if (DATES.has(field)) {
    if (field === 'productionDate' && typeof value === 'string' && /^\d{8}$/.test(value)) value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
    if (field === 'catalogueDate' && date(value) && value !== target.observedDate) return { reason: 'catalogue-date-mismatch' };
    return date(value) ? { value } : { reason: 'invalid-value' };
  }
  if (CODES.has(field)) return code(value) ? { value } : { reason: 'invalid-value' };
  if (LABELS.has(field)) return typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f<>]/u.test(value)
    ? { value: value.trim() } : { reason: 'invalid-value' };
  if (field === 'paint' || field === 'upholstery') {
    const path = segments(claim.pointer);
    return code(claim.code) && path.at(-1) === claim.code && object(value) && value.option === claim.code
      && value.optionType === (field === 'paint' ? 'paint' : 'fabric')
      ? { value: { code: claim.code, type: field } } : { reason: 'invalid-value' };
  }
  if (!object(value) || !code(claim.code) || !claim.code.startsWith('SE') || value.code !== claim.code || value.type !== 'accessory'
    || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > 999) return { reason: 'invalid-value' };
  return selectionMatches(artifact, target, value) ? { value: { code: claim.code, quantity: value.quantity } } : { reason: 'selection-mismatch' };
}

/**
 * Pure evidence inspection: the caller supplies retained bytes and a reviewed locator manifest.
 * Hashes bind those bytes, not their real-world truth. Response/request roots and context bindings
 * are explicit source-contract assertions; no canonical ID, filename or date default is evidence.
 * This result cannot admit collector records, register F39 snapshots or qualify physical VIN facts.
 */
export function qualifyBmwSourceFields({ target, artifacts, claims, requiredFields } = {}) {
  fail(object(target) && date(target.observedDate) && object(target.context)
    && ['modelCode', 'agModelCode', 'orderDate', 'effectDate'].every((key) => Object.hasOwn(target.context, key))
    && Object.keys(target.context).length <= CONTEXT.size && Object.entries(target.context).every(([key, value]) => CONTEXT.has(key)
      && (key === 'locale' ? typeof value === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(value)
        : key === 'market' ? typeof value === 'string' && /^[A-Z]{2}$/.test(value)
          : DATES.has(key) ? date(value) : code(value))));
  fail(Array.isArray(artifacts) && artifacts.length <= 32 && Array.isArray(claims) && claims.length <= 128
    && Array.isArray(requiredFields) && requiredFields.length > 0 && requiredFields.length <= FIELDS.size
    && new Set(requiredFields).size === requiredFields.length && requiredFields.every((field) => FIELDS.has(field)));
  const loaded = new Map(); let total = 0;
  for (const artifact of artifacts) {
    fail(object(artifact) && typeof artifact.id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(artifact.id)
      && !loaded.has(artifact.id) && (typeof artifact.bytes === 'string' || artifact.bytes instanceof Uint8Array)
      && typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256)
      && segments(artifact.observedDatePointer) && object(artifact.context) && Object.keys(artifact.context).length <= CONTEXT.size
      && Object.entries(artifact.context).every(([key, pointer]) => CONTEXT.has(key) && segments(pointer))
      && [artifact.responseRoots, artifact.requestRoots].every((roots) => Array.isArray(roots) && roots.length <= 32 && roots.every((pointer) => segments(pointer)))
      && [undefined, 'iso-date', 'iso-timestamp'].includes(artifact.observedDateFormat));
    const byteLength = typeof artifact.bytes === 'string' ? Buffer.byteLength(artifact.bytes) : artifact.bytes.byteLength;
    total += byteLength;
    fail(byteLength <= 1024 * 1024 && total <= 2 * 1024 * 1024);
    const bytes = Buffer.from(artifact.bytes);
    const entry = { ...artifact, bytes: undefined };
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) entry.reason = 'hash-mismatch';
    else {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        entry.json = JSON.parse(text);
        if (duplicateKeys(text)) entry.reason = 'duplicate-json-key';
      }
      catch { entry.reason = 'invalid-json'; }
    }
    if (!entry.reason) {
      const observed = locate(entry.json, artifact.observedDatePointer);
      let observedDate = observed.value;
      if (artifact.observedDateFormat === 'iso-timestamp') observedDate = typeof observedDate === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedDate)
        && Number.isFinite(Date.parse(observedDate)) && new Date(observedDate).toISOString() === observedDate ? observedDate.slice(0, 10) : null;
      if (!observed.found || !date(observedDate)) entry.reason = 'missing-observation-date';
      else if (observedDate !== target.observedDate) entry.reason = 'observation-date-mismatch';
      else entry.observedDate = observedDate;
      if (!entry.reason && !Object.entries(target.context).every(([key, expected]) => {
        const actual = locate(entry.json, artifact.context[key]);
        return actual.found && actual.value === expected;
      })) entry.reason = 'context-mismatch';
    }
    loaded.set(artifact.id, entry);
  }
  const byField = new Map(requiredFields.map((field) => [field, { evidence: [], reasons: [] }]));
  for (const claim of claims) {
    fail(object(claim) && FIELDS.has(claim.field) && byField.has(claim.field) && typeof claim.artifactId === 'string' && segments(claim.pointer));
    const field = byField.get(claim.field); const artifact = loaded.get(claim.artifactId);
    let reason = artifact?.reason || (!artifact ? 'missing-artifact' : channel(artifact, claim.pointer));
    if (PHYSICAL.has(claim.field)) continue;
    if (!reason) {
      const actual = locate(artifact.json, claim.pointer);
      if (!actual.found) reason = 'missing-locator';
      else if (!['paint', 'upholstery', 'accessoryQuantity'].includes(claim.field)
        && !(SOURCE_KEYS[claim.field] || [claim.field]).includes(segments(claim.pointer).at(-1))) reason = 'unsupported-field-locator';
      else {
        const result = valueFor(claim.field, actual.value, claim, artifact, target);
        reason = result.reason;
        if (!reason) field.evidence.push({ artifactId: artifact.id, sha256: artifact.sha256, pointer: claim.pointer,
          observedDate: artifact.observedDate, context: structuredClone(target.context), confidence: 'direct-response', value: result.value });
      }
    }
    if (reason) field.reasons.push(reason);
  }
  const fields = {};
  for (const [name, field] of byField) {
    const values = new Map(field.evidence.map((entry) => [JSON.stringify(entry.value), entry.value]));
    const status = values.size > 1 ? 'conflict' : values.size === 1 ? 'qualified' : 'missing';
    const reasons = PHYSICAL.has(name) ? ['physical-evidence-not-supported'] : [...new Set(field.reasons)];
    fields[name] = { status, value: status === 'qualified' ? structuredClone([...values.values()][0]) : null,
      evidence: field.evidence, reasons: reasons.length ? reasons : status === 'missing' ? ['absent-evidence'] : [] };
  }
  const states = Object.values(fields).map((field) => field.status);
  return { schemaVersion: 'bmw-field-evidence.v1', status: states.includes('conflict') ? 'conflict' : states.every((state) => state === 'qualified') ? 'qualified' : 'incomplete',
    qualification: 'field-evidence-only', admission: false, observedDate: target.observedDate, fields };
}
