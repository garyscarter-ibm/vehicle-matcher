// Prepared offline proof support; no source provider or publication port is installed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

export const packetRoot = fileURLToPath(new URL('./', import.meta.url));
export const worktree = fileURLToPath(new URL('../../../../../', import.meta.url));
export const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object'
  && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
export const canonicalSha = value => sha(canonical(value));
export const environment = () => ({ node: process.version, platform: process.platform, arch: process.arch, offline: true });
export async function checkPin(pin) {
  assert.equal((await stat(pin.path)).size, pin.bytes, 'Pinned size: ' + pin.path);
  assert.equal(sha(await readFile(pin.path)), pin.sha256, 'Pinned bytes: ' + pin.path);
}
export async function atomic(path, value) {
  const temporary = path + '.writing';
  await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
export async function loadPacket() {
  const planBytes = await readFile(join(packetRoot, 'plan.json'));
  const plan = JSON.parse(planBytes); const planSha256 = sha(planBytes);
  assert.equal(process.env.REVIEWED_F60_PLAN_SHA256, planSha256);
  assert.equal(resolve(worktree), plan.executionWorktree);
  assert.deepEqual(environment(), plan.environment);
  for (const pin of plan.codePins) await checkPin(pin);
  await checkPin(plan.selectionManifest);
  const manifest = JSON.parse(await readFile(plan.selectionManifest.path));
  assert.equal(manifest.entries.length, 10000);
  assert.equal(new Set(manifest.entries.map(row => row.configurationId)).size, 10000);
  assert.equal(canonicalSha(plan.codePins), plan.codeIdentity);
  return { plan, planSha256, manifest };
}
export async function originalRow(manifest, entry) {
  const pin = manifest.sourceFiles[entry.sourceFileIndex];
  assert.ok(pin && ['json', 'jsonl'].includes(pin.format));
  assert.equal((await stat(pin.path)).size, pin.bytes);
  assert.ok(Number.isSafeInteger(entry.sourceByteOffset) && entry.sourceByteOffset >= 0);
  assert.ok(Number.isSafeInteger(entry.sourceByteLength) && entry.sourceByteLength > 0
    && entry.sourceByteLength <= 128 * 1024 && entry.sourceByteOffset + entry.sourceByteLength <= pin.bytes);
  const file = await open(pin.path, 'r'); const bytes = Buffer.alloc(entry.sourceByteLength);
  try { assert.equal((await file.read(bytes, 0, bytes.length, entry.sourceByteOffset)).bytesRead, bytes.length); }
  finally { await file.close(); }
  assert.equal(sha(bytes), entry.sourceRowSha256, 'Externally sealed raw accepted row');
  const row = JSON.parse(bytes); const binding = row.catalogue.sourceBinding;
  assert.equal(row.configurationId, entry.configurationId);
  assert.equal(sha(row.configurationId), entry.configurationIdSha256);
  assert.equal(row.catalogue.schemaVersion, entry.sourceSchemaVersion);
  assert.equal(row.lookupIdentity.snapshotVersion, entry.snapshotVersion);
  assert.equal(row.lookupIdentity.bindingDigest, entry.bindingDigest);
  for (const [field, value] of [
    ['sourceCanonicalIdentityCanonicalJsonSha256', row.canonicalIdentity],
    ['sourceCatalogueCanonicalJsonSha256', row.catalogue],
    ['completeSelectedElementsCanonicalJsonSha256', row.selectedElements],
    ['sourceBindingSelectionCanonicalJsonSha256', binding.selection],
  ]) assert.equal(canonicalSha(value), entry[field], field);
  return row;
}
export function denyAllNetwork() {
  const attempts = { fetch: 0, http: 0, https: 0, net: 0, tls: 0 }; const restores = [];
  function deny(target, name, kind) {
    const original = target[name];
    target[name] = () => { attempts[kind] += 1; throw new Error('Offline F60 proof denies ' + kind); };
    restores.push(() => { target[name] = original; });
  }
  deny(globalThis, 'fetch', 'fetch');
  for (const name of ['request', 'get']) { deny(http, name, 'http'); deny(https, name, 'https'); }
  for (const name of ['connect', 'createConnection']) deny(net, name, 'net');
  deny(net.Socket.prototype, 'connect', 'net'); deny(tls, 'connect', 'tls'); syncBuiltinESMExports();
  return { attempts, restore() { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); } };
}
