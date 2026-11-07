"""Run exactly32 sequential source chunks under one reviewed1024-request release. Never replay."""
import sys
sys.dont_write_bytecode = True
import atexit, datetime, hashlib, importlib.util, json, os, pathlib, signal, subprocess, time, uuid
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
series = read(BASE / 'series-plan.json')
assert os.environ.get('F70_TRIM_PACKAGE_SUFFIX_SERIES_GRANT') == series['id'], 'explicit-parent-series-traffic-grant-required'
assert all(sha(ROOT / p) == h for p, h in series['codePins'].items())
assert sha(BASE / 'candidate-manifest.json') == series['candidateManifestSha256']
assert len(series['chunks']) == 8 and sum(e['candidates'] for e in series['chunks']) == series['candidateAllowance'] == 252
assert sum(e['maximumGets'] for e in series['chunks']) == series['attemptAllowance'] == 284
output = pathlib.Path(series['outputRoot'])
cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents and output.is_dir()
assert not os.path.lexists(ROOT / 'server/node_modules'), 'existing dependency path preserved'
assert all(not pathlib.Path(e['outputDirectory']).exists() for e in series['chunks']), 'spent suffix prefix preserved; no replay'
assert sha(pathlib.Path(series['baselineDirectory'])/'live-validation.json') == series['baselineProofSha256']
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
policy = R.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 512, 'chunk_seconds': 900, 'log_mib': 1})
host = R.HostBudget(policy); host._dead_owners = lambda: {}
token = uuid.uuid4().hex
owner_manifest = pathlib.Path(series['outputOwnershipManifest'])
original_marker = read(output/'execution-once.json')
assert original_marker['id']==series['id'] and original_marker['state']=='reserved-and-consumed'
original_elapsed=time.time()-datetime.datetime.fromisoformat(original_marker['reservedAt'].replace('Z','+00:00')).timestamp()
assert 0<=original_elapsed<900, 'original900-second-clock-expired'
started = time.monotonic()-original_elapsed; children = []; current = None; finished = reserved = False
pilot_receipt=read(pathlib.Path(series['baselineDirectory'])/'receipt.json')
results = []; aggregate_gets = pilot_receipt['actualAttempts']; aggregate_bytes = pilot_receipt['counts']['decodedBytes']; active_chunk = None
reason = 'series-incomplete'; stopped_error = None
marker = output / 'suffix-once.json'
assert not marker.exists(), 'never replay suffix release'
ownership = {'schemaVersion': 'typed-axis-durable-output-ownership.v1', 'allocationId': series['id'], 'owner': R.owner(),
    'outputRoot': str(output), 'disposable': False, 'retainOnInterruption': True, 'state': 'planned', 'reservationToken': token,
    'scratchRoots': [suffix for e in series['chunks'] for suffix in [e['scratchRoot'], e['scratchRoot'] + '-retained']]}
R.atomic_json(owner_manifest, ownership)
def logical_bytes(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file()) if path.exists() else 0
def checkpoint(stage, **extra):
    R.atomic_json(output / 'suffix-checkpoint.json', {'allocationId': series['id'], 'stage': stage, 'completedChunks': results,
        'aggregateGets': aggregate_gets, 'aggregateDecodedBytes': aggregate_bytes, 'elapsedSeconds': time.monotonic() - started,
        'activeChunk': active_chunk, **extra})
def finalize():
    global current, finished, reserved
    if finished: return
    if current is not None and current.poll() is None:
        os.killpg(current.pid, signal.SIGTERM)
        try: current.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(current.pid, signal.SIGKILL); current.wait(timeout=5)
        children[-1]['joined'] = True
    groups_absent = all(R.group_has_live_members(row['pid']) is False for row in children)
    scratch_leftovers = [p for p in ownership['scratchRoots'] if os.path.lexists(p)]
    link_absent = not os.path.lexists(ROOT / 'server/node_modules')
    if reserved:
        host.release(token); reserved = False
    host_rows = R.read_json(host.path, {}) or {}
    owned_children = {'allocationId': series['id'], 'ownerPid': os.getpid(), 'children': children,
        'allChildrenJoined': all(r['joined'] for r in children), 'allStageGroupsAbsent': groups_absent, 'finished': True}
    cleanup = {'sourceAndRetainedScratchAbsent': not scratch_leftovers, 'scratchLeftovers': scratch_leftovers,
        'dependencyLinkAbsent': link_absent, 'allStageGroupsAbsent': groups_absent,
        'seriesReservationAbsent': token not in host_rows, 'durableOutputPreserved': str(output),
        'retainedLogicalBytes': logical_bytes(output), 'compatibilityException': None}
    if output.exists():
        R.atomic_json(output / 'suffix-process-ownership.json', owned_children)
        R.atomic_json(output / 'suffix-cleanup.json', cleanup)
        R.atomic_json(output / 'suffix-receipt.json', {'allocationId': series['id'], 'reason': reason,
            'completedChunks': results, 'includesPilotGetsAndBytes': True, 'activeChunk': active_chunk, 'aggregateGets': aggregate_gets,
            'aggregateDecodedBytes': aggregate_bytes, 'elapsedSeconds': time.monotonic() - started,
            'newlyAccepted': sum(r['accepted'] for r in results), 'duplicates': sum(r['duplicates'] for r in results),
            'rejected': sum(r['rejected'] for r in results), 'stoppedErrorType': stopped_error,
            'acceptance': False, 'remaining': series['remaining']})
    ownership.update(state='finished', cleanup=cleanup, children=owned_children, reason=reason)
    R.atomic_json(owner_manifest, ownership)
    finished = True
    if not all([groups_absent, not scratch_leftovers, link_absent, token not in host_rows]):
        raise RuntimeError('series cleanup has a named unresolved allocation; preserve durable output')
