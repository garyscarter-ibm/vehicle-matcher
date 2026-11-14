export type ActivityState = 'no-brief' | 'paused' | 'offer' | 'offer-closed' | 'searching' | 'never-searched';
export type ActivitySourceStatus = 'not-checked' | 'evidence-unavailable' | 'unavailable' | 'delayed' | 'ok';
export type ActivityOfferState = 'active' | 'decision-pending' | 'release-pending' | 'accepted' | 'rejected' | 'declined' | 'expired';
export type ActivityOfferDisplayState = ActivityOfferState | 'unavailable';
export type ActivityOperation = 'engage' | 'disengage' | 'pause-search' | 'resume-search';
export type ActivityFailureStatus = 'authentication-required' | 'forbidden' | 'conflict' | 'stale-version' | 'stale-run'
  | 'pending' | 'uncertain' | 'unsupported' | 'unavailable' | 'refused' | 'invalid' | 'not-found' | 'aborted';

export interface ActivityPermission {
  readonly searchConsent: boolean;
  readonly holdConsent: boolean;
  readonly paused: boolean;
  readonly permissionVersion: number;
  readonly canSearch: boolean;
  readonly canHold: boolean;
}

export interface ActivityRequirement {
  readonly operator?: string | number | boolean;
  readonly unit?: string | number | boolean;
  readonly value?: string | number | boolean | readonly string[];
}

export interface ActivityExclusion {
  readonly essential: string;
  readonly requirement: ActivityRequirement;
  readonly cars: number;
}

export interface ActivityCheck {
  readonly checkedAt: string;
  readonly clockVersion?: string;
  readonly carsChecked: number;
  readonly suitableCars: number;
  readonly exclusions: readonly ActivityExclusion[];
  readonly outcome: 'offer-held' | 'no-match';
  readonly limitation?: 'renewal-deadline-unknown';
}

export interface ActivityOffer {
  readonly offerRef: { readonly offerId: string };
  /** Source state is retained verbatim, including future states. */
  readonly state: string;
  /** Unknown source states remain unavailable and are never treated as active. */
  readonly displayState: ActivityOfferDisplayState;
  readonly version: number;
  readonly briefVersion: number | null;
  readonly createdAt?: string;
  readonly holdId?: string | null;
  readonly orderUuid?: string | null;
  readonly policyVersion?: string | null;
  readonly quoteId?: string | null;
  readonly expiresAt?: string | null;
  readonly href?: string;
}

export interface ActivityStateChange {
  readonly eventId: string;
  readonly eventType: 'brief-changed';
  readonly operation: 'confirmed' | 'paused' | 'resumed' | 'changed-after-decline' | 'engaged' | 'disengaged' | 'preferences-updated';
  readonly briefVersion: number;
  readonly previousBriefVersion: number | null;
  readonly occurredAt: string;
}

export interface ActivityProjection {
  readonly runId: string;
  readonly employeeId: string;
  readonly asOf: string;
  readonly clockVersion: string;
  readonly briefVersion: number | null;
  readonly permission: ActivityPermission | null;
  readonly state: ActivityState;
  readonly lastSuccessfulCheck: ActivityCheck | null;
  readonly searchEvidence: { readonly status: 'recorded'; readonly checks: number }
    | { readonly status: 'not-recorded'; readonly reason: 'no-search-check-yet' };
  readonly sourceStatus: ActivitySourceStatus;
  readonly currentOffer: ActivityOffer | null;
  readonly offers: readonly ActivityOffer[];
  readonly stateChanges: readonly ActivityStateChange[];
  readonly stateChangesEvidence: { readonly status: 'incomplete' | 'recorded' | 'not-recorded'; readonly rejectedReceipts: number };
}

export interface ActivityDisplayImage {
  readonly src: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly fidelity?: string;
  readonly kind?: string;
  readonly sourceRef?: string;
  readonly viewpoint?: string;
  readonly label?: string;
}

export interface ActivityOfferDisplay {
  readonly offerRef: { readonly offerId: string };
  readonly title: string;
  readonly images: readonly ActivityDisplayImage[];
}

export interface ActivityControlVersions {
  readonly briefVersion: number;
  readonly draftVersion: number;
}

export interface ActivityCommandInput {
  readonly commandId: string;
  readonly expectedBriefVersion: number;
  readonly expectedDraftVersion: number;
}

export interface ActivityCommandReceipt {
  readonly briefVersion?: number;
  readonly draftVersion?: number;
  readonly version?: number;
  readonly changed?: boolean;
  readonly operationId?: string;
  readonly action?: string;
  readonly current?: Readonly<Record<string, string | number | boolean | null>>;
  readonly reasons?: readonly { readonly field?: string; readonly code?: string; readonly reason?: string }[];
}

export interface ActivityFailure {
  readonly status: ActivityFailureStatus;
  readonly code?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
  readonly operationId?: string;
  readonly httpStatus?: number;
  readonly current?: Readonly<Record<string, string | number | boolean | null>>;
  readonly currentVersion?: number | string;
  readonly expectedVersion?: number | string;
  readonly action?: string;
  readonly reasons?: readonly { readonly field?: string; readonly code?: string; readonly reason?: string }[];
}

export type ActivityResult<T> = { readonly status: 'ok'; readonly value: T } | ActivityFailure;
export interface ActivityRequestOptions { readonly signal?: AbortSignal }
