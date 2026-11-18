# Actual Angular decision consumer replay

The unchanged strict Angular consumer accepted seven captured Java outcomes from the final 149-test corrected-identity run and rejected wrong completed-receipt identities and private extra fields. This is a contract replay, not a browser journey. The retained-policy case preserves historical quote policy and accepted operation identity with a null optional inline handoff.

```json
{
  "status": "PASS",
  "consumer": "apps/gcsp-web/src/app/offers/offer.validation.ts",
  "consumerSha256": "e04e5f49cd8cbd19de68d421c060973ab4d55109010d8d5d08499e16a405ebeb",
  "cases": [
    {
      "case": "accepted",
      "state": "accepted",
      "orderingState": "acknowledged",
      "identityMatched": true
    },
    {
      "case": "declined",
      "state": "declined",
      "orderingState": null,
      "identityMatched": true
    },
    {
      "case": "remote-pending",
      "state": "pending",
      "orderingState": null,
      "identityMatched": true
    },
    {
      "case": "retained-policy",
      "state": "accepted",
      "orderingState": null,
      "identityMatched": true
    },
    {
      "case": "pending",
      "state": "accepted",
      "orderingState": "handoff-pending",
      "identityMatched": true
    },
    {
      "case": "reconciled",
      "state": "accepted",
      "orderingState": "acknowledged",
      "identityMatched": true
    },
    {
      "case": "refused",
      "state": "accepted",
      "orderingState": "handoff-failed",
      "identityMatched": true
    }
  ],
  "sourceLog": "final-offers-learning.log",
  "productionHead": "d308ddba6448cfb93afd54a12f8be33826b53679"
}
```
