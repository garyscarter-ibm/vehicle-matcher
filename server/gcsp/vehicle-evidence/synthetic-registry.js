import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { inputDigest } from '../repository/core.js';
import { calculateVinCheckDigit } from './vin-generator.js';
import { canonicalContent, CORPUS_FILES, durableWrite, readCorpusFile,
  syncDirectory, validateCorpusDirectory } from './corpus-publisher.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const equal = (a, b) => canonicalContent(a) === canonicalContent(b);
const seal = (value) => { const { contentDigest, ...content } = value; return { ...content, contentDigest: inputDigest(content) }; };
const emptyHistory = () => seal({ schemaVersion: '1', revision: 0, configurations: [], identities: [], datasets: [] });
const associationDigest = (row) => { const { usage, ...association } = row; return inputDigest(association); };
const activeInfo = (snapshot) => snapshot ? { datasetId: snapshot.manifest.datasetId, version: snapshot.manifest.version,
  manifestDigest: snapshot.manifestDigest, counts: structuredClone(snapshot.manifest.counts),
  sourceContexts: structuredClone(snapshot.manifest.sourceContexts), completeness: structuredClone(snapshot.manifest.completeness) } : null;
const failure = (status, code, message) => ({ status, failure: { code, message } });
const unavailable = (code, message) => failure('source-unavailable', code, message);
const duplicate = (rows, field) => new Set(rows.map((row) => row[field])).size !== rows.length;
function validHistory(value) {
  try {
    if (!object(value) || value.schemaVersion !== '1' || !Number.isSafeInteger(value.revision) || value.revision < 0
      || value.contentDigest !== seal(value).contentDigest || !Array.isArray(value.configurations)
      || !Array.isArray(value.identities) || !Array.isArray(value.datasets)
      || Object.keys(value).some((key) => !['schemaVersion', 'revision', 'contentDigest', 'configurations', 'identities', 'datasets'].includes(key))) return false;
    if (value.configurations.some((r) => !text(r.configurationId) || !text(r.originatingDatasetId) || !hash(r.recordDigest))
      || duplicate(value.configurations, 'configurationId') || duplicate(value.identities, 'vin17')
      || duplicate(value.identities, 'vin7') || duplicate(value.identities, 'vehicleId')) return false;
    if (!value.identities.every((row) => row.identityKind === 'synthetic' && text(row.vehicleId)
      && ['current-car', 'delivered-car'].includes(row.usage) && /^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin17)
      && row.vin17[8] === calculateVinCheckDigit(row.vin17).character && row.vin7 === row.vin17.slice(-7)
      && hash(row.configurationHash) && text(row.originatingDatasetId)
      && row.originatingDatasetId === row.vinAllocationOrigin?.originatingDatasetId
      && value.configurations.some((r) => r.configurationId === row.configurationId))) return false;
    const datasetKeys = value.datasets.map((r) => JSON.stringify([r.datasetId, r.version]));
    return new Set(datasetKeys).size === datasetKeys.length && value.datasets.every((r) => text(r.datasetId)
      && text(r.version) && hash(r.manifestDigest) && r.directory === r.manifestDigest);
  } catch { return false; }
}
function mergeHistory(history, corpus, manifestDigest) {
  const next = structuredClone(history); const manifest = corpus.manifest;
  const existing = next.datasets.find((r) => r.datasetId === manifest.datasetId && r.version === manifest.version);
  if (existing && existing.manifestDigest !== manifestDigest) return failure('conflict', 'dataset-version-conflict', 'An already retained dataset/version has different bytes. Use a new version without changing retained associations.');
  for (const row of corpus.configurations) {
    const previous = next.configurations.find((r) => r.configurationId === row.configurationId);
    if (previous && previous.recordDigest !== inputDigest(row)) return failure('conflict', 'historical-configuration-conflict', 'A stable configurationId already identifies different immutable facts or provenance.');
    if (!previous) next.configurations.push({ configurationId: row.configurationId, recordDigest: inputDigest(row), originatingDatasetId: manifest.datasetId });
  }
  for (const row of corpus.vins) {
    const previous = next.identities.find((r) => r.vehicleId === row.vehicleId || r.vin17 === row.vin17 || r.vin7 === row.vin7);
    if (previous && associationDigest(previous) !== associationDigest(row)) return failure('conflict', 'historical-identity-conflict', 'The retained physical-car/VIN/configuration/origin association cannot change.');
    if (!previous) next.identities.push(structuredClone(row));
  }
  if (!existing) next.datasets.push({ datasetId: manifest.datasetId, version: manifest.version, manifestDigest, directory: manifestDigest });
  if (equal(next, history)) return { status: 'ok', history, changed: false };
  next.configurations.sort((a, b) => a.configurationId.localeCompare(b.configurationId));
  next.identities.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
  next.datasets.sort((a, b) => canonicalContent([a.datasetId, a.version]).localeCompare(canonicalContent([b.datasetId, b.version])));
  next.revision += 1;
  return { status: 'ok', history: seal(next), changed: true };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
async function acquireWriter(root) {
  // Non-waiting bakery admission: each claim has a unique path, so stale cleanup
  // can never unlink another process's newly acquired lock (the stale-lock ABA race).
  const token = randomUUID(); const path = join(root, `.publisher-${process.pid}-${token}.json`);
  let kept = false;
  const release = async () => { await rm(path, { force: true }); await syncDirectory(root); };
  async function contenders() {
    const rows = [];
    for (const name of await readdir(root)) {
      const match = /^\.publisher-([1-9][0-9]*)-([0-9a-f-]{36})\.json$/.exec(name);
      if (!match) continue;
      const candidate = join(root, name); const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid)) return null;
      if (!alive(pid)) { await rm(candidate, { force: true }); continue; }
      try {
        const row = JSON.parse(await readFile(candidate, 'utf8'));
        if (row.schemaVersion !== '1' || row.pid !== pid || row.token !== match[2]
          || !(row.choosing === true && row.ticket === null
            || row.choosing === false && Number.isSafeInteger(row.ticket) && row.ticket > 0)) return null;
        rows.push(row);
      } catch (error) { if (error.code !== 'ENOENT') return null; }
    }
    return rows;
  }
  try {
    await durableWrite(path, canonicalContent({ schemaVersion: '1', pid: process.pid, token, choosing: true, ticket: null }), true);
    const initial = await contenders();
    if (!initial || initial.some((row) => row.token !== token && row.choosing)) return null;
    const ticket = Math.max(0, ...initial.map((row) => row.ticket || 0)) + 1;
    if (!Number.isSafeInteger(ticket)) return null;
    await durableWrite(path, canonicalContent({ schemaVersion: '1', pid: process.pid, token, choosing: false, ticket }));
    const final = await contenders();
    if (!final || final.some((row) => row.token !== token
      && (row.choosing || row.ticket < ticket || row.ticket === ticket && row.token < token))) return null;
    kept = true; return release;
  } finally { if (!kept) await release(); }
}
async function writeAtomic(root, name, value) {
  const temporary = join(root, `.write-${process.pid}-${randomUUID()}`);
  try { await durableWrite(temporary, canonicalContent(value), true); await rename(temporary, join(root, name)); await syncDirectory(root); }
  finally { await rm(temporary, { force: true }); }
}
const validSelection = (s) => object(s) && hash(s.manifestDigest) && s.directory === s.manifestDigest
  && Object.keys(s).every((key) => ['directory', 'manifestDigest'].includes(key));
