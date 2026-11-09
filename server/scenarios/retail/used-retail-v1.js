/*
 * used-retail-v1: the retail scenario composition over the shared pure core.
 *
 * Owns dimension choice, weights, hard filters, interpretation and ordering for
 * the used-retail journey. Pure: no HTTP, persistence or source-cache access.
 */

import {
  weightTotal, evaluateDimensions, blendScore, percent, compareBy, descending, ascending, byLocale,
} from '../../recommendation/index.js';
import {
  DEFAULT_TUNING, SCORERS, WEIGHTS, PRIORITY_BOOSTS, STRETCH_FACTOR, budgetRange, mileageFraction, fuelPrefs, gbp,
} from './dimensions.js';

export { WEIGHTS, PRIORITY_BOOSTS, STRETCH_FACTOR, budgetRange, DEFAULT_TUNING };

/*
 * Constraints eliminate. Fit ranks. Taste chooses.
 *
 * The dimensions below are the SUBJECTIVE ones — what a buyer likes, as
 * opposed to what actually suits them. They're scored separately and never
 * enter the match %, because a weighted sum that blends the two can't tell a
 * constraint ("it must be a convertible") from a preference ("I like
 * comfort"), and so fails in both directions: preferences out-voting a stated
 * fuel, or — measured at 77% winner-stickiness — constraints drowning the
 * preference questions until four of nine could never change the answer.
 *
 * Everything not listed here is fit: budget, body, fuel, practicality,
 * economy, size, doors. See docs/engine-relayer-design.md.
 */
export const TASTE_DIMENSIONS = new Set(['character', 'performance', 'styleLine']);

/*
 * How much of the match score is "what you'd like" rather than "what suits
 * you". Fixed deliberately: as a share of one big weighted sum, taste got
 * squeezed to nothing every time a constraint was made to bind harder (the
 * fuel fix did exactly that), which is how four questions ended up unable to
 * change the recommendation. A guaranteed share can't be squeezed.
 *
 * 0.2 is calibrated, not chosen. Swept 0.15/0.2/0.25/0.3 against the whole
 * harness: below it the preference questions stay inert, above it constraint
 * honesty starts to go (fuel violations 3% at 0.2, 8% at 0.3). Overridable via
 * TASTE_SHARE for further sweeps.
 *
 * Worth noting the split IMPROVED fuel binding rather than costing it (5% → 3%):
 * fuel is now a share of the smaller fit-only total, so it binds harder inside
 * fit while taste is capped at its own 20%.
 */
export const TASTE_SHARE = Number(process.env.TASTE_SHARE ?? 0.2);

/**
 * Weights for the objective half: how well the car suits the buyer's stated
 * needs and circumstances. Deliberately free of `priorities` — what someone
 * *likes* must not change how well a car actually fits them.
 */
export function fitWeights(answers, tuning) {
  const w = {};
  for (const [dim, weight] of Object.entries(tuning.weights)) {
    if (!TASTE_DIMENSIONS.has(dim)) w[dim] = weight;
  }
  // Running costs matter more the further you drive. Objective, so it stays
  // on the fit side.
  w.economy += mileageFraction(answers, tuning);
  // A named fuel binds hard (see the fuelStrictBoost note below).
  const prefs = fuelPrefs(answers);
  if (prefs.length > 0 && !prefs.includes('open')) w.fuel += tuning.fuelStrictBoost;
  // An unanswered/no-preference doors question stays fully inert.
  if (!answers.doors || answers.doors === 'either') delete w.doors;
  return w;
}

/**
 * Weights for the subjective half. `priorities` drives this — and ONLY this,
 * which is the change that gives the preference questions something to decide.
 * Boosts that used to land on fit dimensions (budget, economy, size) are
 * dropped: those priorities still speak through `character`, which tags cars
 * as efficient / cruiser / drivers-car / tech / image from the same answers.
 */
