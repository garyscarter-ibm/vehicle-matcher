#!/usr/bin/env python3
"""Run one reviewed finite F69 integration chunk; never adopt shared checkout code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as g
import test_resources as r


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def filesystem_identity(path):
    path = Path(path)
    stat = path.stat()
    return {'device': stat.st_dev, 'inode': stat.st_ino, 'sha256': digest(path)}


def snapshot():
    probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,lstart=,args='],
                           capture_output=True, text=True, check=True, timeout=3)
    rows = []
    for line in probe.stdout.splitlines():
        values = line.split(None, 9)
        if len(values) != 10:
            raise r.ResourceError('Cannot parse the process ownership snapshot.')
        rows.append({'pid': int(values[0]), 'ppid': int(values[1]), 'pgid': int(values[2]),
                     'rss': int(values[3]) * 1024, 'start': ' '.join(values[4:9])})
    return rows


def excluded(key):
    upper = key.upper()
    return ('DATABASE' in upper or 'POSTGRES' in upper or upper.startswith('PG')
            or bool(re.search(r'(?:^|_)(?:DB|SQL)(?:_|$)', upper))
            or bool(re.match(r'^(?:DB|SQL)(?:URL|URI|CONN|CONNECTION|HOST|PORT|DSN|USER|PASSWORD)', upper))
            or bool(re.search(r'DEBUG|PRELOAD|INSPECT|NODE_OPTIONS|NODE_PATH|COVERAGE|PLAYWRIGHT', upper)))


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dispatcher-grant', required=True)
    args = parser.parse_args()
    if not args.dispatcher_grant.strip():
        parser.error('An explicit dispatcher grant is required.')
    g.MUTEX_WAIT = 30
    closure_path = Path(__file__).with_name('integration-closure.json')
    closure = json.loads(closure_path.read_text())
    if closure['state'] != 'frozen authoring; awaiting execution grant':
        raise r.ResourceError('The finite authored closure is not ready for review/execution.')
    for row in closure['ownRows']:
        if digest(ROOT / row['path']) != row['sha256']:
            raise r.ResourceError('Own source changed: ' + row['path'])
    for path, identity in closure['installedPgIdentities'].items():
        if filesystem_identity(path) != identity:
            raise r.ResourceError('Installed pg input changed: ' + path)
    for path, identity in closure['installedLockIdentities'].items():
        if filesystem_identity(path) != identity:
            raise r.ResourceError('Installed lock identity changed: ' + path)
    node = Path(closure['node']['path'])
    if filesystem_identity(node) != closure['node']['identity']:
        raise r.ResourceError('The reviewed Node executable changed.')
    policy = r.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'unit_ram_mib': 512,
                       'chunk_scratch_mib': 128, 'unit_scratch_mib': 8, 'log_mib': 2})
    host = r.HostBudget(policy)
    run_id = 'released-read-' + uuid.uuid4().hex[:12]
    records = ROOT.parents[1] / 'test-runs/fucq69-released-integration' / run_id
    records.mkdir(parents=True)
    ledger = {}

    def absent(record):
        rows = snapshot()
        return (all(r.group_has_live_members(group) is False for group in record['groups'])
                and not any(row['pid'] in ledger and row['start'] == ledger[row['pid']]['start'] for row in rows))

    class SafeScratch(r.Scratch):
        def __exit__(self, kind, value, tb):
            if not absent(self.record):
                raise r.ResourceError('Owned process cleanup uncertain; scratch retained: ' + str(self.root))
            opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(self.root)],
                                    capture_output=True, timeout=5)
            if opened.returncode != 1 or opened.stdout or opened.stderr:
                raise r.ResourceError('Owned scratch open-file status uncertain: ' + str(self.root))
            return super().__exit__(kind, value, tb)

    scratch = SafeScratch(records, ROOT, policy, expected=8 * r.MIB)
    original_sample = scratch.sample

    def combined_disk():
        used = original_sample() + r.allocated_bytes(records)
        scratch.record['peak'] = max(scratch.record['peak'], used)
        r.atomic_json(scratch.manifest, scratch.record)
        return used

    scratch.sample = combined_disk
    argv = [str(node), '--max-old-space-size=512', '--test', '--test-concurrency=1',
            'server/test/gcsp-manual-gallery-integration.test.js']
    env = {key: value for key, value in os.environ.items() if not excluded(key)}
    plan = {'story': 'FUCQ-69', 'run': run_id, 'grant': args.dispatcher_grant,
            'closureSha256': digest(closure_path), 'closure': closure,
            'argv': argv, 'cwd': str(scratch.root), 'scratch': str(scratch.root),
            'manifest': str(scratch.manifest), 'headroom': host.headroom('/private/tmp'),
            'environmentNamesRemoved': sorted(key for key in os.environ if excluded(key)),
            'limits': {'seconds': 120, 'rssMiB': 768, 'minimumRssMiB': 512,
                       'scratchMiB': 128, 'logMiB': 2, 'workers': 1},
            'scope': 'Finite actual100/92 in-process memory stock-read composition; no listener/browser/native/full/live source'}
    r.atomic_json(records / 'plan.json', plan)
    cancel = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _signal, _frame: cancel.set())
    original_stop = r.stop_group

    def sample(group):
        rows = snapshot()
        selected = {row['pid'] for row in rows if row['pgid'] == group
                    or row['pid'] in ledger and row['start'] == ledger[row['pid']]['start']}
        while True:
            expanded = selected | {row['pid'] for row in rows if row['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        owned = [row for row in rows if row['pid'] in selected]
        for pgid in {row['pgid'] for row in owned}:
            if any(row['pgid'] == pgid and row['pid'] not in selected for row in rows):
                raise r.ResourceError('Cannot prove exclusive ownership of a descendant group.')
            if pgid not in scratch.record['groups']:
                scratch.record['groups'].append(pgid)
        for row in owned:
            ledger[row['pid']] = {key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}
        scratch.record['ownedPids'] = list(ledger.values())
        r.atomic_json(scratch.manifest, scratch.record)
        return sum(row['rss'] for row in owned)

    def stop(process):
        discovery_issue = None
        try:
            sample(process.pid)
        except BaseException as error:
            discovery_issue = error
        finally:
            original_stop(process)
        for group in reversed(scratch.record['groups']):
            if group == process.pid:
                continue
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if r.group_has_live_members(group) is False:
                    break
                rows = [row for row in snapshot() if row['pgid'] == group]
                if any(row['pid'] not in ledger or row['start'] != ledger[row['pid']]['start'] for row in rows):
                    raise r.ResourceError('Descendant ownership changed; cleanup retained.')
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    break
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and r.group_has_live_members(group) is not False:
                    time.sleep(0.05)
        if not absent(scratch.record):
            raise r.ResourceError('Owned processes remain after stop/join.')
        if discovery_issue is not None:
            raise r.ResourceError('Final discovery was uncertain after known-group cleanup.') from discovery_issue

    r.group_rss = sample
    r.stop_group = stop
    result = None
    materialized = {}
    started = time.monotonic()
    try:
        granted = host.acquire(scratch.token, 128 * r.MIB, 768 * r.MIB, '/private/tmp', root=scratch.root,
                               minimum_disk=8 * r.MIB, minimum_ram=512 * r.MIB)
        with scratch:
            def write(path, data, expected):
                target = scratch.root / path
                target.resolve().relative_to(scratch.root.resolve())
                if target.exists() or hashlib.sha256(data).hexdigest() != expected:
                    raise r.ResourceError('Duplicate or changed finite source: ' + path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                materialized[path] = expected
                host.update(scratch.token, scratch.sample(), 0)
                if cancel.is_set() or time.monotonic() - started > 120:
                    raise r.ResourceError('Cancelled or preparation exhausted the chunk time.')

            for row in closure['immutableRows']:
                rc, text, error = g.git(str(ROOT), ['show', row['ref'] + ':' + row['path']])
                if rc != 0:
                    raise r.ResourceError('Immutable source unavailable: ' + row['path'])
                write(row['path'], text.encode(), row['sha256'])
            for row in closure['ownRows']:
                if row.get('materialize'):
                    write(row['path'], (ROOT / row['path']).read_bytes(), row['sha256'])
            for path, identity in closure['installedPgIdentities'].items():
                relative = 'server/node_modules/' + Path(path).relative_to(closure['installedPgRoot']).as_posix()
                write(relative, Path(path).read_bytes(), identity['sha256'])
            raw_log = scratch.root / 'raw-test.log'
            result = r.run_process(argv, str(scratch.root), env, raw_log, scratch, policy,
                                   granted['disk'], granted['ram'], max(0.1, 120 - (time.monotonic() - started)), host, cancel)
            raw = raw_log.read_text(errors='replace') if raw_log.exists() else ''
            clean = re.sub(r'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])', '[redacted-opaque]', raw)
            (records / 'test.log').write_text(clean[-2 * r.MIB:])
            result['log'] = str(records / 'test.log')
            result['counts'] = {key: int(matches[-1]) for key in ['tests', 'pass', 'fail', 'skipped', 'cancelled']
                                if (matches := re.findall(r'(?m)^\s*(?:ℹ\s*|#\s*)?' + key + r'\s+(\d+)\s*$', clean))}
            result['materializedUnchanged'] = all(digest(scratch.root / path) == value for path, value in materialized.items())
    except BaseException as error:
        result = result or {'rc': 1}
        result['issue'] = '%s: %s' % (type(error).__name__, error)
    finally:
        result = result or {'rc': 1, 'issue': 'No completed result.'}
        try:
            processes_absent = absent(scratch.record)
        except BaseException:
            processes_absent = False
        if processes_absent and not os.path.lexists(scratch.root):
            try:
                host.release(scratch.token)
            except BaseException:
                result['cleanupIssue'] = 'Reservation release could not be confirmed.'

        def check(work):
            try:
                return bool(work())
            except BaseException:
                return False

        checks = {'scratchAbsent': not os.path.lexists(scratch.root), 'ownedProcessesAbsent': processes_absent,
                  'reservationAbsent': check(lambda: scratch.token not in (r.read_json(host.path, {}) or {})),
                  'ownSourcesUnchanged': check(lambda: all(digest(ROOT / row['path']) == row['sha256'] for row in closure['ownRows'])),
                  'installedPgUnchanged': check(lambda: all(filesystem_identity(path) == value for path, value in closure['installedPgIdentities'].items())),
                  'installedLocksUnchanged': check(lambda: all(filesystem_identity(path) == value for path, value in closure['installedLockIdentities'].items())),
                  'nodeUnchanged': check(lambda: filesystem_identity(node) == closure['node']['identity']),
                  'closureUnchanged': check(lambda: digest(closure_path) == plan['closureSha256']), 'notCancelled': not cancel.is_set()}
        passed = (result.get('rc') == 0 and not result.get('issue') and not result.get('cleanupIssue') and all(checks.values())
                  and result.get('materializedUnchanged') is True and result.get('counts', {}).get('tests') == 9
                  and result.get('counts', {}).get('pass') == 9 and result.get('counts', {}).get('skipped') == 0)
        receipt = {'state': 'passed' if passed else 'incomplete', 'result': result, 'checks': checks,
                   'manifest': str(scratch.manifest), 'materialized': materialized,
                   'processes': list(ledger.values()), 'groups': scratch.record['groups'],
                   'totalWall': time.monotonic() - started, 'grant': args.dispatcher_grant,
                   'scope': plan['scope'], 'dependencyCopies': 'Exact approved pg closure copied into owned scratch; originals retained unchanged; no loader/link/install'}
        r.atomic_json(records / 'receipt.json', receipt)
        print(json.dumps({'state': receipt['state'], 'result': result, 'checks': checks,
                          'receipt': str(records / 'receipt.json')}, sort_keys=True))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(run())
