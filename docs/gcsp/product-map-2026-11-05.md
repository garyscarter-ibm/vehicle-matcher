# Product map and scaffolding refresh — 5 November 2026

Russell requested scaffolding 0.7.1, the component map and an immediate alert to GC's poller.
The [connected map](https://garyscarter-ibm.github.io/vehicle-matcher/product-map/) covers 20
capabilities and all 107 authorised implementation Stories in the observed FUCQ backlog.
The [maintenance and publication contract](../../.product-map/README.md) explains its basis.

GC pollers: pull the published checkpoint, read the updated generated `AGENTS.md` section and
the scaffolding `product-map` skill, then maintain `.product-map/work.json` with your existing
claimed work. Record full slice plans and passed delivery evidence; missing plans remain unknown.
Keep Jira observations current through the authenticated connector. Preserve all leases, current
claims, retained branches and human pause boundaries. This tooling request does not restart a
dispatcher, take a Story, or change any Story's acceptance.

Project inbox setup was refreshed from 0.7.1. Existing helpers were already current, and the
project-owned `jira_sync.py` UI-intake repair remains intact. The new projector and static assets
are upstream copies. Codex reports the 0.7.1 plugin installed and enabled; the selected installed
skills, hook configuration and generated instruction template match source.

The live Codex gateway check passes on IBM Global. Doctor's Claude default-endpoint failure is a
different harness observation. Claude's root-owned installation manifest and Desktop marketplace
pin still need the administrator/restart steps prepared on Russell's machine; no application was
restarted during this task. Each contributing clone installs its own plugin update.

The tooling checkpoint is `23dea5f`, integrated with GC's concurrent changes in `cc563d9` and
pushed to `gcsp-poc`. FUCQ-100 Jira comments **132588** and **132590** alert GC's active poller;
the second includes the concrete checkpoint and publication request.

Public publication is **pending** [PR #32](https://github.com/garyscarter-ibm/vehicle-matcher/pull/32).
GitHub's protected `main` requires a review; `garyscarter-ibm` is the requested reviewer.
Automatic merge is disabled for this repository. After approval, merge through the normal PR
route, wait for Pages and verify `/product-map/data.json` and the rendered map. A successful
branch notification alone does not establish public delivery or per-commit refresh.

Scoped validation: 20 cards and 52 connections rendered at 1440px and 390px in isolated headless
Chrome. Story search, selection, keyboard navigation and snapshot refresh passed, with no page
errors or mobile horizontal overflow. Projector validation found zero diagnostics and complete
107-Story association coverage. Retail site assembly was preserved byte-for-byte. No application
suite was run because no application code or contract changed; the selector's generic full-suite
fallback was reviewed and excluded. Local preview: `.claude/product-map-preview/index.html`.

Claude's remaining private administrator and Desktop pin steps are in
[the installation note](scaffolding-install-2026-11-05.md). They do not block the generated map
or the refreshed project tools. No restarts or root-owned writes were attempted.