export function tasteWeights(answers, tuning) {
  const w = {};
  for (const dim of TASTE_DIMENSIONS) {
    if (tuning.weights[dim] != null) w[dim] = tuning.weights[dim];
  }
  for (const p of answers.priorities || []) {
    const boosts = tuning.priorityBoosts[p] || {};
    for (const [dim, add] of Object.entries(boosts)) {
      if (dim in w) w[dim] += add;
    }
  }
  // How spirited they want it — taste by definition.
  if (Number(answers.style) >= 4) w.performance += 1;
  if (Number(answers.style) <= 2) w.performance = Math.max(0.5, w.performance - 0.5);
  // styleLine only weighs in when its question was actually answered.
  if (!answers.styleLine) delete w.styleLine;
  return w;
}

/** @deprecated kept for the audit harness's A/B; see fitWeights/tasteWeights. */
export function effectiveWeights(answers, tuning) {
  const w = { ...tuning.weights };
  for (const p of answers.priorities || []) {
    const boosts = tuning.priorityBoosts[p] || {};
    for (const [dim, add] of Object.entries(boosts)) w[dim] += add;
  }
  // Running costs matter more the further you drive — a smooth ramp (0..1)
  // rather than the old diesel-only step, so it moves the ranking for every
  // fuel. At max mileage the economy dimension gains a full +1.
  w.economy += mileageFraction(answers, tuning);
  if (Number(answers.style) >= 4) w.performance += 1;
  if (Number(answers.style) <= 2) w.performance = Math.max(0.5, w.performance - 0.5);
  // When the user names specific fuel(s) — not "help me decide" — fuel binds
  // hard: a car of the wrong fuel (however strong elsewhere) shouldn't top a
  // matching-fuel car. Without this boost fuel is only ~14% of the blend, so an
  // EV flagship could out-rank the petrol saloon a petrol buyer asked for.
  // "open"/unanswered leaves fuel at its base weight (a range of fuels is fine).
  const prefs = fuelPrefs(answers);
  const specificFuel = prefs.length > 0 && !prefs.includes('open');
  if (specificFuel) w.fuel += tuning.fuelStrictBoost;
  // styleLine/doors only weigh in when their question was actually answered —
  // an unasked (BMW never sets them) or no-preference dimension stays fully
  // inert rather than diluting every score toward neutral. Once answered, the
  // scorer still returns neutral for a car whose own trim/doors are unknown
  // (unknown ≠ wrong), just at the now-active weight.
  if (!answers.styleLine) delete w.styleLine;
  if (!answers.doors || answers.doors === 'either') delete w.doors;
  return w;
}

export function passesHardFilters(car, answers, tuning) {
  const { crewBoot, crewSeats, familySeats } = tuning.hardFilter;
  if (tuning.retailBudgetEnabled !== false) {
    const [, max] = budgetRange(answers);
    if (car.priceMin > max * tuning.stretchFactor) return false;
  }
  if (answers.people === 'crew' && (car.seats < crewSeats || car.boot < crewBoot)) return false;
  if (answers.people === 'family' && car.seats < familySeats) return false;
  return true;
}

/**
 * Rank every car that survives the hard filters, best first.
 *
 * Callers slice this to taste: the block's hero grid takes the top 3 of the
 * configured retailer's stock, while the "worth the drive" carousel ranks a
 * separate pool (nearby retailers) through the same scoring.
 *
 * @returns {Match[]} Match: { car, score (0–100), stretch, reasons: string[],
 *   tradeOffs: see tradeOffs() }
 */
