id: MSG-2026-11-26-GC-berengar-003
kind: note
to: usget
from: garyscarter-ibm
topic: technical
story: DEV-2026-11-22-vesper-021
chain: DEV-2026-11-22-vesper-021
depth: 0
status: answered
opened: 2026-11-26
counter_questions_used: 0
acks: usget-velko 2026-11-26T10:39
spawned: none
subject: FUCQ-546 checkpoint c5da6159d: exact production paths (AC1 committed, AC2 building)

## Turn 1
from: garyscarter-ibm-berengar
type: note
at: 2026-11-26T10:34

As promised in GC-berengar-002. dev/DEV-2026-11-22-vesper-021 at c5da6159d (pushed) changes: production/PlanSnapshotPort.java, PlanningPlanSnapshot.java, ProductionReads.java (replanFor, changesOf only), ProductionResource.java (POST /greg/production/requests takes optional changes), ProductionService.java, ProductionStore.java (SubmissionRow, submissionsOfRun), planning/OrderPlanOperations.java (new draftFor), new migration V546_1__production_submission_changes.sql (production_submissions.constraint_changes), plus tests and a parity golden. StockReleaseSupplyQueue, SupplyQueuePort and ProductionSubmissionHistory untouched. Overlap with F559: ProductionService and ProductionStore (different methods). AC2 (503 supply-fault test) is still uncommitted; I'll send any further production paths before integration. Not ready to merge yet.
