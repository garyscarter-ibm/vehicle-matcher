export type OfferScalar = string | number | boolean | null;
export type OfferSimpleValue = OfferScalar | readonly OfferScalar[];
export type OfferState = 'pending' | 'accepted' | 'declined' | 'expired' | 'superseded';
export type OfferDecisionKind = 'accept' | 'decline';

export interface OfferRequestOptions {
  readonly signal?: AbortSignal;
  readonly expectedContextKey?: string;
}

export interface OfferProvenance {
  readonly sourceRef: string;
  readonly observedAt: string;
  readonly version: string;
  readonly assurance: 'unknown' | 'confirmed-listing' | 'confirmed-build' | 'model-reference' | 'derived' | 'synthetic-scenario';
}

export interface OfferFact {
  readonly status: 'known' | 'unknown';
  readonly value: OfferSimpleValue;
  readonly unit: string | null;
  readonly provenance: OfferProvenance;
}

export interface OfferImage {
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fidelity?: string;
  readonly sourceRef?: string;
  readonly viewpoint?: string;
  readonly label?: string;
}

export interface OfferVehicleSnapshot {
  readonly contractVersion: 'vehicle-snapshot-v1';
  readonly identityKind: 'exact-stock';
  readonly candidateKey: string;
  readonly sourceNamespace: string;
  readonly snapshotVersion: string;
  readonly observedAt: string;
  readonly sourceKeys: { readonly stockId: string };
  readonly display: {
    readonly name: string;
    readonly photo: string | null;
    readonly images: readonly OfferImage[];
    readonly manufacturer?: string;
    readonly model?: string;
    readonly derivative?: string;
    readonly colour?: string;
  };
  readonly facts: Readonly<Record<string, OfferFact>>;
}

export interface OfferExplanationRequirement {
  readonly value?: OfferSimpleValue;
  readonly operator?: OfferSimpleValue;
  readonly unit?: OfferSimpleValue;
}

export type OfferExplanation = string | {
  readonly [key: string]: OfferSimpleValue | Readonly<Record<string, OfferFact>> | OfferFact | OfferExplanationRequirement | undefined;
  readonly fact?: OfferFact;
  readonly facts?: OfferSimpleValue | Readonly<Record<string, OfferFact>>;
  readonly requirement?: OfferExplanationRequirement;
};

export interface OfferEvaluation {
  readonly gateStatus: 'eligible' | 'ineligible' | 'needs-confirmation';
  readonly score: number | null;
  readonly reasons: readonly OfferExplanation[];
  readonly tradeOffs: readonly OfferExplanation[];
  readonly blockers: readonly OfferExplanation[];
  readonly unknowns: readonly OfferExplanation[];
}

export interface OfferPointAmount {
  readonly value: number;
  readonly unit: 'points';
}

export interface OfferTerms {
  readonly kind: 'employee-scheme';
  readonly termsVersion: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly points: OfferPointAmount;
  readonly allowanceInputs: { readonly allowance?: OfferPointAmount };
  readonly provenance: OfferProvenance;
  readonly contribution?: { readonly amount: number; readonly currency: string; readonly period: 'month' | 'year' | 'one-off' } | null;
}

export interface OfferCurrentCarComparison {
  readonly status: 'unavailable' | 'partial' | 'available';
  readonly reason: string;
  readonly comparisonAvailable: boolean;
  readonly currentCar: null | {
    readonly model: string;
    readonly source: { readonly mode: 'synthetic' | 'dated-snapshot' | 'authorised-live'; readonly sourceVersion: string; readonly observedAt: string };
    readonly facts?: Readonly<Record<string, { readonly value: string | number; readonly unit: string | null }>>;
  };
  readonly unknowns: readonly string[];
}

export interface OfferHandoff {
  readonly termsVersion: string | null;
  readonly termsDigest: string | null;
  readonly wording: string | null;
  readonly fictional: true;
  readonly mode: 'new' | 'replacement';
  readonly blocker: 'contact-required' | 'driver-review-required' | 'return-data-required' | 'ordering-terms-unavailable' | null;
  readonly driver: null | {
    readonly name: string | null;
    readonly kind: string | null;
    readonly licence: null | {
      readonly displayNumber: string | null;
      readonly categories: readonly string[];
      readonly validFrom: string | null;
      readonly validUntil: string | null;
    };
  };
  readonly returnMileage: null | { readonly maximum: number; readonly unit: 'mi' };
  readonly documentSource: null | { readonly terms: 'ordering.terms.v1' | null; readonly termsVersion: string | null; readonly recordSource: string | null };
  readonly declarations: readonly { readonly id: string; readonly label: string }[];
  readonly contact: null | { readonly phone: string; readonly email: string };
  readonly returnCar: null | {
    readonly model: string | null;
    readonly contractEndDate: string | null;
    readonly currentOdometer: null | { readonly value: number; readonly unit: string };
    readonly expectedReturnMileage: null;
  };
}

