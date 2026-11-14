export type BriefPrimitive = string | number | boolean | null;
export type BriefValue = BriefPrimitive | readonly BriefValue[] | { readonly [key: string]: BriefValue };
export type BriefPreferenceValue = string | number | boolean | readonly (string | number | boolean)[];
export type BriefValueState = 'draft' | 'inferred' | 'confirmed';

export interface EditablePreference {
  readonly value: BriefPreferenceValue;
  readonly importance: number;
  readonly valueState: BriefValueState;
  readonly importanceState: BriefValueState;
  readonly source: string;
  readonly confirmedAt?: string;
}

export interface EditableEssential {
  readonly value: BriefValue | readonly string[];
  readonly operator: string;
  readonly unit: string | null;
  readonly state: BriefValueState | 'needs-confirmation';
  readonly source: string;
  readonly confirmedAt?: string;
}

export interface CurrentCarFeedback {
  readonly preserve: readonly string[];
  readonly change: readonly string[];
  readonly state: BriefValueState;
  readonly source: string;
}

export interface CurrentCarRatingRecord {
  readonly value: number | null;
  readonly contractId: string;
  readonly source: 'employee';
  readonly ratedAt: string;
}

export interface SameAgainRecord {
  readonly on: boolean;
  readonly contractId: string;
  readonly source: 'employee';
  readonly setAt: string;
}

export interface EditableBrief {
  readonly schemaVersion: 1;
  readonly preferences: Readonly<Record<string, EditablePreference>>;
  readonly essentials: Readonly<Record<string, EditableEssential>>;
  readonly currentCarFeedback?: CurrentCarFeedback;
  readonly currentCarRating?: CurrentCarRatingRecord;
  readonly sameAgain?: SameAgainRecord;
}

export interface BriefVersioned extends EditableBrief {
  readonly briefVersion: number;
  readonly status: string;
}

export interface BriefSlider {
  readonly minimum: number;
  readonly maximum: number;
}

export interface BriefPreferenceDefinition {
  readonly type: string;
  readonly values?: readonly BriefValue[];
  readonly multiple?: boolean;
  readonly label: string;
  readonly editable: boolean;
}

export interface BriefEssentialDefinition {
  readonly type: string;
  readonly operator: string;
  readonly unit: string | null;
  readonly values?: readonly BriefValue[];
  readonly minimum?: number;
  readonly integer?: boolean;
  readonly editable: boolean;
}

export interface BriefKnownFact {
  readonly value: unknown;
  readonly source: string;
  readonly sourceVersion: unknown;
  readonly observedAt: string;
  readonly editable: false;
  readonly status?: string;
  readonly [evidence: string]: unknown;
}

export interface BriefPermission {
  readonly editable: boolean;
  readonly [evidence: string]: unknown;
}

export interface PracticalQuestion {
  readonly label: string;
  readonly yes: unknown;
  readonly no: unknown;
  readonly unknown: null;
}

export interface BriefCategoryOption {
  readonly value: BriefValue;
  readonly label: string;
}

export interface MultiPreferenceCategory {
  readonly label: string;
  readonly question: string;
  readonly kind: 'multi';
  readonly options: readonly BriefCategoryOption[];
}

export interface StopsPreferenceCategory {
  readonly label: string;
  readonly question: string;
  readonly kind: 'stops';
  readonly openDefault: number;
  readonly stops: readonly { readonly value: number; readonly label: string }[];
}

export type BriefPreferenceCategory = MultiPreferenceCategory | StopsPreferenceCategory;

export interface AccountPreferencesProjection {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly order: readonly string[];
  readonly minimumCategories: number;
  readonly importance: { readonly medium: number; readonly high: number };
  readonly categories: Readonly<Record<string, BriefPreferenceCategory>>;
  readonly understanding: {
    readonly kind: 'input-completeness';
    readonly maximum: number;
    readonly byConsidered: readonly number[];
    readonly sameAgain: number;
    readonly policyKey: string;
  };
}

export type AccountPreferenceCategoryState =
  | { readonly state: 'unset' }
  | { readonly state: 'considered'; readonly value: BriefValue; readonly importance: 'medium' | 'high'; readonly exact: boolean };

export interface AccountPreferencesState {
  readonly considered: number;
  readonly categories: Readonly<Record<string, AccountPreferenceCategoryState>>;
  readonly sameAgain: boolean;
  readonly understanding: {
    readonly kind: 'input-completeness';
    readonly value: number;
    readonly maximum: number;
    readonly basis: string;
    readonly considered: number;
    readonly policyKey: string;
    readonly policyVersion: string;
  };
}

export interface CurrentCarRatingView {
  readonly value: number | null;
  readonly contractId: string;
}

export interface SameAgainView {
  readonly available: boolean;
  readonly on: boolean;
  readonly contractId: string | null;
  readonly reason?: 'no-current-car' | 'current-car-unidentified';
}

