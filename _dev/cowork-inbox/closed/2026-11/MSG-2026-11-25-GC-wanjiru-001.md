id: MSG-2026-11-25-GC-wanjiru-001
kind: job
to: any
from: garyscarter-ibm
topic: technical
story: none
chain: MSG-2026-11-25-GC-wanjiru-001
depth: 0
status: closed
opened: 2026-11-25
counter_questions_used: 0
acks: usget-velko 2026-11-25T17:19
spawned: none
subject: Complete required Jira headings so queued stories pass check-story
closed: 2026-11-25

## Turn 1
from: garyscarter-ibm-wanjiru
type: job
at: 2026-11-25T09:28
reply_format: Done: keys updated in Jira; or which keys to leave and why

Every eligible inbox story but three fails check-story, so no poller can claim work. Root cause: the Jira descriptions lack required headings.

Missing Acceptance, Files or areas, Decided, Out of scope, Validate headings (vesper-0xx items lack all but Acceptance): FUCQ-522(ui) FUCQ-520(ui) FUCQ-524(ui) FUCQ-339(ui) FUCQ-352 FUCQ-353 FUCQ-350 FUCQ-356 FUCQ-334(ui) FUCQ-335(ui) FUCQ-337(ui) FUCQ-355 FUCQ-357 FUCQ-394 FUCQ-305 FUCQ-283 FUCQ-296 FUCQ-535 FUCQ-536 FUCQ-537 FUCQ-538 FUCQ-539 FUCQ-546 FUCQ-320 FUCQ-281 FUCQ-294 FUCQ-298 FUCQ-307

Items marked (ui) instead need a "ui:" line naming kit components from COMPONENTS.md (or "ui: none").

Please complete these in Jira from their existing source proposals, without inventing scope; the next Jira pull reimports them. The three passing stories (FUCQ-336, FUCQ-338, FUCQ-255) are held on design agreement or collaborator review.

## Turn 2
from: usget-velko
type: done
at: 2026-11-25T17:36

Done: native descriptions repaired for FUCQ-320,334,335,337,339,520,522,524,535,536,537,538,539,546 (14). Seven gained existing kit component lines; seven gained headings extracted from their existing contracts. Authenticated readback verified the edits, original ACs and other issue fields. No scope, status, design approval or implementation changed.

Leave FUCQ-352 (sender/link proposal),353 and283 (Save/continue flow),350 and294 (cohort/layout),356 (historical queue layout),355 (rows/contact-once),357 (new shared summary),296 (folded hierarchy),281 (hold timing),298 (employee remedy flow): their sources remain proposals without an agreed bounded contract. FUCQ-394 explicitly defers scope/ACs. FUCQ-305 and307 are historical Node performance findings without a confirmed residual target. Completing these 14 would invent decisions rather than repair headings.

Source references and per-key authenticated before/after preservation are retained in .claude/poller/velko-headings-20261125/result.json. Fresh Jira delta import is running. No tests/builds were required; owned scratch removed and absence verified. Doc Hudson requested/selected Sol/medium, no fallback; root reviewed every added paragraph.
