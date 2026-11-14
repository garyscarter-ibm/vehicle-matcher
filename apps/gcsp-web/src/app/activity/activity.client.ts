import { inject, Injectable } from '@angular/core';
import { ApplicationContext, AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import { ActivityCheck, ActivityCommandInput, ActivityCommandReceipt, ActivityControlVersions, ActivityDisplayImage,
  ActivityExclusion, ActivityFailure, ActivityFailureStatus, ActivityOffer, ActivityOfferDisplay, ActivityOfferState,
  ActivityOperation, ActivityPermission, ActivityProjection, ActivityRequestOptions, ActivityResult, ActivityStateChange } from './activity.types';

type RecordValue = Record<string, unknown>;
interface Scope {
  readonly subject: string;
  readonly environmentId: string;
  readonly runId: string;
  readonly employeeId: string;
}
type ScopeResult = Scope | ActivityFailure;
type Method = 'GET' | 'POST';

const knownActivityStates = new Set(['no-brief', 'paused', 'offer', 'offer-closed', 'searching', 'never-searched']);
const sourceStatuses = new Set(['not-checked', 'evidence-unavailable', 'unavailable', 'delayed', 'ok']);
const offerStates = new Set<ActivityOfferState>(['active', 'decision-pending', 'release-pending', 'accepted', 'rejected', 'declined', 'expired']);
const operations = new Set(['confirmed', 'paused', 'resumed', 'changed-after-decline', 'engaged', 'disengaged', 'preferences-updated']);
const activityOperations = new Set<ActivityOperation>(['engage', 'disengage', 'pause-search', 'resume-search']);
const responseFailureStatuses = new Set<ActivityFailureStatus>(['authentication-required', 'forbidden', 'conflict', 'stale-version',
  'stale-run', 'pending', 'uncertain', 'unsupported', 'unavailable', 'refused', 'invalid', 'not-found']);
const signalTimeoutMs = 10_000;

function object(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function instant(value: unknown): value is string {
  return text(value, 64) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function optionalText(value: unknown): value is string | null | undefined { return value == null || text(value); }
function optionalInstant(value: unknown): value is string | null | undefined { return value == null || instant(value); }
function safeCode(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9._-]{0,127}$/i.test(value); }
function failure(status: ActivityFailureStatus, code: string, retryable = false): ActivityFailure { return { status, code, retryable }; }
function isFailure(value: ScopeResult): value is ActivityFailure { return 'status' in value; }
function has(value: RecordValue, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }

function scalar(value: unknown): value is string | number | boolean {
  return text(value) || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean';
}
function requirement(value: unknown): ActivityExclusion['requirement'] | null {
  if (!object(value)) return null;
  const out: RecordValue = {};
  for (const key of ['operator', 'unit', 'value']) {
    if (!has(value, key)) continue;
    const entry = value[key];
    if (scalar(entry)) out[key] = entry;
    else if (key === 'value' && Array.isArray(entry) && entry.length <= 20 && entry.every((item) => text(item))) out[key] = [...entry];
    else return null;
  }
  return out;
}

function activityOffer(value: unknown): ActivityOffer | null {
  if (!object(value) || !object(value['offerRef']) || !text(value['offerRef']['offerId']) || !text(value['state'], 128)
    || !positive(value['version']) || !(value['briefVersion'] === null || positive(value['briefVersion']))
    || !optionalInstant(value['createdAt']) || !optionalInstant(value['expiresAt'])
    || !optionalText(value['holdId']) || !optionalText(value['orderUuid']) || !optionalText(value['policyVersion']) || !optionalText(value['quoteId'])
    || value['href'] !== undefined && !internalHref(value['href'])) return null;
  const state = value['state'];
  return {
    offerRef: { offerId: value['offerRef']['offerId'] }, state,
    displayState: offerStates.has(state as ActivityOfferState) ? state as ActivityOfferState : 'unavailable',
    version: value['version'], briefVersion: value['briefVersion'],
    ...(value['createdAt'] === undefined ? {} : { createdAt: value['createdAt'] as string }),
    ...(value['holdId'] === undefined ? {} : { holdId: value['holdId'] as string | null }),
    ...(value['orderUuid'] === undefined ? {} : { orderUuid: value['orderUuid'] as string | null }),
    ...(value['policyVersion'] === undefined ? {} : { policyVersion: value['policyVersion'] as string | null }),
    ...(value['quoteId'] === undefined ? {} : { quoteId: value['quoteId'] as string | null }),
    ...(value['expiresAt'] === undefined ? {} : { expiresAt: value['expiresAt'] as string | null }),
    ...(value['href'] === undefined ? {} : { href: value['href'] as string }),
  };
}

function internalHref(value: unknown): value is string {
  if (!text(value, 2048) || !value.startsWith('/gcsp/') || value.startsWith('//')) return false;
  try { return new URL(value, 'https://gcsp.invalid').origin === 'https://gcsp.invalid'; } catch { return false; }
}

function permission(value: unknown): ActivityPermission | null | undefined {
  if (value === null) return null;
  if (!object(value) || !['searchConsent', 'holdConsent', 'paused', 'canSearch', 'canHold'].every((key) => typeof value[key] === 'boolean')
    || !positive(value['permissionVersion'])) return undefined;
  return { searchConsent: value['searchConsent'] as boolean, holdConsent: value['holdConsent'] as boolean,
    paused: value['paused'] as boolean, permissionVersion: value['permissionVersion'] as number,
    canSearch: value['canSearch'] as boolean, canHold: value['canHold'] as boolean };
}

function check(value: unknown): ActivityCheck | null {
  if (!object(value) || !instant(value['checkedAt']) || value['clockVersion'] !== undefined && !text(value['clockVersion'])
    || !nonnegative(value['carsChecked']) || !nonnegative(value['suitableCars']) || value['suitableCars'] > value['carsChecked']
    || !Array.isArray(value['exclusions']) || !['offer-held', 'no-match'].includes(value['outcome'] as string)
    || value['limitation'] !== undefined && value['limitation'] !== 'renewal-deadline-unknown') return null;
  const exclusions: ActivityExclusion[] = [];
  for (const item of value['exclusions']) {
    if (!object(item) || !text(item['essential']) || !positive(item['cars'])) return null;
    const details = requirement(item['requirement']); if (!details) return null;
    exclusions.push({ essential: item['essential'], requirement: details, cars: item['cars'] });
  }
  return { checkedAt: value['checkedAt'], ...(value['clockVersion'] === undefined ? {} : { clockVersion: value['clockVersion'] as string }),
    carsChecked: value['carsChecked'], suitableCars: value['suitableCars'], exclusions, outcome: value['outcome'] as ActivityCheck['outcome'],
    ...(value['limitation'] === undefined ? {} : { limitation: 'renewal-deadline-unknown' }) };
}

function stateChange(value: unknown): ActivityStateChange | null {
  if (!object(value) || !text(value['eventId']) || value['eventType'] !== 'brief-changed' || !operations.has(value['operation'] as string)
    || !positive(value['briefVersion']) || !nonnegative(value['previousBriefVersion']) || !instant(value['occurredAt'])) return null;
  return { eventId: value['eventId'], eventType: 'brief-changed', operation: value['operation'] as ActivityStateChange['operation'],
    briefVersion: value['briefVersion'], previousBriefVersion: value['previousBriefVersion'], occurredAt: value['occurredAt'] };
}

function activityProjection(value: unknown, scope: Scope): ActivityProjection | null {
  if (!object(value) || value['runId'] !== scope.runId || value['employeeId'] !== scope.employeeId || !instant(value['asOf'])
    || !text(value['clockVersion']) || !(value['briefVersion'] === null || positive(value['briefVersion']))
    || !knownActivityStates.has(value['state'] as string) || !sourceStatuses.has(value['sourceStatus'] as string)
    || !Array.isArray(value['offers']) || !Array.isArray(value['stateChanges']) || !object(value['searchEvidence'])
    || !object(value['stateChangesEvidence'])) return null;
  const permissionValue = permission(value['permission']); if (permissionValue === undefined) return null;
  if (value['briefVersion'] === null && permissionValue !== null || value['briefVersion'] !== null && permissionValue === null) return null;
  const offers = value['offers'].map(activityOffer); if (offers.some((offer) => offer === null)) return null;
  const currentOffer = value['currentOffer'] === null ? null : activityOffer(value['currentOffer']);
  if (value['currentOffer'] !== null && currentOffer === null) return null;
  let lastSuccessfulCheck: ActivityCheck | null = null;
  if (value['lastSuccessfulCheck'] !== null) {
    lastSuccessfulCheck = check(value['lastSuccessfulCheck']); if (!lastSuccessfulCheck) return null;
  }
  let searchEvidence: ActivityProjection['searchEvidence'];
  const evidence = value['searchEvidence'];
  if (evidence['status'] === 'recorded' && positive(evidence['checks'])) searchEvidence = { status: 'recorded', checks: evidence['checks'] };
  else if (evidence['status'] === 'not-recorded' && evidence['reason'] === 'no-search-check-yet') searchEvidence = { status: 'not-recorded', reason: 'no-search-check-yet' };
  else return null;
  const stateChanges = value['stateChanges'].map(stateChange); if (stateChanges.some((change) => change === null)) return null;
  const historyEvidence = value['stateChangesEvidence'];
  if (!['incomplete', 'recorded', 'not-recorded'].includes(historyEvidence['status'] as string) || !nonnegative(historyEvidence['rejectedReceipts'])) return null;
  return {
    runId: scope.runId, employeeId: scope.employeeId, asOf: value['asOf'], clockVersion: value['clockVersion'],
    briefVersion: value['briefVersion'], permission: permissionValue, state: value['state'] as ActivityProjection['state'],
    lastSuccessfulCheck, searchEvidence, sourceStatus: value['sourceStatus'] as ActivityProjection['sourceStatus'],
    currentOffer, offers: offers as ActivityOffer[], stateChanges: stateChanges as ActivityStateChange[],
    stateChangesEvidence: { status: historyEvidence['status'] as ActivityProjection['stateChangesEvidence']['status'],
      rejectedReceipts: historyEvidence['rejectedReceipts'] },
  };
}

function sourceUrl(value: unknown): value is string | null {
  if (value === null || value === '') return true;
  if (!text(value, 2048)) return false;
  try {
    const parsed = new URL(value, 'https://gcsp.invalid');
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function sourceDisplayImage(value: unknown): ActivityDisplayImage | null {
  if (!object(value) || !text(value['src'], 2048) || !sourceUrl(value['src'])) return null;
  type MetadataKey = Exclude<keyof ActivityDisplayImage, 'src'>;
  const metadata: Partial<Record<MetadataKey, string>> = {};
  for (const key of ['alt', 'caption', 'fidelity', 'kind', 'sourceRef', 'viewpoint', 'label']) {
    if (value[key] === undefined) continue;
    if (!text(value[key], 2048)) return null;
    metadata[key as MetadataKey] = value[key];
  }
  return { src: value['src'], ...metadata };
}

function offerDisplay(value: unknown, offerId: string, runId: string): ActivityOfferDisplay | null {
  if (!object(value) || value['schemaVersion'] !== 1 || value['offerId'] !== offerId || value['runId'] !== runId
    || !['pending', 'accepted', 'declined', 'expired', 'superseded'].includes(value['state'] as string) || !text(value['reason'])
    || !instant(value['serverNow']) || !instant(value['expiresAt']) || !text(value['clockVersion'])
    || !positive(value['offerVersion']) || !positive(value['holdVersion']) || !text(value['holdState']) || !text(value['offerState'])
    || !Array.isArray(value['availableActions']) || !value['availableActions'].every((action) => ['accept', 'decline'].includes(action as string))
    || new Set(value['availableActions']).size !== value['availableActions'].length
    || value['availableActions'].includes('accept') && !value['availableActions'].includes('decline')
    || value['state'] !== 'pending' && value['availableActions'].length !== 0) return null;
  const quote = value['quote'];
  if (!object(quote) || !['quoteId', 'configurationId', 'orderUuid', 'policyVersion'].every((key) => text(quote[key]))
    || !positive(quote['briefVersion']) || !(quote['orderNumber'] === null || typeof quote['orderNumber'] === 'string' && /^\d{7}$/.test(quote['orderNumber']))
    || !instant(quote['quotedAt']) || !instant(quote['validUntil']) || !object(quote['revisions']) || !positive(quote['revisions']['quote'])) return null;
  const facts = quote['facts']; const display = object(facts) ? facts['display'] : undefined;
  if (!object(facts) || facts['contractVersion'] !== 'vehicle-snapshot-v1' || facts['identityKind'] !== 'exact-stock'
    || !text(facts['candidateKey']) || !text(facts['sourceNamespace']) || !text(facts['snapshotVersion']) || !instant(facts['observedAt'])
    || !object(facts['sourceKeys']) || facts['sourceKeys']['stockId'] !== quote['orderUuid'] || !object(display)
    || !text(display['name']) || !sourceUrl(display['photo']) || !Array.isArray(display['images'])) return null;
  const images = display['images'].map(sourceDisplayImage); if (images.some((image) => image === null)) return null;
  return { offerRef: { offerId }, title: display['name'], images: images as ActivityDisplayImage[] };
}

function currentHint(value: unknown): ActivityFailure['current'] {
  if (!object(value)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of ['state', 'briefVersion', 'draftVersion', 'runId', 'employeeId', 'environmentId', 'subject', 'clockVersion']) {
    const item = value[key];
    if (item === undefined) continue;
    if (key === 'briefVersion' && !positive(item) || key === 'draftVersion' && !nonnegative(item)
      || key === 'state' && !text(item, 128) || ['runId', 'employeeId', 'environmentId', 'subject', 'clockVersion'].includes(key) && !text(item)) return undefined;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') out[key] = item;
    else return undefined;
  }
  return Object.keys(out).length ? out : undefined;
}

function safeReasons(value: unknown): ActivityFailure['reasons'] {
  if (!Array.isArray(value)) return undefined;
  const out: { field?: string; code?: string; reason?: string }[] = [];
  for (const item of value.slice(0, 50)) {
    if (!object(item)) continue;
    const row: { field?: string; code?: string; reason?: string } = {};
    if (text(item['field'], 128)) row.field = item['field'];
    if (safeCode(item['code'])) row.code = item['code'];
    if (text(item['reason'])) row.reason = item['reason'];
    if (Object.keys(row).length) out.push(row);
  }
  return out.length ? out : undefined;
}

function failureStatus(status: number, body: unknown): ActivityFailure {
  const envelope = object(body) ? body : {};
  const sourceStatus = responseFailureStatuses.has(envelope['status'] as ActivityFailureStatus)
    ? envelope['status'] as ActivityFailureStatus : undefined;
  let resultStatus: ActivityFailureStatus;
  if (status === 401) resultStatus = 'authentication-required';
  else if (status === 403) resultStatus = 'forbidden';
  else if (status === 409) resultStatus = sourceStatus === 'stale-version' || sourceStatus === 'stale-run' ? sourceStatus : 'conflict';
  else if (status === 202) resultStatus = sourceStatus === 'uncertain' ? 'uncertain' : 'pending';
  else if (status === 422) resultStatus = 'unsupported';
  else if (status === 503) resultStatus = sourceStatus === 'refused' ? 'refused' : 'unavailable';
  else if (status === 404) resultStatus = 'not-found';
  else if (status === 400) resultStatus = 'invalid';
  else if (status === 200 && sourceStatus) resultStatus = sourceStatus;
  else resultStatus = 'unavailable';
  const code = safeCode(envelope['code']) ? envelope['code'] : resultStatus;
  const retryable = typeof envelope['retryable'] === 'boolean' ? envelope['retryable'] : resultStatus === 'unavailable';
  const current = currentHint(envelope['current']);
  const reasons = safeReasons(envelope['reasons']);
  const out: ActivityFailure = { status: resultStatus, code, retryable, httpStatus: status,
    ...(text(envelope['reason']) ? { reason: envelope['reason'] } : {}),
    ...(text(envelope['operationId'], 256) ? { operationId: envelope['operationId'] } : {}),
    ...(current ? { current } : {}),
    ...(safeVersionHint(envelope['currentVersion']) ? { currentVersion: envelope['currentVersion'] as number | string } : {}),
    ...(safeVersionHint(envelope['expectedVersion']) ? { expectedVersion: envelope['expectedVersion'] as number | string } : {}),
    ...(text(envelope['action'], 128) ? { action: envelope['action'] } : {}),
    ...(reasons ? { reasons } : {}),
  };
  if (status === 202 && !out.operationId) return { status: 'uncertain', code: 'activity-operation-id-unavailable', retryable: false, httpStatus: status,
    ...(out.reason ? { reason: out.reason } : {}) };
  return out;
}

function safeVersionHint(value: unknown): boolean { return typeof value === 'string' ? text(value, 128) : nonnegative(value); }

function commandReceipt(value: unknown, expectedCommandId: string): ActivityCommandReceipt | null {
  if (!object(value)) return null;
  const out: RecordValue = {};
  for (const key of ['briefVersion', 'draftVersion', 'version']) {
    if (value[key] === undefined) continue;
    if (key === 'draftVersion' ? !nonnegative(value[key]) : !positive(value[key])) return null;
    out[key] = value[key];
  }
  if (!Object.keys(out).length) return null;
  if (value['commandId'] !== undefined && value['commandId'] !== expectedCommandId) return null;
  if (value['changed'] !== undefined) { if (typeof value['changed'] !== 'boolean') return null; out['changed'] = value['changed']; }
  if (value['operationId'] !== undefined) { if (!text(value['operationId'], 256)) return null; out['operationId'] = value['operationId']; }
  if (value['action'] !== undefined) { if (!text(value['action'], 128)) return null; out['action'] = value['action']; }
  if (value['current'] !== undefined) { const current = currentHint(value['current']); if (!current) return null; out['current'] = current; }
  if (value['reasons'] !== undefined) { const reasons = safeReasons(value['reasons']); if (!reasons) return null; out['reasons'] = reasons; }
  return out as ActivityCommandReceipt;
}

function matchesScopeTree(value: unknown, scope: Scope): boolean {
  if (Array.isArray(value)) return value.every((item) => matchesScopeTree(item, scope));
  if (!object(value)) return true;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'subject' && nested !== scope.subject || key === 'environmentId' && nested !== scope.environmentId
      || key === 'runId' && nested !== scope.runId || key === 'employeeId' && nested !== scope.employeeId) return false;
    if (!matchesScopeTree(nested, scope)) return false;
  }
  return true;
}

@Injectable({ providedIn: 'root' })
export class ActivityClient {
  private readonly auth = inject(AuthPort);
  private readonly config = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  readActivity(options: ActivityRequestOptions = {}): Promise<ActivityResult<ActivityProjection>> {
    return this.get('/activity', options).then((response) => {
      if (response.status !== 'ok') return response;
      const scope = this.captureScope(); if (isFailure(scope)) return scope;
      const value = activityProjection(response.value, scope);
      return value ? { status: 'ok', value } : failure('unavailable', 'activity-projection-invalid', false);
    });
  }

  async readOfferDisplay({ offerId, runId, signal }: { readonly offerId: string; readonly runId: string; readonly signal?: AbortSignal }): Promise<ActivityResult<ActivityOfferDisplay>> {
    if (!text(offerId) || !text(runId)) return failure('invalid', 'activity-offer-reference-invalid');
    const scope = this.captureScope(); if (isFailure(scope)) return scope;
    if (runId !== scope.runId) return failure('stale-run', 'activity-offer-run-changed');
    const response = await this.get(`/offers/${encodeURIComponent(offerId)}?runId=${encodeURIComponent(runId)}`, { signal }, scope);
    if (response.status !== 'ok') return response;
    const value = offerDisplay(response.value, offerId, scope.runId);
    return value ? { status: 'ok', value } : failure('unavailable', 'activity-offer-display-invalid', false);
  }

  async readControlVersions(options: ActivityRequestOptions = {}): Promise<ActivityResult<ActivityControlVersions>> {
    const response = await this.get('/brief/editor', options);
    if (response.status !== 'ok') return response;
    const value = response.value;
    if (!object(value) || !object(value['initial']) || !positive(value['initial']['briefVersion']) || !nonnegative(value['initial']['draftVersion'])) {
      return failure('unavailable', 'activity-editor-versions-invalid', false);
    }
    return { status: 'ok', value: { briefVersion: value['initial']['briefVersion'], draftVersion: value['initial']['draftVersion'] } };
  }

  async command(operation: ActivityOperation, input: ActivityCommandInput, options: ActivityRequestOptions = {}): Promise<ActivityResult<ActivityCommandReceipt>> {
    if (!activityOperations.has(operation) || !object(input) || Object.keys(input).length !== 3
      || !['commandId', 'expectedBriefVersion', 'expectedDraftVersion'].every((key) => has(input, key))
      || !text(input.commandId, 128) || !positive(input.expectedBriefVersion) || !nonnegative(input.expectedDraftVersion)) {
      return failure('invalid', 'activity-command-invalid');
    }
    let body: ActivityCommandInput;
    try { body = structuredClone({ commandId: input.commandId, expectedBriefVersion: input.expectedBriefVersion,
      expectedDraftVersion: input.expectedDraftVersion }); } catch { return failure('invalid', 'activity-command-invalid'); }
    const response = await this.post(`/brief/${operation}`, body, options);
    if (response.status !== 'ok') return response;
    const receipt = commandReceipt(response.value, body.commandId);
    return receipt ? { status: 'ok', value: receipt } : failure('unavailable', 'activity-command-receipt-invalid', false);
  }

  private get(path: string, options: ActivityRequestOptions, expectedScope?: Scope): Promise<ActivityResult<unknown>> {
    return this.request(path, 'GET', undefined, options, expectedScope);
  }

  private post(path: string, body: ActivityCommandInput, options: ActivityRequestOptions): Promise<ActivityResult<unknown>> {
    return this.request(path, 'POST', body, options);
  }

  private captureScope(): ScopeResult {
    const session = this.auth.state();
    if (session.status !== 'ready') return failure('authentication-required', 'activity-authentication-required');
    const context: ApplicationContext = session.context;
    if (!context.roles.includes('employee')) return failure('forbidden', 'activity-employee-required');
    if (!text(context.subject) || !text(context.environmentId) || !text(context.runId) || !text(context.employeeId)) {
      return failure('authentication-required', 'activity-employee-context-unavailable');
    }
    return { subject: context.subject, environmentId: context.environmentId, runId: context.runId, employeeId: context.employeeId };
  }

  private sameScope(scope: Scope): boolean {
    const current = this.captureScope();
    return !isFailure(current) && current.subject === scope.subject && current.environmentId === scope.environmentId
      && current.runId === scope.runId && current.employeeId === scope.employeeId;
  }

  private async request(path: string, method: Method, body: ActivityCommandInput | undefined, options: ActivityRequestOptions,
    expectedScope?: Scope): Promise<ActivityResult<unknown>> {
    if (options.signal?.aborted) return failure('aborted', 'activity-request-aborted');
    const captured = expectedScope ?? this.captureScope();
    if (isFailure(captured)) return captured;
    const controller = new AbortController(); let timedOut = false;
    const stop = () => controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, signalTimeoutMs);
    options.signal?.addEventListener('abort', stop, { once: true });
    const interrupted: Promise<ActivityResult<unknown>> = new Promise((resolve) => controller.signal.addEventListener('abort', () => {
      resolve(timedOut ? failure('unavailable', 'activity-timeout') : failure('aborted', 'activity-request-aborted'));
    }, { once: true }));
    if (options.signal?.aborted) controller.abort();

    const run = async (): Promise<ActivityResult<unknown>> => {
      try {
        const config = await this.config.load();
        if (controller.signal.aborted) return timedOut ? failure('unavailable', 'activity-timeout') : failure('aborted', 'activity-request-aborted');
        if (!this.sameScope(captured)) return failure('authentication-required', 'activity-scope-changed');
        if (config.environmentId !== captured.environmentId) return failure('unavailable', 'activity-environment-mismatch');
        let token: string | null;
        try { token = await this.auth.getAccessToken(); } catch { return this.sameScope(captured)
          ? failure('authentication-required', 'activity-access-token-unavailable') : failure('authentication-required', 'activity-scope-changed'); }
        if (controller.signal.aborted) return timedOut ? failure('unavailable', 'activity-timeout') : failure('aborted', 'activity-request-aborted');
        if (!this.sameScope(captured)) return failure('authentication-required', 'activity-scope-changed');
        if (!text(token, 8192) || /\s/.test(token)) return failure('authentication-required', 'activity-access-token-unavailable');
        const url = `${config.apiBaseUrl.replace(/\/+$/, '')}${path}`;
        const response = await this.fetcher(url, { method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        let envelope: unknown; try { envelope = await response.json(); } catch { envelope = null; }
        if (controller.signal.aborted) return timedOut ? failure('unavailable', 'activity-timeout') : failure('aborted', 'activity-request-aborted');
        if (!this.sameScope(captured)) return failure('authentication-required', 'activity-scope-changed');
        if (!matchesScopeTree(envelope, captured)) return failure('unavailable', 'activity-response-scope-mismatch');
        if (response.status === 200 && response.ok && object(envelope) && envelope['status'] === 'ok' && has(envelope, 'value')) {
          return { status: 'ok', value: envelope['value'] };
        }
        if (response.status === 200 && object(envelope) && envelope['status'] === 'ok') return failure('unavailable', 'activity-response-invalid', false);
        return failureStatus(response.status, envelope);
      } catch {
        if (controller.signal.aborted) return timedOut ? failure('unavailable', 'activity-timeout') : failure('aborted', 'activity-request-aborted');
        return this.sameScope(captured) ? failure('unavailable', 'activity-transport-unavailable')
          : failure('authentication-required', 'activity-scope-changed');
      }
    };
    try { return await Promise.race([run(), interrupted]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', stop); }
  }
}
