/** Read only actual canonical/OneDrive conflict rows. Never create or alter an event. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function actualEventHistory(base, allocation, state) {
  const files = readdirSync(base).filter(name => /^source-events\.jsonl(?: [2-9][0-9]*\.jsonl)?$/.test(name)).sort();
  assert.ok(files.includes('source-events.jsonl'));
  const events = new Map(); const eventBytes = new Map(); const sources = [];
  for (const file of files) {
    const bytes = readFileSync(join(base, file));
    const rawRows = bytes.toString('utf8').trim().split('\n'); const rows = rawRows.map(JSON.parse);
    sources.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), rows: rows.length });
    for (const [index, row] of rows.entries()) {
      assert.ok(Number.isInteger(row.attempt) && row.attempt >= 1 && row.attempt <= allocation.attempts);
      assert.ok(['started', 'headers-received'].includes(row.phase));
      const key = `${row.attempt}:${row.phase}`;
      if (events.has(key)) assert.equal(rawRows[index], eventBytes.get(key), 'Duplicate actual events must have identical bytes');
      else { events.set(key, row); eventBytes.set(key, rawRows[index]); }
    }
  }
  const ordered = [...events.values()].sort((a, b) => a.attempt - b.attempt || (a.phase === 'started' ? -1 : 1));
  assert.equal(ordered.length, allocation.attempts * 2);
  for (let attempt = 1; attempt <= allocation.attempts; attempt++) {
    const start = events.get(`${attempt}:started`); const header = events.get(`${attempt}:headers-received`);
    assert.ok(start && header); assert.equal(start.method, 'GET'); assert.equal(header.status, 200);
    for (const key of ['attempt', 'method', 'url', 'startedAt']) assert.equal(header[key], start[key]);
    assert.ok(Date.parse(header.at) >= Date.parse(start.startedAt));
  }
  for (const capture of state.sourceCaptures) {
    const observation = capture.solver.document.observation;
    const start = ordered.find(row => row.phase === 'started' && row.url === observation.request.url);
    assert.ok(start); const header = events.get(`${start.attempt}:headers-received`);
    assert.equal(observation.request.method, start.method);
    assert.ok(observation.responseBytes > 0 && /^[a-f0-9]{64}$/.test(observation.responseSha256));
    assert.ok(Date.parse(observation.observedAt) >= Date.parse(header.at));
  }
  return { events: ordered, sources };
}
