import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inputDigest } from '../repository/core.js';

// A manifest can carry these independently qualified facts; it cannot confer source authority.
// Original accepted catalogue bytes, configuration identity and history are never rewritten.
const registration = new URL('../../data/gcsp/vehicle-evidence/registered-technical/1f7e-2026-11-07.json', import.meta.url);
const sha256 = 'c113780f0a2529240a24c1cf49fe25a81986dee88dfefe0b047b7a50bd258a22';
export async function validateRegisteredTechnicalSupplement(supplement, row) {
  try {
    const bytes = await readFile(registration);
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) return false;
    const approved = JSON.parse(bytes);
    return inputDigest(supplement) === inputDigest(approved)
      && row?.configurationId === approved.configurationId && row.catalogue?.schemaVersion === '2'
      && row.catalogue.lookupIdentity?.bindingDigest === approved.bindingDigest
      && inputDigest(row.catalogue) === approved.catalogueDigest
      && Object.keys(approved.facts).every(key => row.catalogue.facts[key]?.state === 'unknown'
        && row.catalogue.facts[key].value === null);
  } catch { return false; }
}
