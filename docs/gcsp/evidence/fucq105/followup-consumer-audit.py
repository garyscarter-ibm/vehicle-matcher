"""Independent parent post-exit audit; bounded retained allocation and immutable receipts."""
from pathlib import Path
import argparse
import atexit
import hashlib
import importlib.util
import json
import os
import threading
import time

ROOT = Path(__file__).resolve().parents[4]
BASE = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq105')

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(65536), b''):
            value.update(block)
    return value.hexdigest()

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--summary', required=True)
parser.add_argument('--helper-journal', required=True, help='Parent-owned bounded auditor helper journal')
parser.add_argument('--supervisor-exit-code', required=True, type=int,
                    help='Actual captured parent wait result; a terminal receipt alone is insufficient')
args = parser.parse_args()
started = time.monotonic()
summary_path = Path(args.summary).resolve()
if not summary_path.is_relative_to(BASE) or summary_path.name != 'summary.json':
    raise SystemExit('Audit only a retained105 run summary.')
plan_path = ROOT/'docs/gcsp/evidence/fucq105/followup-consumer-source-plan.json'
if plan_path.stat().st_size > 1048576:
    raise SystemExit('Plan exceeds bootstrap byte cap')
with plan_path.open('rb') as source:
    payload = source.read(1048577)
    if len(payload) > 1048576:
        raise SystemExit('Plan byte cap exceeded')
    plan = json.loads(payload)
if any(digest(ROOT/p) != row['sha256'] for p, row in plan['harness'].items()):
    raise SystemExit('Frozen audit/helper identity changed; preserve the run for review.')
b = module('audit_bounds', ROOT/'docs/gcsp/evidence/fucq105/followup-consumer-bounds.py')
if plan['accounting'] != b.CONTRACT:
    raise SystemExit('Accounting contract changed')
summary = b.read_json(summary_path, b.CONTRACT['summary_bytes'])
if digest(plan_path) != summary['source_plan_sha256']:
    raise SystemExit('Use the exact reviewed plan; no resource cleanup attempted.')
c = summary['cleanup']; launch = c.get('child_launch', {})
run_dir = summary_path.parent
run_id = run_dir.name
if not run_id.startswith('fucq105-followup-') or Path(c['scratch_manifest']).parent != run_dir/'ownership':
    raise SystemExit('Unexpected run/manifest binding')
retained = [run_dir, BASE/'ownership'/(run_id+'.json'), BASE/'ownership'/(run_id+'-consumed.json'),
            BASE.parent/'impact'/(run_id+'.json')]
helper_journal = Path(args.helper_journal)
if not helper_journal.is_absolute() or str(helper_journal) != os.path.abspath(helper_journal) or len(str(helper_journal)) > 4096 or \
        helper_journal.name != 'audit-helper-ownership.json' or helper_journal.parent.parent != BASE or \
        not helper_journal.parent.name.startswith(run_id+'-parent-audit-') or \
        any(parent.is_symlink() for parent in (helper_journal, *helper_journal.parents)):
    raise SystemExit('Auditor helpers require the exact parent-owned sibling journal')
