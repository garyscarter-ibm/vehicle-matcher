# FUCQ-126 scoped browser proof

Executed 5 November 2026 against runtime revision `3443301`, with documentation
checkpoint `e45732e` at HEAD. Runtime files were compared with `3443301` before
and after each chunk. Only this evidence directory was authored by the browser runner.

The actual HTTP matrix passed at **1280×900** and **375×812**. See
`browser-results.json` for selected scope, resource receipts and remaining review
findings. This is scoped UI/HTTP evidence, not complete live business integration acceptance.

The runner composes the actual `buildServer`, memory repository, canonical policy,
DemoClock, identity, scenarios, ManualContextService and GregDemandService on one
loopback origin. Its only policy override is localhost cookie `SameSite=Lax`, with
`secureCookies:false`. Initial presenter bootstrap is trusted server setup; later
Paula → Greg → Paula changes use the actual UI endpoint, cookies and context.
Account content uses existing explicitly synthetic `manual-records-v1` inputs,
inserted after resolving the browser's genuinely issued employee session.

Verified: native disclosure/keyboard focus, visible focus outline, no horizontal
overflow, one request while busy, policy-owned step and named cue, unavailable next
release after its cue, typed invalid-field explanation, unavailable business
scenario, reset cancel/confirm and new run, acting-cookie-only presenter hiding,
controlled read outage, and lost tick response followed by byte-identical retry.
The lost-response test commits the real request before dropping delivery and proves
the clock advances once. The busy test delays the real reply without replacing it.

Pending/refused handler states are separate, prominently labelled synthetic visual
fixtures. Use `browser/visual-desktop/17-synthetic-*.png` and
`browser/narrow/17-synthetic-*.png` for final styled proof. Earlier desktop gallery
captures predate the final fixture CSS imports. They do not prove a real release
producer, a real release count, or a complete business-scenario reset.

Two actual-browser findings were sent to the parent before any runtime changes:

- Initial controls read sets scenario selection before the catalogue arrives. The
  facts show current clock mechanics while the selector defaults to the first
  unavailable journey. `dataset.initial` prevents subsequent correction.
- Reset renews actual acting context to Presenter, while the existing Paula
  header/account body remains until reload. The drawer updates context without
  remounting the dependent workspace.

The browser assertions pass for the selected matrix; these findings remain review
items and prevent claiming the complete experience gate is closed.

Reproduce one chunk at a time from this worktree, using installed Node, Playwright
and Google Chrome:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py smoke-desktop
PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py desktop
PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py narrow
PYTHONDONTWRITEBYTECODE=1 python3 docs/gcsp/evidence/fucq-126/browser-supervisor.py visual-desktop
```

Each chunk requests 2560MiB RAM (minimum 2048MiB), 128MiB scratch, 120 seconds,
and 2MiB logs. HostBudget admission uses current shared headroom. The supervisor
removes database URL/PG connection aliases without reading credentials, records
external ownership/checkpoints, tracks recursive and detached Chrome identities,
enforces the admitted RAM cap, closes listeners, stops/joins children and proves
process/profile/open-file/port absence before removing scratch. Every recorded
scratch root is removed; retained browser output is about 4MiB. One low-RAM
admission refused before launch. One harness-only field-name expectation was
corrected; its bounded failed attempt remains in the ignored run directory.

External receipts: `.claude/test-runs/fucq126-browser-20261105/`.
Selection map: `.claude/test-runs/impact/fucq126-browser-selection.json`.
Successful verbose logs were removed. The existing exact dependency symlinks are
unchanged and remain the parent's final cleanup responsibility.
