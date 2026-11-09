#!/usr/bin/env python3
"""One bounded Chromium proof chunk; no database and no dependency installation."""
import json
import hashlib
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G
import test_resources as R

RUNS = ROOT / '.claude/test-runs/fucq126-browser-corrected-20261105'
FROZEN = os.environ.get('FUCQ126_FROZEN_REVISION', '')
POLICY = R.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 2560,
                   'chunk_seconds': 120, 'log_mib': 2,
                   'local_scratch_reason': 'Bounded Chromium profile and local IPC working set.'})


def git(*args):
    with G.checkout_mutex(ROOT):
        rc, out, err = G.git(ROOT, list(args))
    if rc:
        raise RuntimeError(err)
    return out.strip()


def source_identity():
    if not re.fullmatch(r'[0-9a-f]{40}', FROZEN):
        raise RuntimeError('Set FUCQ126_FROZEN_REVISION to the exact full reviewed and pushed commit before browser execution')
    head = git('rev-parse', 'HEAD')
    if head != FROZEN:
        raise RuntimeError('HEAD differs from explicit frozen runtime revision ' + FROZEN)
    changed = git('diff', '--name-only', FROZEN).splitlines()
    untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
    expected_links = {}
    for receipt in ('fucq126-ui-20261105', 'fucq126-backend-20261105'):
        record = R.read_json(ROOT / '.claude/test-runs' / receipt / 'dependencies.json')
        if not record:
            continue
        link = Path(record['link'])
        if link.is_symlink() and os.readlink(link) == record['target'] and link.lstat().st_ino == record.get('inode', record.get('symlinkInode')):
            expected_links[str(link.relative_to(ROOT))] = True
    bad = [p for p in changed + untracked if not p.startswith('docs/gcsp/evidence/fucq-126/') and p not in expected_links]
    if bad:
        raise RuntimeError('Unexpected worktree changes: ' + ', '.join(bad))
    return head


def snapshot():
    p = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,command='],
                       capture_output=True, text=True, timeout=4, check=True)
    rows = {}
    for line in p.stdout.splitlines():
        parts = line.strip().split(None, 4)
        if len(parts) == 5 and all(x.isdigit() for x in parts[:4]):
            pid, ppid, pgid, rss = map(int, parts[:4])
            rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rss': rss * 1024,
                         'command': parts[4]}
    return rows


class OwnedScratch(R.Scratch):
    safe_to_remove = True

    def __exit__(self, kind, value, tb):
        if not self.safe_to_remove:
            self.record['state'] = 'preserved-cleanup-uncertain'
            R.atomic_json(self.manifest, self.record)
            return
        super().__exit__(kind, value, tb)


