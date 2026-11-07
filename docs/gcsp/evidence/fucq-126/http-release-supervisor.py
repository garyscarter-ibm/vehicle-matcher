#!/usr/bin/env python3
"""Future six-case launcher. Admission, manifest binding and reviewed resource contract are mandatory."""
import contextlib
import hashlib
import importlib.util
import json
import os
import re
import selectors
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse


class ChunkDeadlineExceeded(RuntimeError):
    pass


def remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise ChunkDeadlineExceeded('The single chunk deadline was reached.')
    return value


def sha(path, deadline):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        while True:
            remaining(deadline)
            data = stream.read(1024 * 1024)
            if not data:
                return value.hexdigest()
            value.update(data)


@contextlib.contextmanager
def handled_scope(work_deadline):
    # Armed before source checks and before the first output/ownership allocation.
    previous = {}

    def terminate(signum, _frame):
        if signum == signal.SIGALRM:
            raise ChunkDeadlineExceeded('Work deadline reached; enter bounded finalization.')
        raise KeyboardInterrupt('Supervisor received signal %d' % signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, terminate)
        signal.setitimer(signal.ITIMER_REAL, remaining(work_deadline))
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def run(manifest_path, expected_manifest_sha256, started, work_deadline, deadline):
    manifest_path = Path(manifest_path).resolve()
    if not re.fullmatch('[0-9a-f]{64}', expected_manifest_sha256):
        raise RuntimeError('Supply the exact admitted manifest SHA256 as the second argument.')
    with manifest_path.open('rb') as stream:
        manifest_bytes = stream.read(2 * 1024 ** 2 + 1)
    if len(manifest_bytes) > 2 * 1024 ** 2 or hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_sha256:
        raise RuntimeError('Manifest identity differs from the explicit admitted hash.')
    plan = json.loads(manifest_bytes)
    if plan.get('executionAuthorized') is not True or plan.get('executionReady') is not True:
        raise RuntimeError('Source authoring is not execution admission.')
    root = Path(plan['candidateRoot']).resolve()
    if len(plan['caseNames']) != 6 or len(set(plan['caseNames'])) != 6:
        raise RuntimeError('Freeze six distinct exact case names.')
    files = {str((root / row['path']).resolve()): row for row in plan['files']}

    def verify_sources(until):
        if sha(manifest_path, until) != expected_manifest_sha256:
            return False
        for row in plan['files']:
            remaining(until)
            path = root / row['path']
            if not path.is_file() or str(path.resolve()) != row['target'] or path.stat().st_size != row['bytes'] \
                    or sha(path, until) != row['sha256']:
                return False
        for entry in plan['directories']:
            folder = root / entry['path']; members = []
            for path in folder.rglob('*'):
                remaining(until)
                if path.is_symlink() and path.is_dir():
                    return False
                if path.is_file():
                    members.append(str(path.relative_to(folder)))
            if sorted(members) != entry['files']:
                return False
        for entry in plan.get('absentFiles', []):
            remaining(until)
            if os.path.lexists(root / entry):
                return False
        node = plan['node']; path = Path(node['path'])
        if str(path.resolve()) != node['target'] or sha(path, until) != node['sha256']:
            return False
        for link in plan['dependencyLinks']:
            path = root / link['path']; current = path.lstat()
            if (str(path.resolve()), current.st_dev, current.st_ino) != (link['target'], link['device'], link['inode']):
                return False
        return True

    def frozen(name):
        path = (root / plan[name]).resolve()
        if str(path) not in files:
            raise RuntimeError('Unpinned launcher/input: ' + name)
        return path

    if not verify_sources(work_deadline):
        raise RuntimeError('Frozen candidate/source/dependency identity differs.')
    resource_path, guard_path, test_path = frozen('resourceHelper'), frozen('childGuard'), frozen('caseFile')
    classification = plan.get('readClassification', {})
    if classification.get('method') != 'finite-static-source-review' or classification.get('filesystemReadsObserved') is not False \
            or not classification.get('sites') or classification.get('unclassifiedSites') != []:
        raise RuntimeError('Require the explicit bounded static read classification.')
    if frozen('supervisor') != Path(__file__).resolve():
        raise RuntimeError('This supervisor is not the frozen launcher.')
    for name in plan['profileFiles']:
        if str((root / name).resolve()) not in files:
            raise RuntimeError('Source profile input is unpinned.')

    def load(name, path):
        remaining(work_deadline)
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec); sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    R = load('fucq126_resources', resource_path)
    guard = load('fucq126_child_guard', guard_path)
    S = load('fucq126_strict_resources', frozen('strictResourceWrapper'))
    required = plan['resourceContractRequirement']
    if required.get('mode') != 'story-owned-strict-seven-key' or sha(resource_path, work_deadline) != required['helperSha256']:
        raise RuntimeError('Require the unchanged pinned shared helper and the isolated strict wrapper.')
    if sha(frozen('strictResourceWrapper'), work_deadline) != required['wrapperSha256']:
        raise RuntimeError('Story-owned resource wrapper identity differs.')
    if plan.get('resourceQueryBudget') != {'work': 768, 'cleanupReserved': 256, 'total': 1024, 'sampleSeconds': 0.5}:
        raise RuntimeError('Require the fixed separate work/cleanup query allowance and sampling interval.')
    policy = R.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 2,
                       'local_scratch_reason': 'Bounded macOS Node IPC and V8 module observations.'})
    host_root = Path(plan['hostRegistryRoot'])
    if not host_root.is_absolute() or str(host_root.resolve()) != str(host_root):
        raise RuntimeError('Pin an absolute canonical machine-wide resource registry.')
    if plan.get('parentReservation') is not None or os.environ.get('TEST_RESOURCE_PARENT_RESERVATION') != plan.get('parentReservation'):
        raise RuntimeError('Unexpected parent reservation; independently admit the intended parent.')
    contract = plan['hostBudget']
    if contract.get('directory') != str(host_root) or contract.get('anchors') is None:
        raise RuntimeError('Fresh explicit host-directory/lock anchors are required before admission.')
    if any(contract.get(key) != value for key, value in {
            'diskBytes': 128 * R.MIB, 'ramBytes': 768 * R.MIB, 'emergencyReserveBytes': policy.reserve,
            'ramReserveBytes': int(policy.ram_reserve_mib * R.MIB), 'preferredFreeBytes': policy.preferred}.items()):
        raise RuntimeError('Admitted resource contract differs from the fixed six-case limits.')
    output = Path(plan['outputRoot'])
    if not output.is_absolute() or str(output.parent.resolve(strict=True)) != str(output.parent) \
            or not output.name.startswith('fucq126-') or not S.definitely_absent(output) or root in output.parents:
        raise RuntimeError('Require a fresh external owned FUCQ-126 output root.')
    output_owner = output.parent / 'ownership' / (output.name + '.json')
    if not S.definitely_absent(output_owner):
        raise RuntimeError('Preserve existing ownership evidence.')
    locale = {key: {'value': value if re.fullmatch(r'[A-Za-z0-9_.@-]{0,128}', value) else '<redacted-invalid-locale>',
                    'sha256': hashlib.sha256(value.encode()).hexdigest()}
              for key, value in os.environ.items() if key == 'LANG' or re.fullmatch(r'LC_[A-Z_]+', key)}
    binding = {'locale': locale, 'manifest': str(manifest_path), 'manifestSha256': expected_manifest_sha256,
               'queryBudget': plan['resourceQueryBudget'], 'hostRegistry': str(host_root / 'reservations.json'), 'workSeconds': 90, 'finalizationSeconds': 30, 'chunkSeconds': 120}
    receipt = output / 'receipt.json'
    ownership = {'phase': 'not-launched'}; entered = reserved = attempted = created = False
    scratch = None; observer = None; tree = None; host = None; process = None; outcome = {}; failures = []; source_same = None
    primary_failure = None; secondary_failures = []

    def remember_failure(error):
        nonlocal primary_failure
        message = type(error).__name__ + ': ' + str(error)
        if primary_failure is None:
            primary_failure = message
        return message

    # This finalizer and the outer signal scope exist before the first allocation.
    try:
        R.atomic_json(output_owner, {'version': 1, 'owner': {'pid': os.getpid(), 'start': None}, 'root': str(output),
                                   'expectedBytes': 4 * R.MIB, 'state': 'planned', **binding})
        output.mkdir(); created = True
        scratch = S.Scratch(R, output, policy, receipt)
        observer = S.Observer(scratch, deadline)
        tree = S.Tree(R, scratch, observer, deadline)
        tree.until = work_deadline
        host = S.Budget(R, policy, contract, observer, work_deadline)
        scratch.save()
        R.atomic_json(receipt, {'state': 'planned', 'cases': plan['caseNames'], 'child': ownership, **binding})
        remaining(work_deadline)
        host.acquire(scratch, S.allocated_bytes(output)); reserved = True
        scratch.__enter__(); entered = True
        env = scratch.env(os.environ)
        for key in list(env):
            if key == 'DEMO_ACCESS_KEY' or key.startswith(('PG', 'NODE_', 'NPM_', 'npm_', 'GCSP_', 'TEST_RESOURCE_')) \
                    or re.search(r'(DATABASE|POSTGRES|DB|SQL).*URL', key, re.I):
                env.pop(key, None)
        env.update(NODE_V8_COVERAGE=str(scratch.root / 'coverage'),
                   GCSP_VEHICLE_EVIDENCE_ROOT=str(root / plan['vehicleEvidenceRoot']),
                   TEST_RESOURCE_HOST_DIR=str(host_root), TEST_RESOURCE_PARENT_RESERVATION=scratch.token)
        command = [plan['node']['path'], '--test', '--test-concurrency=1', '--test-reporter=tap', str(test_path)]
        log = scratch.root / 'original.tap'; peak_rss = 0; log_bytes = 0

        def identify(pid):
            try:
                return tree.identify(pid)
            except BaseException as error:
                remember_failure(error)
                raise

        def register(child, record):
            # Child state belongs only to this external ownership journal, never the shared row.
            try:
                tree.register(child)
                scratch.record.update(child=record, launchPending=False)
                scratch.save()
                R.atomic_json(receipt, {'state': 'running', 'command': command, 'child': dict(record), **binding})
            except BaseException as error:
                remember_failure(error)
                raise

        def stop_join(child):
            try:
                return tree.stop_join(child)
            except BaseException as error:
                remember_failure(error)
                raise

        def absent(child, record):
            try:
                proof = tree.proof(deadline)
                return all(proof[key] is True for key in ('joined', 'pidsAbsent', 'groupsAbsent', 'portsClosed'))
            except BaseException as error:
                remember_failure(error)
                raise

        scratch.record.update(child=ownership, launchPending=True)
        scratch.save()
        attempted = True
        next_sample = time.monotonic()
        with log.open('wb') as stream, selectors.DefaultSelector() as selector:
            try:
                with guard.cancellation_safe_child(command, ownership=ownership, identify=identify,
                        register=register,
                        stop_join=stop_join,
                        verify_absent=absent, cwd=root, env=env, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT) as process:
                    try:
                        selector.register(process.stdout, selectors.EVENT_READ)
                        while process.poll() is None or selector.get_map():
                            remaining(work_deadline)
                            for key, _ in selector.select(timeout=min(0.1, remaining(work_deadline))):
                                data = os.read(key.fd, 65536)
                                if not data:
                                    selector.unregister(key.fileobj)
                                    continue
                                available = 2 * R.MIB - log_bytes
                                stream.write(data[:available]); stream.flush(); log_bytes += min(len(data), available)
                                if len(data) > available:
                                    raise RuntimeError('Capped TAP pipe exceeded its 2 MiB allowance; child stopped.')
                            if time.monotonic() < next_sample:
                                continue
                            next_sample = time.monotonic() + 0.5
                            used = scratch.sample() + S.allocated_bytes(output)
                            try:
                                rss = tree.rss(work_deadline)
                            except BaseException as error:
                                # Keep the primary observation failure even if full-charge telemetry also fails.
                                remember_failure(error)
                                try:
                                    host.update(scratch.token, used, 768 * R.MIB)
                                except BaseException as update_error:
                                    secondary_failures.append('Full-charge telemetry: ' + type(update_error).__name__ + ': ' + str(update_error))
                                raise
                            peak_rss = max(peak_rss, rss)
                            if host.update(scratch.token, used, rss) is not True:
                                raise RuntimeError('Resource accounting could not be updated safely.')
                            if scratch.sample() > 124 * R.MIB or used > 128 * R.MIB or rss > 768 * R.MIB:
                                raise RuntimeError('Owned combined disk/RAM limit exceeded.')
                            if shutil.disk_usage(scratch.root).free < policy.reserve:
                                raise RuntimeError('Emergency free-space reserve reached.')
                    except BaseException as error:
                        remember_failure(error)
                        raise
            finally:
                if process is not None and process.stdout is not None:
                    process.stdout.close()
        if not ownership.get('cleanupVerified'):
            raise RuntimeError('Actual handle/group cleanup is unverified.')
        remaining(work_deadline)
        if scratch.sample() > 124 * R.MIB or scratch.sample() + S.allocated_bytes(output) > 128 * R.MIB:
            raise RuntimeError('Final combined allocation exceeded its bound.')
        tap = log.read_text()
        names = re.findall(r'^# Subtest: (.+)$', tap, re.M)
        totals = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', tap, re.M)}
        if names != plan['caseNames'] or totals != {'tests': 6, 'pass': 6, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}:
            raise RuntimeError('Original TAP names/counts do not establish the exact six-case result.')
        observed = set(); coverage_bytes = 0; coverage_files = 0
        for file in (scratch.root / 'coverage').glob('*.json'):
            remaining(work_deadline); coverage_files += 1; size = file.stat().st_size; coverage_bytes += size
            if coverage_files > 128 or size > 8 * R.MIB or coverage_bytes > 64 * R.MIB:
                raise RuntimeError('V8 module observations exceed their finite parse allowance.')
            for script in json.loads(file.read_text()).get('result', []):
                remaining(work_deadline)
                if script['url'].startswith('file:'):
                    observed.add(str(Path(unquote(urlparse(script['url']).path)).resolve()))
        required_modules = {str((root / path).resolve()) for path in ['server/index.js', 'server/gcsp/runtime.js',
            'server/gcsp/stock/index.js', 'blocks/gcsp/presenter-controls/controls.js',
            'blocks/gcsp/presenter-controls/http-adapter.js', 'server/test/helpers/presenter-http-proof.js']}
        if not required_modules.issubset(observed) or observed - files.keys():
            raise RuntimeError('Required actual modules unobserved or file modules unpinned.')
        if not verify_sources(work_deadline):
            raise RuntimeError('Candidate changed during execution.')
        (output / 'original.tap').write_text(tap)
        outcome = {'rc': process.returncode, 'names': names, 'totals': totals, 'tapSha256': sha(log, work_deadline),
                   'modules': sorted(observed), 'filesystemReadsObserved': False, 'readClassification': classification,
                   'wallSeconds': time.monotonic() - started, 'peakRss': peak_rss, 'peakScratch': scratch.record['peak']}
        if process.returncode != 0 or S.allocated_bytes(output) > 4 * R.MIB:
            raise RuntimeError('Command failed or retained-output allowance exceeded.')
    except BaseException as error:
        current = remember_failure(error)
        failures.append(primary_failure)
        if current != primary_failure:
            secondary_failures.append('Guard/outer failure: ' + current)
        if entered and (scratch.root / 'original.tap').is_file() and created and not (output / 'original.tap').exists():
            try:
                with (scratch.root / 'original.tap').open('rb') as stream:
                    (output / 'failure.tap').write_bytes(stream.read(2 * R.MIB))
            except BaseException as copy_error:
                failures.append('Bounded failure output: ' + type(copy_error).__name__)
    finally:
        # Allocation, child work, postprocessing, source passes and teardown share this one absolute deadline.
        final_deadline = min(deadline, time.monotonic() + 30)
        signal.setitimer(signal.ITIMER_REAL, max(0.001, final_deadline - time.monotonic()))
        # Intent is set before the ledger write; ambiguous acquire/readback keeps its charge visible.
        reserved = host is not None and host.expected is not None
        try:
            remaining(final_deadline)
            if observer is not None:
                observer.begin_cleanup()
            if scratch is not None:
                if tree is None or observer is None:
                    raise RuntimeError('Partial lifecycle setup; retain external ownership evidence.')
                proof = S.cleanup_scratch(scratch, tree, observer, final_deadline, attempted, ownership)
                if reserved:
                    host.deadline = final_deadline
                    host.release(scratch.token, proof)
                    if not host.absence(scratch.token):
                        raise RuntimeError('Owned reservation absence is unproven after release.')
                    reserved = False
        except BaseException as error:
            failures.append('Cleanup issue: ' + type(error).__name__ + ': ' + str(error))
        finally:
            # Persistence/probe failures never bypass the direct Popen wait handle.
            if tree is not None and tree.process is not None and not tree.joined:
                try:
                    tree.join_direct()
                except BaseException as error:
                    failures.append('Direct child join incomplete: ' + type(error).__name__)
            if observer is not None:
                try:
                    if not observer.finish(final_deadline):
                        failures.append('Lifecycle query cleanup remains unverified.')
                except BaseException as error:
                    failures.append('Lifecycle query cleanup issue: ' + type(error).__name__)
        try:
            source_same = verify_sources(final_deadline)
            if not source_same:
                failures.append('Final source/dependency/Node identity changed.')
        except BaseException as error:
            failures.append('Final source verification incomplete: ' + type(error).__name__)
        try:
            remaining(final_deadline)
            result = {'state': 'passed' if not failures and outcome.get('rc') == 0 else 'failed', 'failures': failures,
                      'primaryFailure': primary_failure, 'secondaryFailures': secondary_failures,
                      'child': ownership, 'result': outcome,
                      'scratchManifest': str(scratch.manifest) if scratch is not None else None,
                      'scratchAbsent': scratch is None or S.definitely_absent(scratch.root), 'reservationReleased': not reserved,
                      'sourceUnchanged': source_same, 'independentAuditRequired': True,
                      'resourceContract': required, 'fleetRisk': plan['fleetRisk'],
                      'processAbsence': scratch.record.get('processAbsence') if scratch is not None else None,
                      'wallSeconds': time.monotonic() - started, **binding,
                      'retention': 'Audit bounded original TAP, child/groups/open files, scratch and reservations; retain concise receipt.'}
            if created:
                if len(json.dumps(result).encode()) + S.allocated_bytes(output) > 4 * R.MIB:
                    result.update(state='failed', failures=['Retained output would exceed its allowance.'], result={})
                R.atomic_json(receipt, result)
            R.atomic_json(output_owner, {'version': 1, 'owner': scratch.record['owner'] if scratch is not None else {'pid': os.getpid(), 'start': None}, 'root': str(output),
                'state': 'cleanup-issue-reservation-retained' if reserved else 'retained-summary-awaiting-audit' if created else 'allocation-incomplete',
                'receipt': str(receipt) if created else None, 'child': ownership, **binding})
            print(json.dumps({'state': result['state'], 'receipt': str(receipt) if created else None, 'failures': failures}))
        except BaseException:
            # If the deadline prevents a final write, the already persisted owner/launch records remain authoritative.
            # Never release a reservation or delete more files merely to produce a successful receipt.
            raise RuntimeError('Final receipt incomplete; reconcile the existing external owner/child records before reuse.')
    return 0 if result['state'] == 'passed' else 1


def main(manifest_path, expected_manifest_sha256):
    started = time.monotonic()
    work_deadline, deadline = started + 90, started + 120
    with handled_scope(work_deadline):
        return run(manifest_path, expected_manifest_sha256, started, work_deadline, deadline)


if __name__ == '__main__':
    raise SystemExit(main(*sys.argv[1:]))
