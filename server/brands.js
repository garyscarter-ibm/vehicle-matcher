/*
 * Brand registry — the one place that knows how BMW and MINI differ.
 *
 * Both brands' used stock is served by the *same* Auto Trader/Django platform
 * (same CSRF handshake, same /vehicle/api/list/ JSON, same dealer_number join),
 * so the only per-brand facts are:
 *   - origin:          which site to fetch from / link to
 *   - defaultRetailer: retailer_site ID used when a request omits one
 *   - label:           human name for logs/errors
 *
 * The per-brand vehicle→spec mapping (MODEL_SPECS + derivations) lives in
 * mapping.js, selected by brand there. Everything else — engine, cache, warmer,
 * dealer directory (which is a combined BMW+MINI feed) — is brand-agnostic.
 */

/*
 * Engine tuning per brand — the calibration constants the scorers read
 * (server/engine.js). BMW_TUNING holds the engine's original hardcoded values,
 * so BMW output is unchanged; MINI overrides only what must differ because its
 * cars are small, light and quick-for-their-class rather than big and fast.
 * Adding a third brand = another tuning block, no engine change.
 *
 * Every field maps to a specific scorer:
 *   weights/priorityBoosts/stretchFactor — orchestration (effectiveWeights,
 *     passesHardFilters).
 *   performance.{zeroBase,span} — scorePerformance's (zeroBase - 0-62s)/span
 *     curve. Lower zeroBase + tighter span = a slower absolute car still reads
 *     as brisk (MINI is quick for its class, never fast in BMW terms).
 *   practicality.{bootNeed,seatsFloor,crewSeats,crewBonusSeats} — scorePracticality.
 *   size.{roadtripMinClass,cityDivisor} — scoreSize.
 *   hardFilter.{crewBoot,crewSeats,familySeats} — passesHardFilters (a HARD
 *     exclusion, so MINI needs lower floors or it's filtered out entirely).
 *   mileage.{lowMiles,highMiles} — the annual-mileage ramp (scoreEconomy /
 *     effectiveWeights); shared shape, tunable per brand.
 */
const BMW_TUNING = {
  weights: {
    // Body at 4.5 (was 2.5) — see the body block below for why.
    budget: 3.0, body: 4.5, fuel: 2.5, practicality: 2.0,
    performance: 1.5, economy: 1.5, size: 1.0, character: 2.0,
  },
  /*
   * Body-match scores. `neutral` = no preference / "any"; `miss` = wrong shape.
   *
   * At the original 2.5 / miss 0.15, BMW honoured a named body style in the
   * top 3 only 53% of the time (docs/question-stock-audit.md): a shape is the
   * most concrete thing a user asks for, and nearly half of them didn't get
   * it. MINI had already solved this for itself with 6.0 / miss 0, so the
   * question was how much of that BMW needs — its stock is far richer (median
   * 93 cars per retailer vs MINI's 33), and over-binding a rich pool would
   * flatten the results to one shape.
   *
   * Swept over 40 retailers × 300 answer sets (honesty / outcome diversity):
   *   2.5 / 0.15  53% / 62%   ← the old base
   *   2.5 / 0     55% / 62%
   *   3.5 / 0     61% / 64%
   *   4.0 / 0     63% / 64%
   *   4.5 / 0     66% / 66%   ← chosen
   *   5.0 / 0     67% / 65%
   *   6.0 / 0     71% / 63%   ← MINI's values, copied blind
   *
   * 4.5 / miss 0 is where diversity peaks: honesty +13 points and the results
   * get *more* varied, not less, because a wrong-shape car can no longer
   * out-muscle a right-shape one on the other dimensions. MINI's 6.0 buys 5
   * more points of honesty but starts costing diversity, which BMW's deeper
   * stock has no reason to pay. Dropping `miss` to 0 is worth ~2 points on its
   * own and is what stops a wrong shape scoring at all — it can still surface
   * when NO right-shape car satisfies the other answers, the honest "closest
   * we've got".
   */
  body: { match: 1, neutral: 0.7, miss: 0 },
  priorityBoosts: {
    economy: { economy: 1.5, budget: 0.5 },
    performance: { performance: 1.8, character: 0.5 },
    comfort: { character: 1.0, size: 0.5 },
    tech: { character: 1.0 },
    image: { character: 1.0 },
  },
  stretchFactor: 1.15,
  // Added to the fuel weight when the user names specific fuel(s) (not "help me
  // decide"), so fuel binds hard: a wrong-fuel car can't top a matching-fuel
  // one. At base 2.5 fuel is only ~14% of the blend, letting an EV flagship
  // out-rank the petrol saloon a petrol buyer asked for; +4 fixes that.
  fuelStrictBoost: 4.0,
  // 0-62 curve: (zeroBase - t) / span, clamped 0..1. BMW: 10.5s→0, 4.5s→1.
  performance: { zeroBase: 10.5, span: 6 },
  practicality: {
    bootNeed: { small: 0, medium: 400, big: 500 },
    seatsFloor: 5, // below this (unless solo) → *0.3
    crewBonusSeats: 7, // 7+ seats for a crew → perfect
  },
  // A "crew" buyer ("5+ seats, regularly") really wants a 7-seater. A car below
  // crewBonusSeats gets its FINAL blended score multiplied by this (applied in
  // rankCars, like the stretch flag) — strong enough that genuine 7-seaters top
  // when they're in stock, but 5-seaters still appear and win when none are (so
  // it's stock-safe, not a hard filter). MINI keeps 1 (no 7-seaters; its
  // crewBonusSeats is 5, so a 5-seat MINI is already the "full house").
  crewSeatShortfall: 0.7,
  size: { roadtripMinClass: 3, cityDivisor: 5 },
  hardFilter: { crewBoot: 430, crewSeats: 5, familySeats: 4 },
  // Annual-mileage ramp: miles at/under lowMiles → 0, at/over highMiles → 1.
  mileage: { lowMiles: 4000, highMiles: 20000 },
  /*
   * The handful of reason strings whose REGISTER differs between brands, not
   * just their numbers. Everything else the engine says is built from live
   * figures (mpg, 0-62, litres, £) and reads the same in either voice, so it
   * stays in engine.js; only these carry a marque's temperature.
   *
   * BMW's are the base and MINI overrides individual keys (see MINI_TUNING).
   * `tags` is merged key-by-key in engine.js rather than by mergeTuning, whose
   * shallow merge would let a brand silently blank the tags it didn't restate.
   */
  reasons: {
    boot: (car) => `<strong>${car.boot}L</strong> of boot`,
    bootTight: (car) => `<strong>${car.boot}L</strong> of boot — enough for what you need`,
    crew: (car) => `<strong>${car.seats} seats</strong> with ${car.boot}L of boot`,
    roadtrip: () => 'Good size for <strong>long runs</strong>',
    city: () => '<strong>Compact</strong> — easy to park',
    tags: {
      'drivers-car': 'A <strong>driver\'s car</strong>',
      family: '<strong>Family-friendly</strong> shape and space',
      cruiser: '<strong>Relaxed</strong> at motorway speed',
      urban: 'Easy to <strong>park</strong> in the city',
      efficient: '<strong>Cheap</strong> to run per mile',
      tech: 'Latest <strong>cabin tech</strong>',
      image: '<strong>Turns heads</strong>',
      practical: '<strong>Practical</strong> — big boot',
    },
  },
};

