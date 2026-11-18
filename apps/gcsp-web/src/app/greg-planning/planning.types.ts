/** Java transport contracts. Unknown extension fields remain server owned. */
export interface PlanningRecord { readonly [key: string]: unknown }
export interface PlanQuantityDto { readonly derivativeId: string; readonly modelId: string; readonly quantity: number }
export interface PlanConstraintDto { readonly id: string; readonly detail: string }
export interface PlanDto extends PlanningRecord {
  readonly planId: string; readonly status: 'feasible' | 'infeasible'; readonly runId: string;
  readonly asOf: string; readonly versions: Readonly<Record<string, string>>;
  readonly quantities: readonly PlanQuantityDto[];
}
export interface PlanValueDto extends PlanningRecord {
  readonly mode: 'current' | 'preview'; readonly preview: boolean; readonly plan: PlanDto;
  readonly presentation: PlanningRecord; readonly activePlan?: PlanDto;
}
export interface ProductionValueDto extends PlanningRecord {
  readonly asOf: string; readonly provider: PlanningRecord;
  readonly submissions: readonly PlanningRecord[]; readonly requests: readonly PlanningRecord[];
}
export interface ProductionSubmissionDto extends PlanningRecord {
  readonly submissionId: string; readonly planId: string; readonly requests: readonly PlanningRecord[];
  readonly message: string;
}
export interface PlanChange { readonly key: string; readonly value: unknown }
export interface ProductionCommand {
  readonly commandId: string; readonly planId: string; readonly versions: Readonly<Record<string, string>>;
}
export type PlanningFailureStatus = 'invalid' | 'forbidden' | 'not-found' | 'conflict' | 'stale-version' | 'stale-run'
  | 'unsupported' | 'unavailable' | 'unauthenticated' | 'authentication-required' | 'pending' | 'uncertain' | 'refused'
  | 'aborted' | 'context-changed';
export interface PlanningFailure {
  readonly status: PlanningFailureStatus; readonly code?: string; readonly reason?: string;
  readonly retryable?: boolean; readonly httpStatus?: number; readonly operationId?: string;
  readonly changedInputs?: readonly string[]; readonly reasons?: readonly { readonly field: string; readonly reason: string }[];
  readonly current?: unknown; readonly value?: unknown; readonly details?: PlanningRecord;
}
export type PlanningResult<T> = { readonly status: 'ok'; readonly value: T; readonly httpStatus?: number } | PlanningFailure;
export interface PlanningOptions { readonly signal?: AbortSignal }

/** UI projections contain presentation only, never inferred quantities or business outcomes. */
export interface PlanningFact { readonly label: string; readonly value: string | number | null }
export interface PlanningLine { readonly id: string; readonly model: string; readonly derivative: string; readonly quantity: number }
export interface ConstraintEditor {
  readonly key: string; readonly label: string; readonly kind: 'budget' | 'bounds'; readonly unit: string;
  readonly value?: number; readonly idField?: 'modelId' | 'derivativeId';
  readonly rows: readonly { readonly id: string; readonly label: string; readonly min: number; readonly max: number }[];
}
export interface PlanAlternative {
  readonly label: string; readonly status: string; readonly same: boolean;
  readonly lines: readonly PlanningLine[]; readonly facts: readonly PlanningFact[]; readonly conflicts: readonly string[];
}
export interface PlanView {
  readonly planId: string; readonly versions: Readonly<Record<string, string>>; readonly preview: boolean;
  readonly state: 'feasible' | 'infeasible' | 'empty'; readonly title: string; readonly message: string;
  readonly forecast: string; readonly forecastNote: string | null; readonly facts: readonly PlanningFact[];
  readonly lines: readonly PlanningLine[]; readonly models: readonly PlanningFact[]; readonly metrics: readonly PlanningFact[];
  readonly conflicts: readonly string[]; readonly binding: readonly string[]; readonly limitations: readonly string[];
  readonly unmet: readonly { readonly label: string; readonly reasons: readonly string[]; readonly constraints: readonly string[] }[];
  readonly alternatives: readonly PlanAlternative[]; readonly editors: readonly ConstraintEditor[];
  readonly unsupportedEditors: readonly string[]; readonly learned: string | null; readonly replan: string | null;
  readonly unbound: string | null; readonly riskSources: readonly PlanningFact[];
  readonly comparison: readonly { readonly label: string; readonly current: string | number | null; readonly preview: string | number | null }[];
  readonly canSubmit: boolean;
}
export interface ProductionRequestView {
  readonly id: string; readonly model: string; readonly derivative: string; readonly state: string; readonly stage: string;
  readonly message: string | null; readonly reason: string | null; readonly code: string | null;
  readonly facts: readonly PlanningFact[]; readonly history: readonly { readonly state: string; readonly at: string; readonly details: readonly PlanningFact[] }[];
  readonly supplies: readonly { readonly id: string; readonly facts: readonly PlanningFact[] }[];
}
export interface ProductionView {
  readonly asOf: string; readonly provider: readonly PlanningFact[];
  readonly submissions: readonly PlanningFact[]; readonly requests: readonly ProductionRequestView[];
  readonly fingerprint: string;
}
