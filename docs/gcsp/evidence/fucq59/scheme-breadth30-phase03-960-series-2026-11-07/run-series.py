"""One separately released finite pilot or suffix. Original phase clocks and spent prefixes never reset."""
import sys
sys.dont_write_bytecode = True
import atexit, datetime, hashlib, importlib.util, json, os, pathlib, signal, subprocess, time, uuid

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
series = read(BASE / 'series-plan.json')
assert len(sys.argv) == 2 and sys.argv[1] == 'phase03', 'one exact phase required'
name = sys.argv[1]; phase = series['phases'][name]
assert os.environ.get('BREADTH30_PHASE03_PHASE_GRANT') == phase['grantId'], 'separate exact parent phase traffic grant required'
assert all(sha(ROOT / p) == h for p, h in series['codePins'].items())
assert all(sha(ROOT / p) == h for p, h in series['sourcePins'].items())
assert all(sha(pathlib.Path(p))==h for p,h in series['runtimePins'].items())
assert sha(BASE / 'candidate-manifest.json') == series['candidateManifestSha256']
assert sha(BASE / 'scheme-context-gaps.json') == series['schemeContextGapsSha256']
assert len(series['chunks']) == 120 and sum(e['candidates'] for e in series['chunks']) == 960
assert sum(e['maximumGets'] for e in series['chunks']) == 1440
entries = [e for e in series['chunks'] if e['phase'] == name]
assert [e['number'] for e in entries] == phase['sessions']
assert sum(e['candidates'] for e in entries) == phase['solverCeiling']
assert sum(e['maximumGets'] for e in entries) == phase['getCeiling']
output = pathlib.Path(series['outputRoot']); cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents
assert not os.path.lexists(ROOT / 'server/node_modules'), 'preserve existing dependency path'
assert all(not pathlib.Path(e['outputDirectory']).exists() for e in entries), 'preserve spent phase prefix; never replay'
assert not output.exists(), 'new source root must be absent; never replay'
assert not series['baseRefreshRequired'],'fresh-parent-pilot-audit-required'
for pin in series['indexPins'].values():assert sha(pathlib.Path(pin['path']))==pin['sha256']
assert sha(pathlib.Path(series['parentPilotAudit']['path']))==series['parentPilotAudit']['sha256']
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('group_proof', BASE / 'group-proof.py')
G = importlib.util.module_from_spec(spec); spec.loader.exec_module(G)
policy = R.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 512, 'chunk_seconds': 600, 'log_mib': 1})
host = R.HostBudget(policy)
token = uuid.uuid4().hex
owner_base = pathlib.Path(series['outputOwnershipManifest'])
owner_manifest = owner_base.with_name(owner_base.stem + '-' + name + owner_base.suffix)
assert not owner_manifest.exists(), 'preserve original phase ownership'
ownership = {'schemaVersion': 'breadth30-phase03-durable-output-ownership.v1', 'allocationId': series['id'], 'phase': name,
    'owner': R.owner(), 'outputRoot': str(output), 'disposable': False, 'retainOnInterruption': True, 'state': 'planned',
    'reservationToken': token, 'scratchRoots': [], 'scratchManifestDirectories': [str(pathlib.Path(e['supervisorOutput']) / 'ownership') for e in entries]}
R.atomic_json(owner_manifest, ownership)
current = None; children = []; results = []; aggregate_gets = aggregate_bytes = aggregate_solve = 0
finished = reserved = False; started = None; active_session = active_cohort = None; cohort_started = None
reason = 'phase-incomplete'; stopped_error = None
marker = output / (name + '-once.json')
assert not marker.exists(), 'never reset an original phase clock'
def logical_bytes(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file()) if path.exists() else 0
def checkpoint(stage, **extra):
    R.atomic_json(output / (name + '-checkpoint.json'), {'allocationId': series['id'], 'phase': name, 'stage': stage,
        'completedSessions': results, 'aggregateGets': aggregate_gets, 'aggregateDecodedBytes': aggregate_bytes,
        'aggregateSolverRequests': aggregate_solve, 'elapsedSeconds': time.monotonic() - started if started else 0,
        'activeSession': active_session, 'activeCohort': active_cohort, **extra})