// MINI overrides. Recalibrated so a well-matched MINI reaches the same 85–95%
// a well-matched BMW does — scored against MINI's own class. Any weight MINI
// lists here replaces just that dimension's weight (mergeTuning deep-merges the
// weights object), so MINI tunes its own weighting without disturbing BMW.
const MINI_TUNING = {
  weights: {
    // Body is MINI's heaviest soft dimension. MINI's thin, EV-heavy stock let a
    // wrong-shape car that's strong elsewhere (the only EV, a JCW) top a search
    // for a different shape — e.g. the JCW Aceman SUV beating hatchbacks on a
    // "hatchback" search. At weight 6.0, paired with body.miss = 0, a wrong
    // shape can't reach #1 while any right-shape car that also fits exists
    // (empirically the Aceman drops from ~#2 to ~#12 on a "hatchback" search);
    // it can still surface when NO right-shape car satisfies the other answers
    // — the honest "closest we've got". BMW has since adopted the same
    // calibration at a lower weight (4.5 — see BMW_TUNING), because its deeper
    // stock doesn't need binding this hard to honour a shape. MINI keeps 6.0:
    // with a 33-car median pool the extra force is what earns it 72% honesty.
    body: 6.0,
    // MINI-only dimensions BMW leaves unweighted, so they no-op for BMW (see
    // scoreStyleLine/scoreDoors — a brand that doesn't weight a dimension
    // contributes 0). styleLine is the trim-character match the repointed
    // `miniVibe` feeds; it carries signal the engine can't get elsewhere
    // (Classic vs Exclusive share a 0-62 and price, so nothing else separates
    // them), hence a near-character weight. doors is a lighter, Hatch-only
    // use-case lean. Both tuned against the audit A/B (docs/mini-first-questions.md).
    styleLine: 2.5,
    doors: 1.5,
  },
  // Trim-character scores (scoreStyleLine), same shape as body: a right trim is
  // perfect, an unknown/neutral one middling, a wrong one weak but not zero —
  // trim is a lean, not a hard requirement like shape, so miss stays off the floor.
  styleLine: { match: 1, neutral: 0.7, miss: 0.25 },
  // Door-count scores (scoreDoors). Gentler miss than styleLine: being shown a
  // 5-door when you wanted 3 is a mild mismatch, not a character clash.
  doors: { match: 1, neutral: 0.7, miss: 0.4 },
  // Wrong shape scores nothing on the (now heaviest) body dimension for MINI.
  // This now matches the BMW base's own miss of 0, so the field is currently
  // redundant — kept stated rather than inherited because MINI's whole body
  // calibration is deliberate, and it must not silently follow BMW if the base
  // is ever softened again.
  body: { match: 1, neutral: 0.7, miss: 0 },
  // 0-62: MINI range is ~6.0s (JCW) to ~8.5s. Solved so a JCW at 6.0s reads
  // ~0.9 and a brisk 7.7s Cooper ~0.6 (BMW's curve gives that 7.7s car only
  // 0.47): (11 - t)/5.5 → 6.0s=0.91, 7.7s=0.60, 8.3s=0.49.
  performance: { zeroBase: 11, span: 5.5 },
  practicality: {
    // MINI boots are small (160–460L). Scale needs down so a Countryman (460L)
    // satisfies "big" and a Hatch (210L) isn't crushed for "medium".
    bootNeed: { small: 0, medium: 220, big: 350 },
    seatsFloor: 4, // MINIs are 4/5 seats; don't punish a 4-seat Hatch
    crewBonusSeats: 5, // 5 seats is a full house for a MINI
  },
  // A Countryman/Clubman (class 2) is "big" for a MINI, so road trips top out
  // at class 2 rather than the BMW class-3 SUV expectation.
  size: { roadtripMinClass: 2, cityDivisor: 5 },
  // Don't hard-exclude MINIs for family/crew: a 5-seat Countryman (460L) should
  // survive, and 4-seat MINIs shouldn't be filtered out of a "family" search.
  hardFilter: { crewBoot: 350, crewSeats: 5, familySeats: 4 },
  /*
   * Only the lines whose TEMPERATURE differs (docs/tone-style-guide.md): MINI
   * smiles, and "go-kart" is its sanctioned way of being emotional the way
   * "driving pleasure" is BMW's. The numbers and the honesty are identical —
   * `bootTight` still owns up to being only just enough — because those are
   * the brand-neutral part. `tags` is merged key-by-key in engine.js, so the
   * three MINI leaves alone keep BMW's wording.
   */
  reasons: {
    boot: (car) => `${car.boot} litres in the back with all ${car.seats} seats up`,
    crew: (car) => `All ${car.seats} seats, and ${car.boot} litres behind them`,
    roadtrip: () => 'One of the bigger MINIs, which is what a long run wants',
    city: () => 'Small enough for town streets and awkward parking spaces',
    tags: {
      'drivers-car': 'The go-kart end of the range, and it drives like it',
      family: 'A family MINI, and the seats and boot above are the size of it',
      cruiser: 'The comfortable end of the range rather than the firm one',
      urban: 'Short enough to park anywhere in town',
      image: 'A MINI people look at twice, which is rather the point',
    },
  },
};

