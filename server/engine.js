/*
 * Matching engine — pure, deterministic, dependency-free.
 *
 * Input:  answers object produced by the quiz (see questions.js) + a per-brand
 *         `tuning` object (see brands.js) holding every calibration constant.
 * Output: ranked matches with 0–100 scores and human-readable reasons
 *         generated from the actual score components.
 *
 * The engine is brand-agnostic: every magic number lives in `tuning`, so a
 * brand is calibrated by config, not by forking the scorers. `tuning` defaults
 * to BMW's values (the engine's original constants), so a caller that omits it
 * gets the original behaviour.
 */

import { BUDGET_BANDS } from './questions.js';
import { brandTuning } from './brands.js';

/** Default tuning = BMW's (the engine's original constants). */
const DEFAULT_TUNING = brandTuning('bmw');

/*
 * Base weight of each scoring dimension. The engine itself reads the weights
 * off the per-brand `tuning` argument (brands.js) — this export is the same
 * table under the name the README points tuners at, so keep the two in step.
 */
export const WEIGHTS = {
  budget: 3.0,
  body: 4.5,
  fuel: 2.5,
  practicality: 2.0,
  performance: 1.5,
  economy: 1.5,
  size: 1.0,
  character: 2.0,
};

/** How the user's two stated priorities reweight the engine. */
export const PRIORITY_BOOSTS = {
  economy: { economy: 1.5, budget: 0.5 },
  performance: { performance: 1.8, character: 0.5 },
  comfort: { character: 1.0, size: 0.5 },
  tech: { character: 1.0 },
  image: { character: 1.0 },
};

/** Stretch tolerance: cars up to this factor over budget survive, flagged. */
export const STRETCH_FACTOR = 1.15;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const gbp = (n) => `£${Math.round(n / 1000)}k`;

/**
 * Resolve a budget answer to a [min, max] £ range. Budget is a dual-thumb range
 * from the quiz slider — a [min, max] pair — but we also accept a bare number
 * (→ [0, n], the earlier single-slider shape) and the legacy b1–b5 band keys, so
 * old shared #m= links (and existing callers/tests) keep working. Returns null
 * for anything unusable, which the caller turns into a 400.
 */
export function budgetRange(answers) {
  const b = answers.budget;
  if (Array.isArray(b) && b.length === 2) {
    const [lo, hi] = b.map(Number);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > 0) {
      return [Math.max(0, Math.min(lo, hi)), Math.max(lo, hi)];
    }
    return null;
  }
  if (typeof b === 'number' && Number.isFinite(b) && b > 0) return [0, b];
  return BUDGET_BANDS[b] || null;
}

/**
 * Annual mileage as a 0..1 fraction along the brand's ramp: at/under lowMiles
 * → 0, at/over highMiles → 1. Drives how much running costs matter (see
 * scoreEconomy / effectiveWeights) — for EVERY fuel now, not just diesel. The
 * legacy string band 'vhigh' maps to 1; an unanswered mileage → 0 (no strong
 * running-cost signal yet).
 */
function mileageFraction(answers, tuning) {
  const { lowMiles, highMiles } = tuning.mileage;
  const m = answers.mileage;
  if (typeof m === 'number') return clamp((m - lowMiles) / (highMiles - lowMiles));
  // Legacy string bands (old shared links / tests).
  return { low: 0, mid: 0.35, high: 0.7, vhigh: 1 }[m] ?? 0;
}

/** Convenience: is this a high-mileage buyer? (top third of the ramp). */
function isHighMileage(answers, tuning) {
  return mileageFraction(answers, tuning) >= 0.66;
}

/** Normalise a fuel answer to an array of preference values (multi-select). */
function fuelPrefs(answers) {
  const f = answers.fuel;
  const picks = Array.isArray(f) ? f : (f != null ? [f] : []);
  return picks.length ? picks : ['open'];
}

/** Charging access good enough for an EV/PHEV to make sense. */
function canChargeAt(charging) {
  return charging === 'home' || charging === 'work' || charging === 'either';
}

/* ---------------------------------------------------------------- *
 *  Per-dimension scorers. Each returns { score: 0..1, reason? }.    *
 * ---------------------------------------------------------------- */

