"""Unexecuted C4 proposal. Exact independent source/harness review is required.

Only the hash-admitted bounds helper precedes monitored full admission.
No source mirror or child before strict reservation.
The only selected command is the four-case C4 file. No automatic retry.
"""
import time
STARTED = time.monotonic()

import argparse
from contextlib import redirect_stdout, redirect_stderr
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid
import shutil
import signal
import threading

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
OUT = ROOT.parents[2] / '.claude/test-runs/fucq122-c4'
MIB = 1024 ** 2
CANDIDATE = 'f179ae6043414a2b07de3edb2b425338299ea37b'
BOUNDS = MONITOR = OUTPUTS = REGISTRY = None


def check():
    MONITOR.check()
    return OUTPUTS.observe()



def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    def constant(value):
        raise ValueError('Nonstandard JSON constant')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def physical(path, expected):
    value, target = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': target.st_dev, 'targetInode': target.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if 'sha256' in expected:
        data = BOUNDS.read_bytes(path.resolve(strict=True), BOUNDS.CONTRACT['input_bytes'])
        row.update(sha256=sha(data), bytes=len(data))
    if row != {key: value for key, value in expected.items() if key != 'realpath'}:
        raise RuntimeError('Frozen physical/content identity differs: ' + str(path))


def admit(expected_sha, source_required=True):
    if not sys.flags.isolated or not sys.dont_write_bytecode or Path.cwd() != ROOT:
        raise RuntimeError('Use /usr/bin/python3 -I -B in the owned checkout')
    check()
    data = BOUNDS.read_bytes(HERE / 'case-release-admission.json', BOUNDS.CONTRACT['bootstrap_bytes'])
    if sha(data) != expected_sha:
        raise RuntimeError('Exact reviewed admission SHA differs')
    frozen = strict_json(data)
    if frozen['root'] != str(ROOT) or frozen['output'] != str(OUT) \
            or frozen['pythonExecutable'] != sys.executable or frozen['pythonVersion'] != sys.version:
        raise RuntimeError('Frozen execution location/interpreter differs')
    if frozen['limits'] != {'seconds': 120, 'rssMiB': 768, 'scratchAndRetainedMiB': 128, 'logAndJournalMiB': 2, 'workers': 1}:
        raise RuntimeError('C4 finite limits differ')
    if frozen['accounting'] != BOUNDS.CONTRACT:
        raise RuntimeError('Frozen accounting contract differs')
    for name, expected in frozen['nodes'].items():
        check()
        physical(Path(name), expected)
    for name in frozen['absence']:
        if os.path.lexists(name):
            raise RuntimeError('Frozen dependency absence differs')
    if not source_required:
        return frozen, None
    source_bytes = BOUNDS.read_bytes(HERE / 'case-release-source-plan.json', BOUNDS.CONTRACT['source_plan_bytes'])
    if sha(source_bytes) != frozen['sourcePlanSHA256']:
        raise RuntimeError('Frozen source plan differs')
    source = strict_json(source_bytes)
    if source['candidate'] != CANDIDATE or source['status'] != 'frozen-for-review' or source['pending'] \
            or source['test'] != 'server/test/gcsp-case-release-http.test.js' or len(source['expectedNames']) != 4:
        raise RuntimeError('C4 source/profile/test contract is incomplete')
    if len(source['rows']) != 121 or len(source['edges']) != 298 or len(source['installed']['files']) != 138 \
            or len(source['installed']['packages']) != 14:
        raise RuntimeError('Reviewed source/installed cardinality differs')
    expected_child = ['/usr/bin/python3', '-I', '-B', str(HERE / 'case-release-launch.py'), frozen['node'],
                      '--loader', str(HERE / 'case-release-loader.mjs'), '--test', '--test-reporter=tap',
                      '--test-concurrency=1', '{ownedSourceMirror}/' + source['test']]
    if frozen['commands']['childTemplate'] != expected_child:
        raise RuntimeError('C4 selected child command differs')
    for name, row in source['installed']['files'].items():
        check()
        physical(Path(name), row)
    inventoried = set(source['installed']['files'])
    for directory in source['installed']['packages']:
        check()
        found = set()
        entries = 0
        for folder, dirs, names in os.walk(directory, followlinks=False):
            entries += len(dirs) + len(names)
            if entries > BOUNDS.CONTRACT['entries']:
                raise RuntimeError('Installed inventory traversal cap')
            check()
            dirs[:] = sorted(name for name in dirs if name not in ['node_modules', '.git'])
            if any((Path(folder) / name).is_symlink() for name in dirs):
                raise RuntimeError('Uninventoried installed directory link')
            found.update(str(Path(folder) / name) for name in names)
        expected = {name for name in inventoried if Path(name).is_relative_to(directory)}
        if found != expected:
            raise RuntimeError('Frozen installed package file set differs')
    for row in source['installed']['absentOptional']:
        if any(os.path.lexists(path) for path in row['absentCandidates']):
            raise RuntimeError('Frozen optional dependency absence differs')
    return frozen, source


