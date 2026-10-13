/*
 * Questionnaire mode — the original, question-by-question matcher interface.
 *
 * One of several interchangeable interface "modes" over the shared engine (see
 * ../modes/index.js and the shell in ../vehicle-matcher.js). This is the whole
 * quiz UI: intro, the question flow, the live "best guess" preview, the results
 * page and refinement. The shell reads brand/retailer/config and hands this
 * mode a `ctx` and a stage element to render into via `mount(root, ctx)`.
 *
 * The scoring engine and car dataset live behind an API (see server/ and
 * ../engine.js); this mode fetches the quiz definition and match results over
 * HTTP and never sees the dataset.
 *
 * Share links encode the quiz answers in the URL hash (#m=<base64url>); the
 * link is decoded/validated client-side (quiz-meta.js), then the results are
 * re-fetched from the API. Deep-linking is owned here rather than by the shell
 * because the encoded state is this mode's answer shape.
 */

import { BUDGET_BANDS, pillFor } from '../quiz-meta.js';
import { apiGetQuestions, apiMatch, apiNearby } from '../engine.js';
import { el, cardinal, gbp } from '../ui.js';
import {
  BRAND_COPY, UNMET_PHRASES, TRADE_COPY, orList, andList, tradeLines,
} from './brand-copy.js';
import {
  CONCEPT_LABELS, listingsOf, distanceLabel, matchCard, previewTile, setRrmcAnswers,
} from './result-card.js';
import {
  isVisible, visibleQuestions, formatSliderValue, renderRangeSlider, renderOptionList, renderBudgetDrawer,
} from './question-ui.js';
import { createPreviewFeed } from './preview-feed.js';

const HASH_KEY = 'm';

/* ------------------------------ helpers ------------------------------ */

/**
 * Is the budget answer usable? Budget drives the engine's one hard requirement.
 * It's a dual-thumb range ([min, max]) from the slider, but we also accept a bare
 * number (the earlier single-slider shape) and a legacy b1–b5 band key from an
 * old shared link. Mirror of budgetRange's guard in server/engine.js.
 */
