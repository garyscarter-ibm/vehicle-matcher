# Actual retained-input evaluation

6 November 2026. Dispatcher grant `fucq115-retained-c3e4c7a-0033` ran the
corrected default CLI once at source checkpoint
`c3e4c7a9b7d0399d45f8453685320eb3910a0851`. It completed actual FUCQ-113
dataset/policy readback, the earlier/later/unseen split, actual FUCQ-99 expressed
demand and FUCQ-29 deterministic-fit baselines, training, computed evaluation and
immutable artifact verification. No generation, adoption, policy publication or
model activation was replayed.

| Model | Later log loss | Later Brier |
| --- | ---: | ---: |
| Learned conditional logit | 0.1969166895 | 0.0564266199 |
| Actual expressed demand | 0.2078671946 | 0.0511443681 |
| Actual deterministic fit | 0.2124969079 | 0.0510270732 |

Lower is better for both metrics. The learned model has lower overall log loss
and worse Brier than both baselines. Its Brier deltas are +0.0052822517 versus
demand and +0.0053995467 versus fit; both `worseBrier` flags are retained. On the
121 familiar later choices, learned log loss0.0905466422 is also worse than fit's
0.0880797918. On31 unseen G8-10 choices, learned log loss is0.6121030031 and
Brier0.1732970265, versus demand0.6155596266/0.1540154393 and fit
0.6981250060/0.1554473807. The artifact retains all comparisons and adverse flags.

Support is extremely thin despite320 raw records: training has123 usable choices
but only3 selected/accepted vehicles and5 nonempty vehicle choice sets; later has
152 choices but only7 selected/accepted vehicles and8 nonempty vehicle sets.
There are145 later waits. Estate and saloon each appear in only8 later choice
sets and are flagged thin; seven observed vehicle choices are saloons and none
are estates. Two grade groups have only wait alternatives, so their perfect zero
loss does not establish predictive skill. Reliability tables, all cohort/class
metrics and thin flags are in the committed artifact and safe summary.

The configured optimizer reached its1500-iteration limit: gradient norm
0.0002379891191 exceeds the requested1e-6 tolerance. Initial objective0.1609120042
fell to0.1071366820, but convergence is not claimed. Several coefficients are
zero, including seat/boot attributes and capacity interactions because this
structural configuration input lacks those facts. Missingness and preference
body interactions remain explicit. This run does not establish calibrated BMW
employee choice, capacity-effect estimates or reliable unseen-cohort prediction.

The actual immutable artifact is:

`artifacts/2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d.json`

Its payload identity is
`sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d`;
the155,035-byte envelope file SHA-256 is
`a2ee4271a91a2a02182fa9d5797acd7723a9bc776207aad19f5190cb223ddd86`.
It contains the actual coefficients, feature/schema/model versions, dataset
manifest, pinned settings, partition, optimizer diagnostics, evaluation, seed,
generator version, synthetic assumptions and limitations. Exclusive publication,
readback/digest verification and identical-write reuse passed. Its contents are
preserved unchanged. The safe `evaluation-summary.fixture.json` is the exact
executed CLI-derived allowlisted summary, with status evaluated, synthetic label,
metrics, adverse flags and iteration-limit warning; no raw training rows or
artifact filesystem path enter the panel fixture.

The baseline correction passed the actual context boundary. Its source is the
unchanged actual canonical current and original policy snapshots through existing
FilePolicyProvider. Actual DemoClock advancement, identity activation, exact
snapshot comparison and empty initial brief guards succeeded. Demand uses only
latest earlier-training briefs for62 employees. Its public exact counts met the unchanged privacy
contract for the evaluated classes; no bands or absent counts were coerced.
Deterministic fit is explicitly normalized, uncalibrated probability mapping.

Supervisor wall1.363722709s, sampled peakRSS198,983,680B, peak scratch4,708,929B,
exit0, no resource-limit issue. Selected retained allocation172,128B; retained plus
durable artifact/summary copies occupies340,064B. All owned
groups/scratch/reservations are absent; installed dependency target/package
device/inodes/hashes and source/input/helper identities remain unchanged. The
scratch-only dependency link is gone. Actual receipt and all output hashes are
in `fucq115-retained-run-receipt.json`; ignored run directory:
`.claude/test-runs/fucq115/retained-training-bd0099591fc9406e9a5fe8824a5adac4`.

This is scoped integration evidence for the corrected baseline and default CLI,
not a fresh13/13 unit-test or full-suite result. Actual dated model-reference
publication/activation and final integration validation remain open. The existing
historical-key-change contract test retains its original identity; any new actual
canonical settings-change proof requires its own reviewed finite grant. No
browser, native database, actual corpus or live producer evidence is implied.
