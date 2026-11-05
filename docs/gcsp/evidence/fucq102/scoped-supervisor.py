#!/usr/bin/env python3
"""Bounded FUCQ-102 proof; optional exact immutable actual-producer composition. No installs/listeners."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher')
RECORDS = SHARED / '.claude/test-runs/fucq102'
TOKEN_REF = '5d8b01fe16d4cd16b4ff124619f0efe3e099a260'
TOKEN_HASH = '325b699d7dfdb435cd8713015017aa68bf735582f127d7d64a0e0fc819f7b915'
PG = SHARED / 'server/node_modules/pg/lib/index.js'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

r = module('fucq102_resources', ROOT / '_tools/test_resources.py')
g = module('fucq102_git', ROOT / '_tools/scaffold_git.py')
policy = r.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128, 'chunk_ram_mib': 768,
                   'unit_scratch_mib': 16, 'unit_ram_mib': 256, 'log_mib': 2})
host = r.HostBudget(policy)
producer = '--producer' in sys.argv
run = ('producer-' if producer else 'scoped-') + str(time.time_ns())
record_dir = RECORDS / run
record_dir.mkdir(parents=True, exist_ok=False)
env = dict(os.environ)
for key in list(env):
    if key.startswith(('PG', 'DB_')) or 'DATABASE' in key or 'POSTGRES' in key:
        env.pop(key)
for key in ['NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'DEBUG']:
    env.pop(key, None)
paths = ['server/gcsp/offers/access.js', 'server/gcsp/offers/access-http.js',
         'server/index.js', 'server/test/gcsp-offer-access.test.js', str(Path(__file__).relative_to(ROOT))]
if producer:
    paths += ['server/test/gcsp-offer-access-producer.test.js',
              'docs/gcsp/evidence/fucq102/producer-loader.mjs',
              'docs/gcsp/evidence/fucq102/producer-source-plan.json']
source_plan = json.loads((ROOT / 'docs/gcsp/evidence/fucq102/producer-source-plan.json').read_text()) if producer else None
if producer and hashlib.sha256((ROOT / 'docs/gcsp/evidence/fucq102/producer-source-plan.json').read_bytes()).hexdigest() != '103999b51420bd3845e42bfe6047debf2f34055d0de6efae19be907884e02e30':
    raise RuntimeError('Approved producer source plan identity mismatch')
source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
plan = {'scope': ('actual100 immutable six-overlay memory producer/access/expiry/reset and in-process host; retained-pg variant' if producer else 'memory/service/streamed HTTP and in-process host registration; retained-pg variant'),
        'tests': ['node --test --test-concurrency=1 server/test/gcsp-offer-access.test.js'],
        'excluded': ['native database', 'browser', 'runtime bootstrap/deployment', 'remote producer uncertainty', 'listeners', 'full suite'] + ([] if producer else ['actual producer']),
        'source_hashes': source_hashes, 'token_ref': TOKEN_REF, 'token_sha256': TOKEN_HASH,
        'base': 'b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96',
        'head': g.git(ROOT, ['rev-parse', 'HEAD'])[1].strip(),
        'policy': {'seconds': 120, 'ram_mib': 768, 'combined_scratch_output_mib': 128, 'logs_mib': 2, 'workers': 1},
        'headroom': host.headroom(str(ROOT)), 'environment_digest': r.digest(env),
        'database_aliases_absent': not any(key.startswith(('PG', 'DB_')) or 'DATABASE' in key or 'POSTGRES' in key for key in env),
        'supervisor': {**r.owner(), 'pgid': os.getpgrp()},
        'checkpoints': 'completed result, exact source hashes, bounded failure log; no successful verbose output retained',
        'dependencies': [{'path': str(PG), 'device': PG.stat().st_dev, 'inode': PG.stat().st_ino,
                          'sha256': hashlib.sha256(PG.read_bytes()).hexdigest(), 'ownership': 'existing read-only; no links or installs'}]}
plan['node_options_and_debug_unset'] = all(key not in env for key in ['NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','DEBUG'])
if producer: plan['producer_source_plan'] = source_plan
r.atomic_json(record_dir / 'plan.json', plan)
scratch = r.Scratch(record_dir, str(ROOT), policy, expected=16*r.MIB)
scratch.root = Path('/private/tmp') / ('fucq102-' + scratch.token)
scratch.record.update(root=str(scratch.root), supervisor_finalizer=str(Path(__file__).resolve()),
                      ports=[], profiles=[], dependency_links=[], retained_summary=str(record_dir / 'summary.json'))
r.atomic_json(scratch.manifest, scratch.record)  # External manifest before any scratch allocation.
samples = []; identities = {}; observed_groups = set(); peak_rss = [0]
port_note = {}

def sync_port():
    journal = scratch.root / 'ports.json'
    if journal.exists():
        note = json.loads(journal.read_text())
        if note.get('host') != '127.0.0.1' or not isinstance(note.get('port'), int) or not 0 < note['port'] < 65536:
            raise RuntimeError('Invalid owned listener record')
        port_note.update(note)
        scratch.record['ports'] = [dict(port_note)]
        r.atomic_json(scratch.manifest, scratch.record)
        r.atomic_json(record_dir / 'ports.json', port_note)

def port_absent():
    if not port_note:
        return True
    probe = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:'+str(port_note['port']), '-sTCP:LISTEN', '-Fpn'],
                           capture_output=True, text=True, timeout=3)
    return probe.returncode == 1 and not probe.stdout.strip()
original_rss = r.group_rss

def recursive_rss(pgid):
    snapshot = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat='], capture_output=True, text=True, timeout=3)
    if snapshot.returncode or not snapshot.stdout.strip():
        raise RuntimeError('Cannot establish recursive child ownership')
    rows = [dict(zip(('pid','ppid','pgid','rss','stat'), line.split())) for line in snapshot.stdout.splitlines() if len(line.split()) == 5]
    for row in rows:
        for key in ('pid','ppid','pgid','rss'): row[key] = int(row[key])
    selected = {row['pid'] for row in rows if row['pgid'] in set(scratch.record['groups'])}
    prior = set()
    while prior != selected:
        prior = selected.copy(); selected.update(row['pid'] for row in rows if row['ppid'] in selected)
    members = [row for row in rows if row['pid'] in selected and not row['stat'].startswith('Z')]
    groups = {row['pgid'] for row in members}; observed_groups.update(groups)
    for group in groups:
        if any(row['pgid'] == group and row['pid'] not in selected for row in rows):
            raise RuntimeError('Foreign shared process group')
        if group not in scratch.record['groups']: scratch.record['groups'].append(group)
    for row in members:
        if row['pid'] not in identities: identities[row['pid']] = r.process_identity(row['pid'])
        row['start'] = identities[row['pid']]
    total = sum(row['rss'] * 1024 for row in members); peak_rss[0] = max(peak_rss[0], total)
    samples.append({'time': time.time(), 'members': members, 'rss': total})
    r.atomic_json(record_dir / 'process-checkpoints.json', {'samples': samples})
    return total

r.group_rss = recursive_rss
log = record_dir / 'checks.log'
base_sample = scratch.sample
def combined_sample():
    sync_port()
    size = base_sample() + (log.stat().st_size if log.exists() else 0)
    scratch.record['peak'] = max(scratch.record['peak'], size)
    return size
scratch.sample = combined_sample
reserved = False; result = {}; failure = None; dependencies_validated = False
extra_inputs = []; composition = None; observed_modules = []
try:
    allocation = host.acquire(scratch.token, 128*r.MIB, 768*r.MIB, str(ROOT), root=scratch.root)
    reserved = True
    with r.handled_termination(), scratch:
        if producer:
            expected_overlays = {
                'server/gcsp/offers/buddy-hold.js', 'server/gcsp/offers/buddy-remote.js',
                'server/gcsp/offers/current-car-comparison.js', 'server/gcsp/offers/offer-token.js',
                'server/gcsp/recommendation/index.js', 'server/gcsp/repository/core.js'}
            if source_plan['producer_ref'] != 'a7fc8580efba36c329b2479711d6b66db53962bd' or len(source_plan['module_sources']) != 35:
                raise RuntimeError('Unapproved producer source plan')
            overlays = {path for path, row in source_plan['module_sources'].items() if row['composition'].startswith('immutable')}
            if overlays != expected_overlays: raise RuntimeError('Unapproved overlay set')
            modules = []
            for relative, source in source_plan['module_sources'].items():
                canonical = ROOT / relative
                if relative in overlays:
                    code, content, _ = g.git(ROOT, ['show', source_plan['producer_ref'] + ':' + relative])
                    if code or hashlib.sha256(content.encode()).hexdigest() != source['sha256']:
                        raise RuntimeError('Immutable overlay identity mismatch')
                    actual = (scratch.root / 'overlays' / relative).with_suffix('.mjs')
                    actual.parent.mkdir(parents=True, exist_ok=True); actual.write_text(content)
                else:
                    actual = canonical
                    if hashlib.sha256(actual.read_bytes()).hexdigest() != source['sha256']:
                        raise RuntimeError('Read-only producer dependency mismatch')
                extra_inputs.append(str(actual))
                modules.append({'path':relative, 'canonical':canonical.as_uri(), 'url':actual.as_uri(),
                                'sha256':source['sha256'], 'overlay':relative in overlays})
            for relative, digest in source_plan['file_inputs'].items():
                if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Producer file input identity mismatch')
                extra_inputs.append(relative)
            mapping = scratch.root / 'producer-modules.json'
            composition = {'modules': modules, 'pg': PG.as_uri(),
                'overlayRoot':(scratch.root / 'overlays').as_uri()+'/', 'journal':str(scratch.root / 'modules.jsonl')}
            r.atomic_json(mapping, composition)
            loader = scratch.root / 'producer-loader.mjs'
            loader.write_bytes((ROOT / 'docs/gcsp/evidence/fucq102/producer-loader.mjs').read_bytes())
            by_path = {row['path']:row['url'] for row in modules}
            token_path = Path(by_path['server/gcsp/offers/offer-token.js'].removeprefix('file://'))
            env['GCSP_OFFER_TOKEN_MODULE'] = by_path['server/gcsp/offers/offer-token.js']
            env['GCSP_BUDDY_HOLD_MODULE'] = by_path['server/gcsp/offers/buddy-hold.js']
            env['GCSP_PRODUCER_MODULE_MAP'] = str(mapping)
            env['GCSP_OFFER_PRODUCER_SAMPLE'] = str(scratch.root / 'producer-representative.json')
            extra_inputs += [str(mapping), str(loader)]
            plan['composition'] = composition
            plan['loader_sha256'] = hashlib.sha256(loader.read_bytes()).hexdigest()
            r.atomic_json(record_dir / 'plan.json', plan)
        else:
            rc, token_source, _ = g.git(ROOT, ['show', TOKEN_REF + ':server/gcsp/offers/offer-token.js'])
            if rc or hashlib.sha256(token_source.encode()).hexdigest() != TOKEN_HASH:
                raise RuntimeError('Published token source identity mismatch')
            token_path = scratch.root / 'offer-token.mjs'; token_path.write_text(token_source)
            loader = scratch.root / 'retained-pg-loader.mjs'
            loader.write_text('export async function resolve(s,c,n){if(s==="pg")return {url:' + json.dumps(PG.as_uri()) + ',shortCircuit:true};return n(s,c);}'+'\n')
            env['GCSP_OFFER_TOKEN_MODULE'] = token_path.as_uri()
            extra_inputs += [str(token_path),str(loader)]
        env['GCSP_OFFER_ACCESS_SAMPLE'] = str(scratch.root / 'representative.json')
        env['GCSP_OFFER_COMPARISON_SAMPLE'] = str(scratch.root / 'comparison-representative.json')
        env.pop('GCSP_OFFER_ACCESS_PORT_RECORD', None)
        command = ['node', '--no-warnings', '--loader', str(loader), '--test', '--test-reporter=tap', '--test-concurrency=1', 'server/test/gcsp-offer-access.test.js']
        if producer: command += ['server/test/gcsp-offer-access-producer.test.js']
        plan['tests'] = [shlex.join(command)]
        r.atomic_json(record_dir / 'plan.json', plan)
        if '--strict' in sys.argv:
            stamp = module('fucq102_stamp', ROOT / '_tools/test_stamp.py')
            def adapter_git(root, arguments):
                code, out, err = g.git(Path(root), arguments)
                if code: raise stamp.RunError(err or out)
                return out.rstrip()
            stamp._git = adapter_git
            stamp.ref_exists = lambda root, ref: g.git(Path(root), ['rev-parse','--verify','--quiet',ref+'^{commit}'])[0] == 0
            stamp.resource_module = lambda: r
            original_load = stamp.load_settings
            def bounded_load(root, command_override=None):
                settings = original_load(root, command_override)
                settings.resources = dict(settings.resources, chunk_seconds=120, chunk_scratch_mib=128,
                    chunk_ram_mib=768, log_mib=2, inputs=paths + extra_inputs + [str(PG),
                    '_tools/test_resources.py', '_tools/test_stamp.py', 'server/gcsp/policy/seed-v1.json',
                    'server/test/helpers/employee-recommendation.js'])
                return settings
            stamp.load_settings = bounded_load
            # Reuse this already-owned, bounded process launcher. No hidden second allocation or full fallback.
            def selected_run(settings, args, chosen, rdir, say, classes_fn=None, identity=None):
                global result
                if chosen or settings.command != shlex.join(command): raise RuntimeError('Unexpected verification plan')
                result = r.run_process(command, str(ROOT), env, log, scratch, policy,
                                       allocation['disk'], allocation['ram'], 120, host=host)
                observed = {key:int(value) for key,value in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$', log.read_text(), re.M)}
                passed = result['rc'] == 0 and not result['issue'] and observed.get('pass',0) > 0 and observed.get('fail') == 0
                return passed, observed.get('tests',0), observed.get('skipped',0), result['wall']
            stamp.run_suite = selected_run
            os.environ.clear(); os.environ.update(env)
            os.environ['TEST_STAMP_DIR'] = str(record_dir / 'strict')
            strict_rc = stamp.main(['--root',str(ROOT),'--jobs','1','--targeted',plan['base'],
                '--command',shlex.join(command),'--reason',('Exact published actual100 allocation/current-car/custody/expiry/reset to access plus all 28 existing checks using the declared six-overlay composition; no listener/native/runtime bootstrap/browser/full.' if producer else 'Explicit one-offer exchange/read/account authority/hash-session, streamed HTTP and in-process buildServer checks; actual producer/native/runtime bootstrap/browser/full excluded.')])
            result['strict_rc'] = strict_rc
            if strict_rc: failure = 'SelectedChecksFailed'
        else:
            result = r.run_process(command, str(ROOT), env, log, scratch, policy,
                                   allocation['disk'], allocation['ram'], 120, host=host)
        if result['rc'] == 0 and not result['issue']:
            sample = json.loads((scratch.root / 'representative.json').read_text())
            r.atomic_json(record_dir / 'representative.json', sample)
            comparison_sample = json.loads((scratch.root / 'comparison-representative.json').read_text())
            r.atomic_json(record_dir / 'comparison-representative.json', comparison_sample)
        if producer:
            observed_modules = [json.loads(line) for line in (scratch.root / 'modules.jsonl').read_text().splitlines()]
            expected = {row['path']:row for row in composition['modules']}
            if any(row['path'] not in expected or row['sha256'] != expected[row['path']]['sha256']
                   or row['overlay'] != expected[row['path']]['overlay'] for row in observed_modules):
                raise RuntimeError('Observed module identity mismatch')
            if {row['path'] for row in observed_modules if row['overlay']} != overlays:
                raise RuntimeError('Not all exact producer overlays were exercised')
            r.atomic_json(record_dir / 'observed-modules.json', observed_modules)
            for relative, source in source_plan['module_sources'].items():
                actual = next(row['url'] for row in composition['modules'] if row['path'] == relative)
                if hashlib.sha256(Path(actual.removeprefix('file://')).read_bytes()).hexdigest() != source['sha256']:
                    raise RuntimeError('Producer module changed during proof')
            for relative, digest in source_plan['file_inputs'].items():
                if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Producer file input changed during proof')
            if result.get('rc') == 0 and not result.get('issue'):
                r.atomic_json(record_dir / 'producer-representative.json', json.loads((scratch.root / 'producer-representative.json').read_text()))
        sync_port()
        if port_note: raise RuntimeError('This proof did not authorise a listener')
        if not port_absent(): raise RuntimeError('Owned listener remains or absence is uncertain')
        for group in scratch.record['groups']:
            if r.group_has_live_members(group) is not False: raise RuntimeError('Owned process group still live or uncertain')
        for dep in plan['dependencies']:
            path = Path(dep['path']); st = path.stat()
            if (st.st_dev, st.st_ino, hashlib.sha256(path.read_bytes()).hexdigest()) != (dep['device'], dep['inode'], dep['sha256']):
                raise RuntimeError('Read-only dependency identity changed')
        dependencies_validated = True
except BaseException as error:
    failure = type(error).__name__  # Never retain exception payloads containing provider/request secrets.
finally:
    if reserved: host.release(scratch.token)
    # Audit retained dependencies even when a selected check or loader failed.
    try:
        for dep in plan['dependencies']:
            path = Path(dep['path']); st = path.stat()
            if (st.st_dev, st.st_ino, hashlib.sha256(path.read_bytes()).hexdigest()) != (dep['device'], dep['inode'], dep['sha256']):
                raise RuntimeError('Read-only dependency identity changed')
        if producer:
            for relative, source in source_plan['module_sources'].items():
                if not source['composition'].startswith('immutable') and hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != source['sha256']:
                    raise RuntimeError('Read-only producer dependency changed')
            for relative, digest in source_plan['file_inputs'].items():
                if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Producer file input changed')
        dependencies_validated = True
    except BaseException:
        dependencies_validated = False
        failure = failure or 'RetainedDependencyAuditFailed'
    absent = not os.path.lexists(scratch.root)
    raw_log = log.read_text() if log.exists() else ''
    counts = {key: int(value) for key,value in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$', raw_log, re.M)}
    if not counts.get('tests') or counts.get('pass', 0) == 0:
        failure = failure or 'NoObservedChecks'
    summary = {'scope': plan['scope'], 'source_hashes': source_hashes, 'result': result, 'counts': counts,
               'failure': failure, 'observed_modules':len(observed_modules), 'composition': 'six immutable actual100 overlays' if producer else 'published token only', 'cleanup': {'scratch_absent': absent, 'manifest': str(scratch.manifest),
               'groups_absent': all(r.group_has_live_members(group) is False for group in scratch.record['groups']),
               'reservation_released': scratch.token not in r.read_json(host.path, {}), 'ports': [port_note] if port_note else [], 'ports_absent': port_absent(), 'profiles': [], 'dependency_links': [],
               'dependencies_unchanged': dependencies_validated}, 'peak_rss': peak_rss[0]}
    r.atomic_json(record_dir / 'summary.json', summary)
    if result.get('rc') == 0 and not result.get('issue') and not failure:
        log.unlink(missing_ok=True)
    print(json.dumps({'summary':str(record_dir/'summary.json'),'counts':counts,'failure':failure,'rc':result.get('rc'),'cleanup':summary['cleanup']}))
    if raw_log and (result.get('rc') != 0 or failure):
        print('\n'.join(line for line in raw_log.splitlines() if line.startswith(('not ok', '# tests', '# pass', '# fail', '# skipped'))))
sys.exit(1 if failure or result.get('rc') != 0 or result.get('issue') or not absent else 0)
