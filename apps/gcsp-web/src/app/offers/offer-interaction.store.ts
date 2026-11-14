import { computed, DestroyRef, effect, inject, Injectable, InjectionToken, signal, untracked } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { OfferClient } from './offer.client';
import { OfferStore } from './offer.store';
import {
  OfferDecisionInput, OfferDecisionKind, OfferDecisionReceipt, OfferDeclineReason, OfferFailure,
  OfferFollowupConfirmInput, OfferFollowupQuestion, OfferFollowupValue, OfferJsonValue, OfferProjection, OfferResult,
} from './offer.types';

export const OFFER_COMMAND_ID = new InjectionToken<() => string>('offer command ID', {
  providedIn: 'root', factory: () => () => globalThis.crypto.randomUUID(),
});

interface Resource { readonly offer: OfferProjection; readonly scope: string }
type Lane = 'reasons' | 'decision' | 'followup';
interface Request { readonly resource: Resource; readonly controller: AbortController }
interface FollowupState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'saving' | 'failed' | 'uncertain';
  readonly value: OfferFollowupValue | null;
  readonly answer: OfferJsonValue;
  readonly error: string;
  readonly failure?: OfferFailure;
}
interface InteractionState {
  readonly review: OfferDecisionKind | null;
  readonly declarations: Readonly<Record<string, boolean>>;
  readonly mileage: string;
  readonly error: string;
  readonly reasons: { readonly phase: 'idle' | 'loading' | 'ready' | 'failed'; readonly choices: readonly OfferDeclineReason[]; readonly selected: string };
  readonly decision: 'sending' | OfferResult<OfferDecisionReceipt> | null;
  readonly followup: FollowupState;
}
const empty = (): InteractionState => ({ review: null, declarations: {}, mileage: '', error: '',
  reasons: { phase: 'idle', choices: [], selected: '' }, decision: null,
  followup: { phase: 'idle', value: null, answer: null, error: '' } });
const unavailable: OfferFailure = { status: 'unavailable', code: 'offer-unavailable', retryable: true };

export function followupStart(question: OfferFollowupQuestion['question']): OfferJsonValue {
  if (question.currentValue !== null) return question.control.kind === 'options' && Array.isArray(question.currentValue)
    ? null : structuredClone(question.currentValue);
  return question.control.kind === 'slider' ? Math.round((question.control.minimum + question.control.maximum) / 2)
    : question.control.kind === 'equipment' ? [] : null;
}

export function followupError(question: OfferFollowupQuestion['question'], value: OfferJsonValue): string {
  const control = question.control;
  if (control.kind === 'options' && !control.options.some((option) => option.value === value)) return 'Choose one of the options.';
  if (control.kind === 'slider' && (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < control.minimum || value > control.maximum)) return `Choose a whole number from ${control.minimum} to ${control.maximum}.`;
  if (control.kind === 'equipment') {
    if (!Array.isArray(value) || value.length > control.maximumItems || value.some((item) => typeof item !== 'string'
      || !item.trim() || item !== item.trim() || item.length > control.maximumItemLength)
      || new Set(value).size !== value.length) return 'Use unique equipment names within the displayed limits.';
    if (question.currentValue === null && value.length === 0) return 'Add at least one equipment name.';
  }
  const same = control.kind === 'options'
    ? JSON.stringify([value].flat()) === JSON.stringify([question.currentValue].flat())
    : Array.isArray(value) && Array.isArray(question.currentValue)
      ? JSON.stringify([...value].sort()) === JSON.stringify([...question.currentValue].sort())
      : value === question.currentValue;
  return question.currentValue !== null && same ? 'Choose a different value before confirming.' : '';
}

/** Offer-local commands only. Reads can reconcile an outcome; they never replay a POST. */
@Injectable()
export class OfferInteractionStore {
  private readonly offers = inject(OfferStore);
  private readonly auth = inject(AuthPort);
  private readonly client = inject(OfferClient);
  private readonly commandId = inject(OFFER_COMMAND_ID);
  private readonly resource = computed<Resource | null>(() => {
    const state = this.offers.state();
    const auth = this.auth.state();
    if (state.status !== 'ready' || auth.status !== 'ready' || !auth.context.roles.includes('employee')
      || auth.context.roles.includes('presenter') || auth.context.runId !== state.offer.runId
      || ![auth.context.subject, auth.context.environmentId, auth.context.runId, auth.context.employeeId]
        .every((value) => typeof value === 'string' && value.trim())) return null;
    return { offer: state.offer, scope: JSON.stringify([auth.context.subject, auth.context.environmentId, auth.context.runId, auth.context.employeeId]) };
  }, { equal: (a, b) => a === b || a !== null && b !== null && a.offer === b.offer && a.scope === b.scope });
  private readonly snapshot = signal<{ readonly resource: Resource; readonly value: InteractionState } | null>(null);
  private readonly requests = new Map<Lane, Request>();
  private pendingFollowup: { readonly resource: Resource; readonly input: OfferFollowupConfirmInput } | null = null;
  private destroyed = false;

