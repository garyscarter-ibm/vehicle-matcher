/**
 * 200-scenario MECE simulation against the national BMW cache (12k cars).
 * Run: node scripts/mece-sim.js
 */
import { rankCars } from '../server/engine.js';
import { brandTuning } from '../server/brands.js';
import { readFileSync, writeFileSync } from 'fs';

const tuning = brandTuning('bmw');
const { cars } = JSON.parse(readFileSync('.cache/national-bmw.json', 'utf8'));
console.log(`BMW pool: ${cars.length} cars`);

// ── Question axes (BMW ranges) ─────────────────────────────────────────────
const BUDGETS     = [[20000,40000],[40000,70000],[70000,100000],[100000,150000]];
const BODY_STYLES = [['hatchback'],['saloon'],['estate'],['suv'],['coupe'],['convertible'],['mpv'],['any']];
const FUELS       = [['petrol'],['diesel'],['ev'],['phev'],['open']];
const CHARGING    = ['home','work','none'];
const PRIMARY_USE = ['city','commute','family','roadtrips','fun'];
const PEOPLE      = ['solo','family','crew'];
const MILEAGES    = [5000,10000,15000,22000];
const STYLES      = ['1','2','3','4','5'];
const PRIORITIES  = [
  ['economy','comfort'],['economy','tech'],
  ['performance','image'],['performance','tech'],
  ['comfort','image'],['tech','image'],
  ['economy','performance'],['comfort','tech'],
];

function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

// Build 200 scenarios by stepping through each axis at a different prime rate
const scenarios = [];
for (let i = 0; i < 200; i++) {
  scenarios.push({
    id: i + 1,
    answers: {
      budget:      pick(BUDGETS,      i),
      bodyStyles:  pick(BODY_STYLES,  Math.floor(i / 2)),
      fuel:        pick(FUELS,        Math.floor(i / 3)),
      charging:    pick(CHARGING,     Math.floor(i / 5)),
      primaryUse:  pick(PRIMARY_USE,  Math.floor(i / 7)),
      people:      pick(PEOPLE,       Math.floor(i / 11)),
      mileage:     Number(pick(MILEAGES, Math.floor(i / 13))),
      style:       pick(STYLES,       Math.floor(i / 17)),
      priorities:  pick(PRIORITIES,   Math.floor(i / 19)),
    }
  });
}

// ── Run each scenario ──────────────────────────────────────────────────────
const QUESTIONS = ['bodyStyles','fuel','charging','primaryUse','people','mileage','style','priorities'];

function neutralise(answers, q) {
  const a = { ...answers };
  if (q === 'bodyStyles') a.bodyStyles = ['any'];
  else if (q === 'fuel')       a.fuel = ['open'];
  else if (q === 'charging')   delete a.charging;
  else if (q === 'primaryUse') delete a.primaryUse;
  else if (q === 'people')     delete a.people;
  else if (q === 'mileage')    delete a.mileage;
  else if (q === 'style')      delete a.style;
  else if (q === 'priorities') delete a.priorities;
  return a;
}

const results = scenarios.map(({ id, answers }) => {
  const ranked = rankCars(answers, cars, tuning);
  const baseWinner = ranked[0]?.car?.name || 'none';
  const baseTop3   = ranked.slice(0,3).map(m => ({ name: m.car.name, score: m.score, body: m.car.body, fuel: m.car.fuel }));

  const sensitivity = {};
  for (const q of QUESTIONS) {
    const reranked = rankCars(neutralise(answers, q), cars, tuning);
    sensitivity[q] = reranked[0]?.car?.name !== baseWinner;
  }
  return { id, answers, baseWinner, top3: baseTop3, sensitivity };
});

// ── Aggregate ──────────────────────────────────────────────────────────────
const changedWinner = {};
for (const q of QUESTIONS) {
  changedWinner[q] = results.filter(r => r.sensitivity[q]).length;
}

const stuckCount = results.filter(r => !Object.values(r.sensitivity).some(Boolean)).length;

const topFreq = {};
for (const r of results) {
  topFreq[r.baseWinner] = (topFreq[r.baseWinner] || 0) + 1;
}

// Pair overlap: how often do both questions in a pair each independently change the winner?
const pairOverlap = {};
for (let a = 0; a < QUESTIONS.length; a++) {
  for (let b = a+1; b < QUESTIONS.length; b++) {
    const qa = QUESTIONS[a], qb = QUESTIONS[b];
    const count = results.filter(r => r.sensitivity[qa] && r.sensitivity[qb]).length;
    if (count > 0) pairOverlap[`${qa}+${qb}`] = count;
  }
}

// What if we removed the OLD boot question? It was replaced by people+primaryUse.
// Simulate: does removing people OR primaryUse (separately) lose more than keeping boot implied?
const bootImpliedCheck = results.map(r => {
  const noPeople = rankCars(neutralise(r.answers,'people'), cars, tuning)[0]?.car?.name;
  const noUse    = rankCars(neutralise(r.answers,'primaryUse'), cars, tuning)[0]?.car?.name;
  return {
    id: r.id,
    baseCriterion: r.baseWinner,
    changesWithoutPeople: noPeople !== r.baseWinner,
    changesWithoutUse:    noUse !== r.baseWinner,
  };
});

// What if we dropped style AND priorities (both "taste" questions)?
const noTasteCheck = results.map(r => {
  const stripped = { ...r.answers };
  delete stripped.style;
  delete stripped.priorities;
  const reranked = rankCars(stripped, cars, tuning);
  return { id: r.id, changed: reranked[0]?.car?.name !== r.baseWinner };
});
const noTasteChanges = noTasteCheck.filter(r => r.changed).length;

const report = {
  poolSize: cars.length,
  totalScenarios: 200,
  changedWinner,
  stuckCount,
  topFreq,
  pairOverlap,
  bootImplied: {
    changesWithoutPeople: bootImpliedCheck.filter(r => r.changesWithoutPeople).length,
    changesWithoutUse:    bootImpliedCheck.filter(r => r.changesWithoutUse).length,
  },
  noTasteChanges,
  allResults: results,
};

writeFileSync('scripts/mece-report.json', JSON.stringify(report, null, 2));

// ── Console summary ────────────────────────────────────────────────────────
console.log('\n── How often each question changes the #1 result ──');
for (const [q, n] of Object.entries(changedWinner)) {
  const bar = '█'.repeat(Math.round(n/4));
  console.log(`  ${q.padEnd(14)} ${String(n).padStart(3)}/200  ${bar}`);
}
console.log(`\n  Stuck (no question moves winner): ${stuckCount}/200`);
console.log(`\n── Boot question is now implied by people+primaryUse ──`);
console.log(`  Removing people alone changes winner:      ${bootImpliedCheck.filter(r=>r.changesWithoutPeople).length}/200`);
console.log(`  Removing primaryUse alone changes winner:  ${bootImpliedCheck.filter(r=>r.changesWithoutUse).length}/200`);
console.log(`\n── Dropping both taste questions (style+priorities) ──`);
console.log(`  Changes winner: ${noTasteChanges}/200`);
console.log('\n── Top 10 most frequently recommended cars ──');
Object.entries(topFreq).sort((a,b)=>b[1]-a[1]).slice(0,10)
  .forEach(([k,v]) => console.log(`  ${k.padEnd(50)} ${v}`));
console.log('\nFull report → scripts/mece-report.json');
