# FUCQ-342 fixture session isolation evidence

Status: **built for dispatcher integration**. All three original branch acceptance criteria are met. Source checkpoint `34d59bd71bacd055d9af54579cfb99e455e26ac4` passed isolated independent design/code/security and detector/browser reviews; see [review.md](review.md). This record does not mark Jira accepted or assert a merge/deployment.

Named offer and outbox adapters now explicitly pass `signOut: false` through their existing wrapper boundaries. All four gallery shell examples do the same. Live compositions leave the option undefined, retaining the shared shell’s existing Sign out behavior. No shared shell or stylesheet changed.

## Scoped validation

`validation.json` records the exact changed-source/test SHA-256 values, base `0dc6497223dbe03f70ac46efbc1864031300f430`, command, strict targeted stamp and browser observations. The current source/test hashes still match both successful runs.

- Regression before the fix: three named fixture cases failed; the live wrapper case passed.
- Final scoped Node run: **242/242 passed, zero failures or skips**. The initial aggregate run had 235 passes and a missing-`pg` import failure; an owned read-only link to existing `pg` 8.23.1 resolved that environment input. The link has been removed.
- Baseline browser overlays from the base commit: offer, outbox and gallery each issued logout and the local session became 401.
- Corrected browser: 16 fixture/viewport cases issued no logout request and kept the session valid. Four live offer/outbox cases issued logout, redirected to `/gcsp/login`, and changed server authority to 401.
- Keyboard: Enter opens the account disclosure; Escape closes it and returns focus. No page errors or external requests were observed.

The JavaScript affected selector has no supported plug-in and proposed a full suite fallback. Explicit boundary checks were selected instead. Full server/retail/comparison/allocator suites, PostgreSQL and deployed smoke were not run; no implementation in those areas changed. The local proof uses the actual logout route with an in-memory identity repository.

## Rendered evidence

Each filename ends with viewport width: **1440 × 1000** or **390 × 844**. Fixture captures disable animations. Gallery captures are cropped to the relevant framed component; the viewport is still 1440 or 390.

| Capture prefix | State and inspection purpose |
| --- | --- |
| `offer-pending` | Offer ready, account open, no Sign out |
| `offer-loading`, `offer-error` | Loading and failed read, recovery action, account open |
| `outbox-messages` | Selected email with realistic long recipient content, account open |
| `outbox-empty`, `outbox-loading`, `outbox-error` | Empty, loading and unavailable states, account open |
| `gallery` | Compact account with realistic long identity, disclosure open |
| `gallery-loading`, `gallery-unavailable` | Account loading and unavailable examples |
| `live-pending`, `live-error` | Live Sign out pending/disabled and failed/retry states; retained from the successful live API proof |

Imhotep’s isolated Assessment A inspected all 24 captures before reading prior findings or detector output, then passed the bounded code/security review. Bugs Bunny’s isolated Assessment B ran the detector once (zero findings) and independently repeated the local HTTPS browser proof. The lead inspected representative fresh B desktop/narrow offer/outbox and live pending/error pairs after both reports completed. Both reviewers found no in-scope correction; their sole gallery finding is tracked separately. See [review.md](review.md) for the substantive critique and its limits. The unchanged 242-test evidence was reused, not rerun.

## Separate finding and resources

**FUCQ-346 (Low)** records the existing gallery frame clipping long account text and the unavailable Retry button at 390px. See `gallery-390.png` and `gallery-unavailable-390.png`. The dispatcher verified origin FUCQ-322 and found-during FUCQ-342; native/local Bug DEV-2026-11-10-005 is To Do and unassigned with all three attachments ready and check-story passing. Its CSS is outside this Bug; it is not claimed fixed.

Twelve run-owned test/browser/detector shards and B’s tracking root are verified absent; reviewers and dispatcher verified owned process cleanup. The read-only dependency symlink and generated Python bytecode were removed; the dependency target remains intact. The recorded scratch peaks total 23,178,451 bytes across sequential chunks; the maximum chunk was 7,181,756 bytes. Maximum recorded process RSS was 353,288,192 bytes. Local scratch held only bounded browser profiles/HTTPS/tool working data and was removed. Concise manifests, checkpoints and bounded diagnostics remain under `.claude/test-runs/fucq342-20261110/` and `.claude/dev-poller-20261110/`; no cloud output or large artifact was created.

B preserved a supervisor output-redirection failure before Chrome launch, then completed a browser-only retry without rerunning the detector. Its normalized capture hashes, source identity and resource result are appended to `validation.json`; no duplicate capture set is required for this final record.