def main():
    chunk = sys.argv[1] if len(sys.argv) == 2 else ''
    if chunk not in ('smoke-desktop', 'desktop', 'narrow', 'visual-desktop', 'visual-narrow'):
        raise SystemExit('Expected smoke-desktop, desktop, narrow, visual-desktop or visual-narrow')
    head = source_identity()
    receipt = RUNS / (chunk + '-receipt.json')
    output = HERE / 'browser-after-repair' / chunk
    # External manifest precedes the retained evidence directory allocation.
    R.atomic_json(RUNS / (chunk + '-output-owner.json'),
                  {'owner': R.owner(), 'root': str(output), 'limit': 128 * R.MIB, 'source': head})
    output.mkdir(parents=True, exist_ok=True)
    host = R.HostBudget(POLICY)
    ledger = RUNS / (chunk + '-processes.json')
    log = RUNS / (chunk + '.log')
    report = {'chunk': chunk, 'source': head, 'frozenRuntimeRevision': FROZEN,
              'harnessSha256': {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in
                  ('browser-supervisor.py', 'browser-runner.mjs', 'browser-visual.html', 'browser-visual.mjs', 'browser-visual.css')},
              'limits': {'seconds': 120, 'scratch': 128 * R.MIB,
              'requestedRam': 2560 * R.MIB, 'minimumRam': 2048 * R.MIB, 'log': 2 * R.MIB},
              'state': 'incomplete', 'selected': chunk, 'runtime': 'actual HTTP memory composition',
              'cookieOverride': 'identity.session.sameSite=Lax; secureCookies=false; localhost only'}
    R.atomic_json(receipt, report)
    with R.handled_termination(), OwnedScratch(RUNS, ROOT, POLICY, expected=128 * R.MIB,
                                               checkpoint=receipt) as scratch:
        try:
            reserved = host.acquire(scratch.token, 128 * R.MIB, 2560 * R.MIB, ROOT,
                                    root=scratch.root, minimum_disk=128 * R.MIB, minimum_ram=2048 * R.MIB)
        except R.CapacityError as error:
            report.update(state='admission-blocked', issue=str(error), headroom=error.headroom,
                          scratch=str(scratch.root), manifest=str(scratch.manifest))
            R.atomic_json(receipt, report)
            raise
        scratch.safe_to_remove = False
        report['reservation'] = reserved
        report['scratch'] = str(scratch.root)
        R.atomic_json(receipt, report)
        stop = threading.Event()
        cancel = threading.Event()
        tracked = {}
        telemetry = {'peakOwnedRss': 0, 'errors': []}

        def observe():
            rows = snapshot()
            seeds = set(scratch.record['groups'])
            node_record = R.read_json(ledger, {}) or {}
            seeds.update(node_record.get('pids', []))
            seeds.update(pid for pid, row in rows.items() if str(scratch.root) in row['command'])
            seeds.update(pid for pid, identity in tracked.items()
                         if pid in rows and R.process_identity(pid) == identity['start'])
            while True:
                descendants = {pid for pid, row in rows.items() if row['ppid'] in seeds}
                if descendants <= seeds:
                    break
                seeds.update(descendants)
            rss = 0
            for pid in seeds:
                if pid not in rows:
                    continue
                row = rows[pid]
                start = R.process_identity(pid)
                if start:
                    tracked[pid] = {k: row[k] for k in ('pid', 'ppid', 'pgid')}
                    tracked[pid]['start'] = start
                    rss += row['rss']
            telemetry['peakOwnedRss'] = max(telemetry['peakOwnedRss'], rss)
            R.atomic_json(RUNS / (chunk + '-owned-identities.json'), list(tracked.values()))
            host.update(scratch.token, scratch.sample(), rss)
            if rss > reserved['ram'] or R.allocated_bytes(output) > 128 * R.MIB:
                telemetry['errors'].append('Owned RSS or retained output budget exceeded')
                cancel.set()

        def monitor():
            while not stop.wait(0.5):
                try:
                    observe()
                except Exception as error:
                    telemetry['errors'].append(type(error).__name__ + ': ' + str(error))
                    cancel.set()
                    break

        thread = threading.Thread(target=monitor, daemon=True)
        env = scratch.env(os.environ)
        removed = []
        for key in list(env):
            if re.search(r'(DATABASE.*URL|DB.*URL|POSTGRES.*URL|PG.*URL|SQL.*URL)$', key, re.I) or key.upper().startswith('PG') or key in ('DEMO_ACCESS_KEY', 'NODE_V8_COVERAGE'):
                removed.append(key)
                del env[key]
        env.update(FUCQ126_SCRATCH=str(scratch.root), FUCQ126_PROCESS_LEDGER=str(ledger),
                   FUCQ126_OUTPUT=str(output), FUCQ126_CHUNK=chunk)
        report['removedEnvironmentKeys'] = sorted(removed)
        try:
            thread.start()
            result = R.run_process(['node', str(HERE / 'browser-runner.mjs')], ROOT, env, log,
                                   scratch, POLICY, reserved['disk'], reserved['ram'], 120,
                                   host=host, cancel=cancel)
            report['execution'] = result
        finally:
            stop.set()
            thread.join(timeout=6)
            try:
                observe()
                # Reparented/detached descendants retain a recorded start identity.
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    for pid, identity in tracked.items():
                        if R.process_alive(identity) and R.process_identity(pid) == identity['start']:
                            try:
                                os.kill(pid, sig)
                            except ProcessLookupError:
                                pass
                    time.sleep(0.3)
                observe()
                live = [identity for identity in tracked.values() if R.process_alive(identity)]
                matching = [pid for pid, row in snapshot().items() if str(scratch.root) in row['command']]
                groups = {str(pgid): R.group_has_live_members(pgid) for pgid in scratch.record['groups']}
                opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(scratch.root)],
                                        capture_output=True, timeout=6)
                scratch.safe_to_remove = not live and not matching and all(v is False for v in groups.values()) and opened.returncode == 1 and not opened.stdout and not opened.stderr and not thread.is_alive()
                report['cleanup'] = {'liveIdentities': live, 'profilePathProcesses': matching,
                                     'groups': groups, 'openFilesAbsent': opened.returncode == 1 and not opened.stdout and not opened.stderr,
                                     'monitorJoined': not thread.is_alive(), 'safeToRemove': scratch.safe_to_remove}
            finally:
                host.release(scratch.token)
                report['telemetry'] = telemetry
                report['retainedBytes'] = R.allocated_bytes(output)
                R.atomic_json(receipt, report)
    report['cleanup']['scratchAbsent'] = not os.path.lexists(report['scratch'])
    report['cleanup']['reservationReleased'] = scratch.token not in (R.read_json(host.path, {}) or {})
    report['sourceAfter'] = source_identity()
    business = R.read_json(output / 'results.json', {}) or {}
    report['cleanup']['portsClosed'] = {}
    for key in ('port', 'chromeDebugPort'):
        if business.get(key):
            with socket.socket() as probe:
                probe.settimeout(0.5)
                report['cleanup']['portsClosed'][key] = probe.connect_ex(('127.0.0.1', business[key])) != 0
    report['state'] = 'passed' if report.get('execution', {}).get('rc') == 0 and not report['execution']['issue'] and not telemetry['errors'] and report['cleanup']['scratchAbsent'] and all(report['cleanup']['portsClosed'].values()) and business.get('state') == 'passed' else 'incomplete'
    if report['state'] == 'passed' and log.exists():
        log.unlink()
        report['successfulLogRemoved'] = True
    R.atomic_json(receipt, report)
    print(json.dumps({'state': report['state'], 'receipt': str(receipt), 'result': str(output / 'results.json'),
                      'peakOwnedRss': telemetry['peakOwnedRss'], 'scratchAbsent': report['cleanup']['scratchAbsent']}))
    return 0 if report['state'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