def imported(frozen, name, path):
    physical(path, frozen['nodes'][str(path)])
    check()
    data = BOUNDS.read_bytes(path, BOUNDS.CONTRACT['input_bytes'])
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    with redirect_stdout(BOUNDS.Quiet()), redirect_stderr(BOUNDS.Quiet()):
        exec(compile(data, str(path), 'exec'), module.__dict__)
    check()
    return module


def source_audit(source, sg):
    for row in source['rows']:
        check()
        if type(row['bytes']) is not int or not 0 <= row['bytes'] <= BOUNDS.CONTRACT['input_bytes'] \
                or len(row['base64']) > 4 * ((row['bytes'] + 2) // 3):
            raise RuntimeError('Source row byte bound differs')
        data = base64.b64decode(row['base64'], validate=True)
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        rc, out, error = sg.git(ROOT, ['rev-parse', row['ref'] + ':' + row['path']])
        if rc or out.strip() != blob or blob != row['gitBlob'] or sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Immutable source byte/object mismatch: ' + row['path'])
    return {'candidate': source['candidate'], 'profileRef': source['profileRef'], 'testRef': source['testRef'],
            'rows': len(source['rows']), 'verified': True}


def materialize(source, mirror):
    mirror.mkdir()
    for row in source['rows']:
        check()
        path = mirror / row['path']
        if not path.is_relative_to(mirror) or '..' in Path(row['path']).parts or Path(row['path']).is_absolute():
            raise RuntimeError('Source mirror path escapes owned scratch')
        path.parent.mkdir(parents=True, exist_ok=True)
        data = base64.b64decode(row['base64'], validate=True)
        if sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Mirror input differs')
        before = OUTPUTS.observe()
        if before['charged_combined_bytes'] + len(data) + 8192 > BOUNDS.CONTRACT['combined_bytes']:
            raise RuntimeError('Source materialization would exceed grant')
        with path.open('xb') as target:
            target.write(data)
        check()


def mirror_audit(source, mirror):
    expected = {row['path'] for row in source['rows']}
    actual = set()
    entries = 0
    for folder, dirs, files in os.walk(mirror, followlinks=False):
        check()
        entries += len(dirs) + len(files)
        if entries > BOUNDS.CONTRACT['entries']:
            raise RuntimeError('Mirror inventory traversal cap')
        if any((Path(folder) / name).is_symlink() for name in dirs + files):
            raise RuntimeError('Source mirror contains an unexpected link')
        actual.update(str((Path(folder) / name).relative_to(mirror)) for name in files)
    if actual != expected:
        raise RuntimeError('Source mirror contains undeclared/missing files')
    for row in source['rows']:
        check()
        data = BOUNDS.read_bytes(mirror / row['path'], BOUNDS.CONTRACT['input_bytes'])
        if sha(data) != row['sha256'] or len(data) != row['bytes']:
            raise RuntimeError('Source mirror changed')


def report_tests(dest, source, mirror):
    check()
    raw = BOUNDS.read_bytes(dest / 'output.log', BOUNDS.CONTRACT['log_bytes'])
    text = raw.decode('utf-8', errors='strict')
    names = re.findall(r'^(?:not )?ok \d+ - (.*)$', text, re.M)
    counts = {match[1]: int(match[2]) for match in re.finditer(r'^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', text, re.M)}
    if names != source['expectedNames'] or counts != {'tests': 4, 'suites': 0, 'pass': 4, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0} \
            or re.search(r'^not ok|^Bail out!|# (?:SKIP|TODO)', text, re.M):
        raise RuntimeError('Original TAP does not prove the exact four C4 cases')
    data = BOUNDS.read_bytes(dest / 'modules.jsonl', BOUNDS.CONTRACT['journal_bytes'])
    journal = [strict_json(line) for line in data.splitlines()]
    urls = {row['path']: (mirror / row['path']).as_uri() for row in source['rows']}
    wanted = {urls[row['path']]: row['sha256'] for row in source['rows'] if row['kind'] == 'module'}
    loads = {row['url']: row['sha256'] for row in journal if row['kind'] == 'application-load'}
    required = [source['test'], 'server/gcsp/runtime.js', 'server/index.js', 'server/gcsp/cases/index.js',
                'server/gcsp/stock/index.js', 'server/gcsp/manual-claims/index.js', 'server/gcsp/offers/buddy-hold.js',
                'server/test/helpers/runtime-composition-profile.js', 'blocks/gcsp/cases/http-adapter.js']
    if any(loads.get(urls[path]) != wanted[urls[path]] for path in required) or any(wanted.get(url) != digest for url, digest in loads.items()):
        raise RuntimeError('Required C4 actual modules were not admitted/loaded')
    if not any(row['kind'] == 'loader-registration' for row in journal):
        raise RuntimeError('Exact loader registration was not observed')
    return {'counts': counts, 'names': names, 'observedApplicationModules': len(loads),
            'declaredModules': len(wanted), 'outputSHA256': sha(raw), 'moduleJournalSHA256': sha(data),
            'installedCoverage': 'Static complete package inventory; no exhaustive CommonJS coverage claim.'}


def execute(frozen, args, tr, guard, ledger, sg, cancel, dest):
    policy = tr.Policy({'chunk_seconds': 120, 'chunk_ram_mib': 768, 'chunk_scratch_mib': 128,
                        'log_mib': 2, 'reserve_free_gib': 5, 'ram_reserve_mib': 512})
    scratch = host = tree = finalizer = None
    result, failure, source = {}, None, None
    last_charge = 0.0

    def charge(force=False):
        nonlocal last_charge
        value = check()
        if host is not None and host.expected is not None and (force or time.monotonic()-last_charge >= 0.2):
            # Credit none of the reservation back to concurrent launchers. Charged
            # high-water/transient observations are evidence, not currently consumed host bytes.
            host.update(scratch.token, 0, 0)
            last_charge = time.monotonic()
        return value

    def problem(error):
        return {'type': type(error).__name__, 'message': str(error)[:1024]}

    try:
        with REGISTRY.lock:
            REGISTRY.record['scratchConstructor'] = 'planned'
            REGISTRY.save()
        # Both constructor identity probes already have external run/owner/probe intents.
        scratch = guard.make_scratch(tr, dest, ROOT, policy)
        OUTPUTS.scratch = scratch.root
        with REGISTRY.lock:
            REGISTRY.record.update(scratchConstructor='returned', scratchRoot=str(scratch.root),
                                   scratchManifest=str(scratch.manifest))
            REGISTRY.save()
        scratch.record['processManifest'] = str(REGISTRY.path)
        host = ledger.Budget(tr, policy, frozen['ledgerContract'], BOUNDS, STARTED+120, scratch)
        tree = guard.ProcessTree(tr, scratch)
        finalizer = guard.Finalizer(tr, scratch, tree, host, MONITOR)
        mirror = scratch.root / 'source'
        # Manifest/intent writes are bounded and charged before scratch or source creation.
        tr.atomic_json(scratch.manifest, scratch.record)
        host.acquire(scratch.token, 128*MIB, 768*MIB, scratch.root.parent, root=scratch.root)
        charge(True)
        frozen, source = admit(args.admission_sha)
        charge(True)
        tr.atomic_json(dest / 'checkpoint.json', {'state': 'incomplete', 'selected': source['expectedNames']})
        tr.atomic_json(dest / 'plan.json', {'admissionSHA256': args.admission_sha, 'grant': args.dispatcher_grant,
            'sourceBefore': source_audit(source, sg), 'limits': frozen['limits'], 'accounting': frozen['accounting'],
            'manifest': str(scratch.manifest), 'owner': scratch.record['owner'],
            'scope': 'actual C4 in-process HTTP; synthetic TEST input; no listener'})
        charge(True)
        scratch.__enter__()
        materialize(source, mirror)
        mirror_audit(source, mirror)
        charge(True)
        journal = dest / 'modules.jsonl'
        OUTPUTS.write(journal, b'', BOUNDS.CONTRACT['journal_bytes'], exclusive=True)
        loader = HERE / 'case-release-loader.mjs'
        entry = mirror / source['test']
        command = [argument.replace('{ownedSourceMirror}', str(mirror)) for argument in frozen['commands']['childTemplate']]
        env = scratch.env(dict(frozen['environment']))
        env.update(FUCQ122_C4_PLAN=str(HERE / 'case-release-source-plan.json'),
                   FUCQ122_C4_PLAN_SHA=frozen['sourcePlanSHA256'], FUCQ122_C4_MIRROR=str(mirror),
                   FUCQ122_C4_JOURNAL=str(journal), FUCQ122_C4_NODE=frozen['node'],
                   FUCQ122_C4_NODE_SHA=frozen['nodes'][frozen['node']]['sha256'], FUCQ122_C4_LOADER=str(loader),
                   FUCQ122_C4_LOADER_SHA=frozen['nodes'][str(loader)]['sha256'], FUCQ122_C4_ENTRY=str(entry))
        written, tail = 0, b''
        # Leave 30 seconds of the same 120-second envelope for join/cleanup/completion.
        child_deadline = STARTED + 120 - BOUNDS.CONTRACT['completion_reserve_seconds']
        if time.monotonic() >= child_deadline:
            raise RuntimeError('Admission consumed selected-worker time; no launch')
        with (dest / 'output.log').open('xb') as stream:
            process = tree.launch(command, cwd=ROOT, env=env, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            with REGISTRY.lock:
                REGISTRY.record['nodePid'] = process.pid
                REGISTRY.save()
            tree.register(process)
            MONITOR.groups = list(scratch.record['groups'])
            os.set_blocking(process.stdout.fileno(), False)

            def drain():
                nonlocal written, tail
                try:
                    block = os.read(process.stdout.fileno(), 65536)
                except BlockingIOError:
                    return False
                room = BOUNDS.CONTRACT['log_bytes'] - written
                # Independent fixed writer caps sum to exactly 2MiB, including a concurrent loader write.
                value = check()
                if value['charged_combined_bytes'] + len(block) + 8192 > BOUNDS.CONTRACT['combined_bytes'] \
                        or value['retained_allocated_bytes'] + BOUNDS.CONTRACT['stream_disk_allowance'] + len(block) + 8192 > BOUNDS.CONTRACT['retained_bytes']:
                    raise RuntimeError('C4 TAP prewrite allocation cap reached')
                if len(block) > room:
                    if room:
                        stream.write(block[:room]); stream.flush(); written += room
                    raise RuntimeError('Original C4 TAP byte cap reached')
                stream.write(block); stream.flush(); written += len(block)
                tail = (tail + block)[-131072:]
                if re.search(rb'(?m)^not ok|^Bail out!', tail):
                    raise RuntimeError('First original TAP failure; stop without retry')
                return bool(block)

            charge(True)
            admit(args.admission_sha)
            mirror_audit(source, mirror)
            check()
            process.stdin.write(b'1'); process.stdin.flush(); process.stdin.close()
            while True:
                drain(); tree.observe(); charge()
                MONITOR.groups = list(scratch.record['groups'])
                if process.poll() is not None:
                    break
                if time.monotonic() >= child_deadline:
                    raise RuntimeError('Selected worker deadline reached; completion reserve begins')
                time.sleep(0.05)
            result['processAbsence'] = tree.stop_join()
            while drain():
                charge()
            result.update(rc=process.returncode, logBytes=written, command=command)
        if result['rc'] != 0:
            raise RuntimeError('C4 selected command failed; no retry authorised')
        charge(True)
        mirror_audit(source, mirror)
        result['tests'] = report_tests(dest, source, mirror)
    except BaseException as error:
        failure = problem(error)
    finally:
        # Failed telemetry still permits finite teardown diagnostics, never a success claim.
        OUTPUTS.diagnostics = True
        if tree is not None:
            try:
                result['processAbsence'] = tree.stop_join()
            except BaseException as error:
                failure = failure or problem(error)
        process = tree.process if tree is not None else None
        if process is not None:
            for pipe in [process.stdin, process.stdout]:
                if pipe is not None:
                    try:
                        pipe.close()
                    except OSError as error:
                        failure = failure or problem(error)
        cleanup = finalizer.finish() if finalizer is not None else {'passed': False}
    if scratch is None or host is None or tree is None or finalizer is None:
        raise SystemExit(2)  # Main's external registry owns and joins any constructor probes.
    preserved = False
    try:
        charge(True)
        admit(args.admission_sha)
        if source is not None:
            result['sourceAfter'] = source_audit(source, sg)
            preserved = True
        charge(True)
    except BaseException as error:
        failure = failure or problem(error)
    proof = {'child_safe': cleanup.get('joined') is True,
             'groups_absent': cleanup.get('groupsAbsent') is True,
             'processes_absent': cleanup.get('pidsAbsent') is True,
             'scratch_absent': cleanup.get('scratchAbsent') is True}
    bundle_written = False
    try:
        if host.expected is not None and all(proof.values()):
            host.prepare_final_release(scratch.token)
        value = charge(True)
        candidate = failure is None and cleanup['passed'] and preserved and result.get('rc') == 0
        summary = {'story': 'FUCQ-122', 'scope': 'C4 actual release/case HTTP; labelled synthetic TEST input',
                   'admissionSHA256': args.admission_sha, 'grant': args.dispatcher_grant,
                   'status': 'pending-final-release-and-independent-audit', 'candidatePassed': candidate,
                   'failure': failure, 'result': result, 'cleanup': cleanup, 'pinsPreserved': preserved,
                   'manifest': str(scratch.manifest), 'processManifest': str(REGISTRY.path),
                   'ownedRoot': str(scratch.root), 'owner': scratch.record['owner'],
                   'wallSeconds': time.monotonic()-STARTED, 'allocation': value, 'aggregate': MONITOR.receipt()}
        OUTPUTS.json(dest/'summary.json', summary, BOUNDS.CONTRACT['summary_bytes'])
        OUTPUTS.json(dest/'checkpoint.json', {'state': 'pending-final-release-and-independent-audit',
                     'summary': str(dest/'summary.json')}, BOUNDS.CONTRACT['checkpoint_bytes'])
        charge(True)
        OUTPUTS.observe(); MONITOR.checkpoint()
        bundle_written = True
    except BaseException as error:
        failure = failure or problem(error)
    finally:
        try:
            MONITOR.stop()  # All active probes/direct handles joined while completion charge held.
        except BaseException as error:
            failure = failure or problem(error)
    try:
        # Last complete OS query: its own exact producer is directly joined and persisted.
        # A sealed registry prevents every later helper/probe launch, including ledger-owner probes.
        rows, helpers = MONITOR.final_checkpoint()
        final_child = tree.proof(rows)
        if not all(final_child[key] for key in ('joined', 'pidsAbsent', 'groupsAbsent')):
            raise RuntimeError('Final Node/process/group absence changed')
        proof.update(helpers_safe=all(helpers[key] for key in ('helpers_joined', 'helpers_absent', 'groups_absent')),
                     owner_start=helpers['owner_start'])
        candidate = failure is None and cleanup['passed'] and preserved and result.get('rc') == 0
        OUTPUTS.json(dest/'terminal.json', {'status': 'pending-final-release-and-independent-audit',
            'candidatePassed': candidate, 'failure': failure, 'admissionSHA256': args.admission_sha,
            'summarySHA256': sha(BOUNDS.read_bytes(dest/'summary.json', BOUNDS.CONTRACT['summary_bytes'])) if bundle_written else None,
            'manifestSHA256': sha(BOUNDS.read_bytes(scratch.manifest, BOUNDS.CONTRACT['json_bytes'])),
            'processManifest': str(REGISTRY.path),
            'processManifestSHA256': sha(BOUNDS.read_bytes(REGISTRY.path, BOUNDS.CONTRACT['json_bytes'])),
            'helperProof': helpers, 'reservationHeld': host.expected is not None,
            'allocation': OUTPUTS.observe(), 'aggregate': MONITOR.receipt(), 'independentAuditRequired': True,
            'completionRule': 'Require exit 0, exact terminal/summary/scratch+process manifest hashes, pins and independent all-process/group/scratch/ledger/staging absence. No stored passed result.'},
            BOUNDS.CONTRACT['terminal_bytes'], exclusive=True)
        # No ownership/retained artifact writes or process launches follow the terminal receipt.
        OUTPUTS.observe(); MONITOR.final_observe()
        if cancel.is_set() or scratch.record.get('cancellationDuringCleanup'):
            raise RuntimeError('Cancellation prevents successful completion')
        BOUNDS.emit(BOUNDS.encode({'run': str(dest), 'status': 'pending-final-release-and-independent-audit',
            'failure': failure, 'bundleWritten': bundle_written}, BOUNDS.CONTRACT['stdout_bytes']), STARTED+120)
        MONITOR.final_observe(); OUTPUTS.observe()
        if not bundle_written or host.final_staging is None or not all(proof.values()):
            raise RuntimeError('Incomplete final bundle/proof retains reservation')
        host.completion_check = lambda: final_release_check(cancel)
        host.release(scratch.token, proof)  # No new owner probe: use the fresh sealed OS owner proof.
    except BaseException:
        raise SystemExit(2)
    raise SystemExit(2 if failure else 0)


def final_release_check(cancel):
    REGISTRY.require_sealed()
    MONITOR.final_observe()
    if cancel.is_set() or MONITOR.issue or time.monotonic()-STARTED > 120 \
            or time.monotonic()-MONITOR.last_query > BOUNDS.CONTRACT['probe_timeout_seconds']+1:
        raise RuntimeError('Final release accounting is stale, cancelled or over deadline')
    OUTPUTS.observe()
    if min(shutil.disk_usage('/private/tmp').free, shutil.disk_usage(OUT.parent).free) < 5*1024**3:
        raise RuntimeError('Final release disk emergency bound reached')


def bootstrap(expected_sha):
    # Byte-bounded nonblocking reads before importing the sole admitted bounds helper.
    def read(path, cap):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 <= before.st_size <= cap:
                raise RuntimeError('Bootstrap input is not a bounded regular file')
            data = source.read(cap+1)
            after = os.fstat(source.fileno())
        identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
        if len(data) > cap or identity(before) != identity(after):
            raise RuntimeError('Bootstrap input changed or exceeded cap')
        return data
    if not sys.flags.isolated or not sys.dont_write_bytecode or Path.cwd() != ROOT:
        raise RuntimeError('Use /usr/bin/python3 -I -B in the owned checkout')
    data = read(HERE/'case-release-admission.json', MIB)
    if sha(data) != expected_sha:
        raise RuntimeError('Exact reviewed admission SHA differs')
    frozen = strict_json(data)
    if frozen['root'] != str(ROOT) or frozen['output'] != str(OUT):
        raise RuntimeError('Frozen execution paths differ')
    os.environ.clear(); os.environ.update(frozen['environment'])
    path = HERE/'case-release-bounds.py'
    expected = frozen['nodes'][str(path)]
    data = read(path, MIB)
    current = path.lstat()
    if sha(data) != expected['sha256'] or len(data) != expected['bytes'] \
            or (current.st_dev, current.st_ino) != (expected['device'], expected['inode']):
        raise RuntimeError('Hash-admitted bootstrap bounds helper differs')
    spec = importlib.util.spec_from_file_location('fucq122_c4_bounds', path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return frozen, module


def main():
    global BOUNDS, MONITOR, OUTPUTS, REGISTRY
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', required=True)
    parser.add_argument('--admission-sha', required=True)
    parser.add_argument('--dispatcher-grant', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', args.admission_sha) or not re.fullmatch('fucq122-c4-[A-Za-z0-9_-]{1,80}', args.dispatcher_grant):
        parser.error('Supply the exact reviewed admission SHA and new C4 dispatcher grant')
    frozen, BOUNDS = bootstrap(args.admission_sha)
    if frozen['accounting'] != BOUNDS.CONTRACT:
        raise RuntimeError('Reviewed accounting helper/contract differs')
    cancel = threading.Event()
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, lambda signum, frame: cancel.set())
    MONITOR = BOUNDS.Aggregate(cancel, 120)
    MONITOR.started = STARTED
    OUTPUTS = BOUNDS.Outputs(None, [OUT], MONITOR)
    def observe():
        OUTPUTS.observe()
        if min(shutil.disk_usage('/private/tmp').free, shutil.disk_usage(OUT.parent).free) < 5*1024**3:
            raise RuntimeError('Whole-chunk disk emergency bound reached')
    MONITOR.observer = observe
    dest = OUT / ('case-http-' + uuid.uuid4().hex)
    REGISTRY = BOUNDS.Processes(OUTPUTS, dest/'ownership/processes.json', STARTED+120, cancel,
                               args.admission_sha, args.dispatcher_grant)
    MONITOR.registry = REGISTRY
    try:
        REGISTRY.initialize()  # External provisional run/owner/probe intent precedes the first probe.
        MONITOR.start()  # Bootstrap high water/deadline included; precedes all shared imports.
        frozen, _ = admit(args.admission_sha, source_required=False)
        tr = imported(frozen, 'fucq122_c4_shared_resources', ROOT/'_tools/test_resources.py')
        tr.atomic_json = OUTPUTS.json
        tr.subprocess = BOUNDS.Captures(STARTED+120, REGISTRY)
        sg = imported(frozen, 'fucq122_c4_git', ROOT/'_tools/scaffold_git.py')
        sg.subprocess = BOUNDS.Captures(STARTED+120, REGISTRY)
        guard = imported(frozen, 'fucq122_c4_owned_resources', HERE/'case-release-resources.py')
        guard.PROCESS_ROWS = BOUNDS.process_rows
        guard.STOP_AT = STARTED+120
        guard.subprocess = BOUNDS.Captures(STARTED+120, REGISTRY)
        guard.allocated_bytes = lambda path: BOUNDS.allocation([Path(path)])
        tr.available_memory = guard.available_memory_strict
        tr.process_identity = lambda pid: guard.process_snapshot()[pid]['start']
        ledger = imported(frozen, 'fucq122_c4_ledger', HERE/'case-release-ledger.py')
        execute(frozen, args, tr, guard, ledger, sg, cancel, dest)
    except BaseException as error:
        if not REGISTRY.sealed:
            # fail() is memory-only until exclusive initialization and physical binding succeed.
            # Refused collisions reach only the bounded external stderr handler below.
            REGISTRY.fail(error)
        raise
    finally:
        OUTPUTS.diagnostics = True
        MONITOR.stop()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except BaseException as error:
        # Finite bootstrap/outer failure, with no unbounded traceback or helper output.
        message = ('C4 failure: '+type(error).__name__+'\n').encode('ascii', errors='replace')[:4096]
        try:
            if BOUNDS is not None:
                BOUNDS.emit(message, min(STARTED+120, time.monotonic()+1), fd=2)
            else:
                os.set_blocking(2, False)
                os.write(2, message)
        except BaseException:
            pass
        raise SystemExit(2)
