import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_ARTIFACT_ROOT, releaseForManifest } from './fleet-release.js';
import { indexJsonl } from './indexed-jsonl.js';
import { inputDigest } from '../repository/core.js';
import { validateBmwCatalogueV2Envelope } from '../../vehicle-evidence/bmw-catalogue-v2.js';

// Admission anchors are code-owned. Neither candidate manifests nor API callers
// can supply a new registration or replace this retained source artifact.
const ADMITTED_SOURCES = [
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-model-trim264-2026-11-07.jsonl', import.meta.url),
    sha256: 'fd8d384e60b2058e27ee0b95c089cb7f7183bfd2d511761e39e566a6fc8cde9c' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-typed-axis390-2026-11-07.jsonl', import.meta.url),
    sha256: '6d1df1e9dde9d019e9f3a7dc3e22727d9df11b655ef0128e81c5ed75551a5b11' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-first32-2026-11-07.jsonl', import.meta.url),
    sha256: '845f2e1d0471ecead7e826ebf1c7e592478da6bc7d67fa4c10aa5b35dcad3080' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-core01-2026-11-07.jsonl', import.meta.url),
    sha256: '5439c8dd277f05fc8233db79d0f892f076dce75c27af82134ad8d87d6c5e1ef7' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-core02-2026-11-07.jsonl', import.meta.url),
    sha256: '14686f1d146d452e826501e108171902427b65ffa9632f388bf0d729b39bece6' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-core03-2026-11-07.jsonl', import.meta.url),
    sha256: 'c9db7e090ad41be9f3ac6c26c75984a7147a0641c5f1b264e02ea9d057dacc06' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-core04-2026-11-07.jsonl', import.meta.url),
    sha256: 'acc2f464d8a10707eff3adb9355ea3874f57bcc8d583c638bc1631b748e91a1d' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/f70-first8-2026-11-07.jsonl', import.meta.url),
    sha256: 'f02212941e47b69cad6d567eba5203b6602733613958910bea821897ce7d37b8' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/continuation1-2026-11-07.jsonl', import.meta.url),
    sha256: '1fedb63c1a6a3adcabcbf91d5803b8693821e153964be1b54a26efdd8929e802' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/pilot311-2026-11-07.jsonl', import.meta.url),
    sha256: '00c1d0217caae766b235fc33ca7e7b694e89cf33092825245668adf3348ff35a' },
  { url: new URL('../../data/gcsp/vehicle-evidence/registered-sources/batch32-2026-11-07.jsonl', import.meta.url),
    sha256: 'a99f3000b9e8cc9ec369fc5133ce0cde990f8fc80a628b4ad1469e89c9ee2265' },
];

/** Restore trusted source registrations on every process start, entirely offline. */
export async function registeredCatalogueSources(configurationKey, { manifestDigest, artifactDirectory, artifactRoot = DEFAULT_ARTIFACT_ROOT } = {}) {
  const registrations = []; let sources = ADMITTED_SOURCES;
  const release = releaseForManifest(manifestDigest);
  if (release) {
    const root = artifactDirectory ?? join(artifactRoot, release.releaseId);
    let available = false;
    try { const st = await lstat(root); if (!st.isDirectory() || st.isSymbolicLink()) throw new TypeError('Invalid source artifact root'); available = true; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    // A missing new bundle leaves existing Git-qualified selections usable.
    // A present bundle must match every code-owned source anchor exactly.
    if (available) sources = release.sources.filter((s) => s.manifestDigests.includes(manifestDigest)).map((s) => ({ url: join(root, s.path), sha256: s.sha256, bytes: s.bytes }));
  }
  for (const source of sources) {
    const indexed = await indexJsonl(source.url, { key: (row) => row.configurationId, ...(source.bytes === undefined ? {} : { maxBytes: 33554432 }) });
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
