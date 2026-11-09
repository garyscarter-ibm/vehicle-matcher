/*
 * Retail answer interpretation and per-dimension scoring curves.
 *
 * Pure and dependency-free: every calibration constant lives in the per-brand
 * `tuning` argument (brands.js), which defaults to BMW's values.
 */

import { BUDGET_BANDS } from '../../questions.js';
import { brandTuning } from '../../brands.js';

/** Default tuning = BMW's (the engine's original constants). */
export const DEFAULT_TUNING = brandTuning('bmw');

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
export const gbp = (n) => `£${Math.round(n / 1000)}k`;

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
export function mileageFraction(answers, tuning) {
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
export function fuelPrefs(answers) {
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
  const budgetReason = min > 0 ? `Sits right in your ${gbp(min)}–${gbp(max)} budget` : `Comfortably within your ${gbp(max)} budget`;
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
    if (!min) return { score: 0.7, reason: 'Comes in under budget' };
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
      reason = canCharge
        ? `Fully electric with a ${car.evRange}-mile range, ideal with your charging setup`
        : `Fully electric with a ${car.evRange}-mile range`;
    } else if (pref !== 'open') {
      reason = `The ${FUEL_LABELS[car.fuel]} power you wanted`;
    } else if (car.fuel === 'diesel' && isHighMileage(answers, tuning)) {
      reason = 'Diesel torque and economy suit your big annual mileage';
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
    reason = `0–62 in ${car.zeroTo62}s, as quick as you hoped`;
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
      reason = miles >= 0.66
        ? 'Pennies per mile charging at home or work, ideal for your big annual mileage'
        : 'Pennies per mile charging at home or work';
    }
  } else if (car.fuel === 'phev') {
    score = canCharge ? clamp(0.85 + 0.1 * miles) : clamp(0.6 - 0.1 * miles);
    if (canCharge && car.evRange) reason = `Around ${car.evRange} electric miles covers most daily driving`;
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
      reason = miles >= 0.66
        ? `Frugal at around ${car.mpg}mpg, kind on a big annual mileage`
        : `Frugal for what it is, around ${car.mpg}mpg`;
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

export const SCORERS = {
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
