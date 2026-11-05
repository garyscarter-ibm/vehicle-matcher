# FUCQ-33 shared launcher review

Story DEV-2026-11-04-007, 5 November 2026. This record retains the early representative design, final rendered review, validation and repeatable trial for the shared launcher. Employee integration remains FUCQ-35; default absence of registration is a tested unavailable state.

## Design reference and component plan

Follow the supplied shell/palette references in `docs/gcsp/screens/README.md` and the approved employee body at `docs/gcsp/evidence/fucq-6/README.md`, revision a7fc178 (Gary, 5 November). The lead inspected its representative desktop capture and canonical HLD launcher/migration/deployment exports. Match its readable hierarchy, neutral/teal surfaces, spacing and image treatment. The launcher has no employee shell or account facts.

The lead verified and directly inspected all eight supplied files: `docs/gcsp/screens/00-employee-account.webp`, `01-replace-vehicle.webp`, `02-new-order.png`, `03-vehicle-series.png`, `04-vehicle-models.png`, `05-vehicle-details.webp`, `06-summary.png` and `07-order-confirmation.webp` (the latter seven share the same directory). They establish the white slim header, narrow icon sidebar, neutral panels/dividers and teal accents, while their dense legacy bodies remain redesign context. All are readable; browser/OS chrome and displayed junk data are excluded. The canonical HLD exports inspected for scope were `docs/design/gcsp-architecture.png` (shared entry), `docs/design/migration-and-regression.png` and `docs/design/deployment-and-integration.png`; no diagram source or proposed status was edited.

Reuse el, screenIntro, button, mediaWell and semantic VM/GCSP tokens. Add experienceChoice and brandSelector as consumed shared primitives because existing result cards own exact-car decisions and question controls own answers. Catalogue, single gallery, styles and tests accompany consumers; checked external launcher modules replace inline index rendering. Preserve all six retail brands, mounts and context, plus the FUCQ-31 kit and FUCQ-97 outbox additions.

## Planned trial

Serve with `npm run serve` plus `npm run server`, open `/` for the launcher. Select a brand and open Used cars; use `?experience=used-cars` for the retained picker and legacy `?brand=mini` for its shell. Explicit `?experience=launcher&brand=mini` must show MINI without changing it for employee coverage. Employee defaults unavailable until a real enabled mount is registered. Reset by reloading the initial URL.

Review desktop and 320px, all brands, no brand, unsupported and unavailable recovery, keyboard/focus, reduced motion, failed imagery/logos, loading and long names; inspect actual supported routing and context. Browser receipts identify source hashes and isolated owned processes. Final screenshots and findings follow below.

## Early rendered review

The representative design was rendered and reviewed before the second implementation slice, at source commit `bc2e358b245fc6a78f3814ebf4cdf78b37899fa4`. The lead directly inspected `fucq33-early-default-desktop.png` and `fucq33-early-mini-narrow-320.png`; all four captures and the measurements remain in `fucq33-early-browser.json` as historical evidence. The two destination cards balance at desktop and stack at 320px, both labels remain visible, all imagery loads, and no horizontal overflow, browser error or failed request was observed.

Two decisions followed this review. Keep the explicit Choose BMW step, including when employee integration is unavailable: it changes the visible selection only after the visitor acts, and then exposes the disabled employee action with an explanation. Refine the initial retail-blue/BMW typography to the approved GCSP body language: system typography, normal-case headings, neutral surfaces and teal actions. Extract the consumed GCSP primitive styling into the shared kit so launcher and employee body share the same source.

Source review also found that rebuilding recovery links from the raw employee URL could reintroduce retail fields stripped by the entry resolver. The second slice uses the resolver's canonical safe location and adds a direct-entry regression; this preserves the existing routing boundary.

## Machine validation

The final product source is `e16cf52f06274dfe9164af6d72765b5de8ad220d` on `dev/DEV-2026-11-04-007`. The exact required launcher check passed 22/22; the exact UI-ratchet and retail-render check passed 65/65. The latter mounts all six retail brands in all five modes over the real local API. Shared component/gallery checks preserve the FUCQ-31 work and captured outbox. The extracted GCSP primitive rules are unchanged; the employee stylesheet cap falls from 114 to 92, with the new shared kit explicitly capped at 26. No existing debt allowance increased.

The required exact `npm test` ran once on this clean product source: 969 tests, 967 passed, 2 skipped and 0 failed in 13.7 seconds. The two optional PostgreSQL checks require `GCSP_DATABASE_URL`; this run used the existing offline/default configuration. No command, concurrency or Node-options variant was substituted. Matching full status confirms key `f1e248806fb8d6c80ef98ea0cb1fd66649a3c22f69327c7bbbf22065849c2cfe`, tested HEAD tree `039c3d6e38e6296ea1915984684c38ff88fef286`, actual code identity `cf5814fe90becaf56e263259ac2e1e655a0df87325f2e50835246a411d9fcc88`, default variant, Node 26.5.0/npm 11.17.0 and Python 3.9.6. The stamp key excludes documentation, so final evidence/result commits preserve its product identity. The full supervisor measured 1,740,177,408 bytes peak RSS and 547,968 bytes peak scratch. The lead independently verified its owned root absent, group 12580 dead and reservation released.