  readonly state = computed<InteractionState>(() => {
    const source = this.resource(); const snapshot = this.snapshot();
    return source && snapshot?.resource === source ? snapshot.value : empty();
  });
  readonly offer = computed<OfferProjection | null>(() => {
    const source = this.resource(); if (!source) return null;
    const decision = this.state().decision;
    if (!decision || decision === 'sending' || decision.status !== 'ok') return source.offer;
    const receipt = decision.value; const selection = receipt.selection;
    return { ...source.offer, state: receipt.state, reason: receipt.reason, offerState: receipt.offerState,
      holdState: receipt.holdState, offerVersion: receipt.offerVersion, holdVersion: receipt.holdVersion,
      serverNow: receipt.serverNow, expiresAt: receipt.expiresAt, clockVersion: receipt.clockVersion,
      availableActions: receipt.availableActions, handoff: null,
      followup: receipt.state === 'declined' ? { decisionId: receipt.decisionId } : null,
      selection: selection ? { ...selection.progress, orderReference: selection.orderReference,
        orderNumber: selection.order?.orderNumber ?? null } : null };
  });
  readonly actionable = computed(() => {
    const offer = this.offer();
    return !!offer && offer.state === 'pending' && !this.state().decision
      && !['decision-pending', 'release-pending'].includes(offer.reason)
      && Date.parse(offer.expiresAt) > Date.parse(offer.serverNow);
  });
  readonly canReviewAccept = computed(() => this.actionable() && !!this.offer()?.handoff && this.offer()!.availableActions.includes('accept'));
  readonly canDecline = computed(() => this.actionable() && this.offer()!.availableActions.includes('decline'));
  readonly mileageError = computed(() => {
    const handoff = this.offer()?.handoff; const value = this.state().mileage;
    if (handoff?.mode !== 'replacement') return '';
    const maximum = handoff.returnMileage?.maximum;
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && maximum !== undefined && Number(value) <= maximum
      ? '' : maximum === undefined ? 'Return mileage requirements are unavailable. Check the offer again.'
        : `Enter a whole mileage from 0 to ${maximum.toLocaleString('en-GB')} miles.`;
  });
  readonly canAccept = computed(() => {
    const handoff = this.offer()?.handoff;
    return this.canReviewAccept() && this.state().review === 'accept' && !!handoff && !handoff.blocker
      && !!handoff.termsDigest && !!handoff.driver?.name && !!handoff.driver.licence?.displayNumber
      && handoff.declarations.length > 0 && handoff.declarations.every(({ id }) => this.state().declarations[id] === true)
      && !this.mileageError();
  });
  readonly canConfirmFollowup = computed(() => {
    const next = this.state().followup;
    return next.phase === 'ready' && next.value?.state === 'question' && !this.pendingFollowup
      && !followupError(next.value.question, next.answer) && !next.error;
  });

