import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { projectSelector } from './selector.mjs';
const base = path.dirname(fileURLToPath(import.meta.url));

test('keeps literal exact-origin route facts and repeated source offsets only', () => {
  const a = 'https://configure.bmw.co.uk/en_GB/configure/G20/3ABC';
  const b = 'https://configure.bmw.co.uk/en_GB/configure/G60E/I5AB';
  const html = `<a href="${a}">Private surrounding text</a><script>"${b}"</script><a href='${a}'>repeat</a>`;
  const actual = projectSelector(html);
  assert.deepEqual(actual.leads.map(r => [r.url,r.catalogueRangeKey,r.pageModelCode,r.occurrences.length]), [[a,'G20','3ABC',2],[b,'G60E','I5AB',1]]);
  assert.equal(actual.leads[0].occurrences[0].characterOffset, html.indexOf(a));
  assert.equal(JSON.stringify(actual).includes('Private surrounding text'), false);
  assert.equal(actual.modelRegistrationsQualified, 0); assert.equal(actual.schemeJoinsQualified, 0);
});
test('refuses poisoned hosts, encoded/invented routes, partial codes and query-bearing links', () => {
  const html = [
    'https://configure.bmw.co.uk.evil.test/en_GB/configure/G20/3ABC',
    'https://evil.test/en_GB/configure/G20/3ABC',
    'https://configure.bmw.co.uk/en_GB/configure/g20/3abc',
    'https:\\/\\/configure.bmw.co.uk\\/en_GB\\/configure\\/G20\\/3ABC',
    'https://configure.bmw.co.uk/en_GB/configure/G20/ABCDEFGHIJKLM',
    'https://configure.bmw.co.uk/en_GB/configure/G20/3ABC?secret=value',
  ].map(s => `<a href="${s}">ignored</a>`).join('');
  const actual = projectSelector(html);
  assert.deepEqual(actual.leads, []); assert.equal(actual.status, 'no-literal-configurator-leads-in-this-response');
});
test('fails closed at byte, unique-lead and occurrence caps', () => {
  assert.throws(() => projectSelector('a'.repeat(2097153)), /input-limit/);
  const literal = 'https://configure.bmw.co.uk/en_GB/configure/G20/3ABC';
  assert.throws(() => projectSelector(`"${literal}" "${literal}"`, 128, 1), /occurrence-limit/);
  assert.throws(() => projectSelector(`"${literal}" "https://configure.bmw.co.uk/en_GB/configure/G60E/I5AB"`, 1), /lead-limit/);
});
test('entrypoints refuse absent source grants before allocating or attempting network', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(base,'execution-plan.json'),'utf8'));
  const before = fs.existsSync(plan.outputRoot);
  const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_GB.UTF-8', TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  for (const [runtime,script] of [[process.execPath,'run-live.mjs'],['/usr/bin/python3','supervise.py']]) {
    assert.throws(() => execFileSync(runtime,[...(script.endsWith('.py')?['-I','-B']:[]),path.join(base,script),'live'],{env,stdio:'pipe',timeout:10000}), error => {
      assert.match(String(error.stderr), /exact-parent-selector-grant-required/); return true;
    });
  }
  assert.equal(fs.existsSync(plan.outputRoot), before);
});