function validBudget(value) {
  if (Array.isArray(value)) {
    return value.length === 2 && value.every(Number.isFinite) && Math.max(...value) > 0;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return !!BUDGET_BANDS[value];
}

/**
 * The wants BOTH halves of the reachable pool agree they can't meet.
 *
 * The retailer's stock and the nearby tier are fetched independently, and a
 * car one street over still counts as reachable — so a want is only truly
 * unavailable when the retailer AND nearby both came back without it. A
 * `nearbyUnmet` of null means nearby never answered (failed or still cold):
 * that's an absence of facts, so we claim nothing at all.
 */
function agreedUnmet(retailerUnmet, nearbyUnmet) {
  if (!nearbyUnmet) return {};
  const agreed = {};
  for (const [id, values] of Object.entries(retailerUnmet || {})) {
    const both = values.filter((v) => (nearbyUnmet[id] || []).includes(v));
    if (both.length) agreed[id] = both;
  }
  return agreed;
}

/**
 * The buyer's original brief, in short phrases, taken from the questions they
 * actually answered. Only the defining three — fuel, shape, budget — because
 * this is a reminder of what they said, not a transcript of it.
 */
function briefFromAnswers(ctx) {
  const labelsFor = (id, values) => {
    const q = ctx.questions.find((x) => x.id === id);
    if (!q?.options) return [];
    return values
      .map((v) => q.options.find((o) => o.value === v)?.label)
      .filter(Boolean);
  };
  const bits = [];
  const fuels = (Array.isArray(ctx.answers.fuel) ? ctx.answers.fuel : [ctx.answers.fuel])
    .filter((v) => v && v !== 'open');
  bits.push(...labelsFor('fuel', fuels));
  bits.push(...labelsFor('bodyStyles', (ctx.answers.bodyStyles || []).filter((v) => v !== 'any')));
  const budgetQ = ctx.questions.find((x) => x.id === 'budget');
  if (budgetQ) {
    const b = pillFor(budgetQ, ctx.answers);
    if (b) bits.push(b);
  }
  return bits;
}

/*
 * How far apart two scores may be and still count as a tie. Mirrors the
 * engine's CLUSTER_PTS: the page re-derives which result state it is in after
 * every narrowing, so it needs the same threshold the server used.
 */
const CLUSTER_PTS = 3;

/** Cars beyond a group's lead, shown as compact tiles under the same heading.
 *  A backstop, not the main control: RELEVANT_PTS below usually cuts first. */
const TAIL_SHOWN = 6;

/*
 * How far behind the best car on the page a car may be and still be worth
 * showing at all.
 *
 * The tail used to be a flat six per group, blind to score. Priya's page ran
 * 96, 95 and then 78, 75, 74, 73, 73, 72: two genuine matches followed by six
 * cars answering a different question, under a headline about how well the
 * first two fit. A car eighteen points back is not an alternative, it is a
 * change of subject.
 *
 * Ten, measured against the eight personas' live distributions. It lands on
 * the natural cliff in six of the eight (Priya's 17pt drop, Meg's 30, Reyes'
 * 19, Tyler's 29, Daniel's 9, Chloe's 7) and gives a sensible answer in the
 * other two. It has to be relative: an absolute floor of 70 would show Priya
 * all nine of hers and Rob Jennings none at all, his best being 67.
 */
const RELEVANT_PTS = 10;

/*
 * How long the first paint will wait for the national search before going
 * ahead without it.
 *
 * The two searches now leave together (see renderResults), and measured warm
 * against the live API they are the same speed: 0.33s local, 0.26s national.
 * So in the common case the second one is already back and the page paints
 * once, complete. This budget only covers the gap between them.
 *
 * It is deliberately shorter than the local call usually takes, so it cannot
 * make a fast page slow. It only ever waits on a race that is nearly won.
 */
const GRACE_MS = 1500;

/** Cap on cards given the full lead treatment. Mirrors the engine's own. */
const MAX_SHOWN = 6;

/*
 * Below this, and missing something they asked for, the page stops presenting
 * the leader as an answer at all.
 *
 * The page could already say *the closest here misses your brief* and had no
 * words for *nothing here is close*, so a 67% leader was announced in exactly
 * the same voice as an 85% one. Rob Jennings is in the persona set to test
 * that: he walks away when "the tool recommends rather than filters", and
 * winning him looks like the tool saying "we do not have the right car for you
 * this week" when that is true.
 *
 * TWO CONDITIONS, and the first is what makes the sentence true. The state only
 * fires over a leader that already carries a trade-off, i.e. it is `closest`
 * escalated rather than a new population. A car that meets every stated want
 * and scores 63 is a car we DO have in the shape and fuel asked for; telling
 * that buyer "nothing here matches your brief" would be false on its face, and
 * the low score is coming from budget position or practicality, which the
 * cards already show.
 *
 * SIXTY-EIGHT, measured. Replayed matchCars over fixtures/*-cars.json two ways
 * — 40 retailers × 25 uniform answer sets per brand, and every persona's answers
 * perturbed one question at a time (the `stick` model, because uniform sampling
 * pairs combinations nobody picks) — and took the score distribution of the
 * population this splits, the `closest` pages:
 *
 *   BMW uniform     513 closest pages   median 69   p25 60  p75 78
 *   BMW personas     91 closest pages   median 67   p25 66  p75 71
 *   MINI uniform    590 closest pages   median 68   p25 59  p75 78
 *   MINI personas     8 closest pages   (too few to read)
 *
 * There is NO cliff in that distribution — it is unimodal and wide — so the
 * threshold is a policy choice about how often the tool is willing to say no,
 * and the only defensible place to put it is the middle of the population it
 * divides. Three independent samples put that at 67, 68 and 69. The state
 * therefore covers roughly the worse half of `closest` pages, which is ~24% of
 * realistic pages on BMW and ~2% on MINI (Sytner Luton's stock simply fits the
 * MINI personas well).
 *
 * Rob lands at 67 and fires; Martin at 71 does not, and that is a consequence
 * of the median rather than the target — worth saying plainly, because Rob's
 * page turns out to be an ordinary `closest` page rather than an outlier.
 * Martin belongs in `closest`: his page already tells him straight (the rescue
 * note names the convertible and where it is), his ask IS met 18 miles away,
 * and his clause is about being handled, not about being told no.
 *
 * Re-measure with `npm run audit confidence` after a fixture refresh.
 */
const WEAK_SCORE = 68;

/**
 * A car with no `distance` came from the configured retailer's own feed; the
 * national search sets one on everything it returns. That single fact is what
 * splits the list into its two groups.
 */
const isHere = (m) => m.car.distance == null;

/**
 * The results list, plus every means of arguing with it.
 *
 * ONE ranked list, GROUPED BY PLACE. Both halves of that matter.
 *
 * One list, because the page used to be three — the retailer's matches, a
 * quieter "More at <retailer>" band, and a "Worth the drive" carousel — each
 * ranked internally and captioned honestly on its own terms. Stacked
 * vertically they read as one list that isn't sorted: Priya's page ran 96, 95
 * → 78 → 99, 97, so it claimed two cars fit best and then showed a 99% one
 * scroll down. Nobody reads three lists. See docs/results-page-review.md.
 *
 * Grouped by place, because this block is authored onto ONE retailer's site. A
 * tool on Sytner's page whose answer is "go to Group 1 Bedford" is answering a
 * different question than the page implies. So the groups are the retailer's
 * cars and then everyone else's, sorted by score inside each, and the headline
 * is derived from the retailer's cars because that is what it is scoped to.
 *
 * The governing rule, and the reason this isn't a rebuild of the bands it
 * replaced: GROUPS MAY DESCRIBE PLACE. THEY MAY NEVER CLAIM QUALITY. The old
 * page broke because "Close, but not level with the cars above" and "two of
 * these fit you equally well" were both quality claims on the same scale made
 * by different sections, so one could contradict the other. "At Grassicks
 * Garage" and "At other retailers" assert nothing about fit, so a 99% in the
 * second group contradicts nothing in the first.
 *
 * Every card still says where it is (see matchCard's provenance line). The
 * group heading is a signpost, not the only place that fact lives.
 *
 * Nearby stock arrives late (a slow national search) and joins the same pool
 * through `addToPool`, which is why the pool is mutable and the headline is
 * derived rather than fixed.
 *
 * The headline is re-derived on every redraw from the scores actually on
 * screen, never from the card count. That fixes a class of lie rather than one
 * instance: "TWO OF THESE FIT YOU EQUALLY WELL" was rendered over a 96% and a
 * 73% because narrowing back-filled the set to keep its size and nothing
 * re-tested the claim. Back-filling is right; not re-checking was not.
 *
 * Two rules the plan insists on, both still here: an applied refinement is
 * always shown and always revocable (a chip you can't see is a filter you
 * can't argue with), and narrowing to nothing is a legitimate outcome that
 * must be explained rather than rendered as an empty grid.
 *
 * @param {HTMLElement} title the results headline, rewritten on every redraw
 * @param {HTMLElement} lede the framing line, dropped once one car remains
 * @param {Object} frames how each situation may be described (docs/
 *   results-page-states.md), keyed by state. Chosen per redraw, because
 *   narrowing can move the page from one state to another.
 * @returns {{ host: HTMLElement, addToPool: (matches) => void }}
 */
function renderRefine(
  ctx, initialPool, title, lede, frames, tasteLead = false, searched = null,
  searching = false,
) {
  const copy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  // Mutable: nearby stock joins after first paint. Always kept in score order
  // so "the list" and "ranked by fit" mean the same thing.
  /*
   * Score first, then the configured retailer ahead of a distant one.
   *
   * The tie-break matters more than it looks. Merging nearby stock into the
   * list means local and distant cars can land on identical scores, and
   * without a rule the order is whatever the arrays happened to be in. Owner
   * decision (2026-07-22) stands: proximity is the buyer's trade to make, so
   * when two cars fit equally well the one they can walk to leads. A nearby
   * car that genuinely scores HIGHER still leads — that is the whole point of
   * merging the list — it just has to earn it rather than win a coin toss.
   */
  const rank = (a, b) => b.score - a.score
    || (a.car.distance == null ? 0 : 1) - (b.car.distance == null ? 0 : 1)
    || (a.car.distance ?? 0) - (b.car.distance ?? 0);
  let pool = [...initialPool].sort(rank);
  /*
   * The taste lead is a server judgement about one specific car: "of the cars
   * that fit you equally well, this is the one your priorities point at". It
   * therefore only stands while that car is still the one leading. Narrow it
   * away, reject it, or let a nearby car outrank it, and the claim is about a
   * car that is no longer being recommended.
   */
  const tasteLeader = tasteLead ? pool[0]?.car.id : null;
  const tasteLed = (alive) => Boolean(tasteLeader) && alive[0]?.car.id === tasteLeader;
  const active = new Map(); // axis id -> axis

  // Everything narrowing the set, positive or negative, in one place: a
  // required feature and a rejected colour differ only in what they keep. Both
  // render as removable chips, because a filter the user can't see is one they
  // can't argue with — and at this stock depth two constraints can empty a
  // tie, which must be explainable rather than mysterious.
  const constraints = new Map(); // id -> { label, test(listing) }
  const hidden = new Set(); // cars waved away with no reason given

  const host = el('div', 'vm-refine');
  const chipRow = el('div', 'vm-chips');
  /*
   * The running brief: what the buyer said at the start, plus everything
   * they've told us since by tapping a chip or turning a car down. It grows as
   * they go, so the tool visibly holds a model of them rather than silently
   * re-filtering. This replaced a flat "2 of 6 left, with X and Y" line —
   * accurate, but it read as a filter count rather than as listening.
   */
  const status = el('div', 'vm-brief');

  /*
   * The two groups: the retailer's own cars, then everyone else's. Each is one
   * section with one PLACE heading, its lead cars at full size and the rest as
   * tiles, in score order throughout. A group that ends up with no cars is
   * never mounted, so an empty heading can't appear.
   */
  const grid = el('div', 'vm-grid vm-grid-tied');
  const hereGroup = el('section', 'vm-group');
  const hereLabel = el('h3', 'vm-subhead vm-group-label', '');
  const hereRestGrid = el('div', 'vm-tail-grid');
  const awayGroup = el('section', 'vm-group');
  /*
   * "Still looking" placeholder for the other-retailers group.
   *
   * Only shown when the national search lost the grace race, which is now the
   * exception. It exists because the alternative is worse: a whole group of
   * cars appearing out of nothing several seconds after the page settled,
   * re-sorting the list and sometimes changing which car leads, while the
   * buyer is reading. Reserving the space and saying what is happening turns
   * an ambush into an expectation.
   */
  // Flipped by searchDone() when the national search finally lands or fails.
  let stillSearching = searching;
  const awayPending = el('p', 'vm-pending');
  awayPending.hidden = true;
  awayPending.append(el('span', 'vm-pending-dot'), copy.searchingNearby);
  const awayLabel = el('h3', 'vm-subhead vm-group-label', copy.awayHeading);
  const awayGrid = el('div', 'vm-grid vm-grid-tied');
  const awayRestGrid = el('div', 'vm-tail-grid');

  /*
   * Two things were moved below the cards together in the rebuild, and only
   * one of them belonged there.
   *
   * The chips are a CONTROL, so they sit directly above what they control. Put
   * below the fold they became, in the owner's words, "a bit confusing to use
   * and it's unclear what clicking them affects" — you cannot see the thing
   * being narrowed while you narrow it. The brief is a SUMMARY, and summaries
   * belong after. So the chips came back up and the brief stayed down.
   *
   * Deliberately NOT sticky: that was considered and rejected, because it
   * fights the EDS host page's own header.
   */
  const refineBlock = el('div', 'vm-refine-tools');
  const briefBlock = el('div', 'vm-brief-block');
  // RRMC leaves out the "What we have learned" panel; the cards speak for themselves.
  if (ctx.brand === 'rrmc') briefBlock.hidden = true;
  /*
   * The other half of a scoped headline: the car elsewhere that beat the best
   * one here, named, with where it is.
   *
   * It used to fire once, only if late-arriving nearby stock changed the
   * leader. Now it is derived on every redraw from the same comparison that
   * decides whether the headline scopes, so the two always agree: scope the
   * headline and this says what forced it; leave the headline unqualified and
   * this is silent. Anything else would leave "at Grassicks Garage" hanging
   * with no explanation of what it was protecting the page from.
   */
  const notice = el('p', 'vm-notice');
  notice.hidden = true;
  // The car a rescue note above the cards already points at, when there is one.
  // Set by renderResults; see `noteShown` below for why it matters.
  let notedCarId = null;
  hereGroup.append(hereLabel, grid, hereRestGrid);
  awayGroup.append(awayLabel, awayPending, awayGrid, awayRestGrid);
  /*
   * The working, under the cars.
   *
   * A page holding one card is correct when nothing else is close, and it
   * still reads as thin stock rather than as a clear winner, because the
   * reader cannot tell whether we searched three cars or three hundred.
   * Adding weaker cars back would not fix that: a page of seven is equally
   * silent about how many were rejected, and a card is an invitation, so
   * offering a car thirty points off the pace to prove it is not worth having
   * undermines the claim it was meant to defend. What was missing is evidence
   * of the search, so this says it.
   */
  const working = el('aside', 'vm-working');
  working.hidden = true;

  host.append(notice, briefBlock, refineBlock, hereGroup, awayGroup, working);

  /*
   * Survivors of everything the buyer has said, drawn from the WHOLE pool so a
   * rejection promotes the next-best car instead of leaving a hole.
   *
   * Every filter is applied to LISTINGS, not to cards. That distinction is the
   * whole of this function and it matters: grouping made a card "a model the
   * retailer has four of", so judging it by whichever listing happened to rank
   * first is judging three cars by a fourth. "Not the Chili Red" on a card
   * that's also available in Midnight Black used to delete both — the colour
   * she'd have taken went with the one she turned down.
   *
   * So: narrow each card's listings, drop the card only when nothing is left,
   * and rebuild what the card claims (count, price range, colours) from what
   * actually survived.
   */
  function narrow(m) {
    if (hidden.has(m.car.id)) return null;
    const tests = [...active.values(), ...constraints.values()];
    const all = listingsOf(m);
    const kept = all.filter((l) => tests.every((t) => t.test(l)));
    if (!kept.length) return null;
    if (kept.length === all.length) return m;
    return { ...m, car: regroup(m.car, kept), listings: kept };
  }
  const surviving = () => pool.map(narrow).filter(Boolean);

  /**
   * The lead of a sorted list: its top car plus anything tied with it. Nothing
   * outside this may ever be described as fitting equally well, whatever the
   * card count happens to be.
   */
  const leadOf = (list) => {
    const top = list[0].score;
    return list.filter((m) => top - m.score <= CLUSTER_PTS).slice(0, MAX_SHOWN);
  };

  /*
   * Which result state the page is in, RIGHT NOW, from the scores on screen.
   *
   * Previously this was decided once by the server and then never revisited,
   * while the card count was allowed to drift under narrowing. That is how a
   * 96% and a 73% ended up under "two of these fit you equally well", and how
   * a diesel carrying "Diesel, where you asked for fully electric" got
   * promoted into a set defined as fitting equally well.
   *
   * Deriving it each time means every state transition the buyer can cause is
   * handled by construction: narrow a tie to one car and it becomes a decree;
   * reject the leader and whatever it promotes is re-judged on its own merits;
   * a nearby car joining the pool can win outright and the page says so.
   *
   * It is derived from the RETAILER'S cars, because the headline is scoped to
   * the retailer. That is also what brought the decree back: merging nearby
   * stock into one cluster meant an equally-good car 17 miles away joined every
   * lead, and every persona landed on a tie (docs/results-page-review.md, "the
   * cost"). Cars elsewhere no longer dilute a verdict about here.
   *
   * `scoped` is the one thing a car elsewhere still decides: when one genuinely
   * outranks the best here, the headline says "at <retailer>" and the notice
   * names what beat it. Strictly outranks, not ties — ties already break
   * local-first, so an equal car has not earned the qualification.
   */
  /** Score below which a car is a change of subject rather than an option. */
  function relevanceFloor() {
    const alive = surviving();
    return alive.length ? Math.max(...alive.map((m) => m.score)) - RELEVANT_PTS : 0;
  }

  function situation() {
    const alive = surviving();
    if (!alive.length) {
      return { alive, here: [], away: [], lead: [], state: 'empty', scoped: false };
    }
    const here = alive.filter(isHere);
    const away = alive.filter((m) => !isHere(m));
    // Ruling out every one of the retailer's cars leaves nothing to be scoped
    // to, so the cars within reach become the answer and the page says so
    // without a qualification it can no longer support.
    const from = here.length ? here : away;
    const cluster = leadOf(from);
    const scoped = here.length > 0 && away.length > 0 && away[0].score > here[0].score;
    const common = { alive, here, away, scoped };
    // The leader misses something asked for: the page must not say "perfect"
    // in any state, so this outranks the rest. Below WEAK_SCORE it stops being
    // "the closest here" and becomes "nothing here is close", which is a
    // different sentence rather than a softer one.
    if ((from[0].tradeOffs || []).length) {
      const state = cluster[0].score < WEAK_SCORE ? 'weak' : 'closest';
      return { ...common, lead: cluster, state };
    }
    if (cluster.length === 1) return { ...common, lead: cluster, state: 'decree' };
    // Fit-tied. Their priorities may still pick one (the taste lead is a
    // server judgement about the original cluster, so it only stands while
    // that cluster's leader is still the leader).
    return { ...common, lead: cluster, state: tasteLed(from) ? 'taste' : 'tie' };
  }

  /*
   * What this car could be rejected FOR, given what's still on screen.
   *
   * Attribution is the whole point of asking. A rejection on its own says
   * nothing usable — reject a white 3-door with 40k miles and we don't know
   * which of those three things you objected to, and guessing is how you learn
   * a dealbreaker that isn't real and empty someone's shortlist. So each
   * reason names one property and rules out exactly that.
   *
   * A reason is only offered when it would change something: "too expensive"
   * needs a cheaper car to fall back to, "not the colour" needs another colour
   * in the set. Anything else is a dead end dressed as a choice. "Just not
   * this one" is always last and always available — a shrug is a legitimate
   * answer, and forcing a reason produces invented ones, which are worse than
   * no signal at all.
   */
  function rejectOptions(match, chosen) {
    const { car } = match;
    // What the card is showing right now. Colour and gearbox are properties of
    // ONE car, so a reason about them has to come from the listing on screen,
    // not from whichever one happened to represent the group. Price and
    // mileage stay group-based below, deliberately.
    const shown = chosen || listingsOf(match)[0] || {};
    // Judge "would this reason change anything?" against every listing still
    // reachable — not just the cards on screen, and not just other cards.
    // Siblings count: on a two-colour card, turning down the red is answered
    // by the black one standing behind it, and the card stays.
    const alive = surviving().flatMap(listingsOf);
    const survives = (test) => alive.some(test);
    const opts = [];
    const add = (id, label, test) => opts.push({
      label,
      apply: () => { constraints.set(id, { label, test }); redraw(); },
    });

    /*
     * EVERY reason is about the listing on screen, price and mileage included.
     *
     * They used to be judged against the group's cheapest and lowest-mileage
     * copy, on the theory that a reason should make the whole card disappear
     * rather than let it survive on a copy the buyer had just ruled out. That
     * was wrong twice over. A card surviving with a CHEAPER listing is exactly
     * what was asked for, which is what the colour reason already does. And
     * the arithmetic was worse than the theory: on a card holding 1,000,
     * 2,000 and 3,000-mile copies the only option ever offered was "Fewer than
     * 1,000 miles", which excluded all three including the one being looked
     * at. So a card could offer "Not the green", correctly leaving the blue,
     * beside a mileage reason that could only ever leave nothing.
     *
     * Direction needs no thought here: nobody turns a car down for being too
     * cheap or having too few miles, so "than the one I'm looking at" is the
     * only sensible reading of both.
     */

    // A listing with no known paint is never "the red one" — we can't claim it
    // is, so a colour rejection keeps it rather than guessing it away.
    const shadeOf = (l) => l.shade || l.colour;
    const shade = shadeOf(shown) || car.colour?.colour || car.colour?.manufacturerColour;
    if (shade && survives((l) => shadeOf(l) !== shade)) {
      add(`!c:${shade}`, `Not the ${shade.toLowerCase()}`, (l) => shadeOf(l) !== shade);
    }
    const dearer = Number.isFinite(shown.priceMin) ? shown.priceMin : car.priceMin;
    if (Number.isFinite(dearer) && survives((l) => l.priceMin < dearer)) {
      add(`!p:${dearer}`, `Under ${gbp(dearer)}`, (l) => l.priceMin < dearer);
    }
    const higher = Number.isFinite(shown.mileage) ? shown.mileage : car.mileage;
    if (Number.isFinite(higher) && survives((l) => l.mileage != null && l.mileage < higher)) {
      add(`!m:${higher}`, `Fewer than ${higher.toLocaleString('en-GB')} miles`,
        (l) => l.mileage != null && l.mileage < higher);
    }
    const gear = shown.transmission || car.transmission;
    if (gear && survives((l) => l.transmission && l.transmission !== gear)) {
      const want = gear === 'auto' ? 'manual' : 'automatic';
      add(`!g:${gear}`, `Only ${want}`, (l) => l.transmission !== gear);
    }
    // The shrug stays whole-card: "just not this one" is about the model in
    // front of them, not about one of its copies.
    opts.push({
      label: copy.rejectJust,
      apply: () => { hidden.add(car.id); redraw(); },
    });
    return opts;
  }

  function redraw() {
    const {
      alive, here, away, lead: shown, state, scoped,
    } = situation();
    const frame = frames[state] || frames.tie;
    const strip = (m) => m.car.name.replace(new RegExp(`^${copy.name} `), '');

    // Chips: every axis that still splits what's on screen, plus the ones
    // already applied (which by definition no longer split anything). Offering
    // an axis that can't change the result is noise, so they're recomputed
    // against the current set rather than the original one.
    refineBlock.replaceChildren();
    chipRow.replaceChildren();

    /*
     * Everything the buyer has told us since the quiz, as statements rather
     * than as controls. It renders in the brief below; the chip row carries
     * only what they could ADD next.
     *
     * The two were briefly both: applied filters showed as "+ Blue" here and
     * as a removable [Blue ✕] chip an inch away, which is one constraint in
     * two places with only one of them undoable. Collapsing them into the
     * chip row was the obvious fix and the wrong one, because a chip and a
     * sentence are not the same register. "+ Blue, − Not the red" reads as a
     * model of a person; a row of pills reads as a filter bar, and the model
     * is the thing this tool has that a stock search does not. The +/- mark
     * carries meaning the pills flatten, too: a want and a rule are different
     * kinds of statement.
     *
     * So the statements keep the state, and they keep the undo with it.
     */
    const learned = [
      ...[...active.entries()].map(([id, a]) => ({
        kind: 'want', text: a.label, undo: () => active.delete(id),
      })),
      ...[...constraints.entries()].map(([id, c]) => ({
        kind: 'rule', text: c.label, undo: () => constraints.delete(id),
      })),
    ];
    if (hidden.size) {
      learned.push({
        kind: 'rule', text: copy.hiddenChip({ count: hidden.size }), undo: () => hidden.clear(),
      });
    }

    /*
     * Computed against what is ON SCREEN, on every redraw.
     *
     * It used to be an intersection: a fixed set taken once from the pool's top
     * six, filtered each redraw by what still split the lead. Both halves were
     * capped at MAX_AXES, so the two sixes could be six different axes and the
     * intersection could be empty — which is how Meg's page, narrowed to one
     * card, lost her chips entirely while that card's two listings still
     * differed on colour and equipment. Offering a fixed menu was the mistake:
     * an axis exists only where it splits the cars actually being shown, and
     * that set changes every time she taps something.
     *
     * MAX_AXES still applies, inside refinementAxes, and now applies to the set
     * that is offered rather than to a snapshot taken before it (see the note
     * there for why the cap exists at all).
     */
    for (const axis of refinementAxes(shown.map(listingsOf))) {
      if (active.has(axis.id)) continue;
      const chip = el('button', 'vm-chip', axis.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => { active.set(axis.id, axis); redraw(); });
      chipRow.append(chip);
    }

    // Mounted only when there is something to offer. A cluster of
    // identical-spec cars in identical paint has no axes, and the page simply
    // shows the cars and stops.
    if (chipRow.children.length) {
      refineBlock.append(
        el('p', 'vm-refine-label', copy.refineLabel({ count: shown.length })),
        chipRow,
      );
    }

    // The headline says whatever is true of the cars now on screen. `state`
    // already accounts for narrowing, rejection and late-arriving nearby
    // stock, so there is nothing to special-case here beyond the empty set.
    //
    // `scoped` picks the "at <retailer>" wording where a frame has one. A frame
    // without one is already scoped in its own copy (the closest frame names
    // the retailer outright), so it needs no variant.
    const wants = [...active.values(), ...constraints.values()].map((a) => a.label.toLowerCase());
    const say = (kind) => (scoped && frame[`${kind}Here`]) || frame[kind];
    if (!shown.length) {
      // Nothing left to be a tie between — "a one-way tie" is the nonsense a
      // count-driven headline produces if it isn't stopped here.
      title.textContent = copy.tiedEmptyTitle;
    } else {
      const args = {
        count: shown.length, model: strip(shown[0]), retailer: ctx.retailerLabel,
      };
      title.textContent = say(shown.length === 1 ? 'settled' : 'tied')(args);
    }

    // Names what forced the scope. Suppressed only when a rescue note above the
    // cards is already pointing at THAT car: Martin's page would otherwise say
    // "no convertibles here, the nearest is 18.1 miles away at John Clark
    // Tayside" and then, two lines down, "the 420i Convertible at John Clark
    // Tayside scores higher". Two notes about different cars are two facts, and
    // both keep their line.
    notice.hidden = !scoped || away[0].car.id === notedCarId;
    if (!notice.hidden) {
      notice.textContent = copy.searchedWider({
        model: strip(away[0]),
        miles: distanceLabel(away[0].car.distance),
        where: away[0].car.retailerName || 'another retailer',
      });
    }
    // "We can't split them" only holds while there are several to split — but a
    // lede about the single named car (the taste pick) survives narrowing.
    lede.hidden = ctx.brand === 'rrmc' || !frame.lede
      || (shown.length <= 1 && !frame.ledeSurvivesNarrowing);
    lede.textContent = frame.lede || '';
    // A car waved away with no reason narrows the count but adds no words —
    // there's nothing to report about "just not that one".
    /*
     * The running brief, ABOVE the cars.
     *
     * It was moved below on the argument that a summary belongs after the
     * thing it summarises. True of a summary; false of this. Nobody scrolls
     * past fourteen cards to read what they themselves typed, so the one
     * signal that says the tool holds a model of you was the one thing
     * guaranteed not to be seen.
     *
     * What it does NOT carry any more is the list of applied filters. Those
     * were being said twice: once here as "+ Blue", and once as a removable
     * [Blue ✕] chip a couple of inches above. The chip is the better of the
     * two because you can undo it, so the duplicate is gone and the brief is
     * back to the thing only it says, which is what the buyer originally
     * asked for.
     */
    briefBlock.replaceChildren();
    status.replaceChildren();
    const said = briefFromAnswers(ctx);
    if (said.length || learned.length) {
      briefBlock.append(status);
      status.append(el('p', 'vm-brief-label', copy.briefLabel));
      if (said.length) status.append(el('p', 'vm-brief-said', said.join('  ·  ')));

      // Then everything since, each with the means to take it back. The undo
      // lives here because this is now the only place the constraint is
      // stated, and a filter you can see but not clear is worse than one you
      // cannot see at all.
      learned.forEach((item) => {
        const row = el('p', `vm-brief-item is-${item.kind}`);
        row.append(el('span', 'vm-brief-mark', item.kind === 'want' ? '+' : '−'));
        row.append(el('span', 'vm-brief-text', item.text));
        const undo = el('button', 'vm-brief-undo', '✕');
        undo.type = 'button';
        undo.setAttribute('aria-label', `Remove ${item.text}`);
        undo.addEventListener('click', () => { item.undo(); redraw(); });
        row.append(undo);
        status.append(row);
      });

      /*
       * One count, and it lives here rather than under the chips.
       *
       * There were briefly two, two lines apart: "3 of 13 still match" (the
       * whole pool) over "1 of 2, with blue." (the lead). Both accurate,
       * measuring different things, leaving the reader to work that out. This
       * one wins because it belongs to the same panel as the statements that
       * caused it: `total` is the lead measured with nothing applied, so
       * "1 of 2" is a real before-and-after rather than a number floating free
       * of a baseline. Only the positive wants are named, because "with not
       * the red" is not a sentence and a rejection has already shown its work
       * by removing a card.
       */
      if (learned.length) {
        const picked = [...active.values()].map((a) => a.label.toLowerCase());
        /*
         * No denominator. It has been wrong three ways and the third is what
         * killed the idea:
         *
         *   "1 of 2"   counted the local lead, while the same chip was also
         *              cutting cars at other retailers shown directly below.
         *   "9 of 13"  counted the whole pool, which fixed the scope but put
         *              an invisible number in the denominator: nobody can see
         *              thirteen cars to check it against.
         *   and now the relevance bar means the pool holds cars the page has
         *              deliberately decided are not worth showing, so counting
         *              them is measuring against a set that does not exist for
         *              the buyer.
         *
         * What they actually want to know is whether the last tap did
         * anything and whether there is still a choice. A bare count answers
         * both, is checkable against the cards, and cannot be mis-scoped
         * because it claims nothing about a total.
         */
        const args = { shown: alive.filter((m) => m.score >= relevanceFloor()).length };
        const line = el('p', 'vm-brief-count', picked.length
          ? copy.refineStatus({ ...args, wants: andList(picked) })
          : copy.refineStatusPlain(args));
        line.setAttribute('aria-live', 'polite');
        status.append(line);
      }
    }

    grid.replaceChildren();
    hereRestGrid.replaceChildren();
    awayGrid.replaceChildren();
    awayRestGrid.replaceChildren();
    hereGroup.hidden = false;
    awayGroup.hidden = true;
    if (!shown.length) {
      // A guard, not a path the chips can currently reach: an axis is only
      // offered while it still splits what's on screen, so applying one always
      // leaves at least one car, and a combination that would empty the set is
      // never presented. That's deliberate — the axes describe THIS cluster,
      // so "nothing has both" would read as a claim about the retailer's whole
      // stock, which we haven't checked. Rejection (the next step) can empty a
      // set for real, and this is what it will land on.
      const dead = el('div', 'vm-refine-empty');
      dead.append(el('p', 'vm-refine-empty-text', wants.length
        ? copy.refineEmpty({ wants: andList(wants) })
        : copy.refineEmptyHidden));
      const clear = el('button', 'vm-btn vm-btn-ghost', 'Start again');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        active.clear();
        constraints.clear();
        hidden.clear();
        redraw();
      });
      dead.append(clear);
      grid.append(dead);
      // No cars anywhere, so there is no place to label.
      hereLabel.hidden = true;
      return;
    }

    /*
     * Who leads the page. Normally the retailer, which is the whole point of
     * scoping the headline to it; only when every one of its cars has been
     * ruled out does the answer come from the group beyond.
     */
    const leadIsHere = here.length > 0;
    /*
     * Full cards in the second group are reserved for cars that OUTRANK the
     * best one here, i.e. exactly the set that makes the headline scope. That
     * keeps the promise the merge was built on: a car that genuinely suits the
     * buyer better is a real card they can reject, refine and read the
     * trade-off line on, not a tile they have to notice. Everything else in
     * that group is a tile, because it is context rather than the answer.
     *
     * `leadOf` again, rather than a flat cap, so the cut lands on a real score
     * gap. A flat three left Priya's group as 99, 97, 97 in cards and a fourth
     * 97 as a tile below them, which is a difference in treatment where there
     * is no difference in score.
     *
     * It is a treatment, not a caption. No heading anywhere says one group
     * beats the other.
     */
    const hereLead = leadIsHere ? shown : [];
    const beats = leadIsHere ? away.filter((m) => m.score > here[0].score) : away;
    /*
     * Capped to the retailer's own lead, and this is the one place a treatment
     * decision is also a commercial one.
     *
     * Uncapped, the rule above put a full card on every car that outranks the
     * best one here, and on Priya's page that was four full cards under AT
     * OTHER RETAILERS against two under AT GRASSICKS BMW. On a retailer's own
     * website the competitors' section then outweighs the host, which is the
     * exact problem grouping by place was built to solve.
     *
     * The cap is a count, never a caption: no heading anywhere says one group
     * beats the other, and the cars that lose their card stay in the list as
     * tiles rather than disappearing. At least one full card always survives,
     * so the promise the merge was built on holds — a genuinely better car is
     * something you can reject, refine and read the trade-off line on.
     *
     * It does not apply when every local car has been ruled out, because then
     * the group beyond IS the answer rather than context beside one.
     */
    const awayLead = beats.length
      ? leadOf(beats).slice(0, leadIsHere ? Math.max(1, hereLead.length) : undefined)
      : [];
    /*
     * The tail: what else is worth a look, cut by relevance first and by
     * length second. The floor is measured against the best car anywhere on
     * the page rather than each group's own best, so both groups are judged by
     * one standard: within ten points of the best we found.
     */
    const drop = (list, taken) => list
      .slice(taken.length, taken.length + TAIL_SHOWN)
      .filter((m) => m.score >= relevanceFloor());

    // One car left is a recommendation again, so it gets the hero treatment
    // (photo, reasons, its trade-off) rather than staying a tile in a grid.
    // It keeps its reject menu: the answer still has to survive being looked
    // at, and "actually, not that one either" is a real thing to want to say.
    const single = shown.length === 1;
    // `fit` is matchCard's fitName: the podium below fits gold's "Extended", silver/bronze's every name.
    // `compact` builds silver/bronze from the same compact card the podium mode uses for them.
    const full = (m, big = false, fit = false, compact = false) => {
      const card = matchCard(m, {
        big,
        compact,
        fitName: fit,
        brand: ctx.brand,
        rejectOptions,
        rejectLabel: copy.rejectOpen,
        rejectPrompt: copy.rejectPrompt,
      });
      // RRMC pins "Not this one" to the tile's corner as the podium's ✕ chip, without the hint.
      const reject = ctx.brand === 'rrmc' && card.querySelector(':scope > .vm-card-body > .vm-reject');
      if (reject) {
        const open = reject.querySelector('.vm-reject-open');
        open.classList.add('vm-podium-reject');
        open.replaceChildren(
          el('span', 'vm-podium-reject-icon', '✕'),
          el('span', 'vm-podium-reject-label', copy.rejectOpen),
        );
        card.append(reject);
      }
      return card;
    };
    // RRMC lays the leading group out as a podium: gold on the left, silver and bronze down the
    // right, each under the podium's rank eyebrow (same words as podium.js's RRMC `ranks`).
    const rank = (text, tier) => el('p', `vm-podium-rank is-${tier}`, text);
    const podium = (into, rest, list) => {
      const top = list.slice(0, 3);
      into.classList.remove('vm-grid-tied');
      into.classList.add('vm-rrmc-podium');
      into.append(rank('Your Top Pick', 'gold'), full(top[0], true, true));
      if (top.length > 1) {
        const side = el('div', 'vm-rrmc-podium-side');
        top.slice(1).forEach((m, i) => {
          const slot = el('div', 'vm-rrmc-podium-slot');
          slot.append(rank('Another Option', i === 0 ? 'silver' : 'bronze'), full(m, false, 'line', true));
          side.append(slot);
        });
        into.append(side);
      }
      drop(list, top).forEach((m) => rest.append(tile(m)));
    };
    const tile = (m) => matchCard(m, { compact: true, brand: ctx.brand });
    // The grid holding the LEAD goes full width for a single car; the other
    // group's stays two-up whatever it holds, so it never competes for hero.
    grid.classList.toggle('vm-grid-tied', !(leadIsHere && single));
    awayGrid.classList.toggle('vm-grid-tied', !(!leadIsHere && single));

    grid.classList.remove('vm-rrmc-podium');
    if (ctx.brand === 'rrmc' && leadIsHere) {
      podium(grid, hereRestGrid, here);
    } else {
      hereLead.forEach((m) => grid.append(full(m, single)));
      drop(here, hereLead).forEach((m) => hereRestGrid.append(tile(m)));
    }
    hereLabel.textContent = copy.hereHeading({ retailer: ctx.retailerLabel });
    hereLabel.hidden = !here.length || ctx.brand === 'rrmc';
    hereGroup.hidden = !here.length;

    awayLead.forEach((m) => awayGrid.append(full(m, leadIsHere ? false : single)));
    drop(away, awayLead).forEach((m) => awayRestGrid.append(tile(m)));
    /*
     * While the national search is outstanding the group stays on screen with
     * its heading and the pending line, holding the space its cars will take.
     * Once it lands, normal rules: shown only if it has something in it.
     */
    awayPending.hidden = !stillSearching;
    awayLabel.hidden = !away.length && !stillSearching;
    awayGroup.hidden = !away.length && !stillSearching;

    /*
     * The working, last. It is evidence for the verdict above it, so it reads
     * as the tool signing off rather than as a preamble, and on the one-card
     * page it lands directly under the single card where it is unmissable.
     *
     * The margin is measured off the cars on screen, not off the API's figure,
     * so rejecting the leader re-states it about whoever leads now. It is only
     * claimed when there IS a gap: below CLUSTER_PTS the cars are tied, and
     * "nothing else came within 1 point" is not a boast.
     */
    working.replaceChildren();
    working.hidden = !searched || !alive.length;
    if (searched && alive.length) {
      working.append(el('p', 'vm-working-label', copy.workingLabel));
      /*
       * The margin is measured over the RETAILER's own cars, matching what the
       * headline is scoped to. Measured over everything it never fired: nearby
       * stock ties at the top on every persona (Meg's 97 against three nearby
       * 97s), so the claim was true, unclaimable, and effectively dead code.
       * Against this retailer it says the useful thing, which is that nothing
       * else HERE is close, and Meg's one-card page gets its evidence.
       */
      const margin = here.length > 1 ? Math.round(here[0].score - here[1].score) : null;
      /*
       * In the weak state the margin says nothing worth saying. How far clear
       * the leader is of the next car is the wrong question when the answer is
       * that neither is close; the useful number is the one that put the page
       * in this state. Stating it here rather than in the headline is what
       * keeps the two from repeating each other: the headline is the verdict,
       * this is the arithmetic behind it, checkable against the badges.
       */
      const closing = state === 'weak'
        ? copy.workingWeak({ top: shown[0].score })
        : (margin != null && margin >= CLUSTER_PTS ? copy.workingMargin({ margin }) : '');
      working.append(el('p', 'vm-working-text', copy.working(searched) + closing + copy.workingScore));
    }
  }

  redraw();

  return {
    host,
    /*
     * Nearby stock, arriving after first paint from the slow national search.
     * It joins the SAME pool and is re-sorted with everything else, so a car
     * 23 miles away that genuinely suits the buyer better than anything local
     * is presented as the better answer rather than as a footnote below a
     * headline claiming otherwise. Each card carries where it is (see
     * matchCard's provenance line), which is what makes that honest rather
     * than merely tidy.
     */
    /*
     * The national search is done, whatever it found. Drops the pending line,
     * and lets an empty away group hide itself again.
     */
    searchDone() {
      if (!stillSearching) return;
      stillSearching = false;
      redraw();
    },
    addToPool(extra) {
      stillSearching = false;
      if (!extra?.length) { redraw(); return; }
      const known = new Set(pool.map((m) => m.car.id));
      const fresh = extra.filter((m) => !known.has(m.car.id));
      if (!fresh.length) return;
      pool = [...pool, ...fresh].sort(rank);
      // The notice and the headline's scope are both derived inside redraw
      // from the same comparison, so there is nothing to announce here.
      redraw();
    },
    /*
     * Told by renderResults which car the rescue note it just inserted points
     * at (null for the unmet note, which names no car). The notice stands down
     * for that car only: the note is the more specific version of the same
     * fact, and saying it twice in different words reads as a bug.
     */
    noteShown(carId = null) {
      notedCarId = carId;
      redraw();
    },
  };
}

