// Java CaseResource / CaseService v1 DTOs. There is no contractVersion/schemaVersion field.
// Backend bearer authentication, roles and resource ownership remain authoritative.
export interface CaseEvidence { readonly [key: string]: unknown }
export type CaseStatus = 'open' | 'in-progress' | 'remedy-proposed' | 'resolved' | 'closed';
export type CaseAudience = 'employee' | 'scheme-team';
export type CaseScope = { readonly audience: 'employee'; readonly runId: string; readonly employeeId: string }
  | { readonly audience: 'scheme-team'; readonly runId: string };
export interface CaseOwner { readonly role: string; readonly name: string | null }
export interface CaseTrigger extends CaseEvidence { readonly type: string; readonly label?: string }
// Keep recorded remedy evidence intact; this is not a list of client-permitted commands.
export interface CaseRemedy extends CaseEvidence { readonly type: string }
export interface CaseHistory {
  readonly at: string | null; readonly actorId: string; readonly actorRole: string; readonly status: CaseStatus;
  readonly reason: string; readonly nextAction: string; readonly dueAt: string | null;
  readonly trigger?: CaseTrigger; readonly remedy: CaseRemedy | null;
}
export interface CaseRecord {
  readonly caseId: string; readonly runId: string; readonly employeeId: string; readonly renewalId: string;
  readonly owner: CaseOwner; readonly status: CaseStatus; readonly reason: string; readonly trigger: CaseTrigger | null;
  readonly nextAction: string; readonly dueAt: string | null; readonly openedAt: string | null;
  readonly lastUpdatedAt: string | null; readonly renewalDeadline: string | null; readonly renewalDeadlineState: string;
  readonly policyVersion: string; readonly history: readonly CaseHistory[]; readonly remedy: CaseRemedy | null;
  readonly fictional: boolean; readonly version: number; readonly employeeName?: string;
}
export interface CaseList { readonly cases: readonly CaseRecord[]; readonly asOf: string; readonly policyVersion: string }
// GET one case includes asOf/policyVersion; command readback contains just case.
export interface CaseDetailValue { readonly case: CaseRecord; readonly asOf?: string; readonly policyVersion?: string }
export interface CaseOptionGroup {
  readonly available: boolean; readonly items: readonly CaseRemedy[]; readonly reason?: string;
}
export interface CaseCarOption extends CaseRemedy {
  readonly type: 'alternative-car'; readonly orderUuid: string;
  readonly snapshot?: CaseEvidence; readonly unknowns?: readonly unknown[];
}
export interface CaseOptions {
  readonly case: CaseRecord; readonly nextStatuses: readonly CaseStatus[]; readonly asOf: string;
  readonly policyVersion: string; readonly automaticRecoveryPriority: false;
  readonly options: {
    readonly alternativeCars: CaseOptionGroup & {
      readonly items: readonly CaseCarOption[]; readonly needsConfirmation: readonly CaseCarOption[];
    };
    readonly preferenceRelaxations: CaseOptionGroup; readonly laterRelease: CaseOptionGroup;
    readonly manualDecision: { readonly available: true; readonly type: 'manual-decision'; readonly requiresDecision: true };
    readonly contractExtension: { readonly available: boolean; readonly type: 'contract-extension';
      readonly contractEndDate: string | null; readonly requiresUntil: true; readonly reason?: string };
  };
}
export interface CaseHelp {
  readonly opensCase: false; readonly ownerRole: string; readonly extensionPermitted: boolean;
  readonly nextAction: string; readonly automaticRecoveryPriority: false;
  readonly policyVersion: string; readonly assumptions: readonly CaseEvidence[];
}
export type CaseRefusalStatus = 'invalid' | 'unauthenticated' | 'forbidden' | 'not-found' | 'stale-version' | 'conflict' | 'unavailable';
export interface CaseRefusal {
  readonly status: CaseRefusalStatus; readonly code: string; readonly reason: string; readonly retryable: boolean;
  readonly reasons?: readonly { readonly field: string; readonly reason: string }[];
  readonly action?: string; readonly expectedVersion?: number; readonly currentVersion?: number; readonly operationId?: string;
}
export type CaseEnvelope<T> = { readonly status: 'ok'; readonly value: T; readonly replayed?: true } | CaseRefusal;
// Local interpretation is separate from Java refusal statuses; failures contain no case payload.
export type CaseRead<T> = { readonly state: 'ready'; readonly value: T; readonly replayed: boolean }
  | { readonly state: 'refused'; readonly value: null; readonly refusal: CaseRefusal }
  | { readonly state: 'not-loaded' | 'invalid-response' | 'scope-mismatch'; readonly value: null };
export interface CaseFact { readonly label: string; readonly value: string }
export interface CaseDisplay {
  readonly caseId: string; readonly reference: string; readonly status: string; readonly employee: string | null;
  readonly owner: string; readonly facts: readonly CaseFact[];
  readonly remedy: { readonly title: string; readonly facts: readonly CaseFact[] } | null;
  readonly history: readonly (readonly CaseFact[])[]; readonly source: CaseRecord;
}
