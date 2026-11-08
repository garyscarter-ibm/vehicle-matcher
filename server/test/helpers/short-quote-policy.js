import { readFile } from 'node:fs/promises';
import { PolicyService } from '../../gcsp/policy/index.js';

// Explicit alternative input: quote terms that lapse inside the buddy hold, as a different policy version may set.
export async function shortQuotePolicy(seconds = 3600) {
  const seed = JSON.parse(await readFile(new URL('../../gcsp/policy/seed-v1.json', import.meta.url)));
  seed.assumptions.find((row) => row.key === 'employee.recommendation.v1').value.termValiditySeconds = seconds;
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}
