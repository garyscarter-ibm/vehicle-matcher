import { inject, Injectable } from '@angular/core';
import { accountProjection, accountState, briefShape, buddyView, previewShape, ratingView, sameView } from './brief.validation';
import { AuthPort } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService } from '../auth/runtime-config';
import {
  BriefCurrentValue,
  BriefPreview,
  BriefDraftRecord,
  BriefEditor,
  BriefEngagementValue,
  BriefFailure,
  BriefHistoryValue,
  BriefPreferenceSaveValue,
  BriefResult,
  BriefResourceReference,
  BriefValue,
  EditableBrief,
  BriefVersioned,
} from './brief.types';

export interface BriefRequestOptions { readonly signal?: AbortSignal; readonly expectedContextKey?: string }

export interface BriefVersionCommand {
  readonly commandId: string;
  readonly expectedBriefVersion: number;
  readonly expectedDraftVersion: number;
}

export interface BriefPreviewInput {
  readonly kind: 'unsaved-draft';
  readonly baseBriefVersion: number;
  readonly draftVersion: number;
  readonly brief: EditableBrief;
}

export interface BriefPreferencesInput extends BriefVersionCommand {
  readonly changes: Readonly<Record<string, null | { readonly value?: BriefValue; readonly importance?: 'medium' | 'high' }>>;
  readonly currentCarRating?: { readonly contractId: string; readonly value: number | null };
  readonly sameAgain?: { readonly contractId: string; readonly on: boolean };
}

export interface BriefDraftInput extends BriefVersionCommand {
  readonly brief: EditableBrief;
}

export interface BriefConfirmInput extends BriefVersionCommand {
  readonly consent?: { readonly search: boolean; readonly hold: boolean };
}

export interface BriefDeclineChangeInput {
  readonly commandId: string;
  readonly expectedBriefVersion: number;
  readonly decisionId: string;
  readonly change: { readonly path: string; readonly value: BriefValue };
}

const AUTH_REQUIRED: BriefFailure = { status: 'unauthenticated', code: 'authentication-required', retryable: false };
const unavailable = (code: string): BriefFailure => ({ status: 'unavailable', code, retryable: true });
const invalidRequest: BriefFailure = { status: 'invalid', code: 'invalid-request', retryable: false };
const failureStatuses = new Set<BriefFailure['status']>([
  'invalid', 'unavailable', 'stale-version', 'conflict', 'forbidden', 'not-found', 'stale-run',
  'pending', 'unauthenticated', 'access-required', 'denied',
]);
const authorityKeys = new Set(['runId', 'environmentId', 'employeeId', 'subject', 'principalId', 'policyVersion']);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasOnlyKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).every((key) => fields.includes(key));
}

function carriesAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesAuthority);
  if (!object(value)) return false;
  return Object.entries(value).some(([key, child]) => authorityKeys.has(key) || carriesAuthority(child));
}

function versionCommand(value: unknown): value is BriefVersionCommand {
  return hasOnlyKeys(value, ['commandId', 'expectedBriefVersion', 'expectedDraftVersion'])
    && text(value['commandId']) && value['commandId'].length <= 128
    && revision(value['expectedBriefVersion']) && revision(value['expectedDraftVersion']);
}

function editableBrief(value: unknown): value is EditableBrief {
  return hasOnlyKeys(value, ['schemaVersion', 'preferences', 'essentials', 'currentCarFeedback', 'currentCarRating', 'sameAgain'])
    && briefShape(value);
}

function validPreview(value: unknown): value is BriefPreviewInput {
  return hasOnlyKeys(value, ['kind', 'baseBriefVersion', 'draftVersion', 'brief'])
    && value['kind'] === 'unsaved-draft' && revision(value['baseBriefVersion'])
    && revision(value['draftVersion']) && editableBrief(value['brief']);
}