export function rankCars(answers, cars, tuning = DEFAULT_TUNING) {
  const fitW = fitWeights(answers, tuning);
  const tasteW = tasteWeights(answers, tuning);
  const fitTotal = weightTotal(fitW);
  const tasteTotal = weightTotal(tasteW);

  return cars
    .filter((car) => passesHardFilters(car, answers, tuning))
    .map((car) => {
      // A dimension a brand doesn't weight (e.g. styleLine/doors for BMW) is skipped
      // by the core, so adding a scorer is inert for brands that don't opt in.
      const { fitWeighted, tasteWeighted, stretch, reasons } = evaluateDimensions(car, {
        dimensions: SCORERS,
        fitWeights: fitW,
        tasteWeights: tasteW,
        args: [answers, tuning],
        reasonFloor: 0.7,
        reasonLimit: 4,
      });
      // State the fact and let the buyer price it; no "maybe worth it" nudge.
      if (stretch) reasons.push(`A stretch at ${gbp(car.priceMin)}+, over the budget you set`);
      let ratio = fitWeighted / fitTotal;
      // Whole-score penalty for a "crew" buyer's sub-7-seat car: stock-safe, not a hard filter.
      if (answers.people === 'crew' && car.seats < tuning.practicality.crewBonusSeats) {
        ratio *= tuning.crewSeatShortfall ?? 1;
      }
      const tasteRatio = tasteTotal ? tasteWeighted / tasteTotal : 0;
      return {
        car,
        // Match %: mostly fit, plus a guaranteed TASTE_SHARE slice of taste so
        // tightening constraints can never squeeze the preference questions out.
        score: blendScore(ratio, tasteRatio, TASTE_SHARE),
        // `fit` is what the honesty layer talks about, `taste` orders fit-ties.
        fit: percent(ratio),
        taste: percent(tasteRatio),
        stretch,
        reasons,
        tradeOffs: tradeOffs(answers, car),
      };
    })
    // Fit first, then taste; price and name are the final deterministic tie-break.
    .sort(compareBy(
      descending((m) => m.score),
      descending((m) => m.taste),
      ascending((m) => m.car.priceMin),
      byLocale((m) => m.car.name),
    ));
}

/*
 * Which of the user's stated wants have NO car behind them in this pool.
 *
 * The engine already drags a wrong-fuel or wrong-shape car's score down, but a
 * results page that silently shows petrol heroes to someone who asked for
 * electric is quietly dishonest — the same family of sin as inventing a
 * distance. So each pool reports what it couldn't offer, and the page says so
 * (see the unmet note in vehicle-matcher.js).
 *
 * Scoped to the two wants that are genuine stock facts: fuel and body style.
 * "No preference" values (`any`, `open`) state no want and can never be unmet.
 *
 * Measured against the pool as fetched, NOT the survivors of the hard filters:
 * "no fully electric cars at this retailer" is a fact about the stock, and
 * saying it because the only EV happened to sit above the budget would be a
 * different lie. Budget mismatch is already visible in the results themselves.
 *
 * @returns {Object} question id → the unmet values, omitting met ones entirely.
 *   An empty object means every stated want has something behind it.
 */
export function unmetWants(answers, cars) {
  const unmet = {};
  // fuelPrefs turns "unanswered" into ['open'], which filters out to nothing.
  const fuels = fuelPrefs(answers).filter((v) => v !== 'open');
  const missingFuel = fuels.filter((v) => !cars.some((c) => c.fuel === v));
  if (missingFuel.length) unmet.fuel = missingFuel;

  const bodies = (answers.bodyStyles || []).filter((v) => v !== 'any');
  const missingBody = bodies.filter((v) => !cars.some((c) => c.body === v));
  if (missingBody.length) unmet.bodyStyles = missingBody;

  return unmet;
}

/*
 * The stated wants THIS car fails to meet — the per-car companion to
 * unmetWants. unmetWants tells the page "the pool has no fully electric cars
 * at all"; tradeOffs tells one card "this car is petrol and you asked for
 * electric" — which is still true, and still worth owning, when the pool DOES
 * have EVs but a petrol car out-ranked them anyway. Same scope as unmetWants
 * (fuel and body style, the two wants that are plain stock facts) and the
 * same no-preference rule: `open`/`any` state no want, so nothing can be
 * traded away. Structured facts, not prose — the block phrases them in the
 * brand's voice, exactly as it does the unmet note.
 *
 * @returns {Array<{ dim: string, wants: string[], got: string }>} in the
 *   note's fuel-then-shape order; empty when the car meets every stated want.
 */
export function tradeOffs(answers, car) {
  const trades = [];
  const fuels = fuelPrefs(answers).filter((v) => v !== 'open');
  if (fuels.length && !fuels.includes(car.fuel)) {
    trades.push({ dim: 'fuel', wants: fuels, got: car.fuel });
  }
  const bodies = (answers.bodyStyles || []).filter((v) => v !== 'any');
  if (bodies.length && !bodies.includes(car.body)) {
    trades.push({ dim: 'bodyStyles', wants: bodies, got: car.body });
  }
  return trades;
}

/** How many cars the results screen shows as headline matches. */
export const TOP_MATCHES = 3;

