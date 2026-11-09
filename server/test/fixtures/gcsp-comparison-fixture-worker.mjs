import { parentPort, workerData } from 'node:worker_threads';

// Test double for the comparison worker: posts a plan, then throws, hangs or exhausts its heap.
parentPort.postMessage({ type: 'plan', steps: 6, seeds: ['a', 'b', 'c'], arms: ['process'] });
if (workerData.mode === 'throw') throw new Error('postgres://secret-host failed');
if (workerData.mode === 'oom') { const hold = []; for (;;) hold.push(new Array(1e5).fill(Math.random())); }
setInterval(() => {}, 1000);
