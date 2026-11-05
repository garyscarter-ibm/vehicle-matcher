# Vehicle matcher product map

Open [the connected component map](https://garyscarter-ibm.github.io/vehicle-matcher/product-map/).
The initial registry describes 20 product capabilities and explicitly associates all 107
implementation Stories observed in Jira FUCQ on 5 November 2026. The HLD and the authorised
story records in `docs/gcsp/README.md` establish these boundaries. Refinements keep stable IDs;
this registry does not add backlog scope or change application architecture.

`components.json` owns the capability definitions, connections and Story associations.
`work.json` holds the minimal Jira observation plus durable slice plans and worker observations.
Epic references provide context and do not count again in component progress. Rejected work
is excluded. Jira assignees describe human assignment; historical agent labels do not establish
live workers. The initial snapshot has no inferred worker claims or invented slice percentages.
Open Stories without a verified slice plan remain unknown; completed development and acceptance
remain separate. Deferred Stories stay visible in the planned scope.

## Update at each delivery boundary

Read the scaffolding `product-map` skill. Use `_tools/product_map.py --root <absolute-project>`:
declare the complete slice plan, including integration and validation, before reporting fractional
progress. Record a slice complete only with the Story Lead's delivery evidence. Commit the facts
with the work. Import a fresh bounded Jira export with `import-jira --issues <file>`; it preserves
slice plans and worker observations. A fresh build does not refresh an old source observation.

The initial slice-plan gap is intentional: existing Result blocks and resumed branches must be
reconciled by their claim owners before exact progress can be reported. Do not mark those Stories
explicitly unsliced merely to turn unknown progress into zero. Do not restart a paused poller.

## Publication

Actions mode is integrated into the existing `.github/workflows/pages.yml`, retaining its explicit
retail asset selection and API rewrite. The separate `product-map-refresh.yml` performs no checkout
or branch-code execution; its completion requests the trusted main workflow through `workflow_run`.
The publisher checks out main, fetches pushed refs, uses the main projector and reads only map JSON
from the active branches. Within that isolated CI checkout, the map's data baseline is `gcsp-poc`.
Main holds empty map-input stubs so it cannot reintroduce a stale copy of GCSP delivery facts.
The GCSP application is not merged into the retail deployment.
The existing main-only Pages environment policy is preserved.

Main pushes, refresh-workflow completion on contributing branches and manual dispatch publish a
snapshot. Local-only work and Jira-only changes are not visible until collected, committed and
pushed. Branches need the refresh workflow after pulling the tooling checkpoint. No persistent
runner is installed, and no credentials or raw Jira descriptions are published.

For a local preview of this checkout's recorded facts, run the vendored
`build --no-branches --output <absolute-output-directory>` command and open its `index.html`.
The generated `data.js` also supports file previews. The published map also collects active
branch changes against the GCSP baseline, with conflicts and source revisions disclosed.
