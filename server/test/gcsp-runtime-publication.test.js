import { readFile } from 'node:fs/promises';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
// Greg's demand read fails closed without the reviewed decline registry; seed it so a publish at `now` stays valid.
const reviewedReasons = getReviewedDefinitionSet('offer-decline-reasons-v1').definitions.find((d) => d.key === 'offer.declineReasons.v1');
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
seed.assumptions.push({ ...seed.assumptions[0], key: reviewedReasons.key, value: reviewedReasons.value, unit: reviewedReasons.unit, status: reviewedReasons.status, basis: reviewedReasons.basis });