function validPreferences(value: unknown): value is BriefPreferencesInput {
  if (!hasOnlyKeys(value, ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'changes', 'currentCarRating', 'sameAgain'])
    || !versionCommand({ commandId: value['commandId'], expectedBriefVersion: value['expectedBriefVersion'], expectedDraftVersion: value['expectedDraftVersion'] })
    || !object(value['changes'])) return false;
  const rating = value['currentCarRating'];
  if (rating !== undefined && (!hasOnlyKeys(rating, ['contractId', 'value']) || !text(rating['contractId'])
    || !(rating['value'] === null || Number.isSafeInteger(rating['value']) && (rating['value'] as number) >= 1 && (rating['value'] as number) <= 5))) return false;
  const sameAgain = value['sameAgain'];
  return sameAgain === undefined || hasOnlyKeys(sameAgain, ['contractId', 'on'])
    && text(sameAgain['contractId']) && typeof sameAgain['on'] === 'boolean';
}

function validDraft(value: unknown): value is BriefDraftInput {
  if (!hasOnlyKeys(value, ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'brief'])) return false;
  return text(value['commandId']) && value['commandId'].length <= 128
    && revision(value['expectedBriefVersion']) && revision(value['expectedDraftVersion']) && editableBrief(value['brief']);
}

function validConfirm(value: unknown): value is BriefConfirmInput {
  if (!hasOnlyKeys(value, ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'consent'])
    || !text(value['commandId']) || value['commandId'].length > 128
    || !revision(value['expectedBriefVersion']) || !revision(value['expectedDraftVersion'])) return false;
  const consent = value['consent'];
  return consent === undefined || hasOnlyKeys(consent, ['search', 'hold'])
    && typeof consent['search'] === 'boolean' && typeof consent['hold'] === 'boolean';
}

function validDeclineChange(value: unknown): value is BriefDeclineChangeInput {
  if (!hasOnlyKeys(value, ['commandId', 'expectedBriefVersion', 'decisionId', 'change'])
    || !text(value['commandId']) || value['commandId'].length > 128
    || !revision(value['expectedBriefVersion']) || !text(value['decisionId'])) return false;
  const change = value['change'];
  return hasOnlyKeys(change, ['path', 'value']) && text(change['path']) && Object.hasOwn(change, 'value');
}

function validObjectPayload(value: unknown): value is Record<string, unknown> {
  return object(value) && !carriesAuthority(value);
}

function validEditableBrief(value: unknown): value is EditableBrief {
  return editableBrief(value) && !carriesAuthority(value);
}

function readEditor(value: unknown): value is BriefEditor {
  if (!object(value)) return false;
  const context = value['context'];
  const initial = value['initial'];
  const versions = value['versions'];
  if (!object(context) || !object(context['preferences']) || !object(context['essentials'])
    || !object(context['slider']) || typeof context['slider']['minimum'] !== 'number'
    || typeof context['slider']['maximum'] !== 'number' || context['slider']['minimum'] > context['slider']['maximum']
    || !object(context['knownFacts']) || !object(context['permissions']) || !text(context['policyVersion'])
    || !text(context['contextVersion']) || !object(context['practicalQuestions']) || !text(context['unconfirmedLabel'])
    || !Array.isArray(context['assumptions']) || !accountProjection(context['accountPreferences'])
    || !Object.values(context['preferences']).every((d) => object(d) && text(d['label']) && ['slider', 'enum', 'boolean', 'number', 'string'].includes(String(d['type'])) && typeof d['editable'] === 'boolean' && (d['type'] !== 'enum' || Array.isArray(d['values'])))
    || !Object.values(context['essentials']).every((d) => object(d) && text(d['type']) && text(d['operator']) && (d['unit'] === null || text(d['unit'])) && typeof d['editable'] === 'boolean')
    || !Object.values(context['practicalQuestions']).every((q) => object(q) && text(q['label']) && Object.hasOwn(q, 'yes') && Object.hasOwn(q, 'no') && q['unknown'] === null)
    || !Object.values(context['knownFacts']).every((f) => object(f) && Object.hasOwn(f, 'value') && f['editable'] === false)) return false;
  if (!object(initial) || !validEditableBrief(initial['brief']) || !revision(initial['briefVersion'])
    || !revision(initial['draftVersion']) || !accountState(initial['accountPreferences'])
    || !ratingView(initial['currentCarRating']) || !sameView(initial['sameAgain']) || !buddyView(initial['buddy'])
    || !(initial['currentCarRating'] === null || object(initial['currentCarRating'])
      && (initial['currentCarRating']['value'] === null || Number.isSafeInteger(initial['currentCarRating']['value']))
      && text(initial['currentCarRating']['contractId']))
    || !object(initial['sameAgain']) || typeof initial['sameAgain']['available'] !== 'boolean'
    || typeof initial['sameAgain']['on'] !== 'boolean' || !object(initial['buddy'])
    || !['engaged', 'disengaged'].includes(String(initial['buddy']['state']))
    || typeof initial['buddy']['canEngage'] !== 'boolean' || !object(initial['consent'])
    || typeof initial['consent']['search'] !== 'boolean' || typeof initial['consent']['hold'] !== 'boolean') return false;
  return object(versions) && ['policy', 'context', 'facts', 'clock'].every((key) => text(versions[key]))
    && versions['policy'] === context['policyVersion'];
}

