/** Java presenter HTTP projections. Run/account selectors are never request parameters. */
export interface PresenterTick {
  readonly runId: string; readonly tickId: string; readonly kind: string; readonly now: string;
  readonly clockVersion: number; readonly policyVersion: string; readonly state: string;
  readonly handlerOrder: readonly { readonly handlerId: string; readonly stage: string }[];
  readonly missingStages: readonly string[];
  readonly outcomes: readonly { readonly handlerId: string; readonly stage: string; readonly outcome: Readonly<Record<string, unknown>> }[];
}
export interface PresenterClock {
  readonly runId: string; readonly now: string; readonly clockVersion: number;
  readonly scenarioVersion: string; readonly fixtureVersion: string; readonly startsAt: string;
  readonly namedTimes: Readonly<Record<string, string>>; readonly lastTick: PresenterTick | null;
}
export interface PresenterControls extends PresenterClock {
  readonly controls: {
    readonly policyVersion: string; readonly step: { readonly value: number; readonly unit: 'seconds' };
    readonly namedTimes: Readonly<Record<string, string>>;
    readonly nextRelease: { readonly status: 'available'; readonly to: string; readonly at: string }
      | { readonly status: 'unavailable'; readonly reason: string };
  };
}
export interface PresenterScenarioSummary {
  readonly scenarioId: string; readonly name: string; readonly scenarioVersion: string;
  readonly fixtureVersion: string; readonly policyVersion: string;
}
export interface PresenterScenario extends PresenterScenarioSummary {
  readonly kind: string; readonly clockStart: string; readonly namedTimes: Readonly<Record<string, string>>;
  readonly availability: { readonly available: boolean; readonly outcome: string; readonly missingCapabilities: readonly string[] };
}
export interface PresenterCatalogue {
  readonly catalogueVersion: string; readonly policyVersion: string; readonly scenarios: readonly PresenterScenario[];
}
export interface PresenterCurrentScenario extends PresenterClock {
  readonly catalogueVersion: string; readonly currentScenario: PresenterScenarioSummary | null;
}
export type PresenterFault = { readonly adapter: string; readonly available: true; readonly mode: string; readonly modes: readonly string[] }
  | { readonly adapter: string; readonly available: false; readonly reason: string };
export interface PresenterFaults { readonly runId: string; readonly faults: readonly PresenterFault[] }
export interface PresenterAdvance { readonly runId: string; readonly now: string; readonly clockVersion: number }
export interface PresenterReset {
  readonly retiredRunId: string; readonly activatedRunId: string; readonly replayed: boolean;
  readonly scenario: PresenterScenarioSummary; readonly clock: PresenterClock | null;
}
export interface PresenterRefusal {
  readonly status: 'invalid' | 'unauthenticated' | 'forbidden' | 'not-found' | 'conflict' | 'unavailable' | 'pending';
  readonly code: string; readonly reason: string; readonly retryable: boolean;
  readonly currentVersion?: number | string; readonly action?: string; readonly operationId?: string;
  readonly reasons?: readonly { readonly field: string; readonly reason: string }[];
  readonly runId?: string;
}
export interface PresenterEvidence { readonly httpStatus?: number; readonly writeOutcome?: 'not-sent' | 'unknown' }
export interface PresenterClientFailure extends PresenterEvidence {
  readonly state: 'failed'; readonly value: null; readonly problem: string;
}
export type PresenterResult<T> = ({ readonly state: 'ready'; readonly value: T }
  | { readonly state: 'refused'; readonly value: null; readonly refusal: PresenterRefusal }
  | { readonly state: 'invalid-response' | 'scope-mismatch'; readonly value: null }
  | PresenterClientFailure) & PresenterEvidence;
export interface PresenterRequestOptions { readonly signal?: AbortSignal }
export type PresenterAdvanceInput = { readonly commandId: string; readonly expectedClockVersion: number }
  & ({ readonly bySeconds: number; readonly to?: never } | { readonly to: string; readonly bySeconds?: never });
export interface PresenterTickInput { readonly tickId: string; readonly expectedClockVersion: number }
export type PresenterControlTickInput = { readonly commandId: string; readonly expectedClockVersion: number }
  & ({ readonly mode: 'step' | 'next-release'; readonly to?: never } | { readonly mode: 'to'; readonly to: string });
export interface PresenterResetInput {
  readonly commandId: string; readonly expectedRunId: string; readonly scenarioId: string;
  readonly scenarioVersion: string; readonly fixtureVersion: string; readonly policyVersion: string;
}
export interface PresenterFaultInput { readonly commandId: string; readonly adapter: string; readonly mode: string }
export type PresenterProductionInput = { readonly commandId: string; readonly requestId: string; readonly expectedVersion: number }
  & ({ readonly action: 'confirm'; readonly quantity: number } | { readonly action: 'delay'; readonly delayUntil: string; readonly reason: string });
export interface PresenterProductionResult { readonly reconciled: number; readonly applied: number; readonly queued: number;
  readonly requests: readonly { readonly requestId: string; readonly outcome: string }[];
  readonly scripted: { readonly requestId: string; readonly action: string; readonly seq: number } }
export type PresenterCommand = { readonly kind: 'production'; readonly input: PresenterProductionInput }
  | { readonly kind: 'advance'; readonly input: PresenterAdvanceInput }
  | { readonly kind: 'tick'; readonly input: PresenterTickInput }
  | { readonly kind: 'control-tick'; readonly input: PresenterControlTickInput }
  | { readonly kind: 'reset'; readonly input: PresenterResetInput }
  | { readonly kind: 'fault'; readonly input: PresenterFaultInput };
export type PresenterCommandValue = PresenterProductionResult | PresenterAdvance | PresenterTick | { readonly advance: PresenterAdvance; readonly tick: PresenterTick }
  | PresenterReset | PresenterFaults;