/** The unmet wants as brand-voiced plural phrases — fuel first, then shape:
 * "fully electric cars", "estates". Shared by the two notes below. */
function unmetPhrases(brandKey, unmet) {
  const phrases = UNMET_PHRASES[brandKey] || UNMET_PHRASES.bmw;
  return ['fuel', 'bodyStyles'].flatMap(
    (id) => (unmet[id] || []).map((v) => phrases[id]?.[v] || v),
  );
}

/**
 * A brand-voiced note admitting that something the user asked for isn't in
 * the stock we searched, and framing what's shown as the closest fit. Returns
 * null when there's nothing to admit to — which is the common case.
 */
function unmetNote(ctx, unmet) {
  const copy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  const items = unmetPhrases(ctx.brand, unmet);
  if (!items.length) return null;

  const note = el('aside', 'vm-unmet');
  note.setAttribute('role', 'note');
  if (copy.unmetLabel) note.append(el('p', 'vm-unmet-label', copy.unmetLabel));
  note.append(el('p', 'vm-unmet-text', copy.unmet({
    list: orList(items), retailer: ctx.retailerLabel,
  })));
  return note;
}

/**
 * The state-3 note (docs/results-page-states.md): the want is missing at THIS
 * retailer but met nearby. The sibling of unmetNote with the opposite message
 * — that one says "nobody reachable has it" (and almost never fires), this
 * one says "not here, but N miles away" (and fires constantly). Same visual
 * treatment: they are two polarities of one fact and can never both show.
 *
 * By owner decision the local cards keep the lead — someone may value
 * proximity over the full brief, and that trade is theirs to make. This note
 * is what puts the choice in front of them.
 *
 * @param {Object} rescued unmet-shaped: the wants missing here but met nearby
 * @param {Object} nearest the closest nearby match that meets the whole brief
 */
