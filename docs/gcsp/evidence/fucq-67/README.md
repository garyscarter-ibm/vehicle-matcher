# FUCQ-67 browser evidence

Completed on 5 November 2026 against product/capture commit `fcc8e139dd71ebcdec3fe510179cf35e952a13ec`, integrated base `058ed90daa1b53617d9f7125b8ab338d8f7d7601` (executable base `873539d8990032c1a1d6db303c477d58d8b84141`). The final matrix passed with `errors: []`: 16 full-page PNGs, 2,381,219 bytes, at 1280×900 and 320×740. The adjacent JSON retains source and capture SHA-256 values, sanitized API results, event payloads, keyboard observations and cleanup flags.

## Setup, reset and repeat

Run from the FUCQ-67 worktree root using its retained root/server dependencies, the bundled `playwright-core`, system Chrome, and the bounded external supervisor. The helper states their exact paths and refuses a missing supervisor-owned `TMPDIR`. No package install is needed. Obtain the dispatcher browser lane and a fresh HostBudget allocation before running:

```sh
python3 -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq67/lead-supervisor.py command --owner runner --name fucq67-repeat --command 'FUCQ67_CAPTURE_HEAD=fcc8e139dd71ebcdec3fe510179cf35e952a13ec FUCQ67_PRODUCT_HEAD=fcc8e139dd71ebcdec3fe510179cf35e952a13ec FUCQ67_BASE=058ed90daa1b53617d9f7125b8ab338d8f7d7601 node docs/gcsp/evidence/fucq-67/capture-fucq-67.mjs'
```

The helper creates a fresh isolated memory runtime and browser profile on every invocation, which is the reset. It uses delivered `createGcspRuntime` and the real `buildServer` GCSP handler. Policy/session time is fixed at `2026-11-05T09:00:00.000Z`, environment `fucq67-browser`, bootstrap command `bootstrap-fucq67-browser`, and canonical `createLocalSession()`. One ephemeral loopback listener serves static files and API requests at the same origin. Only the synthetic acting cookie enters temporary browser memory; no cookie value is printed or retained. Non-local requests are blocked and unrelated providers throw if called. The helper closes browser, listener and runtime on exit.

These are the repeated interaction steps, also usable by a collaborator with the same composed synthetic session:

1. Open `/gcsp-account.html` at desktop width. Check the current car, driver, supplied dates, term, mileage and allowance; the 1 December end date is 26 days after the supplied server date.
2. Use Tab to reach “Order, collection and vehicle details”, then Enter. Continue by Tab to the Choices history summary and press Enter. Check the visible focus outline, disclosed data and history record count.
3. Click “Choose a replacement” on the current-car card. Check the saved intent summary, exact old-contract/slot/scheme and version 1. The current car remains displayed.
4. Reload. Check the saved draft remains, click “Resume saved journey”, then “Back to account”. At 320 px repeat the account/resume/Back checks and confirm the original current-contract identifier remains unchanged.
5. Open `?fixture=multi-slot`, `missing-image`, `absent-hr-account`, `not-yet-eligible` and `source-failure` at both widths. Check long names, two cars and separate schemes, designed unknown-media/cost states, distinct reasons/support, and no horizontal scrolling. The second PCS card must not inherit the Choices allowance.
6. Probe `?fixture=no-current-car` and `?fixture=no-history` for their separate empty states. Fixture URLs are read-only visual snapshots; their buttons cannot create a saved journey. The actual-service flow in steps 1–4 supplies the persistence proof.

For a visual-only manual review, `npm run preview` serves the read-only fixture URLs at port 3000. Stop that server afterwards; the static preview does not provide the actual-service session or persistence.

## Reviewed captures and observations

The lead inspected all sixteen scenario captures across the browser checkpoints, then inspected the final saved/reloaded/missing-image desktop and corrected multi-slot desktop/narrow captures. The current final multi-slot pair is readable at 320 px, wraps the long model name and second-slot identifier, and shows an unknown PCS allowance while Choices retains 1,300. The other views preserve the approved FUCQ-64 body reference (`../fucq-6/README.md`, source revision `a7fc178`) and supplied screenshots 00/01 information inventory: clear vehicle hierarchy, shared shell, visible decision facts and labelled disclosures. Long pages scroll vertically; no view overflows horizontally.

| Captures | View | Observed result |
| --- | --- | --- |
| 01 | Actual service, desktop | Contract/history opened by keyboard; visible focus; original car retained. |
| 02–04 | Saved, reloaded and resumed, desktop | Version 1 remains; truthful intent summary and Back action. |
| 05–06 | Actual service, narrow | Readable stacked facts/actions; saved context retained. |
| 07–08 | Multi-slot, both widths | Two long-name vehicle cards, scheme-grouped history/counts; allowance isolated by scheme. |
| 09–10 | Missing image, both widths | Designed media placeholder and unknown exact specification. |
| 11–12 | Missing HR, both widths | Distinct HR reason and support action. |
| 13–14 | Not yet eligible, both widths | Contract retained with distinct renewal reason; no replacement shortcut. |
| 15–16 | Source failure, both widths | Distinct unavailable state with refresh/support. |

The actual HTTP sequence contains exactly one intent POST and subsequent successful draft GETs with `draftVersion: 1`. Save and resume emit the same exact six fields: `mode`, `oldContractId`, `slotId`, `schemeId`, `draftVersion`, `contextVersion`. All three observed event payloads agree. Save/reload/resume/Back at both widths preserve `current:employee-paula`. No selected replacement becomes the current car.

Two pre-save `GET /api/gcsp/manual/draft` responses are HTTP 404 with GCSP `not-found`, and Chrome emits two corresponding console resource messages. The matrix explicitly retains and classifies these expected empty-draft results. Unexpected HTTP errors, console errors, page errors and external requests are all empty. The matrix’s nested `historyGroupCount` counts all history details elements, not just top-level schemes; actual scheme counts are recorded in the API summaries.

## Resources, provenance and limits

Final supervised run `final-allowance-browser-matrix-1793892144081675000` passed in 12.4 seconds. Recursive ancestry accounting included detached Chrome: peak 1,518,174,208 bytes, scratch 9,781,401 bytes, within the 2,560 MiB browser cap and 128 MiB scratch cap. The HostBudget reservation and ownership manifest were recorded before allocation. The supervisor stopped/joined every owned group before removing scratch. Independent `final-browser-independent-cleanup.json` verifies Node group 37515 and Chrome group 37525 absent, all nine sampled PIDs absent, exact scratch/profile arguments absent, reservation absent, and API port 54674 closed. Dependencies and package hashes are unchanged. Detailed receipts stay in shared `.claude/test-runs/fucq67/`; the configured OneDrive output root is unavailable.

Earlier six-capture smoke measured only the Node process group, so it is not evidence of recursive browser-cap compliance. Its known groups, exact scratch/profile arguments and ports were checked independently. The first full matrix produced all captures but failed a case-sensitive harness text expectation for CSS-uppercase “Your current car”; this was corrected to count the two current-car sections. The final run above is the passing replacement. Visual review then found cross-scheme allowance attribution; commit `fcc8e13` fixes it and tests supplied, zero and unknown allowance values. Final captures and browser assertions use that fix.

These are synthetic local memory-service observations. Native PostgreSQL checks require a configured database and are separately recorded in the story’s full-validation result. No live BMW service, real VIN/source record, external send or deployment was used. Full FUCQ-68 options/stock selection and human visual refinement remain their own scope. One collaborator check: after integration, try Replace → reload → Resume → Back at 320 px and confirm the current car and slot remain unchanged.