function scoreBudget(car, answers) {
  const [min, max] = budgetRange(answers);
  // A slider budget has min 0, so phrase the "in budget" reason as an upper
  // limit ("up to £62k") rather than a "£0k–£62k" band.
  const budgetReason = `Well within <strong>budget</strong>`;
  if (car.priceMin > max) {
    // Survivor of the hard filter → it's a stretch buy.
    return { score: 0.35, stretch: true };
  }
  if (car.priceMax <= max && car.priceMax >= min) {
    return { score: 1, reason: budgetReason };
  }
  if (car.priceMax < min) {
    // Below the user's minimum. When there's no real floor (min 0, the old
    // "up to £X" slider) this is fine — just mildly off-target. But when the
    // user has deliberately set a min (a range), a car well under it is NOT
    // what they asked for, so penalise in proportion to how far below the floor
    // it sits: right at the floor ≈ 0.7, half the floor ≈ 0.35, far below → ~0.1.
    // Without this, a car £50k under a £92k floor still scored 0.7 and, since
    // budget is only ~1/5 of the blend, out-ranked in-budget cars on merit.
    if (!min) return { score: 0.7, reason: 'Under <strong>budget</strong>' };
    const shortfall = (min - car.priceMax) / min; // 0 at the floor → 1 at £0
    const score = clamp(0.7 - shortfall, 0.1, 0.7);
    return { score };
  }
  return { score: 0.75 }; // straddles the band edge
}

function scoreBody(car, answers, tuning) {
  const b = tuning.body;
  const picks = answers.bodyStyles || [];
  if (picks.length === 0 || picks.includes('any')) return { score: b.neutral };
  if (picks.includes(car.body)) {
    const labels = {
      hatchback: 'hatchback', saloon: 'saloon', estate: 'estate', suv: 'SUV',
      coupe: 'coupé', convertible: 'convertible', mpv: 'family carrier',
    };
    return { score: b.match, reason: `The ${labels[car.body]} shape you asked for` };
  }
  return { score: b.miss };
}

const FUEL_LABELS = { petrol: 'petrol', diesel: 'diesel', phev: 'plug-in hybrid', ev: 'fully electric' };

/*
 * How acceptable each fuel is as a substitute for the one asked for, read as
 * rows of "wanted → offered".
 *
 * The substitute scores used to sit around 0.5–0.7, which read as "a diesel is
 * 70% as good as the petrol you asked for". Combined with fuelStrictBoost that
 * still left a wrong-fuel car only ~8 points behind, so a car that was strong
 * on economy and character routinely beat one that actually matched: measured
 * at 15% of BMW cases and 8% of MINI's where a matching car was available and
 * lost anyway (`npm run audit fuel`). That directly contradicted the promise
 * made just below at fuelStrictBoost.
 *
 * Body style had the same flaw and was fixed the same way in July (miss → 0,
 * honesty 53% → 67%, diversity rose). Fuel can't go to zero — the degrees of
 * similarity are real, a plug-in genuinely is the closest thing to an EV — so
 * the ordering is kept and the scale compressed: a substitute now has to be
 * overwhelmingly better elsewhere to win, rather than merely better.
 *
 * "Help me decide" (`open`) never reads this table; it's scored by
 * circumstance in scoreOneFuel, and is unaffected.
 */
const FUEL_TABLE = {
  petrol: { petrol: 1, diesel: 0.25, phev: 0.3, ev: 0.1 },
  diesel: { diesel: 1, petrol: 0.25, phev: 0.25, ev: 0.1 },
  phev: { phev: 1, ev: 0.35, petrol: 0.25, diesel: 0.2 },
  ev: { ev: 1, phev: 0.3, petrol: 0.05, diesel: 0.05 },
};

/** Score one car against a single fuel preference. Returns { score, reason? }. */
function scoreOneFuel(pref, car, answers, tuning) {
  const charging = answers.charging || 'none';
  const canCharge = canChargeAt(charging);
  // EVs and PHEVs make much less sense with no charging access. "either" and
  // "home" both imply home access — the best case.
  const evAccess = (charging === 'home' || charging === 'either') ? 1 : charging === 'work' ? 0.85 : 0.3;

  let score;
  if (pref === 'open') {
    // "Help me decide": recommend by circumstance.
    if (car.fuel === 'ev') score = canCharge ? 0.95 : 0.25;
    else if (car.fuel === 'phev') score = canCharge ? 0.85 : 0.6;
    else if (car.fuel === 'diesel') score = isHighMileage(answers, tuning) ? 0.9 : 0.55;
    else score = 0.7;
  } else {
    score = FUEL_TABLE[pref][car.fuel];
    if (car.fuel === 'ev') score *= evAccess;
    if (car.fuel === 'phev' && !canCharge) score *= 0.7;
  }

  let reason;
  if (score >= 0.85) {
    if (car.fuel === 'ev') {
      reason = car.evRange ? `Fully <strong>electric</strong> — ${car.evRange}-mile range` : 'Fully <strong>electric</strong>';
    } else if (pref !== 'open') {
      reason = `Is a <strong>${FUEL_LABELS[car.fuel]}</strong> car`;
    } else if (car.fuel === 'diesel' && isHighMileage(answers, tuning)) {
      reason = '<strong>Diesel</strong> suits your high mileage';
    }
  }
  return { score, reason };
}

