# Follow-up entry implementation checkpoint

6 November 2026. Root approved the minimal implementation described in
`followup-entry-plan.md` after reviewing published `373d89a`. This is an **authored,
unexecuted checkpoint**, not passing evidence or story completion.

Changed owned paths:

- `server/gcsp/offers/access.js`: private exact-offer decision/native-receipt/history
  verification; additive `followup: null | { decisionId }`; membership/content and
  run-policy/clock consistency rereads. No new route, public input, persistence write,
  deadline change, role conversion or dependency on 106's implementation module.
- `server/test/gcsp-offer-access-followup.test.js`: eleven named focused cases using
  actual pinned producer, decision, identity, BriefService and follow-up services.
- `docs/gcsp/offer-access-contract.md`: additive field, null/unavailable distinction,
  reload/authentication requirements and open adoption/validation gates.

The test fixture starts with real 100-produced rows, performs canonical 103 reason
adoption through the actual PolicyService publication port, reissues the real employee
session with the active policy pin, then calls actual 106. Only the canonical opaque
decision handle is returned by 102. 107's owned question bundle is an explicitly
injected policy input for these boundary checks; it is not proof of default question
registration. Adversarial cases deliberately corrupt clones of those real producer
outputs, or inject read races; they are not presented as valid producer behavior.
The suite imports no server bootstrap and owns no listener/browser/native resource.

The eleven cases cover lost-response/reload plus explicit 107 confirmation, private
instance/owner/run authority, non-decline states without lookup, distinct decision and
quoted brief versions, terminal revisions/quote expiry/later stock use, incomplete or
duplicate sources, native receipt integrity, linked authority, revision/time corruption,
repository failure and query/history/clock/policy races. Assertions use state digests
for no-write checks so a failure does not print outbox credentials. Raw credentials
are read only from the actual producer outbox in memory, never from test-authored rows.

Static review only: diff whitespace checks and the eleven-case source inventory.
No JavaScript import, test, proof, supervisor, build or runtime allocation has occurred.
The unchanged earlier 32/32 receipt remains retained in `decline-timing-result.md`;
it does not validate the new helper or current changed read function. Root requested
reuse of unchanged evidence and a new narrow graph, not another unchanged full run.

Next: publish the finite actual 106/107 source/input/dependency graph, strict loader
and adapted supervisor, then stop for root's source/harness review before execution.
Required budget remains fresh HostBudget, one worker, 120 seconds, 768 MiB aggregate
RAM, 128 MiB combined scratch/output and 2 MiB logs with external ownership manifest,
finalizer, strict process/group/reservation/filesystem absence and source readback.
No listener/browser/native/full or shared runtime/identity/schema/seed/96 scope is added.
105 projection/host adoption remains with its lead; 107 client validation remains open.

Agents: Hugo; requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants.
