#!/usr/bin/env python3
"""One dispatcher-granted, bounded read-only gallery browser chunk."""
import argparse
import hashlib
import json
import os
import plistlib
import shutil
from pathlib import Path
import signal
import subprocess
import sys
import time
import threading
import uuid

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / '_tools'))
import test_resources as r
import scaffold_git as g

parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, choices=[1280, 320], required=True)
parser.add_argument('--dispatcher-grant', required=True)
args = parser.parse_args()
run_id = '%s-%s' % (args.width, uuid.uuid4().hex[:12])
records = ROOT.parents[1] / 'test-runs/fucq69-browser' / run_id
records.mkdir(parents=True)
output = ROOT / 'docs/gcsp/evidence/fucq69/browser' / run_id
policy = r.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128, 'chunk_ram_mib': 2560,
                   'unit_scratch_mib': 32, 'unit_ram_mib': 2048, 'log_mib': 2})
host = r.HostBudget(policy)
class BrowserScratch(r.Scratch):
    def __exit__(self, kind, value, tb):
        # Never delete a live profile or release its budget merely because sampling failed.
        rows = processes()
        alive = any((row['pid'] in ledger and row['start'] == ledger[row['pid']]['start'])
                    or str(self.root/'profile') in row['args'] or str(self.root/'crashpad') in row['args']
                    for row in rows)
        if alive or any(r.group_has_live_members(group) is not False for group in self.record['groups']):
            self.record.update(state='cleanup-issue', cleanup_issue='Owned browser processes/groups live or uncertain')
            r.atomic_json(self.manifest, self.record)
            raise r.ResourceError('Browser cleanup uncertain; retained named scratch: %s' % self.root)
        opened = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(self.root)], capture_output=True, timeout=5)
        if opened.returncode != 1 or opened.stdout or opened.stderr:
            self.record.update(state='cleanup-issue', cleanup_issue='Browser scratch open-file status uncertain')
            r.atomic_json(self.manifest, self.record)
            raise r.ResourceError('Browser scratch open-file status uncertain: %s' % self.root)
        return super().__exit__(kind, value, tb)


scratch = BrowserScratch(records, ROOT, policy, expected=32*r.MIB)
command = ['node', str(ROOT/'docs/gcsp/evidence/fucq69/browser-runner.mjs'), '--width', str(args.width)]
source_paths = sorted({*(ROOT/'blocks/gcsp').rglob('*.js'), *(ROOT/'blocks/gcsp').rglob('*.css'),
                       *(ROOT/'blocks/vehicle-matcher').rglob('*.js'), *(ROOT/'blocks/vehicle-matcher').rglob('*.css'),
                       ROOT/'gcsp-manual-gallery.html', ROOT/'gcsp-employee.css',
                       *(ROOT/'blocks/vehicle-matcher/fonts').glob('*.woff*'),
                       *(ROOT/'blocks/gcsp/shell/fonts').glob('*.woff*'), ROOT/'assets/brand-hero/bmw.jpg',
                       ROOT/'docs/gcsp/evidence/fucq69/browser-runner.mjs', Path(__file__).resolve(),
                       ROOT/'_tools/test_resources.py', ROOT/'_tools/scaffold_git.py'})
source = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
rc, head, error = g.git(str(ROOT), ['rev-parse', 'HEAD'])
assert rc == 0, error
playwright_package = Path('/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/package.json')
chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
chrome_info = plistlib.loads((chrome.parents[1]/'Info.plist').read_bytes())
runtime = {'node': shutil.which('node'), 'python': sys.executable,
           'playwrightVersion': json.loads(playwright_package.read_text())['version'],
           'playwrightPackageSha256': hashlib.sha256(playwright_package.read_bytes()).hexdigest(),
           'chrome': str(chrome), 'chromeVersion': chrome_info['CFBundleShortVersionString'],
           'chromeDevice': chrome.stat().st_dev, 'chromeInode': chrome.stat().st_ino}
