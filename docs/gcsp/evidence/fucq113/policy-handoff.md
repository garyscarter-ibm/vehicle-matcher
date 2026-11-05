# Learning-record policy adoption

FUCQ-113 / DEV-2026-11-04-088, 5 November 2026. This is the integration brief for
FUCQ-103's reviewed additive policy-key publication seam. It does not activate a
policy or establish that an existing database has adopted additional keys.

The learning generator will consume new `learning.*` assumptions through
PolicyService, alongside the existing comparison input snapshot. The comparison
snapshot supplies the registered preference, importance, brief-noise, entitlement,
configuration and stock-distribution assumptions. A learning cohort override is
explicit and retained in the generated manifest; it is not a hidden consumer default.

The frozen candidate-definition artifact is
`server/gcsp/predict/records/policy-definitions.json`, schemaVersion `1`, definitionSetId
`fucq113-learning-v1`, revision `learning-definitions.v1`. Its exact byte SHA256 is
`c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143`.
The canonical bundle digest (SHA256 over recursively key-sorted JSON excluding only
`digest`) is `a49f54884322f5993faf510aa8f5cea6e4a9c02e9fae2d2ddfefd350a69d7782`.
This matches the FUCQ-103 `reviewed-definitions.js` schema at `f919da7`.
Top-level keys are exactly `schemaVersion`, `definitionSetId`, `revision`, `definitions`,
`digest`; each of its seven rows has exactly `key`, `value`, `unit`, `status`, `basis`, `source`,
`sourceDate`. There is no `policyVersion` or `effectiveFrom` in candidate rows;
reviewed additive successor publication must supply these coherently. It carries finite
engineering defaults and the normal unit, assumed status, basis, source and source
date for every entry. New definitions are candidates for an additive validated
successor version. Immutable `seed-v1` and previously stored policy versions remain
historical evidence; consumers must refuse missing or unsupported learning keys.

The generator needs a bounded cohort, cycle count and spacing, a maximum materialised
record count, no-choice propensity and response/utility-noise assumptions. These are
fictional demonstration assumptions, not measurements of BMW employee behaviour.
Changing the canonical no-choice key must change generated outcomes without changing
code. The seed, complete pinned policy input, configuration identity, actual overlays
and generator version must reproduce the output.

Actual FUCQ-77 configurations and actual saved outcome-producer integration remain
acceptance requirements. Small structural fixtures only prove the independent
pipeline. Missing historical exposure remains unknown, and synthetic fit never
becomes observed acceptance or after-use satisfaction.

Candidate keys/values are `learning.cohortSize=12`, `learning.cycles=3`,
`learning.cycleSpacingDays=180`, `learning.maximumGeneratedRecords=240`,
`learning.maximumChoiceEntries=4096`, `learning.noChoiceRate=0.12` and
`learning.response.v1={declineRate:0.12,expiryRate:0.08,selectionAfterAcceptRate:0.95,utilityNoise:0.15}`.
Every sourceDate is `2026-11-05`. FUCQ-103's published adoption seam (`f919da7`)
is integration context; this slice has not altered its registry, adopted these keys,
changed active policy, or merged that seam into its current base. Tests inject this
candidate only into a complete explicitly fictional successor fixture through the
public PolicyService provider; they do not prove database adoption.