function scoreFuel(car, answers, tuning) {
  // Fuel is multi-select: the user can pick several fuels (or none, which reads
  // as "help me decide"). Score the car against each chosen fuel and take the
  // best — a petrol car matching "Petrol + EV" scores on its petrol merit. An
  // unanswered set falls back to ['open'] (fuelPrefs), so a partial answer set
  // still ranks instead of throwing on FUEL_TABLE[undefined].
  const prefs = fuelPrefs(answers);
  let best = { score: -1 };
  for (const pref of prefs) {
    const r = scoreOneFuel(pref, car, answers, tuning);
    if (r.score > best.score) best = r;
  }
  return best;
}

/*
 * How much luggage space this buyer needs, expressed as one of the per-brand
 * bootNeed keys (small/medium/big — see tuning.practicality.bootNeed).
 *
 * There is no "how much boot space?" question any more: it changed the top 3
 * in only 13% of BMW cases and ~25% of MINI's (docs/question-stock-audit.md),
 * because it asked for something the rest of the answers already imply. The
 * need is instead derived from the two answers that genuinely carry it, each
 * scored 0/1/2 and summed:
 *
 *   people      solo 0, family 1, crew 2 — people displace luggage, and a
 *               "full crew" is the one answer that asks for everything a car
 *               has (it already drives the seat/boot hard filters too).
 *   primaryUse  family duties and long motorway trips 1 (buggies, weekly
 *               shops, a week's luggage); city, commuting and weekend
 *               driving 0 — those are a bag and a coat.
 *
 * Summing rather than taking the larger is what preserves the discrimination
 * the question used to provide: a small family on the school run (1+1 → big)
 * genuinely needs more room than the same family commuting (1+0 → medium),
 * a distinction the old three-way question could only capture if the user
 * stopped to think about it. Unanswered ⇒ 0 ⇒ "small" ⇒ no space requirement,
 * so a partial answer set (the mid-quiz preview) still scores a real number.
 *
 * A legacy shared link may still carry a `boot` answer. It is deliberately
 * ignored, not honoured: every buyer's need is derived the same way, so two
 * people who answer identically get identical results.
 */
const PEOPLE_SPACE = { solo: 0, family: 1, crew: 2 };
const USE_SPACE = {
  city: 0, commute: 0, fun: 0, family: 1, roadtrips: 1,
};
const SPACE_KEYS = ['small', 'medium', 'big'];

function bootNeedKey(answers) {
  const level = (PEOPLE_SPACE[answers.people] ?? 0) + (USE_SPACE[answers.primaryUse] ?? 0);
  return SPACE_KEYS[Math.min(level, SPACE_KEYS.length - 1)];
}

/*
 * A reason phrase in the brand's own register (see `reasons` in brands.js).
 * Falls back to BMW's, which is the base every brand merges onto, so a brand
 * that overrides nothing still says something.
 */
function phrase(tuning, key, car) {
  const say = tuning.reasons?.[key] ?? DEFAULT_TUNING.reasons[key];
  return say(car);
}

