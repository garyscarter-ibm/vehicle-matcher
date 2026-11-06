# FUCQ-134 scoped clock and mechanics result

6 November 2026. **Scoped PASS:** two actual-reader clock processes passed, followed
by exactly three memory/loopback mechanics cases with Node, controller, independent
completion audit and outer/tool join all exiting 0. Root independently collected
the retained evidence: `PASS-SCOPED-COLLECTION`, 472 checks, no failures, at
`2026-11-06T14:19:23.759503+00:00`. This establishes the selected clock/mechanics
boundary only. FUCQ-134 and all existing incomplete slice states remain unchanged.

## Tested identity and authorization

HEAD, upstream and live remote were clean and identical at runtime and root
collection: `5a28ff340247c47cc340cecfa999a8df23593bb4`. The composed consumer uses
published actual66 `eb5a677b37c486e3da7c4547803f739e22df8ac3`, its matching
ManualContextService, and the explicit synthetic F70 fixture variant. This is not
shared-runtime or live-service integration evidence.

- Admission SHA-256: `1e6a0151cbd8ba8b1951fb02a8e0597b3821c651ad8ae5d57843f65e080f5104`.
- Composed source identity: `92911cf980e13502fd897fb4a6b6f01be38b5477d691c865ced7b1437ecc81c9`;
  45 sources, 975883 bytes, 72 accepted edges, 236 physical bindings.
- Supervisor: `58973cd2e52c3d3eff8194795c877b5e2a863061c345d7e0644de2c8a27589ae`;
  completion: `8302181c22211fc7ce18c44d4013f583c3b4a47381533add977f9db1664c94d3`.
- Freezer: `b6c972882db06fc48fe165ae944ee76587d27b2a0a1a6fc52b0f9209e65ea7d3`;
  strict resources: `301cb06742ef1fe4fac4d35f63b7e6a1accbc3ac743a21a23b18a1c2a40e6a1c`.
- Test: `34cf8ec2498146c3fd4bca5631835278ac77ff06022107359d304a54c4f1fb71`.

Both once-only grants are consumed: `fucq134-clock-semantic-5a28ff3-1321` at
14:11:42Z, and
`fucq134-first-chunk-1e6a0151cbd8ba8b1951fb02a8e0597b3821c651ad8ae5d57843f65e080f5104-1321`
at 14:13:25Z. The latter's required executor argument is `--dispatcher-grant`
with `fucq134-first-chunk-1e6a0151cbd8ba8b1951fb02a8e0597b3821c651ad8ae5d57843f65e080f5104`,
without the coordination suffix. These identify one attempt. No further grant or
execution follows from this publication.

## Observed results and resource receipt

The actual producer and consumer readers used the same label:
`{"kind":"CLOCK_UPTIME_RAW","platform":"darwin","units":"seconds"}`. Producer
timestamp `648695.441455958` and consumer reading `648695.66506425` yielded finite,
nonnegative elapsed time `0.22360729204956442` seconds. Both children and the driver
exited 0; stderr was empty. Eleven invalid/future timestamps, four absent/wrong
labels, and unsupported platform/API variants in both readers and the elapsed
function were refused. Total wall time was 0.7724 seconds, child output 1914 bytes,
reported conservative RSS 97468416 bytes. Limits were 10 seconds whole, 3 per
child and 8 KiB child output within the shared resource contract.

The controller selected only `isolation`, `real-claim-review-allocate` and
`untaken-expiry`: TAP tests 3, pass 3, fail/cancelled/skipped/todo 0. Full expiry
assertions passed. Controller 0, Node 0, audit 0 (`state: complete`) and outer/tool
join 0 are separately recorded. Supervisor elapsed 5.31 seconds; audit preoutput
elapsed 5.61 seconds. Peak aggregate RSS was 225165312 bytes, combined allocation
1175361 bytes and audit RSS 19972096 bytes. Bounds remained 120 seconds whole,
110 execution, 768 MiB recursive RSS, 128 MiB combined allocation, 2 MiB log,
one worker and 5 GiB host reserve, with the existing completion margins.

**Original receipt remains `passed:false`, `candidatePassed:true`,
`awaiting-independent-parent-audit`; checkpoint remains `incomplete`.** They are
immutable provisional records by design. Successful independent audit stdout
plus the actual audit exit 0 supplies completion evidence separately.

Claude's post-run collection found the semantic driver/children and controller,
shell and owned descendants absent, with no group/open-file members or remaining
scratch and both exact reservation tokens absent. A later foreign ledger row was
preserved. Root's later independent collection observed 811 process rows,
`lsof` exit 1 with empty stdout/stderr, absent owned processes/groups/scratch and
both tokens, and a locked raw ALL-row ledger containing 0 rows. These are distinct
observations. Root executed no target/helper/test, signal, deletion, allocation or
ledger mutation during collection. This publication reuses that cleanup evidence;
it performs no new process/ledger probe.

## Review provenance

Beaky Buzzard's separate independent source review PASS covers the clock repair
at the tested revision: requested/selected `gpt-6.1-sol/high`, no fallback or
descendants. It is static source evidence, distinct from the local driver's review.

