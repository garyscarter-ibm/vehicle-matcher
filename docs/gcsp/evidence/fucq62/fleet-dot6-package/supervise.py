"""Two bounded offline packaging chunks; owned scratch and durable OneDrive output."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, shutil, subprocess

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''): h.update(block)
    return h.hexdigest()

phase = sys.argv[1]
assert phase in ['describe', 'pack']
plan = read(BASE/'plan.json')
output = pathlib.Path(plan['outputRoot'])
cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents
metadata = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot6-package')/phase
assert not metadata.exists(), 'fresh chunk identity required; retained results are never overwritten'
assert (not output.exists()) if phase == 'describe' else (output/'publication-receipt.json').is_file()
spec = importlib.util.spec_from_file_location('resources', ROOT/'_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
code = [BASE/'plan.json', BASE/'prepare.mjs', BASE/'supervise.py', ROOT/'scripts/gcsp/fleet-offline-guard.mjs']
for directory in ['server/gcsp/vehicle-evidence', 'server/gcsp/policy', 'server/gcsp/repository', 'server/vehicle-evidence']:
    code.extend((ROOT/directory).glob('*.js')); code.extend((ROOT/directory).glob('*.json'))
identity = {str(p): sha(p) for p in sorted(set(code))}
inputs = {str(p): sha(p) for p in (ROOT/'server/data/gcsp/vehicle-evidence/fleet-source.v1').rglob('*') if p.is_file()}
descriptor_inputs = read(pathlib.Path(plan['candidateRoot'])/'descriptor-inputs.json')
for item in descriptor_inputs['files']: inputs[item['path']] = item['sha256']
for item in descriptor_inputs['sources']:
    inputs[str(ROOT/'server/data/gcsp/vehicle-evidence/registered-sources'/item['origin'])] = item['sha256']
inputs[str(pathlib.Path(plan['candidateRoot'])/'descriptor-inputs.json')] = plan['descriptorInputsSha256']
command = ['/opt/homebrew/bin/node', '--max-old-space-size=256', '--expose-gc', str(BASE/'prepare.mjs'), phase]
selection = {'scope': 'scoped offline '+phase, 'changedPaths': [str(BASE), 'server/gcsp/vehicle-evidence/fleet-releases.json'],
    'regression': 'additive unchanged .6 candidate and existing publisher/package formats',
    'affectedCallers': ['SyntheticRegistry.publish/load', 'validateRelease', 'packFleetRelease'],
    'integrationBoundaries': ['immutable candidate/source anchors', 'prior history and version bytes', 'code-owned descriptor selection'],
    'selectedCommand': command, 'excluded': plan['excluded'], 'resources': plan['resources'], 'codePins': identity, 'inputPins': inputs,
    'expectedPeakDiskMiB': 160, 'expectedPeakChildRamMiB': 320, 'expectedDurationSeconds': 30,
    'checkpoint': str(output/('publication-receipt.json' if phase == 'describe' else 'pack-receipt.json'))}
R.atomic_json(metadata/'selection.json', selection)
policy = R.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 512, 'chunk_seconds': 120, 'log_mib': 1})
scratch = R.Scratch(metadata, ROOT, policy, expected=64*R.MIB, checkpoint=pathlib.Path(selection['checkpoint']))
host = R.HostBudget(policy)
link = ROOT/'server/node_modules'
vendor = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
assert vendor.is_dir() and not os.path.lexists(link)
reserved = entered = finished = False
link_identity = None
result = {}
R.atomic_json(metadata/'retained-output-ownership.json', {'owner': R.owner(), 'runId': plan['runId'], 'outputRoot': str(output),
    'phase': phase, 'disposable': False, 'expectedRetainedMiB': 90, 'retainOnInterruption': True,
    'scratchRoot': str(scratch.root), 'scratchManifest': str(scratch.manifest), 'state': 'planned'})

def finish():
    global entered, reserved, finished, link_identity
    if finished: return
    assert all(R.group_has_live_members(g) is False for g in scratch.record['groups']), 'owned groups must be stopped/joined'
    if link_identity is not None:
        st = link.lstat()
        assert link.is_symlink() and (st.st_dev, st.st_ino) == link_identity and link.readlink() == vendor
        link.unlink(); link_identity = None
    if entered:
        opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=10)
        assert opened.returncode in [0, 1] and not opened.stdout.strip()
        scratch.__exit__(None, None, None); entered = False
    if reserved: host.release(scratch.token); reserved = False
    assert all(sha(pathlib.Path(p)) == h for p, h in identity.items()), 'code identity changed during chunk'
    assert all(sha(pathlib.Path(p)) == h for p, h in inputs.items()), 'immutable input changed during chunk'
    cleanup = {'scratch': str(scratch.root), 'manifest': str(scratch.manifest), 'scratchAbsent': not os.path.lexists(scratch.root),
        'groupsAbsent': True, 'dependencyLinkAbsent': not os.path.lexists(link),
        'reservationAbsent': scratch.token not in (R.read_json(host.path, {}) or {}), 'removedScratchPeakBytes': scratch.record['peak'],
        'retainedOutput': str(output), 'retainedLogicalBytes': sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),
        'retainedAllocationBytes': R.allocated_bytes(output), 'compatibilityException': None, 'leftovers': [],
        'codeIdentityUnchanged': True, 'inputIdentityUnchanged': True, 'freeDiskBytes': shutil.disk_usage(cloud).free}
    R.atomic_json(metadata/'cleanup.json', cleanup)
    finished = True
    assert all(cleanup[k] for k in ['scratchAbsent', 'groupsAbsent', 'dependencyLinkAbsent', 'reservationAbsent'])

atexit.register(finish)
try:
    with R.handled_termination():
        host.acquire(scratch.token, 160*R.MIB, 512*R.MIB, cloud, root=scratch.root); reserved = True
        scratch.__enter__(); entered = True
        if phase == 'describe': output.mkdir(mode=0o700)
        link.symlink_to(vendor, target_is_directory=True)
        st = link.lstat(); link_identity = (st.st_dev, st.st_ino)
        R.atomic_json(metadata/'dependency-ownership.json', {'path': str(link), 'target': str(vendor), 'device': st.st_dev, 'inode': st.st_ino})
        result = R.run_process(command, ROOT, {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC'},
            metadata/'command.log', scratch, policy, 64*R.MIB, 448*R.MIB, 120, host)
        R.atomic_json(metadata/'result.json', result)
finally:
    try: finish()
    finally: atexit.unregister(finish)

if result.get('rc') == 0 and result.get('issue') is None:
    receipt_path = pathlib.Path(selection['checkpoint'])
    compact = {'scope': 'scoped', 'result': result, 'cleanup': read(metadata/'cleanup.json'),
        'receipt': read(receipt_path), 'receiptSha256': sha(receipt_path), 'selection': str(metadata/'selection.json'),
        'selectionSha256': sha(metadata/'selection.json'), 'planSha256': sha(BASE/'plan.json'), 'acceptance': False}
    R.atomic_json(BASE/(phase+'-results.json'), compact)
    R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot6-package-'+phase+'-'+sha(BASE/'plan.json')[:16]+'.json'),
        {'schemaVersion': 'test-impact.v1', 'scope': 'scoped', 'identity': identity, 'inputs': inputs,
         'map': {'synthetic-registry.js': 'existing publisher over unchanged candidate; prior history and version preservation' if phase == 'describe' else 'not repeated; described store identity reused',
                 'fleet-release.js': 'existing descriptor validator and exact previous entries', 'fleet-artifacts.js': 'existing hash/size checked 21-asset pack' if phase == 'pack' else 'pack deferred to next chunk'},
         'fixtureConfigSubprocessEdges': 'actual immutable .6 candidate + ten retained registered shards; Node child, offline guard, fixed policy asOf',
         'timingSeconds': result['wall'], 'maxSampledRssBytes': result['peak_rss'], 'excluded': plan['excluded']})
    (metadata/'command.log').unlink()
    print(json.dumps({'status': 'scoped-offline-'+phase+'-passed', 'seconds': result['wall'], 'rss': result['peak_rss'], 'cleanup': compact['cleanup']}))
else:
    if (metadata/'command.log').exists(): print((metadata/'command.log').read_text()[-12000:])
    print(json.dumps(result)); sys.exit(1)
