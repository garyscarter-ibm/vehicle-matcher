import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(join(root, path), 'utf8');
const targetPath = 'apps/gcsp-web/src/styles/node-gcsp.css';
const frozenPath = 'docs/migration/FUCQ-432/source-styles.css';
const sectionPattern = /\/\* SOURCE: ([^|]+) \| sha256: ([a-f0-9]{64}) \*\/\n([\s\S]*?)\/\* END SOURCE \*\//g;

test('Angular globally loads the complete layered source assembly before app styles', () => {
  const config = JSON.parse(read('apps/gcsp-web/angular.json'));
  assert.deepEqual(config.projects['gcsp-web'].architect.build.options.styles, ['src/styles/node-gcsp.css', 'src/styles.css']);
  const target = read(targetPath);
  assert.match(target, /@layer tokens, base, kit, block;/);
  assert.match(read('apps/gcsp-web/src/styles.css'), /^@layer base \{[\s\S]*\}\s*$/, 'app compatibility styles must not mask the source kit with unlayered rules');
  const inventory = read('docs/migration/FUCQ-432/styles.md');
  const frozen = [...read(frozenPath).matchAll(sectionPattern)];
  assert.equal(frozen.length, 79, 'all frozen source sections stay available, including sheets deleted during migration');
  for (const [, sheet, hash, source] of frozen) {
    assert.equal(createHash('sha256').update(source).digest('hex'), hash, `${sheet}: frozen bytes changed`);
    assert.ok(inventory.includes(`\`${sheet.trim()}\``) && inventory.includes(hash), `${sheet}: missing inventory identity`);
    assert.ok(target.includes(`/* SOURCE: ${sheet} | sha256: ${hash} */`), `${sheet}: absent from target assembly`);
  }
  assert.doesNotMatch(target.replace(/\/\*[\s\S]*?\*\//g, ''), /@import\b/, 'the target must not leave retired/deleted source import paths at runtime');
});

test('bundled source fonts and assets resolve from the Angular stylesheet', () => {
  const css = read(targetPath).replace(/\/\*[\s\S]*?\*\//g, '');
  const assets = [...css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)].map(match => match[1]);
  assert.ok(assets.some(path => path.endsWith('.woff2')), 'source brand fonts must be bundled');
  for (const asset of assets) {
    if (/^(data:|https?:|\/|#)/.test(asset)) continue;
    assert.ok(existsSync(resolve(root, dirname(targetPath), asset)), `unresolved stylesheet asset: ${asset}`);
  }
});

function fixture(change) {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'port-ratchet-'));
  try {
    mkdirSync(join(dir, 'kit'));
    writeFileSync(join(dir, 'kit/component.ts'), "export const root = 'source-component';\n");
    writeFileSync(join(dir, 'source.css'), '.source-component { color: red; } @media (width > 1px) { .source-component.is-open { display: grid; } }\n');
    writeFileSync(join(dir, 'target.css'), '@layer kit { .source-component { color: red; } @media (width > 1px) { .source-component.is-open { display: grid; } } }\n');
    writeFileSync(join(dir, 'COMPONENTS.md'), '## Port status\n\n| Source component | Root class | Target | Status | Classes kept |\n| --- | --- | --- | --- | --- |\n| source | `.source-component` | Component | ported | yes |\n');
    const config = { version: 1, roots: ['kit/'], extensions: ['.ts'], patterns: { sentinel: { re: 'forbidden-handmade-piece', use: 'kit' } }, baseline: {}, port: { source: ['source.css'], target: ['target.css'], kit: ['kit/'], catalogue: 'COMPONENTS.md', baseline: { missing_selectors: 0, unported_components: 0 } } };
    writeFileSync(join(dir, 'ui-ratchet.json'), JSON.stringify(config));
    copyFileSync(join(root, 'server/test/ui-ratchet.test.js'), join(dir, 'ui-ratchet.test.mjs'));
    change?.(dir);
    const run = spawnSync(process.execPath, [join(dir, 'ui-ratchet.test.mjs'), '--root', dir], { encoding: 'utf8', timeout: 15000, env: process.env });
    return { status: run.status, output: run.stdout + run.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('port ratchet accepts layered selectors and a real component root', () => {
  const run = fixture(); assert.equal(run.status, 0, run.output);
});

test('port ratchet rejects a lost state selector and a false ported component', () => {
  const lost = fixture(dir => writeFileSync(join(dir, 'target.css'), '.source-component { color: red; }'));
  assert.notEqual(lost.status, 0); assert.match(lost.output, /source-component\.is-open/);
  const missingRoot = fixture(dir => writeFileSync(join(dir, 'kit/component.ts'), 'export const root = "unrelated";'));
  assert.notEqual(missingRoot.status, 0); assert.match(missingRoot.output, /root class .source-component is in none of the kit files/);
});

test('rootless utility and gallery ports require exact existing target files inside the configured kit', () => {
  const setRow = (dir, target, rootLabel = 'none (utility)') => writeFileSync(join(dir, 'COMPONENTS.md'),
    `## Port status\n\n| Source component | Root class | Target | Status | Classes kept |\n| --- | --- | --- | --- | --- |\n| utility | ${rootLabel} | \`${target}\` | ported | yes |\n`);
  assert.equal(fixture(dir => setRow(dir, 'kit/component.ts')).status, 0);
  assert.equal(fixture(dir => setRow(dir, 'kit/component.ts', 'none (gallery composition)')).status, 0);
  for (const target of ['', 'kit/missing.ts', 'kit/', './kit/component.ts', 'kit/../COMPONENTS.md', '../kit/component.ts', 'outside.ts']) {
    const run = fixture(dir => { writeFileSync(join(dir, 'outside.ts'), 'export const utility = true;'); setRow(dir, target); });
    assert.notEqual(run.status, 0, `${target}: false rootless port accepted`);
    assert.match(run.output, /rootless port.*exact target file.*configured kit/);
  }
});
