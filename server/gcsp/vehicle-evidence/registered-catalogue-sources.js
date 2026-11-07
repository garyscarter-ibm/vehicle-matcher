import { indexJsonl } from './indexed-jsonl.js';
import { inputDigest } from '../repository/core.js';
import { validateBmwCatalogueV2Envelope } from '../../vehicle-evidence/bmw-catalogue-v2.js';

// Admission anchors are code-owned. Neither candidate manifests nor API callers
// can supply a new registration or replace this retained source artifact.
const ADMITTED_SOURCES = [
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/pilot311-2026-11-07.jsonl', import.meta.url),
    sha256: '00c1d0217caae766b235fc33ca7e7b694e89cf33092825245668adf3348ff35a' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/batch32-2026-11-07.jsonl', import.meta.url),
    sha256: 'a99f3000b9e8cc9ec369fc5133ce0cde990f8fc80a628b4ad1469e89c9ee2265' },
];

/** Restore trusted source registrations on every process start, entirely offline. */
export async function registeredCatalogueSources(configurationKey) {
  const registrations = [];
  for (const source of ADMITTED_SOURCES) {
    const indexed = await indexJsonl(source.url, { key: (row) => row.configurationId });
    if (indexed.checksum !== source.sha256 || !indexed.length) throw new TypeError('Admitted source artifact changed');
    for (const entry of indexed.metadataEntries()) {
      const record = indexed.get(entry.key); const expected = record.catalogue; const binding = expected?.sourceBinding;
      if (record.admission !== true || record.sourceKind !== 'dated-snapshot' || record.source?.id !== 'bmw-uk-public'
        || record.configurationId !== expected?.lookupIdentity?.configurationId || !binding) throw new TypeError('Unadmitted source row');
      const trusted = { configurationKey, producerPins: binding.producerPins, evidencePins: binding.evidence,
        requestScope: binding.requestScope, confirmedContext: binding.confirmedContext };
      const qualified = validateBmwCatalogueV2Envelope(JSON.stringify(expected), trusted);
      if (qualified.status !== 'valid') throw new TypeError('Invalid admitted source envelope');
      const lookupIdentity = Object.freeze(structuredClone(qualified.lookupIdentity));
      // Capture the compact index/key only. Trusted pins and the full envelope are
      // derived again from the immutable code-admitted original on every resolve.
      registrations.push(Object.freeze({ lookupIdentity,
        qualifySnapshot(snapshot) {
          const original = indexed.get(entry.key); const expected = original.catalogue; const binding = expected.sourceBinding;
          const trusted = { configurationKey, producerPins: binding.producerPins, evidencePins: binding.evidence,
            requestScope: binding.requestScope, confirmedContext: binding.confirmedContext };
          const checked = validateBmwCatalogueV2Envelope(typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot), trusted);
          return checked.status === 'valid' && inputDigest(checked.envelope) === inputDigest(expected)
            ? { status: 'qualified', envelope: checked.envelope } : { status: 'invalid', envelope: null };
        } }));
    }
  }
  return registrations;
}
