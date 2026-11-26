import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { local, localScratch } from './scratch-paths.mjs';

// Synthetic host paths keep cross-platform and forbidden-target checks off the real filesystem.
function filesystem(links = {}, missing = new Set()) {
  const inspected = [];
  return {
    inspected,
    inspect(value) {
      assert.ok(!/CloudStorage|OneDrive/i.test(value), 'Never inspect a synced path');
      inspected.push(value);
      if (missing.has(value)) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
      return { isSymbolicLink: () => Object.hasOwn(links, value) };
    },
    readlink(value) { return links[value]; },
  };
}

for (const [name, value, platform, temporaryDirectory, expected, links] of [
  ['macOS canonical root', '/private/tmp/run-1', 'darwin', '/private/tmp/run-1', '/private/tmp/run-1', {}],
  ['macOS /tmp alias', '/tmp/run-1', 'darwin', '/private/tmp/run-1', '/private/tmp/run-1', { '/tmp': '/private/tmp' }],
  ['Linux /tmp root', '/tmp/run-1', 'linux', '/tmp', '/tmp/run-1', {}],
  ['Linux supervisor-rewritten TMPDIR', '/tmp/outer/run-1', 'linux', '/tmp/outer/run-1', '/tmp/outer/run-1', {}],
  ['Linux alternate native root', '/var/tmp/run-1', 'linux', '/var/tmp', '/var/tmp/run-1', {}],
  ['Linux native root alias', '/tmp/run-1', 'linux', '/native-tmp', '/tmp/run-1', { '/native-tmp': '/tmp' }],
]) {
  test(`accepts ${name}`, () => {
    assert.equal(localScratch(value, { ...filesystem(links), platform, temporaryDirectory }), expected);
  });
}

for (const value of ['', 'relative/run', '/tmp/OneDrive/run', '/Users/example/Library/CloudStorage/run', '/tmp/oNeDrIvE/run']) {
  test(`rejects unsafe original path before inspection: ${JSON.stringify(value)}`, () => {
    const fs = filesystem();
    assert.throws(() => localScratch(value, { ...fs, platform: 'linux', temporaryDirectory: '/tmp' }));
    assert.deepEqual(fs.inspected, []);
  });
}

for (const temporaryDirectory of ['relative', '/tmp/OneDrive', '/Users/example/Library/CloudStorage']) {
  test(`rejects unsafe native temporary directory: ${temporaryDirectory}`, () => {
    const fs = filesystem();
    assert.throws(() => localScratch('/tmp/run-1', { ...fs, platform: 'linux', temporaryDirectory }));
    assert.ok(fs.inspected.every((value) => !/CloudStorage|OneDrive/i.test(value)));
  });
}

for (const [platform, temporaryDirectory, value] of [
  ['darwin', '/private/tmp/owned', '/var/tmp/run-1'],
  ['darwin', '/private/tmp/owned', '/private/tmp-sibling/run-1'],
  ['darwin', '/private/tmp/owned', '/private/tmp'],
  ['linux', '/tmp', '/tmp-sibling/run-1'],
  ['linux', '/tmp', '/var/tmp/run-1'],
  ['linux', '/tmp/outer', '/tmp/outer/../outside'],
]) {
  test(`rejects scratch outside ${platform} native temporary root: ${value}`, () => {
    assert.throws(() => localScratch(value, { ...filesystem(), platform, temporaryDirectory }));
  });
}

for (const target of ['/Users/example/OneDrive/run', '/Users/example/Library/CloudStorage/run']) {
  test(`rejects unsafe symlink target before following: ${target}`, () => {
    const fs = filesystem({ '/tmp/link': target });
    assert.throws(() => localScratch('/tmp/link/child', { ...fs, platform: 'linux', temporaryDirectory: '/tmp' }));
    assert.deepEqual(fs.inspected, ['/tmp', '/tmp/link']);
  });
}

test('checks symlink targets against native temp containment', () => {
  assert.throws(() => localScratch('/tmp/link/run-1', {
    ...filesystem({ '/tmp/link': '/outside' }), platform: 'linux', temporaryDirectory: '/tmp',
  }));
});

test('inspects the native temporary directory symlink target safely', () => {
  const fs = filesystem({ '/native-tmp': '/Users/example/OneDrive' });
  assert.throws(() => localScratch('/tmp/run-1', { ...fs, platform: 'linux', temporaryDirectory: '/native-tmp' }));
  assert.ok(!fs.inspected.includes('/Users'));
});

test('retains bounded symlink traversal', () => {
  assert.throws(() => local('/tmp/loop', filesystem({ '/tmp/loop': '/tmp/loop' })));
});

test('returns an unresolved missing suffix without inspecting deeper paths', () => {
  const fs = filesystem({}, new Set(['/tmp/missing']));
  assert.equal(local('/tmp/missing/child', fs), '/tmp/missing/child');
  assert.deepEqual(fs.inspected, ['/tmp', '/tmp/missing']);
});

test('propagates filesystem failures other than a missing path', () => {
  assert.throws(() => local('/tmp/run-1', {
    inspect() { throw Object.assign(new Error('Permission denied'), { code: 'EACCES' }); },
  }), { code: 'EACCES' });
});

test('resolves a real relative symlink inside supervisor-owned scratch', () => {
  const root = process.env.TMPDIR;
  assert.ok(path.isAbsolute(root), 'Run this test with owned TMPDIR/TMP/TEMP');
  const target = path.join(root, 'guard-target');
  const alias = path.join(root, 'guard-alias');
  mkdirSync(target);
  symlinkSync('guard-target', alias);
  assert.equal(localScratch(alias, { platform: process.platform, temporaryDirectory: root }), target);
});