  constructor() {
    effect(() => { this.resource(); untracked(() => this.current()); });
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.cancel(); this.snapshot.set(null); });
  }

  review(kind: OfferDecisionKind): void {
    const source = this.current();
    if (!source || !(kind === 'accept' ? this.canReviewAccept() : this.canDecline())) return;
    this.requests.get('reasons')?.controller.abort(); this.requests.delete('reasons');
    this.update(source, (state) => ({ ...state, review: kind, declarations: {}, mileage: '', error: '',
      reasons: { phase: 'idle', choices: [], selected: '' } }));
    if (kind === 'decline') void this.refreshReasons();
  }
  closeReview(): void {
    const source = this.current(); if (!source || this.state().decision === 'sending') return;
    this.requests.get('reasons')?.controller.abort(); this.requests.delete('reasons');
    this.update(source, (state) => ({ ...state, review: null, declarations: {}, mileage: '', error: '',
      reasons: { phase: 'idle', choices: [], selected: '' } }));
  }
  tick(id: string, checked: boolean): void {
    const source = this.current(); if (!source || !this.canReviewAccept() || this.state().review !== 'accept'
      || !source.offer.handoff?.declarations.some((row) => row.id === id)) return;
    this.update(source, (state) => ({ ...state, declarations: { ...state.declarations, [id]: checked === true }, error: '' }));
  }
  setMileage(value: string): void {
    const source = this.current(); if (!source || !this.canReviewAccept() || this.state().review !== 'accept'
      || source.offer.handoff?.mode !== 'replacement' || value.length > 16) return;
    this.update(source, (state) => ({ ...state, mileage: value, declarations: {}, error: '' }));
  }
  selectReason(code: string): void {
    const source = this.current(); if (!source || !this.canDecline() || this.state().review !== 'decline'
      || this.state().reasons.phase !== 'ready') return;
    const valid = this.state().reasons.choices.some((row) => row.code === code);
    this.update(source, (state) => ({ ...state, reasons: { ...state.reasons, selected: valid ? code : '' },
      error: valid ? '' : 'Choose a reason from the current list.' }));
  }
  async refreshReasons(): Promise<void> {
    const source = this.current(); if (!source || !this.canDecline() || this.state().review !== 'decline') return;
    const request = this.begin(source, 'reasons');
    this.update(source, (state) => ({ ...state, error: '', reasons: { phase: 'loading', choices: [], selected: '' } }));
    const result = await this.call(() => this.client.readDecisionReasons(source.offer.offerId, source.offer.runId, this.options(request)));
    if (!this.finish(request, 'reasons')) return;
    this.update(source, (state) => ({ ...state, reasons: result.status === 'ok'
      ? { phase: 'ready', choices: result.value.reasons, selected: '' } : { phase: 'failed', choices: [], selected: '' } }));
  }
  async submitDecision(): Promise<void> {
    const source = this.current(); if (!source) return;
    const state = this.state(); const kind = state.review;
    if (!kind || !(kind === 'accept' ? this.canAccept() : this.canDecline() && state.reasons.phase === 'ready'
      && state.reasons.choices.some((row) => row.code === state.reasons.selected))) {
      this.update(source, (value) => ({ ...value, error: kind === 'decline' ? 'Choose a reason.' : 'Review the details and declarations before accepting.' })); return;
    }
    let commandId: string;
    try { commandId = this.commandId(); } catch { return; }
    const offer = source.offer;
    const base = { commandId, offerId: offer.offerId, runId: offer.runId, expectedOfferVersion: offer.offerVersion,
      expectedHoldVersion: offer.holdVersion, expectedQuoteVersion: offer.quote.revisions.quote };
    const input: OfferDecisionInput = kind === 'decline' ? Object.freeze({ ...base, decision: 'decline', reasonCode: state.reasons.selected })
      : Object.freeze({ ...base, decision: 'accept', termsDigest: offer.handoff!.termsDigest!,
        declarations: Object.freeze(Object.fromEntries(offer.handoff!.declarations.map(({ id }) => [id, true as const]))),
        ...(offer.handoff!.mode === 'replacement' ? { expectedReturnMileage: Number(state.mileage) } : {}) });
    this.requests.get('reasons')?.controller.abort(); this.requests.delete('reasons');
    const request = this.begin(source, 'decision');
    this.update(source, (value) => ({ ...value, decision: 'sending', error: '' }));
    const result = await this.call(() => this.client.decide(input, this.options(request)));
    if (!this.finish(request, 'decision')) return;
    this.update(source, (value) => ({ ...value, decision: result, review: null, declarations: {}, mileage: '',
      reasons: { phase: 'idle', choices: [], selected: '' } }));
    if (result.status === 'ok' && result.value.state === 'declined') await this.refreshFollowup();
  }
  checkCurrent(): void { if (!this.destroyed && this.state().decision !== 'sending') this.offers.refresh(); }

  async refreshFollowup(): Promise<void> {
    const source = this.current(); const decisionId = this.offer()?.followup?.decisionId;
    if (!source || !decisionId || ['loading', 'saving'].includes(this.state().followup.phase)) return;
    const request = this.begin(source, 'followup');
    this.update(source, (state) => ({ ...state, followup: { ...state.followup, phase: 'loading', error: '' } }));
    const result = await this.call(() => this.client.readFollowup(decisionId, this.options(request)));
    if (!this.finish(request, 'followup')) return;
    this.receiveFollowup(source, result);
  }
  chooseAnswer(value: OfferJsonValue): void {
    const source = this.current(); const next = this.state().followup;
    if (!source || next.phase !== 'ready' || next.value?.state !== 'question' || this.pendingFollowup) return;
    const question = next.value.question;
    this.update(source, (state) => ({ ...state, followup: { ...next, answer: structuredClone(value), error: followupError(question, value) } }));
  }
  async confirmFollowup(): Promise<void> {
    const source = this.current(); const next = this.state().followup;
    if (!source || ['saving', 'loading'].includes(next.phase)) return;
    if (!this.pendingFollowup) {
      if (!this.canConfirmFollowup() || next.value?.state !== 'question') return;
      let commandId: string; try { commandId = this.commandId(); } catch { return; }
      this.pendingFollowup = { resource: source, input: { commandId, decisionId: next.value.decisionId,
        expectedBriefVersion: next.value.briefVersion, questionVersion: next.value.question.questionVersion,
        value: structuredClone(next.answer) } };
    } else if (this.pendingFollowup.resource !== source || next.phase !== 'uncertain') return;
    const request = this.begin(source, 'followup'); const input = structuredClone(this.pendingFollowup.input);
    this.update(source, (state) => ({ ...state, followup: { ...state.followup, phase: 'saving', error: '' } }));
    const result = await this.call(() => this.client.confirmFollowup(input, this.options(request)));
    if (!this.finish(request, 'followup')) return;
    if (result.status === 'invalid') {
      this.pendingFollowup = null;
      this.update(source, (state) => ({ ...state, followup: { ...state.followup,
        phase: state.followup.value?.state === 'question' ? 'ready' : 'failed', failure: result,
        error: 'Review your answer before confirming again.' } }));
    } else this.receiveFollowup(source, result);
  }

  private receiveFollowup(source: Resource, result: OfferResult<OfferFollowupValue>): void {
    const prior = this.state().followup;
    if (result.status === 'ok') {
      if (result.value.state === 'question' && this.pendingFollowup) {
        this.update(source, (state) => ({ ...state, followup: { ...prior, phase: 'uncertain', error: '' } })); return;
      }
      this.pendingFollowup = null;
      const value = result.value;
      this.update(source, (state) => ({ ...state, followup: { phase: 'ready', value,
        answer: value.state === 'question' ? followupStart(value.question) : null, error: '' } }));
    } else {
      const uncertain = this.pendingFollowup !== null && ['unavailable', 'pending'].includes(result.status) && !result.savedChange;
      if (!uncertain) this.pendingFollowup = null;
      this.update(source, (state) => ({ ...state, followup: { phase: uncertain ? 'uncertain' : 'failed', answer: null, error: '',
        value: ['unauthenticated', 'forbidden', 'denied', 'stale-run'].includes(result.status) ? null : result.savedChange
          ?? (prior.value && prior.value.state !== 'question' ? prior.value : null), failure: result } }));
    }
  }
  private current(): Resource | null {
    if (this.destroyed) return null;
    const source = this.resource();
    if (this.snapshot()?.resource !== source) {
      this.cancel(); this.snapshot.set(source ? { resource: source, value: empty() } : null);
      if (source?.offer.state === 'declined' && source.offer.followup) void this.refreshFollowup();
    }
    return source;
  }
  private update(source: Resource, change: (value: InteractionState) => InteractionState): void {
    if (!this.destroyed && this.resource() === source && this.snapshot()?.resource === source)
      this.snapshot.update((snapshot) => ({ resource: source, value: change(snapshot!.value) }));
  }
  private begin(resource: Resource, lane: Lane): Request {
    this.requests.get(lane)?.controller.abort();
    const request = { resource, controller: new AbortController() }; this.requests.set(lane, request); return request;
  }
  private finish(request: Request, lane: Lane): boolean {
    if (this.destroyed || this.resource() !== request.resource || this.requests.get(lane) !== request || request.controller.signal.aborted) return false;
    this.requests.delete(lane); return true;
  }
  private options(request: Request) { return { signal: request.controller.signal, expectedContextKey: request.resource.scope }; }
  private async call<T>(action: () => Promise<OfferResult<T>>): Promise<OfferResult<T>> { try { return await action(); } catch { return unavailable; } }
  private cancel(): void { for (const request of this.requests.values()) request.controller.abort(); this.requests.clear(); this.pendingFollowup = null; }
}
