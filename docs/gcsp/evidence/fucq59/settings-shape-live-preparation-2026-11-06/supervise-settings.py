"""Proposed one-shot settings supervisor. main requires a separate executable selection."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parent
PROJECT = Path('/Users/usget/Claude/vehicle-matcher')
PRODUCER = PROJECT / '.claude/worktrees/DEV-2026-11-04-032'
NAMES = ('page', 'settings', 'discover', 'options')
STATUSES = ('settings-refused', 'strict-settings-inconclusive', 'source-stopped', 'runner-stopped', 'cancelled', 'settings-export-failed', 'checkpoint-invalid', 'once-marker-failed')
STOPS = ('settings-header-shape', 'settings-traversal-limit', 'source-attempt-budget', 'source-byte-budget', 'response-byte-budget', 'source-redirect-refused', 'source-json-utf8', 'source-json-shape', 'source-json-duplicate-key', 'source-content-type', 'source-endpoint-refused', 'settings-discovery-shape', 'source-observation-date', 'source-failure', 'source-http-401', 'source-http-403', 'source-http-429', 'operation-timeout', 'deadline')
CONSTRAINTS = dict(maxGetAttempts=2, downstreamRequests=0, retries=0, solver=0, sourceWrites=0, imageRequests=0, browser=0, sql=0, credentialLookups=0, rawRetention=0)


def require(value):
    if not value:
        raise ValueError('settings-supervisor-refused')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            h.update(block)
    return h.hexdigest()


def read_small(path, limit=16384):
    path = Path(path)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= limit)
    data = path.read_bytes()
    require(len(data) <= limit)
    return json.loads(data)


def register_once(path, value):
    """Exclusive durable registration also consumes an invocation that fails before its source marker."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, sort_keys=True, separators=(',', ':'))
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    parent = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def exact(value, keys):
    return type(value) is dict and set(value) == set(keys)


