"""Independent post-exit audit for an exact root-approved mixed-decision run. No product imports."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
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
args = parser.parse_args()
started = time.monotonic()
summary_path = Path(args.summary).resolve()
if not summary_path.is_relative_to(BASE) or summary_path.name != 'summary.json':
    raise SystemExit('Audit only a retained105 run summary.')
summary = json.loads(summary_path.read_text())
plan_path = ROOT/'docs/gcsp/evidence/fucq105/decision-mixed-source-plan.json'
if digest(plan_path) != summary['source_plan_sha256']:
    raise SystemExit('Use the exact reviewed plan; no resource cleanup attempted.')
plan = json.loads(plan_path.read_text()); c = summary['cleanup']
launch = c.get('child_launch', {})
if any(digest(ROOT/p) != row['sha256'] for p, row in plan['harness'].items()):
    raise SystemExit('Frozen audit/helper identity changed; preserve the run for review.')
r = module('audit_resources', ROOT/'_tools/test_resources.py')
g = module('audit_git', ROOT/'_tools/scaffold_git.py')
ledger = module('audit_ledger', ROOT/'docs/gcsp/evidence/fucq105/decision-mixed-ledger.py')
try:
    reservation_absent = ledger.Budget(r, r.Policy(plan['limits']), plan['host_budget']).absence(c['token'])
except BaseException:
    reservation_absent = False

checks = {'owner_exited': not r.process_alive(summary['owner']), 'scratch_absent': not os.path.lexists(c['root']),
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
                                 for row in c.get('ledger_staging', [])),
    'local_sources_preserved': all(digest(ROOT/p) == h for p, h in summary['local_source_before'].items()),
    'harness_preserved': all(digest(ROOT/p) == row['sha256'] for p, row in plan['harness'].items())}
node = Path(plan['node']['path']); st = node.stat()
checks['node_preserved'] = digest(node) == plan['node']['sha256'] and [st.st_dev, st.st_ino] == plan['node']['installationIdentity']
checks['immutable_sources_inputs_preserved'] = True
for relative, row in {**plan['modules'], **plan['file_inputs']}.items():
    rc, text, err = g.git(ROOT, ['show', row['ref']+':'+relative])
    checks['immutable_sources_inputs_preserved'] &= rc == 0 and hashlib.sha256(text.encode()).hexdigest() == row['sha256']
checks['retained_dependencies_preserved'] = True
for row in plan['retained_dependencies'].values():
    st = Path(row['installedRoot']).stat()
    checks['retained_dependencies_preserved'] &= digest(row['packageJson']) == row['packageJsonSha256'] \
        and digest(row['entry']) == row['entrySha256'] \
        and [st.st_dev, st.st_ino] == [row['installationDevice'], row['installationInode']]
manifest = Path(c['scratch_manifest'])
if manifest.exists():
    data = json.loads(manifest.read_text())
    checks['owned_removed_manifest'] = data['token'] == c['token'] and data['root'] == c['root'] \
        and data['state'] == 'removed' and not r.process_alive(data['owner']) \
        and data.get('child_launch') == launch and data.get('groups') == c['groups'] \
        and data.get('processes') == c['processes']
else:
    checks['owned_removed_manifest'] = True
if not all(checks.values()):
    r.atomic_json(summary_path.parent/'independent-audit.json', {'status': 'failed', 'checks': checks,
        'leftovers': [key for key, value in checks.items() if not value]})
    raise SystemExit('Independent audit failed; preserve named resources for review.')
# Only the independently verified disposable scratch manifest is removed. No source/environment deletion.
if manifest.exists():
    manifest.unlink()
assert not manifest.exists()
r.atomic_json(summary_path.parent/'independent-audit.json', {'status': 'passed', 'checks': checks,
    'scratch_manifest_absent': not manifest.exists(), 'summary_sha256': digest(summary_path),
    'audit_wall_seconds': time.monotonic() - started,
    'open_file_scope': 'No post-deletion lsof success is claimed; owner/process/group absence and filesystem removal checked independently.',
    'retained': 'Plan, grant consumption, checkpoints, canonical hash journal, strict evidence, concise summary and bounded failure log.',
    'leftovers': []})
print(json.dumps({'status': 'passed', 'audit': str(summary_path.parent/'independent-audit.json')}))
