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

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G
import test_resources as R

BASE = '3f1cc3414d700b1028ff1fec640a40591324b728'
MODES = ('prep', 'smoke-desktop', 'journey-desktop', 'journey-narrow320')
EXECUTABLE = {'.js', '.mjs', '.cjs', '.py', '.sh', '.html', '.css', '.json',
              '.svg', '.webp', '.png', '.jpg', '.jpeg', '.woff', '.woff2', '.pem'}
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq103-browser')


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
    if plan.get('runtimeBaseRevision') != BASE:
        raise R.ResourceError('Source plan runtimeBaseRevision differs from reviewed runtime')
    sources = plan.get('sources')
    if not isinstance(sources, dict) or not sources:
        raise R.ResourceError('Source plan requires a finite source digest catalogue')
    required = {str(Path(__file__).relative_to(ROOT)),
                str((HERE / 'browser-runner.mjs').relative_to(ROOT)),
                '_tools/test_resources.py', '_tools/scaffold_git.py'}
    if not required <= sources.keys():
        raise R.ResourceError('Source catalogue omits supervisor, runner or resource/git helpers')
    for relative, expected in sources.items():
        path = ROOT / relative
        if (not isinstance(relative, str) or Path(relative).is_absolute() or '..' in Path(relative).parts
                or not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected)
                or not path.is_file() or ROOT not in path.resolve().parents or digest(path) != expected):
            raise R.ResourceError('Source catalogue mismatch: ' + str(relative))
    dependencies = plan.get('dependencies', {})
    if not dependencies.get('sources') or not plan.get('executables'):
        raise R.ResourceError('Source plan omits installed dependency and executable identities')
    for absolute, expected in dependencies['sources'].items():
        path = Path(absolute)
        if not path.is_absolute() or not path.is_file() or digest(path) != expected:
            raise R.ResourceError('Installed dependency changed: ' + absolute)
    installed = {str(path) for absolute in dependencies.get('roots', [])
                 for path in Path(absolute).rglob('*') if path.is_file() and not path.is_symlink()
                 and '.bin' not in path.parts}
    declared = {absolute for absolute in dependencies['sources']
                if any(Path(base) in Path(absolute).parents for base in dependencies.get('roots', []))}
    if installed != declared:
        raise R.ResourceError('Installed dependency file membership changed')
    for name, item in plan['executables'].items():
        path = Path(item['path'])
        if not path.is_absolute() or not path.is_file() or digest(path) != item['sha256']:
            raise R.ResourceError('Executable identity changed: ' + name)
    chunks = plan.get('chunks')
    names = [chunk if isinstance(chunk, str) else chunk.get('name', chunk.get('id'))
             for chunk in chunks] if isinstance(chunks, list) else []
    if set(names) != set(MODES[1:]) or len(names) != 3:
        raise R.ResourceError('Source plan must identify exactly the three browser chunks')
    head = git('rev-parse', 'HEAD')
    if git('merge-base', BASE, head) != BASE:
        raise R.ResourceError('Reviewed runtime base is not an ancestor of HEAD')
    frozen = os.environ.get('FUCQ103_FROZEN_REVISION', '')
    if browser and (not re.fullmatch(r'[0-9a-f]{40}', frozen) or head != frozen):
        raise R.ResourceError('Browser execution requires exact reviewed pushed FUCQ103_FROZEN_REVISION=HEAD')
    changes = git('diff', '--name-only', 'HEAD').splitlines()
    changes += git('ls-files', '--others', '--exclude-standard').splitlines()
    allowed_links = {str(item['link'].relative_to(ROOT)) for item in adopted
                     if item.get('inode') and item['link'].is_symlink()
                     and item['link'].lstat().st_ino == item['inode']
                     and os.readlink(item['link']) == str(item['target'])}
    bad = []
    for relative in set(changes):
        path = ROOT / relative
        executable = path.suffix.lower() in EXECUTABLE or (path.exists() and os.access(path, os.X_OK) and not path.is_dir())
        if relative in allowed_links or (path == plan_path and not browser):
            continue
        if executable and (browser or relative not in sources):
            bad.append(relative)
    if bad:
        raise R.ResourceError('Unexpected executable/assets worktree changes: ' + ', '.join(sorted(bad)))
    if browser:
        branch = git('rev-parse', '--abbrev-ref', 'HEAD')
        remote = git('config', '--get', 'branch.' + branch + '.remote')
        merge = git('config', '--get', 'branch.' + branch + '.merge')
        if not remote or not merge or git('rev-parse', '@{upstream}') != head:
            raise R.ResourceError('Frozen browser commit is not the configured published upstream HEAD')
    return {'head': head, 'runtimeBaseRevision': BASE, 'sourcePlanSha256': digest(plan_path),
            'sources': sources, 'dependencies': dependencies, 'executables': plan['executables'], 'frozenRevision': frozen if browser else None}


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
        self.policy = R.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128,
                                'chunk_ram_mib': 2560 if self.browser else 512, 'log_mib': 2,
                                'local_scratch_reason': 'OneDrive unavailable; bounded local Chrome profile/IPC compatibility working set; small local retained evidence.'})
        self.host = R.HostBudget(self.policy)
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
                       'manifest': str(self.manifest), 'limits': {'seconds': 120, 'combinedBytes': 128 * R.MIB,
                       'logBytes': 2 * R.MIB, 'requestedRssBytes': (2560 if self.browser else 512) * R.MIB,
                       'minimumRssBytes': (2048 if self.browser else 512) * R.MIB, 'workers': 1,
                       'chromeInstances': 1 if self.browser else 0}, 'errors': [],
                       'peakCombinedBytes': 0, 'peakRssBytes': 0,
                       'compatibilityException': self.policy.local_reason,
                       'excluded': 'Full/native/PostgreSQL/external integrations; browser acceptance remains future until explicitly admitted.'}
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
        rss = rows.get(os.getpid(), {}).get('rss', 0)
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
        if time.monotonic() - self.started > 120:
            self.fail('120-second chunk deadline exceeded')

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
                    'resourceFailures: []', 'report.resourceFailures.push', 'assert.deepEqual(report.resourceFailures, [])']
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
            self.adopt_dependencies()
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
                if self.reservation:
                    self.host.release(self.scratch.token)
                cleanup['reservationReleased'] = self.scratch.token not in (R.read_json(self.host.path, {}) or {})
            except Exception as error:
                self.fail('Reservation release failed: ' + type(error).__name__)
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
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    if mode not in MODES:
        raise SystemExit('Expected exactly one of: ' + ', '.join(MODES))
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