async function recoverStages(root) {
  for (const name of await readdir(root)) {
    const interruptedWrite = /^\.write-([1-9][0-9]*)-[0-9a-f-]{36}$/.exec(name);
    if (interruptedWrite && !alive(Number(interruptedWrite[1]))) { await rm(join(root, name), { force: true }); continue; }
    if (!/^\.stage-[0-9a-f-]{36}$/.test(name)) continue;
    const path = join(root, name);
    try {
      const owner = JSON.parse(await readFile(join(path, 'publication-owner.json'), 'utf8'));
      if (owner.schemaVersion === '1' && Number.isSafeInteger(owner.pid) && owner.pid > 0 && text(owner.token) && !alive(owner.pid)) await rm(path, { recursive: true, force: true });
    } catch { /* An unowned directory is never a cleanup target. */ }
  }
}
/** Read-only lookup port plus explicit local publication operations. No transport, SQL or run-reset capability. */
export function createSyntheticRegistry({ root, onPhase = async () => {}, ...options } = {}) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new TypeError('Supply an absolute corpus store root.');
  root = resolve(root); let snapshot = null; let retained = null;
  const info = () => activeInfo(snapshot);
  const report = (result) => ({ ...result, stillActive: info() });
  async function history() {
    try {
      const value = JSON.parse(await readCorpusFile(root, 'identity-inventory.json'));
      return validHistory(value) ? { status: 'ok', history: value } : unavailable('identity-inventory-invalid', 'The independent synthetic identity inventory is invalid. All live forwarding remains disabled.');
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          const entries = await readdir(root).catch((e) => e.code === 'ENOENT' ? [] : Promise.reject(e));
          const versions = await readdir(join(root, 'versions')).catch((e) => e.code === 'ENOENT' ? [] : Promise.reject(e));
          if (!entries.includes('active.json') && !entries.includes('last-good.json') && versions.length === 0) return { status: 'ok', history: emptyHistory() };
        } catch { /* Unreadable stores are never interpreted as a fresh inventory. */ }
      }
      return unavailable('identity-inventory-unavailable', 'Restore the retained synthetic identity inventory before loading; no synthetic identity may be forwarded live.');
    }
  }
  async function openSelection(selection, historyValue) {
    if (!validSelection(selection)) return unavailable('selection-invalid', 'The selected version reference is invalid.');
    const loaded = await validateCorpusDirectory(join(root, 'versions', selection.directory), options);
    if (loaded.status !== 'ok' || loaded.manifestDigest !== selection.manifestDigest) return unavailable('selected-corpus-invalid', 'The selected complete corpus failed validation.');
    const merged = mergeHistory(historyValue, loaded.corpus, loaded.manifestDigest);
    if (merged.status !== 'ok' || merged.changed) return unavailable('selection-history-mismatch', 'The selected corpus is absent from or conflicts with durable identity history.');
    return { ...loaded, selection };
  }
  function select(loaded) {
    const configurations = new Map(loaded.corpus.configurations.map((row) => [row.configurationId, row]));
    const vins = new Map(); for (const row of loaded.corpus.vins) { vins.set(row.vin17, row); vins.set(row.vin7, row); }
    snapshot = { ...loaded.corpus, manifestDigest: loaded.manifestDigest, selection: loaded.selection, configurations, vins };
  }
  async function load() {
    try {
      const h = await history(); if (h.status !== 'ok') return report(h); retained = h.history;
      let pointer;
      try { pointer = JSON.parse(await readCorpusFile(root, 'active.json')); }
      catch { pointer = null; }
      if (pointer?.schemaVersion === '1' && pointer.selected === null) { snapshot = null; return report(unavailable('corpus-deactivated', 'No corpus is selected. Synthetic identity routing history is retained.')); }
      let failed = unavailable('corpus-absent', 'No validated corpus is selected; this is source-unavailable, not a valid empty registry.');
      if (pointer?.schemaVersion === '1') {
        const loaded = await openSelection(pointer.selected, retained);
        if (loaded.status === 'ok') { select(loaded); return { status: 'ok', active: info(), recovered: false }; }
        failed = loaded;
      }
      let previous = pointer?.previous;
      if (!validSelection(previous)) {
        try { const good = JSON.parse(await readCorpusFile(root, 'last-good.json')); previous = good.schemaVersion === '1' ? good.selected : null; } catch { previous = null; }
      }
      if (validSelection(previous)) {
        const loaded = await openSelection(previous, retained);
        if (loaded.status === 'ok') { select(loaded); return { ...report(failed), recovered: true, active: info() }; }
      }
      return report(failed);
    } catch { return report(unavailable('store-unavailable', 'The corpus store is unavailable. The last complete in-memory version remains readable.')); }
  }
  async function publish(candidatePath) {
    let unlock; let staging;
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      unlock = await acquireWriter(root);
      if (!unlock) return report(failure('competing-writer', 'competing-writer', 'Another publisher owns this store; retry after it completes.'));
      await recoverStages(root); await load();
      const h = await history(); if (h.status !== 'ok') return report(h);
      const checked = await validateCorpusDirectory(candidatePath, options); if (checked.status !== 'ok') return report(checked);
      const merged = mergeHistory(h.history, checked.corpus, checked.manifestDigest); if (merged.status !== 'ok') return report(merged);
      if (snapshot?.manifestDigest === checked.manifestDigest) return { status: 'ok', idempotent: true, active: info() };
      staging = join(root, `.stage-${randomUUID()}`); await mkdir(staging, { mode: 0o700 });
      await durableWrite(join(staging, 'publication-owner.json'), canonicalContent({ schemaVersion: '1', pid: process.pid, token: randomUUID() }), true);
      for (const file of ['manifest.json', ...CORPUS_FILES]) await durableWrite(join(staging, file), await readCorpusFile(candidatePath, file), true);
      await syncDirectory(staging);
      const staged = await validateCorpusDirectory(staging, options);
      if (staged.status !== 'ok') return report(staged);
      if (staged.manifestDigest !== checked.manifestDigest) return report(failure('conflict', 'candidate-changed', 'The candidate changed during staging; retry using immutable input.'));
      await onPhase('staged');
      await mkdir(join(root, 'versions'), { recursive: true, mode: 0o700 });
      const selection = { directory: checked.manifestDigest, manifestDigest: checked.manifestDigest };
      const destination = join(root, 'versions', selection.directory);
      try { await rename(staging, destination); staging = null; }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        const existing = await validateCorpusDirectory(destination, options);
        if (existing.status !== 'ok' || existing.manifestDigest !== checked.manifestDigest) return report(unavailable('version-artifact-invalid', 'A retained version directory is damaged; restore it before retrying.'));
      }
      await syncDirectory(join(root, 'versions')); await onPhase('version-persisted');
      if (merged.changed || !retained || retained.revision === 0) await writeAtomic(root, 'identity-inventory.json', merged.history);
      retained = merged.history; await onPhase('inventory-persisted');
      const previous = snapshot?.selection || null;
      if (previous) await writeAtomic(root, 'last-good.json', { schemaVersion: '1', selected: previous });
      await onPhase('before-select');
      await writeAtomic(root, 'active.json', { schemaVersion: '1', selected: selection, previous });
      select({ ...staged, selection });
      return { status: 'ok', idempotent: false, active: info() };
    } catch { return report(unavailable('publication-interrupted', 'Publication did not complete. Reopen the store to discover its validated old-or-new selection; retained identities are never regenerated.')); }
    finally { if (staging) await rm(staging, { recursive: true, force: true }); if (unlock) await unlock(); }
  }
  async function deactivate() {
    let unlock;
    try {
      await mkdir(root, { recursive: true, mode: 0o700 }); unlock = await acquireWriter(root);
      if (!unlock) return report(failure('competing-writer', 'competing-writer', 'Another publisher owns this store.'));
      await load(); const h = await history(); if (h.status !== 'ok') return report(h);
      if (snapshot) await writeAtomic(root, 'last-good.json', { schemaVersion: '1', selected: snapshot.selection });
      await writeAtomic(root, 'active.json', { schemaVersion: '1', selected: null, previous: snapshot?.selection || null });
      snapshot = null; retained = h.history;
      return { status: 'ok', active: null, notice: 'Configuration availability is deactivated. Synthetic identity routing history is retained.' };
    } catch { return report(unavailable('deactivation-unavailable', 'The store could not be deactivated.')); }
    finally { if (unlock) await unlock(); }
  }
  function getConfiguration(id) {
    if (!snapshot) return { ...unavailable('corpus-absent', 'No validated corpus is selected.'), active: null };
    if (!text(id)) return { status: 'invalid-input', active: info() };
    const row = snapshot.configurations.get(id);
    if (!row) return { status: 'not-found', active: info() };
    return { status: row.catalogue?.status || 'partial', active: info(), sourceKind: row.sourceContext.sourceKind,
      record: structuredClone(row), images: structuredClone(snapshot.images.filter((image) => row.imageIds.includes(image.imageId))),
      imageState: row.imageIds.length ? 'representative' : 'unavailable' };
  }
  function getVin(vin) {
    if (!snapshot) return { ...unavailable('corpus-absent', 'No validated corpus is selected.'), identityKind: retained?.identities.some((row) => row.vin17 === vin || row.vin7 === vin) ? 'synthetic' : 'unknown', liveEligible: false, active: null };
    if (typeof vin !== 'string' || !/^(?:[A-HJ-NPR-Z0-9]{17}|[A-HJ-NPR-Z0-9]{7})$/.test(vin)) return { status: 'invalid-input', liveEligible: false, active: info() };
    const row = snapshot.vins.get(vin);
    if (!row) return { status: 'not-found', identityKind: retained?.identities.some((r) => r.vin17 === vin || r.vin7 === vin) ? 'synthetic' : 'unknown', liveEligible: false, active: info() };
    return { ...getConfiguration(row.configurationId), vehicle: structuredClone(row), identityKind: 'synthetic', liveEligible: false,
      notice: 'A fictional VIN association to retained source facts; this is not a factory build or authentication.' };
  }
  async function classifyIdentity(vin) {
    const h = await history();
    if (h.status !== 'ok') return { ...h, identityKind: 'unknown', liveEligible: false };
    const row = h.history.identities.find((r) => r.vin17 === vin || r.vin7 === vin);
    return { status: row ? 'ok' : 'not-found', identityKind: row ? 'synthetic' : 'unknown', liveEligible: false,
      ...(row ? { vehicleId: row.vehicleId, configurationId: row.configurationId, originatingDatasetId: row.originatingDatasetId } : {}) };
  }
  return { load, publish, deactivate, getConfiguration, getVin, classifyIdentity,
    status: () => ({ status: snapshot ? 'ok' : 'source-unavailable', active: info() }) };
}
export function presentCorpusLoad(result) {
  return { status: result?.status || 'source-unavailable', active: structuredClone(result?.active || result?.stillActive || null),
    failure: structuredClone(result?.failure || null), idempotent: result?.idempotent === true, recovered: result?.recovered === true,
    syntheticNotice: 'VIN/build associations are fictional; source dates, unknown fields and representative image fidelity remain unchanged.',
    message: result?.status === 'ok' ? 'The complete validated corpus is available.'
      : 'The candidate is unavailable or rejected. Any still-active complete version is shown; this is not a valid empty corpus.' };
}
