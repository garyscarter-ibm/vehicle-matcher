import { result } from '../../repository/index.js';

export const DOCUMENT_KEYS = Object.freeze({
  items: 'lifecycle.documents.v1',
  scenario: 'lifecycle.documents.scenario.v1',
  exceptions: 'lifecycle.documents.exceptions.v1',
});
export const OWNERS = Object.freeze(['employee', 'scheme-team', 'retailer']);
const text = (v, max = 256) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const seconds = (v) => Number.isSafeInteger(v) && v >= 0;
const unique = (list) => new Set(list).size === list.length;
export const policyUnavailable = () => result('unavailable', { code: 'document-policy-unavailable',
  reason: 'Document and readiness policy is unavailable. Ask the scheme team to check the demonstration setup.', retryable: true });

function validItem(item) {
  return item && typeof item === 'object' && text(item.itemId, 64) && /^[a-z0-9][a-z0-9-]*$/.test(item.itemId)
    && ['document', 'readiness'].includes(item.kind) && text(item.label, 120) && OWNERS.includes(item.owner)
    && seconds(item.dueSeconds) && text(item.basis, 600) && Array.isArray(item.schemeIds) && item.schemeIds.length > 0
    && item.schemeIds.every((id) => text(id, 128)) && unique(item.schemeIds)
    && (item.owner === 'employee' ? text(item.action, 120) && item.progressSeconds === undefined
      : seconds(item.progressSeconds) && item.progressSeconds <= item.dueSeconds && item.action === undefined);
}

// Every item, delay, opening stage and scenario comes from PolicyService; there are no consumer defaults.
export async function loadDocumentPolicy(policy, read) {
  const rows = await Promise.all(Object.values(DOCUMENT_KEYS).map((key) => policy.getAssumption(key, read)));
  if (rows.some((row) => row.status !== 'ok' || row.policyVersion !== read.policyVersion || !text(row.value?.basis, 2000)
    || !text(row.value?.unit) || !['assumed', 'verified'].includes(row.value.status))) return policyUnavailable();
  const [items, scenario, exceptions] = rows.map((row) => row.value.value);
  if (!items || !text(items.openingStage, 128) || items.openingState !== 'approved' || !Array.isArray(items.items)
    || items.items.length === 0 || !items.items.every(validItem) || !unique(items.items.map((item) => item.itemId))) return policyUnavailable();
  if (!scenario || !Array.isArray(scenario.failItemIds) || !text(scenario.failureReason, 240)
    || !scenario.failItemIds.every((id) => items.items.some((item) => item.itemId === id && item.owner !== 'employee'))) return policyUnavailable();
  if (!exceptions || !text(exceptions.overdue, 128) || !text(exceptions.failed, 128) || exceptions.overdue === exceptions.failed) return policyUnavailable();
  return { status: 'ok', value: { openingStage: items.openingStage, openingState: items.openingState, items: items.items,
    failItemIds: scenario.failItemIds, failureReason: scenario.failureReason, exceptionTypes: exceptions,
    assumptions: rows.map(({ value, policyVersion }) => ({ key: value.key, status: value.status, unit: value.unit,
      basis: value.basis, source: value.source, sourceDate: value.sourceDate, policyVersion })) } };
}

export const applicableItems = (config, schemeId) => config.items.filter((item) => item.schemeIds.includes(schemeId));