/*
 * When the engine can't actually separate the top cars.
 *
 * Measured over both national dumps (docs/refinement-audit.md): the #1 and #2
 * scores land within 3 points in 52-67% of rankings and are EXACTLY equal in
 * 19-35% — where the winner is whatever the tie-break in rankCars preferred,
 * not a judgement. Naming one of those "your perfect BMW" states a preference
 * the model doesn't hold, and at the same time hides the rest of the tie
 * behind a 3-car cap (the tie runs deeper than 3 in up to 32% of cases).
 *
 * So the results are described by what the engine can honestly claim:
 *   cluster    every car within CLUSTER_PTS of the top score — the set it is
 *              treating as interchangeable.
 *   decisive   true only when nothing else is within reach of #1, i.e. the
 *              "your perfect X is…" headline is earned.
 *
 * A decisive result shows TOP_MATCHES as before. A tied one shows the cluster
 * (capped at MAX_SHOWN, floored at TOP_MATCHES so the page never gets thinner
 * than it is today) and lets the page say so. CLUSTER_PTS is the one judgement
 * call here — 3 points out of 100, chosen because it's the median gap; the
 * dead-tie half of the finding needs no threshold at all.
 */
export const CLUSTER_PTS = 3;
export const MAX_SHOWN = 6;

/*
 * How far ahead on TASTE a car must be, inside a fit-tie, before we'll name it.
 * Below this the cars are alike on what suits them AND on what they like, so
 * there is genuinely nothing left for the engine to say and the page hands the
 * choice over (the refine chips). Meg's two identical MINI Electrics in
 * different colours are the case this protects.
 */
export const TASTE_PTS = 6;

/** How many next-best cars to hold back so a rejection has somewhere to go. */
export const ALTERNATIVES = 6;

// How many individual listings a grouped card carries. One dealer's forecourt
// held a handful of any given model, so the group was its own sample; a national
// pool holds hundreds, and every extra one is a PDP fetch for paint and more
// JSON on the wire. 24 is well past what a buyer will scroll while still leaving
// the refine/reject layer real cars to filter. The card's stated count, price
// spread and equipment union still describe the full group — see groupListings.
export const LISTING_SAMPLE = 24;

/*
 * Collapse repeat listings of the same car into one match.
 *
 * A retailer holding four iX2 eDrive20 M Sports produced four cards, all at
 * 96%, the top two in the same colour and £1,400 apart. The page said "six of
 * these fit you equally well" when it meant two models and six listings, which
 * reads as the page stuttering rather than as a choice. It also suppressed the
 * taste pick entirely: the top two matches were usually the SAME model, which
 * scores identically on character, performance and trim by definition, so
 * there was never a taste gap to name a winner on.
 *
 * Grouped on line + body + fuel + 0-62 + trim, which is "the same car" as a
 * buyer means it — deliberately not on `name`, because the feed writes the
 * same car two ways ("BMW iX2 eDrive20 M Sport" and "BMW iX2 20 66.5kWh M
 * Sport SUV 5dr Electric Auto"). The best-scoring listing represents the
 * group and carries the spread: how many, what price range, which colours.
 *
 * The union of the group's equipment goes on the representative so the refine
 * chips filter on what's actually AVAILABLE in that model, not on whichever
 * listing happened to rank first.
 */