export interface BuddyView {
  readonly state: 'engaged' | 'disengaged';
  readonly reason: 'paused' | 'minimum-lost' | null;
  readonly permissionVersion: number | null;
  readonly minimumCategories: number;
  readonly considered: number;
  readonly remaining: number;
  readonly sameAgain: boolean;
  readonly canEngage: boolean;
}

export interface BuddyConsent {
  readonly search: boolean;
  readonly hold: boolean;
}

export interface BriefEditorContext {
  readonly preferences: Readonly<Record<string, BriefPreferenceDefinition>>;
  readonly essentials: Readonly<Record<string, BriefEssentialDefinition>>;
  readonly slider: BriefSlider;
  readonly knownFacts: Readonly<Record<string, BriefKnownFact>>;
  readonly permissions: Readonly<Record<string, BriefPermission>>;
  readonly policyVersion: string;
  readonly contextVersion: string;
  readonly practicalQuestions: Readonly<Record<string, PracticalQuestion>>;
  readonly unconfirmedLabel: string;
  readonly assumptions: readonly Readonly<Record<string, unknown>>[];
  readonly accountPreferences: AccountPreferencesProjection;
}

export interface BriefEditorInitial {
  readonly brief: EditableBrief;
  readonly briefVersion: number;
  readonly draftVersion: number;
  readonly accountPreferences: AccountPreferencesState;
  readonly currentCarRating: CurrentCarRatingView | null;
  readonly sameAgain: SameAgainView;
  readonly buddy: BuddyView;
  readonly consent: BuddyConsent;
}

export interface BriefEditorVersions {
  readonly policy: string;
  readonly context: string;
  readonly facts: string;
  readonly clock: string;
}

export interface BriefEditor {
  readonly context: BriefEditorContext;
  readonly initial: BriefEditorInitial;
  readonly versions: BriefEditorVersions;
  readonly selection?: { readonly state: 'accepted'; readonly briefVersion: number } | null;
  readonly provenance?: {
    readonly initial: 'saved-draft' | 'approved-brief' | 'unconfirmed-policy-defaults';
    readonly approvedBriefVersion: number | null;
  };
  readonly [evidence: string]: unknown;
}

export interface BriefDeclineChange {
  readonly path: string;
  readonly value: BriefValue;
}

export interface BriefFailure {
  readonly status: 'invalid' | 'unavailable' | 'stale-version' | 'conflict' | 'forbidden' | 'not-found'
    | 'stale-run' | 'pending' | 'unauthenticated' | 'access-required' | 'denied';
  readonly code?: string;
  readonly reason?: string;
  readonly reasons?: unknown;
  readonly retryable?: boolean;
  readonly resource?: string | BriefResourceReference;
  readonly resourceType?: string;
  readonly expectedVersion?: number;
  readonly currentVersion?: number;
  readonly currentBriefVersion?: number;
  readonly currentDraftVersion?: number;
  readonly currentVersions?: Readonly<Record<string, unknown>>;
  readonly current?: Readonly<Record<string, unknown>>;
  readonly action?: string;
  readonly operationId?: string;
  readonly contractVersion?: string;
}

export interface BriefResourceReference {
  readonly table?: string;
  readonly key?: Readonly<Record<string, unknown>>;
}

export type BriefResult<T> = { readonly status: 'ok'; readonly value: T; readonly contractVersion?: string } | BriefFailure;

export interface BriefDraftRecord {
  readonly draftVersion: number;
  readonly baseBriefVersion: number;
  readonly brief: EditableBrief;
  readonly [evidence: string]: unknown;
}

export interface BriefCurrentValue {
  readonly brief: BriefVersioned;
  readonly activity: {
    readonly canSearch: boolean;
    readonly canHold: boolean;
    readonly existingOffersUnaffected: boolean;
    readonly existingOffers: readonly Readonly<Record<string, unknown>>[];
    readonly [evidence: string]: unknown;
  };
  readonly validation: {
    readonly policyVersion: string;
    readonly unknownEssentials: readonly string[];
    readonly assumptions: readonly Readonly<Record<string, unknown>>[];
  };
  readonly [evidence: string]: unknown;
}

export interface BriefHistoryValue {
  readonly versions: readonly BriefVersioned[];
  readonly [evidence: string]: unknown;
}

export interface BriefPreferenceSaveValue {
  readonly briefVersion: number;
  readonly draftVersion: number;
  readonly buddy: BuddyView;
  readonly buddyTransition: string | null;
  readonly accountPreferences: AccountPreferencesState;
  readonly currentCarRating: CurrentCarRatingView | null;
  readonly sameAgain: SameAgainView;
  readonly [evidence: string]: unknown;
}

export interface BriefEngagementValue {
  readonly briefVersion: number;
  readonly draftVersion: number;
  readonly buddy: BuddyView;
  readonly [evidence: string]: unknown;
}