plan = {'runtime': runtime, 'story': 'FUCQ-69', 'width': args.width, 'grant': args.dispatcher_grant, 'command': command,
        'sourceHead': head.strip(), 'sourceHashes': source, 'headroom': host.headroom('/private/tmp'),
        'scope': 'Explicit read-only synthetic presentation fixtures; no claim/release integration',
        'compatibilityException': 'Active local browser profile/cache only; bounded retained PNG/JSON, scratch removed after verified process cleanup',
        'limits': {'seconds': 120, 'rssMiB': 2560, 'minimumRssMiB': 2048, 'combinedDiskMiB': 128, 'logMiB': 2},
        'scratch': str(scratch.root), 'retainedEvidence': str(output), 'manifest': str(scratch.manifest)}
r.atomic_json(records/'plan.json', plan)
ledger = {}
last_sample = [0]


def processes():
    probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,lstart=,args='],
                           capture_output=True, text=True, timeout=3, check=True)
    rows = []
    for line in probe.stdout.splitlines():
        values = line.split(None, 9)
        if len(values) == 10:
            rows.append({'pid': int(values[0]), 'ppid': int(values[1]), 'pgid': int(values[2]),
                         'rss': int(values[3])*1024, 'start': ' '.join(values[4:9]), 'args': values[9]})
    return rows


def sample(pgid):
    rows = processes()
    selected = {row['pid'] for row in rows if row['pgid'] == pgid
                or str(scratch.root/'profile') in row['args'] or str(scratch.root/'crashpad') in row['args']
                or row['pid'] in ledger and row['start'] == ledger[row['pid']]['start']}
    previous = set()
    while previous != selected:
        previous = set(selected)
        selected.update(row['pid'] for row in rows if row['ppid'] in selected)
    owned = [row for row in rows if row['pid'] in selected]
    for group in {row['pgid'] for row in owned}:
        if any(row['pgid'] == group and row['pid'] not in selected for row in rows):
            raise RuntimeError('Cannot establish exclusive ownership of browser process group')
        if group not in scratch.record['groups']:
            scratch.record['groups'].append(group)
    for row in owned:
        ledger[row['pid']] = {key: row[key] for key in ('pid', 'ppid', 'pgid', 'start')}
    if time.monotonic()-last_sample[0] >= 0.5:
        last_sample[0] = time.monotonic()
        r.atomic_json(records/'processes.json', {'identities': list(ledger.values()), 'groups': scratch.record['groups']})
        r.atomic_json(scratch.manifest, scratch.record)
    return sum(row['rss'] for row in owned)


original_stop = r.stop_group


def stop_owned(process):
    issues = []
    try:
        sample(process.pid)
    except BaseException as error:
        issues.append('Final process discovery failed: %s' % error)
    finally:
        # The known session must always be stopped and joined even if discovery fails.
        original_stop(process)
    for group in reversed(scratch.record['groups']):
        if group == process.pid:
            continue
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if r.group_has_live_members(group) is False:
                break
            current = [row for row in processes() if row['pgid'] == group]
            if any(row['pid'] not in ledger or ledger[row['pid']]['start'] != row['start'] for row in current):
                raise RuntimeError('Browser cleanup ownership changed; retained named cleanup issue')
            try:
                os.killpg(group, sig)
            except ProcessLookupError:
                break
            deadline = time.monotonic()+3
            while time.monotonic() < deadline and r.group_has_live_members(group) is not False:
                time.sleep(0.05)
        if r.group_has_live_members(group) is not False:
            raise RuntimeError('Owned browser group remains after cleanup')
    if issues:
        raise RuntimeError('; '.join(issues))


original_sample = scratch.sample


def combined_disk():
    used = original_sample() + (r.allocated_bytes(output) if output.exists() else 0)
    scratch.record['peak'] = max(scratch.record['peak'], used)
    r.atomic_json(scratch.manifest, scratch.record)
    return used


