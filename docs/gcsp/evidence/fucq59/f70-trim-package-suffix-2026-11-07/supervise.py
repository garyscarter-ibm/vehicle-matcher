"""Prepared 32-candidate solver stage. A live invocation requires root's traffic release."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, subprocess

ROOT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032')
BASE = pathlib.Path(__file__).resolve().parent
assert len(sys.argv) == 2 and sys.argv[1].isdigit(), 'one exact declared source chunk required'
series = json.loads((BASE / 'series-plan.json').read_text()); number = int(sys.argv[1])
assert 2 <= number <= 9
entry = series['chunks'][number - 2]
DIRECTORY = pathlib.Path(entry['outputDirectory'])
OUT = pathlib.Path(entry['supervisorOutput'])
PRIMARY = DIRECTORY / 'collector-checkpoint.json'
read = lambda p: json.loads(p.read_text())
allocation = read(DIRECTORY / 'execution-plan.json')
assert os.environ.get('F70_TRIM_PACKAGE_SUFFIX_SOURCE_GRANT') == allocation['id'], 'explicit-root-traffic-grant-required'
assert not (DIRECTORY / 'execution-once.json').exists() and not PRIMARY.exists(), 'never replay the spent 32-candidate allocation'
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('source_exporter', ROOT / 'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
hashes = lambda: {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in allocation['codePins']}
identity = hashes(); assert identity == allocation['codePins']
assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() == h for p, h in allocation['inputPins'].items())
plan = {'phase': 'live', 'identity': identity, 'changed_paths': list(identity), 'regression': 'one fresh F70 full model/AG/date context and typed finite candidates through existing collector',
        'callers': ['generic model registration', 'shared source projection', 'common collection session'],
        'command': ['/opt/homebrew/bin/node', str(BASE / 'run-live.mjs'), str(number)], 'selection': 'New exact 36-GET allocation: fresh four-GET bootstrap and 32 solver requests; scoped offline preparation precedes release',
        'exclusions': 'No images, browser, source writes, full suite or runtime acceptance',
        'limits': {'workers': 1, 'scratch_bytes': 67108864, 'ram_bytes': 536870912, 'child_bytes': 469762048, 'seconds': 120}}
R.atomic_json(OUT / 'live-plan.json', plan)
policy = R.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 512, 'chunk_seconds': 120, 'log_mib': 1})
scratch = R.Scratch(OUT, ROOT, policy, expected=64 * R.MIB, checkpoint=PRIMARY)
scratch.root = pathlib.Path(entry['scratchRoot'])
scratch.record['root'] = str(scratch.root)
host = R.HostBudget(policy); host._dead_owners = lambda: {}
link = ROOT / 'server/node_modules'
vendor = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
entered = reserved = finished = False
link_identity = None; result = {}
def finalize():
    global entered, reserved, finished, link_identity
    if finished: return
    groups_absent = all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups_absent: raise RuntimeError('owned process group absence not proved')
    if entered:
        opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=10)
        if opened.returncode not in [0, 1] or opened.stdout.strip(): raise RuntimeError('scratch open-file inspection failed')
    if link_identity is not None:
        info = link.lstat()
        if (info.st_dev, info.st_ino) != link_identity or not link.is_symlink() or link.readlink() != vendor: raise RuntimeError('dependency link changed')
        link.unlink(); link_identity = None
    export_status = None
    if PRIMARY.exists():
        try: export_status = E.export(DIRECTORY)
        except Exception as error: R.atomic_json(DIRECTORY / 'checkpoint-export-failure.json', {'issue': 'first32-primary-export-failed', 'errorType': type(error).__name__, 'primaryPreserved': True})
    if entered: scratch.__exit__(None, None, None); entered = False
    if reserved: host.release(scratch.token); reserved = False
    rows = R.read_json(host.path, {}) or {}
    R.atomic_json(OUT / 'live-cleanup.json', {'scratch_absent': not os.path.lexists(scratch.root), 'dependency_link_absent': not os.path.lexists(link),
       'groups_absent': groups_absent, 'reservation_absent': scratch.token not in rows, 'removed_allocation_bytes': scratch.record['peak'],
       'code_identity_unchanged': identity == hashes(), 'retainedPrimary': str(PRIMARY), 'primaryExists': PRIMARY.exists(), 'checkpointExport': export_status,
       'retainedWriterMetadata': [p.name for pattern in ['collector-checkpoint.json.writer-*.json', 'collector-checkpoint.json.writing-*'] for p in DIRECTORY.glob(pattern)], 'compatibility_exception': None,
       'retained_summary': str(OUT / 'live-result.json')})
    finished = True
atexit.register(finalize)
marker = read(pathlib.Path(series['outputRoot']) / 'execution-once.json')
assert marker['id'] == series['id']
import datetime, time
source_seconds = min(120, 900 - (time.time() - datetime.datetime.fromisoformat(marker['reservedAt'].replace('Z','+00:00')).timestamp()))
assert source_seconds > 0, 'original-series-clock-expired'
with R.handled_termination():
    try:
        host.acquire(scratch.token, 64 * R.MIB, 512 * R.MIB, ROOT, root=scratch.root); reserved = True
        scratch.__enter__(); entered = True
        if os.path.lexists(link): raise RuntimeError('existing dependency path preserved')
        link.symlink_to(vendor, target_is_directory=True); info = link.lstat(); link_identity = (info.st_dev, info.st_ino)
        env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC', 'F70_TRIM_PACKAGE_SUFFIX_SOURCE_GRANT': allocation['id']}
        result = R.run_process(plan['command'], ROOT, env, OUT / 'live.log', scratch, policy, 64 * R.MIB, 448 * R.MIB, source_seconds, host)
        result.update(identity=identity, scope='scoped actual32 typed-axis source requests; only durable qualified distinct outcomes count')
        R.atomic_json(OUT / 'live-result.json', result); print(json.dumps(result))
        if result['rc'] or result['issue']: print((OUT / 'live.log').read_text()[-12000:])
        else: (OUT / 'live.log').unlink()
    finally: finalize()
cleanup = read(OUT / 'live-cleanup.json')
export_ok = cleanup['checkpointExport'] is not None and not (DIRECTORY / 'checkpoint-export-failure.json').exists()
sys.exit(0 if result.get('rc') == 0 and not result.get('issue') and export_ok and not cleanup['retainedWriterMetadata'] else 1)
