import type { AccountOrder, AccountOrders, AccountOrderSnapshot, OrderVehicle } from '../account/account.preview';
import type { AccountFailure, CurrentCarRelationship, EvidenceRecord } from '../account/account.types';

// Java lifecycle v1 read DTOs. Optional evidence stays absent; these types do not validate HTTP/auth.
export type LifecycleResult<T> = { readonly status: 'ok'; readonly value: T; readonly contractVersion?: string }
  | (AccountFailure & { readonly value?: T });
export interface OrderIdentity { readonly orderUuid: string; readonly employeeId: string; readonly runId: string }
export interface OrderScope { readonly employeeId: string; readonly runId: string }
export interface OrdersPage extends AccountOrders {
  readonly nextAfter?: string | null;
  readonly failed?: readonly EvidenceRecord[];
  readonly failedCount?: number;
}
export interface LifecycleNote extends EvidenceRecord { readonly code?: string | null; readonly reason?: string | null }
export interface ProviderEvidence extends EvidenceRecord { readonly mode?: string | null; readonly synthetic?: boolean }
export interface OwnedStep { readonly owner?: string | null; readonly nextStep?: string | null }
export interface StageFact extends EvidenceRecord {
  readonly stage: string; readonly state: string; readonly at?: string | null;
}
export interface OrderStages extends OrderIdentity, OwnedStep, EvidenceRecord {
  readonly contractVersion: 'lifecycle.stages.v1'; readonly schemaVersion: 1;
  readonly stageList: readonly string[]; readonly stages: readonly StageFact[];
  readonly currentStage: string | null; readonly outcome: string;
  readonly blocked?: LifecycleNote | null; readonly provider?: ProviderEvidence;
  readonly lifecycleRevision?: number; readonly policyVersion?: string;
}
export interface DocumentItem extends EvidenceRecord {
  readonly itemId: string; readonly kind: string; readonly owner: string; readonly status: string;
  readonly label?: string; readonly action?: string | null; readonly reason?: string | null;
}
export interface DocumentTask extends EvidenceRecord {
  readonly itemId: string; readonly status: string; readonly actionable: boolean;
  readonly label?: string; readonly action?: string | null;
}
export interface DocumentReadiness extends EvidenceRecord {
  readonly ready: boolean; readonly state: string; readonly documentsComplete: boolean;
  readonly vehicleReady: boolean; readonly blocking: readonly string[]; readonly failed: readonly string[];
}
export interface OrderDocuments extends OrderIdentity, EvidenceRecord {
  readonly contractVersion: string; readonly documentsRevision: number;
  readonly acknowledgementSupported: boolean; readonly items: readonly DocumentItem[];
  readonly tasks: readonly DocumentTask[]; readonly readiness: DocumentReadiness;
}
export interface DocumentsCollection extends EvidenceRecord {
  readonly contractVersion: string; readonly now?: string; readonly orders: readonly OrderDocuments[];
}
export interface OfferedSlot extends EvidenceRecord { readonly slotId: string; readonly start: string; readonly end?: string }
export interface OrderAppointment extends OrderIdentity, OwnedStep, EvidenceRecord {
  readonly contractVersion: 'lifecycle.appointments.v1'; readonly version: number;
  readonly state: string; readonly booked: boolean; readonly proposalId?: string | null;
  readonly slot?: OfferedSlot | null; readonly requestedSlot?: OfferedSlot | null; readonly proposedSlot?: OfferedSlot | null;
  readonly offeredSlots: readonly OfferedSlot[]; readonly history?: readonly EvidenceRecord[];
  readonly pending?: EvidenceRecord | null; readonly blocked?: LifecycleNote | null;
  readonly eligibility?: { readonly eligible: boolean; readonly code?: string | null; readonly reason?: string | null };
  readonly provider?: ProviderEvidence; readonly outcome?: EvidenceRecord | null;
}
export interface OrderRelationship extends CurrentCarRelationship, OrderIdentity {
  readonly contractVersion: 'lifecycle.current-car.v1'; readonly changes?: readonly EvidenceRecord[];
}
export interface ReturnChoice extends EvidenceRecord {
  readonly id: string; readonly available: boolean; readonly label?: string; readonly reason?: string | null;
}
export interface OrderReturnPlan extends OrderIdentity, OwnedStep, EvidenceRecord {
  readonly contractVersion: 'lifecycle.return-plan.v1'; readonly version: number;
  readonly applicable: boolean; readonly state: string | null; readonly scheduled: boolean;
  readonly choices: readonly ReturnChoice[]; readonly offeredSlots: Readonly<Record<string, readonly OfferedSlot[]>>;
  readonly proposalId?: string | null; readonly proposedSlot?: OfferedSlot | null;
  readonly appointment?: (OwnedStep & EvidenceRecord & { readonly state: string }) | null;
  readonly pending?: EvidenceRecord | null; readonly blocked?: LifecycleNote | null;
  readonly provider?: ProviderEvidence; readonly outcome?: EvidenceRecord | null;
  readonly relationship?: OrderRelationship | null;
  // The return plan's currentCar describes the old car to return, not who is current now.
  readonly currentCar?: EvidenceRecord | null; readonly handover?: EvidenceRecord | null;
}
export interface OrdersProjectionInput {
  /** Already authenticated/owned reads; scope is used only to prevent cross-record joins. */
  readonly scope: OrderScope; readonly employeeAuthority: boolean; readonly selectedOrderUuid?: string;
  readonly orders: LifecycleResult<OrdersPage> | null;
  readonly snapshot?: LifecycleResult<AccountOrderSnapshot> | null;
  readonly stages?: LifecycleResult<OrderStages> | null;
  readonly documents?: LifecycleResult<DocumentsCollection> | null;
  readonly appointment?: LifecycleResult<OrderAppointment> | null;
  readonly returnPlan?: LifecycleResult<OrderReturnPlan> | null;
}
export interface OrderSelection {
  readonly state: 'selected' | 'none' | 'not-found' | 'unresolved'; readonly reason: string | null;
  readonly complete: boolean; readonly order: AccountOrder | null;
}
export interface ProducerSection<T, E = T> {
  readonly source: string; readonly envelope: LifecycleResult<E> | null;
  readonly state: string; readonly value: T | null;
}
export interface EmployeeActionHints {
  readonly documentTaskIds: readonly string[];
  readonly appointment: { readonly requestSlotIds: readonly string[]; readonly acceptProposalId: string | null };
  readonly returnPlan: { readonly choices: readonly { readonly choiceId: string; readonly slotIds: readonly string[] }[];
    readonly acceptProposalId: string | null };
}
export interface OrdersProjection {
  readonly orders: { readonly source: 'orders/progress/all'; readonly envelope: LifecycleResult<OrdersPage> | null };
  readonly selection: OrderSelection; readonly vehicle: OrderVehicle | null;
  readonly snapshot: LifecycleResult<AccountOrderSnapshot> | null;
  readonly stages: ProducerSection<OrderStages>;
  readonly documents: ProducerSection<OrderDocuments, DocumentsCollection>;
  readonly appointment: ProducerSection<OrderAppointment>;
  readonly returnPlan: ProducerSection<OrderReturnPlan>;
  readonly relationship: { readonly source: 'return-plan.relationship'; readonly value: OrderRelationship | null };
  readonly actions: EmployeeActionHints;
}