function rescueNote(ctx, rescued, nearest) {
  const copy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  const items = unmetPhrases(ctx.brand, rescued);
  if (!items.length) return null;

  const note = el('aside', 'vm-unmet');
  note.setAttribute('role', 'note');
  if (copy.rescueLabel) note.append(el('p', 'vm-unmet-label', copy.rescueLabel));
  note.append(el('p', 'vm-unmet-text', copy.rescueNote({
    list: orList(items),
    retailer: ctx.retailerLabel,
    miles: `${Math.round(nearest.car.distance * 10) / 10} miles`,
    where: nearest.car.retailerName || 'a nearby retailer',
  })));
  return note;
}

/* The engine client (apiGetQuestions, apiMatch, apiNearby, apiPreview) is
 * shared across modes and lives in ../engine.js — imported at the top, or via
 * ./preview-feed.js for the debounced preview. The question widgets themselves
 * (visibility, the sliders, the option list) are shared too: ./question-ui.js. */

function encodeAnswers(answers) {
  const json = JSON.stringify(answers);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeAnswers(encoded, questions) {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const answers = JSON.parse(decodeURIComponent(escape(atob(b64))));
    // Minimal validation: every question that should be shown must be answered.
    const valid = questions.every((q) => !isVisible(q, answers) || answers[q.id] != null);
    return valid && validBudget(answers.budget) ? answers : null;
  } catch {
    return null;
  }
}