function scorePracticality(car, answers, tuning) {
  const { bootNeed, seatsFloor, crewBonusSeats } = tuning.practicality;
  // Boot targets are per-brand (a MINI's "big" is smaller than a BMW's), so
  // the derived key is looked up in the brand's own table.
  const need = bootNeed[bootNeedKey(answers)] ?? 0;
  const seatsOk = answers.people === 'solo' || car.seats >= seatsFloor;
  let score = need === 0 ? 1 : clamp(car.boot / need);
  if (!seatsOk) score *= 0.3;
  // A crew buyer with the bonus seats gets a perfect practicality score; the
  // shortfall for a sub-7-seat crew car is applied as a whole-score penalty in
  // rankCars (crewSeatShortfall), not here — practicality alone is too small a
  // lever to overcome a 7-seater's budget/economy headwind.
  if (answers.people === 'crew' && car.seats >= crewBonusSeats) {
    return { score: 1, reason: phrase(tuning, 'crew', car) };
  }
  /*
   * Both variants state the litres AND that the figure is seats-up, because
   * that qualifier is what makes a boot number believable — an unqualified one
   * might quietly be the seats-down figure, which is exactly the sort of claim
   * Priya says she cannot picture. The card prints the same number in its spec
   * line, so the reason and the spec can be checked against each other.
   */
  let reason;
  if (need > 0 && car.boot >= need) {
    reason = phrase(tuning, 'boot', car);
  } else if (need > 0 && car.boot >= need * 0.9) {
    reason = phrase(tuning, 'bootTight', car);
  }
  return { score, reason };
}

function scorePerformance(car, answers, tuning) {
  const { zeroBase, span } = tuning.performance;
  const wantsIt = Number(answers.style) >= 4 || (answers.priorities || []).includes('performance');
  // Per-brand 0-62 curve: a MINI is quick for its class but never fast in
  // absolute BMW terms, so its curve tops out at a slower time.
  //
  // Two curves, because one can't serve both buyers. The default is generous:
  // to someone who didn't ask for speed, anything reasonably brisk is fine.
  // But it clamps everything under ~4.5s to a flat 1.0, so to an enthusiast a
  // 3.5s M2 and a 5.0s grand tourer scored within 8% of each other — and the
  // tourer won on practicality, which is not the car that buyer asked for.
  // When performance is explicitly wanted, resolve the fast end properly.
  const base = wantsIt ? zeroBase - 3 : zeroBase;
  const range = wantsIt ? span - 2 : span;
  const score = clamp((base - car.zeroTo62) / range);
  let reason;
  if (score >= 0.85 && wantsIt) {
    reason = `0–62 in <strong>${car.zeroTo62}s</strong>`;
  }
  return { score, reason };
}

function scoreEconomy(car, answers, tuning) {
  const canCharge = canChargeAt(answers.charging);
  // How much running costs matter, 0..1 by annual mileage. High-mileage buyers
  // want genuinely cheap-per-mile cars; low-mileage buyers can indulge a
  // thirsty one. `miles` scales the reward for efficiency and the penalty for a
  // gas-guzzler, so mileage now moves the ranking for EVERY fuel.
  const miles = mileageFraction(answers, tuning);
  let score;
  let reason;
  if (car.fuel === 'ev') {
    // EVs are cheapest per mile — the higher the mileage, the more that wins.
    score = canCharge ? 1 : clamp(0.5 + 0.2 * miles);
    if (canCharge) {
      reason = 'Pennies per mile to <strong>charge</strong>';
    }
  } else if (car.fuel === 'phev') {
    score = canCharge ? clamp(0.85 + 0.1 * miles) : clamp(0.6 - 0.1 * miles);
    if (canCharge && car.evRange) reason = `${car.evRange} electric miles per charge`;
  } else {
    // Petrol/diesel: base on mpg, then tilt by mileage — a frugal car is worth
    // more the further you drive, a thirsty one worth less. A car the feed
    // gave no consumption figure for (7 of 13k) scores neutral rather than
    // NaN — unknown is not the same as thirsty, and a NaN here poisons the
    // whole blend and can sort the car to the top.
    const mpg = Number(car.mpg);
    if (!Number.isFinite(mpg)) return { score: 0.5 };
    const base = clamp((mpg - 25) / 35);
    // At high mileage, pull the score toward its mpg merit harder (thirsty cars
    // sink, frugal cars rise); at low mileage, soften both extremes toward 0.7.
    score = clamp(base + (base - 0.5) * miles);
    if (score >= 0.8) {
      reason = `Frugal at <strong>${car.mpg}mpg</strong>`;
    }
  }
  return { score, reason };
}

function scoreSize(car, answers, tuning) {
  const { roadtripMinClass, cityDivisor } = tuning.size;
  if (answers.primaryUse === 'city') {
    const score = (cityDivisor + 1 - car.sizeClass) / cityDivisor;
    return {
      score: clamp(score),
      reason: car.sizeClass <= 2 ? phrase(tuning, 'city', car) : undefined,
    };
  }
  if (answers.primaryUse === 'roadtrips') {
    const big = car.sizeClass >= roadtripMinClass;
    // Was "Big-car refinement for long motorway days", which asserts a quality
    // nothing in the data supports. Size is all we actually know here, so size
    // is all the reason claims.
    return { score: big ? 1 : 0.6, reason: big ? phrase(tuning, 'roadtrip', car) : undefined };
  }
  return { score: 0.7 };
}

