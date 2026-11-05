from pathlib import Path
import fcntl, hashlib, importlib.util, json, os, shlex, shutil, signal, subprocess, sys, time, uuid

project = Path(__file__).resolve().parents[4]
rdir = Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs')
sys.path.insert(0, str(project / '_tools'))
import scaffold_git as git_adapter
spec = importlib.util.spec_from_file_location('policy_stamp', project / '_tools/test_stamp.py')
stamp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stamp)
resources = stamp.resource_module()
mode = sys.argv[1]
saved_environment = dict(os.environ)
saved_environment['SCAFFOLDING_HARNESS'] = 'codex'
if mode in ('full', 'status'):
    if 'GCSP_DATABASE_URL' in os.environ:
        raise SystemExit('Offline final plan requires the documented unset native target; reassess configured validation first.')
    saved_environment = json.loads((Path(__file__).parent / 'final-plan.json').read_text())['environment']
active_scratch = None
run = 'fucq83-' + mode + '-' + uuid.uuid4().hex
evidence = {'run': run, 'project': str(project), 'mode': mode, 'argv': [], 'samples': 0, 'maxTestWorkers': 0,
            'plannedScratchMiB': 128, 'plannedRssMiB': 512, 'timeoutSeconds': 180 if mode.startswith('install-') else 120,
            'finalizer': str(Path(__file__).resolve()), 'nativeConfigured': 'GCSP_DATABASE_URL' in os.environ}

def git(root, args):
    rc, out, err = git_adapter.git(Path(root), args)
    if rc:
        raise stamp.RunError(err or out)
    return out.rstrip()

stamp._git = git
stamp.ref_exists = lambda root, ref: git_adapter.git(Path(root), ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])[0] == 0
stamp._prune_logs = lambda path: None
OriginalScratch = resources.Scratch

class OwnedScratch(OriginalScratch):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.manifest = rdir / 'ownership' / (run + '-' + self.token + '.json')
        self.record.update(supervisorFinalizer=__file__, plan=evidence, retainedDependencies=[])

    def __enter__(self):
        global active_scratch
        active_scratch = self
        return super().__enter__()

    def env(self, env):
        result = super().env(env)
        result.update(XDG_CACHE_HOME=str(self.root / 'cache'), npm_config_cache=str(self.root / 'npm-cache'),
                      PYTHONDONTWRITEBYTECODE='1', SCAFFOLDING_HARNESS='codex')
        return result

    def __exit__(self, kind, value, tb):
        global active_scratch
        # run_process joins the primary group; this also handles any observed escaped descendant group.
        for group in self.record['groups']:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if resources.group_has_live_members(group) is False:
                    break
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    break
                deadline = time.monotonic() + 3
                while resources.group_has_live_members(group) is not False and time.monotonic() < deadline:
                    time.sleep(0.05)
        allocated = resources.allocated_bytes(self.root)
        super().__exit__(kind, value, tb)
        self.record.update(scratchAbsent=not os.path.lexists(self.root), removedBytes=allocated,
                           groupsAbsent=all(resources.group_has_live_members(group) is False for group in self.record['groups']))
        resources.atomic_json(self.manifest, self.record)
        evidence.setdefault('manifests', []).append(str(self.manifest))
        active_scratch = None
        if not self.record['groupsAbsent']:
            raise resources.ResourceError('Owned process-group cleanup uncertain')

resources.Scratch = OwnedScratch
def observed_rss(pgid):
    result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,stat=,rss=,args='], capture_output=True, text=True, timeout=3)
    if result.returncode:
        raise resources.ResourceError('Cannot verify process argv/fanout')
    processes = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 5)
        if len(parts) != 6:
            continue
        processes.append(parts)
    owned = {int(row[0]) for row in processes if row[2] == str(pgid)} | {pgid}
    while True:
        expanded = owned | {int(row[0]) for row in processes if int(row[1]) in owned}
        if expanded == owned:
            break
        owned = expanded
    workers = 0
    rss = 0
    for pid, ppid, group, state, memory, command in processes:
        if int(pid) not in owned:
            continue
        rss += int(memory) * 1024
        if int(group) != pgid:
            if int(group) == os.getpgrp() or active_scratch is None:
                raise resources.ResourceError('Descendant escaped into an unowned process group')
            if int(group) not in active_scratch.record['groups']:
                active_scratch.record['groups'].append(int(group))
                resources.atomic_json(active_scratch.manifest, active_scratch.record)
        args = shlex.split(command)
        node = bool(args) and Path(args[0]).name == 'node'
        worker = node and '--test-isolation=process' in args and not state.startswith('Z')
        workers += int(worker)
        if node and '--test' in args and '--test-concurrency=1' not in args:
            raise resources.ResourceError('Node test concurrency was not bounded')
        entry = {'pid': int(pid), 'ppid': int(ppid), 'pgid': int(group), 'argv': args, 'testWorker': worker}
        if not any(item['pid'] == entry['pid'] for item in evidence['argv']) and len(evidence['argv']) < 256:
            evidence['argv'].append(entry)
    evidence['samples'] += 1
    evidence['maxTestWorkers'] = max(evidence['maxTestWorkers'], workers)
    if workers > 1:
        raise resources.ResourceError('Unexpected Node worker fanout')
    return rss

