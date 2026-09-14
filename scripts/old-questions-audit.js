/**
 * Audit of the OLD BMW/MINI question set (10 questions, including boot).
 * Runs 500 scenarios against the national BMW cache (12,358 cars).
 * Outputs scripts/old-questions-audit.json for the HTML report.
 *
 * Run: node scripts/old-questions-audit.js
 */
import { rankCars } from '../server/engine.js';
import { brandTuning } from '../server/brands.js';
import { readFileSync, writeFileSync } from 'fs';

const tuning = brandTuning('bmw');
const { cars } = JSON.parse(readFileSync('.cache/national-bmw.json', 'utf8'));
console.log(`BMW pool: ${cars.length} cars`);

// ── OLD question set axes ────────────────────────────────────────────────────
// Budget was originally fixed bands, later became a slider.
// We simulate with the slider format (current engine understands both).
const BUDGETS     = [[15000,30000],[30000,50000],[50000,75000],[75000,100000],[100000,150000]];
const BODY_STYLES = [['hatchback'],['saloon'],['estate'],['suv'],['coupe'],['convertible'],['mpv'],['any']];
const FUELS       = [['petrol'],['diesel'],['ev'],['phev'],['open']];
const CHARGING    = ['home','work','none','either'];
const PRIMARY_USE = ['city','commute','family','roadtrips','fun'];
const PEOPLE      = ['solo','family','crew'];
const BOOT        = ['small','medium','big'];  // THE OLD QUESTION (cut from current set)
const MILEAGES    = [3000,8000,13000,20000,24000];
const STYLES      = ['1','2','3','4','5'];
const PRIORITIES  = [
  ['economy','comfort'],['economy','tech'],['economy','performance'],
  ['performance','image'],['performance','tech'],
  ['comfort','image'],['comfort','tech'],
  ['tech','image'],
];

// All 10 old questions in order
const OLD_QUESTIONS = [
  'budget','bodyStyles','fuel','charging','primaryUse','people','boot','mileage','style','priorities'
];

function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

// Build 500 diverse scenarios
const scenarios = [];
for (let i = 0; i < 250; i++) {
  scenarios.push({
    id: i + 1,
    answers: {
      budget:      pick(BUDGETS,     i),
      bodyStyles:  pick(BODY_STYLES, Math.floor(i / 2)),
      fuel:        pick(FUELS,       Math.floor(i / 3)),
      charging:    pick(CHARGING,    Math.floor(i / 5)),
      primaryUse:  pick(PRIMARY_USE, Math.floor(i / 7)),
      people:      pick(PEOPLE,      Math.floor(i / 11)),
      boot:        pick(BOOT,        Math.floor(i / 13)),
      mileage:     pick(MILEAGES,    Math.floor(i / 17)),
      style:       pick(STYLES,      Math.floor(i / 19)),
      priorities:  pick(PRIORITIES,  Math.floor(i / 23)),
    }
  });
}

// ── Neutralise a question (remove its signal) ─────────────────────────────
function neutralise(answers, q) {
  const a = { ...answers };
  if (q === 'bodyStyles') a.bodyStyles = ['any'];
  else if (q === 'fuel')       a.fuel = ['open'];
  else if (q === 'charging')   delete a.charging;
  else if (q === 'primaryUse') delete a.primaryUse;
  else if (q === 'people')     delete a.people;
  else if (q === 'boot')       delete a.boot;
  else if (q === 'mileage')    delete a.mileage;
  else if (q === 'style')      delete a.style;
  else if (q === 'priorities') delete a.priorities;
  else if (q === 'budget')     a.budget = [0, 150000]; // open budget
  return a;
}

// ── Run each scenario ─────────────────────────────────────────────────────
console.log('Running 250 scenarios × 10 questions...');
const results = scenarios.map(({ id, answers }) => {
  const ranked = rankCars(answers, cars, tuning);
  const baseWinner = ranked[0]?.car?.name || 'none';
  const baseTop3   = ranked.slice(0,3).map(m => ({
    name: m.car.name, score: m.score, body: m.car.body, fuel: m.car.fuel,
    priceMin: m.car.priceMin
  }));

  const sensitivity = {};
  for (const q of OLD_QUESTIONS) {
    const stripped = neutralise(answers, q);
    const reranked = rankCars(stripped, cars, tuning);
    sensitivity[q] = reranked[0]?.car?.name !== baseWinner;
  }

  // How much does the SCORE of #1 change when each question is stripped?
  const scoreShift = {};
  const baseScore = ranked[0]?.score ?? 0;
  for (const q of OLD_QUESTIONS) {
    const stripped = neutralise(answers, q);
    const reranked = rankCars(stripped, cars, tuning);
    scoreShift[q] = Math.abs((reranked[0]?.score ?? 0) - baseScore);
  }

  return { id, answers, baseWinner, top3: baseTop3, sensitivity, scoreShift };
});

