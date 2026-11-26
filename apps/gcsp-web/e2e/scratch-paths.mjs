import assert from 'node:assert/strict';
import { lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

export function local(value, { inspect = lstatSync, readlink = readlinkSync } = {}) {
  assert.ok(path.isAbsolute(value), 'Composition paths must be absolute');
  assert.ok(!/CloudStorage|OneDrive/i.test(value), 'Synced paths are forbidden before any filesystem inspection');
  let pending = path.resolve(value).split(path.sep).filter(Boolean);
  let resolved = path.sep; let links = 0;
  while (pending.length) {
    resolved = path.join(resolved, pending.shift());
    assert.ok(!/CloudStorage|OneDrive/i.test(resolved));
    let item;
    try { item = inspect(resolved); } catch (error) {
      if (error.code === 'ENOENT') return path.join(resolved, ...pending);
      throw error;
    }
    if (item.isSymbolicLink()) {
      assert.ok(++links <= 32);
      const target = path.resolve(path.dirname(resolved), readlink(resolved));
      assert.ok(!/CloudStorage|OneDrive/i.test(target), 'Reject the link target before following it');
      pending = [...target.split(path.sep).filter(Boolean), ...pending]; resolved = path.sep;
    }
  }
  return resolved;
}

export function localScratch(value, { platform = process.platform, temporaryDirectory = tmpdir(), ...filesystem } = {}) {
  const scratch = local(value, filesystem);
  // Match test_resources.Scratch: Darwin avoids long TMPDIR paths; Linux uses the native temp directory.
  const temporaryRoot = local(platform === 'darwin' ? '/private/tmp' : temporaryDirectory, filesystem);
  const relative = path.relative(temporaryRoot, scratch);
  // On Linux the supervisor rewrites TMPDIR to this owned scratch root before launching us.
  const inside = relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  assert.ok(inside || (platform !== 'darwin' && relative === ''), 'Scratch must use the supervisor native local temporary directory');
  return scratch;
}
