export interface GregVersions { readonly brief: readonly string[]; readonly policy: readonly string[] }
export type GregCount = { readonly kind: 'exact'; readonly value: number; readonly label: string }
  | { readonly kind: 'band'; readonly label: string; readonly fewerThan: number; readonly atLeast?: never }
  | { readonly kind: 'band'; readonly label: string; readonly atLeast: number; readonly fewerThan?: never };
export interface GregEvidence { readonly count: GregCount; readonly versions: GregVersions }
export interface GregGroup extends GregEvidence { readonly key: string; readonly label: string; readonly code?: string; readonly field?: string | null;
  readonly severity?: 'blocker' | 'needs-confirmation' | 'unknown'; readonly severityLabel?: string }
export type GregFact = string | number | boolean | null | readonly (string | number | boolean)[];
export interface GregEssential extends GregEvidence {
  readonly field: string; readonly operator: string | null; readonly value: GregFact;
  readonly unit: string | null; readonly state: 'confirmed' | 'needs-confirmation'; readonly label: string;
}
export interface GregDemand {
  readonly runId: string; readonly asOf: string; readonly projectionVersion: string; readonly basis: 'expressed-saved-demand';
  readonly basisLabel: string; readonly basisNote: string; readonly privacyNote: string; readonly overlapNote: string;
  readonly versions: GregVersions & { readonly revision: number; readonly clock?: number | string };
  readonly privacy: { readonly threshold: number; readonly thresholdKey: string; readonly policyVersion: string;
    readonly status: string; readonly withheld: boolean };
  readonly demand: { readonly activeBriefs: GregEvidence; readonly byModelLine: readonly GregGroup[];
    readonly byBody: readonly GregGroup[]; readonly byFuel: readonly GregGroup[]; readonly essentials: readonly GregEssential[];
    readonly unmet: { readonly total: GregEvidence; readonly byGate: readonly GregGroup[] } };
  readonly holds: { readonly total: GregEvidence; readonly active: GregEvidence; readonly byState: readonly GregGroup[]; readonly byType: readonly GregGroup[] };
  readonly offers: { readonly made: GregEvidence; readonly accepted: GregEvidence; readonly declined: GregEvidence;
    readonly expired: GregEvidence; readonly selected: GregEvidence; readonly declinedByReason: readonly GregGroup[] };
  readonly stock: { readonly byModelLine: readonly { readonly key: string; readonly label: string;
    readonly released: GregEvidence; readonly held: GregEvidence; readonly allocated: GregEvidence }[];
    readonly source: { readonly status: string; readonly reason?: string }; readonly unavailable: boolean; readonly empty: boolean };
}
export interface GregProvenance { readonly source: string; readonly sourceDate: string; readonly basis: string; readonly status: string; readonly unit: string }
export interface GregRange extends GregProvenance { readonly minimum: number; readonly maximum: number; readonly step: 1; readonly assumptionKey: string }
export interface GregPolicyField extends GregProvenance {
  readonly id: string; readonly kind: 'price' | 'weight'; readonly key: string; readonly value: number;
  readonly label: string; readonly unitLabel: string; readonly minimum: 0; readonly step: 1;
  readonly schemeId?: string; readonly schemeLabel?: string; readonly configurationId?: string;
  readonly matchField?: string; readonly matchValue?: string; readonly adoptionRequired?: boolean; readonly presentationRange?: GregRange;
}
export interface GregHeldOffers { readonly count: number | null; readonly message: string; readonly unit?: string }
export interface GregPolicy {
  readonly state: 'draft'; readonly activeVersion: string; readonly activeVersionLabel: string;
  readonly versionNames: Readonly<Record<string, string>>; readonly effectiveFrom: string; readonly asOf: string;
  readonly fields: readonly GregPolicyField[]; readonly weightsAdoptionRequired: boolean;
  readonly heldOffers: GregHeldOffers; readonly historyMessage: string; readonly clockVersion?: number | string;
}
export interface GregChange { readonly id: string; readonly value: number }
export interface GregPreviewInput { readonly expectedActiveVersion: string; readonly changes: readonly GregChange[] }
export interface GregPublishInput extends GregPreviewInput { readonly commandId: string; readonly policyVersion: string; readonly effectiveFrom: string }
export interface GregFit { readonly employeesWithEligibleStock: GregCount; readonly scoredBriefs: GregCount;
  readonly meanBestScore: { readonly status: 'available'; readonly value: number } | { readonly status: 'suppressed'; readonly fewerThan: number } }
export interface GregPreview {
  readonly preview: true; readonly activeVersion: string; readonly asOf: string;
  readonly differences: readonly { readonly id: string; readonly before: number; readonly after: number; readonly unit: string }[];
  readonly active: { readonly demand: GregDemand; readonly fit: GregFit }; readonly draft: { readonly demand: GregDemand; readonly fit: GregFit };
  readonly heldOffers: GregHeldOffers;
}
export interface GregPublished {
  readonly state: 'published'; readonly accepted: true; readonly policyVersion: string; readonly effectiveFrom: string;
  readonly publisher: string; readonly publishedAt: string; readonly heldOffers: GregHeldOffers;
  readonly activationRequired?: boolean;
  readonly activation?: { readonly status: 'active'; readonly policyVersion: string; readonly asOf: string; readonly publishedVersionActive: boolean }
    | { readonly status: 'pending'; readonly policyVersion: string; readonly retryable: boolean; readonly reason: string; readonly outcome: string };
}
export type GregRefusalStatus = 'invalid' | 'unauthenticated' | 'forbidden' | 'stale-version' | 'stale-run' | 'conflict' | 'unsupported' | 'unavailable' | 'uncertain';
export interface GregRefusal { readonly status: GregRefusalStatus; readonly code: string; readonly reason: string; readonly retryable: boolean;
  readonly reasons?: readonly { readonly field: string; readonly reason: string }[]; readonly operationId?: string;
  readonly expectedVersion?: string; readonly currentVersion?: string; readonly action?: string; readonly accepted?: boolean }
export interface GregRequestEvidence { readonly httpStatus?: number; readonly writeOutcome?: 'not-sent' | 'unknown' }
export type GregResult<T> = ({ readonly state: 'ready'; readonly value: T }
  | { readonly state: 'refused'; readonly value: null; readonly refusal: GregRefusal }
  | { readonly state: 'invalid-response' | 'scope-mismatch'; readonly value: null }
  | { readonly state: 'failed'; readonly value: null; readonly problem: string }) & GregRequestEvidence;
export interface GregRequestOptions { readonly signal?: AbortSignal }
