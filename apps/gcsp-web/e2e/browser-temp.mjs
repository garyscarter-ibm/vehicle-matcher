import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { linkSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { local } from './scratch-paths.mjs';

// Chromium's Linux SingletonSocket must fit a Unix socket path even when SCRATCH is deeply nested.
// Keep its temporary files in an independently journalled namespace, never in an unowned shared root.
export async function prepareBrowserTemp({ scratch, output, env = process.env, platform = process.platform,
  temporaryDirectory = env.GCSP_E2E_NATIVE_TMPDIR ?? '/tmp' } = {}) {
  if (platform !== 'linux') return { manifest: null, launchOptions: (options) => options, snapshot: () => null, close: async () => {} };
  // Validate every supplied path before creating any output or browser files.
  const canonicalScratch = local(scratch);
  const canonicalOutput = local(output);
  const base = local(temporaryDirectory);
  const token = randomBytes(16).toString('hex');
  const root = path.join(base, 'gcsp-b-' + token);
  const ownership = local(path.join(canonicalOutput, 'browser-temp-ownership'));
  const manifest = path.join(ownership, token + '.json');
  const record = { schema: 'gcsp-browser-temp/1', token, root, base, scratch: canonicalScratch,
    source_revision: env.PROOF_SOURCE_REVISION ?? null, run_id: env.PROOF_RUN_TOKEN ?? null,
    owner_pid: process.pid, state: 'planned', peak_bytes: 0 };
  mkdirSync(ownership, { recursive: true, mode: 0o700 });
  function journal(initial = false) {
    const next = manifest + '.next';
    writeFileSync(next, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    try {
      // A hard link gives the first publication exclusive, atomic create semantics.
      if (initial) { linkSync(next, manifest); unlinkSync(next); }
      else renameSync(next, manifest);
    } catch (error) { unlinkSync(next); throw error; }
  }
  journal(true); // The external ownership record exists before allocation.
  mkdirSync(root, { mode: 0o700 }); // Never adopt or remove a colliding pre-existing root.
  const allocated = lstatSync(root);
  assert.ok(allocated.isDirectory() && !allocated.isSymbolicLink());
  Object.assign(record, { state: 'active', device: allocated.dev, inode: allocated.ino });
  journal();
  function ownedIdentity() {
    // Revalidate parent links before any access; local rejects forbidden targets before following them.
    assert.equal(local(base), base, 'Browser temp base identity path changed');
    let current;
    try { current = lstatSync(root); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    assert.ok(!current.isSymbolicLink(), 'Browser temp root became a symlink');
    assert.ok(current.isDirectory() && current.dev === record.device && current.ino === record.inode,
      'Browser temp root identity changed');
    return current;
  }
  function allocatedBytes(directory) {
    let bytes = 0;
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      // Inspect links themselves, never their targets (Chromium creates SingletonSocket links).
      const item = lstatSync(file);
      bytes += Math.max(item.size, item.blocks * 512);
      if (item.isDirectory() && !item.isSymbolicLink()) bytes += allocatedBytes(file);
    }
    return bytes;
  }
  function snapshot() {
    if (record.state !== 'removed' && ownedIdentity()) record.peak_bytes = Math.max(record.peak_bytes, allocatedBytes(root));
    return { ...record };
  }
  async function close({ browserStopped = true } = {}) {
    if (record.state === 'removed') return;
    try {
      snapshot();
      if (!browserStopped) { record.state = 'cleanup-pending'; journal(); return; }
      if (ownedIdentity()) rmSync(root, { recursive: true });
      let remains = false;
      try { lstatSync(root); remains = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      assert.equal(remains, false, 'Browser temp cleanup incomplete');
      record.state = 'removed'; journal();
    } catch (error) { record.state = 'cleanup-pending'; journal(); throw error; }
  }
  return { manifest, snapshot, close,
    launchOptions(options) { return { ...options, env: { ...env, ...options.env, TMPDIR: root, TMP: root, TEMP: root } }; } };
}
