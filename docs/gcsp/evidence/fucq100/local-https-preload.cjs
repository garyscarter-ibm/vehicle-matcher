// Exact certificate-child instrumentation; loaded after the existing CJS guard.
const fs = require('node:fs');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(process.env.FUCQ100_COMPOSITION_CONFIG);
if (digest(bytes) !== process.env.FUCQ100_COMPOSITION_CONFIG_SHA256) throw Error('TLS instrumentation configuration drift.');
const config = JSON.parse(bytes); const spec = config.certificate;
const original = cp.execFile;
let calls = 0;
function record(row) {
  const line = JSON.stringify({ kind: 'node-child-handle', nodePid: process.pid, epochMs: Date.now(), ...row }) + '\n';
  if ((fs.existsSync(spec.journal) ? fs.statSync(spec.journal).size : 0) + Buffer.byteLength(line) > 65536)
    throw Error('Certificate journal bound.');
  fs.appendFileSync(spec.journal, line, { mode: 0o600 });
}
cp.execFile = function (file, args, options, callback) {
  if (file !== '/usr/bin/openssl' || ++calls !== 1 || options?.timeout !== 10000 || options?.maxBuffer !== 8192
      || typeof callback !== 'function' || !Array.isArray(args)) throw Error('Unadmitted subprocess.');
  for (const [path, pin] of Object.entries(spec.pins)) {
    const stat = fs.statSync(path);
    if (fs.realpathSync(path) !== pin.realpath || stat.dev !== pin.device || stat.ino !== pin.inode
        || fs.lstatSync(path).isSymbolicLink() !== pin.symlink || digest(fs.readFileSync(path)) !== pin.sha256)
      throw Error('Certificate helper/executable drift.');
  }
  // Python and Node exchange only Unix epoch milliseconds. Each converts its
  // remaining work deadline once to its own local monotonic timer.
  const left = Math.floor(spec.workDeadlineEpochMs - Date.now());
  if (left <= 0 || left > 120000) throw Error('TLS work clock outside admitted interval.');
  const child = original.call(this, spec.python, ['-I', spec.broker, '--broker', ...args],
    { ...options, timeout: Math.min(10000, left) }, callback);
  record({ brokerPid: child.pid, state: 'node-created' });
  child.once('close', (code, signal) => record({ brokerPid: child.pid, state: 'node-joined', code, signal }));
  // The retained ChildProcess's close event is execFile's callback boundary.
  // Broker wait4/join evidence is checked separately by the outer supervisor.
  return child;
};
syncBuiltinESMExports();
