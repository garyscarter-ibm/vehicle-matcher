# RAM CPO integration

RAM uses the public US Spoticar inventory request flow. This is a website adapter,
not a documented or contracted partner API. It self-issues an ordinary visitor
session; no login, stored API key or manually captured credential is required.
See [the ownership and platform research](spoticar-platform-research.md).

## Run the demo

Run `node scripts/warm-ram.mjs` before a first demonstration. It populates or reads
the runtime cache without warming other brands. `--refresh` requests a new walk.
Start the existing backend with `npm run server` and frontend with `npm run serve`,
then open `http://localhost:3000/?brand=ram`. A different API can be selected with
the existing `api` query parameter. RAM works in all five interface modes.

The first observed source response declared 2,100 records at 12 per page. Walking
175 pages takes minutes, so server startup primes RAM in the background. The
first request on an uncached installation waits for that walk; prepare the cache
before presenting. A restart can immediately serve the previous completed walk.

## Data contract and bounds

Data strategy: default. The existing stock-provider boundary remains in place;
RAM adds a visitor-session adapter and a local derived cache, with no database,
runtime dependency or change to other brands' source flows.

1. GET the RAM search page; keep visitor cookies and CSRF/bearer metadata in memory.
2. POST `/api/zipcode` for participating dealer codes, using the site's national
   selector (`radius.max=3000`). The returned dealer distances extended beyond
   3,000 miles, so this value is a source selector, not a user-distance promise.
3. POST `/api/sni` for current valid price, mileage and year ranges.
4. POST every declared `/sniLoadMore` page for RAM and exact `cpo`, ordered by
   advertised price. Requests are serial, spaced by 500 ms, with a 35-second
   request timeout, 8 MiB response bound, 500-page ceiling and 10-minute walk limit.

The adapter checks page sizes and totals, rejects missing or repeated whole pages,
and deduplicates individual VIN/dealer identities. Spoticar can repeat a listing
at a page boundary. Its pagination has no snapshot guarantee: a full page walk
does not prove a simultaneous inventory snapshot, and duplicate rows can displace
listings between requests. Counts in the matcher describe the usable unique
trucks collected from the participating Spoticar dealers. They do not describe
every RAM available elsewhere in the US.

Supported vehicles are priced RAM 1500, 1500 Classic, 2500 and 3500 pickups whose
`vehicle_type_flag` is exactly `cpo`. Other makes, vans, chassis vehicles and
other certification programmes are excluded. Listing identity is VIN plus dealer;
individual configurations stay separate through ranking and display. Direct
listing links require the site's `/t1/vehicle-details` path.

Spoticar's public listing HTML and 451 records in the observed completed walk used `Laie`; display names correct this exact word to `Laramie` while preserving the original `trim`, although the upstream corruption mechanism is unverified.

Prices are USD, mileage is miles, power is the listed hp. US gasoline maps to the
existing internal `petrol` key. Seating and equipment come from the listing.
The source's `Gasoline/Mild Electric Hybrid` wording, verified on a public eTorque listing, maps to `petrol`, while only electric wording without a combustion fuel or hybrid qualifier maps to `ev`.
Boot volume, acceleration, combined economy and size class remain unknown and
their scoring dimensions are explicitly disabled, including dynamic boosts.
No towing or payload capacity is inferred. The six questions cover budget,
truck series, fuel, listed seats, annual mileage and equipment priorities.
UK postcode and distance controls are suppressed for RAM.

The derived cache is `.cache/national-ram.json`, ignored by Git. It stores only
allowlisted mapped fields, schema version and collection time, with a 16 MiB
bound and atomic replacement. It is fresh for 30 minutes; a previous completed
walk may serve during refresh for up to 24 hours. Refreshes are single-flight;
failures preserve usable data and have a one-minute retry cooldown. Missing or
expired inventory fails explicitly. There is no committed RAM inventory fixture
or sample-data fallback. Visitor cookies and tokens are never persisted.

## Validation

Focused tests cover session/cookie/form sequencing, page traversal and failures,
mapping, cache lifecycle, ranking, HTTP projection, currency and real quiz/mode
contracts. Existing retail engine, API and rendering tests cover shared callers.
The connected proof records raw/source/unique/mapped counts separately, followed
by a rendered desktop and narrow-screen review. GCSP, Java and database tests
are unrelated to this retail adapter and were excluded from this scoped validation.

Observed on 18 November 2026 at 17:18 UTC: the corrected adapter traversed all
175 declared pages in 238 seconds. The source returned 2,100 rows, including five
repeated VIN/dealer records. Its 2,095 unique records yielded 1,998 usable CPO
pickups: 1,122 RAM 1500, 86 RAM 1500 Classic, 614 RAM 2500 and 176 RAM 3500.
All accepted trucks had an advertised USD price, photo URL and direct listing
link; 1,986 listed seating capacity. Recognised source fuel descriptions mapped
to 1,174 gasoline and 495 diesel trucks. The remaining 329 stay unknown rather
than being labelled electric from an ambiguous hybrid description. These are
collection results, subject to the pagination and coverage limits above.

The retail regression selection passed 252 tests. Following mapping and model-year
corrections, the affected mapper, RAM HTTP, UI and existing render selection passed
66 tests; the final Guess Who hint change passed its 14 UI tests. Headless browser
checks used the real cached stock in all five modes at 1440px and 390px. They
included selected questions, a kept truck, committed Podium results, share-link
feedback, a real empty filter and a separately simulated source failure. Independent
visual review required the listed model year on result cards; this was added and
the corrected cards and official RAM imagery were inspected again.