r.group_rss = sample
r.stop_group = stop_owned
scratch.sample = combined_disk
env = {k: v for k, v in os.environ.items() if 'DATABASE_URL' not in k.upper() and 'DB_URL' not in k.upper()
       and not k.upper().startswith(('PG', 'POSTGRES'))}
env.update(FUCQ69_BROWSER_RUN=run_id, FUCQ69_SOURCE=head.strip())
cancel = threading.Event()

def cancellation_requested(_signum, _frame):
    cancel.set()

for termination_signal in (signal.SIGINT, signal.SIGTERM):
    signal.signal(termination_signal, cancellation_requested)
result = None
try:
    granted = host.acquire(scratch.token, 128*r.MIB, 2560*r.MIB, '/private/tmp', root=scratch.root,
                           minimum_disk=32*r.MIB, minimum_ram=2048*r.MIB)
    if cancel.is_set():
        raise r.ResourceError('Browser chunk cancelled before allocation')
    with scratch:
        result = r.run_process(command, str(ROOT), env, records/'run.log', scratch, policy,
                               granted['disk'], granted['ram'], 120, host, cancel)
except BaseException as error:
    result = {'rc': 1, 'issue': '%s: %s' % (type(error).__name__, error)}
finally:
    result = result or {'rc': 1, 'issue': 'No completed result'}
    try:
        remaining = processes()
        process_snapshot_complete = True
    except BaseException as error:
        remaining, process_snapshot_complete = [], False
        result['cleanupIssue'] = 'Final process status uncertain: %s' % error
    groups_absent = all(r.group_has_live_members(group) is False for group in scratch.record['groups'])
    matches_absent = process_snapshot_complete and not any(
        (row['pid'] in ledger and row['start'] == ledger[row['pid']]['start'])
        or str(scratch.root/'profile') in row['args'] or str(scratch.root/'crashpad') in row['args']
        for row in remaining)
    if groups_absent and matches_absent:
        try:
            host.release(scratch.token)
        except BaseException as error:
            result['cleanupIssue'] = 'Reservation release failed: %s' % error
    else:
        result['cleanupIssue'] = 'Retained named browser reservation/scratch pending verified cleanup'
    result.update(sourceUnchanged=all(p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest() == source[str(p.relative_to(ROOT))] for p in source_paths),
                  scratchRemoved=not os.path.lexists(scratch.root),
                  cancellationRequested=cancel.is_set(),
                  matchingProcessesAbsent=matches_absent,
                  groupsAbsent=groups_absent,
                  reservationAbsent=scratch.token not in r.read_json(host.path, {}),
                  retainedEvidence=str(output), manifest=str(scratch.manifest))
    try:
        artifact = output/'results.json'
        if artifact.exists():
            browser_result = json.loads(artifact.read_text())
            result['browserState'] = browser_result.get('state')
            result['servedSourcesUnchanged'] = browser_result.get('servedSourcesUnchanged') is True
            result['port'] = browser_result['resources']['httpPort']
            check = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:%s' % result['port'], '-sTCP:LISTEN'],
                                   capture_output=True, text=True, timeout=5)
            result['portAbsent'] = check.returncode == 1 and not check.stdout.strip() and not check.stderr.strip()
    except BaseException as error:
        result['cleanupIssue'] = 'Browser artifact/port verification failed: %s' % error
    r.atomic_json(records/'receipt.json', result)
    print(json.dumps({k: v for k, v in result.items() if k not in ('sourceHashes',)}, sort_keys=True))
sys.exit(0 if result['rc'] == 0 and not result.get('cancellationRequested') and not result.get('issue') and not result.get('cleanupIssue') and result.get('browserState') == 'passed'
         and all(result.get(key) for key in ['sourceUnchanged', 'scratchRemoved', 'matchingProcessesAbsent', 'groupsAbsent', 'reservationAbsent', 'portAbsent', 'servedSourcesUnchanged']) else 1)
