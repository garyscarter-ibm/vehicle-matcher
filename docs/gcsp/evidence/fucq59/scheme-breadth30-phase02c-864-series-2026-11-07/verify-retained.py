"""Supervise five pure strict retained checks for one declared core chunk. No HTTP."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, re, subprocess

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = read(BASE / 'series-plan.json')
assert len(sys.argv) == 2 and sys.argv[1].isdigit()
number = int(sys.argv[1])
assert 1 <= number <= len(manifest['chunks'])
entry = manifest['chunks'][number - 1]
DIRECTORY = pathlib.Path(entry['outputDirectory'])
allocation = read(DIRECTORY / 'execution-plan.json')
source_cleanup = read(pathlib.Path(allocation['supervisorOutput']) / 'live-cleanup.json')
assert all(source_cleanup[key] for key in ['groups_absent', 'scratch_absent', 'dependency_link_absent', 'reservation_absent'])
assert source_cleanup['checkpointExport'] and not source_cleanup['retainedWriterMetadata']
assert not (DIRECTORY / 'live-validation.json').exists(), 'preserve an existing proof'
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('group_proof', BASE / 'group-proof.py')
G = importlib.util.module_from_spec(spec); spec.loader.exec_module(G)
OUT = pathlib.Path(allocation['supervisorOutput'])
paths = sorted(set(allocation['codePins']) | {str(p) for p in DIRECTORY.rglob('*') if p.is_file()})
hashes = lambda: {p: sha(ROOT / p) for p in paths}
identity = hashes()
command = ['/opt/homebrew/bin/node', '--test', '--test-reporter=tap', '--test-isolation=none', '--test-concurrency=1', str(BASE / 'live-check.test.mjs')]
R.atomic_json(OUT / 'retained-plan.json', {'scope': 'five pure strict retained checks; zero HTTP', 'identity': identity,
    'regression': 'actual strict source binding, canonical/spent deduplication, counters, privacy and exported primary',
    'command': command, 'exclusions': 'No synthetic fixture rerun, full suite, live replay, publication or acceptance',
    'limits': {'workers': 1, 'scratchBytes': 16777216, 'hostRamBytes': 536870912, 'childRamBytes': 469762048, 'seconds': 30}})
policy = R.Policy({'chunk_scratch_mib': 16, 'chunk_ram_mib': 512, 'chunk_seconds': 30, 'log_mib': 1})
scratch = R.Scratch(OUT, ROOT, policy, expected=16 * R.MIB, checkpoint=DIRECTORY / 'collector-checkpoint.json')
host = R.HostBudget(policy)

link = ROOT / 'server/node_modules'
vendor = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
entered = reserved = finished = False
link_identity = None
result = {}
def finalize():
    global entered, reserved, finished, link_identity
    if finished:
        return
    groups_absent = G.prove_groups_absent(R, scratch.record['groups'], OUT / 'retained-group-queries.json')
    if not groups_absent:
        raise RuntimeError('owned retained-check process group absence not proved')
    if entered:
        opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=10)
        if opened.returncode not in [0, 1] or opened.stdout.strip():
            raise RuntimeError('owned retained-check scratch open-file inspection failed')
    if link_identity is not None:
        info = link.lstat()
        if (info.st_dev, info.st_ino) != link_identity or not link.is_symlink() or link.readlink() != vendor:
            raise RuntimeError('retained-check dependency link changed')
        link.unlink()
        link_identity = None
    if entered:
        scratch.__exit__(None, None, None)
        entered = False
    if reserved:
        host.release(scratch.token)
        reserved = False
    rows = R.read_json(host.path, {}) or {}
    R.atomic_json(OUT / 'retained-cleanup.json', {'scratch_root':str(scratch.root), 'ownership_manifest':str(scratch.manifest), 'scratch_absent': not os.path.lexists(scratch.root),
        'dependency_link_absent': not os.path.lexists(link), 'groups_absent': groups_absent,
        'reservation_absent': scratch.token not in rows, 'removed_allocation_bytes': scratch.record['peak'],
        'code_identity_unchanged': hashes() == identity, 'compatibility_exception': None,
        'retained_summary': str(OUT / 'retained-result.json')})
    finished = True
atexit.register(finalize)
with R.handled_termination():
    try:
        host.acquire(scratch.token, 16 * R.MIB, 512 * R.MIB, ROOT, root=scratch.root)
        reserved = True
        scratch.__enter__()
        entered = True
        assert not os.path.lexists(link), 'existing dependency path preserved'
        R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'source':str(vendor),'state':'planned'})
        link.symlink_to(vendor, target_is_directory=True)
        info = link.lstat()
        link_identity = (info.st_dev, info.st_ino)
        environment = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8',
                       'TZ': 'UTC', 'NODE_V8_COVERAGE': str(scratch.root / 'coverage'), 'BREADTH30_PHASE02C_CHECK_SESSION': str(number)}
        result = R.run_process(command, ROOT, environment, OUT / 'retained.log', scratch, policy,
                               16 * R.MIB, 448 * R.MIB, 25, host)
        log = (OUT / 'retained.log').read_text()
        result.update(scope='scoped retained actual outputs; zero HTTP', identity=identity,
                      summary={key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', log, re.M)})
        coverage = []
        for path in (scratch.root / 'coverage').glob('*.json'):
            for script in read(path)['result']:
                if str(ROOT) in script['url'] and '/node_modules/' not in script['url']:
                    coverage.append({'url': script['url'], 'functions': script['functions']})
        R.atomic_json(OUT / 'retained-coverage.json', coverage)
        R.atomic_json(OUT / 'retained-result.json', result)
        print(json.dumps(result), flush=True)
        if result['rc'] or result['issue']:
            print(log[-12000:], flush=True)
        else:
            (OUT / 'retained.log').unlink()
    finally:
        finalize()
summary = result.get('summary', {})
assert result.get('rc') == 0 and not result.get('issue') and summary.get('tests') == summary.get('pass') == 5
assert summary.get('fail') == summary.get('skipped') == 0
receipt = read(DIRECTORY / 'receipt.json')
canonical = read(DIRECTORY / 'final-canonical-index.json')
spent = read(DIRECTORY / 'final-spent-request-index.json')
proof = {'schemaVersion': 'f70-typed-axis-chunk-actual-validation.v1', 'scope': 'scoped actual source and five pure strict retained checks',
    'sourceTrafficDuringValidation': 0, 'primarySha256': sha(DIRECTORY / 'collector-checkpoint.json'),
    'receiptSha256': sha(DIRECTORY / 'receipt.json'),
    'finalCanonicalIndexSha256': sha(DIRECTORY / 'final-canonical-index.json'),
    'finalSpentRequestIndexSha256': sha(DIRECTORY / 'final-spent-request-index.json'),
    'retainedChecks': result, 'retainedCleanup': read(OUT / 'retained-cleanup.json'), 'cleanup': source_cleanup,
    'actualSource': {'attempts': receipt['actualAttempts'], 'solverRequests': receipt['counts']['operations']['solve'],
        'decodedBytes': receipt['counts']['decodedBytes'], 'accepted': receipt['newlyAccepted'],
        'duplicates': receipt['duplicates'], 'rejected': receipt['rejected'], 'reason': receipt['reason'], 'status': receipt['status']},
    'cumulativeCanonicalEntries': len(canonical['entries']),
    'cumulativeAdmittedSourceConfigurations': sum(any(origin['kind'] == 'admitted-source' for origin in row['origins']) for row in canonical['entries']),
    'cumulativeSpentSolverRequests': len(spent['entries']), 'sourceCapacityCredit': receipt['newlyAccepted'], 'acceptance': False}
with (DIRECTORY / 'live-validation.json').open('x') as stream:
    stream.write(json.dumps(proof, indent=2) + '\n')