/*
 * Honda overrides. Honda's approved-used range is mainstream and value-led:
 * small, efficient, practical cars (Jazz supermini through CR-V family SUV),
 * heavy on self-charging hybrids, with no performance halo the way BMW has M or
 * MINI has JCW. So its calibration leans the OPPOSITE way to BMW's image-first
 * blend — economy and practicality carry more, performance and character less —
 * and the absolute-speed curve is softened because the whole range is unhurried
 * (a 7.8s Civic e:HEV is the quick end, not the norm). Everything Honda doesn't
 * restate inherits BMW's base via mergeTuning, so this block stays small.
 */
const HONDA_TUNING = {
  weights: {
    // Economy + practicality up, performance + character down vs BMW. A Honda
    // buyer is choosing on running cost and usable space, not kerb appeal, so
    // the blend should reward the sensible car, not the fast or flashy one.
    budget: 3.0, body: 4.5, fuel: 2.5, practicality: 2.5,
    performance: 1.0, economy: 2.5, size: 1.0, character: 1.5,
  },
  // Priorities skew to the reasons a Honda actually gets bought: running cost
  // and space. Performance/image still resolve (a Civic can be the "sportier"
  // pick) but lean lighter than BMW's.
  priorityBoosts: {
    economy: { economy: 2.0, budget: 0.5 },
    performance: { performance: 1.2, character: 0.3 },
    comfort: { character: 0.8, size: 0.5 },
    tech: { character: 0.8 },
    image: { character: 0.8 },
  },
  // 0-62 curve for a slow-by-BMW-terms range. BMW is 10.5s→0, 4.5s→1; a Honda
  // scored on that curve would read as uniformly sluggish. Recentre so the
  // range spreads: 12.5s→0, 6.5s→1 → a 7.8s Civic reads ~0.78 (brisk for a
  // Honda), a 10.6s HR-V ~0.32 (leisurely), which is the honest spread.
  performance: { zeroBase: 12.5, span: 6 },
  practicality: {
    // Honda boots run small-to-mid (Jazz 304L, HR-V 319L, CR-V 587L). Scale the
    // "big" need down from BMW's 500 so a CR-V clears "big" and a Jazz isn't
    // crushed for "medium"; still above MINI's floors (Honda carries more).
    bootNeed: { small: 0, medium: 300, big: 450 },
    seatsFloor: 5, // all Hondas here are 5-seat bar the 4-seat e
    crewBonusSeats: 5, // no 7-seaters in this pool; 5 is a full house
  },
  // No 7-seat Honda in the pool, so don't shrink a car's score for lacking the
  // 7th seat a "crew" buyer ideally wants — 5 seats is the most Honda offers.
  crewSeatShortfall: 1,
  // A CR-V/ZR-V (class 3) is the big end for road trips; the range has nothing
  // larger, so don't demand a class the stock can't supply.
  size: { roadtripMinClass: 3, cityDivisor: 5 },
  // Don't hard-exclude the small-booted Hondas from family/crew searches: a
  // 319L HR-V should survive "family", and the 4-seat e shouldn't be filtered
  // out of everything. Floors sit below the range's real figures.
  hardFilter: { crewBoot: 300, crewSeats: 5, familySeats: 4 },
  /*
   * Only the reason strings whose REGISTER is Honda's rather than BMW's. Honda's
   * voice is plain, practical and unshowy — it talks about running cost, space
   * and reliability, not driving pleasure or kerb appeal. The numbers and the
   * honesty are identical to the base; only the temperature changes. `tags` is
   * merged key-by-key in engine.js, so any tag Honda leaves alone keeps BMW's.
   */
  reasons: {
    roadtrip: () => 'Roomy and settled enough for a long motorway run',
    city: () => 'Easy to place and park on a tight street',
    tags: {
      'drivers-car': 'The sharper-driving end of the Honda range',
      family: 'A family shape, and the seats and boot above are the size of it',
      urban: 'Small and light for town, easy to park and cheap to run',
      efficient: 'The self-charging hybrid does the work; low running cost',
      tech: 'The current cabin and driver aids, not the outgoing ones',
      practical: 'Built around usable space first, as the boot figure shows',
    },
  },
};

/*
 * Ford overrides. Ford's range is the broadest of the four: a £5k Ka city car
 * through a £45k Explorer / Mustang Mach-E, spanning every body from supermini
 * to pickup and every fuel from petrol-mHEV to full EV. Crucially, unlike Honda
 * it HAS a real performance halo (Fiesta/Focus/Puma ST, and the Mustang V8 +
 * Mach-E GT), so its calibration sits BETWEEN BMW and Honda: value- and
 * practicality-leaning like a mainstream brand, but with performance and
 * character weighted enough that an ST or a Mustang reads as the genuinely
 * exciting car it is, and a 0-62 curve wide enough to separate a 12s EcoSport
 * from a 4.5s Mustang. Everything Ford doesn't restate inherits BMW's base via
 * mergeTuning.
 */