function answersFromHash(questions) {
  const match = window.location.hash.match(new RegExp(`${HASH_KEY}=([A-Za-z0-9_-]+)`));
  return match ? decodeAnswers(match[1], questions) : null;
}

/*
 * What actually separates a set of cars the engine scored the same.
 *
 * This is the digital version of the bit of a dealership visit the tool has
 * been missing: once the brief is satisfied several times over, a good
 * salesperson stops asking about your life and starts asking about the cars in
 * front of you — and only about the ways they differ. Nobody is asked "do you
 * want a sunroof?" when all six have one.
 *
 * So the axes are computed from the cluster itself, never authored. An axis
 * exists only where it splits the set (at least one car has it, at least one
 * doesn't), which means a refinement can never be dead and can never empty the
 * list on its own — the two failure modes that killed asking this sort of
 * thing upfront (docs/question-stock-audit.md, and the plan's rejected
 * approaches). It also needs no per-brand configuration: gearbox surfaces for
 * a MINI cluster because MINI stock is mixed, and stays quiet for BMW because
 * it isn't.
 *
 * Ranked by how evenly each axis splits the set, because a 3/3 split is worth
 * more than a 5/1 — it's the question that tells us most about you per tap.
 *
 * @returns {Array<{ id, label, test(car), have }>}
 */

/** A listing's normalised shade ("Blue"), falling back to its marketing name. */
const shadeOf = (l) => l.shade || l.colour;

/**
 * Rebuild a grouped card from the listings that survived filtering.
 *
 * Everything the card claims about stock depth — "4 available, £31,498 to
 * £36,890, in Portimao Blue, Brooklyn Grey or Alpine White" — is derived, so
 * once a filter removes two of those four the card must stop saying it has
 * them. The representative fields (paint, price, mileage, link) follow the
 * best-ranked survivor; `id` deliberately does not move, because it is what
 * "just not this one" remembers the card by.
 */
function regroup(car, kept) {
  const head = kept[0];
  const prices = kept.map((l) => l.priceMin).filter(Number.isFinite);
  return {
    ...car,
    photo: head.photo || car.photo,
    colour: head.colour ? { manufacturerColour: head.colour, colour: head.shade } : car.colour,
    priceMin: head.priceMin ?? car.priceMin,
    mileage: head.mileage ?? car.mileage,
    transmission: head.transmission ?? car.transmission,
    link: head.link || car.link,
    listingCount: kept.length,
    priceFrom: prices.length ? Math.min(...prices) : car.priceFrom,
    priceTo: prices.length ? Math.max(...prices) : car.priceTo,
    colours: [...new Set(kept.map((l) => l.colour).filter(Boolean))],
    features: [...new Set(kept.flatMap((l) => l.features || []))],
  };
}

/**
 * The ways this set of cards can still be split, as chips.
 *
 * Takes one listing array per card, and tests LISTINGS rather than cards, for
 * the same reason the reject menu does: a card is a model the retailer has
 * several of, and "Blue" should leave the blue ones rather than keep or kill
 * all four on the strength of whichever ranked first.
 *
 * An axis earns its place when applying it would change something — some
 * listing has the thing and some listing doesn't. That's a weaker bar than
 * "it splits the cards", deliberately: on a single four-colour card, "Blue"
 * changes nothing about which cards show but everything about what the buyer
 * is being offered.
 */
// How many chips the page will offer at once. Six is about what reads as
// "here are some ways to split these" rather than as a search form.
const MAX_AXES = 6;

function refinementAxes(groups) {
  const all = groups.flat();
  const axes = [];
  const offer = (id, label, test) => {
    if (!all.some(test) || all.every(test)) return; // changes nothing
    axes.push({ id, label, have: groups.filter((ls) => ls.some(test)).length, test });
  };

  for (const [key, label] of Object.entries(CONCEPT_LABELS)) {
    offer(`f:${key}`, label, (l) => (l.features || []).includes(key));
  }

  // Gearbox: a genuine dealbreaker, and a live split for MINI (~12% manual).
  for (const [value, label] of [['auto', 'Automatic'], ['manual', 'Manual']]) {
    offer(`g:${value}`, label, (l) => l.transmission === value);
  }

  // Colour, by its normalised name ("Grey"), each shade its own axis. Only
  // present on listings the detail lookup reached — one with no colour simply
  // never matches a colour axis, which is the honest behaviour: we can't
  // claim it's the blue one.
  for (const shade of new Set(all.map(shadeOf).filter(Boolean))) {
    offer(`c:${shade}`, shade, (l) => shadeOf(l) === shade);
  }

  // Best-balanced first: an axis that halves the set is worth more than one
  // that shaves a single car off it.
  const balance = (a) => Math.abs(a.have / groups.length - 0.5);
  axes.sort((a, b) => balance(a) - balance(b) || a.label.localeCompare(b.label));
  // Capped, because testing listings rather than cards removed the bound that
  // used to be implicit. An axis only qualified while it split the CARDS, so a
  // single card could never offer one; now that one card is several listings,
  // an equipment-rich cluster will happily produce eleven chips, and a wall of
  // chips is a filter panel, which is the thing this was built not to be.
  return axes.slice(0, MAX_AXES);
}

/* ------------------------------ screens ------------------------------ */

function renderIntro(root, ctx) {
  root.replaceChildren();
  const intro = el('div', 'vm-intro');
  // Count the questions a typical run sees ("Help me decide" shows the
  // conditional charging question, matching the longest common path). fuel is
  // multi-select now, so pass it as an array.
  const count = visibleQuestions(flowQuestions(ctx), { fuel: ['open'] }).length;
  const copy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  // Authored overrides win; a blank row suppresses the line entirely, which is
  // how the block sits under a host page's own "FIND YOUR MINI." heading
  // without repeating it (see copyRow).
  const { title: titleOverride, kicker: kickerOverride } = ctx.overrides;
  const kicker = kickerOverride === undefined ? (copy.kicker || 'The unofficial UK matchmaker') : kickerOverride;
  const title = titleOverride === undefined ? copy.title : titleOverride;
  if (kicker) intro.append(el('p', 'vm-kicker', kicker));
  if (title) intro.append(el('h1', 'vm-title', title));
  const ledeEl = el('p', 'vm-lede');
  if (copy.ledeHtml) {
    ledeEl.innerHTML = copy.ledeHtml({ questions: count, retailer: ctx.retailerLabel });
  } else {
    ledeEl.textContent = copy.lede({ questions: count, retailer: ctx.retailerLabel });
  }
  intro.append(ledeEl);
  const start = el('button', 'vm-btn vm-btn-primary', copy.cta);
  start.addEventListener('click', () => ctx.showQuestion(0));
  intro.append(start);
  root.append(intro);
}

/* -------------------------- live "best guess" preview ---------------------- */

// The debounce and the latest-wins guard live in ./preview-feed.js, shared with
// the other modes that show a running guess. Everything below is this mode's
// own: the strip, where it mounts, and what it paints.
// Cross-fade duration when the tile row re-ranks (kept in sync with the CSS
// transition on .vm-preview-track). Disabled under prefers-reduced-motion.
const PREVIEW_FADE_MS = 150;

/** Can the engine score these answers yet? It hard-requires a valid budget. */
function canPreview(ctx) {
  return validBudget(ctx.answers.budget);
}

// How many skeleton tiles to show while the first guess loads. A handful is
// enough to fill the strip's width so it reads as "results loading here".
const PREVIEW_SKELETON_COUNT = 5;

/**
 * Build the live preview section: a heading + a horizontal strip of small
 * "mini" result tiles (see previewTile). Since budget is set from the first
 * render, the section mounts straight away — showing skeleton tiles until the
 * first guess lands (see paintPreview), so it never snaps open.
 */
function renderPreviewSection(ctx) {
  const section = el('section', 'vm-preview');
  section.append(el('h3', 'vm-subhead vm-nearby-heading vm-preview-heading', 'SHORTLISTING FOR YOU'));
  const track = el('div', 'vm-nearby vm-preview-track');
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', `Your closest matches so far at ${ctx.retailerLabel}`);
  section.append(track);
  paintPreview(section, ctx);
  return section;
}

/** A shimmer placeholder shaped like a mini preview tile (media + two lines). */
function previewSkeletonTile() {
  const tile = el('div', 'vm-ptile vm-ptile-mini vm-skel-ptile');
  tile.append(el('div', 'vm-skel vm-ptile-media'));
  const body = el('div', 'vm-ptile-body');
  body.append(
    el('div', 'vm-skel vm-skel-line vm-skel-name'),
    el('div', 'vm-skel vm-skel-line vm-skel-specs'),
  );
  tile.append(body);
  return tile;
}

/**
 * Refill the strip from ctx.preview.matches, with a soft cross-fade so a re-rank
 * reads as "this just updated" rather than a hard jump. Reduced-motion users get
 * an instant swap (the CSS transition is disabled). With no matches yet (budget
 * is set from the off, so this is the initial load), paint skeleton tiles so the
 * bar holds its footprint instead of popping in when the first guess arrives.
 */
function paintPreview(section, ctx) {
  const track = section.querySelector('.vm-preview-track');
  const hasMatches = ctx.preview.matches.length > 0;
  const swap = () => {
    track.replaceChildren();
    if (hasMatches) {
      ctx.preview.matches.forEach((m) => track.append(previewTile(m, 'mini')));
    } else {
      for (let i = 0; i < PREVIEW_SKELETON_COUNT; i += 1) track.append(previewSkeletonTile());
    }
    requestAnimationFrame(() => track.classList.remove('is-fading'));
  };
  // Cross-fade only when swapping real tiles for real tiles (a re-rank). The
  // first skeleton→results fill is a plain swap so results appear promptly.
  const showingReal = track.querySelector('.vm-ptile:not(.vm-skel-ptile)');
  if (showingReal && hasMatches) {
    track.classList.add('is-fading');
    setTimeout(swap, PREVIEW_FADE_MS);
  } else {
    swap();
  }
}

/**
 * Mount or update the preview for the current answers. The section lives at the
 * end of ctx.preview's host (`.vm-screen`): it mounts as soon as a budget is
 * set (skeleton tiles until the first guess lands), repaints on later updates,
 * and is only removed if we genuinely can't preview yet (no valid budget).
 */
