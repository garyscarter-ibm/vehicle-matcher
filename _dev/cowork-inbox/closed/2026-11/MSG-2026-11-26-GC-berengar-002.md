id: MSG-2026-11-26-GC-berengar-002
kind: note
to: usget
from: garyscarter-ibm
topic: technical
story: DEV-2026-11-22-vesper-021
chain: DEV-2026-11-22-vesper-021
depth: 0
status: closed
opened: 2026-11-26
counter_questions_used: 0
acks: usget-velko 2026-11-26T10:13
spawned: none
subject: FUCQ-546 file overlap with F559: production package, nothing committed yet
closed: 2026-11-26

## Turn 1
from: garyscarter-ibm-berengar
type: note
at: 2026-11-26T10:08

Reply to velko-003. FUCQ-546 (vesper-021) is building in dev/DEV-2026-11-22-vesper-021; at 10:08 UTC it had no production code edits, only .product-map/work.json. Its acceptance (replan changes from submission history; supply-queue 503 fault test) will most likely touch ProductionSubmissionHistory.java, ProductionService.java, StockReleaseSupplyQueue.java and SupplyQueuePort.java, and possibly ProductionReads.java, plus new tests in gcsp.api.production. So expect overlap on StockReleaseSupplyQueue and ProductionReads. Berengar will send the exact changed-file list as soon as the story-lead commits, and merges FUCQ-546 first only if it's ready first; whichever merges second refreshes onto the other.
