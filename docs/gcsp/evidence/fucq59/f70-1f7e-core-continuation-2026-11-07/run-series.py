"""Run the exact111-request priority series after one parent release; no replay."""
import sys
sys.dont_write_bytecode = True
import atexit, datetime, hashlib, importlib.util, json, os, pathlib, signal, subprocess, time

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
allocation = read(BASE / 'series-plan.json')
assert os.environ.get('F70_CORE_SERIES_SOURCE_GRANT') == allocation['id'], 'explicit-parent-series-traffic-grant-required'
assert sha(BASE / 'continuation-plan.json') == allocation['continuationPlanSha256']
for path, expected in allocation['codePins'].items():
    assert sha(ROOT / path) == expected, path
manifest = read(BASE / 'continuation-plan.json')
series = manifest['series']
assert allocation['id'] == series['allocationId']
assert series['chunks'] == [1, 2, 3, 4] and series['maximumCandidates'] == 111 and series['maximumGets'] == 127
assert [manifest['chunks'][n - 1]['candidates'] for n in series['chunks']] == [32, 32, 32, 15]
for number in series['chunks']:
    entry = manifest['chunks'][number - 1]
    plan = read(ROOT / entry['planTemplatePath'])
    assert entry['releaseStage'] == 'priority-observed-rims'
    assert all('S01H0' not in row['request']['includedElements'] for row in plan['candidates'])
    assert not any((pathlib.Path(entry['directory']) / name).exists() for name in ['execution-once.json', 'collector-checkpoint.json'])
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
OUT = pathlib.Path(allocation['supervisorOutput'])
OUT.mkdir(parents=True, exist_ok=True)
marker = BASE / 'series-once.json'
with marker.open('x') as stream:
    os.fchmod(stream.fileno(), 0o600)
    stream.write(json.dumps({'id': allocation['id'], 'state': 'reserved-and-consumed', 'seriesPlanSha256': sha(BASE / 'series-plan.json'),
        'reservedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}) + '\n')
    stream.flush()
    os.fsync(stream.fileno())
descriptor = os.open(BASE, os.O_RDONLY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
current = None
children = []
finished = False
results = []
aggregate_gets = aggregate_bytes = 0
started = time.monotonic()
reason = 'series-incomplete'
def checkpoint(stage, **extra):
    R.atomic_json(OUT / 'series-checkpoint.json', {'allocationId': allocation['id'], 'stage': stage,
        'completedChunks': results, 'aggregateGets': aggregate_gets, 'aggregateDecodedBytes': aggregate_bytes,
        'elapsedSeconds': time.monotonic() - started, **extra})
def finalize():
    global current, finished
    if finished:
        return
    if current is not None and current.poll() is None:
        os.killpg(current.pid, signal.SIGTERM)
        try:
            current.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(current.pid, signal.SIGKILL)
            current.wait(timeout=5)
    R.atomic_json(OUT / 'series-process-ownership.json', {'allocationId': allocation['id'], 'ownerPid': os.getpid(),
        'children': children, 'allChildrenJoined': all(row['joined'] for row in children),
        'scratchOwnedByPerChunkSupervisors': True, 'finished': True})
    finished = True
atexit.register(finalize)
def run(command, environment, timeout):
    global current
    assert time.monotonic() - started < series['maximumWallSeconds'], 'finite series wall budget'
    current = subprocess.Popen(command, cwd=ROOT, env=environment, start_new_session=True)
    entry = {'pid': current.pid, 'command': command, 'joined': False}
    children.append(entry)
    R.atomic_json(OUT / 'series-process-ownership.json', {'allocationId': allocation['id'], 'ownerPid': os.getpid(), 'children': children})
    try:
        status = current.wait(timeout=min(timeout, max(1, series['maximumWallSeconds'] - (time.monotonic() - started))))
        entry['joined'] = True
    except BaseException:
        if current.poll() is None:
            os.killpg(current.pid, signal.SIGTERM)
            try:
                current.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(current.pid, signal.SIGKILL)
                current.wait(timeout=5)
        entry['joined'] = True
        raise
    finally:
        current = None
    assert status == 0, 'owned series stage failed; preserve primary and stop'
environment = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC'}
try:
    with R.handled_termination():
        for number in series['chunks']:
            entry = manifest['chunks'][number - 1]
            directory = pathlib.Path(entry['directory'])
            checkpoint('preparing-chunk', chunk=number)
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'prepare-core.py'), str(number)], environment, 10)
            chunk = read(directory / 'execution-plan.json')
            checkpoint('chunk-frozen', chunk=number, executionPlanSha256=sha(directory / 'execution-plan.json'))
            print(json.dumps({'stage': 'source-start', 'chunk': number, 'allocationId': chunk['id'], 'attemptBudget': entry['attempts']}), flush=True)
            run(['/usr/bin/python3', '-I', '-B', str(directory / 'supervise.py'), 'live'],
                {**environment, 'F70_FIRST32_SOURCE_GRANT': chunk['id']}, 190)
            receipt = read(directory / 'receipt.json')
            aggregate_gets += receipt['actualAttempts']
            aggregate_bytes += receipt['counts']['decodedBytes']
            assert aggregate_gets <= series['maximumGets'] and aggregate_bytes <= series['maximumDecodedBytes']
            assert receipt['reason'] == 'queue-exhausted' and receipt['processedCandidates'] == entry['candidates']
            checkpoint('source-completed-awaiting-proof', chunk=number)
            run(['/usr/bin/python3', '-I', '-B', str(directory / 'reconcile-retained.py')], environment, 10)
            run(['/usr/bin/python3', '-I', '-B', str(BASE / 'verify-retained.py'), str(number)], environment, 45)
            proof = read(directory / 'live-validation.json')
            results.append({'chunk': number, 'allocationId': chunk['id'], 'primarySha256': proof['primarySha256'],
                'accepted': receipt['newlyAccepted'], 'duplicates': receipt['duplicates'], 'rejected': receipt['rejected'],
                'gets': receipt['actualAttempts'], 'decodedBytes': receipt['counts']['decodedBytes'],
                'cumulativeAdmitted': proof['cumulativeAdmittedSourceConfigurations'], 'proofSha256': sha(directory / 'live-validation.json')})
            checkpoint('chunk-proved', chunk=number)
            print(json.dumps({'stage': 'chunk-proved', **results[-1]}), flush=True)
        reason = 'finite-priority-series-exhausted'
except BaseException as error:
    checkpoint('stopped', errorType=type(error).__name__)
    raise
finally:
    finalize()
    R.atomic_json(OUT / 'series-receipt.json', {'allocationId': allocation['id'], 'reason': reason, 'chunks': results,
        'aggregateGets': aggregate_gets, 'aggregateDecodedBytes': aggregate_bytes, 'elapsedSeconds': time.monotonic() - started,
        'newlyAccepted': sum(row['accepted'] for row in results), 'acceptance': False,
        'deferredS01H0Requests': 52, 'remaining': ['10,000 actual source configurations', 'model/profile/year/plant/five-WMI coverage', 'parent publication/runtime gates']})
