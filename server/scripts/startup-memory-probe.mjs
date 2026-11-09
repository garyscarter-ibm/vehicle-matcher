// Preloaded by startup-memory-check.mjs: on exit, records this process's peak resident set (ru_maxrss).
import { writeFileSync } from 'node:fs';

const out = process.env.GCSP_STARTUP_MEMORY_REPORT;
if (out) process.once('exit', () => writeFileSync(out, JSON.stringify({ maxRssBytes: process.resourceUsage().maxRSS * 1024 })));