Driver author: Cecil Turtle, managed story-lead, Opus 5.5/high. Reviewer: Mater,
managed reviewer, **self-reported Opus 5.5 LOW effort**. First review FAIL on driver
`c3b4774c5f4169f5b659b1f1d2faf0a8ee3a3a593d238b59803c9d9cf91c5479`: whole
10-second deadline/backstop major, plus cleanup kill/join guarding, stored-output
size, unchecked `lsof` stderr and release-reporting minors. All five were fixed
before runtime. Second review PASS covered the exact driver/plan hashes below,
with these three accepted caveats unchanged:

1. Join after EOF could exceed 3 seconds if a child closed pipes without exiting;
   the outer alarm/backstop bounds it, and these children exit after printing.
2. Worst-case cleanup is about 4 seconds of a 4.25-second budget, with a tiny
   SIGTERM gap before the CLEANING flag.
3. The plan's Failure section retains a stale sentence about a now-masked Popen window.

Runtime was inline and serial, with no agent running during either runtime step.
Publisher Foghorn Leghorn: requested/selected `gpt-6.1-sol/high`, no fallback or
descendants. No new review tier or effective-setting claim is inferred.

## Retained original evidence

Paths below are relative to the shared checkout
`/Users/garycarter/Code/GitHub/vehicle-matcher`, not this story worktree. Raw reports,
drivers and coordination records remain local ignored `.claude` evidence; only
this concise result and map facts are tracked. All identities below are SHA-256.

| Original path | SHA-256 |
| --- | --- |
| `.claude/results/claude-assist-fucq134-2026-11-06-03.md` | `490d92be69496d4584c7e959e8c290a6887e7a4524f5eb573e43f9f9e401fef9` |
| `.claude/coordination/fucq134-runtime-collection-1411.json` | `f91076f4f7c5d9227dbad9c1092e19d6b5cc1b64fe594f517ff2c449bcc8f9d6` |
| `.claude/reviews/fucq134-beaky-clock-1321.md` | `d51d75c5f0ba3d221bc642a1ada1ce1dad22a4dc227008df7e6530db0ea63c1c` |
| `.claude/test-runs/ownership/fucq134-clock-1321-driver.py` | `96ad81b96c1bfb4748ec6cfabdbbb748c7995026dca1ad81ec2ee2d6c7104881` |
| `.claude/test-runs/ownership/fucq134-clock-1321-plan.md` | `94e4e8591fcc6e675f742b1bb5b79b6075c7ca0ee9a1a1268a7f85cfc309706f` |
| `.claude/test-runs/ownership/fucq134-clock-1321-journal.json` | `9c2865fbf97238f8f726ca3402baf1d935edc8243856f1dc88cdbe8862a54c8e` |
| `.claude/test-runs/ownership/fucq134-clock-1321-stdout.json` | `1c4a0c12d5225fde264d2ce6eef088ba35fc7770f9f7acbf603e8ffc7a080a17` |
| `.claude/test-runs/ownership/fucq134-03-controller-audit-command-1413.sh` | `c16df3dce47ef925ff67c9f1bd9a9d89fa5c99040405ea8a06a3a0b50d877543` |
| `.claude/test-runs/ownership/fucq134-03-controller-audit-stdout-1413.txt` (2632 B) | `787b3d7d2c53b605f3444186c4f0fc83190d394375785bce8929e50dfb28da21` |
| `.claude/test-runs/ownership/fucq134-860b055ea90b4e14bd8089a69e269581.json` | `102a83616864ccde4f36332f655e0b6376516842620b57757824f6e93e0e3a21` |

Run directory: `.claude/test-runs/fucq134/first-chunk-92f6a8bfa24f4edc813dfa6d3f6d1ad1/`.

| Run file | SHA-256 |
| --- | --- |
| `test.log` (17852 B) | `8e86e5f707f9773249738bd86a5df1a51eadec0c3b4e4fa0ba7008629d1cbb3b` |
| `receipt.json` | `78328e7dddc577047ab0a222c52a20fda69844e639d1318d0cb9be462303949e` |
| `checkpoint.json` | `6f2693892e268f6dbafa83eaea7265563d2a5b23afaa65d0ff0092c8e661b2e2` |

## Remaining acceptance and historical boundary

This result proves no whole route, shared matrix/cache, access replay,
acceptance/outcome calculation, corpus realism, browser/UI/native/live integration,
full-suite/development gate or whole-story acceptance. `isolated-real66` remains
in progress; the other five slices remain not started. Root retains claims,
integration, Jira, merge and closure. Backend evidence publication changes no
screen or product behaviour, so no new rendered review is required or claimed.

Earlier parser pre-Node causal row UNKNOWN and the separate captured `?` OS-state
failure/uncertain group remain preserved. The 09aa run remains 0/3 with generated
grade UNKNOWN; the 5e660 run remains 2/3 with post-line130 assertions UNKNOWN for
that run; the 57d8 run remains genuine 3/3 with controller 0/audit 1. The new scoped
PASS does not relabel any historical result. See the [review package](README.md),
[route plan](../../fucq134-current-route-plan.md) and historical
[clock-repair authoring note](../../fucq134-completion-clock-repair.md).
