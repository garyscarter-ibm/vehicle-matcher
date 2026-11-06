#!/usr/bin/env python3
"""Proposed finite F69 component runner. Requires a reviewed closure and explicit grant.

This is an ownership/budget supervisor, not an OS network or filesystem sandbox.
Do not execute, import, or syntax-check it before the dispatcher reviews its freeze.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
MIB = 1024 ** 2


def digest(path):
    path = Path(path)
    remaining = path.stat().st_size
    value = hashlib.sha256()
    with path.open('rb') as source:
        while remaining:
            block = source.read(min(65536, remaining))
            if not block:
                raise RuntimeError('Input shortened during hashing: ' + str(path))
            value.update(block)
            remaining -= len(block)
        if source.read(1):
            raise RuntimeError('Input grew during hashing: ' + str(path))
    return value.hexdigest()


def identity(path):
    path = Path(path)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError('Expected a regular input: ' + str(path))
    return {'device': info.st_dev, 'inode': info.st_ino, 'size': info.st_size,
            'mode': stat.S_IMODE(info.st_mode), 'sha256': digest(path)}


def directory_identity(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
        raise RuntimeError('Expected an ordinary directory: ' + str(path))
    return {'device': info.st_dev, 'inode': info.st_ino, 'mode': stat.S_IMODE(info.st_mode)}


def package_members(path):
    found = []
    for folder, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            if (Path(folder) / name).is_symlink():
                raise RuntimeError('Dependency symlink is outside the proposal.')
        dirs[:] = sorted(name for name in dirs if name != 'node_modules')
        found.extend((Path(folder) / name).relative_to(path).as_posix() for name in sorted(files))
    return sorted(found)


def verify_inputs(closure, deadline=None):
    def timely():
        if deadline is not None and time.monotonic() > deadline:
            raise RuntimeError('Input verification phase deadline exceeded.')
    for row in closure['sourceRows'] + closure['guardRows']:
        timely()
        target = ROOT / row['path']
        if target.resolve() != target or identity(target) != row['identity']:
            raise RuntimeError('Frozen source/config/tool changed: ' + row['path'])
    for row in closure['tools']:
        timely()
        target = Path(row['path'])
        if str(target.resolve()) != row['realpath'] or identity(target) != row['identity']:
            raise RuntimeError('Frozen executable changed: ' + row['path'])
    for row in closure['installedGuards']:
        timely()
        if identity(row['path']) != row['identity']:
            raise RuntimeError('Installed manifest/lock changed: ' + row['path'])
    installed = Path(closure['installedRoot'])
    if directory_identity(installed) != closure['installedRootIdentity']:
        raise RuntimeError('Installed dependency root identity changed.')
    for row in closure['packages']:
        timely()
        target = installed / row['path']
        if directory_identity(target) != row['directoryIdentity'] or package_members(target) != row['members']:
            raise RuntimeError('Installed package membership changed: ' + row['path'])
    for row in closure['dependencyRows']:
        timely()
        target = installed / row['path']
        if target.resolve() != target or identity(target) != row['identity']:
            raise RuntimeError('Installed dependency changed: ' + row['path'])
    for row in closure['packageEdges']:
        timely()
        for candidate in row['candidateVariants']:
            if os.path.lexists(candidate['path']) != candidate['exists']:
                raise RuntimeError('Dependency file/directory candidate changed: ' + candidate['path'])
        for candidate in row['searchedCandidates']:
            exists = (Path(candidate) / 'package.json').is_file()
            if exists != (candidate == row['resolvedPath']):
                raise RuntimeError('Package resolution changed: ' + candidate)


def snapshot():
    probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart=,args='],
                           capture_output=True, text=True, timeout=3, check=True)
    if probe.stderr or not probe.stdout.strip():
        raise RuntimeError('Process telemetry is uncertain.')
    rows = []
    for line in probe.stdout.splitlines():
        fields = line.split(None, 10)
        if len(fields) != 11 or any(not value.isdigit() for value in fields[:4]):
            raise RuntimeError('Cannot parse process ownership telemetry.')
        rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]), 'pgid': int(fields[2]),
                     'rss': int(fields[3]) * 1024, 'stat': fields[4], 'start': ' '.join(fields[5:10])})
    return rows


def parse_tap(raw, names):
    text = raw.decode('utf-8', errors='strict')
    counts = {}
    for name in ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        matches = re.findall(r'^# ' + name + r' (\d+)\s*$', text, re.M)
        if len(matches) != 1:
            raise RuntimeError('Expected one original TAP total: ' + name)
        counts[name] = int(matches[0])
    subtests = re.findall(r'^# Subtest: (.+)$', text, re.M)
    successes = re.findall(r'^ok (\d+) - (.+)$', text, re.M)
    expected = {'tests': 4, 'suites': 0, 'pass': 4, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    complete = (counts == expected and subtests == names
                and successes == [(str(i + 1), name) for i, name in enumerate(names)]
                and re.findall(r'^1\.\.(\d+)\s*$', text, re.M) == ['4']
                and not re.search(r'^not ok\b|^Bail out!|# (?:SKIP|TODO)\b', text, re.M))
    return {'counts': counts, 'subtests': subtests, 'successes': successes, 'complete': complete}


def run():
    started = time.monotonic()
    parser = argparse.ArgumentParser()
    parser.add_argument('--dispatcher-grant', required=True)
    parser.add_argument('--expected-closure-sha256', required=True)
    args = parser.parse_args()
    if not args.dispatcher_grant.strip() or not re.fullmatch('[0-9a-f]{64}', args.expected_closure_sha256):
        parser.error('Supply the specific grant and reviewed closure SHA-256.')
    closure_path = HERE / 'history-back-closure.json'
    if digest(closure_path) != args.expected_closure_sha256:
        raise RuntimeError('Reviewed closure changed; no allocation or product execution.')
    closure = json.loads(closure_path.read_text())
    if closure['state'] != 'frozen authoring; awaiting execution grant':
        raise RuntimeError('Unexpected closure state.')
    # Verify this file, all product/package bytes, Python and resource tools BEFORE importing project helpers.
    verify_inputs(closure, started + 120)
    if Path(sys.executable).resolve() != Path(closure['python']['path']).resolve():
        raise RuntimeError('Use the frozen Python executable.')
    if sys.version != closure['python']['version'] or not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise RuntimeError('Use the exact frozen isolated Python invocation.')
    if os.environ.get('TEST_RESOURCE_PARENT_RESERVATION'):
        raise RuntimeError('This proposal owns a top-level reservation; inherited reservations require a new review.')
    spec = importlib.util.spec_from_file_location('fucq69_history_resources', ROOT / '_tools/test_resources.py')
    r = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(r)
    cancel = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _sig, _frame: cancel.set())

    class StrictHost(r.HostBudget):
        def registry(self):
            if not self.path.exists():
                return {}
            data = json.loads(self.path.read_text())
            if not isinstance(data, dict):
                raise r.ResourceError('Reservation registry is not an object.')
            for token, row in data.items():
                if not isinstance(token, str) or not isinstance(row, dict):
                    raise r.ResourceError('Malformed reservation row.')
                owner = row.get('owner')
                if (not isinstance(owner, dict) or type(owner.get('pid')) is not int or owner['pid'] <= 0
                        or not isinstance(owner.get('start'), str) or not owner['start']):
                    raise r.ResourceError('Reservation owner identity is uncertain.')
                if any(type(row.get(key)) is not int or row[key] < 0 for key in ('disk', 'ram', 'used', 'rss')):
                    raise r.ResourceError('Reservation allocation is uncertain.')
                if row.get('parent') is not None and not isinstance(row['parent'], str):
                    raise r.ResourceError('Reservation parent is uncertain.')
                if row.get('root') is not None and (not isinstance(row['root'], str) or not Path(row['root']).is_absolute()):
                    raise r.ResourceError('Reservation root is uncertain.')
            return data

        def _dead_owners(self):
            with r.locked(self.directory / 'reservations.lock'):
                data = self.registry()
            return {key: row['owner'] for key, row in data.items() if not r.process_alive(row['owner'])}

        def _live(self, dead):
            return {key: row for key, row in self.registry().items() if key not in dead or row['owner'] != dead[key]}

        def _capacity(self, live, free, memory):
            if memory is None:
                raise r.ResourceError('Available memory telemetry is uncertain.')
            return super()._capacity(live, free, memory)

        def update(self, token, used, rss):
            with r.locked(self.directory / 'reservations.lock'):
                data = self.registry()
                if token not in data:
                    raise r.ResourceError('Owned reservation disappeared.')
                data[token].update(used=used, rss=rss)
                r.atomic_json(self.path, data)
            return True

        def release(self, token):
            with r.locked(self.directory / 'reservations.lock'):
                data = self.registry()
                data.pop(token, None)
                r.atomic_json(self.path, data)

    policy = r.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'unit_ram_mib': 512,
                       'chunk_scratch_mib': 128, 'unit_scratch_mib': 48, 'log_mib': 2})
    host = StrictHost(policy, directory=closure['hostRegistryDirectory'])
    run_id = 'history-back-' + uuid.uuid4().hex[:12]
    records = ROOT.parents[1] / 'test-runs/fucq69-history-back' / run_id
    ledger = {}
    materialized = {}
    process = None
    result = {'rc': None}
    timings = {}
    uncertain = []

    def live_owned(rows):
        return [row for row in rows if not row['stat'].startswith('Z') and row['pid'] in ledger
                and row['start'] == ledger[row['pid']]['start']]

    def absent(record):
        rows = snapshot()
        groups = list(record['groups'])
        if process is not None:
            # A local handle can exist even when initial persistence failed. Never accept an empty ledger alone.
            if process.poll() is None:
                return False
            groups.append(process.pid)
        return (not live_owned(rows)
                and all(r.group_has_live_members(group) is False for group in set(groups)))

    class SafeScratch(r.Scratch):
        def __exit__(self, kind, value, tb):
            if uncertain or not absent(self.record):
                raise r.ResourceError('Owned process cleanup uncertain; retain named scratch: ' + str(self.root))
            opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(self.root)], capture_output=True, timeout=5)
            if opened.returncode != 1 or opened.stdout or opened.stderr:
                raise r.ResourceError('Scratch open-file status uncertain; retain: ' + str(self.root))
            return super().__exit__(kind, value, tb)

    scratch = SafeScratch(records, ROOT, policy, expected=48 * MIB, checkpoint=records / 'checkpoint.json')
    original_sample = scratch.sample

    def combined_disk():
        used = original_sample() + r.allocated_bytes(records)
        scratch.record['peak'] = max(scratch.record['peak'], used)
        r.atomic_json(scratch.manifest, scratch.record)
        return used

    scratch.sample = combined_disk

    def sample():
        rows = snapshot()
        supervisor = next((row for row in rows if row['pid'] == os.getpid()), None)
        if supervisor is None:
            raise r.ResourceError('Supervisor telemetry disappeared.')
        selected = {row['pid'] for row in rows if process is not None and row['pgid'] == process.pid}
        selected |= {row['pid'] for row in live_owned(rows)}
        while True:
            expanded = selected | {row['pid'] for row in rows if row['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        owned = [row for row in rows if row['pid'] in selected]
        for group in {row['pgid'] for row in owned}:
            if any(row['pgid'] == group and row['pid'] not in selected for row in rows):
                raise r.ResourceError('A descendant process group has unowned members.')
            if group not in scratch.record['groups']:
                scratch.record['groups'].append(group)
        for row in owned:
            ledger[row['pid']] = {key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}
        scratch.record['ownedPids'] = list(ledger.values())
        r.atomic_json(scratch.manifest, scratch.record)
        probes = [row for row in rows if row['ppid'] == os.getpid() and row['pid'] not in selected]
        return supervisor['rss'] + sum(row['rss'] for row in owned + probes)

    def meter(deadline):
        used, rss = scratch.sample(), sample()
        result['peakAggregateRssBytes'] = max(result.get('peakAggregateRssBytes', 0), rss)
        host.update(scratch.token, used, rss)
        if cancel.is_set() or time.monotonic() > deadline:
            raise r.ResourceError('Cancelled or phase deadline exceeded.')
        if used > granted['disk'] or rss > granted['ram'] or shutil.disk_usage(scratch.root).free < policy.reserve:
            raise r.ResourceError('Combined disk/RSS/headroom budget exceeded.')

    def stop_join():
        if process is None:
            return
        if process.pid not in scratch.record['groups']:
            scratch.record['groups'].append(process.pid)
            try:
                r.atomic_json(scratch.manifest, scratch.record)
            except BaseException as error:
                uncertain.append('Emergency handle ownership persistence: ' + str(error))
        try:
            sample()
        except BaseException as error:
            uncertain.append('Final recursive discovery: ' + str(error))
        # The original start_new_session group is always owned, even if its leader has exited.
        groups = list(dict.fromkeys([process.pid] + scratch.record['groups']))
        for sig in (signal.SIGTERM, signal.SIGKILL):
            rows = snapshot()
            for group in reversed(groups):
                members = [row for row in rows if row['pgid'] == group and not row['stat'].startswith('Z')]
                if not members:
                    continue
                if group != process.pid and any(row['pid'] not in ledger or row['start'] != ledger[row['pid']]['start'] for row in members):
                    uncertain.append('Descendant group identity changed: ' + str(group))
                    continue
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if all(r.group_has_live_members(group) is False for group in groups):
                    break
                time.sleep(0.05)
        process.wait(timeout=3)
        if not absent(scratch.record):
            uncertain.append('Owned groups or descendant identities remain after stop/join.')

    plan = {'story': 'FUCQ-69', 'run': run_id, 'grant': args.dispatcher_grant,
            'closureSha256': args.expected_closure_sha256, 'argv': closure['nodeArgv'],
            'cwd': str(scratch.root), 'scratch': str(scratch.root), 'manifest': str(scratch.manifest),
            'expectedNames': closure['expectedNames'], 'limits': closure['limits'], 'scope': closure['scope']}
    r.atomic_json(scratch.manifest, scratch.record)  # External owner BEFORE scratch allocation.
    r.atomic_json(records / 'plan.json', plan)
    r.atomic_json(records / 'checkpoint.json', {'state': 'incomplete', 'selected': closure['expectedNames'], 'completed': []})
    try:
        granted = host.acquire(scratch.token, 128 * MIB, 768 * MIB, '/private/tmp', root=scratch.root,
                               minimum_disk=48 * MIB, minimum_ram=512 * MIB)
        with scratch:
            preparation_deadline = started + 120
            # No dependency fallback from scratch ancestors; --no-global-search-paths excludes CJS global roots.
            for parent in scratch.root.parents:
                if os.path.lexists(parent / 'node_modules'):
                    raise r.ResourceError('Scratch ancestor dependency root exists: ' + str(parent))
            def write(path, source, expected):
                target = scratch.root / path
                target.resolve().relative_to(scratch.root.resolve())
                if target.exists():
                    raise r.ResourceError('Duplicate materialization target: ' + path)
                data = Path(source).read_bytes()
                if hashlib.sha256(data).hexdigest() != expected:
                    raise r.ResourceError('Input changed during materialization: ' + path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                materialized[path] = expected
                if cancel.is_set() or time.monotonic() > preparation_deadline:
                    raise r.ResourceError('Preparation cancelled or deadline exceeded.')
            for row in closure['sourceRows']:
                write(row['path'], ROOT / row['path'], row['identity']['sha256'])
            for index, row in enumerate(closure['dependencyRows']):
                write('node_modules/' + row['path'], Path(closure['installedRoot']) / row['path'], row['identity']['sha256'])
                if index % 64 == 0:
                    meter(preparation_deadline)
            for directory in ('tmp', 'home'):
                (scratch.root / directory).mkdir()
            verify_inputs(closure, preparation_deadline)
            meter(preparation_deadline)
            timings['preparationSeconds'] = time.monotonic() - started
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC',
                   'HOME': str(scratch.root / 'home'), 'TMPDIR': str(scratch.root / 'tmp'),
                   'TMP': str(scratch.root / 'tmp'), 'TEMP': str(scratch.root / 'tmp'),
                   'NO_COLOR': '1', 'FORCE_COLOR': '0', 'TEST_RESOURCE_PARENT_RESERVATION': scratch.token}
            plan['environment'] = env
            plan['granted'] = granted
            r.atomic_json(records / 'plan.json', plan)
            raw_log = records / 'test.tap'
            observed_bytes = 0
            log_drained = False
            execution_started = time.monotonic()
            try:
                with raw_log.open('xb') as log, selectors.DefaultSelector() as selector:
                    # Cancellation cannot land between successful creation and initial durable ownership.
                    # The outer finally also adopts/stops the local handle if any registration step raises.
                    if threading.active_count() != 1:
                        raise r.ResourceError('The tiny child signal-mask reset requires a single-threaded supervisor.')
                    prior_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
                    try:
                        process = subprocess.Popen(closure['nodeArgv'], cwd=scratch.root, env=env,
                                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                                                   preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask))
                        scratch.child(process)
                        sample()
                    finally:
                        signal.pthread_sigmask(signal.SIG_SETMASK, prior_mask)
                    selector.register(process.stdout, selectors.EVENT_READ)
                    last_sample = 0.0
                    while selector.get_map() or process.poll() is None:
                        if time.monotonic() - last_sample >= 0.2:
                            meter(execution_started + 120)
                            last_sample = time.monotonic()
                        for key, _mask in selector.select(timeout=0.1):
                            block = os.read(key.fileobj.fileno(), 65536)
                            if not block:
                                selector.unregister(key.fileobj)
                                continue
                            prior = observed_bytes
                            observed_bytes += len(block)
                            log.write(block[:max(0, 2 * MIB - prior)])
                            if observed_bytes > 2 * MIB:
                                raise r.ResourceError('Original output exceeds 2 MiB; bounded prefix is incomplete.')
                    process.wait(timeout=3)
                    result['rc'] = process.returncode
                    log_drained = True
            finally:
                stop_join()
                if process is not None and process.stdout is not None:
                    process.stdout.close()
                timings['executionAndStopSeconds'] = time.monotonic() - execution_started
                result.update(originalBytesObserved=observed_bytes, logTruncated=observed_bytes > 2 * MIB,
                              logDrained=log_drained,
                              log=str(raw_log), logSha256=digest(raw_log) if raw_log.exists() else None)
            finalization_started = time.monotonic()
            meter(finalization_started + 120)
            result['tap'] = parse_tap(raw_log.read_bytes(), closure['expectedNames'])
            result['materializedUnchanged'] = all(digest(scratch.root / path) == sha for path, sha in materialized.items())
            verify_inputs(closure, finalization_started + 120)
            timings['verificationSeconds'] = time.monotonic() - finalization_started
    except BaseException as error:
        result['issue'] = type(error).__name__ + ': ' + str(error)
    finally:
        cleanup_started = time.monotonic()
        def check(work):
            try:
                return bool(work())
            except BaseException as error:
                uncertain.append(type(error).__name__ + ': ' + str(error))
                return False
        processes_absent = check(lambda: absent(scratch.record))
        if processes_absent and not os.path.lexists(scratch.root):
            try:
                host.release(scratch.token)
            except BaseException as error:
                uncertain.append('Reservation release: ' + str(error))
        def reservation_absent():
            with r.locked(host.directory / 'reservations.lock'):
                return scratch.token not in host.registry()
        def inputs_unchanged():
            verify_inputs(closure, cleanup_started + 120)
            return digest(closure_path) == args.expected_closure_sha256
        checks = {'scratchAbsent': not os.path.lexists(scratch.root), 'ownedProcessesAbsent': processes_absent,
                  'reservationAbsent': check(reservation_absent), 'allFrozenInputsUnchanged': check(inputs_unchanged),
                  'notCancelled': not cancel.is_set(),
                  'originalLogComplete': result.get('logTruncated') is False and result.get('logDrained') is True,
                  'materializedUnchanged': result.get('materializedUnchanged') is True}
        passed = (result.get('rc') == 0 and not result.get('issue') and not uncertain and all(checks.values())
                  and result.get('tap', {}).get('complete') is True)
        timings['receiptCleanupSeconds'] = time.monotonic() - cleanup_started
        receipt = {'state': 'passed' if passed else 'incomplete', 'result': result, 'checks': checks,
                   'uncertainties': uncertain, 'grant': args.dispatcher_grant, 'closureSha256': args.expected_closure_sha256,
                   'timings': timings, 'totalWallSeconds': time.monotonic() - started,
                   'combinedAllocatedPeakBytes': scratch.record['peak'], 'manifest': str(scratch.manifest),
                   'groups': scratch.record['groups'], 'processes': list(ledger.values()),
                   'materialized': materialized, 'scope': closure['scope'],
                   'independentParentAudit': 'required separately; this receipt is the launching supervisor report'}
        r.atomic_json(records / 'receipt.json', receipt)
        r.atomic_json(records / 'checkpoint.json', {'state': receipt['state'], 'selected': closure['expectedNames'],
                      'completed': closure['expectedNames'] if passed else [], 'receipt': str(records / 'receipt.json')})
        retained = r.allocated_bytes(records)
        receipt['retainedAllocatedBytes'] = retained
        receipt['combinedAllocatedPeakBytes'] = max(receipt['combinedAllocatedPeakBytes'], retained)
        if retained > 128 * MIB or ('granted' in locals() and retained > granted['disk']):
            passed = False
            receipt['state'] = 'incomplete'
            receipt['uncertainties'].append('Final retained records exceeded the granted combined disk allowance.')
            r.atomic_json(records / 'checkpoint.json', {'state': 'incomplete', 'selected': closure['expectedNames'],
                          'completed': [], 'receipt': str(records / 'receipt.json')})
        r.atomic_json(records / 'receipt.json', receipt)
        print(json.dumps({'state': receipt['state'], 'checks': checks, 'receipt': str(records / 'receipt.json')}, sort_keys=True))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(run())
