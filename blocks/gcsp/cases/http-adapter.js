// Transport shape checks only. The server owns feasibility and status transitions.
import { isAccessLapsed } from '../kit/run-restarted.js';

export const isCaseRecord = (value) => value && typeof value.caseId === 'string' && value.caseId.length > 0
  && Number.isSafeInteger(value.version) && value.version > 0 && typeof value.status === 'string';
export function isCaseOptionsProjection(value) {
  if (!isCaseRecord(value?.case) || !Array.isArray(value.nextStatuses) || !value.nextStatuses.every((status) => typeof status === 'string')) return false;
  const options = value.options;
  if (!options || typeof options !== 'object') return false;
  const validItems = (key, type, validate) => {
    const group = options[key];
    return typeof group?.available === 'boolean' && (!group.available || Array.isArray(group.items) && group.items.length > 0
      && group.items.every((item) => item?.type === type && validate(item)));
  };
  const pending = options.alternativeCars?.needsConfirmation;
  return validItems('alternativeCars', 'alternative-car', (item) => typeof item.orderUuid === 'string')
    && (pending === undefined || Array.isArray(pending) && pending.every((item) => item?.type === 'alternative-car'
      && typeof item.orderUuid === 'string' && Array.isArray(item.unknowns)))
    && validItems('preferenceRelaxations', 'preference-relaxation', (item) => typeof item.decisionId === 'string'
      && Number.isSafeInteger(item.expectedBriefVersion) && typeof item.path === 'string' && (item.valueType === 'enum'
        ? Array.isArray(item.values) && item.values.length > 0 : item.valueType === 'slider' && Number.isFinite(item.minimum) && Number.isFinite(item.maximum)))
    && validItems('laterRelease', 'later-release', (item) => typeof item.releaseAt === 'string' && typeof item.source === 'string')
    && typeof options.manualDecision?.available === 'boolean' && (!options.manualDecision.available || options.manualDecision.type === 'manual-decision')
    && typeof options.contractExtension?.available === 'boolean' && (!options.contractExtension.available
      || options.contractExtension.type === 'contract-extension' && typeof options.contractExtension.contractEndDate === 'string');
}

const failure = (code) => ({ status: 'unavailable', code, reason: 'Renewal help could not be reached. Try again.', retryable: true });

export function createCaseHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function request(path, options = {}, input) {
    let response;
    try {
      response = await fetchImpl(`${base}/api/gcsp/${path}`, { method: input ? 'POST' : 'GET', credentials: 'include',
        signal: options.signal, headers: { Accept: 'application/json', ...(input ? { 'Content-Type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return failure('case-transport-unavailable');
    }
    let envelope; let parsed = true;
    try { envelope = await response.json(); } catch { parsed = false; }
    if (isAccessLapsed(response.status, envelope)) return { status: 'access-required' };
    if (!parsed) return failure('case-response-invalid');
    if (!envelope || typeof envelope.status !== 'string' || envelope.status === 'ok' && (!response.ok || !envelope.value
      || path === 'help' && envelope.value.opensCase !== false
      || path === 'cases' && (input ? !envelope.value.case?.caseId : !Array.isArray(envelope.value.cases))
      || path === 'scheme-team/cases' && (!Array.isArray(envelope.value.cases) || !envelope.value.cases.every(isCaseRecord))
      || path.startsWith('scheme-team/cases/options?') && !isCaseOptionsProjection(envelope.value)
      || path === 'scheme-team/cases/update' && !isCaseRecord(envelope.value.case)
      || path === 'brief/change-after-decline' && !Number.isSafeInteger(envelope.value.brief?.briefVersion))) return failure('case-response-invalid');
    return envelope;
  }
  return {
    listCases: (options) => request('scheme-team/cases', options),
    readOptions: ({ caseId }, options) => request(`scheme-team/cases/options?${new URLSearchParams({ caseId })}`, options),
    updateCase: ({ commandId, caseId, expectedVersion, status, reason, nextAction, dueAt, remedy }, options) => request('scheme-team/cases/update', options,
      { commandId, caseId, expectedVersion, status, reason, nextAction, dueAt, ...(remedy !== undefined ? { remedy } : {}) }),
    readHelp: (options) => request('help', options),
    readCases: (options) => request('cases', options),
    requestHelp: ({ commandId, reason }, options) => request('cases', options, { commandId, reason }),
    changeAfterDecline: ({ commandId, decisionId, expectedBriefVersion, change }, options) => request('brief/change-after-decline', options,
      { commandId, decisionId, expectedBriefVersion, change: { path: change.path, value: change.value } }),
  };
}