def number(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def hex_value(value, size):
    return type(value) is str and len(value) == size and all(c in 'abcdef0123456789' for c in value)


def valid_receipt(value, allocation):
    require(exact(value, ('schemaVersion', 'runnerVersion', 'qualification', 'admission', 'accepted', 'distinctConfigurations', 'provenance', 'status', 'stopCode', 'cancelled', 'counts', 'countBasis', 'checkpoint', 'settingsExport', 'constraints', 'reviewRequired')))
    require(value['schemaVersion'] == 'f59-settings-observation-receipt.v1' and value['runnerVersion'] == 'f59-settings-shape-runner.v1'
            and value['qualification'] == 'unqualified-structural-observation' and value['admission'] is False
            and type(value['accepted']) is list and value['accepted'] == [] and type(value['distinctConfigurations']) is int and value['distinctConfigurations'] == 0
            and type(value['status']) is str and value['status'] in STATUSES and type(value['cancelled']) is bool
            and (value['stopCode'] is None or type(value['stopCode']) is str and value['stopCode'] in STOPS))
    provenance = value['provenance']
    require(exact(provenance, ('allocation', 'producerCommit', 'codeTestIdentity', 'planSha256', 'planDigest', 'runnerSha256', 'transportKind', 'qualificationDate'))
            and provenance['allocation'] == allocation['id'] and hex_value(provenance['producerCommit'], 40)
            and all(hex_value(provenance[k], 64) for k in ('codeTestIdentity', 'planSha256', 'planDigest', 'runnerSha256'))
            and all(provenance[k] == allocation[k] for k in ('producerCommit', 'codeTestIdentity', 'planSha256', 'planDigest', 'runnerSha256', 'transportKind', 'qualificationDate')))
    checkpoint = value['checkpoint']
    require(exact(checkpoint, ('status', 'bytes', 'sha256')) and type(checkpoint['status']) is str and checkpoint['status'] in ('valid', 'invalid', 'missing')
            and ((checkpoint['bytes'] is None and checkpoint['sha256'] is None) or number(checkpoint['bytes']) and checkpoint['bytes'] <= 1048576 and hex_value(checkpoint['sha256'], 64)))
    counts = value['counts']
    if counts is None:
        require(value['countBasis'] == 'unknown')
    else:
        scalars = ('sourceCalls', 'failures', 'timeouts', 'substitutions', 'cacheEvictions', 'httpAttempts', 'decodedBytes')
        require(exact(counts, scalars + ('operations', 'cacheHits', 'operationBytes')) and all(number(counts[k]) for k in scalars)
                and counts['sourceCalls'] <= counts['httpAttempts'] <= 2 and checkpoint['status'] == 'valid'
                and counts['sourceCalls'] == (counts['httpAttempts'] if allocation['transportKind'] == 'live' else 0)
                and value['countBasis'] in ('validated-final-checkpoint', 'validated-checkpoint-lower-bound'))
        for key in ('operations', 'cacheHits', 'operationBytes'):
            require(exact(counts[key], NAMES) and all(number(v) for v in counts[key].values()) and counts[key]['discover'] == counts[key]['options'] == 0)
        require(all(v <= 1 for v in counts['operations'].values()) and counts['operations']['page'] + counts['operations']['settings'] == counts['httpAttempts']
                and counts['operationBytes']['page'] + counts['operationBytes']['settings'] == counts['decodedBytes'])
    export = value['settingsExport']
    require(exact(export, ('status', 'bytes', 'sha256')) and type(export['status']) is str and export['status'] in ('not-available', 'exported', 'failed'))
    if export['status'] == 'exported':
        require(checkpoint['status'] == 'valid' and number(export['bytes']) and export['bytes'] <= 16384 and hex_value(export['sha256'], 64))
    else:
        require(export['bytes'] is None and export['sha256'] is None)
    require(exact(value['constraints'], CONSTRAINTS) and all(type(value['constraints'][k]) is int and value['constraints'][k] == n for k, n in CONSTRAINTS.items())
            and value['reviewRequired'] == 'source-layout-and-qualification-before-admission-or-new-date-publication')
    return value


def safe_observation(output, allocation):
    """Project only typed receipt accounting; absent/invalid bytes never become exact counts."""
    output = Path(output)
    unknown = dict(counts=None, receiptStatus='absent-or-invalid', settingsExport=dict(status='unavailable', bytes=None, sha256=None))
    try:
        receipt = valid_receipt(read_small(output / 'receipt.json'), allocation)
        export = receipt['settingsExport']
        if export['status'] == 'exported':
            path = output / 'settings-shape.json'
            require(not path.is_symlink() and path.is_file() and path.stat().st_size == export['bytes'] and digest(path) == export['sha256'])
        counts = receipt['counts']
        return dict(counts={k: counts[k] for k in ('sourceCalls', 'httpAttempts', 'decodedBytes')} if counts is not None else None,
                    receiptStatus='typed-pinned-runner-receipt', outcome=receipt['status'], settingsExport=export)
    except (OSError, ValueError, KeyError, TypeError):
        return unknown


class ParentCancellation:
    """The synchronous launcher identity is checked by the existing bounded process loop."""
    def __init__(self, resources, identity):
        self.resources, self.identity = resources, identity

    def is_set(self):
        return not self.resources.process_alive(self.identity)


def release_reservation(host, token, resources):
    """A release call alone cannot prove that the owned token is absent."""
    failed = False
    try:
        host.release(token)
    except BaseException:
        failed = True
    try:
        with resources.locked(host.directory / 'reservations.lock'):
            registry = read_small(host.path, 131072)
            require(type(registry) is dict)
            absent = token not in registry
    except BaseException:
        absent = None
    status = 'failed' if failed else 'unverified' if absent is None else 'released' if absent else 'still-present'
    return dict(status=status, absent=absent)


def terminal_result(receipt):
    """The printed cleanup status and process exit use the same reservation result."""
    summary = dict(failure=receipt['failure'], scratchAbsent=receipt['scratchAbsent'],
                   reservationRelease=receipt['reservationRelease'], leftovers=receipt['leftovers'])
    code = int(bool(receipt['failure'] or not receipt['process'] or receipt['process']['returnCode']
                    or receipt['process']['stopIssue'] or receipt['leftovers']
                    or receipt['reservationRelease']['status'] not in ('not-acquired', 'released')))
    return summary, code


def supervise_once(*, command, cwd, rdir, output, marker, allocation, launcher_owner, resources,
                   disk=64 * 1048576, ram=384 * 1048576, seconds=120):
    """One invocation only. Existing Scratch/run_process own group join and all teardown."""
    rdir, output, marker = Path(rdir), Path(output), Path(marker)
    require(not (rdir / 'supervisor-registration.json').exists() and not os.path.lexists(marker) and not os.path.lexists(output))
    policy = resources.Policy(dict(chunk_scratch_mib=disk // 1048576, chunk_ram_mib=ram // 1048576, chunk_seconds=seconds, log_mib=1))
    scratch = resources.Scratch(rdir, PROJECT, policy, expected=2 * 1048576)
    host = resources.HostBudget(policy)
    cancel = ParentCancellation(resources, launcher_owner)
    allocation = dict(allocation, scratchRoot=str(scratch.root), ownershipManifest=str(scratch.manifest), supervisorFinalizerRegistered=True)
    receipt = dict(schemaVersion='f59-settings-supervisor-receipt.v1', allocation=allocation['id'], sourceAllocationAttempts=2,
                   sourceRetry=0, allocationState='reserved-and-consumed', qualification='unqualified-structural-observation', admission=False, accepted=[],
                   scratchRoot=str(scratch.root), ownershipManifest=str(scratch.manifest), launcherOwner=launcher_owner,
                   limits=dict(scratchBytes=disk, sampledRssBytes=ram, seconds=seconds, logBytes=1048576, workers=1),
                   finalizerRegisteredBeforeScratch=True, compatibilityException=None)
    outcome, reserved, failure = None, False, None
    # An exclusive registration wins before scratch/process allocation; a duplicate cannot overwrite the winner.
    register_once(rdir / 'supervisor-registration.json', receipt)
    # Catching handled termination leaves this outer finalizer responsible for every allocation.
    with resources.handled_termination():
        try:
            require(not cancel.is_set())
            host.acquire(scratch.token, disk, ram, PROJECT, root=scratch.root, minimum_disk=disk, minimum_ram=ram)
            reserved = True
            with scratch:
                allocation_path = rdir / 'allocation.json'
                resources.atomic_json(allocation_path, allocation)
                actual_command = [str(allocation_path) if p == '{allocation}' else p for p in command]
                outcome = resources.run_process(actual_command, cwd, dict(os.environ), scratch.root / 'runner.log', scratch, policy, disk, ram, seconds, host=host, cancel=cancel)
                receipt['removedLogBytes'] = (scratch.root / 'runner.log').stat().st_size
                receipt['removedAllocationBytes'] = resources.allocated_bytes(scratch.root)
        except BaseException as error:
            failure = 'handled-cancellation' if isinstance(error, KeyboardInterrupt) else 'supervisor-stopped'
        finally:
            release = dict(status='not-acquired', absent=None)
            if reserved:
                release = release_reservation(host, scratch.token, resources)
                if release['status'] != 'released':
                    failure = failure or 'reservation-cleanup-failed'
            observation = safe_observation(output, allocation)
            manifest = resources.read_json(scratch.manifest, {})
            manifest = manifest if type(manifest) is dict else {}
            receipt.update(failure=failure, observation=observation, reservationRelease=release,
                           process=None if outcome is None else dict(returnCode=outcome['rc'], wallSeconds=outcome['wall'], sampledRssBytes=outcome['peak_rss'], sampledScratchBytes=outcome['peak_scratch'], stopIssue='bounded-process-stop' if outcome['issue'] else None),
                           sampledScratchRemovedBytes=scratch.record['peak'], scratchAbsent=not os.path.lexists(scratch.root),
                           manifestState=manifest.get('state'), markerPresent=marker.is_file() and not marker.is_symlink(),
                           launcherAbsent=cancel.is_set(), groups=[dict(pgid=p, absent=resources.group_has_live_members(p) is False) for p in scratch.record['groups']],
                           completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            receipt['leftovers'] = ([str(scratch.root)] if os.path.lexists(scratch.root) else []) + ['pgid:' + str(g['pgid']) for g in receipt['groups'] if not g['absent']]
            if release['status'] not in ('not-acquired', 'released'):
                receipt['leftovers'].append('reservation:' + scratch.token)
            resources.atomic_json(rdir / 'supervisor-receipt.json', receipt)
    return receipt


def main():
    require(len(sys.argv) == 2 and Path(sys.argv[1]).resolve() == BASE / 'execution-selection.json')
    selected = read_small(sys.argv[1], 131072)
    require(selected['schemaVersion'] == 'f59-settings-execution-selection.v1' and selected['executable'] is True
            and selected['supervisorSha256'] == digest(__file__) and selected['qualificationDate'] == datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    require(set(selected['fileHashes']) == {'diagnostic-plan.json', 'run-settings.mjs', 'execution-handoff.json'})
    for name, expected in selected['fileHashes'].items():
        require(digest(BASE / name) == expected)
    for name in ('code', 'security'):
        review = selected['reviews'][name]
        require(review['verdict'] == 'passed' and digest(review['path']) == review['sha256'])
    require(digest(PROJECT / '_tools/test_resources.py') == selected['resourceToolSha256'] and digest(PROJECT / '_tools/scaffold_git.py') == selected['gitToolSha256'])
    handoff = read_small(BASE / 'execution-handoff.json', 131072)
    root = Path(selected['producerRoot'])
    require(root == PRODUCER and root.resolve() == root and selected['remoteVerifiedCommit'] == selected['producerCommit'])
    os.environ['SCAFFOLDING_HARNESS'] = 'codex'
    sg = load('settings_supervisor_git', PROJECT / '_tools/scaffold_git.py')
    with sg.checkout_mutex(root):
        for args, expected in ((['rev-parse', 'HEAD'], selected['producerCommit']), (['status', '--porcelain', '--untracked-files=no'], '')):
            rc, value, error = sg.git(root, args)
            require(rc == 0 and value.strip() == expected)
    rc, value, error = sg.git(root, ['ls-remote', 'origin', 'refs/heads/dev/DEV-2026-11-04-032'])
    require(rc == 0 and value.split() == [selected['producerCommit'], 'refs/heads/dev/DEV-2026-11-04-032'])
    for path, expected in {**handoff['producer']['moduleHashes'], **handoff['producer']['reviewedCodeTestHashes'], **handoff['producer']['frozenContractHashes']}.items():
        require(digest(root / path) == expected)
    require(digest(selected['nodeRuntime']) == selected['runtimeSha256'])
    marker, output = Path(handoff['onceMarker']['path']), Path(handoff['resources']['retainedOutputRoot'])
    require(marker == BASE / 'settings-execution-once.json' and output == BASE / 'observation')
    allocation = dict(handoff['allocationTemplate'], executable=True, producerRoot=str(root), producerCommit=selected['producerCommit'],
                      remoteVerifiedCommit=selected['remoteVerifiedCommit'], runtimeSha256=selected['runtimeSha256'],
                      runnerSha256=selected['fileHashes']['run-settings.mjs'], supervisorSha256=selected['supervisorSha256'],
                      handoffSha256=selected['fileHashes']['execution-handoff.json'], reviewVerdicts=dict(code='passed', security='passed'),
                      codeTestIdentity=handoff['producer']['reviewedCodeTestIdentity'], transportKind='live', qualificationDate=selected['qualificationDate'])
    resources = load('settings_supervisor_resources', PROJECT / '_tools/test_resources.py')
    launcher = dict(pid=os.getppid(), start=resources.process_identity(os.getppid()))
    require(launcher['pid'] > 0 and type(launcher['start']) is str and launcher['start'])
    receipt = supervise_once(command=[selected['nodeRuntime'], str(BASE / 'run-settings.mjs'), '{allocation}'], cwd=root,
                             rdir=BASE / 'supervision', output=output, marker=marker, allocation=allocation,
                             launcher_owner=launcher, resources=resources)
    summary, code = terminal_result(receipt)
    print(json.dumps(summary))
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('settings-supervisor-stopped; preserve marker; no automatic replay')
        sys.exit(2)
