#!/usr/bin/env python3
"""Bounded FUCQ-103 preparation or one separately authorised browser chunk."""
import ast
import atexit
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-080')
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G
import test_resources as R
import importlib.util
strict_path = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-supervisor.py'
spec = importlib.util.spec_from_file_location('f100_strict_budget', strict_path)
strict = importlib.util.module_from_spec(spec); spec.loader.exec_module(strict)
strict.install_strict_budget(R)

class RawAllBudget(R.HostBudget):
    def _capacity(self, rows, free, memory):
        if memory is None: raise R.ResourceError('Measured host RAM unavailable')
        # Charge every raw row; no dead-owner pruning, parent exemption or reconciliation.
        disk = max(0, free - self.policy.reserve - sum(max(0, row['disk']-row['used']) for row in rows.values()))
        ram = max(0, memory - int(self.policy.ram_reserve_mib * R.MIB)
                  - sum(max(0, row['ram']-row['rss']) for row in rows.values()))
        capacity = {'free': free, 'disk': disk, 'ram': ram, 'active': len(rows), 'low': free < self.policy.preferred, 'parent': None}
        if hasattr(self, 'audit'): self.audit.append({'at': time.time(), 'rawRows': len(rows), 'capacity': capacity})
        return capacity
R.HostBudget = RawAllBudget


BASE = 'd644288865f2dc799dd539be6429ee05833ed555'
MODES = ('offer-single-browser',)
EXECUTABLE = {'.js', '.mjs', '.cjs', '.py', '.sh', '.html', '.css', '.json',
              '.svg', '.webp', '.png', '.jpg', '.jpeg', '.woff', '.woff2', '.pem'}
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq105/current-https-2028')


def git(*args):
    with G.checkout_mutex(ROOT):
        rc, out, err = G.git(ROOT, list(args))
    if rc:
        raise R.ResourceError('Git read failed: ' + err[:1000])
    return out.strip()


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def source_identity(plan_path, browser, adopted=()):
    plan = json.loads(plan_path.read_text())
    for absolute, expected in plan['allFiles'].items():
        path = Path(absolute)
        if not path.is_file() or digest(path) != expected:
            raise R.ResourceError('Current source/input/environment identity mismatch: ' + absolute)
    membership = sorted(str(path) for base in plan['sourceRoots'] for path in Path(base).rglob('*')
                        if path.is_file() and 'node_modules' not in path.parts)
    if membership != plan['sourceMembership']:
        raise R.ResourceError('Current source membership changed')
    return {'allFiles': plan['allFiles'], 'executables': plan['executables'],
            'sourcePlanSha256': digest(plan_path), 'productSource': plan['productSource']}


def snapshot():
    result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,lstart=,command='],
                            capture_output=True, text=True, timeout=4, check=True)
    rows = {}
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 9)
        if len(parts) != 10 or not all(part.isdigit() for part in parts[:4]):
            raise R.ResourceError('Cannot parse complete process ownership snapshot')
        pid, ppid, pgid, rss = map(int, parts[:4])
        rows[pid] = dict(pid=pid, ppid=ppid, pgid=pgid, rss=rss * 1024,
                         start=' '.join(parts[4:9]), command=parts[9])
    return rows


def same_process(identity):
    start = R.process_identity(identity['pid'])
    return start is not None and ' '.join(start.split()) == identity['start']