function showPreview(ctx) {
  const screen = document.querySelector('.vm-screen');
  if (!screen) return;
  let section = screen.querySelector('.vm-preview');
  const { matches, loaded } = ctx.preview;
  // Hide the strip only when there's genuinely nothing to show: no budget to
  // score yet, or a guess has landed and returned zero matches. While a budget
  // is set but the first guess hasn't arrived (!loaded), we keep the strip up
  // with skeleton tiles (paintPreview) rather than removing it.
  if ((!canPreview(ctx) && !matches.length) || (loaded && !matches.length)) {
    section?.remove();
    return;
  }
  if (!section) {
    section = renderPreviewSection(ctx);
    ctx.mountPreview(screen, section);
  } else {
    paintPreview(section, ctx);
  }
}

/**
 * Ask the feed for a fresh guess and paint it when it lands. A no-op until a
 * budget is chosen, since the engine hard-requires one.
 *
 * The feed drops a response a newer answer has already superseded; `ctx.preview.seq`
 * is the coarser guard on top of it, for the run itself. Starting over
 * (see the retake button) bumps it, so a request from the finished run cannot
 * repopulate the strip of the new one — a fresh run must start empty even if
 * the old one's answers are still in flight.
 */
function schedulePreviewRefresh(ctx) {
  if (!canPreview(ctx)) return;
  const run = ctx.preview.seq;
  ctx.previewFeed.schedule(ctx.answers, (matches) => {
    if (run !== ctx.preview.seq) return;
    ctx.preview.matches = matches;
    ctx.preview.loaded = true; // first (and every) response has now landed
    showPreview(ctx);
  });
}

/**
 * A wrapping row of tap-to-edit summary pills — one per question answered
 * *before* the current one (the current question is what you're answering now,
 * so it's excluded). Tapping a pill jumps back to edit that answer and sets a
 * return point so advancing lands back on the question you left. Returns the
 * row element, or null when nothing's been answered yet.
 *
 * @param {number} index current question's position in the visible list
 */
function renderAnswerPills(ctx, questions, index) {
  const row = el('div', 'vm-pills');
  for (let i = 0; i < index; i += 1) {
    const question = questions[i];
    const label = pillFor(question, ctx.answers);
    if (!label) continue; // unanswered (shouldn't happen before `index`, but safe)
    const pill = el('button', 'vm-pill');
    pill.type = 'button';
    pill.append(el('span', 'vm-pill-text', label));
    pill.append(el('span', 'vm-pill-edit', '✎'));
    pill.setAttribute('aria-label', `${question.title.replace(/[?？]$/, '')}: ${label}. Edit`);
    pill.addEventListener('click', () => {
      // Remember where we were so advance() returns here after the edit.
      ctx.editReturnIndex = index;
      ctx.showQuestion(i);
    });
    row.append(pill);
  }
  return row.children.length ? row : null;
}

/** The questions that get a screen: RRMC asks its budget inside "Is there an ideal price
 *  range?" (renderBudgetDrawer), so the budget never has a screen of its own there. */
function flowQuestions(ctx) {
  return ctx.brand === 'rrmc' ? ctx.questions.filter((q) => q.id !== 'budget') : ctx.questions;
}

function renderQuestion(root, ctx, index) {
  const questions = visibleQuestions(flowQuestions(ctx), ctx.answers);
  const q = questions[index];

  root.replaceChildren();
  const screen = el('div', 'vm-screen');
  // Same per-question hook as the podium's blocks, so brand CSS keyed by data-qid reaches both.
  screen.dataset.qid = q.id;

  const progress = el('div', 'vm-progress');
  const bar = el('div', 'vm-progress-bar');
  bar.style.width = `${((index + 1) / questions.length) * 100}%`;
  progress.append(bar);
  screen.append(progress, el('p', 'vm-step', `Question ${index + 1} of ${questions.length}`));

  // Summary pills for every question already answered before this one. Each is
  // a tap-to-edit button: it jumps back to that question, remembering the
  // current index so advancing returns straight here (see advance / jumpToEdit).
  const answeredPills = renderAnswerPills(ctx, questions, index);
  if (answeredPills) screen.append(answeredPills);

  screen.append(el('h2', 'vm-question', q.title));
  if (q.help) screen.append(el('p', 'vm-help', q.help));

  const advance = () => {
    const total = visibleQuestions(flowQuestions(ctx), ctx.answers).length;
    // Editing a pill sets a return point: once this (earlier) question is
    // re-answered, jump straight back rather than walking forward again. Only
    // honour it when returning would actually move forward, and clamp to the
    // live visible range (editing fuel can add/remove the charging question).
    const returnTo = ctx.editReturnIndex;
    if (returnTo != null) {
      ctx.editReturnIndex = null;
      const target = Math.min(returnTo, total - 1);
      if (target > index) return ctx.showQuestion(target);
    }
    if (index + 1 < total) ctx.showQuestion(index + 1);
    else ctx.showResults(ctx.answers, { updateHash: true });
  };

  const isSlider = q.type === 'slider';
  // RRMC never moves on by itself: every question, single-select included, waits for Next.
  const waitForNext = q.multi || isSlider || ctx.brand === 'rrmc';
  // A slider is a single labelled input (its own role), not a radio/checkbox
  // group, so it gets a bare container; an option list builds its own and
  // arrives with the group role already on it (see question-ui.js).
  let list;
  // The option list's live selection, which is what the Next button below is
  // enabled by. A slider always has a value, so it has no such set.
  let selected = null;
  // Set below on RRMC's price-range screen; the option list syncs it on every pick.
  let budgetDrawer = null;
  if (isSlider && q.range) {
    // Dual-thumb range (budget): two overlaid inputs writing a [min, max] pair.
    list = el('div', 'vm-options vm-slider');
    renderRangeSlider(list, q, ctx.answers, { onChange: () => schedulePreviewRefresh(ctx) });
  } else if (isSlider) {
    // A range input plus a live value readout. The whole thing writes a number
    // to ctx.answers[q.id] and, unlike a single-select, never auto-advances —
    // the Next button (below) is the commit point, since any drag would fire.
    list = el('div', 'vm-options vm-slider');
    const stored = ctx.answers[q.id];
    const startValue = typeof stored === 'number'
      ? stored
      : (typeof q.default === 'number' ? q.default : q.min);

    const readout = el('output', 'vm-slider-value', formatSliderValue(startValue, q));
    const input = el('input', 'vm-slider-input');
    input.type = 'range';
    input.min = String(q.min);
    input.max = String(q.max);
    input.step = String(q.step);
    input.value = String(startValue);
    input.setAttribute('aria-label', q.title);
    input.setAttribute('aria-valuetext', formatSliderValue(startValue, q));
    // Persist the starting value immediately so the answer exists even if the
    // user accepts the default without dragging (Next is enabled from the off).
    ctx.answers[q.id] = startValue;

    const bounds = el('div', 'vm-slider-bounds');
    bounds.append(
      el('span', 'vm-slider-min', formatSliderValue(q.min, q)),
      el('span', 'vm-slider-max', formatSliderValue(q.max, q)),
    );

    input.addEventListener('input', () => {
      const value = Number(input.value);
      ctx.answers[q.id] = value;
      const text = formatSliderValue(value, q);
      readout.textContent = text;
      input.setAttribute('aria-valuetext', text);
      schedulePreviewRefresh(ctx);
    });

    list.append(readout, input, bounds);
  } else {
    ({ list, selected } = renderOptionList(q, ctx.answers, {
      onChange: () => {
        // Option lists that commit via Next keep the button in step with the selection.
        if (waitForNext) next.disabled = selected.size === 0;
        budgetDrawer?.sync();
        // Refresh before advancing: the debounced fetch belongs to the mode
        // rather than to this screen, so the next question's freshly-built
        // drawer picks up the result (via the feed's latest-wins guard) even
        // though this screen is about to be replaced.
        schedulePreviewRefresh(ctx);
      },
      onPick: waitForNext ? undefined : advance,
    }));
  }
  // RRMC: "A combination" is the odd fifth pill, centred beneath the two pairs either side of it.
  if (ctx.brand === 'rrmc' && q.id === 'style') {
    const middle = list.querySelector(':scope > .vm-option[data-value="3"]');
    if (middle) list.append(middle);
  }
  screen.append(list);
  // RRMC: Yes on "Is there an ideal price range?" rolls the budget slider down right here.
  const budgetQ = ctx.brand === 'rrmc' && q.id === 'budgetGate' && ctx.questions.find((x) => x.id === 'budget');
  if (budgetQ) {
    budgetDrawer = renderBudgetDrawer(budgetQ, ctx.answers, { onChange: () => schedulePreviewRefresh(ctx) });
    screen.append(budgetDrawer.drawer);
  }

  const nav = el('div', 'vm-nav');
  const back = el('button', 'vm-btn vm-btn-ghost', 'Back');
  back.type = 'button';
  back.disabled = index === 0;
  back.addEventListener('click', () => ctx.showQuestion(index - 1));
  nav.append(back);

  const next = el('button', 'vm-btn vm-btn-primary', index + 1 === questions.length ? 'Explore my matches' : 'Next');
  next.type = 'button';
  // Multi-select, sliders and every RRMC question commit via Next (a slider always has
  // a value, so it's enabled from the off); other single-selects auto-advance on tap.
  if (waitForNext) {
    next.disabled = isSlider ? false : selected.size === 0;
    next.addEventListener('click', advance);
    nav.append(next);
  }
  screen.append(nav);

  root.append(screen);
  screen.querySelector('.vm-question').setAttribute('tabindex', '-1');
  screen.querySelector('.vm-question').focus({ preventScroll: true });

  // Live "best guess" strip. If we already have matches cached (navigating
  // Back/Next), mount it straight away so it doesn't flash out and back in;
  // otherwise it appears once the refresh below lands. showPreview no-ops
  // (and removes the strip) when there are no matches, so it's only ever on
  // screen with content.
  showPreview(ctx);

  // Refresh on entering the question too, so navigating Back/Next (budget
  // already set) updates the guess even without changing an answer. Cheap: the
  // stock is served from the warmed cache and the call is debounced.
  schedulePreviewRefresh(ctx);
}

