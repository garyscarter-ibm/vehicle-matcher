# VIN sample checklist — 2 November 2026

Russell supplied all eight requested additional samples on 2 November through the agreed AutoTrader/photographed-plate/VINwiki method. The initial collection is complete, and VIN-profile sampling remains off Sandeep’s email list. This is a focused first fleet research set, not every derivative in the October 2024 eligibility matrix or a new implementation backlog item.

## Received first-pass samples

| Generation / body | Reported vehicle | Evidence status |
|---|---|---|
| G60 Saloon | i5 | Russell supplied a registration/VIN pair on 2 November. Offline format/checksum checks pass. Exact derivative, build/model year and steering/market context remain to be confirmed. |
| G61 Touring | i5 | Russell supplied a registration/VIN pair on 2 November. Offline format/checksum checks pass. Exact derivative, build/model year and steering/market context remain to be confirmed. |
| F70 hatch candidate | 120 M Sport MHEV automatic | Existing single VINwiki observation, `UK-OBS-001`; no advert cross-check. |
| U06 Active Tourer candidate | 220i M Sport MHEV automatic | Existing single advert-to-VINwiki observation, `UK-OBS-002`. |
| G21 Touring | 320i M Sport | Received; `UK-OBS-005`, WBA / `22FY0`. Offline format/checksum checks pass. |
| G80 Saloon | M3 Competition xDrive | Received; `UK-OBS-006`, WBS / `32HJ0`. Offline format/checksum checks pass. |
| G05 X5 | xDrive50e | Received; `UK-OBS-007`, WBA / `42EU0`. Offline format/checksum checks pass. |
| F95 X5 M | Competition | Received; `UK-OBS-008`, WBS / `12ET0`. Offline format/checksum checks pass. |
| G21 Touring | 330e M Sport | Received; `UK-OBS-009`, WBA / `42GL0`. Offline format/checksum checks pass. M Sport is suitable for this first pass. |
| G26 Gran Coupé | i4 eDrive40 | Received; `UK-OBS-010`, WBY / `62HD0`. Offline format/checksum checks pass. |
| U11 iX1 | xDrive30 | Received; `UK-OBS-011`, WBY / `22HM0`. Offline format/checksum checks pass. |
| G42 Coupé | 220i | Received; `UK-OBS-012`, WBA / `12CM0`. Offline format/checksum checks pass. |

The twelve observations are retained in the [VIN evidence](evidence/fucq-4/bmw-vin-rules-2026-11-01.json) and [research note](synthetic-vin-rules.md). Ten pairs were supplied directly by Russell; their source pages were not independently reopened. No full real VIN, VRM, individual serial, identifier-bearing URL or identifier hash is retained in project files.

## What this batch establishes

All eight additional VINs have canonical 17-character format and match position-nine checksum arithmetic. They supply a candidate for every additional derivative requested. No further sample is requested by this first-pass checklist.

The X5 uses **WBA** and the X5 M uses **WBS** in the supplied UK-registered samples. This corrects the earlier shortlist’s assumption that those examples would supply `5UX` and `5YM`. Preserve the actual observed WMIs; the separate five-WMI fixture/population requirement remains open for `5UX`/`5YM` and has not been changed in Jira. North American references cannot silently become UK-market profiles.

Russell reports all eight as 2026 models. For the F95 he reports AutoTrader manufacture in 2026 despite a 75 plate. Retain that provenance; advertised year, manufacture date, model year and registration period are separate facts, and none was independently verified here. Position ten is `0` in all eight and does not establish a US-style model year.

The M Sport 330e meets this first-pass request. Record its trim separately from the reusable model profile; one sample does not prove that trim never changes type coding. A different engine, drive variant, body or generation is not covered automatically. Serial shapes also vary: X5, X5 M and iX1 have six digits; the other new samples have one letter followed by five digits.

One sample identifies a candidate pattern. A second independent example and/or manufacturer reference may still be needed before enabling that bounded profile, with steering/market/era semantics resolved. All twelve observations remain candidates. Initial sample collection does not prove 10,000 constructible configurations; catalogue collection and configuration distinctness have separate acceptance criteria.

If the first fleet later includes further matrix derivatives, extend this checklist before generating their identities. The complete range of gaps remains in the [VIN rules](synthetic-vin-rules.md#descriptor-evidence-and-the-actual-coverage-gap). No synthetic identifier should be forwarded to a real decoder.
