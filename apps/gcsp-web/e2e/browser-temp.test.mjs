import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { prepareBrowserTemp } from './browser-temp.mjs';

function fixture(t) {
  assert.ok(path.isAbsolute(process.env.TMPDIR), 'Use supervisor-owned TMPDIR');
  const root = path.join(process.env.TMPDIR, t.name.replaceAll(/[^a-z0-9]/gi, '-'));
  mkdirSync(root);
  const base = path.join(root, 'native');
  const scratch = path.join(root, 'outer', 'inner');
  const output = path.join(root, 'receipts');
  mkdirSync(base); mkdirSync(scratch, { recursive: true }); mkdirSync(output);
  return { root, base, scratch, output, options: { scratch, output, platform: 'linux', temporaryDirectory: base,
    env: { PROOF_SOURCE_REVISION: 'fixed-source', PROOF_RUN_TOKEN: 'fixed-run', TMPDIR: scratch, KEEP: 'yes' } } };
}
const read = (temp) => JSON.parse(readFileSync(temp.manifest, 'utf8'));

test('Linux owns a short separate namespace and preserves profile launch options', async (t) => {
  const f = fixture(t); const temp = await prepareBrowserTemp(f.options);
  try {
    const record = read(temp);
    assert.equal(record.schema, 'gcsp-browser-temp/1'); assert.match(record.token, /^[a-f0-9]{32}$/);
    assert.equal(record.root, path.join(f.base, 'gcsp-b-' + record.token));
    assert.equal(record.base, f.base); assert.equal(record.scratch, f.scratch);
    assert.equal(record.source_revision, 'fixed-source'); assert.equal(record.run_id, 'fixed-run');
    assert.equal(record.owner_pid, process.pid); assert.equal(record.state, 'active');
    assert.equal(record.device, lstatSync(record.root).dev); assert.equal(record.inode, lstatSync(record.root).ino);
    assert.equal(lstatSync(record.root).mode & 0o777, 0o700);
    const options = { args: ['--user-data-dir=existing-profile'], downloadsPath: 'existing-downloads', timeout: 123, env: { EXTRA: 'value' } };
    const adjusted = temp.launchOptions(options);
    assert.deepEqual(adjusted.args, options.args); assert.equal(adjusted.downloadsPath, options.downloadsPath);
    assert.equal(adjusted.timeout, 123); assert.equal(adjusted.env.EXTRA, 'value'); assert.equal(adjusted.env.KEEP, 'yes');
    for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(adjusted.env[key], record.root);
    assert.equal(options.env.TMPDIR, undefined);
    writeFileSync(path.join(record.root, 'data'), 'owned bytes');
    assert.ok(temp.snapshot().peak_bytes >= 11);
  } finally { await temp.close(); }
  assert.equal(read(temp).state, 'removed'); assert.equal(existsSync(read(temp).root), false);
  await temp.close();
});

test('Darwin passes the exact launch options through and allocates nothing', async () => {
  const temp = await prepareBrowserTemp({ platform: 'darwin' });
  const options = { env: { TMPDIR: 'unchanged' }, args: ['existing'] };
  assert.equal(temp.launchOptions(options), options); assert.equal(temp.manifest, null);
  assert.equal(temp.snapshot(), null); await temp.close();
});

test('separate preparations have isolated roots and manifests', async (t) => {
  const f = fixture(t); const first = await prepareBrowserTemp(f.options); const second = await prepareBrowserTemp(f.options);
  try { assert.notEqual(read(first).root, read(second).root); assert.notEqual(first.manifest, second.manifest); }
  finally { await first.close(); await second.close(); }
});

test('unverified browser exit preserves namespace for supervisor recovery', async (t) => {
  const f = fixture(t); const temp = await prepareBrowserTemp(f.options);
  await temp.close({ browserStopped: false });
  assert.equal(read(temp).state, 'cleanup-pending'); assert.equal(existsSync(read(temp).root), true);
  await temp.close(); assert.equal(read(temp).state, 'removed');
});

test('replaced root is retained without following its symlink', async (t) => {
  const f = fixture(t); const temp = await prepareBrowserTemp(f.options); const root = read(temp).root;
  const moved = path.join(f.base, 'original'); renameSync(root, moved); symlinkSync(moved, root);
  await assert.rejects(() => temp.close(), /identity|symlink/);
  assert.equal(read(temp).state, 'cleanup-pending'); assert.equal(existsSync(moved), true);
  rmSync(root); renameSync(moved, root); await temp.close();
});

