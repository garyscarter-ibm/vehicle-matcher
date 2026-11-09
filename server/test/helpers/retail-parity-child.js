import * as reference from './retail-reference-r1/engine.js';
import * as live from '../../engine.js';
import { diffEngines, parityCorpus } from './retail-parity.js';

// Child process for the TASTE_SHARE check: runs the differential, prints one JSON line.
const run = diffEngines(reference, live, parityCorpus());
console.log(JSON.stringify({ tasteShare: process.env.TASTE_SHARE ?? null, ...run }));