/** Full-screen status message (loading / error), optionally with a retry button. */
function renderStatus(root, { kicker, title, message, retryLabel, onRetry }) {
  root.replaceChildren();
  const screen = el('div', 'vm-screen vm-status');
  if (kicker) screen.append(el('p', 'vm-kicker', kicker));
  screen.append(el('h2', 'vm-title', title));
  if (message) screen.append(el('p', 'vm-lede', message));
  if (onRetry) {
    const retry = el('button', 'vm-btn vm-btn-primary', retryLabel || 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    screen.append(retry);
  }
  root.append(screen);
}

/**
 * Skeleton placeholder for the intro screen, shown while the question set
 * loads (GET /api/questions). Mirrors renderIntro — kicker, title, two lede
 * lines, a CTA button block — so the boot reads as "the intro, arriving"
 * rather than a "Loading" status message that then swaps out. Reuses
 * the .vm-skel shimmer; reduced-motion users get a static tint.
 */
function renderIntroSkeleton(root) {
  root.replaceChildren();
  const intro = el('div', 'vm-intro vm-intro-skeleton');
  intro.setAttribute('aria-busy', 'true');
  intro.setAttribute('aria-label', 'Loading the matcher');
  const skel = (mod) => el('div', `vm-skel ${mod}`);
  intro.append(
    skel('vm-skel-kicker'),
    skel('vm-skel-title'),
    skel('vm-skel-line vm-skel-lede'),
    skel('vm-skel-line vm-skel-lede'),
    skel('vm-skel-line vm-skel-lede vm-skel-lede-last'),
    skel('vm-skel-btn'),
  );
  root.append(intro);
}

/**
 * Skeleton placeholder for the results page, shown while /api/match is in
 * flight. Mirrors the real layout — kicker, title, one big hero card, a 2-up
 * row of compact tiles — so the load reads as "this page, arriving" rather
 * than a centred spinner that then jumps to a dense grid. The shimmer is CSS
 * (see .vm-skel); reduced-motion users get a static tint instead.
 */
function renderResultsSkeleton(root) {
  root.replaceChildren();
  const screen = el('div', 'vm-screen vm-results vm-results-skeleton');
  // Announce the wait for assistive tech, since there's no visible status text.
  screen.setAttribute('aria-busy', 'true');
  screen.setAttribute('aria-label', 'Finding your matches');

  // A skeleton block: className extends .vm-skel with a shape modifier.
  const skel = (mod) => el('div', `vm-skel ${mod}`);

  screen.append(skel('vm-skel-kicker'), skel('vm-skel-title'));

  // Hero card: media band + a few body lines, matching matchCard(big).
  const hero = el('div', 'vm-grid');
  const heroCard = el('article', 'vm-card vm-card-big vm-skel-card');
  heroCard.append(el('div', 'vm-skel vm-skel-media'));
  const heroBody = el('div', 'vm-card-body');
  heroBody.append(
    skel('vm-skel-line vm-skel-name'),
    skel('vm-skel-line vm-skel-specs'),
    skel('vm-skel-line vm-skel-blurb'),
    skel('vm-skel-line vm-skel-blurb'),
  );
  heroCard.append(heroBody);
  hero.append(heroCard);
  screen.append(hero);

  // Compact-tile skeletons, matching the tile row each group paints below its
  // lead cards.
  const more = el('div', 'vm-tail-grid');
  for (let i = 0; i < 3; i += 1) {
    const tile = el('article', 'vm-card vm-card-compact vm-skel-card');
    tile.append(el('div', 'vm-skel vm-skel-media'));
    const body = el('div', 'vm-card-body');
    body.append(
      skel('vm-skel-line vm-skel-name'),
      skel('vm-skel-line vm-skel-specs'),
    );
    tile.append(body);
    more.append(tile);
  }
  screen.append(more);

  root.append(screen);
}

/**
 * The "Worth the drive" band with its heading + lede but a skeleton carousel in
 * place of real tiles, shown while /api/nearby is in flight. Returns the
 * <section> so the caller can fill it (fillNearbyBand) or remove it. Built to
 * match the real band exactly so filling it in causes no layout shift.
 */
function renderNearbySkeleton(ctx, lede) {
  const band = el('section', 'vm-nearby-band');
  band.setAttribute('aria-busy', 'true');
  band.append(
    el('h3', 'vm-subhead vm-nearby-heading', 'WORTH THE DRIVE'),
    el('p', 'vm-lede vm-nearby-lede', lede),
  );
  const track = el('div', 'vm-nearby');
  // A few placeholder tiles mirroring the compact card (media band + 2 lines).
  for (let i = 0; i < 3; i += 1) {
    const tile = el('article', 'vm-card vm-card-compact vm-skel-card');
    tile.append(el('div', 'vm-skel vm-skel-media'));
    const body = el('div', 'vm-card-body');
    body.append(
      el('div', 'vm-skel vm-skel-line vm-skel-name'),
      el('div', 'vm-skel vm-skel-line vm-skel-specs'),
    );
    tile.append(body);
    track.append(tile);
  }
  band.append(track);
  return band;
}

/**
 * Swap a nearby skeleton band (from renderNearbySkeleton) for the real
 * carousel of nearby-retailer matches, in place. Replaces only the track so
 * the heading/lede stay put.
 */
function fillNearbyBand(band, ctx, nearby) {
  band.removeAttribute('aria-busy');
  band.querySelector('.vm-nearby')?.remove();
  const track = el('div', 'vm-nearby');
  // Focusable so the carousel is scrollable by keyboard, not just by swipe.
  track.tabIndex = 0;
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', `Matches at other retailers near ${ctx.retailerLabel}`);
  nearby.forEach((m) => track.append(matchCard(m, { compact: true })));
  band.append(track);
}

async function renderResults(root, ctx, answers) {
  renderResultsSkeleton(root);
  // RRMC's "Why this one?" panel phrases each car against these.
  setRrmcAnswers(answers);

  // Two-phase load. The retailer's own matches (fast: one feed) render first;
  // the nearby-retailer carousel (slow: a national distance search) is fetched
  // separately below so it never holds up the hero. See apiNearby / the
  // .vm-nearby placeholder wired up further down.
  let matches;
  // Whether the engine could actually pick a winner, and how big the tie is if
  // not (see matchCars). Defaults to the old behaviour — an API that doesn't
  // send `decisive` keeps getting the single-hero page it always rendered.
  let decisive = true;
  let clusterSize = 1;
  // Fit tied, but their stated priorities picked a winner (see matchCars).
  let tasteLead = false;
  // Held back by the API so a rejection has a next-best car to promote.
  let alternatives = [];
  // How much stock was searched and how much survived the hard filters, so the
  // page can show its working. Absent from an older API, in which case the
  // working note simply never renders.
  let searched = null;
  // The one ranked list, once it exists. Nearby stock is merged into it when
  // the national search resolves (see addToPool below).
  let refine = null;
  // What the retailer's own stock couldn't offer. Half the picture: nothing is
  // said to the user until /api/nearby agrees (see agreedUnmet). An older API
  // that doesn't send the field leaves this empty, so it simply never fires.
  let retailerUnmet = {};

  /*
   * Both searches leave together.
   *
   * They used to be serialised: await the local match, paint, and only then
   * start the national search. That was right when nearby was a bonus
   * carousel at the foot of the page. It stopped being right when nearby
   * stock joined the one ranked list, because a late arrival now changes the
   * ANSWER rather than adding a section, and starting it second guaranteed
   * the change would land after the buyer had begun reading.
   */
  const nearbyPromise = apiNearby(ctx.api, answers, ctx.retailer, ctx.brand);
  // Swallow rejections at the source: this promise is now created before
  // anything awaits it, and an unhandled rejection here would surface as a
  // console error on a page that recovers perfectly well without nearby.
  nearbyPromise.catch(() => {});

  try {
    ({
      matches, decisive = true, clusterSize = 1, tasteLead = false,
      alternatives = [], unmet: retailerUnmet = {}, searched = null,
    } = await apiMatch(ctx.api, answers, ctx.retailer, ctx.brand, ctx.scope));
  } catch {
    renderStatus(root, {
      kicker: 'Sorry',
      title: 'We couldn’t reach the matcher.',
      message: 'The matching service didn’t respond. Check your connection and try again.',
      retryLabel: 'Try again',
      onRetry: () => renderResults(root, ctx, answers),
    });
    return;
  }

  /*
   * Give the national search a moment to catch up before painting.
   *
   * If it is already back, or arrives within GRACE_MS, its cars go into the
   * FIRST paint and nothing moves afterwards. That is the common case now the
   * two run in parallel. If it is genuinely slow we paint without it and
   * stream it in, which is the old behaviour, now the exception.
   *
   * Resolves to null on timeout or failure, and `early === null` is what the
   * code below reads as "still searching, show the placeholder".
   */
  const early = await Promise.race([
    nearbyPromise.catch(() => null),
    new Promise((resolve) => { setTimeout(() => resolve(null), GRACE_MS); }),
  ]);

  root.replaceChildren();
  const screen = el('div', 'vm-screen vm-results');
  const copy = BRAND_COPY[ctx.brand] || BRAND_COPY.bmw;
  const { name: brandName } = copy;

  // RRMC opens straight on the cars: no "Your results" kicker and (below) no headline.
  const rrmc = ctx.brand === 'rrmc';
  if (!rrmc) screen.append(el('p', 'vm-kicker', 'Your results'));

  if (matches.length === 0) {
    screen.append(
      el('h2', 'vm-title', 'No matches found.'),
      el('p', 'vm-lede', `Nothing in ${ctx.retailerLabel}'s current stock fits those answers. Try loosening the budget or seating needs.`),
    );
  } else {
    // How many cars lead the page as EQUALS. One when the engine genuinely
    // picked a winner; otherwise the tie itself — never more, because the
    // headline counts these and "three fit you equally well" must not be said
    // over a third car that's four points back. Anything beyond this leads a
    // quieter "More at <retailer>" tier, so a near-miss is demoted rather than
    // dropped.
    /*
     * The frames, one per situation (docs/results-page-states.md).
     *
     * These used to be chosen ONCE, from the server's verdict about the
     * original result set, and then reused however far the buyer narrowed.
     * That is how "TWO OF THESE FIT YOU EQUALLY WELL" survived being applied
     * to a 96% and a 73%. Now renderRefine picks between them on every
     * redraw, from the scores actually on screen, so all this has to supply
     * is the words for each case.
     */
    const perfect = ({ model }) => `Your perfect ${brandName} is the ${model}.`;
    /*
     * The same claim, scoped to the retailer whose page this is. Used only when
     * a car elsewhere genuinely outranks the best one here — renderRefine picks
     * the `…Here` variant per redraw off that one comparison, so the scope
     * appears exactly where it is load-bearing and nowhere else.
     *
     * "at Grassicks Garage" is deflating read alone, and it is the accurate
     * statement of what was searched: this block is authored onto ONE
     * retailer's site, and a tool on their page answering "go to Group 1
     * Bedford" is answering a different question than the page implies.
     */
    const perfectHere = ({ model, retailer }) => `Your perfect ${brandName} at ${retailer} `
      + `is the ${model}.`;
    const frames = {
      // The leader misses something asked for: never "perfect", always
      // "closest". Its own card carries the trade-off line saying what.
      closest: {
        // Already retailer-scoped in its own copy, so `tied` needs no variant.
        tied: () => copy.closestTitle({ retailer: ctx.retailerLabel }),
        settled: copy.closestSettled,
        settledHere: copy.closestSettledHere,
        lede: copy.closestLede(),
      },
      /*
       * The leader misses the brief AND is below WEAK_SCORE: the page stops
       * offering an answer and says so. It keeps the cards, because "here is
       * how far off the nearest one is" is the evidence for the claim and
       * withholding it would just be a shorter page — but nothing above them
       * describes any of them as a match.
       *
       * Both keys are the same sentence: narrowing to one card must not turn
       * this into a settled verdict about that card. The lede survives
       * narrowing for the same reason.
       */
      weak: {
        tied: () => copy.weakTitle({ retailer: ctx.retailerLabel }),
        settled: () => copy.weakTitle({ retailer: ctx.retailerLabel }),
        lede: copy.weakLede(),
        ledeSurvivesNarrowing: true,
      },
      // Nothing else came within CLUSTER_PTS: the decree is earned.
      decree: {
        tied: perfect, settled: perfect, tiedHere: perfectHere, settledHere: perfectHere, lede: null,
      },
      // Several suit them equally; their priorities picked this one. NOT
      // "your perfect X" — that would overclaim over cars that also fit.
      taste: {
        tied: copy.tasteTitle,
        settled: copy.tasteTitle,
        tiedHere: copy.tasteTitleHere,
        settledHere: copy.tasteTitleHere,
        lede: copy.tasteLede(),
        // This lede is about the named car, so it survives narrowing to one.
        ledeSurvivesNarrowing: true,
      },
      // A genuine tie: say so, and hand over the chips.
      tie: {
        tied: copy.tiedTitle,
        settled: perfect,
        tiedHere: copy.tiedTitleHere,
        settledHere: perfectHere,
        lede: copy.tiedLede(),
      },
    };

    const title = el('h2', 'vm-title', '');
    const lede = el('p', 'vm-lede', '');
    // Still built and rewritten on every redraw, just not shown for RRMC (nor the line beneath).
    title.hidden = rrmc;
    lede.hidden = rrmc;
    screen.append(title, lede);

    /*
     * One pool, one list. Everything the API returned goes in: the matches,
     * the held-back alternatives a rejection can promote, and — later, when
     * the national search resolves — the nearby retailers' stock too.
     *
     * The old page split these across three sections with three captions and
     * three internal rankings, which is what made it possible for it to claim
     * two cars fit best above a card scoring higher. See
     * docs/results-page-review.md.
     */
    /*
     * `early` is the national search when it beat the grace period. Its cars
     * go into the FIRST paint, so the page arrives complete and nothing
     * reshuffles under the buyer. When it lost the race this is empty and the
     * list carries a placeholder instead, filled by applyNearby later.
     */
    refine = renderRefine(
      ctx,
      [...matches, ...alternatives, ...(early?.nearby || [])],
      title, lede, frames, tasteLead, searched,
      // Tell the list whether it is still waiting on anything.
      !early,
    );
    screen.append(refine.host);
  }

  /*
   * Nearby stock used to get its own "Worth the drive" carousel below
   * everything else. It doesn't any more: it joins the one ranked list (see
   * addToPool). What remains here is the empty case — when the retailer had
   * nothing at all, there is no list to join, so the nearby cars ARE the
   * results and get rendered as such.
   */
  const emptyLocal = !matches.length;
  const nearbyBand = emptyLocal
    ? renderNearbySkeleton(ctx, copy.driveLede.empty({ retailer: ctx.retailerLabel }))
    : null;
  if (nearbyBand) screen.append(nearbyBand);

  const actions = el('div', 'vm-actions');
  const share = el('button', 'vm-btn vm-btn-primary', 'Copy share link');
  share.type = 'button';
  share.addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}#${HASH_KEY}=${encodeAnswers(answers)}`;
    try {
      await navigator.clipboard.writeText(url);
      share.textContent = 'Link copied';
    } catch {
      window.prompt('Copy your results link:', url);
    }
    setTimeout(() => { share.textContent = 'Copy share link'; }, 2000);
  });
  const tweak = el('button', 'vm-btn vm-btn-ghost', 'Tweak my answers');
  tweak.type = 'button';
  tweak.addEventListener('click', () => ctx.showQuestion(visibleQuestions(flowQuestions(ctx), ctx.answers).length - 1));
  const retake = el('button', 'vm-btn vm-btn-ghost', 'Start over');
  retake.type = 'button';
  retake.addEventListener('click', () => {
    ctx.answers = {};
    // Clear the strip's carried-over guess so a fresh run starts empty, and
    // drop any in-flight/debounced refresh from the finished run (bump seq so a
    // late-landing response from the old run is ignored).
    ctx.previewFeed.cancel();
    ctx.preview = { matches: [], seq: ctx.preview.seq + 1, loaded: false };
    ctx.editReturnIndex = null;
    window.history.replaceState(null, '', window.location.pathname);
    ctx.showIntro();
  });
  actions.append(share, tweak, retake);
  screen.append(actions);

  // Authorable: right for a public demo, wrong on a retailer's own site (see
  // copyRow). A blank "Disclaimer" row removes it; an authored one replaces it.
  const defaultDisclaimer = `An unofficial tool, not affiliated with or endorsed by ${(BRAND_COPY[ctx.brand] || BRAND_COPY.bmw).name}. Prices and specs are indicative, always check with a retailer.`;
  const disclaimer = ctx.overrides.disclaimer === undefined
    ? defaultDisclaimer
    : ctx.overrides.disclaimer;
  if (disclaimer) screen.append(el('p', 'vm-disclaimer', disclaimer));

  root.append(screen);

  /*
   * What to do with the national search, whenever it lands.
   *
   * Extracted so it can run either way: immediately, when the grace period
   * caught it and its cars are already in the first paint, or later from the
   * promise when it was too slow. The body is identical, which is the point.
   *
   * This is also where we learn whether a want the retailer couldn't meet is
   * genuinely unavailable, so the unmet note goes here rather than with the
   * hero. Claiming "no electric cars near you" while still waiting to hear
   * from the retailers that might have one is exactly the mistake.
   */
  function applyNearby({ nearby, unmet }) {
    {
      // The user may have navigated away (retake/tweak) before this resolves;
      // only touch the page if it's still in the document.
      if (!screen.isConnected) return;

      // One insertion slot, two polarities (docs/results-page-states.md).
      // State 4: both halves lack the want → "not anywhere nearby" (rare).
      // State 3: missing here, met nearby → "not here, but N miles away" (the
      // common case). Either way this only ever ADDS to the page — first
      // paint's headline was written to stay true, so nothing is retracted.
      const agreed = agreedUnmet(retailerUnmet, unmet);
      let note = unmetNote(ctx, agreed);
      let ordered = nearby;
      // Which car the note ends up pointing at, so the "we looked further
      // afield" notice can stand down for that one car rather than for the
      // whole page (see renderRefine's noteShown).
      let notedCar = null;
      if (!note && unmet) {
        // Nearby answered and disagreed: whatever the retailer lacks that
        // didn't survive into `agreed` is met somewhere within reach.
        const rescued = {};
        for (const [id, values] of Object.entries(retailerUnmet || {})) {
          const left = values.filter((v) => !(agreed[id] || []).includes(v));
          if (left.length) rescued[id] = left;
        }
        // The cars the note is about: those that HAVE the rescued want itself
        // — not "zero trade-offs overall", which claims more than the note
        // says and can be empty when the note is still true. Nearly every
        // MINI plug-in hybrid is a Countryman: for a PHEV-hatchback ask no
        // nearby car meets the whole brief, but "the nearest plug-in hybrid
        // is 12 miles away" remains exactly what the buyer asked to know.
        const resolves = (car) => (rescued.fuel || []).includes(car.fuel)
          || (rescued.bodyStyles || []).includes(car.body);
        const fits = nearby.filter((m) => resolves(m.car));
        const nearest = fits.filter((m) => m.car.distance != null)
          .reduce((a, b) => (a && a.car.distance <= b.car.distance ? a : b), null);
        if (Object.keys(rescued).length && nearest) {
          note = rescueNote(ctx, rescued, nearest);
          notedCar = nearest.car.id;
          ordered = [...fits, ...nearby.filter((m) => !fits.includes(m))];
        }
      }
      if (note) {
        // Above the cards, whatever frame they're in. The grid lives inside
        // the refine host — walk up to the screen-level ancestor, or
        // insertBefore throws on a non-child reference node.
        let anchor = screen.querySelector('.vm-refine, .vm-grid');
        while (anchor && anchor.parentElement !== screen) anchor = anchor.parentElement;
        // No cards at all (state 5): the note still belongs with the results,
        // directly above whatever IS there.
        screen.insertBefore(note, anchor || nearbyBand);
        // Tell the list which car the note claimed, so the notice doesn't say a
        // second, vaguer version of the same sentence about the same car.
        refine?.noteShown(notedCar);
      }
      /*
       * The merge. Nearby cars join the one ranked list rather than forming a
       * band beneath it, so the page never claims a local car fits best above
       * a more distant one that scores higher. Each card says where it is, so
       * "23 miles away · Arnold Clark Kirkcaldy" is the buyer's call to make
       * with the facts in front of them.
       *
       * When the retailer had nothing at all there is no list to join, and
       * the nearby cars are the results — they keep the standalone band.
       */
      if (refine) refine.addToPool(ordered);
      else if (nearbyBand && ordered.length) fillNearbyBand(nearbyBand, ctx, ordered);
      else nearbyBand?.remove();
    }
  }

  /*
   * Either the grace period caught it, in which case its cars are already in
   * the first paint and this only adds the note, or it did not, in which case
   * the placeholder is on screen and this replaces it.
   */
  if (early) applyNearby(early);
  else {
    nearbyPromise.then(applyNearby).catch(() => { refine?.searchDone(); });
  }
}

