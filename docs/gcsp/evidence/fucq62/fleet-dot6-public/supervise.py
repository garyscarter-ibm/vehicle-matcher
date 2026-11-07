"""One worker, explicit 192 MiB OneDrive scratch, bounded public-boundary chunks."""
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
assert phase in ['check', 'publish', 'download'] or (phase.startswith('publish-') and phase[8:].isdigit()) or (phase.startswith('check-') and phase[6:].isdigit())
mode = '--check' if phase.startswith('check') else ('publish' if phase.startswith('publish') else 'download')
plan = read(BASE/'plan.json')
output = pathlib.Path(plan['outputRoot'])
cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents
metadata = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot6-public')/phase
destination = output/phase
assert not metadata.exists() and not destination.exists(), 'fresh chunk only; preserve earlier results'
spec = importlib.util.spec_from_file_location('resources', ROOT/'_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
code = [BASE/'plan.json', BASE/'run.mjs', BASE/'supervise.py', ROOT/'scripts/gcsp/verify-fleet.mjs', ROOT/'scripts/gcsp/fleet-offline-guard.mjs', ROOT/'server/scripts/fleet-artifacts.mjs', ROOT/'server/index.js']
for directory in ['server/gcsp/vehicle-evidence', 'server/gcsp/policy', 'server/gcsp/repository', 'server/vehicle-evidence']:
    code.extend((ROOT/directory).glob('*.js')); code.extend((ROOT/directory).glob('*.json'))
identity = {str(p): sha(p) for p in sorted(set(code))}
inputs = {str(p): sha(p) for p in (ROOT/'server/data/gcsp/vehicle-evidence/fleet-source.v1').rglob('*') if p.is_file()}
descriptor = read(pathlib.Path(plan['packageRoot'])/'descriptor.json')
inputs[str(pathlib.Path(plan['packageRoot'])/'descriptor.json')] = plan['descriptorSha256']
for asset in descriptor['assets']: inputs[str(pathlib.Path(plan['packageRoot'])/'pack'/plan['releaseId']/asset['path'])] = asset['sha256']
image = ROOT/'assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp'
inputs[str(image)] = 'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe'
command = ['/opt/homebrew/bin/node', '--max-old-space-size=192', '--expose-gc', str(BASE/'run.mjs'), mode, str(destination)]
checkpoint = destination/('check.json' if mode == '--check' else 'receipt.json')
selection = {'scope': 'scoped .6 '+phase+' public boundary', 'changedPaths': [str(BASE), 'server/gcsp/vehicle-evidence/fleet-releases.json'],
    'regression': 'immutable .6 descriptor/asset release and real anonymous restore followed by full current-corpus parity',
    'affectedCallers': ['GitHub release API', 'production fleet-artifacts CLI', 'verifyActiveFleet', 'SyntheticRegistry.load'],
    'integrationBoundaries': ['exact committed descriptor/tag/assets', 'anonymous public GitHub/CDN transfer', 'durable inventory/current+previous selection', 'fresh offline production DTO/HTTP path'],
    'selectedCommand': command, 'excluded': plan['excluded'], 'resources': plan['resources'], 'codePins': identity, 'inputPins': inputs,
    'checkpoint': str(checkpoint), 'expectedPeakScratchMiB': 90 if mode == 'download' else 0,
    'expectedPeakChildRamMiB': 340, 'expectedDurationSeconds': 80 if mode == 'download' else 60}
R.atomic_json(metadata/'selection.json', selection)
policy = R.Policy({'chunk_scratch_mib': 192, 'chunk_ram_mib': 512, 'chunk_seconds': 120, 'log_mib': 1})
scratch = R.Scratch(metadata, ROOT, policy, expected=192*R.MIB, checkpoint=checkpoint)
# Place even this sub-256 MiB working set directly on OneDrive, as explicitly agreed for this public boundary.
scratch.root = output/'.scratch'/('test-stamp-shard-'+scratch.token)
scratch.record.update(root=str(scratch.root), location='cloud')
host = R.HostBudget(policy)
link = ROOT/'server/node_modules'
vendor = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
assert vendor.is_dir() and not os.path.lexists(link)
reserved = entered = finished = False
link_identity = None
result = {}
R.atomic_json(metadata/'retained-output-ownership.json', {'owner': R.owner(), 'runId': plan['runId'], 'outputRoot': str(output),
    'phase': phase, 'disposable': False, 'expectedRetainedMiB': 1, 'retainOnInterruption': True,
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
    if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()): scratch.root.parent.rmdir()
    if reserved: host.release(scratch.token); reserved = False
    assert all(sha(pathlib.Path(p)) == h for p, h in identity.items()), 'code identity changed during chunk'
    assert all(sha(pathlib.Path(p)) == h for p, h in inputs.items()), 'immutable input changed during chunk'
    cleanup = {'scratch': str(scratch.root), 'manifest': str(scratch.manifest), 'scratchAbsent': not os.path.lexists(scratch.root),
        'groupsAbsent': True, 'dependencyLinkAbsent': not os.path.lexists(link),
        'reservationAbsent': scratch.token not in (R.read_json(host.path, {}) or {}), 'removedScratchPeakBytes': scratch.record['peak'],
        'retainedOutput': str(destination), 'retainedLogicalBytes': sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),
        'compatibilityException': None, 'leftovers': [], 'codeIdentityUnchanged': True, 'inputIdentityUnchanged': True, 'freeDiskBytes': shutil.disk_usage(cloud).free}
    R.atomic_json(metadata/'cleanup.json', cleanup); finished = True
    assert all(cleanup[k] for k in ['scratchAbsent', 'groupsAbsent', 'dependencyLinkAbsent', 'reservationAbsent'])

atexit.register(finish)
try:
    with R.handled_termination():
        host.acquire(scratch.token, 192*R.MIB, 512*R.MIB, cloud, root=scratch.root); reserved = True
        scratch.__enter__(); entered = True
        destination.mkdir(parents=True, mode=0o700)
        link.symlink_to(vendor, target_is_directory=True)
        st = link.lstat(); link_identity = (st.st_dev, st.st_ino)
        R.atomic_json(metadata/'dependency-ownership.json', {'path': str(link), 'target': str(vendor), 'device': st.st_dev, 'inode': st.st_ino})
        result = R.run_process(command, ROOT, {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC', 'HOME': os.environ['HOME']},
            metadata/'command.log', scratch, policy, 192*R.MIB, 448*R.MIB, 120, host)
        R.atomic_json(metadata/'result.json', result)
finally:
    try: finish()
    finally: atexit.unregister(finish)

if result.get('rc') == 0 and result.get('issue') is None:
    compact = {'scope': 'scoped', 'result': result, 'cleanup': read(metadata/'cleanup.json'), 'receipt': read(checkpoint),
        'receiptSha256': sha(checkpoint), 'selection': str(metadata/'selection.json'), 'selectionSha256': sha(metadata/'selection.json'),
        'planSha256': sha(BASE/'plan.json'), 'runnerSha256': sha(BASE/'run.mjs'), 'supervisorSha256': sha(BASE/'supervise.py'), 'acceptance': False}
    R.atomic_json(BASE/(phase+'-results.json'), compact)
    R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot6-public-'+phase+'-'+sha(BASE/'plan.json')[:16]+'.json'),
        {'schemaVersion': 'test-impact.v1', 'scope': 'scoped', 'identity': identity, 'inputs': inputs,
         'map': {'fleet-release.js': 'exact .6 descriptor, previous .5 descriptor and immutable target',
                 'fleet-artifacts.js': 'actual anonymous CLI/cold restore and offline restart' if mode == 'download' else 'not replayed; existing offline package pins reused',
                 'verify-fleet.mjs': '871 direct + 871 production HTTP cases and zero egress' if mode == 'download' else 'later public-download chunk',
                 'synthetic-registry.js': '.6-only source corruption recovers image-bearing .5 with complete history unchanged' if mode == 'download' else 'existing offline package evidence reused'},
         'fixtureConfigSubprocessEdges': 'immutable 21 real public assets; fresh Node CLI/audit children, loopback HTTP, fixed policy asOf; complete prior inventory pins',
         'timingSeconds': result['wall'], 'maxSampledRssBytes': result['peak_rss'], 'removedScratchPeakBytes': result['peak_scratch'], 'excluded': plan['excluded']})
    (metadata/'command.log').unlink()
    print(json.dumps({'status': 'scoped-dot6-'+phase+'-passed', 'receiptSha256': compact['receiptSha256'], 'planSha256': compact['planSha256'],
        'runnerSha256': compact['runnerSha256'], 'supervisorSha256': compact['supervisorSha256'], 'seconds': result['wall'], 'rss': result['peak_rss'], 'cleanup': compact['cleanup']}))
else:
    if (metadata/'command.log').exists(): print((metadata/'command.log').read_text()[-12000:])
    print(json.dumps(result)); sys.exit(1)