The explicit boundary selection and refreshed impact map are retained under the shared `.claude/test-runs/impact/`; the JavaScript project has no observed affected-test selector, so reviewed callers plus the prescribed commands determine coverage. Targeted proof is separate from the full stamp. The exact tested comparison base was `gcsp-poc` at `1ad1664e30a8b5eaadc74510152eaf683b71a3b0`; its changes since the claim commit were inbox, mail and claim metadata only. The dispatcher owns final integration with any later base.

### Strict stamp reuse and merge guards

The bounded validation policy was injected in the launching process, with no persistent project configuration change. The unmodified strict status checker consumes that proof when given the same policy and environment. Run the following from this worktree with the same shell environment as validation; do not add a per-command `SCAFFOLDING_HARNESS` value to this read-only status command, since it was absent from the test environment and the strict identity includes it.

```sh
/usr/bin/python3 -B - <<'PY'
import importlib.util
from pathlib import Path
root = Path.cwd()
spec = importlib.util.spec_from_file_location('fucq33_status', root / '_tools/test_stamp.py')
stamp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stamp)
original = stamp.load_settings
policy = {'chunk_seconds': 300, 'chunk_scratch_mib': 128,
          'unit_scratch_mib': 32, 'chunk_ram_mib': 4096,
          'unit_ram_mib': 256, 'log_mib': 2}
def settings(selected_root, command_override=None):
    result = original(selected_root, command_override)
    result.resources = {**result.resources, **policy}
    return result
stamp.load_settings = settings
raise SystemExit(stamp.main(['--root', str(root), '--status', '--command', 'npm test']))
PY
```

This exact recipe returned the matching full stamp. The resource settings digest is `8648cc060ad6647253dd5cf552ffe8279076e8269ac5012f1bac3051ead67aa8`; the environment digest is `d75cffa1e6ff2403ae5eb5b53e75469d73684885cd11aad41d8e12e262d234d9`. Changing either correctly prevents reuse. The vendored `scaffold_git.py` does not implement a test-stamp guard, and no `scaffold_ext.py` is installed. Its normal read-only merge checks against `gcsp-poc` returned `merge_refusal: None` and `pre_merge_refusals: ('ok', [])`, without any policy override or weakened guard. No merge was performed by this story lead; the dispatcher retains the normal claim, identity, protection, freshness and integration checks.

## Repeatable review trial

Use the locked root and server dependencies. From the repository, run `npm run serve` and, in a second terminal, `GCSP_OFFLINE=1 npm run server`. Default local ports are 3000 and 8787. Open the root page at localhost port 3000; no employee account or external stock feed is needed for this launcher trial.

1. At `/`, read both destination descriptions. Leave All brands selected and open Used cars: the retained six-brand picker appears. Reload `/` to reset.
2. Select MINI. The visible brand and Used cars action say MINI; opening it reaches the retained MINI retail shell. Repeat with BMW, Ford, Honda, BMW Motorrad and Ferrari. The initial questionnaire is available from the local questions API.
3. Open `/?experience=launcher&brand=mini`. Employee cars explains BMW coverage and offers Choose BMW. Activate it: the selector visibly becomes BMW and the employee action becomes unavailable with its reason. No employee page is offered until a genuine enabled entry is registered by FUCQ-35.
4. Open `/?experience=employee-cars&brand=bmw`, then the same path with `brand=mini`. Both retain a working Used cars recovery route. MINI stays explicit until Choose BMW; direct employee recovery drops buyer answers, retail overrides and hash context.
5. At 320px, tab through the labelled native brand control and available actions. Use the keyboard to change brand and activate a destination. Labels, focus and unavailable reasons remain visible. Simulate failed imagery/logos: destination text and brand options still identify the route.
6. Open `/components.html` and inspect the Car experience launcher examples: long title, loading, unavailable explanation and absent-image fallback. Its local brand change saves nothing and navigates nowhere.

Reset by reloading the starting URL; the launcher selection is local to the rendered page. Review registration only through the tested `bootDemo` capability contract; the browser's injected callback test is not an employee application integration. The observed final results and any limitations are recorded below.


## Final rendered review

The lead directly inspected all 14 final captures at frozen product source `e16cf52f06274dfe9164af6d72765b5de8ad220d`: default and MINI launcher at 1280px and 320px, employee body reference at both widths, MINI Used cars at both widths, retained brand picker, unknown-experience recovery, employee recovery, failed-media fallback, and the launcher gallery at both widths. The files are under `fucq33-final/`; the browser receipt records the viewport and source hashes for each case.

The default and MINI launcher use the approved system typography, normal-case headings, teal actions, neutral page and white image-led cards. Destination names and descriptions remain clear, the desktop cards balance, and the narrow layout stacks without launcher overflow. The selected brand remains visible beside a labelled native control. Employee unavailability and the explicit Choose BMW action are understandable, and recovery keeps Used cars available. The deliberately failed MINI image uses its designed dark media well and text label; a failed decorative logo falls back to MINI text. The gallery's long name, loading and unavailable states wrap legibly at 320px, including their explanations and disabled actions.

