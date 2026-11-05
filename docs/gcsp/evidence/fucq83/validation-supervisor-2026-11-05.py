#!/usr/bin/env python3
"""Bounded FUCQ-83 commands and strict stamp adapter; no project settings are changed."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import subprocess
import signal
import time

ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-065')
RECORDS = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq83')
OWNED = ROOT / '.claude/test-scratch/fucq83/lead'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

r = module('fucq83_resources', ROOT / '_tools/test_resources.py')
BaseScratch = r.Scratch

owned_scratch_instances = []

class OwnedScratch(BaseScratch):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.root = OWNED / self.root.name
        self.record['root'] = str(self.root)
        owned_scratch_instances.append(self)
        self.record['supervisor_finalizer'] = str(Path(__file__).resolve())
        self.record['retained_dependency_paths'] = [str(ROOT/'node_modules'), str(ROOT/'server/node_modules')]
        self.record['retained_dependencies'] = {}

    def sample(self):
        used = r.allocated_bytes(self.root)
        for path in (ROOT/'node_modules', ROOT/'server/node_modules'):
            if path.is_symlink():
                raise RuntimeError('Owned dependency tree unexpectedly became a symlink')
            if path.exists():
                stat = path.stat()
                identity = {'device': stat.st_dev, 'inode': stat.st_ino}
                prior = self.record['retained_dependencies'].get(str(path))
                if prior and any(prior[key] != value for key, value in identity.items()):
                    raise RuntimeError('Owned dependency directory identity changed')
                size = r.allocated_bytes(path)
                self.record['retained_dependencies'][str(path)] = {**identity, 'allocated_bytes':size}
                used += size
        self.record['peak'] = max(self.record['peak'], used)
        r.atomic_json(self.manifest, self.record)
        return used


r.Scratch = OwnedScratch

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['command', 'targeted', 'full', 'status'])
parser.add_argument('--name', default='check')
parser.add_argument('--force', action='store_true', help='repeat a full suite explicitly required after base integration')
parser.add_argument('--command')
parser.add_argument('--cwd', choices=['root', 'server'], default='root')
parser.add_argument('--owner', choices=['lead', 'implementer', 'runner'], default='lead')
args = parser.parse_args()
credential_aliases = ['GCSP_DATABASE_URL','DATABASE_URL','POSTGRES_URL','POSTGRESQL_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGPASSFILE','PGSERVICE','PGSERVICEFILE']
for key in credential_aliases:
    os.environ.pop(key, None)
backend_env = dict(os.environ)
if False:  # This resumed supervisor is exclusively credential-unset setup/offline proof.
    secret = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/gcsp-database-url').read_text().strip()
    if not secret or '\n' in secret or '\r' in secret: raise SystemExit('Invalid private database configuration')
    backend_env['GCSP_DATABASE_URL'] = secret
    secret = ''
OWNED = ROOT / '.claude/test-scratch/fucq83' / args.owner
os.environ['TEST_STAMP_DIR'] = str(RECORDS/'strict')
if args.mode in ('full', 'status'):
    shim = RECORDS/'serial-runtime'
    shim.mkdir(parents=True, exist_ok=True)
    real_node = '/opt/homebrew/bin/node'
    (shim/'node').write_text('#!/bin/sh\nif [ "$1" = "--test" ]; then\n  printf \'%s\\0\' '+real_node+' --test-concurrency=1 "$@" > '+str(RECORDS/'full-effective-argv.nul')+'\n  exec '+real_node+' --test-concurrency=1 "$@"\nfi\nexec '+real_node+' "$@"\n')
    (shim/'node').chmod(0o700)
    os.environ['PATH'] = str(shim)+os.pathsep+os.environ['PATH']
full = args.mode in ('full', 'status')
backend_env = dict(os.environ)
if full and 'GCSP_DATABASE_URL' in backend_env:
    raise SystemExit('Full/consumer validation requires explicit credential-unset file mode; native schemas are separate scoped proof.')
limits = {'preferred_free_gib':30, 'reserve_free_gib':5,
          'chunk_scratch_mib':128, 'chunk_seconds':600 if full else 600,
          'unit_scratch_mib':32, 'unit_ram_mib':512 if full else 256,
          'chunk_ram_mib':1024 if full else 768, 'log_mib':2,
          'ram_reserve_mib':512}
limits['inputs'] = ['package.json','package-lock.json','server/package.json','server/package-lock.json','node_modules/.package-lock.json','server/node_modules/.package-lock.json','node_modules/jsdom/package.json','server/node_modules/pg/package.json','_tools/test_resources.py','_tools/test_stamp.py','_tools/scaffold_git.py',str(Path(__file__).resolve())]
policy = r.Policy(limits)
RECORDS.mkdir(parents=True, exist_ok=True)
headroom = r.HostBudget(policy).headroom(str(ROOT))
run = args.name + '-' + str(time.time_ns())
plan = {'version':1, 'mode':args.mode, 'command':args.command, 'force':args.force,
        'root':str(ROOT), 'owned_root':str(OWNED), 'limits':limits,
        'supervisor_owner': {**r.owner(), 'pgid':os.getpgrp()}, 'supervisor_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'environment_digest':r.digest(backend_env), 'native_configured':'GCSP_DATABASE_URL' in backend_env, 'credential_aliases_absent':all(key not in os.environ for key in credential_aliases), 'source_head':__import__('subprocess').check_output(['/usr/bin/python3','-B','-c',"import sys; from pathlib import Path; sys.path.insert(0,'/Users/garycarter/Code/GitHub/vehicle-matcher/_tools'); import scaffold_git as g; print(g.git(Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-065'),['rev-parse','HEAD'])[1].strip())"],text=True,timeout=10).strip(), 'input_hashes':{str(q.relative_to(ROOT)):hashlib.sha256(q.read_bytes()).hexdigest() for q in [ROOT/'server/test/gcsp-policy-versions.test.js',ROOT/'server/test/gcsp-policy-service.test.js',ROOT/'server/gcsp/policy/seed-v1.json']}, 'headroom':headroom, 'onedrive_available':Path(policy.output_root).is_dir(),
        'cleanup':'manifest before allocation; stop/join groups; remove exact scratch; independently verify receipts'}
if full:
    plan['effective_test_argv'] = ['/opt/homebrew/bin/node','--test-concurrency=1','--test','server/test/**/*.test.js']
    plan['configured_command'] = 'npm test'
r.atomic_json(RECORDS / (run + '-plan.json'), plan)

if True:  # All modes require recursive ancestry/group accounting.
    original_stop_group = r.stop_group
    rss_samples = []
    last_sample = [0.0]
    def recursive_group_rss(pgid):
        scratch = next((item for item in owned_scratch_instances if pgid in item.record['groups']), None)
        if scratch is None:
            raise RuntimeError('Missing owned scratch for process group')
        probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,comm='], capture_output=True, text=True, timeout=3)
        if probe.returncode or probe.stderr or not probe.stdout.strip():
            raise RuntimeError('Cannot establish recursive browser process ownership')
        rows = []
        for line in probe.stdout.splitlines():
            parts = line.strip().split(None, 4)
            if len(parts) == 5:
                rows.append({'pid':int(parts[0]), 'ppid':int(parts[1]), 'pgid':int(parts[2]),
                             'rss_bytes':int(parts[3])*1024, 'executable':Path(parts[4]).name})
        known_groups = set(scratch.record['groups'])
        selected = {row['pid'] for row in rows if row['pgid'] in known_groups}
        previous = set()
        while selected != previous:
            previous = set(selected)
            selected.update(row['pid'] for row in rows if row['ppid'] in selected)
        members = [row for row in rows if row['pid'] in selected]
        discovered = sorted({row['pgid'] for row in members} - known_groups)
        for group in discovered:
            if any(row['pgid'] == group and row['pid'] not in selected for row in rows):
                raise RuntimeError('Refusing to claim a shared foreign browser process group')
            scratch.record['groups'].append(group)
        if discovered:
            r.atomic_json(scratch.manifest, scratch.record)
        aggregate = sum(row['rss_bytes'] for row in members)
        if discovered or time.monotonic()-last_sample[0] >= 1:
            last_sample[0] = time.monotonic()
            listeners = subprocess.run(['/usr/sbin/lsof','-nP','-a','-p',','.join(str(row['pid']) for row in members),'-iTCP','-sTCP:LISTEN','-Fpn'],capture_output=True,text=True,timeout=3) if members else None
            rss_samples.append({'time':time.time(), 'root_pgid':pgid, 'owned_groups':sorted(scratch.record['groups']),
                                'aggregate_rss':aggregate, 'members':members, 'listeners':listeners.stdout.splitlines() if listeners else []})
            r.atomic_json(RECORDS/(run+'-rss-checkpoints.json'), {'accounting':'recursive ancestry including detached Chrome groups', 'samples':rss_samples})
        return aggregate
    def stop_recursive_groups(process):
        scratch = next((item for item in owned_scratch_instances if process.pid in item.record['groups']), None)
        if scratch is None:
            raise RuntimeError('Missing owned scratch for process cleanup')
        original_stop_group(process)
        for group in reversed(scratch.record['groups']):
            if group == process.pid:
                continue
            for sig in (signal.SIGTERM, signal.SIGKILL):
                state = r.group_has_live_members(group)
                if state is False:
                    break
                if state is None:
                    raise RuntimeError('Cannot verify owned browser process group before cleanup')
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    break
                deadline = time.monotonic()+3
                while time.monotonic() < deadline and r.group_has_live_members(group) is not False:
                    time.sleep(.05)
            if r.group_has_live_members(group) is not False:
                raise RuntimeError('Owned browser process group remains after cleanup')
    r.group_rss = recursive_group_rss
    r.stop_group = stop_recursive_groups

if args.mode == 'command':
    if not args.command:
        parser.error('--command is required')
    scratch = r.Scratch(RECORDS, ROOT, policy, expected=32*r.MIB)
    host = r.HostBudget(policy)
    disk, ram = 128*r.MIB, limits['chunk_ram_mib']*r.MIB
    granted = host.acquire(scratch.token, disk, ram, str(ROOT), root=scratch.root,
                           minimum_disk=32*r.MIB, minimum_ram=256*r.MIB)
    disk, ram = granted['disk'], granted['ram']
    before = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
              for p in (ROOT/'package.json', ROOT/'package-lock.json', ROOT/'server/package.json', ROOT/'server/package-lock.json')}
    try:
        with r.handled_termination(), scratch:
            env = dict(backend_env)
            env['npm_config_cache'] = str(scratch.root/'npm-cache')
            result = r.run_process(['/bin/sh','-c',args.command], ROOT/('server' if args.cwd=='server' else ''),
                                   env, RECORDS/(run+'.log'), scratch, policy, disk, ram, 600, host)
    finally:
        host.release(scratch.token)
    result['supervisor_owner'] = {**r.owner(), 'pgid':os.getpgrp()}
    result['scratch_removed'] = not scratch.root.exists()
    result['groups_absent'] = all(r.group_has_live_members(p) is False for p in scratch.record['groups'])
    result['reservation_absent'] = scratch.token not in r.read_json(host.path,{})
    result['package_hashes_unchanged'] = all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in before.items())
    result['retained_dependencies'] = {str(p):r.allocated_bytes(p) for p in (ROOT/'node_modules',ROOT/'server/node_modules') if p.exists()}
    r.atomic_json(RECORDS/(run+'-receipt.json'), result)
    print(json.dumps(result,sort_keys=True))
    sys.exit(0 if result['rc']==0 and not result['issue'] and result['scratch_removed'] and result['groups_absent'] and result['reservation_absent'] else 1)

stamp = module('fucq83_stamp', ROOT/'_tools/test_stamp.py')
git_adapter = module('fucq83_git', ROOT/'_tools/scaffold_git.py')
def adapter_git(root, arguments):
    code, out, err = git_adapter.git(Path(root), arguments)
    if code: raise stamp.RunError(err or out)
    return out.rstrip()
stamp._git = adapter_git
stamp.ref_exists = lambda root, ref: git_adapter.git(Path(root), ['rev-parse','--verify','--quiet',ref+'^{commit}'])[0] == 0
stamp.resource_module = lambda: r
original_load = stamp.load_settings
def bounded_load(root, command_override=None):
    settings = original_load(root, command_override)
    settings.resources = dict(settings.resources, **limits)
    return settings
stamp.load_settings = bounded_load
cli = ['--root',str(ROOT),'--jobs','1']
if args.mode == 'targeted':
    cli += ['--targeted','gcsp-poc','--command',args.command,
            '--reason','FUCQ-83 dated policy publishing, configured PostgreSQL parity, immutable pins, transactions and affected consumers']
elif args.mode == 'full':
    cli += ['--full']
    if args.force:
        cli += ['--force']
else:
    cli += ['--status']
suite_lock = None
if args.mode == 'full':
    suite_lock_path = Path.home()/'.cache/agent-scaffolding/test-resources/full-suite.lock'
    suite_lock_path.parent.mkdir(parents=True,exist_ok=True)
    suite_lock = suite_lock_path.open('a')
    try: fcntl.flock(suite_lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit('Another full suite holds the host full-test lane')
status_before = None
status_after = None
if args.mode == 'full':
    print('Pre-full strict status in the exact same process/environment:')
    status_before = stamp.main(['--root',str(ROOT),'--jobs','1','--status'])
code = stamp.main(cli)
if args.mode == 'full' and code == 0:
    print('Post-full strict status in the exact same process/environment:')
    status_after = stamp.main(['--root',str(ROOT),'--jobs','1','--status'])
    code = status_after
records = []
for manifest in list((RECORDS/'ownership').glob('*.json')) + list((RECORDS/'strict'/'ownership').glob('*.json')):
    data = r.read_json(manifest,{})
    records.append({'manifest':str(manifest),'state':data.get('state'),
                    'root_absent':not Path(data['root']).exists(),
                    'groups_absent':all(r.group_has_live_members(p) is False for p in data.get('groups',[]))})
r.atomic_json(RECORDS/(run+'-receipt.json'),{'rc':code,'strict_status_before':status_before,'strict_status_after':status_after,'supervisor_owner':{**r.owner(),'pgid':os.getpgrp()},'credential_aliases_absent':all(key not in os.environ for key in credential_aliases),'owned_manifests':records})
if suite_lock is not None: suite_lock.close()
sys.exit(code)