const USE_TAGS = {
  fun: ['drivers-car'],
  family: ['family', 'practical'],
  commute: ['efficient', 'cruiser'],
  city: ['urban'],
  roadtrips: ['cruiser'],
};

/**
 * The character phrases, brand by brand. Merged key-by-key onto BMW's rather
 * than taken wholesale, so a brand overriding three tags keeps BMW's wording
 * for the other five instead of silently losing them — mergeTuning's shallow
 * merge would do the latter.
 */
function tagReasons(tuning) {
  return { ...DEFAULT_TUNING.reasons.tags, ...(tuning.reasons?.tags || {}) };
}

function scoreCharacter(car, answers, tuning) {
  const wanted = new Set(USE_TAGS[answers.primaryUse] || []);
  const style = Number(answers.style);
  if (style >= 4) wanted.add('drivers-car');
  if (style <= 2) wanted.add('cruiser');
  for (const p of answers.priorities || []) {
    if (p === 'tech') wanted.add('tech');
    if (p === 'image') wanted.add('image');
    if (p === 'comfort') wanted.add('cruiser');
    if (p === 'economy') wanted.add('efficient');
    if (p === 'performance') wanted.add('drivers-car');
  }
  const hits = car.tags.filter((t) => wanted.has(t));
  const score = clamp(hits.length / 2);
  return { score, reason: hits.length ? tagReasons(tuning)[hits[0]] : undefined };
}

const STYLE_LINE_LABEL = {
  classic: 'Classic', exclusive: 'Exclusive', sport: 'Sport', jcw: 'John Cooper Works',
};

/**
 * Trim-character match (MINI). The user's vibe answer arrives as answers.styleLine
 * (folded in by applyBespokeAnswers); the car carries its own from the derivative.
 * A "sport" want is satisfied by a JCW too — JCW is the sport line's extreme, so a
 * go-kart-minded buyer shouldn't be marked down for landing on one.
 *
 * No-ops safely for any brand that doesn't tune it (no tuning.styleLine → neutral,
 * multiplied by a zero weight), and treats an unknown car trim as neutral, never a
 * miss — an unparsed derivative isn't a wrong answer. See docs/mini-first-questions.md.
 */
function scoreStyleLine(car, answers, tuning) {
  const cfg = tuning.styleLine;
  if (!cfg || !answers.styleLine || !car.styleLine) return { score: cfg?.neutral ?? 0.7 };
  const want = answers.styleLine;
  const hit = want === 'sport'
    ? (car.styleLine === 'sport' || car.styleLine === 'jcw')
    : car.styleLine === want;
  return hit
    ? { score: cfg.match, reason: `${STYLE_LINE_LABEL[car.styleLine]} trim, just the character you asked for` }
    : { score: cfg.miss };
}

/**
 * Door-count preference (MINI Hatch only). answers.doors is '3' | '5' | 'either';
 * 'either' (or unanswered, or a non-hatch car with no door count) scores neutral.
 * A soft preference: a wrong count is a gentle miss, never a hard filter, and an
 * unknown car door count is neutral, not penalised.
 */
function scoreDoors(car, answers, tuning) {
  const cfg = tuning.doors;
  const want = Number(answers.doors);
  if (!cfg || !want || !car.doors) return { score: cfg?.neutral ?? 0.7 };
  return car.doors === want
    ? { score: cfg.match, reason: `${want}-door body, exactly the shape you wanted` }
    : { score: cfg.miss };
}

/* ---------------------------------------------------------------- *
 *  Orchestration                                                    *
 * ---------------------------------------------------------------- */

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
const TASTE_DIMENSIONS = new Set(['character', 'performance', 'styleLine']);

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
const TASTE_SHARE = Number(process.env.TASTE_SHARE ?? 0.2);

/**
 * Weights for the objective half: how well the car suits the buyer's stated
 * needs and circumstances. Deliberately free of `priorities` — what someone
 * *likes* must not change how well a car actually fits them.
 */
