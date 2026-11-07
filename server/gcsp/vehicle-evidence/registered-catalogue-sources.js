import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { inputDigest } from '../repository/core.js';
import { validateBmwCatalogueV2Envelope } from '../../vehicle-evidence/bmw-catalogue-v2.js';

// Admission anchors are code-owned. Neither candidate manifests nor API callers
// can supply a new registration or replace this retained source artifact.
const ADMITTED_SOURCES = [
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/batch32-2026-11-07.jsonl', import.meta.url),
    sha256: 'a99f3000b9e8cc9ec369fc5133ce0cde990f8fc80a628b4ad1469e89c9ee2265' },
];

/** Restore trusted source registrations on every process start, entirely offline. */
export async function registeredCatalogueSources(configurationKey) {
  const registrations = [];
  for (const source of ADMITTED_SOURCES) {
    const info = await stat(source.url);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new TypeError('Invalid admitted source artifact');
    const bytes = await readFile(source.url);
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256 || !bytes.length || bytes.at(-1) !== 10) {
      throw new TypeError('Admitted source artifact changed');
    }
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const record = JSON.parse(line); const expected = record.catalogue; const binding = expected?.sourceBinding;
      if (record.admission !== true || record.sourceKind !== 'dated-snapshot' || record.source?.id !== 'bmw-uk-public'
        || record.configurationId !== expected?.lookupIdentity?.configurationId || !binding) throw new TypeError('Unadmitted source row');
      const trusted = { configurationKey, producerPins: binding.producerPins, evidencePins: binding.evidence,
        requestScope: binding.requestScope, confirmedContext: binding.confirmedContext };
      const qualified = validateBmwCatalogueV2Envelope(JSON.stringify(expected), trusted);
      if (qualified.status !== 'valid') throw new TypeError('Invalid admitted source envelope');
      registrations.push(Object.freeze({ lookupIdentity: Object.freeze(structuredClone(qualified.lookupIdentity)),
        qualifySnapshot(snapshot) {
          const checked = validateBmwCatalogueV2Envelope(typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot), trusted);
          return checked.status === 'valid' && inputDigest(checked.envelope) === inputDigest(expected)
            ? { status: 'qualified', envelope: checked.envelope } : { status: 'invalid', envelope: null };
        } }));
    }
  }
  return registrations;
}