The adjacent employee body retains the approved a7fc178 composition and visual language at desktop and narrow widths. Its shell, body JavaScript, tokens and HTML hashes match the reference; only the consumed primitive CSS was extracted to the shared kit. The unchanged source comparison and computed-style checks accompany the browser evidence. Existing gallery examples remain present; the outbox is preserved by unchanged source and machine tests and has no gallery example.

The retained MINI retail shell remains visually intact at desktop. At 320px, its top-bar link extends the page to 396px. The lead directly inspected `fucq33-followup-20261105/fucq33-followup-mini-current-narrow-320.png` and `fucq33-followup-mini-claim-baseline-narrow-320.png`: current source and the claim commit's saved index both have the same 76px overflow. The baseline HTML was route-fulfilled against the same local retail assets. Its local API fetch hit Chrome's loopback access restriction, so that capture proves the retained header/layout issue only; current retail API mounting is established separately by the passing main browser cases and machine checks. This is a pre-existing adjacent retail limitation, not a new launcher regression. The retail picker/modes rebuild remains outside this story's scope.


The focused CSS check strips `@import` declarations before parsing. It confirms exact composition of the approved 75 rule blocks: 56 retained employee rules plus 19 shared-kit rules, with identical declarations and no missing or extra rules. The historical harness counted 18 because its import-prefix parser skipped the first `.gcsp .vm-title` rule. The source was not altered to fit that erroneous count.


## Browser assertion disposition and limits

The full final receipt retains 26 cases and 236 assertions: 226 passed and 10 were red. The targeted follow-up retains 28/33 passed; the bounded headed native-select retry retains 0/1. These are evidence with explicit review dispositions, not an all-pass browser matrix. `fucq33-validation.json` accounts for every red assertion by receipt, scope and ID and links replacement proof or the exact limitation.

Eight original red assertions were harness errors resolved by replacement checks: four measured the Employee ghost action instead of Used cars primary, two compared the wrong CSS sets with an import-prefix parsing error, and two used a changing Employee gallery heading. The corrected Used cars action has teal fill, white text and 6.07:1 contrast in all four default/MINI width cases; exact stylesheet composition and stable gallery content/control checks pass. One original red assertion is the measured pre-existing MINI 320px overflow described above. The remaining original red assertion is native select option-picking, which stays unverified by automation.

The native select retained focus but stayed on MINI in headless and headed open/keyboard attempts. The lead inspected `fucq33-followup-20261105/fucq33-keyboard-retry-native-select.png`; its focus ring and 320px layout are clear. This establishes an automation limitation, not a confirmed product defect. The control remains a labelled semantic native SELECT with no custom key handler. The original actual Tab order, visible 2px focus and Enter activation of Choose BMW pass, and all six brand-selection/change and real Used cars routing cases pass. The collaborator check is to choose an option in the native control using the keyboard at 320px and open Used cars; native popup option-picking is not claimed as automated proof.

The five red follow-up checks are also explicit: native option-picking remains unverified; its dependent Enter check had an invalid precondition and is replaced by the original passing Tab/Enter recovery proof; two network checks hit Chrome's loopback restriction only for route-fulfilled claim HTML; and a retained-fallback check incorrectly required a screenshot for the old MINI fallback case. That old case's DOM, injected failure paths and original assertions already pass, while the launcher's fallback has a directly inspected screenshot. The headed retry's first capture additionally raised a reporting-only ReferenceError after saving the observed state; its history records the single reporting correction repeat with the same failed assertion. No product source changed.

The lead judges the story built: the implementation, changed launcher/gallery experience and required machine checks have evidence, with no confirmed new product defect. The retained MINI retail overflow and unverified native popup automation are distinct limitations. Employee application integration remains FUCQ-35. The dispatcher retains the final integration decision.

## Final resources and handoff

`fucq33-validation.json` consolidates exact machine identities/counts, all browser resources and every red-assertion disposition, reference/capture hashes and the independent final ownership audit. Seventeen owned manifests were checked: disposable roots absent, process groups dead, all eight browser ports closed and no own shared-host reservation. Only compact run metadata/logs/checkpoints and the intentional final evidence remain. The early historical temporary lead root outside the final owned path is also absent with group 654 dead. The browser runner's one read-only direct Git content check before rereading the adapter instruction changed no state; saved baseline and later reads used the adapter. Its short-lived manual server pair was stopped and its ports independently checked closed.

The final observed shared base is `fc515983d15b2807a307d0894c343d4433c328aa`; changes since tested `1ad1664` are only inbox/claim/review documentation, including the other collaborator's DEV-083 claim. No product delta affects this proof, and that claim is untouched. Product source remains `e16cf52`; final evidence/result documentation preserves the strict stamp identity. No Jira synchronisation, borrowed credentials, merge, close, release or follow-on mail/job was performed by this story lead.
