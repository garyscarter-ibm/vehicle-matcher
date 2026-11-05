# FUCQ-106 independent decision checkpoint

The 23 scoped checks in `gcsp-offer-decisions.test.js` passed against the exact
new-module/test hashes recorded in `scoped-service-checkpoint.json`. This is not
a built-story or deployed end-to-end claim.

The service records local accept/decline outcomes transactionally, returns original
command responses on replay, refuses changed intent and stale/foreign authority,
preserves pinned prices while checking current eligibility, and returns truthful
HTTP refusal/current-state outcomes. Source events use a native receipt namespace;
no downstream consumption is inferred. Decline, one confirmed brief change and
satisfaction remain distinct.

The test input adds the proposed fixed reason registry to an explicitly alternative
PolicyService source. Production decline remains unavailable until the canonical
reviewed-assumption bundle is adopted through the real provider/activation path.
Reasons use the current run policy pin separately from the held price pin.

The shared merged recommendation kernel is exercised with an actual authenticated
account, through an explicit test bridge. Actual FUCQ-100 stored-subject export and
producer/expiry, FUCQ-102's private account/token capability, confirmed remote
selection/release, consumers, central host and native/full validation remain open.
No fixture closes those gates. Remote mode fails closed without changing stock,
slot, hold, quote or decision authority.

Backend-only: no screen/component changes. `offer-decisions-contract.md` records
the response and state contract for FUCQ-105, shared shell/body references and
Density tokens. HTTP checks use in-memory request streams without a listener.

The resource supervisor stripped database aliases and NODE_OPTIONS, used one
worker, registered ownership/finalization before scratch and an exact temporary
link to the existing approved dependency installation. Every run removed owned
scratch/link, stopped/joined owned groups, verified no live sampled processes/open
files and released HostBudget. The installed dependency target was preserved.
The first import-only run lacked pg resolution; two intermediate alternative-policy
fixture revisions failed validation. Those failures and cleanup receipts remain
bounded under the shared `.claude/test-runs/fucq106/` directory; the final check
passes and does not hide them as production failures.