const FORD_TUNING = {
  weights: {
    // Between BMW (image-first) and Honda (economy-first). Economy + practicality
    // lifted over BMW because most Fords are bought as sensible everyday cars,
    // but performance/character stay meaningful (higher than Honda) so the ST /
    // Mustang halo cars aren't flattened.
    budget: 3.0, body: 4.5, fuel: 2.5, practicality: 2.2,
    performance: 1.3, economy: 2.0, size: 1.0, character: 1.8,
  },
  // Priorities: an economy buyer is well served (Ford sells a lot of frugal
  // superminis), but a performance buyer must be able to find the ST / Mustang,
  // so the performance boost stays closer to BMW's than Honda's.
  priorityBoosts: {
    economy: { economy: 1.8, budget: 0.5 },
    performance: { performance: 1.6, character: 0.4 },
    comfort: { character: 0.9, size: 0.5 },
    tech: { character: 0.9 },
    image: { character: 0.9 },
  },
  // 0-62 curve wide enough for the real spread: an EcoSport is ~12s and a
  // Mustang GT ~4.5s, so keep close to BMW's own curve (10.5s→0, 4.5s→1) rather
  // than Honda's softened one. A Fiesta ST (~6.5s) reads genuinely quick; a
  // family Kuga (~9s) reads middling; the Mustang tops out. zeroBase a touch
  // higher than BMW so a mainstream 9-10s Ford isn't scored as sluggish.
  performance: { zeroBase: 11.5, span: 7 },
  practicality: {
    // Ford boots run small (Fiesta 292L) to large (Kuga 475L, Galaxy/S-Max
    // huge). Mid-scale the "big" need between BMW's 500 and Honda's 450.
    bootNeed: { small: 0, medium: 300, big: 470 },
    seatsFloor: 5, // most Fords are 5-seat; MPVs add two, the Mustang has 4
    crewBonusSeats: 7, // Ford DOES sell 7-seat MPVs (Galaxy, S-Max, Grand Tourneo)
  },
  // Ford has genuine 7-seaters, so a crew buyer who wants the 7th seat should be
  // rewarded for it and (gently) marked down without it — keep BMW's behaviour.
  // (crewSeatShortfall inherits BMW's base.)
  // Road trips want a mid-size+ car; the range has large SUVs and MPVs, so keep
  // BMW's class-4 floor rather than lowering it as Honda did.
  size: { roadtripMinClass: 4, cityDivisor: 5 },
  // Don't hard-exclude Ford's smaller cars from family searches (a Focus is a
  // legitimate family hatch), but Ford does have proper 7-seaters and big boots,
  // so keep the crew floors near BMW's rather than Honda's lower ones.
  hardFilter: { crewBoot: 400, crewSeats: 5, familySeats: 4 },
  /*
   * Only the reason strings whose REGISTER is Ford's rather than BMW's. Ford's
   * voice is friendly, confident and plainly practical, with a little warmth and
   * spirit (it's allowed to enjoy an ST). Numbers and honesty are identical to
   * the base; only the temperature changes. `tags` merges key-by-key in
   * engine.js, so any tag Ford leaves alone keeps BMW's.
   */
  reasons: {
    roadtrip: () => 'Roomy and settled enough for a proper long-distance run',
    city: () => 'Compact and easy to park on a tight street',
    tags: {
      'drivers-car': 'The genuinely fun end of the range, an ST or a Mustang',
      family: 'A real family shape, with the seats and boot to back it up',
      urban: 'Small and light for town, easy to park and cheap to run',
      efficient: 'Low running costs, whether that is the mild hybrid or the EV',
      tech: 'The current cabin and driver aids, not the outgoing ones',
      practical: 'Built around usable space first, as the boot figure shows',
      cruiser: 'The comfortable, settled end of the range for covering miles',
    },
  },
};

/*
 * Motorrad overrides — the recalibration that makes a CAR engine rank BIKES
 * sensibly. Bikes live on different scales from cars, so the axes the engine
 * reads must be re-pointed or the scores flatten: every bike is quick, every
 * bike is frugal, and "boot" means litres of luggage, not car-boot litres. See
 * the Motorrad axis map in DECISIONS.md for the field-by-field rationale.
 * Everything not restated inherits BMW's base via mergeTuning.
 */
const MOTORRAD_TUNING = {
  weights: {
    // Category (body) is how a rider shops first (GS vs sportbike vs tourer), so
    // it stays the dominant axis. Performance and character matter more than on a
    // mainstream car brand (this is BMW's sporting arm), economy less (bikes are
    // all frugal, so it barely separates them). Fuel is near-dead (almost all
    // petrol), so it's light.
    budget: 3.0, body: 4.5, fuel: 1.0, practicality: 1.8,
    performance: 2.2, economy: 1.0, size: 1.4, character: 2.4,
  },
  priorityBoosts: {
    economy: { economy: 1.4, budget: 0.5 },
    performance: { performance: 1.8, character: 0.6 },
    comfort: { character: 1.0, size: 0.6 }, // a tourer's comfort reads through category + size
    tech: { character: 0.9 },
    image: { character: 1.0 },
  },
  // THE critical recalibration. Car 0-62 spans ~4.5-13s; bikes span ~2.8-7.7s. On
  // BMW's car curve (10.5s->0, 4.5s->1) every bike would peg at 1.0 and the axis
  // would carry no signal. Re-point it to the bike range: a ~7.7s G 310 sits near
  // the bottom, a ~2.8s M 1000 RR at the top, midweights spread between.
  performance: { zeroBase: 8.0, span: 5.2 },
  practicality: {
    // "boot" is luggage litres here: 0 (sportbike) to ~110 (K 1600 tourer). The
    // need scale must match, or a fully-panniered tourer would still read as
    // impractical against a car-sized need. small=0, medium=30 (a top box),
    // big=80 (full touring luggage).
    bootNeed: { small: 0, medium: 30, big: 80 },
    // A bike carries at most a pillion: "crew" isn't a thing, so the floors that
    // penalise low seat counts must not fire. Floor at 1 so no bike is marked
    // down for seats, and the crew bonus is unreachable.
    seatsFloor: 1,
    crewBonusSeats: 99,
  },
  // Road trips want a big-capacity tourer/adventure (size band 4+); town riding
  // wants a low band. cityDivisor 5 keeps the small-bike bonus gentle.
  size: { roadtripMinClass: 4, cityDivisor: 5 },
  // Never hard-exclude a bike for "seats"/"boot": a motorcycle has 1-2 seats and
  // little luggage by nature. Drop the crew/family seat+boot gates to zero so the
  // car-oriented hard filters can't wipe the deck.
  hardFilter: { crewBoot: 0, crewSeats: 1, familySeats: 1 },
  /*
   * Reasons in a rider's register: "ride", not "drive"; category and capability,
   * not doors and boots. Numbers/honesty match the base; only the voice changes.
   */
  reasons: {
    roadtrip: () => 'Built to cover big miles two-up, with the luggage to match',
    city: () => 'Light and low enough to be easy through town and traffic',
    tags: {
      adventure: 'A go-anywhere GS, as happy on a green lane as a motorway',
      touring: 'Set up for distance, with wind protection and luggage',
      sporty: 'The sharp end of the range, track-bred and seriously quick',
      commuter: 'An easy, upright everyday ride for the daily run',
      heritage: 'Classic BMW boxer character with modern underpinnings',
      electric: 'Silent, twist-and-go electric power for the city',
      'a2-friendly': 'A2-licence friendly, an ideal step up for newer riders',
    },
  },
};