export function groupListings(ranked) {
  const key = (c) => [c.line, c.body, c.fuel, c.zeroTo62, c.styleLine ?? ''].join('|');
  const groups = new Map();
  for (const match of ranked) {
    const k = key(match.car);
    if (!groups.has(k)) groups.set(k, { match, listings: [] });
    // Keep the evaluator's decision with its exact car. Group summaries may
    // describe all members, but selecting one must never reuse another score.
    const { score, fit, taste, stretch, reasons, tradeOffs } = match;
    groups.get(k).listings.push({ ...match.car,
      decision: { score, fit, taste, stretch, reasons, tradeOffs } });
  }
  return [...groups.values()].map(({ match, listings }) => {
    const prices = listings.map((c) => c.priceMin).filter(Number.isFinite);
    const colours = [...new Set(listings
      .map((c) => c.colour?.manufacturerColour || c.colour?.colour)
      .filter(Boolean))];
    return {
      ...match,
      car: {
        ...match.car,
        // The feed's tidiest name for this car wins the card.
        name: listings.reduce((a, b) => (b.name.length < a.length ? b.name : a), match.car.name),
        // Aggregates describe the WHOLE group, deliberately computed before the
        // sample below: a national pool really does hold 392 of a given Cooper,
        // and the card should say so even though it only carries a few examples.
        listingCount: listings.length,
        priceFrom: prices.length ? Math.min(...prices) : match.car.priceMin,
        priceTo: prices.length ? Math.max(...prices) : match.car.priceMin,
        colours,
        features: [...new Set(listings.flatMap((c) => c.features || []))],
      },
      // Only a sample travels. `ranked` is score-ordered, so these are the
      // group's best examples, and every one costs a PDP fetch to colour plus
      // its own slice of the response — 392 of them buys the buyer nothing and
      // guarantees the paint budget is spent before the queue is drained.
      listings: listings.slice(0, LISTING_SAMPLE),
    };
  });
}

/**
 * The user's top matches from a pool of cars, plus whether picking a single
 * winner out of them is honest.
 *
 * @returns {{ matches: Match[], decisive: boolean, clusterSize: number }}
 *   `clusterSize` is the true size of the tie, which can exceed matches.length
 *   when it runs past MAX_SHOWN — the page can say "six of these fit" while
 *   showing what fits on screen.
 */
export function matchCars(answers, cars, tuning = DEFAULT_TUNING) {
  // Group first, so everything downstream — the cluster count, the headline,
  // the taste comparison — is about CARS rather than listings.
  const scored = rankCars(answers, cars, tuning);
  const ranked = groupListings(scored);
  /*
   * The working, so the page can show it.
   *
   * `total` is everything in this retailer's feed, `eligible` what survived
   * the hard filters (over budget, too few seats, too small a boot). The
   * difference between them is the elimination step, which the page otherwise
   * has no way to mention: it can show the answer but not the search, so a
   * result with one card looks like thin stock rather than like a clear
   * winner. `margin` is how far ahead the leader is of the next DIFFERENT car
   * — grouped, so four copies of one model do not make it look close.
   */
  const searched = {
    total: cars.length,
    eligible: scored.length,
    margin: ranked.length > 1 ? Math.round(ranked[0].score - ranked[1].score) : null,
  };
  if (!ranked.length) {
    return {
      matches: [], alternatives: [], decisive: true, clusterSize: 0, tasteLead: false, searched,
    };
  }

  const top = ranked[0].score;
  const cluster = ranked.filter((m) => top - m.score <= CLUSTER_PTS);
  const clusterSize = cluster.length;
  const decisive = clusterSize === 1;
  // Fit can't separate them, but taste can: rankCars has already sorted the
  // cluster by taste, so the leader is the one that best matches what they
  // said matters. Naming it is honest — and it's the only thing that makes
  // the preference questions capable of changing the recommendation.
  const tasteLead = !decisive && (cluster[0].taste - cluster[1].taste) >= TASTE_PTS;
  const shown = decisive
    ? TOP_MATCHES
    : Math.min(Math.max(clusterSize, TOP_MATCHES), MAX_SHOWN);
  return {
    matches: ranked.slice(0, shown),
    // The next-best cars, held back rather than shown. "Not this one" needs
    // somewhere to go: without these, rejecting the cars on screen empties the
    // page instead of offering the next one down, which makes the whole
    // gesture a dead end.
    alternatives: ranked.slice(shown, shown + ALTERNATIVES),
    decisive,
    clusterSize,
    tasteLead,
    searched,
  };
}

/** The explicit, frozen used-retail-v1 composition: the retail policy bound to the shared core. */
export const USED_RETAIL_V1 = Object.freeze({
  id: 'used-retail-v1',
  tasteShare: TASTE_SHARE,
  limits: Object.freeze({
    TOP_MATCHES, CLUSTER_PTS, MAX_SHOWN, TASTE_PTS, ALTERNATIVES, LISTING_SAMPLE,
  }),
  rankCars,
  matchCars,
  groupListings,
  unmetWants,
  tradeOffs,
  budgetRange,
});
