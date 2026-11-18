/** Existing Java comparison projections; the server owns seeds, workloads and policy. */
export const COMPARISON_EXPERIMENTS = ['process-only', 'order-mix', 'points', 'hold-sweep'] as const;
export type ComparisonExperimentId = typeof COMPARISON_EXPERIMENTS[number];
export type ComparisonJson = null | boolean | number | string | readonly ComparisonJson[] | { readonly [key: string]: ComparisonJson };
export interface ComparisonStats { readonly mean: number | null; readonly min: number | null; readonly max: number | null }
export interface ComparisonDifference {
  readonly measure: string; readonly betterWhen: string; readonly verdict: string;
  readonly current: ComparisonStats; readonly buddy: ComparisonStats; readonly difference: ComparisonStats;
}
export interface ComparisonAssumption {
  readonly key: string; readonly value: ComparisonJson; readonly unit: string; readonly status: string;
  readonly basis: string; readonly source?: ComparisonJson; readonly policyVersion?: string;
}
export interface ComparisonManifest {
  readonly experimentId: ComparisonExperimentId; readonly seeds: readonly string[]; readonly policyVersion: string;
  readonly policyHash?: string; readonly generatorVersion?: string; readonly codeRevision?: string;
  readonly overlays?: { readonly [key: string]: ComparisonJson }; readonly change?: ComparisonJson;
  readonly inputHashes?: { readonly [key: string]: ComparisonJson }; readonly arms?: readonly ComparisonJson[];
}
export interface ComparisonArm {
  readonly armId: string; readonly value: ComparisonJson; readonly differences: readonly ComparisonDifference[];
  readonly measures: ComparisonJson; readonly perSeed: readonly ComparisonJson[];
}
export interface ComparisonResult {
  readonly schemaVersion: 1; readonly kind: 'process-comparison' | 'experiment-comparison';
  readonly experimentId: ComparisonExperimentId; readonly completedAt: string; readonly manifest: ComparisonManifest;
  readonly assumptions: readonly ComparisonAssumption[]; readonly caveat: string; readonly limitations: readonly string[];
  readonly differences?: readonly ComparisonDifference[]; readonly measures?: ComparisonJson;
  readonly perSeed?: readonly ComparisonJson[]; readonly arms?: readonly ComparisonArm[];
  readonly effects?: readonly ComparisonJson[]; readonly rule?: ComparisonJson;
}
export interface StoredComparison {
  readonly result: ComparisonResult; readonly resultId: string; readonly storedAt: string;
  readonly policyVersion: string; readonly activePolicyVersion: string; readonly policyCurrent: boolean;
  readonly resultDigest: string; readonly origin: 'retained' | 'run';
}
export interface ComparisonCatalogue {
  readonly activePolicyVersion: string;
  readonly experiments: readonly { readonly experimentId: ComparisonExperimentId; readonly latest: StoredComparison | null }[];
}
export type ComparisonRequest = { readonly experimentId: 'process-only' }
  | { readonly experimentId: 'points'; readonly change: { readonly value: number; readonly basis: string } }
  | { readonly experimentId: 'order-mix'; readonly change: { readonly value: readonly { readonly modelLine: string; readonly weight: number }[]; readonly basis: string } }
  | { readonly experimentId: 'hold-sweep'; readonly change: { readonly values: readonly number[]; readonly basis: string } };
export type ComparisonStartInput = ComparisonRequest & { readonly commandId: string };
export interface ComparisonJob {
  readonly jobId: string; readonly experimentId: ComparisonExperimentId;
  readonly status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  readonly progress: { readonly seedsDone: number; readonly seedsTotal: number; readonly stepsDone: number; readonly stepsTotal: number };
  readonly startedAt: string; readonly finishedAt: string | null; readonly resultId: string | null; readonly reason: string | null;
  readonly request: { readonly experimentId: ComparisonExperimentId; readonly change: ComparisonJson };
}
export interface ComparisonJobRead { readonly job: ComparisonJob | null; readonly reruns: boolean }
export interface ComparisonFailure {
  readonly status: 'authentication-required' | 'forbidden' | 'stale-run' | 'account-changed' | 'unavailable' | 'aborted' | 'invalid' | 'conflict' | 'not-found';
  readonly code: string; readonly reason: string; readonly retryable: boolean;
  readonly reasons?: readonly { readonly field: string; readonly reason: string }[];
  readonly jobId?: string; readonly writeOutcome?: 'not-sent' | 'unknown';
}
export type ComparisonResponse<T> = { readonly status: 'ok'; readonly value: T } | ComparisonFailure;
export type ComparisonStartResponse = { readonly status: 'ok'; readonly value: ComparisonJob }
  | { readonly status: 'pending'; readonly value: ComparisonJob } | ComparisonFailure;
export interface ComparisonReadOptions { readonly signal?: AbortSignal }
