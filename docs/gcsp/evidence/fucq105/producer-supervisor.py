"""Run only the root-approved finite producer/access/view memory proof, with strict receipts."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
BASE = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq105')
PLAN = ROOT / 'docs/gcsp/evidence/fucq105/producer-source-plan.json'
APPROVED_HASH = 'a18f823423405897b558eadb363f749f89410a791c3bf7542685cbe021dcf9f8'
TEST = ROOT / 'server/test/gcsp-offer-view-producer.test.js'
LOADER = ROOT / 'docs/gcsp/evidence/fucq105/producer-loader.mjs'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


r = module('fucq105_resources', ROOT / '_tools/test_resources.py')
g = module('fucq105_git', ROOT / '_tools/scaffold_git.py')
digest = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
if digest(PLAN) != APPROVED_HASH:
    raise RuntimeError('Root-approved source plan changed; review required')
source_plan = json.loads(PLAN.read_text())
if len(source_plan['module_sources']) != 45 or source_plan['overlay_count'] != 8:
    raise RuntimeError('Unapproved composition size')

run_id = 'producer-' + str(time.time_ns())
record_dir = BASE / run_id
run_manifest = BASE / 'ownership' / (run_id + '.json')
harness = {str(path.relative_to(ROOT)): digest(path) for path in
           (TEST, LOADER, Path(__file__).resolve(), ROOT / '_tools/test_resources.py', ROOT / '_tools/test_stamp.py')}
policy = r.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'log_mib': 2})
host = r.HostBudget(policy)


class OwnedScratch(r.Scratch):
    def sample(self):
        snapshot = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,lstart='],
                                  capture_output=True, text=True, timeout=3)
        if snapshot.returncode == 0:
            rows = [line.split(None, 3) for line in snapshot.stdout.splitlines()]
            rows = [dict(pid=int(v[0]), ppid=int(v[1]), pgid=int(v[2]), start=v[3].strip()) for v in rows if len(v) == 4]
            selected = {v['pid'] for v in rows if v['pgid'] in self.record['groups']}
            while True:
                more = {v['pid'] for v in rows if v['ppid'] in selected} - selected
                if not more:
                    break
                selected.update(more)
            seen = {v['pid']: v for v in self.record.get('processes', [])}
            seen.update({v['pid']: v for v in rows if v['pid'] in selected})
            self.record['processes'] = list(seen.values())
            r.atomic_json(self.manifest, self.record)
        used = super().sample() + r.allocated_bytes(record_dir)
        self.record['peak_combined'] = max(self.record.get('peak_combined', 0), used)
        return used


scratch = OwnedScratch(record_dir, ROOT, policy)
scratch.record.update(story='FUCQ-105', ports=[], profiles=[], dependency_links=[], processes=[])
plan = {'scope': 'Approved actual100 allocation -> actual102 streamed HTTP ->105 model/controller/DOM, memory only',
        'source_plan_sha256': APPROVED_HASH, 'source_refs': {key: source_plan[key] for key in ('producer_ref', 'access_ref', 'consumer_ref')},
        'harness_before_allocation': harness, 'file_inputs': source_plan['file_inputs'],
        'module_sources': source_plan['module_sources'], 'dependencies': source_plan['retained_dependencies'],
        'selected': str(TEST.relative_to(ROOT)), 'base': source_plan['validation_base'],
        'limits': {'workers': 1, 'seconds': 120, 'ramMiB': 768, 'combinedScratchOutputMiB': 128, 'logMiB': 2},
        'expected': {'seconds': 10, 'ramMiB': 384, 'scratchMiB': 8},
        'reuse': 'Unchanged73/73 consumer and32/32 access evidence; explicit integration file only.',
        'exclusions': 'No central/bootstrap/106 command/browser/nativeDB/listener/network/mail/full/foreign writes',
        'cleanup': 'Stop/join owned group, verify groups/root absent, release reservation, recheck source/dependency identities; retain safe summaries/failures only.'}
r.atomic_json(run_manifest, {'owner': r.owner(), 'run': run_id, 'output': str(record_dir), 'state': 'planned',
                             'scratch_manifest': str(scratch.manifest), 'harness': harness})
r.atomic_json(record_dir / 'plan.json', plan)  # Final harness hashes/input map precede scratch or overlays.


def verify_current():
    for relative, row in source_plan['module_sources'].items():
        if row['composition'] == 'worktree-identical' and digest(ROOT / relative) != row['sha256']:
            raise RuntimeError('Canonical source identity changed')
    for relative, row in source_plan['file_inputs'].items():
        if digest(ROOT / relative) != row['sha256']:
            raise RuntimeError('Read-only file input changed')
    for row in source_plan['retained_dependencies'].values():
        if digest(row['packageJson']) != row['packageJsonSha256'] or digest(row['entry']) != row['entrySha256']:
            raise RuntimeError('Retained dependency hash changed')
        st = Path(row['installedRoot']).stat()
        if (st.st_dev, st.st_ino) != (row['installationDevice'], row['installationInode']):
            raise RuntimeError('Retained installation identity changed')
    if any(digest(ROOT / relative) != value for relative, value in harness.items()):
        raise RuntimeError('Harness identity changed')


env = {key: value for key, value in os.environ.items()
       if not ('DB' in key.upper() or 'DATABASE' in key.upper() or key.upper().startswith('PG')
               or 'POSTGRES' in key.upper() or 'SQL_URL' in key.upper() or key.upper().startswith('NODE_')
               or key.upper() in ('DEBUG', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'PYTHONPATH', 'PYTHONSTARTUP'))}
result = None
failure = None
allocation = None
observed = []
dependencies_verified = False
strict_messages = []
with r.handled_termination():
    try:
        verify_current()
        allocation = host.acquire(scratch.token, 128*r.MIB, 768*r.MIB, '/private/tmp', root=scratch.root)
        with scratch:
            modules = []
            for relative, row in source_plan['module_sources'].items():
                canonical = ROOT / relative
                actual = canonical
                overlay = row['composition'] == 'immutable-scratch-overlay'
                if overlay:
                    rc, text, err = g.git(ROOT, ['show', row['ref'] + ':' + relative])
                    if rc or hashlib.sha256(text.encode()).hexdigest() != row['sha256']:
                        raise RuntimeError('Immutable source mismatch')
                    actual = (scratch.root / 'overlays' / relative).with_suffix('.mjs')
                    actual.parent.mkdir(parents=True, exist_ok=True)
                    actual.write_text(text)
                modules.append({'path': relative, 'canonical': canonical.as_uri(), 'url': actual.as_uri(),
                                'sha256': row['sha256'], 'overlay': overlay})
            mapping = {'modules': modules, 'test': {'path': str(TEST.relative_to(ROOT)), 'url': TEST.as_uri(),
                       'sha256': digest(TEST)}, 'projectRoot': ROOT.as_uri() + '/',
                       'overlayRoot': (scratch.root / 'overlays').as_uri() + '/',
                       'journal': str(scratch.root / 'modules.jsonl'),
                       'dependencies': {key: {'url': Path(row['entry']).as_uri(), 'sha256': row['entrySha256']}
                                        for key, row in source_plan['retained_dependencies'].items()}}
            mapping_path = scratch.root / 'module-map.json'
            r.atomic_json(mapping_path, mapping)
            env.update(GCSP_FUCQ105_MODULE_MAP=str(mapping_path), GCSP_FUCQ105_CHECKPOINT=str(scratch.root/'phases.json'))
            command = ['node', '--no-warnings', '--loader', str(LOADER), '--test', '--test-concurrency=1',
                       '--test-reporter=tap', str(TEST.relative_to(ROOT))]
            plan['command'] = command
            plan['module_map_sha256'] = digest(mapping_path)
            plan['overlay_hashes_before_execution'] = {row['path']: digest(Path(row['url'].removeprefix('file://')))
                                                       for row in modules if row['overlay']}
            r.atomic_json(record_dir / 'plan.json', plan)
            inputs = [str(ROOT/p) for p in harness] + [str(PLAN), str(mapping_path)]
            inputs += [str(Path(row['url'].removeprefix('file://'))) for row in modules]
            inputs += [str(ROOT/p) for p in source_plan['file_inputs']]
            inputs += [str(Path(row[key]).resolve()) for row in source_plan['retained_dependencies'].values()
                       for key in ('packageJson', 'entry')]
            stamp = module('fucq105_stamp', ROOT / '_tools/test_stamp.py')
            def adapter_git(root, arguments):
                rc, out, err = g.git(Path(root), arguments)
                if rc:
                    raise stamp.RunError(err or out)
                return out.rstrip()
            stamp._git = adapter_git
            stamp.ref_exists = lambda root, ref: g.git(Path(root), ['rev-parse', '--verify', '--quiet', ref+'^{commit}'])[0] == 0
            stamp.resource_module = lambda: r
            original_load = stamp.load_settings
            def bounded_load(root, command_override=None):
                settings = original_load(root, command_override)
                settings.resources = dict(settings.resources, chunk_seconds=120, chunk_scratch_mib=128,
                    chunk_ram_mib=768, log_mib=2, inputs=sorted(set(inputs)))
                return settings
            stamp.load_settings = bounded_load
            log = scratch.root / 'proof.log'
            def selected_run(settings, args, chosen, rdir, say, classes_fn=None, identity=None):
                global result
                if chosen or settings.command != shlex.join(command):
                    raise RuntimeError('Unexpected selected verification plan')
                result = r.run_process(command, str(ROOT), env, log, scratch, policy,
                                       allocation['disk'], allocation['ram'], 120, host=host)
                counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$', log.read_text(), re.M)}
                result['counts'] = counts
                passed = result['rc'] == 0 and not result['issue'] and counts.get('pass') == 1 and counts.get('fail') == 0 and counts.get('skipped') == 0
                return passed, counts.get('tests', 0), counts.get('skipped', 0), result['wall']
            stamp.run_suite = selected_run
            os.environ.clear()
            os.environ.update(env)
            os.environ['TEST_STAMP_DIR'] = str(record_dir / 'strict')
            rc = stamp.main(['--root', str(ROOT), '--jobs', '1', '--targeted', plan['base'],
                             '--command', shlex.join(command), '--reason',
                             'Root-approved45-source/eight-overlay actual100 allocation to102 streamed HTTP to105 controller/DOM with real clock quote/hold expiry/reset, session/account parity and custody. Reuse unchanged73/32 scoped evidence. No browser/native/listener/106 command/central/full scope.'])
            if rc or result is None or result['rc'] or result['issue']:
                failure = 'SelectedChecksFailed'
            if (scratch.root / 'phases.json').is_file():
                r.atomic_json(record_dir / 'phases.json', json.loads((scratch.root / 'phases.json').read_text()))
            if (scratch.root / 'modules.jsonl').is_file():
                observed = [json.loads(line) for line in (scratch.root/'modules.jsonl').read_text().splitlines()]
                r.atomic_json(record_dir / 'observed-modules.json', observed)
            expected = {row['path']: row for row in modules}
            expected[str(TEST.relative_to(ROOT))] = {**mapping['test'], 'canonical': TEST.as_uri(), 'overlay': False}
            if any(row['path'] not in expected or any(row[key] != expected[row['path']][key]
                   for key in ('sha256', 'canonical', 'url', 'overlay')) for row in observed):
                raise RuntimeError('Observed source identity mismatch')
            if not failure and set(row['path'] for row in observed) != set(expected):
                raise RuntimeError('Approved module was not observed')
            for row in modules:
                if digest(Path(row['url'].removeprefix('file://'))) != row['sha256']:
                    raise RuntimeError('Executed source identity changed')
            verify_current()
            dependencies_verified = True
            if failure and log.is_file():
                (record_dir/'failure.log').write_text(log.read_text()[-65536:])
    except BaseException as error:
        failure = failure or type(error).__name__  # Never retain request/provider exception payloads.
    finally:
        if allocation:
            host.release(scratch.token)
        cleanup = {'scratch_absent': not scratch.root.exists(),
                   'groups_absent': all(r.group_has_live_members(group) is False for group in scratch.record['groups']),
                   'reservation_released': scratch.token not in r.read_json(host.path, {}),
                   'manifest': str(scratch.manifest), 'root': str(scratch.root),
                   'ports': [], 'profiles': [], 'dependency_links': []}
        if not all(cleanup[key] for key in ('scratch_absent', 'groups_absent', 'reservation_released')):
            failure = failure or 'CleanupIncomplete'
        strict = list((record_dir/'strict').glob('targeted-*.json')) if (record_dir/'strict').exists() else []
        if not failure and len(strict) != 1:
            failure = 'MissingStrictTargetedReceipt'
        summary = {'status': 'passed' if not failure else 'failed', 'failure': failure,
                   'result': result, 'cleanup': cleanup, 'source_plan_sha256': APPROVED_HASH,
                   'harness': harness, 'dependencies_verified_after': dependencies_verified,
                   'observed_modules': len({row['path'] for row in observed}),
                   'observed_overlays': len({row['path'] for row in observed if row['overlay']}),
                   'peak_combined_bytes': scratch.record.get('peak_combined', 0),
                   'strict_receipt': str(strict[0]) if len(strict) == 1 else None,
                   'exclusions': plan['exclusions']}
        r.atomic_json(record_dir/'summary.json', summary)
        r.atomic_json(run_manifest, {'owner': r.owner(), 'run': run_id, 'output': str(record_dir),
                    'state': 'complete' if not failure else 'failed', 'scratch_manifest': str(scratch.manifest),
                    'harness': harness, 'cleanup': cleanup})
        impact = BASE.parent/'impact'/('fucq105-'+run_id+'.json')
        r.atomic_json(impact, {'sources': plan['module_sources'], 'harness': harness,
                    'selected': str(TEST.relative_to(ROOT)), 'result': summary['status'],
                    'boundaries': plan['exclusions'], 'timing': result['wall'] if result else None})
        print(json.dumps({'summary': str(record_dir/'summary.json'), 'status': summary['status'],
                         'failure': failure, 'counts': result.get('counts') if result else None,
                         'observed_modules': summary['observed_modules'], 'cleanup': cleanup}))
sys.exit(1 if failure else 0)
