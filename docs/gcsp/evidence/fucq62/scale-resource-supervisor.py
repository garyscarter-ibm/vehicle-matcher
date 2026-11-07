"""Prepared resource supervisor. No proof runs without the exact approval argument."""
import sys
sys.dont_write_bytecode = True
if sys.argv[1:] != ['--parent-approved']:
    raise SystemExit('Prepared only: the parent must review the pinned plan before approving this exact command.')

import atexit
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[4]
proof = 'docs/gcsp/evidence/fucq62/scale-resource-proof.mjs'
plan_path = 'docs/gcsp/evidence/fucq62/scale-proof-plan-2026-11-07.json'
pins_path = 'docs/gcsp/evidence/fucq62/scale-proof-pins-2026-11-07.json'
plan = json.loads((root / plan_path).read_text())
pins = json.loads((root / pins_path).read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert str(root) == plan['resources']['workingDirectory'], 'Unexpected working tree'
for path, expected in pins['files'].items():
    assert sha(root / path) == expected, 'Changed pinned file: ' + path
node = Path('/opt/homebrew/bin/node')
assert str(node.resolve()) == pins['runtime']['nodeRealPath']
assert sha(node) == pins['runtime']['nodeSha256']
assert subprocess.run([str(node), '--version'], capture_output=True, text=True, check=True).stdout.strip() == pins['runtime']['nodeVersion']
assert sha(Path('/usr/bin/python3')) == pins['runtime']['pythonSha256']
subprocess.run(['git', 'merge-base', '--is-ancestor', plan['baseCommit'], 'HEAD'], cwd=root, check=True)
head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, check=True).stdout.strip()

vendor = Path(pins['dependencies']['path'])
def dependency_identity():
    entries = []
    for folder, directories, files in os.walk(vendor, followlinks=False):
        for name in sorted(directories + files):
            path = Path(folder) / name
            relative = str(path.relative_to(vendor))
            if path.is_symlink():
                entries.append([relative, 'symlink', str(path.readlink())])
            elif path.is_file():
                entries.append([relative, 'file', path.stat().st_size, sha(path)])
    encoded = json.dumps(sorted(entries), separators=(',', ':')).encode()
    return {'treeSha256': hashlib.sha256(encoded).hexdigest(),
            'files': sum(entry[1] == 'file' for entry in entries),
            'bytes': sum(entry[2] for entry in entries if entry[1] == 'file')}
assert dependency_identity() == pins['dependencies']['identity'], 'Borrowed dependency identity changed'

spec = importlib.util.spec_from_file_location('tr', root / '_tools/test_resources.py')
tr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tr)
cloud = Path(plan['resources']['oneDriveRoot']).resolve(strict=True)
base = Path(plan['resources']['oneDriveBase'])
assert cloud.is_dir() and cloud in base.resolve().parents
assert base.resolve() == base, 'OneDrive destination must not traverse a symlink'
control_base = Path(plan['resources']['controlBase'])
out = control_base / sha(root / pins_path)[:16]
assert not out.exists(), 'Retained run exists: inspect its checkpoint before selecting any replay'
out.mkdir(parents=True, mode=0o700)
command = [str(node), '--max-old-space-size=256', proof, '--receipt', str(out / 'receipt.json')]
selection = {'status': 'approved-execution-starting', 'head': head, 'pinsSha256': sha(root / pins_path),
             'pins': pins, 'command': command, 'changedPaths': [proof, plan_path, pins_path,
             'docs/gcsp/evidence/fucq62/scale-proof-fixture.v1.json',
             'docs/gcsp/evidence/fucq62/scale-resource-supervisor.py'],
             'boundaries': plan['phases'], 'excluded': plan['excluded'], 'resources': plan['resources']}
tr.atomic_json(out / 'selection.json', selection)
policy = tr.Policy({'chunk_scratch_mib': 256, 'chunk_ram_mib': 512, 'chunk_seconds': 180, 'log_mib': 1})
scratch = tr.Scratch(out, root, policy, expected=256 * tr.MIB, checkpoint=out / 'phase-checkpoint.json')
scratch.root = base / ('test-stamp-shard-' + scratch.token)
scratch.record.update(root=str(scratch.root), location='cloud')
tr.atomic_json(scratch.manifest, scratch.record)
host = tr.HostBudget(policy)
link = root / 'server/node_modules'
entered = reserved = finished = False
link_inode = None
base_preexisting = base.exists()
result = None

