// Optional source fields stay optional; records retain supplied evidence and provenance.
export interface EvidenceRecord { readonly [key: string]: unknown }
export interface SourceFact extends EvidenceRecord { readonly status?: string; readonly value?: unknown; readonly unit?: string | null; readonly provenance?: EvidenceRecord }
export interface AccountIdentity extends EvidenceRecord {
  readonly employeeId: string; readonly name?: string | null; readonly company?: string | null;
  readonly companyId?: string; readonly schemeId?: string; readonly gradeId?: string; readonly grade?: string;
  readonly employeeNumber?: string | null; readonly dateOfBirth?: string | null; readonly address?: EvidenceRecord | null;
  readonly contact?: { readonly phone?: string | null; readonly email?: string | null } | null;
  readonly allowanceOverride?: unknown; readonly allowanceOverrideEndDate?: string | null;
}
export interface AccountDriver extends EvidenceRecord {
  readonly driverId: string; readonly employeeId?: string; readonly kind?: string; readonly name?: string | null;
  readonly licence?: EvidenceRecord | null;
}
export interface ContractTerms extends EvidenceRecord {
  readonly kind?: string; readonly value?: number | SourceFact | null; readonly allowance?: number | SourceFact | null;
  readonly currency?: string; readonly unit?: string;
}
export interface AccountContract extends EvidenceRecord {
  readonly contractId: string; readonly employeeId?: string; readonly schemeId: string; readonly slotId?: string;
  readonly driverId?: string; readonly status?: string | null; readonly model?: string | null;
  readonly media?: EvidenceRecord | null; readonly vehicle?: EvidenceRecord | null; readonly terms?: ContractTerms | null;
  readonly contractEndDate?: string | null; readonly actualCollectionDate?: string | null;
  readonly earliestCollectionDate?: string | null; readonly latestCollectionDate?: string | null;
  readonly months?: number | null; readonly annualMileage?: number | null; readonly mileageUnit?: string | null;
  readonly currentOdometer?: { readonly value?: unknown; readonly unit?: string | null } | null;
  readonly orderNumber?: string | null; readonly registration?: string | null; readonly vin?: string | null;
  readonly returnedDate?: string | null; readonly returnedMileage?: number | null;
}
export interface AccountAction extends EvidenceRecord {
  readonly action: 'order' | 'replace'; readonly enabled: boolean; readonly slotId: string;
  readonly schemeId: string; readonly oldContractId: string | null;
}
export interface AccountSlot extends EvidenceRecord { readonly entitlementSlotId: string; readonly employeeId?: string; readonly ordering?: EvidenceRecord }
export interface AccountHistory extends EvidenceRecord { readonly schemeId: string; readonly label?: string; readonly entries: readonly AccountContract[] }
export interface CurrentCarRelationship extends EvidenceRecord {
  readonly currentCar: ({ readonly kind: 'contract'; readonly contractId: string; readonly slotId?: string }
    | { readonly kind: 'order'; readonly orderUuid: string; readonly vin?: string | null }) | null;
  readonly oldCar?: { readonly contractId?: string; readonly status?: string; readonly [key: string]: unknown } | null;
  readonly newCar?: { readonly collectedAt?: string | null; readonly [key: string]: unknown } | null;
}
export interface AccountProjection extends EvidenceRecord {
  readonly state: string; readonly actions: readonly AccountAction[]; readonly account?: AccountIdentity | null;
  readonly asOf?: string | null; readonly drivers?: readonly AccountDriver[]; readonly contracts?: readonly AccountContract[];
  readonly currentContract?: AccountContract | null; readonly currentCarRelationships?: readonly CurrentCarRelationship[];
  readonly slots?: readonly AccountSlot[]; readonly histories?: readonly AccountHistory[];
  readonly allowance?: EvidenceRecord | null; readonly choices?: EvidenceRecord | null; readonly contextVersion?: string | null;
  readonly assumptions?: readonly EvidenceRecord[] | null; readonly versions?: EvidenceRecord | null; readonly view?: EvidenceRecord | null;
}
export interface JourneyIntent {
  readonly mode: 'new' | 'replacement'; readonly oldContractId: string | null; readonly slotId: string; readonly schemeId: string;
}
export interface ManualChoices extends JourneyIntent {
  readonly driverId?: string; readonly contractOptionId?: string; readonly requestedCollectionDate?: string;
  readonly collectionLocationId?: string; readonly brand?: string; readonly contact?: { readonly phone: string; readonly email: string };
  readonly expectedReturnMileage?: number | null; readonly specialRequirements?: string;
}
export interface ManualDraft extends EvidenceRecord {
  readonly draftVersion: number; readonly contextVersion: string; readonly choices: ManualChoices;
  readonly draftStage?: 'intent' | 'complete'; readonly requiresRefresh?: boolean; readonly view?: EvidenceRecord | null;
}
export interface DiscardedDraft extends EvidenceRecord { readonly draftVersion: number; readonly discarded: true }
export interface NotificationEmail extends EvidenceRecord { readonly deliveryEmail: string | null; readonly version: number }
export interface ManualStock extends EvidenceRecord {
  readonly total: number; readonly versions: EvidenceRecord & { readonly draft: number; readonly context: string };
  readonly cars?: readonly EvidenceRecord[]; readonly decisions: readonly EvidenceRecord[];
  readonly payloadShape?: 'manual-stock-compact-v1'; readonly carIds?: readonly string[]; readonly sharedVersionKeys?: readonly string[];
}
export interface SaveDraftCommand { readonly commandId: string; readonly expectedDraftVersion: number; readonly expectedContextVersion: string; readonly choices: ManualChoices }
export interface DiscardDraftCommand { readonly commandId: string; readonly expectedDraftVersion: number }
export interface SaveNotificationEmailCommand { readonly commandId: string; readonly expectedVersion: number; readonly deliveryEmail: string | null }
export type AccountFailureStatus = 'unavailable' | 'forbidden' | 'invalid' | 'not-found' | 'conflict' | 'stale-version'
  | 'stale-run' | 'unsupported' | 'unauthenticated' | 'authentication-required' | 'account-changed' | 'aborted' | 'pending' | 'uncertain' | 'refused';