retained.append(helper_journal)
cancel = threading.Event()
lifecycle = module('audit_lifecycle', ROOT/'docs/gcsp/evidence/fucq105/decision-mixed-lifecycle.py')
cancellation = lifecycle.deferred_cancellation(cancel)
cancellation.__enter__()
atexit.register(cancellation.__exit__, None, None, None)
helpers = monitor = None
status = 1
try:
    helpers = b.HelperOwnership(helper_journal, {'kind': 'fucq105-independent-audit-helpers',
        'run': run_id, 'source_plan_sha256': summary['source_plan_sha256'],
        'summary_sha256': digest(summary_path), 'output': str(helper_journal.parent)})
    monitor = b.Aggregate(cancel, b.CONTRACT['audit_seconds'], helpers)
    monitor.start()
    outputs = b.Outputs(c['root'], retained, monitor)
    helpers.account(outputs)
    checks = {}
    failure = None
    allocation_before = None
    try:
        terminal = b.read_json(run_dir/'terminal.json', b.CONTRACT['terminal_bytes'])
        final_manifest = b.read_json(c['scratch_manifest'])
        original_helpers = b.read_json(run_dir/'helper-ownership.json', 16384)
        h = original_helpers['helper_ownership']
        original_helpers_ok = original_helpers['owner'] == summary['owner'] \
            and original_helpers['run'] == run_id \
            and original_helpers['source_plan_sha256'] == summary['source_plan_sha256'] \
            and h['closing'] is True and h['issue'] is None and h['pending'] is None \
            and type(h['launches']) is int and type(h['joined']) is int \
            and 0 < h['launches'] <= b.CONTRACT['entries'] and h['launches'] == h['joined']
        r = module('audit_resources', ROOT/'_tools/test_resources.py')
        g = module('audit_git', ROOT/'_tools/scaffold_git.py')
        ledger = module('audit_ledger', ROOT/'docs/gcsp/evidence/fucq105/decision-mixed-ledger.py')
        r.subprocess = b.Captures(helpers); g.subprocess = b.Captures(helpers)
        # This parent auditor observes strict accounting; it never releases or repairs a row.
        try:
            reservation_absent = ledger.Budget(r, r.Policy(plan['limits']), plan['host_budget']).absence(c['token'])
        except BaseException:
            reservation_absent = False
        checks.update({
            'helper_ownership_and_joins_verified': original_helpers_ok,
            'actual_parent_wait_success': args.supervisor_exit_code == 0,
            'terminal_success': terminal['status'] == 'passed' and terminal['failure'] is None
                and terminal['bundle_written'] is True and terminal['reservation_released'] is True
                and terminal['reservation_observation_known'] is True,
            'immutable_summary_binding': terminal['summary_sha256'] == digest(summary_path)
                and terminal['source_plan_sha256'] == summary['source_plan_sha256'],
            'summary_success': summary['status'] == 'pending-independent-audit' and summary['failure'] is None
                and summary['source_inputs_helpers_verified_after'] is True,
            'aggregate_receipt': terminal['aggregate']['issue'] is None and terminal['aggregate']['samples'] > 0
                and 0 < terminal['aggregate']['peak_charged_rss_bytes'] <= terminal['aggregate']['limit_bytes'] <= b.CONTRACT['ram_bytes'],
            'final_combined_upper_bound': 0 < terminal['final_combined_upper_bound_bytes'] <= b.CONTRACT['combined_bytes']
                and terminal['allocation_before_terminal']['charged_combined_bytes'] == terminal['final_combined_upper_bound_bytes'],
            'owner_exited': not r.process_alive(summary['owner']), 'scratch_absent': not os.path.lexists(c['root']),
            'launch_ownership_verified': c.get('child_ownership_and_join_verified') is True
                and (launch.get('attempted') is False and launch.get('state') == 'not-started'
                     or launch.get('attempted') is True and launch.get('state') == 'joined' and launch.get('joined') is True
                     and launch.get('direct_joined') is True
                     and isinstance(launch.get('pid'), int) and launch['pid'] in c['groups'])
                and launch.get('issues') == [],
            'groups_absent': all(r.group_has_live_members(group) is False for group in c['groups']),
            'processes_absent': all(not r.process_alive(row) for row in c['processes']),
            'reservation_absent': reservation_absent,
            'ledger_staging_absent': all(row.get('state') == 'removed' and not os.path.lexists(row['path'])
                                         for row in final_manifest.get('ledger_staging', []))
                and len(final_manifest.get('ledger_staging', [])) == terminal['ledger_staging_count']
                and digest(c['scratch_manifest']) == terminal['scratch_manifest_sha256'],
            'local_sources_preserved': all(digest(ROOT/p) == h for p, h in summary['local_source_before'].items()),
            'harness_preserved': all(digest(ROOT/p) == row['sha256'] for p, row in plan['harness'].items())})
        node = Path(plan['node']['path']); st = node.stat()
        checks['node_preserved'] = digest(node) == plan['node']['sha256'] and [st.st_dev, st.st_ino] == plan['node']['installationIdentity']
        checks['immutable_sources_inputs_preserved'] = True
        for relative, row in {**plan['modules'], **plan['file_inputs']}.items():
            monitor.check()
            if cancel.is_set():
                raise b.BoundError('Audit cancelled')
            rc, text, err = g.git(ROOT, ['show', row['ref']+':'+relative])
            checks['immutable_sources_inputs_preserved'] &= rc == 0 and hashlib.sha256(text.encode()).hexdigest() == row['sha256']
        checks['retained_dependencies_preserved'] = True
        for row in plan['retained_dependencies'].values():
            monitor.check()
            st = Path(row['installedRoot']).stat()
            checks['retained_dependencies_preserved'] &= digest(row['packageJson']) == row['packageJsonSha256'] \
                and digest(row['entry']) == row['entrySha256'] \
                and [st.st_dev, st.st_ino] == [row['installationDevice'], row['installationInode']]
        manifest = Path(c['scratch_manifest'])
        if manifest.exists():
            data = b.read_json(manifest)
            checks['owned_removed_manifest'] = data['token'] == c['token'] and data['root'] == c['root'] \
                and data['state'] == 'removed' and not r.process_alive(data['owner']) \
                and data.get('child_launch') == launch and data.get('groups') == c['groups'] \
                and data.get('processes') == c['processes']
        else:
            checks['owned_removed_manifest'] = False
        # Independent filesystem walk includes summary/terminal/strict/journal/ownership/impact,
        # allocated blocks (not only logical lengths), and all fixed temporary/audit allowances.
        allocation_before = outputs.observe()
        checks['terminal_upper_bound_covers_actual_files'] = allocation_before['retained_allocated_bytes'] \
            + allocation_before['scratch_allocated_bytes'] <= terminal['final_combined_upper_bound_bytes']
        checks['retained_allocation_within_cap'] = allocation_before['retained_allocated_bytes'] <= b.CONTRACT['retained_bytes']
        checks['combined_allocation_within_cap'] = allocation_before['charged_combined_bytes'] <= b.CONTRACT['combined_bytes']
        checks['retained_artifact_caps'] = True
        for folder, dirs, files in os.walk(run_dir, followlinks=False):
            for name in files:
                path = Path(folder)/name
                cap = {'summary.json': b.CONTRACT['summary_bytes'], 'terminal.json': b.CONTRACT['terminal_bytes'],
                       'modules.jsonl': b.CONTRACT['journal_bytes'], 'checkpoints.json': b.CONTRACT['checkpoint_bytes'],
                       'failure.log': 65536}.get(name, b.CONTRACT['json_bytes'])
                b.read_bytes(path, cap)
                if name.endswith('.json'):
                    b.read_json(path, cap)
        for path in retained[1:]:
            b.read_json(path)
        checks['owned_atomic_staging_absent'] = not b.temporary_leftovers(retained, summary['owner']['pid']) \
            and not any(path.name.startswith('.') and '.owned-' in path.name for path in run_dir.rglob('*'))
        monitor.check()
        checks['parent_aggregate_within_cap'] = True
        if cancel.is_set():
            raise b.BoundError('Audit cancelled')
        if not all(checks.values()):
            raise b.BoundError('Independent audit gates failed')
        # Only this independently verified disposable scratch manifest is removed.
        if manifest.exists():
            with helpers.gate():
                manifest.unlink()
        checks['scratch_manifest_absent'] = not os.path.lexists(manifest)
        if not checks['scratch_manifest_absent']:
            raise b.BoundError('Scratch manifest deletion uncertain')
    except BaseException as error:
        failure = type(error).__name__
    finally:
        outputs.diagnostics = True
        try:
            # One finite audit receipt, then a separate actual filesystem check; no self-rewrite.
            receipt = {'status': 'failed' if failure else 'passed', 'failure': failure, 'checks': checks,
                'summary_sha256': digest(summary_path), 'terminal_sha256': digest(run_dir/'terminal.json'),
                'allocation_before_audit': allocation_before, 'aggregate': monitor.receipt(), 'helpers': helpers.receipt(),
                'audit_wall_seconds': time.monotonic()-started,
                'leftovers': [key for key, value in checks.items() if not value],
                'scope': 'Independent actual retained blocks/per-file caps and fixed audit/atomic allowances; parent owns actual wait result and final receipt. No post-deletion lsof claim.'}
            outputs.json(run_dir/'independent-audit.json', receipt, b.CONTRACT['audit_bytes'], exclusive=True)
            postwrite = outputs.observe()  # Includes the actual audit receipt; failure exits nonzero.
            monitor.checkpoint()
            if postwrite['retained_allocated_bytes'] + postwrite['scratch_allocated_bytes'] > terminal['final_combined_upper_bound_bytes']:
                raise b.BoundError('Terminal upper bound does not cover actual final audit allocation')
        except BaseException:
            failure = failure or 'AuditWriteOrPostwriteCheckFailed'
        finally:
            try:
                monitor.stop()
            except BaseException:
                failure = failure or 'AuditMonitorJoinFailed'
        if cancel.is_set():
            failure = failure or 'AuditCancelled'
        if monitor.issue or helpers.issue:
            failure = failure or 'AuditAggregateObservationFailed'
        print(b.encode({'status': 'failed' if failure else 'passed', 'failure': failure,
            'audit': str(run_dir/'independent-audit.json'), 'postwrite': postwrite if not failure else None},
            b.CONTRACT['stdout_bytes']).decode(), end='')
    status = 1 if failure else 0
except BaseException:
    status = 1
finally:
    try:
        if monitor is not None:
            monitor.stop()
    except BaseException:
        status = 1
    finally:
        if helpers is not None:
            try:
                helpers.sweep()
            except BaseException:
                status = 1
raise SystemExit(status)