/*
 * Ferrari overrides. The mirror image of the mainstream brands: nobody
 * cross-shops a Ferrari on running costs, so the axes a value buyer leans on
 * (economy, budget-as-frugality, everyday practicality) fall right back, and the
 * axes that actually separate one Ferrari from another (how it drives, its
 * character, its shape) carry the weight. Two recalibrations are load-bearing —
 * the 0-62 curve (every Ferrari is fast, so BMW's curve would peg them all at
 * 1.0 and the axis would die) and the hard-filter floors (most Ferraris are
 * two-seaters, so the car-oriented seat/boot gates must not wipe the deck).
 */
const FERRARI_TUNING = {
  weights: {
    // Character and performance lead — they're what a buyer is actually choosing
    // between (a 296 vs an 812 vs a Roma is a question of feel and shape, not
    // value). Body stays high (coupe / open-top / the Purosangue SUV is a real
    // fork). Economy is nearly dead (a Ferrari is never bought to save money) and
    // fuel is light (the pool is petrol plus a handful of plug-in hybrids, so it
    // barely separates them). Budget stays meaningful — the pool runs £90k to
    // £3.3m, so price still sorts hard within it.
    budget: 3.0, body: 4.5, fuel: 1.0, practicality: 1.2,
    performance: 2.6, economy: 0.6, size: 1.0, character: 2.6,
  },
  priorityBoosts: {
    // A performance-first buyer is the default here, so the boost is the
    // strongest of any brand. "economy" barely means anything on a Ferrari;
    // comfort/image lean on character (the GT vs the mid-engined feel).
    economy: { economy: 1.0, budget: 0.5 },
    performance: { performance: 2.0, character: 0.7 },
    comfort: { character: 1.1, size: 0.5 },
    tech: { character: 1.0 },
    image: { character: 1.2 },
  },
  // THE critical recalibration. The pool spans ~2.5s (SF90) to ~6s (a 275 GTB
  // classic). On BMW's car curve (10.5s->0, 4.5s->1) every modern Ferrari pegs
  // at 1.0 and the axis carries no signal. Re-point it to the Ferrari range: a
  // ~6s classic sits near the bottom, a ~2.5s SF90 at the top, and the current
  // range (2.9s-3.6s) spreads meaningfully between — a 296 reads quicker than a
  // Roma reads quicker than a California. (6.0s -> 0, 2.5s -> 1.)
  performance: { zeroBase: 6.0, span: 3.5 },
  practicality: {
    // "boot" here is a Ferrari's usable luggage: 74L (SF90) to 473L (Purosangue).
    // The need scale matches that range, so a Purosangue/GT satisfies "big" and a
    // mid-engined two-seater isn't crushed for "medium". A buyer choosing a
    // Ferrari on outright practicality is rare, but the Purosangue and the 2+2
    // GTs should still win it when it's asked for.
    bootNeed: { small: 0, medium: 200, big: 400 },
    // Most Ferraris are two-seaters; don't mark them down for it. Floor at 2 so a
    // two-seater is a "full house", and the four-seat 2+2s/Purosangue read as the
    // roomy end rather than the crew bonus (unreachable, like Motorrad's).
    seatsFloor: 2,
    crewBonusSeats: 99,
  },
  // A "road trip" Ferrari is a front-engined GT or the Purosangue (size band 3+);
  // the mid-engined cars are class 2. cityDivisor stays gentle — nobody buys a
  // Ferrari as a city car, but a compact 458/488 is the closest thing.
  size: { roadtripMinClass: 3, cityDivisor: 5 },
  // Never hard-exclude a Ferrari for "seats"/"boot": a two-seat mid-engined car
  // is the norm, not a disqualification. Drop the crew/family gates so the
  // car-oriented hard filters can't wipe the deck (the Purosangue and the 2+2s
  // still score higher on those needs through the soft practicality axis).
  hardFilter: { crewBoot: 0, crewSeats: 2, familySeats: 2 },
  /*
   * Reasons in Ferrari's register: spare, exact, and emotional only where the
   * car earns it. Numbers and honesty match the base; only the temperature
   * changes. `tags` merges key-by-key in engine.js, so any tag left alone keeps
   * the BMW wording.
   */
  reasons: {
    roadtrip: () => 'A front-engined grand tourer, built to devour a continent',
    city: () => 'Compact for what it is, and usable enough for real roads',
    tags: {
      'drivers-car': 'Bred for the drive above all else, the way a Ferrari should be',
      image: 'A car that stops the street, which is rather the point of it',
      practical: 'The usable end of the range, with the seats and boot to prove it',
      family: 'Four real seats, the rarest thing a Ferrari can offer',
      lifestyle: 'Roof down, the engine behind you, the best seat in the house',
      efficient: 'The plug-in hybrid drivetrain, silent to the end of the drive',
      tech: 'The current hybrid-era car, not the outgoing one',
      collectable: 'A modern classic, the kind values tend to follow',
    },
  },
};