function fitWeights(answers, tuning) {
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
function tasteWeights(answers, tuning) {
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
function effectiveWeights(answers, tuning) {
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

function passesHardFilters(car, answers, tuning) {
  const { crewBoot, crewSeats, familySeats } = tuning.hardFilter;
  const [, max] = budgetRange(answers);
  if (car.priceMin > max * tuning.stretchFactor) return false;
  if (answers.people === 'crew' && (car.seats < crewSeats || car.boot < crewBoot)) return false;
  if (answers.people === 'family' && car.seats < familySeats) return false;
  return true;
}

const SCORERS = {
  budget: scoreBudget,
  body: scoreBody,
  fuel: scoreFuel,
  practicality: scorePracticality,
  performance: scorePerformance,
  economy: scoreEconomy,
  size: scoreSize,
  character: scoreCharacter,
  // Brand-optional dimensions: only weighted where a brand's tuning names them
  // (MINI). A brand without the weight contributes 0 (see the `?? 0` in rankCars),
  // so BMW's blend is unchanged and the scorers above never fire for it.
  styleLine: scoreStyleLine,
  doors: scoreDoors,
};

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
  const fitTotal = Object.values(fitW).reduce((a, b) => a + b, 0);
  const tasteTotal = Object.values(tasteW).reduce((a, b) => a + b, 0);

  return cars
    .filter((car) => passesHardFilters(car, answers, tuning))
    .map((car) => {
      let fitWeighted = 0;
      let tasteWeighted = 0;
      let stretch = false;
      const candidates = [];
      for (const [dim, scorer] of Object.entries(SCORERS)) {
        // A dimension a brand doesn't weight (e.g. styleLine/doors for BMW)
        // contributes nothing and can't surface a reason — so adding a scorer
        // is inert for every brand that doesn't opt in via its tuning weights.
        const weight = (fitW[dim] ?? 0) + (tasteW[dim] ?? 0);
        if (weight === 0) continue;
        const r = scorer(car, answers, tuning);
        if (fitW[dim]) fitWeighted += fitW[dim] * r.score;
        if (tasteW[dim]) tasteWeighted += tasteW[dim] * r.score;
        if (r.stretch) stretch = true;
        if (r.reason && r.score >= 0.7) {
          candidates.push({ reason: r.reason, rank: weight * r.score });
        }
      }
      const reasons = candidates
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 4)
        .map((c) => c.reason);
      // "…but maybe worth it" was a nudge, and a nudge is the thing a buyer
      // who assumes the tool ranks on margin is watching for. State the fact
      // and let them price it.
      if (stretch) reasons.push(`A stretch at ${gbp(car.priceMin)}+, over the budget you set`);
      let ratio = fitWeighted / fitTotal;
      // Whole-score penalty for a "crew" buyer's sub-7-seat car: strong enough
      // that genuine 7-seaters top when in stock, but 5-seaters still rank (and
      // win when no 7-seater exists) — so it's stock-safe, not a hard filter.
      if (answers.people === 'crew' && car.seats < tuning.practicality.crewBonusSeats) {
        ratio *= tuning.crewSeatShortfall ?? 1;
      }
      const tasteRatio = tasteTotal ? tasteWeighted / tasteTotal : 0;
      return {
        car,
        // The match %: mostly how well the car suits them, plus a guaranteed
        // slice of how much they'd like it. The fixed TASTE_SHARE is the point.
        // Before, taste dimensions were nominally ~16-25% of a single weighted
        // sum, but fuelStrictBoost inflated the fit side until the preference
        // questions couldn't move the answer at all. Pinning the ratio means
        // taste keeps its say no matter how hard the constraints bind.
        score: Math.round((ratio * (1 - TASTE_SHARE) + tasteRatio * TASTE_SHARE) * 100),
        // The two halves kept separately: `fit` is what the honesty layer talks
        // about, `taste` orders cars the fit score can't separate.
        fit: Math.round(ratio * 100),
        taste: Math.round(tasteRatio * 100),
        stretch,
        reasons,
        tradeOffs: tradeOffs(answers, car),
      };
    })
    // Fit first, then taste — so within a group of equally suitable cars the
    // buyer's stated preferences pick the order. Price and name remain as the
    // final deterministic tie-break.
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.taste - a.taste ||
        a.car.priceMin - b.car.priceMin ||
        a.car.name.localeCompare(b.car.name),
    );
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
    groups.get(k).listings.push(match.car);
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
      matches: [], decisive: true, clusterSize: 0, tasteLead: false, searched,
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