export interface OfferSelection {
  readonly schemaVersion: 1;
  readonly selectionState: 'acknowledged' | 'handoff-pending' | 'handoff-failed';
  readonly approved: false;
  readonly current: string;
  readonly orderReference: string | null;
  readonly orderNumber: string | null;
  readonly stages: readonly { readonly name: string; readonly state: 'complete' | 'waiting' | 'not-started' | 'pending' | 'failed' }[];
}

export interface OfferProjection {
  readonly schemaVersion: 1;
  readonly offerId: string;
  readonly runId: string;
  readonly state: OfferState;
  readonly reason: string;
  readonly serverNow: string;
  readonly clockVersion: string;
  readonly expiresAt: string;
  readonly offerVersion: number;
  readonly holdVersion: number;
  readonly offerState: string;
  readonly holdState: string;
  readonly availableActions: readonly OfferDecisionKind[];
  readonly followup: null | { readonly decisionId: string };
  readonly handoff: OfferHandoff | null;
  readonly selection: OfferSelection | null;
  readonly quote: {
    readonly quoteId: string;
    readonly configurationId: string;
    readonly orderUuid: string;
    readonly orderNumber: string | null;
    readonly briefVersion: number;
    readonly policyVersion: string;
    readonly quotedAt: string;
    readonly validUntil: string;
    readonly revisions: Readonly<Record<string, string | number>> & { readonly quote: number };
    readonly facts: OfferVehicleSnapshot;
    readonly decision: OfferEvaluation;
    readonly terms: OfferTerms;
    readonly allowance: { readonly allowance?: OfferPointAmount };
  };
  readonly comparison: OfferCurrentCarComparison;
}

export interface OfferDeclineReason {
  readonly code: string;
  readonly label: string;
  readonly attribute: string;
}

export interface OfferDeclineReasons {
  readonly schemaVersion: 1;
  readonly key: 'offer.declineReasons.v1';
  readonly policyVersion: string;
  readonly reasons: readonly OfferDeclineReason[];
  readonly provenance: { readonly status: string; readonly basis: string; readonly source: string; readonly sourceDate: string };
}

export interface OfferDecisionSelector {
  readonly offerId: string;
  readonly runId: string;
}

interface OfferDecisionBase extends OfferDecisionSelector {
  readonly commandId: string;
  readonly expectedOfferVersion: number;
  readonly expectedHoldVersion: number;
  readonly expectedQuoteVersion: number;
  readonly expectedReturnMileage?: number;
}

export type OfferDecisionInput = OfferDecisionBase & (
  | { readonly decision: 'accept'; readonly termsDigest: string; readonly declarations: Readonly<Record<string, true>>; readonly reasonCode?: never }
  | { readonly decision: 'decline'; readonly reasonCode: string; readonly termsDigest?: never; readonly declarations?: never; readonly expectedReturnMileage?: never }
);

export type OfferSelectionProgress = Omit<OfferSelection, 'orderReference' | 'orderNumber'>;

// Command acknowledgement carries ordering progress; it does not establish downstream approval.
export interface OfferCommandHandoff {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly operationState: 'allocation-pending' | 'handoff-pending' | 'unknown' | 'acknowledged' | 'allocation-failed' | 'handoff-failed';
  readonly selectionReceived: true;
  readonly orderReference: string | null;
  readonly selection: {
    readonly schemaVersion: 1;
    readonly orderReference: string | null;
    readonly receivedAt: string;
    readonly source: { readonly type: 'buddy-offer'; readonly holdId: string; readonly expectedHoldVersion: number; readonly expectedDraftVersion: number };
    readonly quote: { readonly quoteId: string; readonly orderUuid: string; readonly configurationId: string; readonly briefVersion: number; readonly policyVersion: string; readonly version: number };
    readonly stock: { readonly orderUuid: string; readonly orderNumber: string; readonly configurationId: string };
    readonly terms: { readonly termsVersion: string; readonly policyVersion: string; readonly approvalStages: readonly string[] };
  };
  readonly progress: OfferSelectionProgress;
  readonly order: null | { readonly status: 'confirmed'; readonly operationId: string; readonly runId: string; readonly orderUuid: string;
    readonly configurationId: string; readonly orderNumber: string; readonly orderStatus: string; readonly fictional?: boolean };
  readonly failure: null | { readonly status?: string; readonly reason?: string; readonly operationId?: string; readonly runId?: string;
    readonly orderUuid?: string; readonly fictional?: boolean };
  readonly view: { readonly state: 'awaiting-approval' | 'handoff-pending' | 'handoff-failed'; readonly action: 'view-order' | 'check-status' | 'contact-support' };
}

export interface OfferDecisionReceipt {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly offerId: string;
  readonly commandId: string;
  readonly requestedDecision: OfferDecisionKind;
  readonly decisionId: string;
  readonly state: 'accepted' | 'declined';
  readonly reason: string;
  readonly offerState: string;
  readonly holdState: string;
  readonly offerVersion: number;
  readonly holdVersion: number;
  readonly quoteVersion: number;
  readonly quoteId: string;
  readonly policyVersion: string;
  readonly expiresAt: string;
  readonly serverNow: string;
  readonly clockVersion: string;
  readonly availableActions: readonly OfferDecisionKind[];
  readonly operationId: string | null;
  readonly reconciliationRequired: boolean;
  readonly selection?: OfferCommandHandoff | null;
}

