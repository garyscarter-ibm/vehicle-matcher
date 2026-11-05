#!/usr/bin/env python3
"""Prepare/run one expressly granted FUCQ-122 browser chunk; never infer a lane grant."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G
import test_resources as R

RUNS = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122-options/browser')
FROZEN = '0a3a3a1'
CHUNKS = ('smoke-desktop',) + tuple(f'{group}-{width}' for group in ('journey', 'options-deadline', 'resilience', 'previews') for width in ('desktop', 'narrow'))
POLICY = R.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 2560, 'chunk_seconds': 120, 'log_mib': 2,
                   'local_scratch_reason': 'Bounded owned Chromium profile/cache/IPC; retained evidence stays below 128 MiB.'})
LINK = ROOT / 'server/node_modules'
LINK_TARGET = '/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules'
LINK_INODE = 172924312  # Exact pre-existing adopted link; parent retains final teardown.


def source_identity():
    with G.checkout_mutex(str(ROOT)):
        def git(*args):
            rc, out, err = G.git(ROOT, list(args))
            if rc:
                raise RuntimeError(err)
            return out.strip()
        head = git('rev-parse', 'HEAD')
        changes = git('diff', '--name-only', FROZEN).splitlines()
        untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
        allowed_link = LINK.is_symlink() and os.readlink(LINK) == LINK_TARGET and LINK.lstat().st_ino == LINK_INODE
        bad = [p for p in changes + untracked if not p.startswith('docs/gcsp/evidence/fucq122/')
               and not (p == 'server/node_modules' and allowed_link)]
        if bad:
            raise RuntimeError('Frozen product/source guard: ' + ', '.join(bad))
        paths = git('ls-files', 'blocks/gcsp/cases', 'blocks/gcsp/account', 'blocks/gcsp/employee', 'blocks/gcsp/shell',
                    'blocks/gcsp/kit', 'blocks/vehicle-matcher', 'server/gcsp', 'server/index.js', 'gcsp-help.html', 'gcsp-case-queue.html').splitlines()
        paths.extend('docs/gcsp/evidence/fucq122/' + name for name in ('browser-supervisor.py', 'browser-runner.mjs', 'browser-plan.md'))
    return {'head': head, 'frozenProductRevision': FROZEN,
            'sha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths if (ROOT / p).is_file()}}


def snapshot():
    result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,command='], capture_output=True, text=True, timeout=4, check=True)
    rows = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 4)
        if len(fields) == 5 and all(v.isdigit() for v in fields[:4]):
            pid, ppid, pgid, rss = map(int, fields[:4])
            rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rss': rss * 1024, 'command': fields[4]}
    return rows


def ports_closed(ports):
    result = {}
    for port in sorted(set(ports)):
        with socket.socket() as probe:
            probe.settimeout(0.3)
            result[str(port)] = probe.connect_ex(('127.0.0.1', port)) != 0
    return result


class OwnedScratch(R.Scratch):
    safe_to_remove = True
    def __exit__(self, kind, value, tb):
        if not self.safe_to_remove:
            self.record['state'] = 'preserved-cleanup-uncertain'
            R.atomic_json(self.manifest, self.record)
            return
        super().__exit__(kind, value, tb)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in CHUNKS:
        raise SystemExit('Expected one explicitly granted chunk: ' + ', '.join(CHUNKS))
    chunk = sys.argv[1]
    identity = source_identity()
    run_id = chunk + '-' + uuid.uuid4().hex[:12]
    run = RUNS / run_id
    receipt = run / 'receipt.json'
    ledger = run / 'processes.json'
    log = run / 'browser.log'
    output = HERE / 'browser' / run_id
    scratch = OwnedScratch(run, ROOT, POLICY, expected=128 * R.MIB, checkpoint=receipt)
    scratch.root = Path('/tmp/fucq122-browser-' + run_id)
    scratch.record['root'] = str(scratch.root)
    host = R.HostBudget(POLICY)
    report = {'state': 'planned', 'runId': run_id, 'chunk': chunk, 'sourceBefore': identity,
              'limits': {'seconds': 120, 'recursiveOwnedRss': 2560 * R.MIB, 'minimumRam': 2048 * R.MIB,
                         'scratch': 128 * R.MIB, 'retainedOutput': 128 * R.MIB, 'combinedAllocation': 128 * R.MIB, 'log': 2 * R.MIB, 'browsers': 1},
              'harnessSha256': {p: hashlib.sha256((HERE / p).read_bytes()).hexdigest() for p in ('browser-runner.mjs', 'browser-supervisor.py', 'browser-plan.md')},
              'output': str(output), 'scratch': str(scratch.root), 'manifest': str(scratch.manifest),
              'cookieOverride': 'localhost only: identity.session.sameSite=Lax, secureCookies=false',
              'boundary': 'Actual isolated HTTP composition; no delivered runtime/Greg host or offer/lifecycle producer claim.',
              'dependencyAdoption': {'serverLink': str(LINK), 'serverLinkTarget': LINK_TARGET, 'serverLinkInode': LINK_INODE,
                    'playwright': '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs',
                    'chrome': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},
              'cleanup': {}, 'telemetry': {'peakOwnedRss': 0, 'peakCombinedBytes': 0, 'errors': []}}
    # External manifests exist before either scratch or retained-output allocation.
    R.atomic_json(scratch.manifest, scratch.record)
    R.atomic_json(run / 'output-owner.json', {'owner': R.owner(), 'root': str(output), 'runId': run_id,
                  'limit': 128 * R.MIB, 'source': identity['head'], 'state': 'planned'})
    R.atomic_json(receipt, report)
    tracked = {}
    ports = set()
    stop, cancel = threading.Event(), threading.Event()
    thread = None
    entered = False
    telemetry = report['telemetry']

    def observe():
        rows = snapshot()
        node = R.read_json(ledger, {}) or {}
        ports.update(p for p in node.get('ports', []) if isinstance(p, int) and 0 < p < 65536)
        seeds = set(scratch.record['groups'])
        # Ledger identities must still match. Marker discovery also finds detached Chrome processes.
        seeds.update(p['pid'] for p in node.get('identities', []) if p.get('pid') in rows and R.process_identity(p['pid']) == p.get('start'))
        seeds.update(pid for pid, row in rows.items() if str(scratch.root) in row['command'])
        seeds.update(pid for pid, entry in tracked.items() if pid in rows and R.process_identity(pid) == entry['start'])
        while True:
            descendants = {pid for pid, row in rows.items() if row['ppid'] in seeds}
            if descendants <= seeds:
                break
            seeds.update(descendants)
        rss = 0
        for pid in seeds:
            if pid in rows:
                start = R.process_identity(pid)
                if start:
                    tracked[pid] = {k: rows[pid][k] for k in ('pid', 'ppid', 'pgid')}
                    tracked[pid]['start'] = start
                    rss += rows[pid]['rss']
        telemetry['peakOwnedRss'] = max(telemetry['peakOwnedRss'], rss)
        combined = scratch.sample() + R.allocated_bytes(output)
        telemetry['peakCombinedBytes'] = max(telemetry['peakCombinedBytes'], combined)
        R.atomic_json(run / 'owned-identities.json', {'identities': list(tracked.values()), 'ports': sorted(ports)})
        host.update(scratch.token, combined, rss)
        if rss > report['reservation']['ram'] or combined > 128 * R.MIB:
            telemetry['errors'].append('Recursive owned RSS or combined scratch/output budget exceeded')
            cancel.set()

    def monitor():
        while not stop.wait(0.4):
            try:
                observe()
            except Exception as error:
                telemetry['errors'].append(type(error).__name__ + ': ' + str(error))
                cancel.set()
                break

    try:
        with R.handled_termination():
            report['reservation'] = host.acquire(scratch.token, 128 * R.MIB, 2560 * R.MIB, '/tmp', root=scratch.root,
                                                minimum_disk=128 * R.MIB, minimum_ram=2048 * R.MIB)
            scratch.__enter__(); entered = True; scratch.safe_to_remove = False
            output.mkdir(parents=True, exist_ok=False)
            output_stat = output.stat()
            R.atomic_json(run / 'output-owner.json', {'owner': R.owner(), 'root': str(output), 'runId': run_id,
                          'limit': 128 * R.MIB, 'source': identity['head'], 'state': 'active',
                          'device': output_stat.st_dev, 'inode': output_stat.st_ino})
            report['state'] = 'running'; R.atomic_json(receipt, report)
            env = dict(os.environ)
            removed = []
            for key in list(env):
                if re.search(r'(DATABASE|DB|POSTGRES|SQL)', key, re.I) or key.upper().startswith('PG') or key in ('DEMO_ACCESS_KEY', 'NODE_V8_COVERAGE'):
                    removed.append(key); del env[key]
            env.update(FUCQ122_SCRATCH=str(scratch.root), FUCQ122_PROCESS_LEDGER=str(ledger),
                       FUCQ122_OUTPUT=str(output), FUCQ122_CHUNK=chunk, FUCQ122_SOURCE=identity['head'])
            report['removedEnvironmentKeys'] = sorted(removed)
            thread = threading.Thread(target=monitor, daemon=True); thread.start()
            report['execution'] = R.run_process(['node', str(HERE / 'browser-runner.mjs')], ROOT, env, log, scratch,
                                                POLICY, 128 * R.MIB, report['reservation']['ram'], 120, host=host, cancel=cancel)
    except R.CapacityError as error:
        report.update(state='admission-blocked', issue=str(error), headroom=error.headroom)
    except BaseException as error:
        report.update(state='incomplete', issue=type(error).__name__ + ': ' + str(error))
    finally:
        stop.set()
        if thread:
            thread.join(timeout=6)
        try:
            if entered:
                observe()
                # The child process group is joined by run_process; detached descendants need identities too.
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    for pid, entry in tracked.items():
                        if R.process_alive(entry) and R.process_identity(pid) == entry['start']:
                            try:
                                os.kill(pid, sig)
                            except ProcessLookupError:
                                pass
                    time.sleep(0.3)
                observe()
                live = [entry for entry in tracked.values() if R.process_alive(entry)]
                matching = [pid for pid, row in snapshot().items() if str(scratch.root) in row['command']]
                groups = {str(group): R.group_has_live_members(group) for group in scratch.record['groups']}
                opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)], capture_output=True, timeout=6)
                clean_files = opened.returncode == 1 and not opened.stdout and not opened.stderr
                closed = ports_closed(ports)
                scratch.safe_to_remove = not live and not matching and all(v is False for v in groups.values()) and clean_files and not (thread and thread.is_alive()) and all(closed.values())
                report['cleanup'].update(liveIdentities=live, profileProcesses=matching, groups=groups, openFilesAbsent=clean_files,
                                         monitorJoined=not (thread and thread.is_alive()), portsClosed=closed, safeToRemove=scratch.safe_to_remove)
        except BaseException as error:
            scratch.safe_to_remove = False
            report['cleanup']['issue'] = type(error).__name__ + ': ' + str(error)
        finally:
            try:
                if entered:
                    scratch.__exit__(None, None, None)
                else:
                    scratch.record['state'] = 'not-allocated'; R.atomic_json(scratch.manifest, scratch.record)
            except BaseException as error:
                report['cleanup']['scratchIssue'] = type(error).__name__ + ': ' + str(error)
            finally:
                host.release(scratch.token)
        report['cleanup']['scratchAbsent'] = not os.path.lexists(scratch.root)
        report['cleanup']['reservationAbsent'] = scratch.token not in (R.read_json(host.path, {}) or {})
        report['retainedBytes'] = R.allocated_bytes(output)
        output_owner = R.read_json(run / 'output-owner.json', {}) or {}
        output_owner.update(state='retained', retainedBytes=report['retainedBytes'])
        R.atomic_json(run / 'output-owner.json', output_owner)
        try:
            report['sourceAfter'] = source_identity()
            report['sourceUnchanged'] = report['sourceAfter'] == identity
        except Exception as error:
            report['sourceUnchanged'] = False
            report['sourceIssue'] = str(error)
        business = R.read_json(output / 'results.json', {}) or {}
        cleanup = report['cleanup']
        passed = report.get('execution', {}).get('rc') == 0 and not report['execution'].get('issue') and not telemetry['errors'] and business.get('state') == 'passed' and report['sourceUnchanged'] and cleanup.get('safeToRemove') and cleanup['scratchAbsent'] and cleanup['reservationAbsent']
        if passed:
            report['state'] = 'passed'
            if log.exists():
                log.unlink(); report['successfulLogRemoved'] = True
        elif report['state'] != 'admission-blocked':
            report['state'] = 'incomplete'
        R.atomic_json(receipt, report)
        print(json.dumps({'state': report['state'], 'receipt': str(receipt), 'output': str(output), 'cleanup': cleanup}))
    return 0 if report['state'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
