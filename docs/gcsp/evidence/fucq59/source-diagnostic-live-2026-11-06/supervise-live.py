"""One parent-owned, bounded invocation. No retry, traffic recovery or marker reset."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys

BASE = Path(__file__).resolve().parent
PROJECT = Path('/Users/usget/Claude/vehicle-matcher')
RDIR = BASE / 'supervision'


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            value.update(block)
    return value.hexdigest()


def read_small(path, limit=131072):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('invalid-bounded-file')
    data = path.read_bytes()
    if len(data) > limit:
        raise ValueError('invalid-bounded-file')
    return json.loads(data)


def require(value):
    if not value:
        raise ValueError('supervisor-preflight-refused')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def group_absent(pgid):
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def safe_observation(output, allocation):
    """Only counts from a pinned runner receipt; never read unchecked session state."""
    partial = []
    metadata_unavailable = False
    for name in ('tree.json', 'options.json'):
        path = output / name
        try:
            if path.is_file() and not path.is_symlink() and path.stat().st_size <= 131072:
                partial.append({'file': name, 'bytes': path.stat().st_size, 'sha256': digest(path),
                                'status': 'export-present; parent artifact audit required'})
        except (OSError, ValueError, TypeError):
            metadata_unavailable = True
    counts, status = None, 'absent-or-invalid; actual counts unknown; allowance remains consumed'
    try:
        receipt = read_small(output / 'receipt.json')
        require(isinstance(receipt, dict)
                and receipt.get('schemaVersion') == 'f59-live-diagnostic-receipt.v1'
                and receipt.get('allocation') == allocation['id']
                and receipt.get('producerCommit') == allocation['producerCommit']
                and receipt.get('planSha256') == allocation['planSha256']
                and receipt.get('planDigest') == allocation['planDigest']
                and receipt.get('admission') is False and receipt.get('accepted') == [])
        candidate = receipt.get('counts')
        if candidate is not None:
            require(isinstance(candidate, dict))
            for key in ('sourceCalls', 'httpAttempts', 'decodedBytes'):
                require(type(candidate.get(key)) is int and candidate[key] >= 0)
            require(candidate['sourceCalls'] <= candidate['httpAttempts'] <= allocation['attempts'])
            counts = {key: candidate[key] for key in ('sourceCalls', 'httpAttempts', 'decodedBytes')}
        status = 'pinned-runner-receipt; parent content audit required'
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return {'counts': counts, 'runnerReceiptStatus': status, 'partialExports': partial,
            'partialExportMetadataUnavailable': metadata_unavailable}


def main():
    require(len(sys.argv) == 2 and Path(sys.argv[1]).resolve() == BASE / 'execution-selection.json')
    selected = read_small(sys.argv[1])
    require(selected['schemaVersion'] == 'f59-parent-execution-selection.v1'
            and selected['executable'] is True
            and selected['supervisorSha256'] == digest(__file__)
            and selected['qualificationDate'] == datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    for name, expected in selected['fileHashes'].items():
        require(name in ('diagnostic-plan.json', 'run-live.mjs', 'execution-handoff.json')
                and digest(BASE / name) == expected)
    require(set(selected['fileHashes']) == {'diagnostic-plan.json', 'run-live.mjs', 'execution-handoff.json'})
    for name in ('code', 'security'):
        review = selected['reviews'][name]
        require(review['verdict'] == 'passed' and digest(review['path']) == review['sha256'])
    require(digest(PROJECT / '_tools/test_resources.py') == selected['resourceToolSha256']
            and digest(PROJECT / '_tools/scaffold_git.py') == selected['gitToolSha256'])
    handoff = read_small(BASE / 'execution-handoff.json')
    root = Path(selected['producerRoot'])
    require(root.is_absolute() and root.resolve() == root
            and root == PROJECT / '.claude/worktrees/DEV-2026-11-04-032')
    os.environ['SCAFFOLDING_HARNESS'] = 'codex'
    sg = load('f59_supervisor_git', PROJECT / '_tools/scaffold_git.py')
    for args, expected in ((['rev-parse', 'HEAD'], selected['producerCommit']),
                           (['status', '--porcelain', '--untracked-files=no'], '')):
        rc, out, err = sg.git(root, args)
        require(rc == 0 and out.strip() == expected)
    rc, out, err = sg.git(root, ['ls-remote', 'origin', 'refs/heads/dev/DEV-2026-11-04-032'])
    require(rc == 0 and out.split() == [selected['producerCommit'], 'refs/heads/dev/DEV-2026-11-04-032'])
    require(selected['remoteVerifiedCommit'] == selected['producerCommit'])
    require(digest(selected['nodeRuntime']) == selected['runtimeSha256'])
    pins = {**handoff['producer']['moduleHashes'], **handoff['producer']['reviewedEightPathHashes'],
            **handoff['producer']['frozenContractHashes']}
    for path, expected in pins.items():
        require(digest(root / path) == expected)
    marker = Path(handoff['onceMarker']['path'])
    output = Path(handoff['resources']['retainedOutputRoot'])
    require(marker == BASE / 'execution-once.json' and output == BASE / 'observation'
            and not os.path.lexists(marker) and not os.path.lexists(output)
            and not (RDIR / 'supervisor-receipt.json').exists())
    tr = load('f59_supervisor_resources', PROJECT / '_tools/test_resources.py')
    policy = tr.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 384, 'chunk_seconds': 120,
                        'log_mib': 1})
    scratch = tr.Scratch(RDIR, PROJECT, policy, expected=2 * tr.MIB)
    host = tr.HostBudget(policy)
    allocation = dict(handoff['allocationTemplate'])
    allocation.update(executable=True, producerCommit=selected['producerCommit'],
        remoteVerifiedCommit=selected['remoteVerifiedCommit'], producerRoot=str(root),
        runtimeSha256=selected['runtimeSha256'], scratchRoot=str(scratch.root),
        ownershipManifest=str(scratch.manifest), supervisorFinalizerRegistered=True,
        reviewVerdicts={'code': 'passed', 'security': 'passed'},
        runnerSha256=selected['fileHashes']['run-live.mjs'],
        handoffSha256=selected['fileHashes']['execution-handoff.json'])
    outcome, observed, failure, reserved = None, None, None, False
    receipt = {'schemaVersion': 'f59-parent-supervisor-receipt.v1', 'allocation': allocation['id'],
        'selectedPlanSha256': digest(sys.argv[1]), 'supervisorSha256': digest(__file__),
        'producerCommit': selected['producerCommit'], 'oneInvocationOnly': True,
        'maxSourceAttempts': 4, 'sourceRetry': 0, 'admission': False, 'accepted': [],
        'scratchRoot': str(scratch.root), 'ownershipManifest': str(scratch.manifest),
        'expectedScratchBytes': 2 * tr.MIB, 'expectedRssBytes': 192 * tr.MIB,
        'expectedSeconds': 45, 'limits': {'scratchBytes': 64 * tr.MIB, 'rssBytes': 384 * tr.MIB,
        'seconds': 120, 'logBytes': tr.MIB, 'workers': 1},
        'finalizersRegisteredBeforeScratchCreation': True, 'compatibilityException': None,
        'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    # This outer finalizer owns reservation release and a durable receipt even on handled cancellation.
    with tr.handled_termination():
        try:
            tr.atomic_json(RDIR / 'supervisor-registration.json', receipt)
            host.acquire(scratch.token, 64 * tr.MIB, 384 * tr.MIB, PROJECT,
                         root=scratch.root, minimum_disk=64 * tr.MIB, minimum_ram=384 * tr.MIB)
            reserved = True
            with scratch:
                tr.atomic_json(RDIR / 'allocation.json', allocation)
                try:
                    outcome = tr.run_process([selected['nodeRuntime'], str(BASE / 'run-live.mjs'),
                        str(RDIR / 'allocation.json')], root, dict(os.environ), scratch.root / 'runner.log',
                        scratch, policy, 64 * tr.MIB, 384 * tr.MIB, 120, host=host)
                finally:
                    observed = safe_observation(output, allocation)
                    log = scratch.root / 'runner.log'
                    receipt['logBytesRemoved'] = log.stat().st_size if log.is_file() else 0
                    receipt['allocationRemovedBytes'] = tr.allocated_bytes(scratch.root)
                    if outcome and (outcome['rc'] or outcome['issue']) and log.is_file():
                        # Runner output is deliberately only fixed error codes and safe count summaries.
                        with log.open('rb') as stream:
                            tail = stream.read(4096)
                        (RDIR / 'bounded-failure.log').write_bytes(tail)
        except BaseException as error:
            # Never include exception values, URLs, headers, environment or raw response material.
            failure = 'handled-cancellation' if isinstance(error, KeyboardInterrupt) else 'supervisor-stopped'
        finally:
            if reserved:
                try:
                    host.release(scratch.token)
                except BaseException:
                    receipt['reservationReleaseIssue'] = 'unresolved; parent must reconcile this token only'
            manifest = tr.read_json(scratch.manifest, {})
            manifest = manifest if isinstance(manifest, dict) else {}
            groups = scratch.record['groups']
            receipt.update(outcome=outcome, observation=observed or safe_observation(output, allocation),
                failure=failure, markerPresent=marker.is_file(), markerRemainsSpent=True,
                peakScratchBytes=scratch.record['peak'],
                scratchAbsent=not os.path.lexists(scratch.root), manifestState=manifest.get('state'),
                groups=[{'pgid': pgid, 'absent': group_absent(pgid)} for pgid in groups],
                completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            receipt['leftovers'] = ([str(scratch.root)] if os.path.lexists(scratch.root) else [])
            receipt['leftovers'] += ['pgid:' + str(row['pgid']) for row in receipt['groups'] if not row['absent']]
            tr.atomic_json(RDIR / 'supervisor-receipt.json', receipt)
    print(json.dumps({'failure': failure, 'rc': outcome['rc'] if outcome else None,
        'markerPresent': receipt['markerPresent'], 'scratchAbsent': receipt['scratchAbsent'],
        'leftovers': receipt['leftovers']}))
    return int(bool(failure or not outcome or outcome['rc'] or outcome['issue'] or receipt['leftovers']))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('supervisor-stopped; inspect marker and receipts; never replay automatically')
        sys.exit(2)
