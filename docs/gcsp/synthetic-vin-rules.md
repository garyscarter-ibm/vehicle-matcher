# Plausible synthetic BMW VIN rules

FUCQ-5 refinement, **1 November 2026**. Russell authorised [FUCQ-19](https://ibm-consulting.atlassian.net/browse/FUCQ-19), a synthetic VIN registry/service/adapter with a plausible VIN generator, and [FUCQ-20](https://ibm-consulting.atlassian.net/browse/FUCQ-20), a separate capability to populate it with **10,000 genuinely distinct configurations**. This note supplies the generator's evidence and remaining coverage gaps. It is research, not an implemented generator or an issued vehicle identity.

## Findings and source quality

The supplied [DreamBMW article](https://dreambmw.com/blog/bmwvin-decoded-how-to-read-your-bmw-vin-2026) is useful orientation. Its five WMI categories are a sensible required coverage set. Its universal position-ten model-year/checksum statements are too broad for BMWs across markets and eras, and it does not provide a complete descriptor or factory dictionary. Do not implement a generic blog decoder as the generation specification.

Stronger evidence is available in BMW's own manufacturer submissions to NHTSA:

| Reference | Submission date | Scope |
|---|---|---|
| [BMW MY2026 Part 565 decipherment](https://vpic.nhtsa.dot.gov/mid/home/displayfile/01012fef-2728-447d-a23b-0448772ad75c) | 13 June 2025 | 82 extracted vehicle rows; North American reference profiles; model-year code `T` |
| [BMW MY2027 Part 565 decipherment](https://vpic.nhtsa.dot.gov/mid/home/displayfile/3c74b2f2-3650-480c-9466-ebff3cf81dbd) | 9 October 2026 | 63 extracted vehicle rows; North American reference profiles; model-year code `V` |

Discovered through the official [vPIC GetParts API](https://vpic.nhtsa.dot.gov/api/vehicles/GetParts?type=565&fromDate=1%2F1%2F2025&toDate=11%2F1%2F2026&format=json&manufacturer=bmw). Both one-page tables were downloaded, text-extracted and visually inspected. [Retained evidence](evidence/fucq-4/bmw-vin-rules-2026-11-01.json) contains all **145 reference rows**, source URLs, file hashes, the independent plant dictionary and a checksum arithmetic check. These are reference rows, not 145 unique approved models or executable generator profiles. The tables are not a complete global BMW catalogue; absence is not proof that a model ceased production.

All live research stayed in the main session. Native hosted web search was unavailable in the runtime; Parallel Search and the requested OpenTabs fallback supplied public research. Native HTTP retrieved primary API/PDF evidence. No generated fleet or bulk collection was run.

## Five required WMIs

The official [vPIC WMI registry query](https://vpic.nhtsa.dot.gov/api/vehicles/GetWMIsForManufacturer/bmw?format=json) corroborates the five requested identifiers. The BMW filings identify their vehicle classes:

| WMI | Manufacturer/class in BMW filing | Required example category |
|---|---|---|
| `WBA` | BMW AG, passenger car | Conventional passenger models; selected electrics can also use WBA |
| `WBS` | BMW M GmbH, passenger car | Full M passenger models with a matching filed descriptor |
| `WBY` | BMW AG, passenger car | BMW i models whose actual profile uses WBY |
| `5UX` | BMW AG, multipurpose passenger vehicle | US-built SAV/SAC profiles, including some M Performance models |
| `5YM` | BMW M GmbH, multipurpose passenger vehicle | US-built full M SAV/SAC profiles |

The registry names the US manufacturer under BMW Manufacturer Corporation / BMW North America; the filing names above describe its submitted WMI classes. Preserve that source distinction. The registry's WMI-country label does not identify a precise assembly plant. The filing itself includes `WBA` Z4 with a Graz plant dictionary entry.

Require all five in the platform fixture set, then **multiple genuinely different configurations under every WMI** in the population coverage plan/report. Do not allocate WMIs randomly or divide the entire corpus into five equal buckets without regard to model compatibility. These are a minimum coverage set, not an exhaustive whitelist: the filings also contain **`3MW`, `3MF`, `WBX`, `WB5`**. Add a separately evidenced profile when a represented model needs one. In particular, do not force M2 into WBS, iX into WBY, or every electric BMW into WBY: MY2026 iX uses WB5; MY2027 i3 uses WBA and iX3 uses WBX in these filings.

## Position rules and exact checksum

For the researched North American profiles, follow [49 CFR 565.15](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-565/section-565.15):

| Positions | Rule |
|---|---|
| 1–3 | Evidenced WMI |
| 4–8 | Five-character BMW vehicle descriptor for the supported model, body, powertrain, market and model year |
| 9 | Calculated check character, `0`–`9` or `X` |
| 10 | Model-year character for the selected profile |
| 11 | BMW plant code allowed for that model and production era |
| 12–17 | Fictional production-sequence field constrained by the profile; final five numeric for the passenger cars/light MPVs covered by the US rule |

Use exactly 17 uppercase permitted characters; exclude `I`, `O`, `Q`, spaces and punctuation. Input lookup can trim/uppercase before validation, but stored/generated VINs are canonical.

The checksum is **calculated exactly**, not selected randomly:

```text
Digits: their numeric values
A=1 B=2 C=3 D=4 E=5 F=6 G=7 H=8
J=1 K=2 L=3 M=4 N=5 P=7 R=9
S=2 T=3 U=4 V=5 W=6 X=7 Y=8 Z=9

Position weights, 1 to 17:
8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2

sum = Σ(transliterated character × position weight)
remainder = sum mod 11
check character = X if remainder is 10, otherwise the remainder digit
```

Choose every other character, including the random serial, **before** computing position nine. Use integer remainder arithmetic; floating-point rounding is unnecessary. The regulation's public Table VI vector was independently checked in throwaway research arithmetic: weighted sum **411**, remainder **4**, expected/calculated check character **4**. The evidence retains the arithmetic result without a complete VIN. This does not substitute for implementation tests.

Implementation validation must cover the public vector, all eleven remainder outcomes including `X`, digit/letter transliteration, invalid letters, leading zeros and corruption cases. A checksum detects many transcription errors; it does not authenticate a VIN, uniquely decode every equipment choice, or guarantee every character substitution is detected.

### Model year and production date

The US regulation gives **2024 `R`, 2025 `S`, 2026 `T`, 2027 `V`, 2028 `W`, 2029 `X`, 2030 `Y`**. Applicable US passenger/light-MPV profiles also use an alphabetic seventh position for the 2010–2039 year cycle. The researched descriptors satisfy that condition.

Store **model year separately from any fictional production date, registration date, catalogue order date and catalogue effect date**. A January 2027 catalogue effect does not establish MY2027; manufacture during 2026 can belong to MY2027. Only select a year/descriptor/plant combination supported by that profile, and apply production-availability bounds where evidenced. Any assumed production date remains scenario data, not a decoded fact. Do not generate later production dates for a discontinued model merely because a historical profile exists.

### UK/European scope

Older European VIN rules use WMI 3 + VDS 6 + VIS 8 and do not establish a universal position-nine checksum or US position-ten year meaning: see [UK-hosted 19/2011 Annex I Part B §2](https://www.legislation.gov.uk/eur/2011/19/annex/I/part/B/division/2/2020-01-31). The final four VIS characters are numeric.

[EU 2021/535, consolidated 1 January 2025, Annex II](https://eur-lex.europa.eu/eli/reg_impl/2021/535/2025-01-01/eng) specifies WMI 3 + VDS 5 + a position-nine checksum + VIS 8, with new-type/registration transition provisions. It still does not make the US position-ten model-year convention universal. These texts are format evidence, not proof of the applicable UK approval regime or BMW coding for every vehicle in the scheme.

Consequently, define explicit **market/era profiles**. Prefer an evidenced modern checksum-bearing profile for new generated records. Do not overwrite the sixth VDS character in a historical European template merely to force a checksum, or assign `T`/`V` to a UK VIN without profile evidence. Unsupported market/model/era combinations must fail clearly. The researched US templates can prove the platform in labelled reference fixtures; they cannot silently become UK/RHD identities for GB configurations.

## Descriptor evidence and the actual coverage gap

The following are **North American MY2026 references**, all with year character `T`; plant letters/numbers are selected separately. The complete two-year extraction is in the evidence JSON.

| Model/body in filing | WMI | Positions 4–8 |
|---|---|---|
| M235 xDrive Gran Coupe | WBA | `33GG0` |
| 230i / 230i xDrive Coupe | 3MW | `23CM0` / `33CM0` |
| M240i / M240i xDrive Coupe | 3MW | `43CM0` / `53CM0` |
| M2 Coupe / M2 CS | 3MF | `23DM0` / `33DM0` |
| 330i / 330i xDrive Sedan, WBA production | WBA | `13LA0` / `23LA0` |
| M340i / M340i xDrive Sedan, WBA production | WBA | `53FT0` / `63FT0` |
| M3 / Competition / Competition xDrive | WBS | `13HJ0` / `23HJ0` / `33HJ0` |
| 430i / 430i xDrive Coupe | WBA | `43DA0` / `63DA0` |
| M440i / M440i xDrive Coupe | WBA | `73DA0` / `83DA0` |
| M440i / M440i xDrive Convertible | WBA | `63DB0` / `73DB0` |
| M440i / M440i xDrive Gran Coupe | WBA | `53FB0` / `63FB0` |
| M4 Coupe / Competition / Competition xDrive | WBS | `13HK0` / `23HK0` / `33HK0` |
| M4 Competition xDrive Convertible | WBS | `43BA0` |
| 550e xDrive Sedan | WBA | `13FK0` |
| i5 eDrive40 / i5 xDrive40 Sedan | WBY | `63HG0` / `33HG0` |
| X3 30 xDrive / X3 M50i, filing's names | 5UX | `53GP0` / `73GP0` |
| X5 sDrive40i / xDrive40i / xDrive50e / M60i | 5UX | `13EU0` / `23EU0` / `43EU0` / `33EU0` |
| X5 M Competition | 5YM | `13ET0` |
| X6 xDrive40i / M60i | 5UX | `33EX0` / `43EX0` |
| X6 M Competition | 5YM | `23ET0` |
| Z4 sDrive30i / M40i | WBA | `HF3C0` / `HF9C0` |

Do not extrapolate the alphanumeric codes position by position into a universal engine/series grammar. The descriptor is an evidenced mapping. Trim/options are resolved from the linked configuration snapshot, not invented from the VIN.

MY2027 illustrates versioning hazards: WBA 330i becomes `13KB0`/`23KB0`; X3 30 xDrive becomes `53KA0`; X5's 40 sDrive/40 xDrive/50e rows become `53JF0`/`63JF0`/`73JF0`. The 2027 table also lists `WBS`/`13HJ0` under both M3 CS Sedan and M3 Sedan. Preserve the source ambiguity; do not assert that this descriptor alone distinguishes them or build a unique-variant decoder from it.

### Against the October 2024 UK scheme baseline

The [agreed matrix](sources/choices-eligibility-matrices-2024-10.md) remains a **separate eligibility policy**. The population capability must declare represented derivatives and exact catalogue context before collection. This research establishes the following coverage status, not permission to replace the matrix with a current US catalogue:

| Matrix families | Useful reference found | Still needed before generating a UK/RHD profile |
|---|---|---|
| F70 120/M135; F44 218i/220i/M235i | Current M235 Gran Coupe reference exists, with a different generation/context possible | Exact generation, engine, RHD descriptor, era and plant; no F70 hatch or F44 UK mapping established |
| G42 220i/230i/M240i; M2 | US 230i/M240i/M2 rows, including Mexican WMIs | UK 220i and RHD derivative mappings; correct WMI/plant by era |
| U06 220i/225xe/230e Active Tourer | No matching rows in these two filings | Exact UK model naming, descriptor, dates and production profile |
| G20/G21 320i/330e/M340i | US M340i Sedan; 330i is a different engine designation | UK 320i/330e and every Touring/RHD profile; Sedan codes cannot identify Touring |
| G22/G23/G26 420i/M440i | US M440i Coupe/Convertible/Gran Coupe rows | UK 420i and RHD versions of each body; no broad 4 Series substitution |
| G60/G61 520i/530e/550e; i5 eDrive40/M60 | US 550e Sedan and i5 Sedan references; primary BMW product data corroborates `72HH` as i5 eDrive40 model code | UK engines and RHD body-specific VIN mapping, especially G61 Touring; `72HH` is not proved to be VIN VDS |
| G29 Z4 20i/M40i | US 30i and M40i rows | UK 20i/RHD profile and historical production context |
| U11/U10 X1/X2/iX1/iX2 | US X1/X2 petrol variants under WBX | UK diesel/PHEV/electric/RHD profiles; these are not interchangeable powertrains |
| G01/G02 X3/X4 and X3M/X4M | Newer X3 rows under 5UX | Exact historical generation, UK engines, RHD/plant mapping; newer X3 is not G01 |
| G05/G06 X5/X6 and X5M/X6M | US petrol/PHEV/full-M references under 5UX/5YM | UK diesel/RHD mappings and era; model-year changes cannot be ignored |
| G26 i4; i20 iX 40/50/M60 | No i4 rows in selected filings; newer iX 45/60/M70 rows use WB5 | Correct UK/year profiles for the matrix's actual derivatives, not later similarly named EVs |
| M3/M4 | US full-M body/drive references under WBS | UK RHD, body, transmission, year and plant mapping |

Public searches for RHD/type-key mappings and the sampled `72HH` found BMW's [battery-regulation product table](https://www.bmw.com/content/dam/bmw/marketBMWCOM/bmw_com/footer/battery-regulation/english/july_25/Performance%20and%20durability%20parameters%20of%20high-voltage%20batteries.pdf) and parts/type-code listings. The primary product table confirms model codes but **does not establish the VIN's WMI + VDS composition**. Searches did not establish a trustworthy complete UK descriptor dictionary. No `AG code + 0` rule was inferred. Official BMW recall pages provide VIN checks, not a published type-key dictionary. The bounded observational follow-up below investigates Russell's alternative route without retaining individual vehicle identities.

The generator therefore needs an evidence-bearing profile registry, and population must reject unsupported derivatives before a bulk run. A supported smaller derivative set may still yield 10,000 real option combinations; declare coverage and exclusions rather than fabricate mappings. If exact UK coverage cannot be substantiated, return the remaining choice for refinement rather than publish US profiles as UK-correct.

### UK listing and VINwiki observation method

Russell authorised a manual route: identify the exact vehicle in an [AutoTrader](https://www.autotrader.co.uk/) advert, read its visible registration plate, and look it up through his logged-in [VINwiki](https://web.vinwiki.com/) session. This is useful for the UK gaps above. The US filings support the five-WMI structural reference fixtures, but **do not establish UK/RHD descriptors**, including the G61 i5 Touring used in the configurator pilot. A BMW generation/chassis designation such as `F70`, `U06` or `G61`, a four-character AG/model code, and the VIN's descriptor positions are separate fields; do not substitute one for another.

A bounded browser-UI pilot on 1 November produced these sanitised observations. Positions 4–8 are recorded literally; calling them a five-character VDS is conditional on establishing the applicable format profile.

| Observation | Vehicle evidence | WMI | Positions 4–8 | Position 9 | Position 10 | Position 11 | Positions 12–17 shape | Checksum arithmetic |
|---|---|---|---|---|---|---|---|---|
| `UK-OBS-001` | Existing user-opened VINwiki page labelled “2026 BMW 120 M Sport MHEV Auto”; no advert cross-check | WBA | `82GE0` | `9` | `0` | `7` | One letter, five digits | Matches modulo-11 calculation |
| `UK-OBS-002` | AutoTrader card advertised a 2026 220i MHT M Sport DCT Active Tourer; photographed plate lookup and VINwiki vehicle page returned “2026 BMW 220I M Sport MHEV Auto” | WBA | `72BX0` | `6` | `0` | `7` | One letter, five digits | Matches modulo-11 calculation |

Each row is **one candidate observation**, not an activated generator profile or manufacturer-certified dictionary. Only the second proves the complete plate-to-VINwiki route. Neither independently confirms RHD/UK-market specification, production date or model year. The first suggests the F70 family and the second the U06 family, but the precise generation association still needs corroboration. Position-eleven `7` is consistent with the filing's Leipzig dictionary; exact model/era allocation is still a separate check. No second example of either derivative, G61 example or other-WMI UK profile was collected in this pilot.

Both VINwiki labels say 2026 while position ten is `0`. That is direct reason to avoid inserting the US `T` year character into these candidates; it does not establish the true build/model year or a universal BMW zero convention. Both checksum calculations match, but two examples do not establish the position-nine rule for all UK vehicles or historical generations. Never copy these observed check characters into generated identities: calculate them after generating the fictional serial whenever the selected profile uses a checksum.

For each derivative selected for the population coverage plan:

1. Match generation, body, engine/powertrain, drive/transmission and derivative between the advert and lookup. Confirm steering and market context separately; UK registration alone does not exclude an import. Record missing or conflicting facts explicitly.
2. Seek a second distinct, consistent vehicle to corroborate a candidate. Compare identities transiently, then discard them. Two matches strengthen observational evidence; they do not prove a universal encoding rule. Prefer BMW/type-approval corroboration for the reusable type, format and plant association.
3. Retain an arbitrary observation ID, source/service and date, shared WMI/descriptor codes, positional observations, serial shape, sample count, source confidence and unresolved facts. Keep registration, advertised year, model year, build date and catalogue dates separate.
4. Activate only a supported, bounded model/body/powertrain/market/era profile whose required semantics have been resolved. Keep candidate and corroborated observations distinct from manufacturer-verified references. Unsupported combinations still fail clearly.
5. Discard full VINs, VRMs, individual serials, identifier-bearing lookup/advert URLs, identifier hashes and unredacted captures. Shared, substantiated manufacturer/type codes may inform the registry; an observed VIN must never become a template that is mutated into a synthetic identity. Generate serials independently.

This is profile research, not a source of specifications for all 10,000 cars and not an authorised bulk VIN-harvesting run. Select the represented derivatives first, then close their gaps. Registration lookup availability, terms, and any automated API access remain unproven; the browser pilot is not a VINwiki API integration. The live demo remains a closed synthetic service with no real-decoder fallback. Sanitised observations and limitations are retained in the [evidence JSON](evidence/fucq-4/bmw-vin-rules-2026-11-01.json).

## Assembly plants

Both BMW filings provide this **independent dictionary** for position eleven:

| Code | Plant | Activation constraint |
|---|---|---|
| `C` | Dingolfing, Germany | Validate model/era allocation |
| `F` | Munich, Germany | Validate model/era allocation |
| `W` | Graz, Austria | Historical Z4 context needs production dates |
| `3` | Born, Netherlands | Dictionary entry alone does not establish current BMW production |
| `5` | Regensburg, Germany | Validate model/era allocation |
| `7` | Leipzig, Germany | Validate model/era allocation |
| `8` | San Luis Potosi, Mexico | Validate model/era allocation and Mexican WMI |
| `9` | Greer, South Carolina, USA | Spartanburg/Greer allocation, supported X variant |

The vehicle rows leave plant position eleven as **`-`**, not a per-row code. The later `3`, `4`, `5` etc. in the explanation columns identify model lines and must not be parsed as plant codes. Do not cross-join every descriptor with every plant in the dictionary.

BMW's own production sources strengthen these candidate allocations:

- [Dingolfing i5 production launch](https://www.press.bmwgroup.com/global/article/detail/T0424419EN/%E2%80%9Ceight-times-five-is-50%E2%80%9D:-plant-dingolfing-celebrates-start-of-bmw-i5-production-during-anniversary-year?language=en) and [G61 Touring launch](https://www.press.bmwgroup.com/global/article/detail/T0439990EN/four-drive-concepts-%E2%80%93-one-promise:-sportiness-in-series?language=en): i5 Sedan/Touring production at Dingolfing. Combined with the filed dictionary, `C` is a grounded candidate for the researched i5 reference, not proof of a UK VDS.
- [Munich plant](https://www.bmwgroup-werke.com/muenchen/en.html): M3, 3 Series Touring, 4 Series Gran Coupe and i4; [dated M3 production article](https://www.press.bmwgroup.com/global/article/detail/T0461211EN/one-million-times-the-thrill-of-m:-plant-munich-builds-milestone-bmw-m3-and-shapes-the-electric-future-of-bmw-m?language=en) corroborates current-generation M3 production. Candidate code `F` for applicable M3 profiles. The plant is changing its product mix; do not apply one undated list to every year.
- [Dingolfing plant](https://www.bmwgroup-werke.com/dingolfing/en.html) and [29 October 2026 M4 Convertible milestone](https://newsroom.bmwgroup.com/global/13-millionth-bmw-produced-at-dingolfing-plant/): explicit 4 Series/M4 Convertible and 5 Series production. Candidate code `C` for the applicable WBA 430i Convertible profile and WBS M4 Convertible; exact selected era still matters.
- [Spartanburg plant](https://www.bmwgroup-werke.com/spartanburg/en.html): X5/X6 and their M variants. Candidate code `9` for the corresponding researched 5UX/5YM profiles. This is not a universal X-model or future-year plant rule.
- [San Luis Potosi plant](https://www.bmwgroup-werke.com/san-luis-potosi/en.html): 2 Series Coupe, M2 and 3 Series. Candidate code `8` with matching 3MW/3MF references.

A practical **MY2026 North American reference fixture set**, subject to the matched configuration fixture, is WBA 430i Convertible / `33DB0` / `C`; WBS M3 Competition xDrive / `33HJ0` / `F`; WBY i5 eDrive40 Sedan / `63HG0` / `C`; 5UX X5 xDrive50e / `43EU0` / `9`; 5YM X5 M Competition / `13ET0` / `9`. These are structural reference fixtures, not GB builds or newly invented full VINs. Record the model/era/plant evidence when activating each profile. Five bounded calls to the official vPIC partial decoder corroborated their model/body, MY2026 and the listed cities (Dingolfing, Munich, Dingolfing, Greer, Greer). Each returned HTTP 200 with business code `6 - Incomplete VIN`, as expected for an eleven-character pattern omitting the serial and check character. This is useful partial-pattern evidence, not five successful complete-VIN/checksum validations; no generated complete VIN was sent. Sanitised results and exact source URLs are retained in the evidence JSON.

The [BMW Z4 Final Edition release](https://www.press.bmwgroup.com/global/article/detail/T0453847EN/the-bmw-z4-final-edition-an-exclusive-take-on-the-iconic-roadster?language=en) announces a March 2026 end, while the [US release](https://www.press.bmwgroup.com/usa/article/detail/T0454065EN_US/the-bmw-z4-final-edition) describes February–April Final Edition production. Resolve any exact cutoff before assigning a fictional production date; neither supports fresh 2027 Z4 production. This is one reason catalogue effect date cannot serve as production date.

## Random serials, repeatability and identity

For a profile allowing six numeric serial characters, choose a **seeded pseudorandom six-digit value including leading zeros**. If a model/era profile needs an allowed letter at position twelve, preserve that constraint and randomise the remaining numeric positions. The US rule permits an alphanumeric twelfth character with the final five numeric; it does not prove that every possible character/range was used by BMW. Start conservatively with an evidenced serial shape and record that synthetic sequence allocation is fictional.

Random-looking is sufficient for a demo identity; the serial need not conceal anything. Require:

1. Stable `vehicleId`, `configurationId`, `datasetId` and explicit `identityKind: synthetic`, independent of parsing the VIN string.
2. A versioned profile key, generator algorithm/version and seed. A clean rebuild of the same inputs reproduces mappings. Resume, reordered input and later additions preserve already published VIN-to-configuration associations.
3. Uniqueness across the entire active synthetic registry, including overlapping datasets. Detect/retry collisions deterministically within a finite attempt budget, then fail clearly on exhaustion. Different random seeds or a dictionary per batch must not bypass registry-wide checks.
4. Persist the selected serial and final VIN; never recalculate an existing identity from a newer model catalogue. Compute/check position nine after the suffix is settled.
5. No supplied or observed full real VIN, individual serial, suffix or identity fragment as a seed/template. Shared manufacturer/type codes can enter a bounded evidence-bearing profile through the authorised research method above; they do not supply an individual identity. No claim of a globally reserved BMW serial range or guaranteed non-collision with real vehicles.

Six numeric positions offer one million suffixes per fixed stem. A naive 10,000 independent draws within one stem would produce about **50 expected colliding pairs** (`n(n−1)/(2N)`), so collision checking is required. This is an illustration, not a forecast of collisions across the chosen mixed-model fleet.

Synthetic/source provenance must survive HTTP responses and provider switches. The service resolves its closed dataset only. Unknown inputs, outages and fallback paths must make **zero real-decoder calls**; a production adapter must reject synthetic identities even if a string happens to pass all VIN checks. Plausible syntax cannot mark a VIN as synthetic by itself. Keep scheme eligibility, points, release/availability, reservations, allocations and usage telemetry outside this static identity/specification service.

## Implementation acceptance derived from this research

- The structure/generator epic proves profile validation, serial/checksum generation, immutable persistence/loading, actual HTTP lookup and consuming-adapter mapping on a small five-WMI fixture set. No 10,000-car collection is needed to accept that capability.
- The population epic declares supported models/markets/eras, closes their profile gaps, gathers 10,000 distinct complete resolved configurations, assigns stable generated identities, loads and reconciles the registry, and proves lookup with all five required WMIs represented by multiple configurations.
- Both follow [demo-brief.md](demo-brief.md), [experience-quality.md](experience-quality.md) and `COMPONENTS.md`. These backend capabilities introduce no screen; validate provenance, representative imagery, units, missing data and failure outcomes at the presentation contract. Consuming UI work supplies browser evidence against the visual reference when agreed.
- FUCQ-6 agrees the canonical HLD, storage/deployment placement and runtime contract before implementation. This research does not alter FUCQ-14–18 or authorise bulk collection in this session.

## Follow-up review and verification

The UK observational follow-up passed independent read-only review on 1 November 2026: reviewer requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants; effective runtime settings were not independently verified. The review checked confidence, positional/chassis/type-code distinctions, identity exclusion, activation gates and the backend experience contract. Live lookups were not repeated by the reviewer. JSON parsing and consistency checks preserved all 145 filing rows and confirmed two single candidate observations with one complete advert-to-lookup route. Local file links, whitespace and complete-VIN exclusion checks passed. No application code changed or implementation tests were run.
