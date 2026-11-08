# Offline G61 field ledger — 5 November 2026

The [45-field ledger](ledger.json) joins five existing local artifacts. **UK-OBS-004 and the T5MJ configurator family are not an independently matched vehicle or profile.** The ledger remains unqualified and changes no registry or runtime behavior.

| Evidence | Established within its own scope | Still unresolved |
|---|---|---|
| [Known-seed refresh](../known-seed-refresh-2026-11-05/evidence/observation.json), observed 5 November | Model `T5MJ`, AG `72HH`, catalogue key `G61E`, payload range `G61`, literal `RL`; one existing complete selection constructs | Candidate identity, GB/RHD VIN encoding, fitted equipment and reusable profile |
| [VIN rules](../../../synthetic-vin-rules.md) and [checklist](../../../vin-sample-checklist.md), supplied 2 November | One reported G61 i5 Touring candidate; WBY, literal positions 4–8 `72HH0`, position ten `0`, plant position `C`, serial **shape** `ANNNNN`; checksum arithmetic matches | Exact derivative, powertrain/engine, drive, transmission, advert-to-lookup match, GB/RHD/import facts, vehicle dates, format meanings and second distinct corroboration |
| [Registry](../../../../../server/data/gcsp/vehicle-evidence/vin-profiles.v1.json), reference observations dated 1 November | Five enabled US/LHD structural references; only UK-OBS-001/002 candidates | No enabled compatible G61 GB/RHD profile; no UK-OBS-004 entry |

`72HH` and `72HH0` stay separate. No derivation rule or exact vehicle match follows from shared text. The retained product-context label “i5 eDrive40” concerns model code `72HH`; it does not establish UK-OBS-004's exact derivative. The enabled US reference is **G60 Sedan**, not G61 Touring. Literal `RL` is not treated as universal steering-code semantics or candidate RHD proof. Plant dictionary `C = Dingolfing` and retained production context do not establish bounded UK model/era allocation.

Dates have separate rows: source observation, candidate report, catalogue order, requested tree effect, returned model effect, actual production, production era, model year, registration date/year and advertised manufacture date/year. The returned model effect is **5 January 2027**; the order and tree request effect are **1 November 2026**. None establishes actual build or model year. G61 vehicle dates remain null; the later eight samples' reported 2026 label does not transfer to the first G60/G61 pair.

The [plan](plan.json) selects only local link/hash/schema checks. The [versioned field contract](schema.json) requires source locators, source and observation dates (explicit null where unknown), confidence, status and an unresolved requirement for every row. The retained [stdlib validator](validate.py) implements only the schema keywords used here and rejects unsupported keywords; it is not a general JSON Schema library. Run from the checkout root:

```sh
python3 -B docs/gcsp/evidence/fucq-58/g61-field-ledger-2026-11-05/validate.py
```

The [validation receipt](validation.json) records the scoped proof and exact artifact identities, plus the external resource/cleanup receipt locations. SHA-256 values identify the **complete named local input artifacts**, not real VINs, plates, serials or other identifiers. The individual position-nine character is omitted; only the arithmetic outcome and unresolved convention remain. No real identifier, identifier hash/URL/capture, individual serial or source response is added.

This checkpoint adds zero source observations, configurations or activations. Historical distinct configuration proof remains three; five-WMI and every-model coverage remain unproved. No regression suite, browser or new source lookup was selected. No UI changes require screenshots under the existing experience contract.

The [prior qualification path](../known-seed-refresh-2026-11-05/next-qualification-path.md) still governs the next step: independently corroborate the exact derivative, GB/RHD/era, descriptor/format and plant association under a separately selected finite source plan. Only then consider a bounded profile change. Broader scheme-model and multiple-build WMI coverage remain separate work. This ledger authorises no further requests or activation.
