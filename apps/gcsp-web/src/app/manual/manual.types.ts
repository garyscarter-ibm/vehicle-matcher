import type { StockCar, StockClaimInput, StockRecord } from '../stock/stock.types';

export type ManualRecord = StockRecord;
export type ManualHandoff = StockCar['review'];
export interface ManualScope { readonly subject: string; readonly environmentId: string; readonly runId: string; readonly employeeId: string }
export interface ManualOptions { readonly signal?: AbortSignal }
export interface ManualFailure extends ManualRecord {
  readonly status: 'pending' | 'uncertain' | 'unavailable' | 'invalid' | 'forbidden' | 'not-found' | 'conflict'
    | 'authentication-required' | 'unauthenticated' | 'account-changed' | 'aborted' | 'refused';
  readonly code: string; readonly retryable: boolean; readonly reason?: string; readonly operationId?: string;
  readonly reasons?: readonly { readonly field: string; readonly reason: string }[]; readonly httpStatus?: number;
}
export type ManualResult<T> = { readonly status: 'ok'; readonly value: T; readonly replayed?: boolean }
  | (ManualFailure & { readonly value?: T | null });
export interface ManualHold extends ManualRecord {
  readonly holdId: string; readonly orderUuid: string; readonly employeeId: string; readonly entitlementSlotId: string;
  readonly type: string; readonly state: string; readonly phase: 'preview' | 'order-review'; readonly mode: 'new' | 'replacement';
  readonly version: number; readonly expiresAt: string; readonly reviewStartedAt: string | null; readonly releaseReason: string | null;
}
/** The actual Java quote pins. Stock navigation snapshots are never submission authority. */
export interface ManualQuote extends ManualRecord {
  readonly quoteId: string; readonly orderUuid: string; readonly employeeId: string; readonly entitlementSlotId: string;
  readonly configurationId: string; readonly facts: ManualRecord; readonly terms: ManualRecord; readonly termsDigest: string;
  readonly policyVersion: string; readonly contextVersion: string; readonly draftVersion: number; readonly stockVersion: number;
  readonly quotedAt: string; readonly validUntil: string; readonly driverId: string | null;
  readonly timing: ManualRecord & { readonly previewSeconds: number; readonly reviewSeconds: number; readonly transition: 'once-from-preview' };
}
export interface ManualClaim extends ManualRecord {
  readonly state: string; readonly hold: ManualHold; readonly quote: ManualQuote; readonly now: string;
  readonly pendingOperation: (ManualRecord & { readonly operationId: string; readonly operationType: string; readonly lastKnownState: string }) | null;
  readonly view: ManualRecord & { readonly state: string; readonly editable: false; readonly supportOwner: string; readonly action: string };
}
export interface ManualDeclaration { readonly id: string; readonly label: string; readonly appliesTo: 'all' | 'new' | 'replacement' }
export interface ManualTerms extends ManualRecord {
  readonly schemaVersion: 1; readonly fictional: true; readonly termsVersion: string; readonly wording: string;
  readonly wordingByMode?: { readonly new?: string; readonly replacement?: string }; readonly validUntil: string;
  readonly declarations: readonly ManualDeclaration[]; readonly approvalStages: readonly string[];
  readonly policyVersion: string; readonly termsDigest: string;
}
export interface ManualOrder extends ManualRecord {
  readonly schemaVersion: 1; readonly operationId: string; readonly status: 'pending' | 'acknowledged' | 'refused';
  readonly orderReference: string; readonly providerReference?: string | null; readonly attempts: number;
  readonly selection: ManualRecord & { readonly sourceType: 'cart' | 'buddy-offer'; readonly holdId: string; readonly orderUuid: string;
    readonly orderNumber: string | null; readonly configurationId: string | null; readonly quoteId: string | null;
    readonly termsVersion: string | null; readonly policyVersion: string; readonly receivedAt: string | null };
  readonly progress: { readonly selectionState: string; readonly approved: false; readonly current: string;
    readonly stages: readonly { readonly name: string; readonly state: string }[] };
  readonly view: { readonly state: string; readonly action: string }; readonly failure?: { readonly reason: string | null };
}
export interface ManualClaimCommand extends StockClaimInput { readonly commandId: string }
export interface ManualReviewCommand {
  readonly commandId: string; readonly holdId: string; readonly expectedHoldVersion: number; readonly expectedDraftVersion: number;
}
export interface ManualReleaseCommand extends ManualReviewCommand { readonly reason: 'cancel' | 'change' | 'back' }
export interface ManualEditableDetails {
  readonly contact: { readonly phone: string; readonly email: string };
  readonly expectedReturnMileage: number | null; readonly specialRequirements: string;
}
export interface ManualReviewDetails extends ManualRecord {
  readonly binding: { readonly runId: string; readonly employeeId: string; readonly entitlementSlotId: string;
    readonly holdId: string; readonly quoteId: string; readonly expectedHoldVersion: number; readonly expectedDraftVersion: number };
  readonly reviewDetailsVersion: number;
  readonly details: { readonly contact: { readonly phone?: string; readonly email?: string };
    readonly expectedReturnMileage: number | null; readonly specialRequirements?: string };
  readonly constraints: { readonly maximumSpecialRequirements: number; readonly maximumReturnMileage: number;
    readonly mileageUnit: 'mi'; readonly textLengthUnit: 'UTF-16 code units'; readonly provenance: ManualRecord };
  readonly mode: 'new' | 'replacement'; readonly currentContract: ManualRecord | null;
  readonly requestedCollection: { readonly date: string | null; readonly locationId: string | null };
  readonly oldContractId: string | null; readonly contract: ManualRecord | null; readonly hold: ManualHold; readonly quote: ManualQuote;
  readonly orderNumber: string; readonly stockVersion: number; readonly now: string; readonly clockVersion: string;
  readonly frozen: boolean; readonly editable: boolean; readonly canContinue: boolean;
  readonly view: { readonly state: string; readonly editable: boolean; readonly action: string; readonly supportOwner: string };
}
export interface ManualReviewDetailsCommand extends ManualReviewCommand {
  readonly quoteId: string; readonly expectedReviewDetailsVersion: number; readonly details: ManualEditableDetails;
}
export interface ManualSubmitCommand {
  readonly commandId: string; readonly source: { readonly type: 'cart'; readonly holdId: string; readonly expectedHoldVersion: number; readonly expectedDraftVersion: number };
  readonly expectedQuoteId: string; readonly expectedStockVersion: number; readonly expectedReviewDetailsVersion: number; readonly termsDigest: string;
  readonly declarations: Readonly<Record<string, boolean>>;
}
export type ManualState = 'idle' | 'loading' | 'selection-ready' | 'no-claim' | 'preview' | 'review' | 'resume-required'
  | 'pending' | 'uncertain' | 'awaiting-approval' | 'refused' | 'stale' | 'released' | 'expired' | 'unavailable'
  | 'invalid' | 'denied' | 'authentication-required';
export interface ManualProjection {
  readonly state: ManualState; readonly claim: ManualClaim | null; readonly order: ManualOrder | null; readonly terms: ManualTerms | null;
  readonly reviewDetails: ManualReviewDetails | null;
  readonly declarations: readonly ManualDeclaration[]; readonly wording: string | null; readonly failure: ManualFailure | null;
  readonly canReview: boolean; readonly canSubmit: boolean; readonly canRelease: boolean; readonly approved: false;
}
