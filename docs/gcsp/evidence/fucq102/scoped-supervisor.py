#!/usr/bin/env python3
"""Bounded, credential-unset, listener-free FUCQ-102 proof. No dependency installation."""
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
run = 'scoped-' + str(time.time_ns())
record_dir = RECORDS / run
record_dir.mkdir(parents=True, exist_ok=False)
env = dict(os.environ)
for key in list(env):
    if key.startswith(('PG', 'DB_')) or 'DATABASE' in key or 'POSTGRES' in key:
        env.pop(key)
paths = ['server/gcsp/offers/access.js', 'server/gcsp/offers/access-http.js',
         'server/test/gcsp-offer-access.test.js', str(Path(__file__).relative_to(ROOT))]
source_hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
plan = {'scope': 'independent memory/service/streamed HTTP; retained-pg loader variant',
        'tests': ['node --test --test-concurrency=1 server/test/gcsp-offer-access.test.js'],
        'excluded': ['native database', 'listener/browser', 'actual producer', 'central runtime', 'full suite'],
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
r.atomic_json(record_dir / 'plan.json', plan)
scratch = r.Scratch(record_dir, str(ROOT), policy, expected=16*r.MIB)
scratch.root = Path('/private/tmp') / ('fucq102-' + scratch.token)
scratch.record.update(root=str(scratch.root), supervisor_finalizer=str(Path(__file__).resolve()),
                      ports=[], profiles=[], dependency_links=[], retained_summary=str(record_dir / 'summary.json'))
r.atomic_json(scratch.manifest, scratch.record)  # External manifest before any scratch allocation.
samples = []; identities = {}; observed_groups = set(); peak_rss = [0]
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
    size = base_sample() + (log.stat().st_size if log.exists() else 0)
    scratch.record['peak'] = max(scratch.record['peak'], size)
    return size
scratch.sample = combined_sample
reserved = False; result = {}; failure = None
try:
    allocation = host.acquire(scratch.token, 128*r.MIB, 768*r.MIB, str(ROOT), root=scratch.root)
    reserved = True
    with r.handled_termination(), scratch:
        rc, token_source, _ = g.git(ROOT, ['show', TOKEN_REF + ':server/gcsp/offers/offer-token.js'])
        if rc or hashlib.sha256(token_source.encode()).hexdigest() != TOKEN_HASH:
            raise RuntimeError('Published token source identity mismatch')
        token_path = scratch.root / 'offer-token.mjs'; token_path.write_text(token_source)
        loader = scratch.root / 'retained-pg-loader.mjs'
        loader.write_text('export async function resolve(s,c,n){if(s==="pg")return {url:' + json.dumps(PG.as_uri()) + ',shortCircuit:true};return n(s,c);}\n')
        env['GCSP_OFFER_TOKEN_MODULE'] = token_path.as_uri()
        env['GCSP_OFFER_ACCESS_SAMPLE'] = str(scratch.root / 'representative.json')
        command = ['node', '--no-warnings', '--loader', str(loader), '--test', '--test-reporter=tap', '--test-concurrency=1', 'server/test/gcsp-offer-access.test.js']
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
                    chunk_ram_mib=768, log_mib=2, inputs=paths + [str(PG), str(token_path),
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
                '--command',shlex.join(command),'--reason','Explicit new one-offer exchange/read/account/hash-session and streamed HTTP boundary checks; Node affected selector unsupported. Actual producer/native/host/browser/full remain excluded.'])
            result['strict_rc'] = strict_rc
            if strict_rc: raise RuntimeError('Strict targeted evidence failed')
        else:
            result = r.run_process(command, str(ROOT), env, log, scratch, policy,
                                   allocation['disk'], allocation['ram'], 120, host=host)
        if result['rc'] == 0 and not result['issue']:
            sample = json.loads((scratch.root / 'representative.json').read_text())
            r.atomic_json(record_dir / 'representative.json', sample)
        for group in scratch.record['groups']:
            if r.group_has_live_members(group) is not False: raise RuntimeError('Owned process group still live or uncertain')
        for dep in plan['dependencies']:
            path = Path(dep['path']); st = path.stat()
            if (st.st_dev, st.st_ino, hashlib.sha256(path.read_bytes()).hexdigest()) != (dep['device'], dep['inode'], dep['sha256']):
                raise RuntimeError('Read-only dependency identity changed')
except BaseException as error:
    failure = type(error).__name__  # Never retain exception payloads containing provider/request secrets.
finally:
    if reserved: host.release(scratch.token)
    absent = not os.path.lexists(scratch.root)
    raw_log = log.read_text() if log.exists() else ''
    counts = {key: int(value) for key,value in re.findall(r'^# (tests|pass|fail|skipped) (\d+)$', raw_log, re.M)}
    if not counts.get('tests') or counts.get('pass', 0) == 0:
        failure = failure or 'NoObservedChecks'
    summary = {'scope': plan['scope'], 'source_hashes': source_hashes, 'result': result, 'counts': counts,
               'failure': failure, 'cleanup': {'scratch_absent': absent, 'manifest': str(scratch.manifest),
               'groups_absent': all(r.group_has_live_members(group) is False for group in scratch.record['groups']),
               'reservation_released': reserved, 'ports': [], 'profiles': [], 'dependency_links': [],
               'dependencies_unchanged': failure != 'Read-only dependency identity changed'}, 'peak_rss': peak_rss[0]}
    r.atomic_json(record_dir / 'summary.json', summary)
    if result.get('rc') == 0 and not result.get('issue') and not failure:
        log.unlink(missing_ok=True)
    print(json.dumps({'summary':str(record_dir/'summary.json'),'counts':counts,'failure':failure,'rc':result.get('rc'),'cleanup':summary['cleanup']}))
    if raw_log and (result.get('rc') != 0 or failure):
        print('\n'.join(line for line in raw_log.splitlines() if line.startswith(('not ok', '# tests', '# pass', '# fail', '# skipped'))))
sys.exit(1 if failure or result.get('rc') != 0 or result.get('issue') or not absent else 0)