export type OfferJsonValue = OfferScalar | readonly OfferJsonValue[] | { readonly [key: string]: OfferJsonValue };
export type OfferQuestionControl =
  | { readonly kind: 'options'; readonly options: readonly { readonly value: string; readonly label: string }[] }
  | { readonly kind: 'slider'; readonly unit: 'percent'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'equipment'; readonly maximumItems: number; readonly maximumItemLength: number };

export interface OfferFollowupQuestion {
  readonly schemaVersion: 1;
  readonly state: 'question';
  readonly decisionId: string;
  readonly briefVersion: number;
  readonly question: {
    readonly schemaVersion: 1;
    readonly reasonCode: string;
    readonly path: string;
    readonly prompt: string;
    readonly control: OfferQuestionControl;
    readonly currentValue: OfferJsonValue;
    readonly policyVersion: string;
    readonly questionVersion: string;
    readonly provenance: { readonly key: 'offer.followupQuestions.v1'; readonly status: string; readonly basis: string; readonly source: string; readonly sourceDate: string };
  };
}

export interface OfferSavedChange {
  readonly schemaVersion: 1;
  readonly state: 'change-saved';
  readonly decisionId: string;
  readonly briefVersion: number;
  readonly policyVersion: string;
  readonly event: { readonly receiptReference: string; readonly eventType: 'brief-changed'; readonly briefVersion: number; readonly occurredAt: string };
  readonly change: { readonly path: string; readonly before: OfferJsonValue; readonly after: OfferJsonValue };
}

export interface OfferFollowupRequirementFact {
  readonly status: 'known' | 'unknown';
  readonly value: OfferJsonValue;
  readonly unit: string | null;
  readonly provenance: OfferProvenance | null;
}

export type OfferFollowupRequirement = {
  readonly key: string;
  readonly value: OfferJsonValue;
  readonly previousFacts: Readonly<Record<string, OfferFollowupRequirementFact>>;
  readonly nextFacts: Readonly<Record<string, OfferFollowupRequirementFact>>;
} & ({ readonly kind: 'preference'; readonly importance: number }
  | { readonly kind: 'essential'; readonly operator: string; readonly unit: string | null });

export interface OfferFollowupComparison {
  readonly schemaVersion: 1;
  readonly currentBriefVersion: number;
  readonly requirements: readonly OfferFollowupRequirement[];
  readonly previous: OfferFollowupComparisonSide;
  readonly next: OfferFollowupComparisonSide;
}

export interface OfferFollowupComparisonSide {
  readonly offer: OfferProjection;
  readonly scoreBasis: { readonly kind: 'historical-quote'; readonly briefVersion: number; readonly policyVersion: string; readonly quotedAt: string };
}

export type OfferFollowupValue = OfferFollowupQuestion
  | OfferSavedChange
  | { readonly schemaVersion: 1; readonly state: 'waiting'; readonly decisionId: string; readonly savedChange: OfferSavedChange }
  | { readonly schemaVersion: 1; readonly state: 'no-match'; readonly decisionId: string; readonly savedChange: OfferSavedChange; readonly evaluation: { readonly evaluatedAt: string; readonly carsChecked: number; readonly suitable: 0 } }
  | { readonly schemaVersion: 1; readonly state: 'ready'; readonly decisionId: string; readonly savedChange: OfferSavedChange; readonly comparison: OfferFollowupComparison };

export type OfferFailureStatus = 'invalid' | 'unavailable' | 'stale-version' | 'conflict' | 'forbidden' | 'denied'
  | 'not-found' | 'stale-run' | 'pending' | 'unauthenticated' | 'unsupported';

export interface OfferFailure {
  readonly status: OfferFailureStatus;
  readonly code?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
  readonly operationId?: string;
  readonly operationType?: string;
  readonly runId?: string;
  readonly offerId?: string;
  readonly decisionId?: string;
  readonly commandId?: string;
  readonly reasons?: readonly { readonly field: string; readonly reason: string }[];
  readonly expectedVersion?: number;
  readonly currentVersion?: number;
  readonly current?: Readonly<Record<string, OfferJsonValue>>;
  readonly currentVersions?: Readonly<Record<string, OfferJsonValue>>;
  readonly action?: string;
  readonly resource?: string | Readonly<Record<string, OfferJsonValue>>;
  readonly resourceType?: string;
  readonly contractVersion?: string;
  readonly savedChange?: OfferSavedChange;
}

export type OfferResult<T> = { readonly status: 'ok'; readonly value: T; readonly contractVersion?: string } | OfferFailure;

export interface OfferFollowupConfirmInput {
  readonly commandId: string;
  readonly decisionId: string;
  readonly expectedBriefVersion: number;
  readonly questionVersion: string;
  readonly value: OfferJsonValue;
}