function versionedBrief(value: unknown): value is BriefVersioned {
  return object(value) && value['schemaVersion'] === 1 && revision(value['briefVersion'])
    && text(value['status']) && briefShape(value);
}

function currentValue(value: unknown): value is BriefCurrentValue {
  return object(value) && versionedBrief(value['brief']) && object(value['activity']) && ['canSearch', 'canHold', 'existingOffersUnaffected'].every((k) => typeof (value['activity'] as Record<string, unknown>)[k] === 'boolean')
    && Array.isArray(value['activity']['existingOffers']) && object(value['validation']) && text(value['validation']['policyVersion'])
    && Array.isArray(value['validation']['unknownEssentials']) && Array.isArray(value['validation']['assumptions']);
}

function historyValue(value: unknown): value is BriefHistoryValue {
  return object(value) && Array.isArray(value['versions']) && value['versions'].every(versionedBrief);
}

function draftValue(value: unknown): value is BriefDraftRecord {
  return object(value) && revision(value['draftVersion']) && revision(value['baseBriefVersion']) && editableBrief(value['brief']);
}

function preferenceSaveValue(value: unknown): value is BriefPreferenceSaveValue {
  return object(value) && revision(value['briefVersion']) && revision(value['draftVersion']) && buddyView(value['buddy']) && accountState(value['accountPreferences']) && ratingView(value['currentCarRating']) && sameView(value['sameAgain']);
}

function engagementValue(value: unknown): value is BriefEngagementValue {
  return object(value) && revision(value['briefVersion']) && revision(value['draftVersion']) && buddyView(value['buddy']);
}