/** Deep-merge a brand's overrides onto the BMW base so partial tuning works. */
function mergeTuning(overrides) {
  const out = { ...BMW_TUNING };
  for (const key of Object.keys(overrides || {})) {
    const base = BMW_TUNING[key];
    out[key] = (base && typeof base === 'object' && !Array.isArray(base))
      ? { ...base, ...overrides[key] }
      : overrides[key];
  }
  return out;
}

export const BRANDS = {
  bmw: {
    label: 'BMW',
    origin: 'https://usedcars.bmw.co.uk',
    defaultRetailer: '96', // Grassicks Garage, Perth
    // Where stock comes from. 'feed' = the live Auto Trader/Django platform
    // (stock.js does the CSRF fetch); 'fixtures' = read fixtures/<brand>-cars.json
    // (already-mapped cars, no network) for brands whose live feed we can't reach
    // yet. BMW and MINI are live.
    source: 'feed',
    // Budget slider bounds. BMW used stock genuinely reaches £100k+, so the
    // full £0–150k range is right. (This is the base defined in questions.js.)
    budget: { max: 150000, default: [40000, 75000] },
    tuning: BMW_TUNING,
  },
  mini: {
    label: 'MINI',
    origin: 'https://approvedusedminis.co.uk',
    defaultRetailer: '92', // Sytner Luton MINI
    source: 'feed',
    // MINI used stock runs ~£10k–£40k nationally (median ~£24.5k; nothing over
    // £40k in the feed), so a £150k slider leaves both thumbs bunched at the far
    // left. Cap at £50k with a default bracket around the median.
    budget: { max: 50000, default: [15000, 30000] },
    tuning: mergeTuning(MINI_TUNING),
    // Per-brand question surgery — the extensibility hook that lets MINI's set
    // diverge from the shared pool without the engine learning a thing (see
    // docs/mini-first-questions.md for the evidence behind each change):
    //
    //  drop — questions the shared pool asks but MINI's range makes near-dead.
    //    `mileage` arbitrates diesel-vs-petrol running costs, and MINI sells no
    //    diesel to speak of; `style` (comfort↔sporty) barely separates cars on a
    //    one-model-per-shape range, so it's folded into `miniVibe` instead of
    //    asked. BMW keeps both. The engine still *reads* mileage/style if a value
    //    arrives (legacy links), so nothing breaks — they're just not asked.
    //
    //  add — questions MINI's range needs that BMW's doesn't:
    //    `doors` (3- vs 5-door, a real split of MINI's biggest line, the Hatch;
    //    BMW body style already implies doors) as a normal conditional question
    //    scored by scoreDoors, and `miniVibe` repointed at MINI's real trim lines
    //    (Classic/Exclusive/Sport). Each vibe option's `scoresAs` folds into the
    //    standard answer set: `styleLine` feeds scoreStyleLine, and it also
    //    supplies the `style` value the dropped question no longer collects —
    //    which is exactly how `style` survives as signal without its own screen.
    questions: {
      drop: ['mileage', 'style', 'primaryUse', 'people', 'priorities'],
      add: [
        {
          id: 'doors',
          title: 'THREE DOORS OR FIVE?',
          insertAfter: 'charging',
          // Only meaningful once they're open to a Hatch — the only MINI sold in
          // both counts. Mirrored client-side by SHOW_IF.doors in quiz-meta.js.
          showIf: (a) => {
            const b = a.bodyStyles;
            const picks = Array.isArray(b) ? b : (b != null ? [b] : []);
            return picks.length === 0 || picks.some((v) => v === 'hatchback' || v === 'any');
          },
          options: [
            { value: '3', label: 'Three doors', sub: 'The classic silhouette' },
            { value: '5', label: 'Five doors', sub: 'Easier in the back' },
            { value: 'either', label: 'Either’s fine', sub: 'No strong feelings' },
          ],
        },
        {
          id: 'miniVibe',
          title: 'WHICH MINI ARE YOU?',
          help: 'Sets the trim character we lean towards. Pick the one that’s most you.',
          insertAfter: 'charging',
          options: [
            {
              value: 'classic',
              label: 'Classic',
              sub: 'Timeless, pared-back, the icon',
              scoresAs: { styleLine: 'classic', style: '2', priorities: ['image'] },
            },
            {
              value: 'exclusive',
              label: 'Exclusive',
              sub: 'Plush, polished, a little fancy',
              scoresAs: { styleLine: 'exclusive', style: '3', priorities: ['comfort'] },
            },
            {
              value: 'sport',
              label: 'Sport',
              sub: 'Stripes, spoilers, go-kart energy (JCW when you mean it)',
              scoresAs: { styleLine: 'sport', style: '5', priorities: ['performance'] },
            },
          ],
        },
      ],
    },
  },
  honda: {
    label: 'Honda',
    // Public used-car site (used for PDP links and the origin fallback). Honda's
    // approved-used stock is a single national programme, not a network of
    // dealer sites, so there's no per-retailer origin to switch between.
    origin: 'https://usedcars.honda.co.uk',
    // Synthetic single-retailer id — the whole scraped pool is one programme.
    // matches HONDA_RETAILER_ID in mapping.js so a retailer-scoped request still
    // resolves to the full pool (the fixtures loader narrows by it, else serves
    // everything).
    defaultRetailer: 'honda-approved',
    // Honda's live stock has no clean feed API, but its server-rendered listing
    // pages ARE fetchable from this environment, so Honda runs genuinely live:
    // stock.js fetches usedcars.honda.co.uk on demand (shared parser in
    // honda-listing.js, mapped via mapHondaRaw). The live feed is the single
    // source of truth: a fetch failure surfaces as a 502 rather than serving a
    // stale snapshot (no silent fallback, matching BMW/MINI). The committed
    // fixtures/honda-cars.json is kept only as the offline test pool. See the
    // Honda-live section of DECISIONS.md.
    source: 'live-honda',
    // Honda used stock runs ~£8.5k–£22.5k in the scraped pool (median ~£19k), so
    // a £150k slider would bunch both thumbs at the far left. Cap at £30k with a
    // default bracket around the median.
    budget: { max: 30000, default: [12000, 20000] },
    tuning: mergeTuning(HONDA_TUNING),
    // Honda's used range is single-trim-tier per car with a fixed 5-door body,
    // so the MINI-style trim/door questions don't apply — the shared question
    // pool as tuned for a mainstream brand fits Honda as-is. No surgery needed;
    // if a future gap appears, add `questions: { drop, add }` here.
  },
  ford: {
    label: 'Ford',
    // Public used-car site (used for PDP links and the origin fallback). Ford's
    // approved-used programme is national; individual dealers exist but the
    // showcase treats it as one pool, like Honda.
    origin: 'https://www.ford.co.uk',
    // Synthetic single-retailer id — matches FORD_RETAILER_ID in mapping.js so a
    // retailer-scoped request resolves to the full pool (the fixtures loader
    // narrows by it, else serves everything).
    defaultRetailer: 'ford-approved',
    // Ford's live approved-used feed (servicescache.ford.com) sits behind an
    // Akamai edge that drops the connection from this environment (HTTP 000), so
    // its cars are a curated fixtures/ford-cars.json built from public Ford UK
    // spec data. The real adapter is wired in stock.js and goes live the day the
    // feed is reachable; until then this brand serves from fixtures, no network.
    // See the Ford section of DECISIONS.md.
    source: 'fixtures',
    // Ford used stock runs the widest of the four: a ~£5k Ka through a ~£45k
    // Explorer / Mustang Mach-E. Cap at £60k (headroom for a Mustang V8) with a
    // default bracket around the volume models (Puma/Focus/Kuga, ~£15k–£25k).
    budget: { max: 60000, default: [12000, 25000] },
    tuning: mergeTuning(FORD_TUNING),
    // Ford's shared question set fits its range as-is (it sells the full spread
    // of bodies and fuels the standard questions already cover). No surgery
    // needed; if a future gap appears, add `questions: { drop, add }` here.
  },
  motorrad: {
    label: 'BMW Motorrad',
    // The public approved-used site (PDP links + origin fallback). Motorrad
    // approved-used is a national programme, treated as one pool like Honda/Ford.
    origin: 'https://approvedused.bmw-motorrad.co.uk',
    defaultRetailer: 'motorrad-approved', // matches MOTORRAD_RETAILER_ID in mapping.js
    // Motorrad runs genuinely live. The feed (POST ResultOverview/ShowResults) is
    // session-gated, but the server embeds a fresh GMB-SID in the results landing
    // page's #hfSID field, so stock.js self-issues a session (no browser), walks
    // every page of the ~963-bike pool, and maps the HTML ResTable rows through
    // mapMotorradRaw. The live feed is the single source of truth: a fetch
    // failure surfaces as a 502, no silent fallback (matching Honda and
    // BMW/MINI). See the Motorrad-live section of DECISIONS.md.
    source: 'live-motorrad',
    // Motorrad stock is bikes, not cars, so its committed snapshot is
    // <brand>-bikes.json rather than the loader's default <brand>-cars.json.
    // The snapshot is no longer a runtime fallback; it survives only as the
    // offline test pool (render.test.js / brand.test.js load it by path), and
    // this field records where that pool lives.
    fixturesFile: 'motorrad-bikes.json',
    // BMW Motorrad used bikes run ~£4k (a used G 310) to ~£25k (a nearly-new
    // K 1600 GT / M 1000 RR). Cap at £30k with a default around the volume
    // midweights (F-series, R 1250 GS ~£10k-£16k).
    budget: { max: 30000, default: [7000, 16000] },
    tuning: mergeTuning(MOTORRAD_TUNING),
    /*
     * Bikes need a different question set from cars. The car questions that make
     * no sense for a motorcycle are dropped; bike-native ones are added, each
     * folding back to standard engine answers via `scoresAs` so the engine is
     * untouched (the same mechanism MINI's trim question uses).
     *
     *  drop — car-only questions:
     *    `charging` (only a couple of electric scooters, the CE models; not
     *    worth a screen),
     *    `people` (a bike carries a rider + maybe a pillion, never a "crew" —
     *    pillion capability is captured by `ridingStyle` below instead),
     *    `style` (comfort<->sporty is folded into `ridingStyle`).
     *  The engine still reads any of these if a legacy value arrives.
     *
     *  add — bike-native questions:
     *    `ridingStyle` (what kind of riding — commute / adventure / touring /
     *    sport / heritage) is the heart of a bike search; each option's
     *    `scoresAs` sets `primaryUse` (so the size/practicality scorers fire the
     *    right way) and `priorities`/`style` so character scores in the right
     *    direction, and seeds `bodyStyles` toward the matching category.
     *    `licence` (A1/A2/A) gates capacity: A1/A2 riders are steered to
     *    smaller, a2-friendly bikes via `bodyStyles`/`priorities`, a full-A
     *    rider is open to everything.
     */
    questions: {
      drop: ['charging', 'people', 'style'],
      add: [
        {
          id: 'ridingStyle',
          title: 'What kind of riding is this for?',
          help: 'Sets the character we lean towards. Pick the one that fits best.',
          insertAfter: 'bodyStyles',
          options: [
            {
              value: 'commute',
              label: 'Commuting and everyday',
              sub: 'Town, traffic, the daily run',
              scoresAs: { primaryUse: 'city', style: '3', priorities: ['economy'] },
            },
            {
              value: 'adventure',
              label: 'Adventure and green lanes',
              sub: 'On and off the beaten track',
              // primaryUse:roadtrips (not fun): an adventure rider wants the
              // go-anywhere GS bikes, whose edge is a big frame (sizeClass 5) and
              // real luggage (68L). Only `roadtrips` fires the size roadtripMinClass
              // bonus and a non-zero boot need, so it's what surfaces the GS range;
              // `fun` would flatten practicality to 1.0 and bury the GS's strength.
              // Character stays distinct from touring via style '3' (vs '2').
              scoresAs: { primaryUse: 'roadtrips', style: '3', priorities: ['comfort'] },
            },
            {
              value: 'touring',
              label: 'Touring and big miles',
              sub: 'Distance, two-up, with luggage',
              scoresAs: { primaryUse: 'roadtrips', style: '2', priorities: ['comfort'] },
            },
            {
              value: 'sport',
              label: 'Sport and track',
              sub: 'Sharp, fast, focused',
              scoresAs: { primaryUse: 'fun', style: '5', priorities: ['performance'] },
            },
            {
              value: 'heritage',
              label: 'Classic and heritage',
              sub: 'Timeless boxer character',
              scoresAs: { primaryUse: 'fun', style: '3', priorities: ['image'] },
            },
          ],
        },
        {
          id: 'licence',
          title: 'Which licence do you ride on?',
          help: 'We only show bikes you can ride. A2 has a power limit; full A is unrestricted.',
          insertAfter: 'ridingStyle',
          options: [
            {
              value: 'a1',
              label: 'A1',
              sub: 'Up to 125cc, learner-friendly',
              scoresAs: { priorities: ['economy'] },
            },
            {
              value: 'a2',
              label: 'A2',
              sub: 'Restricted power, stepping up',
              scoresAs: { priorities: ['economy'] },
            },
            {
              value: 'a',
              label: 'Full A',
              sub: 'No restrictions',
              scoresAs: {},
            },
          ],
        },
      ],
    },
  },
  ferrari: {
    label: 'Ferrari',
    // The public approved-used site (PDP links + origin fallback). Ferrari
    // Approved is a factory programme; individual dealers exist (Meridien Modena,
    // Graypaul, JCT600 …) and the feed names the real one per listing, but the
    // showcase treats the programme as one pool like Honda/Ford.
    origin: 'https://preowned.ferrari.com',
    // Synthetic single-retailer id — matches FERRARI_RETAILER_ID in mapping.js so
    // a retailer-scoped request resolves to the full pool (the fixtures loader
    // narrows by it, else serves everything).
    defaultRetailer: 'ferrari-approved',
    // Ferrari's listing is server-rendered Next.js: the whole result set is
    // PUBLIC JSON in __NEXT_DATA__, so the CARS are cold-fetchable with no token
    // (the live adapter in stock.js walks all ~15 pages), and the card COVER photo
    // is a token-free Thron /delivery/public/ asset — both verified reachable from
    // here with the browser UA httpsGet already sends (real prices, years,
    // mileages, colours, engines, per-listing power and displacement, real dealer,
    // and 148/148 real cover photos). The only genuinely session-gated asset is the
    // detail-page multi-image gallery, which the card doesn't use. Running live: the
    // wired adapter fetches preowned.ferrari.com in real time through the identical
    // mapFerrariRaw the snapshot was baked with, so a live car is indistinguishable
    // from a fixture car; a fetch failure throws StockUnavailableError (→ 502), no
    // silent fallback. The baked snapshot (fixtures/ferrari-cars.json) remains for
    // offline/dev — set `source: 'fixtures'` to use it. See the Ferrari section of
    // DECISIONS.md.
    source: 'live-ferrari',
    // Ferrari approved-used runs from a ~£90k California T to a seven-figure
    // classic (a £3.3m 275 GTB in the current pool). Cap at £750k (headroom for a
    // 458 Speciale / Pista Spider without letting a single classic distort the
    // budget slider), with a default bracket around the volume modern cars
    // (Roma / Portofino / 296, ~£150k-£300k).
    budget: { max: 750000, default: [150000, 300000] },
    tuning: mergeTuning(FERRARI_TUNING),
    // Ferrari's range sells the full spread of bodies (coupe, open-top, the
    // Purosangue SUV) and both petrol and plug-in-hybrid, so the standard
    // questions fit as-is, with ONE removal: `charging` asks whether you could
    // charge a car at home or work, a running-cost decision that doesn't apply to
    // how anyone buys a plug-in-hybrid supercar (the electric range is a
    // characteristic, not an economy lever). The fuel question still lets a buyer
    // ask for the hybrids; the engine reads `charging` if a legacy value arrives.
    questions: {
      drop: ['charging'],
    },
  },
};

/** The default brand when a request/config doesn't specify one. */
export const DEFAULT_BRAND = 'bmw';

/**
 * Normalise an arbitrary brand input to a known key, defaulting to BMW.
 * Accepts case-insensitively ("MINI", "Mini", "mini") so DA config and query
 * strings are forgiving.
 */
export function normalizeBrand(brand) {
  const key = String(brand || '').toLowerCase();
  return BRANDS[key] ? key : DEFAULT_BRAND;
}

/** The config record for a brand (always resolves — falls back to the default). */
export function brandConfig(brand) {
  return BRANDS[normalizeBrand(brand)];
}

/** The engine tuning for a brand (defaults to BMW's, which are the engine's
 * original constants). */
export function brandTuning(brand) {
  return brandConfig(brand).tuning;
}
