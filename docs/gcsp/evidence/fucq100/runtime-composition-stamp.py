#!/usr/bin/env python3
"""Exact granted targeted stamp; no execution without the reviewed catalogue identity."""
import argparse
import atexit
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import signal
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-060')
RECORDS = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100')
SUPERVISOR = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-supervisor.py'
CATALOGUE = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-run-catalogue.json'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dispatcher-grant', required=True)
    parser.add_argument('--catalogue-sha256', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-zA-Z0-9_.-]+', args.dispatcher_grant) or not re.fullmatch('[a-f0-9]{64}', args.catalogue_sha256):
        raise RuntimeError('Invalid grant or catalogue identity')
    catalogue_bytes = CATALOGUE.read_bytes()
    if hashlib.sha256(catalogue_bytes).hexdigest() != args.catalogue_sha256:
        raise RuntimeError('Reviewed catalogue identity mismatch')
    reviewed = json.loads(catalogue_bytes)
    # Admit every custom helper, including transitive test_resources, before any helper import.
    for path, expected in reviewed['helpers'].items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Reviewed helper drift: ' + path)
    supervisor = module('runtime_composition_runner', SUPERVISOR)
    if supervisor.catalogue() != reviewed:
        raise RuntimeError('Reviewed source catalogue drift')
    c = module('composition_outer_resource_helpers', RECORDS / 'runtime-supervisor.py')
    supervisor.install_strict_pid_probe(c)
    r = c.resources
    supervisor.install_strict_budget(r)
    launch = module('composition_outer_launch', supervisor.LAUNCH)
    joined = launch.install(c)
    instances, samples = [], []
    class Owned(c.SafeScratch):
        def __init__(self, *values, **kwargs):
            super().__init__(*values, **kwargs)
            instances.append(self)
    r.Scratch = Owned
    original_stop = r.stop_group
    def sample(pgid):
        scratch = next((item for item in instances if pgid in item.record['groups']), None)
        if scratch is None:
            raise RuntimeError('Missing outer scratch owner')
        rows = c.process_snapshot()
        chosen = {row['pid'] for row in rows if row['pgid'] in scratch.record['groups']}
        while True:
            expanded = chosen | {row['pid'] for row in rows if row['ppid'] in chosen}
            if expanded == chosen:
                break
            chosen = expanded
        members = [row for row in rows if row['pid'] in chosen]
        for row in members:
            if not any(item['pid'] == row['pid'] for item in scratch.record.get('owned_pids', [])):
                start = r.process_identity(row['pid'])
                scratch.record.setdefault('owned_pids', []).append({'pid': row['pid'], 'start': start, 'pgid': row['pgid']})
        for group in {row['pgid'] for row in members}:
            if any(row['pgid'] == group and row['pid'] not in chosen for row in rows):
                raise RuntimeError('Shared outer descendant group refused')
            if group not in scratch.record['groups']:
                scratch.record['groups'].append(group)
        r.atomic_json(scratch.manifest, scratch.record)
        samples.append({'at': time.time(), 'members': len(members), 'rss': sum(row['rss'] for row in members)})
        return sum(row['rss'] for row in members)
    def stop(process):
        scratch = next((item for item in instances if process.pid in item.record['groups']), None)
        original_stop(process)
        if scratch is None:
            raise RuntimeError('Missing outer stop owner')
        for group in scratch.record['groups']:
            if group == process.pid:
                continue
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if r.group_has_live_members(group) is False:
                    break
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    break
        if not c.await_owned_absence(scratch.record):
            raise RuntimeError('Outer descendant survived')
    r.group_rss, r.stop_group = sample, stop
    stamp = module('composition_targeted_stamp', ROOT / '_tools/test_stamp.py')
    stamp.resource_module = lambda: r
    g = module('composition_stamp_git', ROOT / '_tools/scaffold_git.py')
    def git(root, argv):
        with g.checkout_mutex(Path(root)):
            code, out, err = g.git(Path(root), list(argv))
        if code:
            raise stamp.RunError('Scaffold Git read failed')
        return out
    stamp._git = git
    def ref_exists(root, ref):
        with g.checkout_mutex(Path(root)):
            code, _, _ = g.git(Path(root), ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])
        return code == 0
    stamp.ref_exists = ref_exists
    original_settings = stamp.load_settings
    limits = {'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120,
              'log_mib': 0.25, 'unit_ram_mib': 512, 'unit_scratch_mib': 4}
    def settings(root, command_override=None):
        value = original_settings(root, command_override)
        value.resources = dict(value.resources, **limits)
        return value
    stamp.load_settings = settings
    env, removed = supervisor.sanitized_environment(c)
    os.environ.clear()
    os.environ.update(env)
    os.environ['TEST_STAMP_DIR'] = str(RECORDS / 'strict-runtime-composition')
    run = 'runtime-composition-targeted-' + str(time.time_ns())
    os.environ['FUCQ100_COMPOSITION_PARENT_RUN'] = run
    command = shlex.join(['/usr/bin/python3', '-I', str(SUPERVISOR), 'execute', '--catalogue', str(CATALOGUE),
                          '--catalogue-sha256', args.catalogue_sha256, '--dispatcher-grant', args.dispatcher_grant])
    cli = ['--root', str(ROOT), '--jobs', '1', '--targeted', '38be4f5d95823b5f010a56c3d4b6cbda4eca55e8',
           '--command', command, '--reason', 'Granted seven C1/host cases: actual runtime authority, preseal release registry, synthetic TEST pull to exact committed facts and decorated HTTP/history, omitted provider, actual guarded503, real mechanics reset/stale employee/newrun refusal, account/setup/Back/resume. No listener/browser/native/full/live source; no duplicate103 C2 or69/70 C3, unchanged9/25 or F77/F78 acceptance.']
    cleanup_errors = []
    def finalize():
        for scratch in instances:
            if not os.path.lexists(scratch.root) and joined(scratch) and c.await_owned_absence(scratch.record):
                try:
                    r.HostBudget(r.Policy(limits)).release(scratch.token)
                except (OSError, ValueError, r.ResourceError) as exc:
                    cleanup_errors.append(type(exc).__name__ + ': ' + str(exc))
    atexit.register(finalize)
    code = 2
    try:
        dry = stamp.main(cli + ['--dry-run'])
        if dry:
            raise RuntimeError('Targeted plan refused')
        with r.handled_termination():
            code = stamp.main(cli)
    finally:
        finalize()
        nested = {'plan': str(RECORDS / (run + '-inner-plan.json')), 'audit_error': None}
        try:
            inner_plan = json.loads(Path(nested['plan']).read_text())
            inner_manifest = json.loads(Path(inner_plan['manifest']).read_text())
            inner_receipt = json.loads((RECORDS / (run + '-inner-receipt.json')).read_text())
            if inner_manifest['root'] != inner_plan['scratch']:
                raise RuntimeError('Nested root binding mismatch')
            nested.update(scratch_absent=not os.path.lexists(inner_manifest['root']),
                groups_absent=c.all_groups_absent(inner_manifest), pids_absent=c.all_owned_pids_absent(inner_manifest),
                launches_joined=all(row.get('state') == 'joined' for row in inner_manifest.get('launches', [])),
                reservation=r.HostBudget(r.Policy(limits)).reservation_state(inner_manifest['token']),
                receipt_passed=inner_receipt.get('passed') is True,
                catalogue_unchanged=inner_receipt.get('catalogue') == reviewed)
            nested['passed'] = all(nested[key] for key in ('scratch_absent', 'groups_absent', 'pids_absent',
                'launches_joined', 'receipt_passed', 'catalogue_unchanged')) and nested['reservation']['absent']
        except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
            nested.update(passed=False, audit_error=type(exc).__name__ + ': ' + str(exc))
        receipt = {'run': run, 'code': code, 'grant': args.dispatcher_grant, 'command': command,
                   'limits': limits, 'removed_environment_names': removed, 'samples': samples,
                   'cleanup_errors': cleanup_errors, 'nested_independent_audit': nested,
                   'manifests': [{'path': str(scratch.manifest), 'scratch_absent': not os.path.lexists(scratch.root),
                                  'groups_absent': c.all_groups_absent(scratch.record), 'pids_absent': c.all_owned_pids_absent(scratch.record),
                                  'launches_joined': joined(scratch), 'reservation': r.HostBudget(r.Policy(limits)).reservation_state(scratch.token)}
                                 for scratch in instances]}
        if cleanup_errors or not nested['passed'] or any(not (row['scratch_absent'] and row['groups_absent'] and row['pids_absent']
                                      and row['launches_joined'] and row['reservation']['absent']) for row in receipt['manifests']):
            code = receipt['code'] = code or 1
        r.atomic_json(RECORDS / (run + '-receipt.json'), receipt)
        print(json.dumps({key: value for key, value in receipt.items() if key != 'samples'}))
    return code

if __name__ == '__main__':
    sys.exit(main())
