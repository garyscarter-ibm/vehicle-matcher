from pathlib import Path
import sys, os, json, time, subprocess, hashlib

project = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(project / '_tools'))
import test_resources as r
from scaffold_git import git
plan = json.loads((project / 'docs/gcsp/evidence/fucq57/full-plan.json').read_text())
receipt_path = Path(sys.argv[1]) if len(sys.argv) > 1 else project / 'docs/gcsp/evidence/fucq57/final-status.json'
rdir = Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs')
policy = r.Policy({'chunk_seconds': 30, 'chunk_scratch_mib': 8, 'chunk_ram_mib': 64, 'log_mib': 1})
scratch = r.Scratch(rdir, project, policy, expected=8 * r.MIB)
scratch.manifest = rdir / 'ownership' / ('fucq57-final-status-' + scratch.token + '.json')
host = r.HostBudget(policy)
receipt = {'mode': 'metadata-only; no tests', 'environment': plan['environment'],
           'expectedCodeKey': plan['codeKey'], 'expectedStampKey': plan['stampKey'],
           'root': str(scratch.root), 'manifest': str(scratch.manifest),
           'supervisor': str(Path(__file__).resolve()),
           'outer': {'pid': os.getpid(), 'pgid': os.getpgrp(), 'start': r.process_identity(os.getpid())},
           'phases': [], 'state': 'planned'}
r.atomic_json(receipt_path, receipt)
reserved = False
rc = 1

def metadata(args):
    code, out, err = git(project, args)
    if code: raise RuntimeError(err or out)
    return out.strip()

def phase(name, flag):
    args = [sys.executable, '-B', str(project / 'docs/gcsp/evidence/fucq57/full-supervisor.py'), flag]
    if flag == '--status': args += ['--command', plan['command']]
    item = {'name': name, 'argv': args, 'started': time.time()}
    with (scratch.root / (name + '.log')).open('w') as output:
        child = subprocess.Popen(args, cwd=project, env=plan['environment'], stdout=output,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        scratch.child(child)
        item.update(pid=child.pid, pgid=os.getpgid(child.pid), start=r.process_identity(child.pid))
        receipt['phases'].append(item)
        r.atomic_json(receipt_path, receipt)
        started = time.monotonic()
        try:
            while child.poll() is None:
                if time.monotonic() - started > 15: raise RuntimeError(name + ' timeout')
                if scratch.sample() > 8 * r.MIB: raise RuntimeError('metadata scratch budget')
                if r.group_rss(child.pid) > 64 * r.MIB: raise RuntimeError('metadata child RAM budget')
                time.sleep(.1)
        finally: r.stop_group(child)
    text = (scratch.root / (name + '.log')).read_text()
    if len(text.encode()) > 16384: raise RuntimeError('metadata output budget')
    item.update(rc=child.returncode, stdout=text, ended=time.time(), joined=True,
                processAbsent=r.process_identity(child.pid) != item['start'],
                groupAbsent=r.group_has_live_members(child.pid) is False)
    if item['rc'] or not item['processAbsent'] or not item['groupAbsent']:
        raise RuntimeError(name + ' did not pass and clean')
    return text

try:
    host.acquire(scratch.token, 8 * r.MIB, 64 * r.MIB, str(project), root=scratch.root)
    reserved = True
    with r.handled_termination(), scratch:
        receipt['head'] = metadata(['rev-parse', 'HEAD'])
        receipt['tree'] = metadata(['rev-parse', 'HEAD^{tree}'])
        receipt['remoteHead'] = metadata(['ls-remote', 'origin', 'refs/heads/dev/DEV-2026-11-04-030']).split()[0]
        if receipt['head'] != receipt['remoteHead']: raise RuntimeError('Result checkpoint is not pushed')
        status = phase('status-final', '--status')
        identity = json.loads(phase('identity-final', '--identity'))
        if identity['codeKey'] != plan['codeKey'] or identity['stampKey'] != plan['stampKey']:
            raise RuntimeError('Final code/stamp identity changed')
        if identity['executionIdentity'] != plan['executionIdentity']:
            raise RuntimeError('Final execution identity changed')
        receipt['identity'] = identity
        receipt['matchingStamp'] = status.strip()
        rc = 0
except BaseException as error:
    receipt['error'] = str(error)
finally:
    if reserved: host.release(scratch.token)
    receipt.update(state='passed' if rc == 0 else 'failed', rc=rc, ended=time.time(),
                   scratchAbsent=not os.path.lexists(scratch.root),
                   groupsAbsent=all(r.group_has_live_members(g) is False for g in scratch.record['groups']),
                   reservationAbsent=scratch.token not in r.read_json(host.path, {}),
                   removedBytes=scratch.record['peak'])
    r.atomic_json(receipt_path, receipt)
    print(json.dumps({k: receipt.get(k) for k in ['state', 'rc', 'head', 'matchingStamp', 'scratchAbsent', 'groupsAbsent', 'reservationAbsent', 'removedBytes', 'error']}, indent=2))
raise SystemExit(rc)
