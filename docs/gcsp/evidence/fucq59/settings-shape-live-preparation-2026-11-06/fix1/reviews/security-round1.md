# F59 preparation SECURITY correction review — round1

Full preparation range0f0696861dbffd3f75ee21e2396341c701689a4d..521acf3335c4fc57abb6458d91a3944990eee3db. Correction deltaac39df9589aaaedddd67a02241494a500e85e0bb..521acf3335c4fc57abb6458d91a3944990eee3db. Parent launcher gpt-6.1-sol/xhigh independently reviewed the producer's correction under scaffolding:security-review and references/controls.md, after completing the preceding full security review in parent-security-round0.md. Pugh has no final verdict; no verdict is attributed to that interrupted agent.

Read the complete preceding helpers, plan/handoff, tests and actual enforcing source/closure/process callees, then all changed Python logic and regression assertions, all changed hash/allocation bindings and F59-only story/map facts. No new network, source, shell, credential, raw retention, deserialization or privilege boundary is introduced by this correction. Trusted HostBudget path/token and the short ledger lock are the only new read boundary.

supervise-settings.py:141 release_reservation calls the trusted release, then independently verifies only its generated owned token against a bounded131072B nonsymlink JSON dictionary under resources.locked(host.directory/reservations.lock). Failed call, retained token or unavailable verification produces fixed failed/still-present/unverified status. Exceptions and unrelated ledger entries are never returned/logged. Even a failed release followed by observed absence remains a failure. No broad deletion or ledger mutation is added.

supervise_once keeps an earlier failure or sets reservation-cleanup-failed, adds only reservation:<own token> to leftovers, and persists the fixed release result. terminal_result uses the same result in both printed summary and nonzero exit. main now calls that shared decision, so the tests exercise the actual terminal path's logic. Registration, source marker and all finite source/privacy gates remain unchanged.

The three new fault regressions use actual test-owned reservations and clean only captured tokens through independent test finalizers. A fourth checks verified-success completion. The12method green proof and its red failures are causal scoped evidence; unchanged18Node/33producer proofs are reused without recounting them as new. No tests, producer imports, source requests or scratch allocated by this review.

Pinned supervisorb54db5af92313ee7b190dd8ef9bc0d96e9470b8ac6c9af4e1791f4352c7c775e; supervisor tests929422f788b9c5c164cec7c49660097732c4ba27f36d3f963e36c277f7447f50; handoff11076d9b30b7e2f981049bcd5e87323f4e427ca80d3ffc0d64b7ecdcc5526900. Preparation identityeecc0f714f7680083c180082ccc0674c3590ca652cdaabefe264899eecd757f6; independently computed supervisor code/test identity432eb34827185a4795ce20afdcffb5a60903244036f701a462231237bf756c3d. Producer identity9d63aa36a7bbbb29432d4a8b03f2cd585abfdd4e53d671919a8798f28f674a1b unchanged.

Parent independently verified13published paths/11external copies, exact current Python environment/resource and reused Node runtime identities,45tracked+6external immutable files, F59-only map changes, all11current resources absent and prior7absent. Published topic521acf3335c4fc57abb6458d91a3944990eee3db and remoteSHA match, task paths clean and Codex trailer present. Audits: settings-supervisor-fix1-prepublication-parent-audit.json and settings-supervisor-fix1-publication-parent-audit.json.

NOTE: The ledger verification's size/read/lock refusal remains fail closed; it is not proof of missing reservations.
NOTE: Trusted same-process transport/operator selections, truthful byte overruns and SIGKILL limitations retain the exact boundaries in round0. Synthetic tests do not establish network provenance or real source qualification.
NOTE: Independent CODE correction review is still pending. This security PASS does not allocate source execution or acceptance. Future selection/marker/observation/supervision remain absent; source allocation0. F59sixcomplete/twoblocked,accepted0/admissionfalse/all74pending and F39-F54/F60/full/native acceptance gates remain open.

VERDICT: passed
