// Retail compatibility facade (FUCQ-27): the public engine surface, delegating to used-retail-v1.
// Rollback boundary: reverting this wiring commit restores the pre-extraction engine.
export {
  WEIGHTS, PRIORITY_BOOSTS, STRETCH_FACTOR, budgetRange,
  rankCars, unmetWants, tradeOffs, groupListings, matchCars,
  TOP_MATCHES, CLUSTER_PTS, MAX_SHOWN, TASTE_PTS, ALTERNATIVES, LISTING_SAMPLE,
} from './scenarios/retail/used-retail-v1.js';