class Supervisor:
    def __init__(self, mode):
        self.mode = mode
        self.browser = mode != 'prep'
        self.run = mode + '-' + uuid.uuid4().hex
        self.retained = SHARED / self.run
        self.receipt = self.retained / 'receipt.json'
        self.manifest = SHARED / 'ownership' / (self.run + '.json')
        self.output = self.retained / 'output'
        self.log = self.retained / 'run.log'
        self.ledger = self.retained / 'process-ledger.json'
        self.policy = R.Policy({'chunk_seconds': 240, 'chunk_scratch_mib': 128,
                                'chunk_ram_mib': 2560 if self.browser else 512, 'log_mib': 2,
                                'local_scratch_reason': 'OneDrive unavailable; bounded local Chrome profile/IPC compatibility working set; small local retained evidence.'})
        self.host = R.HostBudget(self.policy)
        self.host.audit = []
        self.scratch = R.Scratch(SHARED, ROOT, self.policy, expected=128 * R.MIB, checkpoint=self.receipt)
        self.scratch.manifest = self.manifest
        self.cancel = threading.Event()
        self.stop = threading.Event()
        self.thread = None
        self.readers = []
        self.children = []
        self.tracked = {}
        self.ports = set()
        self.links = []
        self.reservation = None
        self.entered = False
        self.output_identity = None
        self.finished = False
        self.finalizing = False
        self.started = time.monotonic()
        self.report = {'run': self.run, 'chunk': mode, 'state': 'incomplete', 'scope': 'scoped',
                       'owner': R.owner(), 'scratch': str(self.scratch.root), 'retained': str(self.retained),
                       'manifest': str(self.manifest), 'limits': {'seconds': 240, 'combinedBytes': 128 * R.MIB,
                       'logBytes': 2 * R.MIB, 'requestedRssBytes': (2560 if self.browser else 512) * R.MIB,
                       'minimumRssBytes': (2048 if self.browser else 512) * R.MIB, 'workers': 1,
                       'chromeInstances': 1 if self.browser else 0}, 'errors': [],
                       'peakCombinedBytes': 0, 'peakRssBytes': 0,
                       'compatibilityException': self.policy.local_reason,
                       'excluded': 'Original F105 one-offer HTTPS account/email/pending reload/1280/375/keyboard/clock only; excludes full suite, second browser, nativeDB/live BMW/mail and whole107 journey.'}
        atexit.register(self.finalize)
        self.write_manifest('planned')

    def write_manifest(self, state):
        self.scratch.record.update(state=state, retained=str(self.retained), output=str(self.output),
                                   links=[{k: str(v) if isinstance(v, Path) else v for k, v in item.items()}
                                          for item in self.links], supervisor=str(Path(__file__).resolve()))
        R.atomic_json(self.manifest, self.scratch.record)

    def fail(self, message):
        if message not in self.report['errors']:
            self.report['errors'].append(message)
        self.cancel.set()

    def observe(self):
        rows = snapshot()
        owned = {child.pid for child in self.children if child.poll() is None}
        owned.update(pid for pid, identity in self.tracked.items()
                     if pid in rows and rows[pid]['start'] == identity['start'])
        owned.update(pid for pid, row in rows.items() if str(self.scratch.root) in row['command'])
        ledger = R.read_json(self.ledger, {}) or {}
        for pid in ledger.get('pids', []):
            if isinstance(pid, int) and pid in rows and (pid in owned or rows[pid]['ppid'] == os.getpid()
                    or str(self.scratch.root) in rows[pid]['command']):
                owned.add(pid)
        while True:
            expanded = owned | {pid for pid, row in rows.items() if row['ppid'] in owned}
            if expanded == owned:
                break
            owned = expanded
        owned.discard(os.getpid())
        if os.getpid() not in rows or type(rows[os.getpid()]['rss']) is not int:
            raise R.ResourceError('Owned supervisor RSS unavailable')
        rss = rows[os.getpid()]['rss']
        for pid in owned:
            row = rows.get(pid)
            if not row:
                continue
            self.tracked[pid] = {key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}
            rss += row['rss']
        chrome_roots = [pid for pid in owned if pid in rows and '--user-data-dir=' + str(self.scratch.root / 'chrome-profile') in rows[pid]['command']
                        and '--type=' not in rows[pid]['command']]
        if len(chrome_roots) > 1 or (not self.browser and chrome_roots):
            self.fail('Chrome instance limit exceeded')
        for port in ledger.get('ports', []):
            if isinstance(port, int) and 0 < port <= 65535:
                self.ports.add(port)
        if owned:
            opened = subprocess.run(['/usr/sbin/lsof', '-nP', '-a', '-p', ','.join(map(str, sorted(owned))),
                                     '-iTCP', '-sTCP:LISTEN', '-Fn'], capture_output=True, text=True, timeout=4)
            if opened.returncode not in (0, 1) or opened.stderr:
                raise R.ResourceError('Cannot inspect all owned listening ports')
            for line in opened.stdout.splitlines():
                match = re.search(r':(\d+)$', line)
                if line.startswith('n') and match:
                    self.ports.add(int(match[1]))
        manifest_stat = self.manifest.lstat()
        manifest_bytes = max(manifest_stat.st_size, getattr(manifest_stat, 'st_blocks', 0) * 512)
        used = self.scratch.sample() + R.allocated_bytes(self.retained) + manifest_bytes
        self.report['peakCombinedBytes'] = max(self.report['peakCombinedBytes'], used)
        self.report['peakRssBytes'] = max(self.report['peakRssBytes'], rss)
        R.atomic_json(self.retained / 'owned-identities.json', list(self.tracked.values()))
        if self.reservation:
            self.host.update(self.scratch.token, used, rss)
            if rss > self.reservation['ram']:
                self.fail('Aggregate owned RSS cap exceeded')
        if used > 127 * R.MIB:
            self.fail('Combined scratch and retained output cap exceeded')
        if self.log.exists() and self.log.stat().st_size > 2 * R.MIB:
            self.fail('Combined log cap exceeded')
        if time.monotonic() - self.started > 240:
            self.fail('240-second chunk deadline exceeded')

    def monitor(self):
        while not self.stop.wait(0.5):
            try:
                self.observe()
            except Exception as error:
                self.fail(type(error).__name__ + ': ' + str(error)[:1000])
                return

    def command(self, argv, env):
        if self.cancel.is_set():
            raise R.ResourceError('Chunk cancelled or budget exhausted')
        child = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append(child)
        self.scratch.child(child)
        identity = R.process_identity(child.pid)
        if identity:
            self.tracked[child.pid] = {'pid': child.pid, 'ppid': os.getpid(), 'pgid': child.pid,
                                       'start': ' '.join(identity.split())}

        def drain():
            try:
                with self.log.open('ab', buffering=0) as destination:
                    while True:
                        block = child.stdout.read(8192)
                        if not block:
                            break
                        remaining = 2 * R.MIB - destination.tell()
                        if remaining > 0:
                            destination.write(block[:remaining])
                        if len(block) > remaining:
                            self.fail('Combined log cap exceeded')
            except Exception as error:
                self.fail('Log drain failed: ' + type(error).__name__)
            finally:
                child.stdout.close()

        reader = threading.Thread(target=drain, name='bounded-log', daemon=True)
        self.readers.append(reader)
        reader.start()
        while child.poll() is None:
            if self.cancel.wait(0.1):
                raise R.ResourceError('Chunk cancelled or budget exhausted')
        reader.join(timeout=3)
        if reader.is_alive():
            raise R.ResourceError('Log drain did not join')
        self.report.setdefault('commands', []).append({'argv': argv, 'rc': child.returncode})
        if child.returncode:
            raise R.ResourceError('Selected command failed with exit ' + str(child.returncode))

    def adopt_dependencies(self):
        for relative in ('server/node_modules',):
            link = ROOT / relative
            target = Path('/Users/garycarter/Code/GitHub/vehicle-matcher') / relative
            if not os.path.lexists(link) and target.is_dir():
                item = {'link': link, 'target': target, 'inode': None}
                self.links.append(item)
                self.write_manifest('dependency-link-planned')
                link.symlink_to(target, target_is_directory=True)
                item['inode'] = link.lstat().st_ino
                self.write_manifest('active')

    def prep(self, identity, env):
        checked = []
        selected = [str(Path(__file__).relative_to(ROOT)),
                    str((HERE / 'browser-runner.mjs').relative_to(ROOT)),
                    str((HERE / 'browser-embed.mjs').relative_to(ROOT))]
        for relative in selected:
            if relative not in identity['sources']:
                raise R.ResourceError('Source catalogue omits selected preparation source: ' + relative)
            path = ROOT / relative
            if path.suffix == '.py':
                ast.parse(path.read_text(), filename=relative)
                checked.append(relative)
            elif path.suffix in ('.js', '.mjs', '.cjs'):
                self.command([identity['executables']['node']['path'], '--check', str(path)], env)
                checked.append(relative)
        text = (HERE / 'browser-runner.mjs').read_text()
        required = ['FUCQ103_CHUNK', 'FUCQ103_OUTPUT', 'FUCQ103_SCRATCH', 'FUCQ103_PROCESS_LEDGER',
                    '--user-data-dir=', 'chrome-profile', 'buildServer', 'createGcspRuntime', 'https',
                    'resourceFailures: []', 'report.resourceFailures.push', 'assert.deepEqual(report.resourceFailures, [])',
                    'scrollIntoView', 'Capture target must be visible inside the viewport', 'focusPreserved: true',
                    '.gcsp-brief-cards .vm-card-terms .vm-specs', 'surface, focusPreserved']
        if any(item not in text for item in required):
            raise R.ResourceError('Runner lacks required owned Chrome/TLS/runtime interface')
        forbidden = [r'secureCookies\s*:\s*false', r'sameSite\s*:\s*[\'\"](?:none|lax)[\'\"]',
                     r'--disable-web-security', r'process\.env\.(?:DATABASE_URL|GCSP_DATABASE_URL)',
                     r'identity\.session\s*=', r'\.env(?:\.local)?[\'\"]']
        if any(re.search(pattern, text, re.I) for pattern in forbidden):
            raise R.ResourceError('Runner static source guard rejected session/security/secret override')
        self.report['preparation'] = {'checked': checked, 'staticGuards': 'passed',
                                      'runtimeImported': False, 'browserLaunched': False}

    def execute(self):
        plan_path = Path(os.environ.get('FUCQ103_SOURCE_PLAN', str(HERE / 'browser-source-plan.json'))).resolve()
        self.plan_path = plan_path
        self.report['sourceBefore'] = source_identity(plan_path, self.browser)
        ram = (2560 if self.browser else 512) * R.MIB
        self.reservation = self.host.acquire(self.scratch.token, 128 * R.MIB, ram, ROOT,
                                            root=self.scratch.root, minimum_disk=128 * R.MIB,
                                            minimum_ram=(2048 if self.browser else 512) * R.MIB)
        self.report['reservation'] = self.reservation
        self.scratch.__enter__()
        self.entered = True
        self.output.mkdir(parents=True)
        stat = self.output.lstat()
        self.output_identity = (stat.st_dev, stat.st_ino)
        self.write_manifest('active')
        self.adopt_dependencies()
        env = self.scratch.env(os.environ)
        removed = []
        for key in list(env):
            if (key.upper().startswith('PG') or re.search(r'DATABASE|POSTGRES|(?:^|_)DB(?:_|$)|(?:^|_)SQL(?:_|$)', key, re.I)
                    or re.search(r'DEBUG|TRACE', key, re.I)
                    or key in ('DEMO_ACCESS_KEY', 'NODE_V8_COVERAGE', 'NODE_OPTIONS', 'NODE_PATH')):
                removed.append(key)
                del env[key]
        self.report['removedEnvironmentKeys'] = sorted(removed)
        env.update(PYTHONDONTWRITEBYTECODE='1', SCAFFOLDING_HARNESS='codex',
                   XDG_CACHE_HOME=str(self.scratch.root / 'cache'),
                   FUCQ103_CHUNK=self.mode, FUCQ103_OUTPUT=str(self.output),
                   FUCQ103_SCRATCH=str(self.scratch.root), FUCQ103_PROCESS_LEDGER=str(self.ledger),
                   FUCQ103_SOURCE_PLAN=str(plan_path))
        self.thread = threading.Thread(target=self.monitor, name='resource-monitor', daemon=True)
        self.thread.start()
        if self.browser:
            if not (ROOT / 'server/node_modules').is_dir(): raise R.ResourceError('Existing dependencies missing; no installation/link mutation allowed')
            self.command([self.report['sourceBefore']['executables']['node']['path'], '--check', str(HERE / 'browser-runner.mjs')], env)
            self.command([self.report['sourceBefore']['executables']['node']['path'], str(HERE / 'browser-runner.mjs')], env)
            business = R.read_json(self.output / 'results.json', {}) or {}
            self.report['businessState'] = business.get('state')
            if business.get('state') != 'passed':
                raise R.ResourceError('Browser runner did not record a passed result')
        else:
            self.prep(self.report['sourceBefore'], env)
        self.observe()
        self.report['executionPassed'] = not self.cancel.is_set()

    def finalize(self):
        if self.finished or self.finalizing:
            return
        self.finalizing = True
        cleanup = {'monitorJoined': False, 'readersJoined': False, 'portsClosed': {}, 'scratchAbsent': False}
        try:
            self.stop.set()
            if self.thread:
                self.thread.join(timeout=6)
            cleanup['monitorJoined'] = not self.thread or not self.thread.is_alive()
            if self.entered:
                try:
                    self.observe()
                except Exception as error:
                    self.fail('Final ownership observation failed: ' + type(error).__name__)
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    try:
                        self.observe()
                    except Exception as error:
                        self.fail('Teardown ownership refresh failed: ' + type(error).__name__)
                    for identity in list(self.tracked.values()):
                        if same_process(identity):
                            try:
                                os.kill(identity['pid'], sig)
                            except ProcessLookupError:
                                pass
                    for child in self.children:
                        if child.poll() is None:
                            try:
                                os.killpg(child.pid, sig)
                            except ProcessLookupError:
                                pass
                    time.sleep(0.2)
                for child in self.children:
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        self.fail('Owned process did not join')
                for reader in self.readers:
                    reader.join(timeout=3)
                cleanup['readersJoined'] = all(not reader.is_alive() for reader in self.readers)
                rows = snapshot()
                cleanup['liveIdentities'] = [identity for pid, identity in self.tracked.items()
                                             if pid in rows and rows[pid]['start'] == identity['start']]
                cleanup['profilePathProcesses'] = [pid for pid, row in rows.items()
                                                   if str(self.scratch.root) in row['command']]
                cleanup['groupsAbsent'] = all(R.group_has_live_members(group) is False
                                              for group in self.scratch.record['groups'])
                for port in sorted(self.ports):
                    closed = True
                    for address in ('127.0.0.1', '::1'):
                        family = socket.AF_INET6 if ':' in address else socket.AF_INET
                        with socket.socket(family) as probe:
                            probe.settimeout(0.3)
                            closed = closed and probe.connect_ex((address, port)) != 0
                    cleanup['portsClosed'][str(port)] = closed
                opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(self.scratch.root)],
                                        capture_output=True, timeout=6)
                cleanup['openFilesAbsent'] = opened.returncode == 1 and not opened.stdout and not opened.stderr
                safe = (cleanup['monitorJoined'] and cleanup['readersJoined'] and not cleanup['liveIdentities']
                        and not cleanup['profilePathProcesses'] and cleanup['groupsAbsent']
                        and cleanup['openFilesAbsent'] and all(cleanup['portsClosed'].values()))
                self.report['removedScratchBytes'] = self.scratch.sample()
                if safe:
                    self.scratch.__exit__(None, None, None)
                else:
                    self.write_manifest('preserved-cleanup-uncertain')
                    self.fail('Scratch preserved because ownership/open-file cleanup is uncertain: ' + str(self.scratch.root))
            cleanup['scratchAbsent'] = not os.path.lexists(self.scratch.root)
            cleanup['dependencyLinks'] = []
            for item in self.links:
                link, target = item['link'], item['target']
                own = (item['inode'] is not None and link.is_symlink()
                       and link.lstat().st_ino == item['inode'] and os.readlink(link) == str(target))
                if own:
                    link.unlink()
                cleanup['dependencyLinks'].append({'link': str(link), 'removedOwnedLink': own,
                                                   'linkAbsent': not os.path.lexists(link), 'targetPreserved': target.is_dir()})
                if not own or os.path.lexists(link) or not target.is_dir():
                    self.fail('Dependency link ownership changed; preserved uncertain path: ' + str(link))
            if hasattr(self, 'plan_path') and 'sourceBefore' in self.report:
                self.report['sourceAfter'] = source_identity(self.plan_path, self.browser)
                if self.report['sourceAfter'] != self.report['sourceBefore']:
                    self.fail('Source identity changed during chunk')
        except BaseException as error:
            self.fail('Finalizer failed: ' + type(error).__name__ + ': ' + str(error)[:1000])
        finally:
            try:
                if self.reservation and cleanup['scratchAbsent'] and all(x['linkAbsent'] for x in cleanup.get('dependencyLinks', [])):
                    self.host.release(self.scratch.token)
                cleanup['reservationReleased'] = self.scratch.token not in (R.read_json(self.host.path, {}) or {})
            except Exception as error:
                self.fail('Reservation release failed: ' + type(error).__name__)
            self.report['rawAllRowAdmission'] = self.host.audit
            self.report['cleanup'] = cleanup
            passed = (self.report.get('executionPassed') and not self.report['errors']
                      and cleanup['scratchAbsent'] and cleanup.get('reservationReleased'))
            blocked = self.report.get('state') == 'admission-blocked' and not self.entered
            self.report['state'] = 'passed' if passed else ('admission-blocked' if blocked else 'incomplete')
            if passed and self.log.exists():
                self.log.unlink()
                self.report['successfulLogRemoved'] = True
            self.report['finishedAt'] = time.time()
            # Include the final receipt itself, then settle its small size field.
            self.report['retainedBytes'] = 0
            for attempt in range(3):
                R.atomic_json(self.receipt, self.report)
                retained = R.allocated_bytes(self.retained)
                manifest_stat = self.manifest.lstat()
                final_used = retained + max(manifest_stat.st_size, getattr(manifest_stat, 'st_blocks', 0) * 512)
                self.report['peakCombinedBytes'] = max(self.report['peakCombinedBytes'], final_used)
                if final_used > 128 * R.MIB:
                    self.fail('Final retained receipt exceeds combined allocation cap')
                    self.report['state'] = 'incomplete'
                if retained == self.report['retainedBytes']:
                    break
                self.report['retainedBytes'] = retained
            R.atomic_json(self.receipt, self.report)
            self.finished = True
            print(json.dumps({'state': self.report['state'], 'receipt': str(self.receipt),
                              'scratchAbsent': cleanup['scratchAbsent'], 'manifest': str(self.manifest)}))


def main():
    if os.environ.get('FUCQ105_BROWSER_LANE_GRANTED') != 'explicit-root-release':
        raise SystemExit('Requires the existing FUCQ105 single-run execution grant')
    os.environ['FUCQ103_SOURCE_PLAN'] = str(HERE / 'source-plan.json')
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    if mode not in MODES:
        raise SystemExit('Expected exactly one of: ' + ', '.join(MODES))
    allowed = {key: os.environ[key] for key in ('HOME','USER','LOGNAME','PATH','TZ','LC_ALL','FUCQ103_SOURCE_PLAN') if key in os.environ}
    os.environ.clear(); os.environ.update(allowed)
    supervisor = Supervisor(mode)
    with R.handled_termination():
        try:
            supervisor.execute()
        except BaseException as error:
            supervisor.report['state'] = 'admission-blocked' if isinstance(error, R.CapacityError) else 'incomplete'
            supervisor.fail(type(error).__name__ + ': ' + str(error)[:1000])
            if isinstance(error, R.CapacityError):
                supervisor.report['headroom'] = error.headroom
        finally:
            supervisor.finalize()
    return 0 if supervisor.report['state'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