export interface AccountFailure extends EvidenceRecord {
  readonly status: AccountFailureStatus; readonly code?: string; readonly reason?: string; readonly retryable?: boolean;
  readonly reasons?: unknown; readonly view?: EvidenceRecord | null; readonly operationId?: string; readonly httpStatus?: number;
  readonly contractVersion?: string;
}
export type AccountResult<T> = { readonly status: 'ok'; readonly value: T; readonly contractVersion?: string } | AccountFailure;
export interface AccountRequestOptions { readonly signal?: AbortSignal }
export interface DisplayFact { readonly label: string; readonly value: unknown; readonly unit: string | null; readonly missingLabel: 'Not supplied' }
export interface ContractView extends AccountContract {
  readonly driver: AccountDriver | null; readonly daysRemaining: number | null; readonly action: AccountAction | null;
  readonly media: EvidenceRecord | null; readonly facts: readonly DisplayFact[];
}
export interface DraftView { readonly state: string; readonly draft: ManualDraft | null; readonly failure: AccountFailure | null; readonly view: EvidenceRecord | null }
export interface AccountView {
  readonly state: string; readonly backendState: string | null; readonly asOf: string | null; readonly account: AccountIdentity | null;
  readonly drivers: readonly AccountDriver[]; readonly additionalDrivers: readonly AccountDriver[]; readonly identityFacts: readonly DisplayFact[];
  readonly currentContracts: readonly ContractView[]; readonly primaryContract: ContractView | null;
  readonly currentCarRelationships: readonly CurrentCarRelationship[];
  readonly currentOrders: readonly { readonly orderUuid: string; readonly vin: string | null; readonly collectedAt: string | null }[];
  readonly contractState: 'current-contract' | 'no-current-car'; readonly carReturned: boolean;
  readonly slots: readonly (AccountSlot & { readonly action: AccountAction | null })[];
  readonly histories: readonly (AccountHistory & { readonly entries: readonly ContractView[]; readonly count: number; readonly state: string })[];
  readonly historyState: 'history' | 'no-history'; readonly actions: readonly AccountAction[];
  readonly allowance: EvidenceRecord | null; readonly choices: EvidenceRecord | null; readonly contextVersion: string | null;
  readonly assumptions: readonly EvidenceRecord[] | null; readonly versions: EvidenceRecord | null; readonly view: EvidenceRecord | null;
  readonly supportOwner: string; readonly failure: AccountFailure | null; readonly draft: DraftView | null;
}