// ── Aggregate ─────────────────────────────────────────────────────────────
const N = results.length; // 250
const changedWinner = {};
const avgScoreShift = {};
for (const q of OLD_QUESTIONS) {
  changedWinner[q] = results.filter(r => r.sensitivity[q]).length;
  const shifts = results.map(r => r.scoreShift[q]);
  avgScoreShift[q] = Math.round(shifts.reduce((a,b) => a+b, 0) / N * 10) / 10;
}

const stuckCount = results.filter(r =>
  !OLD_QUESTIONS.some(q => r.sensitivity[q])
).length;

// Pair overlap
const pairOverlap = {};
for (let a = 0; a < OLD_QUESTIONS.length; a++) {
  for (let b = a+1; b < OLD_QUESTIONS.length; b++) {
    const qa = OLD_QUESTIONS[a], qb = OLD_QUESTIONS[b];
    const count = results.filter(r => r.sensitivity[qa] && r.sensitivity[qb]).length;
    if (count > 0) pairOverlap[`${qa}+${qb}`] = count;
  }
}

// Top car frequency
const topFreq = {};
for (const r of results) {
  topFreq[r.baseWinner] = (topFreq[r.baseWinner] || 0) + 1;
}

// Boot question deep analysis:
// How often does boot AGREE with what people+primaryUse would imply?
const PEOPLE_SPACE = { solo: 0, family: 1, crew: 2 };
const USE_SPACE    = { city: 0, commute: 0, fun: 0, family: 1, roadtrips: 1 };
const SPACE_KEYS   = ['small','medium','big'];
function impliedBoot(answers) {
  const level = (PEOPLE_SPACE[answers.people] ?? 0) + (USE_SPACE[answers.primaryUse] ?? 0);
  return SPACE_KEYS[Math.min(level, 2)];
}

const bootAnalysis = results.map(r => {
  const implied = impliedBoot(r.answers);
  const stated  = r.answers.boot;
  const agrees  = implied === stated;
  return { id: r.id, stated, implied, agrees, changedWinner: r.sensitivity.boot };
});
const bootAgreePct  = Math.round(bootAnalysis.filter(r => r.agrees).length / N * 100);
const bootDisagreePct = 100 - bootAgreePct;
const bootDisagreeChanges = bootAnalysis.filter(r => !r.agrees && r.changedWinner).length;

// Mileage deep analysis: at what mileage band does it start to matter?
const mileageBands = {};
for (const r of results) {
  const m = r.answers.mileage;
  if (!mileageBands[m]) mileageBands[m] = { total: 0, changed: 0 };
  mileageBands[m].total++;
  if (r.sensitivity.mileage) mileageBands[m].changed++;
}

// Charging deep analysis: only matters for EV/PHEV buyers
const chargingByFuel = { ev: {total:0,changed:0}, phev: {total:0,changed:0}, other: {total:0,changed:0} };
for (const r of results) {
  const fuels = Array.isArray(r.answers.fuel) ? r.answers.fuel : [r.answers.fuel];
  const isEV  = fuels.includes('ev');
  const isPHEV= fuels.includes('phev');
  const key   = isEV ? 'ev' : isPHEV ? 'phev' : 'other';
  chargingByFuel[key].total++;
  if (r.sensitivity.charging) chargingByFuel[key].changed++;
}

const report = {
  poolSize: cars.length,
  totalScenarios: N,
  changedWinner,
  avgScoreShift,
  stuckCount,
  topFreq,
  pairOverlap,
  bootAnalysis: {
    agreePct: bootAgreePct,
    disagreePct: bootDisagreePct,
    disagreeChanges: bootDisagreeChanges,
    disagreeChangePct: Math.round(bootDisagreeChanges / N * 100),
  },
  mileageBands,
  chargingByFuel,
};

writeFileSync('scripts/old-questions-audit.json', JSON.stringify(report, null, 2));

// ── Console summary ───────────────────────────────────────────────────────
console.log('\n── How often each question changes the #1 result ──');
const sorted = Object.entries(changedWinner).sort((a,b) => b[1]-a[1]);
for (const [q, n] of sorted) {
  const pct = Math.round(n/N*100);
  const bar = '█'.repeat(Math.round(pct/3));
  console.log(`  ${q.padEnd(14)} ${String(n).padStart(3)}/${N}  (${String(pct).padStart(2)}%)  ${bar}`);
}
console.log(`\n  Stuck (no question moves winner): ${stuckCount}/${N}`);
console.log(`\n── Boot question ──`);
console.log(`  Agrees with people+primaryUse: ${bootAgreePct}%`);
console.log(`  When they disagree, boot changes winner: ${bootDisagreeChanges}/${N}`);
console.log('\nFull report → scripts/old-questions-audit.json');
