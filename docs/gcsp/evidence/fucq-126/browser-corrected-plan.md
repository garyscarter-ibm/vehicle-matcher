# FUCQ-126 corrected browser checkpoint plan

Prepared 5 November 2026. **Not executed.** The browser lane remains released until
the parent reviews and pushes this correction, integrates the requested base
checkpoint, and grants the lane against an exact full commit.

Earlier results under `browser/`, `browser-results.json` and
`.claude/test-runs/fucq126-browser-20261105/` are preserved as before-repair evidence.
The corrected supervisor writes captures/results only to `browser-after-repair/`
and receipts to `.claude/test-runs/fucq126-browser-corrected-20261105/`.

Set `FUCQ126_FROZEN_REVISION` to the parent's full reviewed/pushed post-integration
commit. The supervisor refuses a missing/abbreviated revision, a different HEAD,
or working runtime changes. Every Git read holds `checkout_mutex`. All inherited
TMPDIR/TMP/TEMP values are replaced with the owned scratch before children launch.

After the parent's explicit fresh browser grant, run one chunk at a time:

```sh
FUCQ126_FROZEN_REVISION=REVIEWED_FULL_SHA PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py smoke-desktop
FUCQ126_FROZEN_REVISION=REVIEWED_FULL_SHA PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py desktop
FUCQ126_FROZEN_REVISION=REVIEWED_FULL_SHA PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py narrow
```

Each chunk still requires fresh shared HostBudget admission: requested RAM
2560MiB, minimum 2048MiB, 128MiB scratch, 120 seconds, 2MiB log, one Chrome
instance. Retained evidence remains below 256MiB aggregate. Keep the recursive
and detached PID/start identity accounting, explicit profile ownership,
stop/join, port/open-file checks, filesystem deletion and external final receipt.
No native database, secret-file reads, dependencies, full suite or external sends.

Use the same actual same-origin `buildServer`/memory repository/canonical policy,
clock, identity, scenarios, ManualContextService and Greg services. Preserve the
localhost-only Lax/nonsecure cookie override and genuine UI issuance. Existing
manual-records inputs remain explicitly synthetic, with no stock/release producer.

The revised smoke asserts the initial Scenario selection equals actual
`currentScenario.scenarioId` after catalogue load. The full desktop/narrow matrix
also asserts that acknowledged reset navigates, reopens fresh controls, reads the
new run/context and shows a Presenter header/workspace with no previous employee
account body. Capture13 records this fresh-page outcome instead of stale-page
receipt text. Lost tick retry, unavailable scenario/release, keyboard/overflow,
busy, actual principal switching and acting-cookie-only hiding remain in scope.

The reset delivery variant preserves real Set-Cookie headers while dropping the
JSON body. Unknown delivery must keep the original command and remain on the page.
Its byte-identical retry can receive the backend's definitive `stale-run`; fresh
controls/context agreement on the different current run then navigates without a
`Reset done` claim. Record the backend limitation explicitly: this proves safe UI
reconciliation of authoritative current state, not replay success for every reset
delivery variant. Unit tests cover unchanged/mismatched runs and failed/partial
fresh reads refusing navigation. No reset/identity backend edits are included.

A new bounded teardown check fetches an actual controls reply, delays delivery,
navigates to a new actual workspace, then releases the old reply. The fresh root
must stay connected, its text and URL unchanged, with no late navigation. Record
the intentional aborted old request separately. Pending/refused visual fixtures
remain labelled and use the actual product style imports.

After smoke, inspect screenshots and its cleanup receipt before desktop/narrow.
The parent independently reviews new captures and final receipts. Earlier matrices
remain narrower evidence and do not satisfy these new regression gates. Actual
business release/count and complete business-scenario reset acceptance remain open.

## Shared-component alignment follow-up

This plan now targets the shared `presenterBar` disclosure/readback and controlled
`renderOptionList` Scenario and Acting principal pickers. Locate them by explicit
`radiogroup` names and `radio` children, with caller-supplied `data-value` for canonical
IDs. There are no native select controls for these choices. Verify initial actual
scenario only after options arrive, arrow wrapping and Home/End in each group, one
tab stop per group, selected value and mounted focused radio identity through an
ordinary readback, and disabled radio states during busy/uncertain commands. An
unavailable scenario remains selectable and exposes its missing capabilities while
Reset is disabled. Review compact Density styling, visible focus and overflow at
1280x900 and 375x812. The gallery includes the standalone helper and both pickers.
No browser was run for this alignment; the parent must grant the lane against the
new reviewed exact commit after the FUCQ-122 work has completed.