test('allocated bytes do not follow links outside the namespace', async (t) => {
  const f = fixture(t); const temp = await prepareBrowserTemp(f.options); const root = read(temp).root;
  writeFileSync(path.join(f.scratch, 'outside'), Buffer.alloc(65536)); symlinkSync(path.join(f.scratch, 'outside'), path.join(root, 'alias'));
  try { assert.ok(temp.snapshot().peak_bytes < 65536); }
  finally { await temp.close(); }
  assert.equal(existsSync(path.join(f.scratch, 'outside')), true);
});

for (const key of ['scratch', 'output', 'temporaryDirectory']) {
  for (const value of ['relative', '/tmp/OneDrive/forbidden', '/Users/example/Library/CloudStorage/forbidden']) {
    test(`rejects unsafe ${key} ${value}`, async (t) => {
      const f = fixture(t);
      await assert.rejects(() => prepareBrowserTemp({ ...f.options, [key]: value }), /absolute|Synced/);
      assert.equal(existsSync(path.join(f.output, 'browser-temp-ownership')), false);
    });
  }
}

test('rejects a forbidden native symlink target before following it', async (t) => {
  const f = fixture(t); const alias = path.join(f.root, 'alias');
  symlinkSync('/Users/example/Library/CloudStorage/forbidden', alias);
  await assert.rejects(() => prepareBrowserTemp({ ...f.options, temporaryDirectory: alias }), /link target/);
  assert.equal(existsSync(path.join(f.output, 'browser-temp-ownership')), false);
});

// Observe the real allocation syscall; the delegate still creates every fixture on disk.
for (const collision of [false, true]) {
  test(`journals ownership before allocation, collision=${collision}`, async (t) => {
    const f = fixture(t); const original = fs.mkdirSync; let planned; let allocatedRoot;
    fs.mkdirSync = (directory, options) => {
      if (path.dirname(directory) === f.base && path.basename(directory).startsWith('gcsp-b-')) {
        allocatedRoot = directory;
        const token = path.basename(directory).slice('gcsp-b-'.length);
        planned = JSON.parse(readFileSync(path.join(f.output, 'browser-temp-ownership', token + '.json'), 'utf8'));
        assert.equal(planned.state, 'planned'); assert.equal(planned.root, directory);
        if (collision) { original(directory, options); writeFileSync(path.join(directory, 'unowned'), 'preserve'); }
      }
      return original(directory, options);
    };
    syncBuiltinESMExports();
    let temp;
    try {
      if (collision) await assert.rejects(() => prepareBrowserTemp(f.options), { code: 'EEXIST' });
      else temp = await prepareBrowserTemp(f.options);
    } finally { fs.mkdirSync = original; syncBuiltinESMExports(); }
    assert.ok(planned);
    if (collision) {
      assert.equal(readFileSync(path.join(allocatedRoot, 'unowned'), 'utf8'), 'preserve');
      assert.equal(JSON.parse(readFileSync(path.join(f.output, 'browser-temp-ownership', planned.token + '.json'), 'utf8')).state, 'planned');
      // The supervisor owns this deliberately colliding fixture, unlike production collision roots.
    } else await temp.close();
  });
}

test('uses captured native base despite rewritten TMPDIR and canonicalizes its alias', async (t) => {
  const f = fixture(t); const alias = path.join(f.root, 'native-alias'); symlinkSync(f.base, alias);
  const temp = await prepareBrowserTemp({ ...f.options, temporaryDirectory: undefined,
    env: { ...f.options.env, GCSP_E2E_NATIVE_TMPDIR: alias } });
  try { assert.equal(read(temp).base, f.base); assert.equal(path.dirname(read(temp).root), f.base); }
  finally { await temp.close(); }
});

test('refuses to remove a replacement directory with a different inode', async (t) => {
  const f = fixture(t); const temp = await prepareBrowserTemp(f.options); const root = read(temp).root;
  const moved = path.join(f.base, 'original'); renameSync(root, moved); mkdirSync(root);
  writeFileSync(path.join(root, 'unowned'), 'preserve');
  await assert.rejects(() => temp.close(), /identity/);
  assert.equal(read(temp).state, 'cleanup-pending'); assert.equal(readFileSync(path.join(root, 'unowned'), 'utf8'), 'preserve');
  rmSync(root, { recursive: true }); renameSync(moved, root); await temp.close();
});
