// FUCQ-164 mechanism repro: identical bytes, ctime-only metadata changes from another process
// while the indexed loader reads. Usage: node repro.mjs <owned-root> <worktree> <mb> <intervalMs> <mode:local|fresh>
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const [root, worktree, mb = '12', intervalMs = '0', mode = 'local'] = process.argv.slice(2);
const { indexJsonl } = await import(join(worktree, 'server/gcsp/vehicle-evidence/indexed-jsonl.js'));
mkdirSync(root, { recursive: true });
const path = join(root, `configurations-${Date.now()}.jsonl`);
const rowCount = Math.round(Number(mb) * 1024 * 1024 / 16000);
const fd = openSync(path, 'wx', 0o600); const hash = createHash('sha256');
for (let i = 0; i < rowCount; i++) { const line = JSON.stringify({ configurationId: `c-${i}`, pad: 'x'.repeat(15960) }) + '\n'; writeSync(fd, line); hash.update(line); }
fsyncSync(fd); closeSync(fd); const t0 = Date.now();
let toucher;
// Simulated file-provider metadata writer: an xattr write bumps ctime only.
if (Number(intervalMs) > 0) toucher = spawn('/bin/sh', ['-c', `while :; do /usr/bin/xattr -w com.example.fucq164 $$RANDOM "${path}"; sleep ${Number(intervalMs) / 1000}; done`], { stdio: 'ignore' });
if (toucher) await new Promise((r) => setTimeout(r, 150));
const loopUntil = Date.now() + Number(process.argv[8] || 0) * 1000;
const workMs = Number(process.argv[7] || 0); const busy = () => { const end = Date.now() + workMs; while (Date.now() < end); };
const result = { path, rows: rowCount, bytes: rowCount * 16000, sha256: hash.digest('hex'), mode, intervalMs: Number(intervalMs) };
try {
  const idx = await indexJsonl(path, { key: (r) => r.configurationId, maxRows: 100000 });
  result.indexedChecksumMatches = idx.checksum === result.sha256;
  let read = 0; do { for (const e of idx.metadataEntries()) { idx.get(e.key); busy(); read++; } } while (Date.now() < loopUntil);
  result.status = 'ok'; result.read = read;
} catch (e) { result.status = 'failed'; result.code = e.code; result.message = e.message; result.detail = e.detail; }
result.ms = Date.now() - t0;
toucher?.kill('SIGKILL');
process.stdout.write(JSON.stringify(result) + '\n');