def finalize():
    global current, finished, reserved
    if finished: return
    if current is not None and current.poll() is None:
        os.killpg(current.pid, signal.SIGTERM)
        try: current.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(current.pid, signal.SIGKILL); current.wait(timeout=5)
        children[-1]['joined'] = True
    groups = G.prove_groups_absent(R, [row['pid'] for row in children], output / (name + '-group-queries.json'))
    actual_manifests = []
    for directory in ownership['scratchManifestDirectories']:
        for path in pathlib.Path(directory).glob('*.json'):
            record = read(path)
            if record.get('version') == 1 and record.get('token'):
                assert pathlib.Path(record['root']).name == 'test-stamp-shard-' + record['token']
                actual_manifests.append({'manifest': str(path), 'root': record['root'], 'state': record['state'], 'groups': record['groups']})
    ownership['scratchRoots'] = sorted({r['root'] for r in actual_manifests})
    leftovers = [p for p in ownership['scratchRoots'] if os.path.lexists(p)]
    link_absent = not os.path.lexists(ROOT / 'server/node_modules')
    if reserved: host.release(token); reserved = False
    rows = R.read_json(host.path, {}) or {}
    process_receipt = {'allocationId': series['id'], 'phase': name, 'ownerPid': os.getpid(), 'children': children,
        'allChildrenJoined': all(r['joined'] for r in children), 'allStageGroupsAbsent': groups, 'finished': True}
    cleanup = {'actualScratchManifests': actual_manifests, 'sourceAndRetainedScratchAbsent': not leftovers, 'scratchLeftovers': leftovers,
        'dependencyLinkAbsent': link_absent, 'allStageGroupsAbsent': groups, 'seriesReservationAbsent': token not in rows,
        'durableOutputPreserved': str(output), 'retainedLogicalBytes': logical_bytes(output), 'compatibilityException': None}
    if output.exists():
        R.atomic_json(output / (name + '-process-ownership.json'), process_receipt)
        R.atomic_json(output / (name + '-cleanup.json'), cleanup)
        R.atomic_json(output / (name + '-receipt.json'), {'allocationId': series['id'], 'phase': name, 'reason': reason,
            'completedSessions': results, 'activeSession': active_session, 'aggregateGets': aggregate_gets,
            'aggregateDecodedBytes': aggregate_bytes, 'aggregateSolverRequests': aggregate_solve,
            'elapsedSeconds': time.monotonic() - started if started else 0, 'newlyAccepted': sum(r['accepted'] for r in results),
            'duplicates': sum(r['duplicates'] for r in results), 'rejected': sum(r['rejected'] for r in results),
            'stoppedErrorType': stopped_error, 'acceptance': False, 'remaining': series['remaining']})
    ownership.update(state='finished', cleanup=cleanup, children=process_receipt, reason=reason)
    R.atomic_json(owner_manifest, ownership); finished = True
    if not all([groups, not leftovers, link_absent, token not in rows]):
        raise RuntimeError('phase cleanup has a named unresolved allocation; primary preserved')
atexit.register(finalize)
def run(command, environment, timeout, allow_failure=False):
    global current
    remaining = phase['maximumWallSeconds'] - (time.monotonic() - started)
    cohort_remaining = series['resources']['perCohortSeconds'] - (time.monotonic() - cohort_started)
    assert remaining > 0 and cohort_remaining > 0, 'original finite phase/cohort wall budget'
    current = subprocess.Popen(command, cwd=ROOT, env=environment, start_new_session=True)
    row = {'pid': current.pid, 'command': command, 'joined': False}; children.append(row)
    R.atomic_json(output / (name + '-process-ownership.json'), {'allocationId': series['id'], 'phase': name, 'children': children})
    try:
        status = current.wait(timeout=min(timeout, remaining, cohort_remaining)); row['joined'] = True
    except BaseException:
        if current.poll() is None:
            os.killpg(current.pid, signal.SIGTERM)
            try: current.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(current.pid, signal.SIGKILL); current.wait(timeout=5)
        row['joined'] = True
        raise
    finally: current = None
    if not allow_failure: assert status == 0, 'owned stage failed; preserve primary and stop'
    return status
environment = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC',
    'TEST_RESOURCE_PARENT_RESERVATION': token, 'BREADTH30_PHASE03_STAGE': series['id'], 'BREADTH30_PHASE03_PHASE_GRANT': phase['grantId']}