atexit.register(finalize)
def run(command, environment, timeout, allow_failure=False):
    global current
    remaining = series['maximumWallSeconds'] - (time.monotonic() - started)
    assert remaining > 0, 'finite whole-series wall budget'
    current = subprocess.Popen(command, cwd=ROOT, env=environment, start_new_session=True)
    row = {'pid': current.pid, 'command': command, 'joined': False}; children.append(row)
    R.atomic_json(output / 'suffix-process-ownership.json', {'allocationId': series['id'], 'ownerPid': os.getpid(), 'children': children})
    try:
        status = current.wait(timeout=min(timeout, remaining)); row['joined'] = True
    except BaseException:
        if current.poll() is None:
            os.killpg(current.pid, signal.SIGTERM)
            try: current.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(current.pid, signal.SIGKILL); current.wait(timeout=5)
        row['joined'] = True
        raise
    finally: current = None
    if not allow_failure: assert status == 0, 'owned series stage failed; preserve primary and stop'
    return status
environment = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC',
    'TEST_RESOURCE_PARENT_RESERVATION': token, 'F70_TRIM_PACKAGE_SUFFIX_STAGE': series['id']}
try:
    with R.handled_termination():
        host.acquire(token, series['resources']['peakIncludingRetainedBudgetBytes'], 512 * R.MIB, cloud, root=output)
        reserved = True
        with marker.open('x') as stream:
            stream.write(json.dumps({'id':series['id'],'state':'reserved-and-consumed','seriesPlanSha256':sha(BASE/'series-plan.json'),'originalReservedAt':original_marker['reservedAt'],'consumedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})+'\n');stream.flush();os.fsync(stream.fileno())
        ownership.update(state='active'); R.atomic_json(owner_manifest, ownership)
        R.atomic_json(output / 'released-suffix-plan.json', series)
        for entry in series['chunks']:
            active_chunk = entry['number']; directory = pathlib.Path(entry['outputDirectory'])
            checkpoint('preparing-chunk')
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'prepare-chunk.py'), str(active_chunk)], environment, 10)
            allocation = read(directory / 'execution-plan.json')
            checkpoint('chunk-frozen', executionPlanSha256=sha(directory / 'execution-plan.json'))
            print(json.dumps({'stage': 'source-start', 'chunk': active_chunk, 'allocationId': allocation['id'], 'maxGets': entry['maximumGets']}), flush=True)
            status = run(['/usr/bin/python3', '-I', '-B', str(BASE / 'supervise.py'), str(active_chunk)],
                {**environment, 'F70_TRIM_PACKAGE_SUFFIX_SOURCE_GRANT': allocation['id']}, 130, allow_failure=True)
            if (directory / 'receipt.json').exists():
                receipt = read(directory / 'receipt.json'); aggregate_gets += receipt['actualAttempts']
                aggregate_bytes += (receipt.get('counts') or {}).get('decodedBytes', 0)
                checkpoint('source-stopped' if status else 'source-completed-awaiting-proof')
            assert status == 0 and receipt['reason'] == 'queue-exhausted' and receipt['processedCandidates'] == entry['candidates']
            assert aggregate_gets <= 296 and aggregate_bytes <= series['decodedBytes']
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'reconcile-retained.py'), str(active_chunk)], environment, 10)
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'verify-retained.py'), str(active_chunk)], environment, 45)
            proof = read(directory / 'live-validation.json')
            shard_bytes = logical_bytes(directory); total_bytes = logical_bytes(output)
            assert shard_bytes <= series['resources']['perChunkRetainedShardBytes'], 'source shard exceeds declared32MiB bound; preserve and stop'
            assert total_bytes <= series['resources']['retainedBudgetBytes'], 'finite retained-output ceiling'
            host.update(token, R.allocated_bytes(output), 0)
            results.append({'chunk': active_chunk, 'allocationId': allocation['id'], 'primarySha256': proof['primarySha256'],
                'proofSha256': sha(directory / 'live-validation.json'), 'accepted': receipt['newlyAccepted'], 'duplicates': receipt['duplicates'],
                'rejected': receipt['rejected'], 'gets': receipt['actualAttempts'], 'decodedBytes': receipt['counts']['decodedBytes'],
                'cumulativeAdmitted': proof['cumulativeAdmittedSourceConfigurations'], 'retainedShardBytes': shard_bytes})
            checkpoint('chunk-proved'); print(json.dumps({'stage': 'chunk-proved', **results[-1]}), flush=True)
        reason = 'finite-trim-package252-suffix-exhausted'; active_chunk = None
except BaseException as error:
    stopped_error = type(error).__name__
    if output.exists(): checkpoint('stopped', errorType=stopped_error)
    raise
finally: finalize()