/* ------------------------------ decorate ------------------------------ */

/*
 * The questionnaire interface as a mountable mode.
 *
 * The shell (../vehicle-matcher.js) has already read authored config and put
 * `api`, `retailer`, `retailerLabel`, `brand` and `overrides` on `ctx`, applied
 * the brand theme class to the block, and handed us `root` — a stage element we
 * own outright (we may replaceChildren() it freely). `mount` augments `ctx`
 * with this mode's own per-run state and navigation, then boots.
 *
 * `mount` is deliberately synchronous-return: EDS awaits the block's decorate()
 * before it reveals the page, and the shell doesn't await us, so a slow first
 * request never holds the document (or scrolling) hostage. We paint a skeleton
 * immediately and swap in the real thing when the questions land.
 */
function mount(root, ctx) {
  // Per-run UI state this mode owns, hung on the shared ctx.
  ctx.answers = {};
  ctx.questions = [];
  // Live "best guess" strip state, kept on ctx so it survives the per-question
  // re-render (see renderPreviewSection / schedulePreviewRefresh). `seq` counts
  // the RUN, so starting over can disown a response the finished run is still
  // waiting on; ordering within a run is the feed's own guard. `loaded` flips
  // true once the first /api/preview response lands, so the strip can tell
  // "still loading" (show skeleton) from "loaded, no matches" (hide the strip).
  ctx.preview = { matches: [], seq: 0, loaded: false };
  // No `group`: the questions drawer shows individual cars, so its requests are
  // exactly what they always were.
  ctx.previewFeed = createPreviewFeed({
    api: ctx.api, retailer: ctx.retailer, brand: ctx.brand, scope: ctx.scope,
  });
  // Set when a summary pill is tapped to edit an earlier answer: the index to
  // return to once that answer is re-submitted (see renderAnswerPills /
  // advance). Null the rest of the time.
  ctx.editReturnIndex = null;
  // Where the preview strip mounts within the quiz screen. This is the one spot
  // that differs by layout: here it sits at the END of the screen, i.e. below
  // the Back/Next nav.
  ctx.mountPreview = (screen, section) => screen.append(section);

  ctx.showIntro = () => renderIntro(root, ctx);
  ctx.showQuestion = (i) => renderQuestion(root, ctx, i);
  ctx.showResults = (answers, { updateHash = false } = {}) => {
    if (updateHash) {
      window.history.replaceState(null, '', `#${HASH_KEY}=${encodeAnswers(answers)}`);
    }
    renderResults(root, ctx, answers);
  };

  // The question set lives behind the API, so load it before rendering.
  const boot = async () => {
    // Skeleton the intro while the question set loads — reads as the page
    // arriving rather than a "Loading…" status. (A deep-link run swaps to the
    // results skeleton a moment later inside renderResults.)
    renderIntroSkeleton(root);
    try {
      const meta = await apiGetQuestions(ctx.api, ctx.retailer, ctx.brand);
      ctx.questions = meta.questions;
    } catch {
      renderStatus(root, {
        kicker: 'Sorry',
        title: 'We couldn’t load the matcher',
        message: 'The matching service didn’t respond. Check your connection and try again.',
        retryLabel: 'Try again',
        onRetry: boot,
      });
      return;
    }

    const shared = answersFromHash(ctx.questions);
    if (shared) {
      ctx.answers = shared;
      ctx.showResults(shared);
    } else {
      ctx.showIntro();
    }
  };

  boot();
}

export default { key: 'questionnaire', label: 'Questionnaire', mount };
