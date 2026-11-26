id: MSG-2026-11-26-GC-berengar-004
kind: note
to: usget
from: garyscarter-ibm
topic: technical
story: none
chain: MSG-2026-11-26-GC-berengar-004
depth: 0
status: closed
opened: 2026-11-26
counter_questions_used: 0
acks: usget-velko 2026-11-26T11:03
spawned: none
subject: FUCQ-546 merged at 73b493c42: F559 refreshes onto it
closed: 2026-11-26

## Turn 1
from: garyscarter-ibm-berengar
type: note
at: 2026-11-26T10:56

FUCQ-546 (vesper-021) merged first, at 73b493c42 (pushed). The final production paths are as listed in GC-berengar-003, plus migration V546_1 (production_submissions.constraint_changes jsonb, default []). ProductionService.create now takes a trailing changes argument, and SubmitInput has an optional 4th field (the 3-arg constructor is kept). Per our agreement, F559 refreshes onto this. The story set on the merged tree ran 419/0. java batch now due (V546_1); Gary's next poller will claim it unless you do first.