resources.group_rss = observed_rss
stamp.resource_module = lambda: resources
load_settings = stamp.load_settings

def settings(*args, **kwargs):
    value = load_settings(*args, **kwargs)
    value.resources = {**value.resources, 'chunk_ram_mib': 512, 'unit_ram_mib': 512,
                       'chunk_scratch_mib': 128, 'unit_scratch_mib': 128, 'chunk_seconds': 120, 'log_mib': 1}
    return value

stamp.load_settings = settings
os.environ.clear()
os.environ.update(saved_environment)
evidence['environmentSha256'] = resources.digest(saved_environment)
evidence['supervisorSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
try:
    if mode.startswith('install-'):
        if mode not in ('install-root', 'install-server'):
            raise SystemExit('Unknown install scope')
        cwd = project if mode == 'install-root' else project / 'server'
        lock = cwd / 'package-lock.json'
        evidence['lockSha256'] = hashlib.sha256(lock.read_bytes()).hexdigest()
        evidence['node'] = subprocess.check_output(['node', '--version'], text=True, timeout=10).strip()
        evidence['npm'] = subprocess.check_output(['npm', '--version'], text=True, timeout=10).strip()
        policy = resources.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 512, 'log_mib': 1})
        host = resources.HostBudget(policy)
        scratch = OwnedScratch(rdir, project, policy, expected=128 * resources.MIB)
        # Register the supervisor's finalizer and outside manifest before creating owned scratch.
        resources.atomic_json(scratch.manifest, scratch.record)
        acquired = False
        try:
            host.acquire(scratch.token, 128 * resources.MIB, 512 * resources.MIB, project, root=scratch.root)
            acquired = True
            with resources.handled_termination(), scratch:
                log = scratch.root / 'npm-ci.log'
                outcome = resources.run_process(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd, os.environ,
                    log, scratch, policy, 128 * resources.MIB, 512 * resources.MIB, 180, host)
                evidence['result'] = outcome
                if outcome['rc'] or outcome['issue']:
                    evidence['failureTail'] = log.read_text()[-8000:]
                else:
                    evidence['summary'] = log.read_text()[-1000:]
                evidence['dependencies'] = {'path': str(cwd / 'node_modules'), 'allocatedBytes': resources.allocated_bytes(cwd / 'node_modules')}
                evidence['lockUnchanged'] = hashlib.sha256(lock.read_bytes()).hexdigest() == evidence['lockSha256']
            raise SystemExit(1 if outcome['rc'] or outcome['issue'] or not evidence['lockUnchanged'] else 0)
        finally:
            if acquired:
                host.release(scratch.token)
    elif mode in ('full', 'status'):
        command = 'node --test --test-concurrency=1 server/test/**/*.test.js'
        evidence['command'] = command
        evidence['selectedReason'] = 'Explicit FUCQ-83 final npm test requirement after approved FUCQ-56 integration.'
        evidence['pins'] = {str(path.relative_to(project)): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in [project / 'package-lock.json', project / 'server/package-lock.json', project / '.claude/scaffolding.json']}
        evidence['planSha256'] = resources.digest({key: evidence[key] for key in
            ('command', 'selectedReason', 'pins', 'plannedScratchMiB', 'plannedRssMiB', 'timeoutSeconds', 'supervisorSha256')})
        args = ['--root', str(project), '--command', command]
        if mode == 'status':
            raise SystemExit(stamp.main([*args, '--status']))
        lock_path = Path('/Users/usget/.cache/agent-scaffolding/test-resources/full-suite.lock')
        evidence['fullLock'] = str(lock_path)
        with lock_path.open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise resources.ResourceError('Another full suite holds the machine full-test lock')
            evidence['statusBefore'] = stamp.main([*args, '--status'])
            result = stamp.main([*args, '--full'])
            evidence['statusAfter'] = stamp.main([*args, '--status'])
            evidence['environmentUnchanged'] = dict(os.environ) == saved_environment
            raise SystemExit(result if result else evidence['statusAfter'] if evidence['environmentUnchanged'] else 2)
    else:
        commands = {
            'policy': 'node --test --test-concurrency=1 server/test/gcsp-policy-versions.test.js server/test/gcsp-policy-service.test.js',
            'repository': 'node --test --test-concurrency=1 server/test/gcsp-repository-contract.test.js',
            'identity-clock': 'node --test --test-concurrency=1 server/test/gcsp-identity.test.js server/test/gcsp-clock-reset.test.js',
            'consumers': 'node --test --test-concurrency=1 server/test/employee-recommendation.test.js server/test/gcsp-comparison-generator.test.js',
        }
        if mode not in commands:
            raise SystemExit('Unknown scoped command')
        evidence['command'] = commands[mode]
        args = ['--root', str(project), '--targeted', 'gcsp-poc', '--command', commands[mode], '--reason',
                'FUCQ-83 explicit scoped policy publication/provider and reviewed boundary coverage; native target separately gated.']
        raise SystemExit(stamp.main(args))
finally:
    evidence['finishedAt'] = time.time()
    resources.atomic_json(rdir / 'ownership' / (run + '-summary.json'), evidence)
    print(json.dumps({'run': run, 'summary': str(rdir / 'ownership' / (run + '-summary.json'))}))
