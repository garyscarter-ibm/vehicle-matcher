// FUCQ-164: sample a fresh file's identity about every millisecond to see ctime bursts.
// Usage: node burst.mjs <owned-root> <seconds> <mb>
import { closeSync, fsyncSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
const [root, seconds = '9', mb = '6'] = process.argv.slice(2);
mkdirSync(root, { recursive: true });
const path = join(root, `burst-${Date.now()}.jsonl`);
const fd = openSync(path, 'wx', 0o600); const line = JSON.stringify({ pad: 'x'.repeat(15990) }) + '\n';
for (let i = 0; i < Math.round(Number(mb) * 65.536); i++) writeSync(fd, line);
fsyncSync(fd); closeSync(fd);
const t0 = process.hrtime.bigint(); const ms = () => Number((process.hrtime.bigint() - t0) / 1000n) / 1000;
const keys = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']; let last = null; const events = []; let samples = 0;
const end = Date.now() + Number(seconds) * 1000;
while (Date.now() < end) {
  const s = statSync(path, { bigint: true }); samples++;
  const cur = Object.fromEntries(keys.map((k) => [k, String(s[k])]));
  if (last) { const changed = keys.filter((k) => cur[k] !== last[k]); if (changed.length) events.push({ t: ms(), changed }); }
  last = cur;
}
const gaps = events.slice(1).map((e, i) => +(e.t - events[i].t).toFixed(3));
process.stdout.write(JSON.stringify({ samples, events, minGapMs: gaps.length ? Math.min(...gaps) : null, gaps }) + '\n');
