import * as reference from './retail-reference-r1/engine.js';
import * as live from '../../engine.js';
import * as usedRetailV1 from '../../scenarios/retail/used-retail-v1.js';
import { diffEngines, parityCorpus } from './retail-parity.js';

// Child process for the TASTE_SHARE check: diffs the reference against both paths, prints one JSON line.
const corpus = parityCorpus();
const liveRun = diffEngines(reference, live, corpus);
const extracted = diffEngines(reference, usedRetailV1, corpus);
console.log(JSON.stringify({ tasteShare: process.env.TASTE_SHARE ?? null, ...liveRun, usedRetailV1: extracted }));
