#!/usr/bin/env python3
"""Run one explicitly selected presenter boundary check with owned bounded resources."""
import hashlib, json, os, re, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G
import test_resources as R
SELECTED = {'controls': 'gcsp-presenter-controls-render.test.js', 'shell': 'gcsp-shell.test.js', 'ratchet': 'ui-ratchet.test.js', 'copy': 'render.test.js'}
name = sys.argv[1]
if name not in SELECTED: raise SystemExit('unknown selected module')
RUNS = ROOT / '.claude/test-runs/fucq126-ui-20261105'
policy = R.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 2,
                   'local_scratch_reason': 'Small macOS Node test IPC scratch; helper-owned temporary root.'})
host = R.HostBudget(policy)
command = ['node', '--test', '--test-concurrency=1']
if name == 'copy': command += ['--test-name-pattern', 'no em dashes in any string literal across the client copy surface']
command += ['server/test/' + SELECTED[name]]
paths = [p for p in (ROOT / 'blocks/gcsp').rglob('*') if p.is_file()]
paths += [ROOT / 'gcsp-presenter.html', ROOT / 'blocks/vehicle-matcher/component-gallery.js', ROOT / 'COMPONENTS.md',
          ROOT / 'server/test/ui-ratchet.json', ROOT / 'server/test' / SELECTED[name]]
with G.checkout_mutex(ROOT):
    head = G.git(ROOT, ['rev-parse', 'HEAD'])[1].strip()
identity = {'head': head, 'base': 'a083e28609172a83bbe3d8de31feec48a183f909', 'command': command,
            'hashes': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
receipt = RUNS / (name + '.json')
log = RUNS / (name + '.log')
R.atomic_json(receipt, {'state': 'planned', 'identity': identity, 'health': host.headroom(ROOT),
                       'scope': 'scoped presenter UI boundary module', 'excluded': 'Full npm test, live PostgreSQL, browser, business producers'})
started = time.monotonic()
with R.handled_termination():
    with R.Scratch(RUNS, ROOT, policy, expected=128 * R.MIB, checkpoint=receipt) as scratch:
        reserved = False
        try:
            host.acquire(scratch.token, 128 * R.MIB, 768 * R.MIB, ROOT, root=scratch.root)
            reserved = True
            env = scratch.env(os.environ)
            removed_keys = [key for key in env if re.search(r'(DATABASE.*URL|DB.*URL|POSTGRES.*URL|PG.*URL|SQL.*URL)$', key, re.I)
                            or key.startswith(('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE'))]
            for key in removed_keys: env.pop(key, None)
            env['NODE_V8_COVERAGE'] = str(scratch.root / 'coverage')
            outcome = R.run_process(command, ROOT, env, log, scratch, policy, 128 * R.MIB, 768 * R.MIB, 120, host=host)
        except (KeyboardInterrupt, Exception) as error:
            outcome = {'rc': 130 if isinstance(error, KeyboardInterrupt) else 1,
                       'issue': 'launcher interrupted' if isinstance(error, KeyboardInterrupt) else type(error).__name__}
        finally:
            if reserved: host.release(scratch.token)
        lines = log.read_text().splitlines() if log.exists() else []
        contexts = []
        for source in (scratch.root / 'coverage').glob('*.json'):
            for script in json.loads(source.read_text()).get('result', []):
                if script['url'].startswith('file://' + str(ROOT / 'blocks/gcsp')):
                    contexts.append({'file': script['url'].removeprefix('file://' + str(ROOT) + '/'),
                                     'functions': [fn['functionName'] for fn in script['functions'] if any(r['count'] for r in fn['ranges'])]})
        summary = {'state': 'passed' if outcome['rc'] == 0 and not outcome.get('issue') else 'failed',
                   'identity': identity, 'result': outcome, 'databaseEnvironmentRemoved': True,
                   'summary': [line for line in lines if line.startswith(('# tests', '# pass', '# fail', '# skipped', '# duration', 'ℹ tests', 'ℹ pass', 'ℹ fail', 'ℹ skipped', 'ℹ duration'))],
                   'failures': [line for line in lines if line.startswith(('not ok', '  error:', '  expected:', '  actual:', '✖'))],
                   'wallSeconds': time.monotonic() - started}
    summary['cleanup'] = {'scratch': str(scratch.root), 'manifest': str(scratch.manifest), 'scratchAbsent': not scratch.root.exists(),
                          'removedBytes': scratch.record['peak'], 'groupsAbsent': all(R.group_has_live_members(g) is False for g in scratch.record['groups']),
                          'reservationAbsent': scratch.token not in R.read_json(host.path, {})}
    if not all(summary['cleanup'][key] for key in ('scratchAbsent', 'groupsAbsent', 'reservationAbsent')):
        summary['state'] = 'failed'; summary['cleanupIssue'] = 'Owned cleanup incomplete or uncertain'
    if summary['state'] == 'passed': log.unlink(missing_ok=True)
    R.atomic_json(receipt, summary)
    R.atomic_json(ROOT / '.claude/test-runs/impact' / ('fucq126-ui-' + name + '.json'),
                  {'identity': identity, 'scope': 'one named Node test file; V8 contexts are file-worker observations, not per assertion',
                   'observed': contexts, 'result': summary['state'], 'wallSeconds': summary['wallSeconds'],
                   'limitations': ['Unobserved paths remain unknown', 'No live PostgreSQL or actual business release producer']})
    print(json.dumps({key: summary[key] for key in ('state', 'result', 'summary', 'failures', 'cleanup')}, indent=2))
    raise SystemExit(0 if summary['state'] == 'passed' else 1)
