// Owned gate: no test code starts before its leader identity has been recorded.
import { spawn } from 'node:child_process';
let started = false;
process.stdin.once('data', (data) => {
  if (data.toString() !== '1' || started) process.exit(2);
  started = true;
  const child = spawn(process.execPath, process.argv.slice(2), { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  child.once('error', () => process.exit(2));
  child.once('close', (code, signal) => process.exit(signal ? 2 : code ?? 2));
});
process.stdin.once('end', () => { if (!started) process.exit(2); });
