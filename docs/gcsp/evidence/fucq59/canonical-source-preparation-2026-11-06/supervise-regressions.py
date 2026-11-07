"""One serial offline test unit using the trusted main-root resource supervisor."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
PROJECT = Path('/Users/usget/Claude/vehicle-matcher')
TRUSTED = PROJECT / '_tools/test_resources.py'
spec = importlib.util.spec_from_file_location('trusted_four_get_resources', TRUSTED)
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    selection = json.loads((BASE / 'regression-selection.json').read_text())
    if selection['scope'] != 'offline-four-get-reservation-cleanup-port-only' or selection['sourceAttemptsAllocated'] != 0:
        raise ValueError('selection refused')
    for path, expected in selection['identityPaths'].items():
        if sha(path) != expected:
            raise ValueError('identity changed')
    if selection['command'] != [sys.executable, '-I', '-B', str(BASE / 'supervisor-regressions.py')]:
        raise ValueError('command refused')
    policy = R.Policy(dict(chunk_scratch_mib=64, chunk_ram_mib=384, unit_scratch_mib=64,
        unit_ram_mib=384, chunk_seconds=120, log_mib=1))
    run = BASE / 'regression-run'
    run.mkdir(exist_ok=True)
    identity = {'run': selection['run'], 'selectionSha256': sha(BASE / 'regression-selection.json'),
        'wrapperSha256': sha(__file__), 'resourceToolSha256': sha(TRUSTED),
        'python': sys.executable, 'pythonSha256': sha(sys.executable), 'files': selection['identityPaths']}
    R.atomic_json(run / 'selected.json', {'identity': identity, 'selection': selection,
        'finalizer': 'trusted execute -> handled_termination -> stop/join -> Scratch.__exit__ -> HostBudget.release; independent verification after execute'})
    units = [{'id': 'reservation-cleanup-helper-finalizer-terminal', 'disk': 64 * R.MIB,
        'ram': 384 * R.MIB, 'seconds': 120, 'command': selection['command']}]
    removed_logs = []

    def callback(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
        if len(chunk) != 1:
            raise ValueError('one unit only')
        result = R.run_process(chunk[0]['command'], PROJECT, dict(os.environ), log, scratch,
            policy, disk_limit, ram_limit, min(timeout, 120), host, cancel)
        output = log.read_text(errors='replace')
        result['summary'] = output.splitlines()[-20:]
        if result['rc'] or result.get('issue'):
            (run / 'bounded-failure.log').write_text(output[-32768:])
        removed_logs.append({'path': str(log), 'bytes': log.stat().st_size})
        log.unlink()
        result['logRemoved'] = not log.exists()
        return result

    checkpoint = R.execute(units, identity, PROJECT, run, run / 'logs', policy, 1, callback, resume=False)
    host = R.HostBudget(policy)
    with R.locked(host.directory / 'reservations.lock'):
        ledger = json.loads(host.path.read_text())
    cleanup = []
    for manifest in sorted((run / 'ownership').glob('*.json')):
        record = R.read_json(manifest)
        row = {'manifest': str(manifest), 'root': record['root'], 'token': record['token'],
            'owner': record['owner'], 'rootAbsent': not os.path.lexists(record['root']),
            'state': record['state'], 'groups': record['groups'],
            'groupsAbsent': all(R.group_has_live_members(g) is False for g in record['groups']),
            'tokenAbsent': record['token'] not in ledger, 'peakAllocatedBytes': record['peak']}
        cleanup.append(row)
    leftovers = [row['root'] for row in cleanup if not (row['rootAbsent'] and row['groupsAbsent'] and row['tokenAbsent'])]
    receipt = {'identity': identity, 'checkpoint': checkpoint, 'cleanup': cleanup,
        'removedLogs': removed_logs, 'leftovers': leftovers, 'sourceRequests': 0,
        'largeOutput': False, 'compatibilityException': None}
    R.atomic_json(run / 'receipt.json', receipt)
    print(json.dumps({'state': checkpoint['state'], 'checks': [c['result'] for c in checkpoint['completed'].values()],
        'cleanup': cleanup, 'leftovers': leftovers}))
    return int(checkpoint['state'] != 'complete' or bool(leftovers) or
        any(c['result']['rc'] or c['result'].get('issue') for c in checkpoint['completed'].values()))


if __name__ == '__main__':
    raise SystemExit(main())