try:
    with R.handled_termination():
        host.acquire(token, series['resources']['peakIncludingRetainedBudgetBytes'], 512 * R.MIB, cloud, root=output)
        reserved = True
        if name == 'phase03':
            output.mkdir(parents=True)
            R.atomic_json(output / 'output-ownership.json', {'allocationId': series['id'], 'ownerManifest': str(owner_manifest),
                'disposable': False, 'retainOnInterruption': True, 'directOneDrive': True})
        with marker.open('x') as stream:
            stream.write(json.dumps({'id': phase['grantId'], 'state': 'reserved-and-consumed', 'seriesPlanSha256': sha(BASE / 'series-plan.json'),
                'reservedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}) + '\n'); stream.flush(); os.fsync(stream.fileno())
        started = time.monotonic()
        ownership.update(state='active'); R.atomic_json(owner_manifest, ownership)
        R.atomic_json(output / (name + '-released-plan.json'), series)
        for entry in entries:
            active_session = entry['number']; directory = pathlib.Path(entry['outputDirectory'])
            if active_cohort != entry['cohort']:
                active_cohort = entry['cohort']; cohort_started = time.monotonic()
            checkpoint('preparing-session')
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'prepare-session.py'), str(active_session)], environment, 10)
            allocation = read(directory / 'execution-plan.json')
            checkpoint('session-frozen', executionPlanSha256=sha(directory / 'execution-plan.json'))
            print(json.dumps({'stage': 'source-start', 'phase': name, 'cohort': active_cohort, 'session': active_session,
                'model': entry['modelCode'], 'solverCeiling': entry['candidates'], 'getCeiling': entry['maximumGets']}), flush=True)
            status = run(['/usr/bin/python3', '-I', '-B', str(BASE / 'supervise.py'), str(active_session)],
                {**environment, 'BREADTH30_PHASE03_SOURCE_GRANT': allocation['id']}, 130, allow_failure=True)
            if (directory / 'receipt.json').exists():
                receipt = read(directory / 'receipt.json'); aggregate_gets += receipt['actualAttempts']
                aggregate_bytes += (receipt.get('counts') or {}).get('decodedBytes', 0)
                aggregate_solve += ((receipt.get('counts') or {}).get('operations') or {}).get('solve', 0)
                checkpoint('source-stopped' if status else 'source-completed-awaiting-proof')
            assert status == 0 and receipt['reason'] == 'queue-exhausted' and receipt['processedCandidates'] == entry['candidates']
            assert aggregate_gets <= phase['getCeiling'] and aggregate_solve <= phase['solverCeiling']
            assert aggregate_bytes <= len(entries) * 4194304
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'reconcile-retained.py'), str(active_session)], environment, 10)
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'verify-retained.py'), str(active_session)], environment, 45)
            proof = read(directory / 'live-validation.json')
            shard_bytes = logical_bytes(directory); total_bytes = logical_bytes(output)
            assert shard_bytes <= series['resources']['perSessionRetainedShardBytes'] and total_bytes <= series['resources']['retainedBudgetBytes']
            host.update(token, R.allocated_bytes(output), 0)
            results.append({'session': active_session, 'cohort': active_cohort, 'model': entry['modelCode'], 'allocationId': allocation['id'],
                'primarySha256': proof['primarySha256'], 'proofSha256': sha(directory / 'live-validation.json'),
                'accepted': receipt['newlyAccepted'], 'duplicates': receipt['duplicates'], 'rejected': receipt['rejected'],
                'gets': receipt['actualAttempts'], 'solverRequests': receipt['counts']['operations']['solve'], 'decodedBytes': receipt['counts']['decodedBytes'],
                'cumulativeAdmitted': proof['cumulativeAdmittedSourceConfigurations'], 'retainedShardBytes': shard_bytes})
            checkpoint('session-proved'); print(json.dumps({'stage': 'session-proved', **results[-1]}), flush=True)
            # Completed duplicate/rejected outcomes remain honest spent requests; only actual admissions count.
        reason = 'finite-' + name + '-exhausted'; active_session = None; active_cohort = None
except BaseException as error:
    stopped_error = type(error).__name__
    if output.exists(): checkpoint('stopped', errorType=stopped_error)
    raise
finally: finalize()