function parseFailure(value: unknown): BriefFailure | null {
  if (!object(value) || typeof value['status'] !== 'string'
    || !failureStatuses.has(value['status'] as BriefFailure['status'])) return null;
  for (const key of ['code', 'reason', 'action', 'operationId', 'resourceType', 'contractVersion']) {
    if (value[key] !== undefined && !text(value[key])) return null;
  }
  for (const key of ['expectedVersion', 'currentVersion', 'currentBriefVersion', 'currentDraftVersion', 'remaining', 'considered', 'minimumCategories']) {
    if (value[key] !== undefined && !revision(value[key])) return null;
  }
  if (value['buddy'] !== undefined && !buddyView(value['buddy'])) return null;
  if (value['retryable'] !== undefined && typeof value['retryable'] !== 'boolean') return null;
  const current = value['current'];
  const currentVersions = value['currentVersions'];
  const resource = value['resource'];
  if (current !== undefined && !object(current) || currentVersions !== undefined && !object(currentVersions)
    || resource !== undefined && !validResource(resource)) return null;
  return {
    status: value['status'] as BriefFailure['status'],
    ...(value['code'] === undefined ? {} : { code: value['code'] as string }),
    ...(value['reason'] === undefined ? {} : { reason: value['reason'] as string }),
    ...(value['reasons'] === undefined ? {} : { reasons: value['reasons'] }),
    ...(value['buddy'] === undefined ? {} : { buddy: value['buddy'] as import('./brief.types').BuddyView }),
    ...(value['remaining'] === undefined ? {} : { remaining: value['remaining'] as number }),
    ...(value['considered'] === undefined ? {} : { considered: value['considered'] as number }),
    ...(value['minimumCategories'] === undefined ? {} : { minimumCategories: value['minimumCategories'] as number }),
    ...(value['retryable'] === undefined ? {} : { retryable: value['retryable'] as boolean }),
    ...(resource === undefined ? {} : { resource: resource as string | BriefResourceReference }),
    ...(value['resourceType'] === undefined ? {} : { resourceType: value['resourceType'] as string }),
    ...(value['expectedVersion'] === undefined ? {} : { expectedVersion: value['expectedVersion'] as number }),
    ...(value['currentVersion'] === undefined ? {} : { currentVersion: value['currentVersion'] as number }),
    ...(value['currentBriefVersion'] === undefined ? {} : { currentBriefVersion: value['currentBriefVersion'] as number }),
    ...(value['currentDraftVersion'] === undefined ? {} : { currentDraftVersion: value['currentDraftVersion'] as number }),
    ...(current === undefined ? {} : { current: current as Readonly<Record<string, unknown>> }),
    ...(currentVersions === undefined ? {} : { currentVersions: currentVersions as Readonly<Record<string, unknown>> }),
    ...(value['action'] === undefined ? {} : { action: value['action'] as string }),
    ...(value['operationId'] === undefined ? {} : { operationId: value['operationId'] as string }),
    ...(value['contractVersion'] === undefined ? {} : { contractVersion: value['contractVersion'] as string }),
  };
}

function validResource(value: unknown): value is string | BriefResourceReference {
  if (text(value)) return true;
  if (!hasOnlyKeys(value, ['table', 'key'])) return false;
  return (value['table'] === undefined || text(value['table']))
    && (value['key'] === undefined || object(value['key']));
}

@Injectable({ providedIn: 'root' })
export class BriefClient {
  private readonly auth = inject(AuthPort);
  private readonly runtime = inject(RuntimeConfigService);
  private readonly fetcher = inject(PORTAL_FETCH);

  readEditor(options: BriefRequestOptions = {}): Promise<BriefResult<BriefEditor>> { return this.read('/brief/editor', readEditor, options); }
  readCurrent(options: BriefRequestOptions = {}): Promise<BriefResult<BriefCurrentValue>> { return this.read('/brief', currentValue, options); }
  readHistory(options: BriefRequestOptions = {}): Promise<BriefResult<BriefHistoryValue>> { return this.read('/brief/history', historyValue, options); }
  readDraft(options: BriefRequestOptions = {}): Promise<BriefResult<BriefDraftRecord>> { return this.read('/brief/draft', draftValue, options); }

  preview(input: BriefPreviewInput, options: BriefRequestOptions = {}): Promise<BriefResult<BriefPreview>> {
    return validPreview(input) && !carriesAuthority(input) ? this.post('/brief/preview', input, previewShape, options) : Promise.resolve(invalidRequest);
  }

  savePreferences(input: BriefPreferencesInput, options: BriefRequestOptions = {}): Promise<BriefResult<BriefPreferenceSaveValue>> {
    return validPreferences(input) && !carriesAuthority(input)
      ? this.post('/brief/preferences', input, preferenceSaveValue, options)
      : Promise.resolve(invalidRequest);
  }

  saveDraft(input: BriefDraftInput, options: BriefRequestOptions = {}): Promise<BriefResult<BriefDraftRecord>> {
    return validDraft(input) && validEditableBrief(input.brief)
      ? this.post('/brief/draft', input, draftValue, options)
      : Promise.resolve(invalidRequest);
  }

  confirm(input: BriefConfirmInput, options: BriefRequestOptions = {}): Promise<BriefResult<BriefCurrentValue>> {
    return validConfirm(input) && !carriesAuthority(input)
      ? this.post('/brief/confirm', input, currentValue, options)
      : Promise.resolve(invalidRequest);
  }