def finish():
    global entered, reserved, finished, link_inode
    if finished:
        return
    errors = []
    groups = []
    for pgid in scratch.record['groups']:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            state = 'absent'
        except PermissionError:
            state = 'no-live-members' if tr.group_has_live_members(pgid) is False else 'uncertain'
        else:
            state = 'no-live-members' if tr.group_has_live_members(pgid) is False else 'live-or-uncertain'
        groups.append({'pgid': pgid, 'state': state})
    if any(group['state'] not in ['absent', 'no-live-members'] for group in groups):
        errors.append('Owned group remains live or uncertain; payload and reservation retained')
    if link_inode is not None:
        try:
            current = link.lstat()
            if (current.st_dev, current.st_ino) != link_inode or not link.is_symlink() or link.readlink() != vendor:
                raise RuntimeError('Owned dependency link changed; preserved for inspection')
            link.unlink()
            link_inode = None
        except BaseException as error:
            errors.append(str(error))
    if not any(group['state'] not in ['absent', 'no-live-members'] for group in groups):
        if entered:
            try:
                scratch.__exit__(None, None, None)
                entered = False
            except BaseException as error:
                errors.append(str(error))
        if reserved and not entered:
            try:
                host.release(scratch.token)
                reserved = False
            except BaseException as error:
                errors.append(str(error))
    if not base_preexisting and base.exists():
        try:
            base.rmdir()
        except OSError as error:
            errors.append('New proof base not empty or unavailable: ' + str(error))
    checkpoint = tr.read_json(out / 'phase-checkpoint.json', {'completed': []})
    if checkpoint.get('status') == 'running':
        checkpoint['status'] = 'incomplete'
    checkpoint.update(payloadRetained=os.path.lexists(scratch.root),
                      payloadResumable=False, cleanupErrors=errors)
    tr.atomic_json(out / 'phase-checkpoint.json', checkpoint)
    tr.atomic_json(out / 'cleanup.json', {'scratch': str(scratch.root), 'manifest': str(scratch.manifest),
        'scratch_absent': not os.path.lexists(scratch.root), 'manifest_state': scratch.record['state'],
        'groups': groups, 'reservation_absent': scratch.token not in (tr.read_json(host.path, {}) or {}),
        'dependency_link_absent': not os.path.lexists(link), 'removed_bytes_sampled_peak': scratch.record['peak'],
        'compatibility_exception': None, 'errors': errors,
        'retainedSummaryDirectory': str(out), 'rawCoverageRemovedWithScratch': not os.path.lexists(scratch.root / 'coverage')})
    finished = True

atexit.register(finish)
exit_code = 1
with tr.handled_termination():
    try:
        # The existing cloud root is the volume probe; reservation precedes payload creation.
        host.acquire(scratch.token, 256 * tr.MIB, 512 * tr.MIB, cloud, root=scratch.root)
        reserved = True
        scratch.__enter__()
        entered = True
        if os.path.lexists(link):
            raise RuntimeError('Existing dependency path preserved; no proof started')
        link.symlink_to(vendor, target_is_directory=True)
        current = link.lstat()
        link_inode = (current.st_dev, current.st_ino)
        tr.atomic_json(out / 'dependency-ownership.json', {'path': str(link), 'target': str(vendor),
                       'device': current.st_dev, 'inode': current.st_ino})
        env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8',
               'TZ': 'UTC', 'NODE_V8_COVERAGE': str(scratch.root / 'coverage'), 'F62_SCALE_CONTROL': str(out)}
        result = tr.run_process(command, root, env, out / 'proof.log', scratch, policy,
                                256 * tr.MIB, 448 * tr.MIB, 180, host)
        observed = {}
        coverage_paths = list((scratch.root / 'coverage').glob('*.json'))
        if len(coverage_paths) > 3 or sum(path.stat().st_size for path in coverage_paths) > 16 * tr.MIB:
            raise RuntimeError('Coverage exceeds the planned three-process/16 MiB aggregate allowance')
        for path in coverage_paths:
            if path.stat().st_size > 8 * tr.MIB:
                raise RuntimeError('Coverage file exceeds bounded 8 MiB parser allowance')
            for script in json.loads(path.read_text())['result']:
                prefix = 'file://' + str(root) + '/'
                if not script['url'].startswith(prefix):
                    continue
                relative = script['url'][len(prefix):]
                if relative not in pins['files']:
                    continue
                entry = observed.setdefault(relative, {})
                for function in script['functions']:
                    marker = str(function['ranges'][0]['startOffset']) + ':' + function['functionName']
                    entry[marker] = max(entry.get(marker, 0), function['ranges'][0]['count'])
        coverage = {path: {'functions': len(entries), 'observedFunctions': sorted(name for name, count in entries.items() if count > 0)}
                    for path, entries in observed.items()}
        tr.atomic_json(out / 'coverage-summary.json', coverage)
        for path, expected in pins['files'].items():
            assert sha(root / path) == expected, 'Code changed during proof: ' + path
        assert dependency_identity() == pins['dependencies']['identity'], 'Borrowed dependencies changed'
        result.update(head=head, pinsSha256=sha(root / pins_path), command=command,
                      scope='synthetic-byte-volume-only', acceptance='not-established')
        tr.atomic_json(out / 'result.json', result)
        tr.atomic_json(Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/fucq62-beyond64-resource.json'),
                       {'identity': pins, 'result': result, 'observedFunctions': coverage,
                        'boundaries': plan['phases'], 'excluded': plan['excluded'],
                        'coverageContext': 'Aggregate bounded required resource proof; no per-test coverage or v2 source-authority claim'})
        receipt = tr.read_json(out / 'receipt.json', {})
        exit_code = 0 if result['rc'] == 0 and result['issue'] is None and receipt.get('status') == 'resource-proof-passing' else 1
    except BaseException as error:
        tr.atomic_json(out / 'supervisor-error.json', {'name': type(error).__name__, 'message': str(error)[:4000]})
        exit_code = 130 if isinstance(error, KeyboardInterrupt) else 1
    finally:
        finish()
cleanup = tr.read_json(out / 'cleanup.json', {})
if cleanup.get('errors') or not cleanup.get('scratch_absent') or not cleanup.get('reservation_absent') or not cleanup.get('dependency_link_absent'):
    exit_code = 1
print(json.dumps({'exitCode': exit_code, 'result': result, 'cleanup': cleanup, 'summary': str(out)}))
raise SystemExit(exit_code)