  engage(input: BriefVersionCommand, options: BriefRequestOptions = {}): Promise<BriefResult<BriefEngagementValue>> { return this.command('/brief/engage', input, options); }
  pauseSearch(input: BriefVersionCommand, options: BriefRequestOptions = {}): Promise<BriefResult<BriefEngagementValue>> { return this.command('/brief/pause-search', input, options); }
  resumeSearch(input: BriefVersionCommand, options: BriefRequestOptions = {}): Promise<BriefResult<BriefEngagementValue>> { return this.command('/brief/resume-search', input, options); }
  disengage(input: BriefVersionCommand, options: BriefRequestOptions = {}): Promise<BriefResult<BriefEngagementValue>> { return this.command('/brief/disengage', input, options); }

  changeAfterDecline(input: BriefDeclineChangeInput, options: BriefRequestOptions = {}): Promise<BriefResult<BriefCurrentValue>> {
    return validDeclineChange(input) && !carriesAuthority(input)
      ? this.post('/brief/change-after-decline', input, currentValue, options)
      : Promise.resolve(invalidRequest);
  }

  private command(path: string, input: BriefVersionCommand, options: BriefRequestOptions): Promise<BriefResult<BriefEngagementValue>> {
    return versionCommand(input) && !carriesAuthority(input) ? this.post(path, input, engagementValue, options) : Promise.resolve(invalidRequest);
  }

  private async read<T>(path: string, validate: (value: unknown) => value is T, options: BriefRequestOptions): Promise<BriefResult<T>> {
    return this.call(path, undefined, validate, options);
  }

  private async post<T>(path: string, input: object, validate: (value: unknown) => value is T, options: BriefRequestOptions): Promise<BriefResult<T>> {
    if (!validObjectPayload(input)) return invalidRequest;
    return this.call(path, input, validate, options);
  }

  private async call<T>(path: string, input: object | undefined, validate: (value: unknown) => value is T, options: BriefRequestOptions): Promise<BriefResult<T>> {
    const cancelled = () => {
      if (options.signal?.aborted) return true;
      if (options.expectedContextKey === undefined) return false;
      const state = this.auth.state();
      return state.status !== 'ready' || JSON.stringify([state.context.subject, state.context.environmentId, state.context.runId, state.context.employeeId]) !== options.expectedContextKey;
    };
    if (cancelled()) return unavailable('brief-cancelled');
    let token: string | null;
    try { token = await this.auth.getAccessToken(); } catch { return AUTH_REQUIRED; }
    if (cancelled()) return unavailable('brief-cancelled');
    if (!token || /\s/.test(token)) return AUTH_REQUIRED;

    let config;
    try { config = await this.runtime.load(); } catch { return unavailable('brief-config-unavailable'); }

    if (cancelled()) return unavailable('brief-cancelled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(`${config.apiBaseUrl}${path}`, {
        method: input === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      let body: unknown;
      try { body = await response.json(); } catch { body = undefined; }

      if (response.status === 401) {
        const failure = parseFailure(body);
        return failure?.status === 'unauthenticated' || failure?.status === 'access-required' ? failure : AUTH_REQUIRED;
      }
      if (response.status === 403) return parseFailure(body) ?? { status: 'denied', code: 'access-denied', retryable: false };
      const failure = parseFailure(body);
      if (response.status === 202) return failure?.status === 'pending' ? failure : unavailable('invalid-brief-response');
      if (failure) return failure;
      if (response.status !== 200 || !object(body) || body['status'] !== 'ok' || !Object.hasOwn(body, 'value') || !validate(body['value'])
        || body['contractVersion'] !== undefined && !text(body['contractVersion'])) {
        return unavailable('invalid-brief-response');
      }
      return { status: 'ok', value: body['value'], ...(body['contractVersion'] === undefined ? {} : { contractVersion: body['contractVersion'] as string }) };
    } catch {
      return unavailable('brief-unavailable');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
