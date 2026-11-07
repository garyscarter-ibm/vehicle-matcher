#!/usr/bin/env python3
"""Static catalogue by default; execution requires a separate dispatcher grant and exact catalogue hash."""
import argparse
import atexit
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-060')
RECORDS = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100')
BASE_RUNNER = RECORDS / 'runtime-supervisor.py'
INSTALLED = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-installed.json'
SOURCE_PLAN = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-source-plan.json'
JSDOM_ENTRY = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/node_modules/jsdom/lib/api.js')
LAUNCH = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-launch.py'
LOADER = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-loader.mjs'
PRELOAD = ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-preload.cjs'
NODE = Path('/opt/homebrew/bin/node')
PG_ENTRY = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules/pg/esm/index.mjs')
SELECTED = ['server/test/gcsp-runtime-composition.test.js']
CHANGED = ['server/gcsp/runtime.js', 'server/index.js', 'blocks/gcsp/manual-setup/journey.js',
           'scripts/gcsp-demo.mjs', 'gcsp-account.html', 'server/test/helpers/runtime-composition-profile.js', *SELECTED]
IMPORTS = re.compile(r"""(?:^|\n)\s*(?:import|export)\s+(?:(?!;)[\s\S])*?\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]|(?:^|\n)\s*import\s*['"]([^'"\n]+)['"]|new\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url""")
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def sanitized_environment(helpers):
    env, removed = helpers.sanitized_environment()
    injection = re.compile(r'COVERAGE|PROFILE|DEBUG|PRELOAD|INSPECT|NATIVE|MALLOC'
        r'|(?:^|_)(?:COV|GCOV|LCOV|NYC|ISTANBUL)(?:_|$)'
        r'|^(?:NODE_|V8_|DYLD_|LD_|_RLD_|LDR_|PYTHON|ASAN_|LSAN_|MSAN_|TSAN_|UBSAN_)'
        r'|^(?:LIBPATH|SHLIB_PATH|BASH_ENV|ENV|ZDOTDIR)$|^FUCQ100_COMPOSITION_', re.I)
    deployed = {'DEMO_ACCESS_KEY', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'GCSP_NOTIFICATION_TRANSPORT'}
    for key in list(env):
        if injection.search(key) or key.upper() in deployed:
            removed.append(key)
            del env[key]
    return env, sorted(set(removed))


def install_strict_pid_probe(helpers):
    def absent(record):
        pid = record.get('pid')
        if type(pid) is not int or pid <= 0:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except OSError:
            return False
        start = record.get('start')
        current = helpers.resources.process_identity(pid)
        return bool(isinstance(start, str) and start.strip() and isinstance(current, str)
                    and current.strip() and current != start)
    helpers.pid_probe = absent


def install_strict_budget(resources):
    # One process-local registry is shared by all HostBudget instances here,
    # including the finalizer's new instance. Bindings never come from a row
    # that a caller merely found under a supplied token.
    bindings = {}

    def pairs(items):
        value = {}
        for key, item in items:
            if key in value: raise ValueError('Duplicate reservation JSON key')
            value[key] = item
        return value

    def constant(value):
        raise ValueError('Nonstandard reservation JSON constant: ' + value)

    def ledger(path):
        # Absence, symlinks, unreadable content and malformed state are errors,
        # never an empty ledger. This launcher does not bootstrap/reconcile it.
        if path.is_symlink(): raise ValueError('Reservation ledger is a symlink')
        value = json.loads(path.read_text(), object_pairs_hook=pairs, parse_constant=constant)
        return validate(value)

    def validate(value):
        if not isinstance(value, dict): raise ValueError('Reservation ledger is not an object')
        for token, entry in value.items():
            if not isinstance(token, str) or not token or not isinstance(entry, dict) \
                or entry.keys() != {'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'}:
                raise ValueError('Invalid reservation entry')
            owner = entry.get('owner')
            if not isinstance(owner, dict) or owner.keys() != {'pid', 'start'} \
                or type(owner.get('pid')) is not int or owner['pid'] <= 0 \
                or not isinstance(owner.get('start'), str) or not owner['start'].strip():
                raise ValueError('Invalid reservation owner')
            if any(type(entry.get(key)) is not int or entry[key] < 0 for key in ('disk', 'ram', 'used', 'rss')):
                raise ValueError('Invalid reservation accounting')
            if any(entry.get(key) is not None and (not isinstance(entry[key], str) or not entry[key]) for key in ('parent', 'root')):
                raise ValueError('Invalid reservation binding')
            if entry['root'] is not None and not Path(entry['root']).is_absolute():
                raise ValueError('Reservation root must be absolute')
        for token in value:
            seen, current = set(), token
            while current is not None:
                if current not in value: raise ValueError('Dangling reservation ancestry')
                if current in seen: raise ValueError('Cyclic reservation ancestry')
                seen.add(current); current = value[current]['parent']
        return value

    def current_owner():
        owner = resources.owner()
        if owner.get('pid') != os.getpid() or not isinstance(owner.get('start'), str) or not owner['start'].strip():
            raise resources.ResourceError('Cannot establish exact reservation owner')
        return owner

    def binding_key(budget, token):
        return (str(budget.path.absolute()), token)

    def store(path, before, after, token):
        # Only the named owned row may differ; verify the complete strict
        # readback (including every foreign row) while the lock remains held.
        if {key: row for key, row in before.items() if key != token} != \
                {key: row for key, row in after.items() if key != token}:
            raise resources.ResourceError('Foreign reservation mutation refused')
        validate(after)
        resources.atomic_json(path, after)
        if ledger(path) != after: raise resources.ResourceError('Reservation write/readback mismatch')

    class StrictBudget(resources.HostBudget):
        def _dead_owners(self):
            return {}  # Never reconcile another launch's reservation.

        def _live(self, dead):
            return ledger(self.path)

        def headroom(self, volume):
            free, memory = resources.shutil.disk_usage(volume).free, resources.available_memory()
            with resources.locked(self.directory / 'reservations.lock'):
                return self._capacity(ledger(self.path), free, memory)

        def _owned(self, token, entries, caller, allow_released=False):
            binding = bindings.get(binding_key(self, token))
            if binding is None or binding['owner'] != caller:
                raise resources.ResourceError('Reservation has no exact caller ownership binding')
            if binding['phase'] == 'released' and allow_released and token not in entries:
                return binding
            if binding['phase'] != 'active' or token not in entries:
                raise resources.ResourceError('Owned reservation missing or mutation uncertain')
            row = entries[token]
            if any(row[key] != binding[key] for key in ('owner', 'root', 'parent', 'disk', 'ram')):
                raise resources.ResourceError('Reservation owner PID/start/root/allocation binding changed')
            return binding

        def acquire(self, token, disk, ram, volume, root=None, minimum_disk=None, minimum_ram=None):
            owner = current_owner()
            if not isinstance(token, str) or not token or root is None or not Path(root).is_absolute():
                raise resources.ResourceError('Supply exact token and absolute owned root')
            if binding_key(self, token) in bindings:
                raise resources.ResourceError('Reservation token reuse refused')
            free, memory = resources.shutil.disk_usage(volume).free, resources.available_memory()
            with resources.locked(self.directory / 'reservations.lock'):
                before = ledger(self.path)
                if token in before: raise resources.ResourceError('Existing reservation token refused')
                capacity = self._capacity(before, free, memory)
                need_disk = disk if minimum_disk is None else minimum_disk
                need_ram = ram if minimum_ram is None else minimum_ram
                if need_disk > capacity['disk'] or capacity['ram'] is not None and need_ram > capacity['ram']:
                    raise resources.CapacityError('Indivisible owned chunk cannot fit declared minima', capacity)
                disk = min(disk, capacity['disk'])
                ram = ram if capacity['ram'] is None else min(ram, capacity['ram'])
                row = {'owner': owner, 'disk': disk, 'ram': ram, 'used': 0, 'rss': 0,
                       'parent': capacity['parent'], 'root': str(root)}
                binding = {key: row[key] for key in ('owner', 'root', 'parent', 'disk', 'ram')}
                binding['phase'] = 'writing'
                bindings[binding_key(self, token)] = binding
                after = dict(before); after[token] = row
                store(self.path, before, after, token)
                binding['phase'] = 'active'
                return {'disk': disk, 'ram': ram}

        def update(self, token, used, rss):
            if any(type(value) is not int or value < 0 for value in (used, rss)):
                raise resources.ResourceError('Invalid owned usage accounting')
            caller = current_owner()
            with resources.locked(self.directory / 'reservations.lock'):
                before = ledger(self.path); binding = self._owned(token, before, caller)
                after = dict(before); after[token] = dict(before[token], used=used, rss=rss)
                binding['phase'] = 'writing'
                store(self.path, before, after, token)
                binding['phase'] = 'active'
                return True

        def release(self, token):
            caller = current_owner()
            with resources.locked(self.directory / 'reservations.lock'):
                before = ledger(self.path); binding = self._owned(token, before, caller, allow_released=True)
                if binding['phase'] == 'released': return
                after = dict(before); del after[token]
                binding['phase'] = 'writing'
                store(self.path, before, after, token)
                binding['phase'] = 'released'

        def reservation_state(self, token):
            try:
                caller = current_owner() if binding_key(self, token) in bindings else None
                with resources.locked(self.directory / 'reservations.lock'):
                    entries = ledger(self.path)
                    binding = bindings.get(binding_key(self, token))
                    if binding is not None:
                        self._owned(token, entries, caller, allow_released=True)
                    return {'absent': token not in entries, 'error': None, 'binding_owned': binding is not None,
                            'released': binding is not None and binding['phase'] == 'released'}
            except (OSError, ValueError, resources.ResourceError) as exc:
                return {'absent': False, 'error': type(exc).__name__ + ': ' + str(exc), 'binding_owned': False, 'released': False}

    resources.HostBudget = StrictBudget


def catalogue():
    sources, edges, pending = {}, [], [ROOT / path for path in SELECTED]
    while pending:
        path = pending.pop().resolve()
        relative = path.relative_to(ROOT).as_posix()
        if path.is_dir():
            members = sorted(item for item in path.rglob('*') if item.is_file())
            edges.append({'directory': relative, 'members': [item.relative_to(ROOT).as_posix() for item in members]})
            pending.extend(members)
            continue
        if relative in sources:
            continue
        sources[relative] = sha(path)
        if path.suffix not in ('.js', '.mjs', '.cjs'):
            continue
        text = path.read_text()
        for matches in IMPORTS.findall(text):
            specifier = next(part for part in matches if part)
            edge = {'from': relative, 'specifier': specifier}
            if specifier.startswith('.'):
                target = (path.parent / specifier).resolve()
                edge['path'] = target.relative_to(ROOT).as_posix()
                if not target.exists():
                    raise RuntimeError('Missing source: ' + str(edge))
                pending.append(target)
            elif specifier.startswith('node:'):
                edge['builtin'] = True
            elif specifier in ('pg', 'jsdom'):
                edge['installed'] = str(PG_ENTRY if specifier == 'pg' else JSDOM_ENTRY)
            else:
                raise RuntimeError('Undeclared package: ' + str(edge))
            edges.append(edge)
    for relative in ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']:
        path = ROOT / relative
        if path.is_file():
            sources[relative] = sha(path)
    source_plan = json.loads(SOURCE_PLAN.read_text())
    if not source_plan['leaf_adoption_granted'] or source_plan['execution_granted']:
        raise RuntimeError('Source authoring boundary changed')
    for relative, row in source_plan['sources'].items():
        if sha(ROOT / relative) != row['sha256']:
            raise RuntimeError('Adopted source drift: ' + relative)
        sources[relative] = row['sha256']
    sources['docs/gcsp/evidence/fucq100/runtime-composition-source-plan.json'] = sha(SOURCE_PLAN)
    for path in (LOADER, PRELOAD): sources[path.relative_to(ROOT).as_posix()] = sha(path)
    installed = json.loads(INSTALLED.read_text())
    for path, row in installed['files'].items():
        stat = Path(path).stat()
        if sha(path) != row['sha256'] or stat.st_dev != row['device'] or stat.st_ino != row['inode'] \
            or str(Path(path).resolve()) != row['realpath'] or Path(path).is_symlink() != row['symlink']:
            raise RuntimeError('Installed dependency drift: ' + path)
    for row in installed['packages']:
        stat = Path(row['path']).stat()
        if stat.st_dev != row['device'] or stat.st_ino != row['inode']:
            raise RuntimeError('Installed package identity drift: ' + row['path'])
    namespace = {str(path) for row in installed['packages'] for path in Path(row['path']).rglob('*') if path.is_file()}
    expected_namespace = {path for path in installed['files']
        if any(path.startswith(row['path'] + '/') for row in installed['packages'])}
    if namespace != expected_namespace:
        raise RuntimeError('Finite installed package/resource namespace changed')
    for row in installed['absent_optional']:
        if any(Path(path).exists() for path in row['paths']):
            raise RuntimeError('Previously absent optional package appeared')
    helpers = [Path(__file__).resolve(), BASE_RUNNER, INSTALLED, LAUNCH, LOADER, PRELOAD,
        ROOT / '_tools/test_resources.py', ROOT / '_tools/scaffold_git.py', ROOT / '_tools/test_stamp.py',
        ROOT / '.claude/scaffolding.json', ROOT / 'docs/gcsp/evidence/fucq100/runtime-composition-stamp.py']
    titles = {path: re.findall(r"\btest\(\s*['\"](.*?)['\"]", (ROOT / path).read_text()) for path in SELECTED}
    if sum(map(len, titles.values())) != 7: raise RuntimeError('Exactly seven selected cases required')
    def identity(path):
        stat = Path(path).stat()
        return {'path': str(path), 'sha256': sha(path), 'device': stat.st_dev, 'inode': stat.st_ino,
                'realpath': str(Path(path).resolve()), 'symlink': Path(path).is_symlink()}
    return {'kind': 'finite C1 composition and host regression proposal; not executed',
            'base': '38be4f5d95823b5f010a56c3d4b6cbda4eca55e8', 'source_checkpoint': 'f179ae6043414a2b07de3edb2b425338299ea37b',
            'selected': SELECTED, 'changed': CHANGED,
            'sources': dict(sorted(sources.items())), 'edges': edges,
            'edge_counts': {'literal': sum('specifier' in row for row in edges), 'directory': sum('directory' in row for row in edges)},
            'installed': installed,
            'python': identity('/usr/bin/python3'), 'node': identity(NODE),
            'support_executables': {path: identity(path) for path in
                ['/usr/bin/env', '/usr/bin/git', '/bin/sh', '/bin/ps', '/usr/bin/vm_stat', '/usr/sbin/lsof']},
            'helpers': {str(path): sha(path) for path in helpers}, 'tests': titles, 'expected_test_count': 7,
            'command_template': [str(NODE), '--no-warnings', '--require', str(PRELOAD),
                '--experimental-loader', str(LOADER), '--test-concurrency=1', '--test-reporter=tap', '--test', *SELECTED],
            'limits': {'seconds': 120, 'rss_bytes': 768 * 1024 ** 2, 'scratch_bytes': 128 * 1024 ** 2,
                       'combined_logs_bytes': 2 * 1024 ** 2, 'workers': 1},
            'estimates': {'peak_scratch_bytes': 4 * 1024 ** 2, 'peak_recursive_rss_bytes': 512 * 1024 ** 2,
                          'duration_seconds': 30, 'status': 'prospective; no measured result on these inputs'},
            'listener': 'None; Readable request/response invokes the actual handler in process',
            'environment': {'outer': 'env -i with PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/Users/garycarter',
                'inner': 'remove database aliases, deployed credentials, preload/debug/coverage/injection variables; owned TMPDIR/TMP/TEMP',
                'added': ['FUCQ100_COMPOSITION_PARENT_RUN', 'FUCQ100_COMPOSITION_CONFIG', 'FUCQ100_COMPOSITION_CONFIG_SHA256']},
            'scope': 'Six C1 cases plus account/setup/Back/resume; real default employee preparation; synthetic TEST pull input only',
            'exclusions': ['no listener/browser/native/full/live provider/dependency installation',
                'no duplicate103 C2 or69/70 C3 harness', 'no F77/F78 or default/reset enriched corpus acceptance',
                'no unchanged9/25 rerun', 'no frozen66 or paused96 edits', 'no product fallback or released-row patch']}


def run(plan, grant):
    before = catalogue()
    if before != plan:
        raise RuntimeError('Frozen catalogue mismatch before helper import or allocation')
    c = module('greg_resource_helpers', BASE_RUNNER)
    install_strict_pid_probe(c)
    r = c.resources
    install_strict_budget(r)
    launch = module('composition_owned_launch', LAUNCH)
    joined = launch.install(c, plan['support_executables'])
    policy = r.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 0.25})
    host = r.HostBudget(policy)
    parent = os.environ.get('FUCQ100_COMPOSITION_PARENT_RUN')
    if parent is not None and not re.fullmatch('runtime-composition-targeted-[0-9]+', parent):
        raise RuntimeError('Invalid outer run binding')
    name = parent + '-inner' if parent else 'runtime-composition-' + uuid.uuid4().hex
    receipt_path = RECORDS / (name + '-receipt.json')
    scratch = c.SafeScratch(RECORDS, ROOT, policy, expected=2 * r.MIB, checkpoint=receipt_path)
    scratch.record['retained_outputs'] = {str(scratch.root / source): str(RECORDS / (name + suffix))
        for source, suffix in [('raw.log', '.log'), ('esm-modules.jsonl', '-esm-modules.jsonl'),
                               ('cjs-modules.jsonl', '-cjs-modules.jsonl')]}
    env, removed = sanitized_environment(c)
    samples = joined.samples
    cleanup_errors = []
    def finalize():
        if not os.path.lexists(scratch.root) and joined(scratch) and c.await_owned_absence(scratch.record):
            try:
                state = host.reservation_state(scratch.token)
                if state['binding_owned'] and not state['released']: host.release(scratch.token)
            except (OSError, ValueError, r.ResourceError) as exc:
                cleanup_errors.append(type(exc).__name__ + ': ' + str(exc))
    atexit.register(finalize)
    result, error, counts = None, None, {}
    r.atomic_json(RECORDS / (name + '-plan.json'), {'catalogue': plan, 'grant': grant,
                  'manifest': str(scratch.manifest), 'scratch': str(scratch.root), 'removed_environment_names': sorted(removed)})
    try:
        with r.handled_termination():
            allocation = host.acquire(scratch.token, 64 * r.MIB, 768 * r.MIB, ROOT,
                                      root=scratch.root, minimum_disk=2 * r.MIB, minimum_ram=512 * r.MIB)
            with scratch:
                files = {str(ROOT / path): {'sha256': value, 'device': (ROOT / path).stat().st_dev,
                    'inode': (ROOT / path).stat().st_ino, 'realpath': str((ROOT / path).resolve())}
                    for path, value in plan['sources'].items()}
                files.update(plan['installed']['files'])
                config = scratch.root / 'admission.json'
                journal = scratch.root / 'esm-modules.jsonl'
                cjs_journal = scratch.root / 'cjs-modules.jsonl'
                config.write_text(json.dumps({'files': files, 'parentURL': ROOT.as_uri() + '/',
                    'entries': {'pg': str(PG_ENTRY), 'jsdom': str(JSDOM_ENTRY)},
                    'esmJournal': str(journal), 'cjsJournal': str(cjs_journal)}, separators=(',', ':')))
                env['FUCQ100_COMPOSITION_CONFIG'] = str(config)
                env['FUCQ100_COMPOSITION_CONFIG_SHA256'] = sha(config)
                argv = plan['command_template']
                result = r.run_process(argv, ROOT, env, scratch.root / 'raw.log', scratch, policy,
                                       min(policy.scratch_limit, allocation['disk']), min(768 * r.MIB, allocation['ram']), 120, host)
                raw = (scratch.root / 'raw.log').read_bytes()
                clean = c.redact_log(raw)
                (RECORDS / (name + '.log')).write_bytes(clean)
                for selected_journal, suffix in [(journal, '-esm-modules.jsonl'), (cjs_journal, '-cjs-modules.jsonl')]:
                    if selected_journal.exists(): (RECORDS / (name + suffix)).write_bytes(selected_journal.read_bytes())
                counts = c.parse_counts(raw.decode('utf-8', errors='replace'))
                result['retained_log'] = str(RECORDS / (name + '.log'))
                result['retained_module_journals'] = [str(RECORDS / (name + suffix)) for suffix in ('-esm-modules.jsonl', '-cjs-modules.jsonl')]
                result['loader_sha256'] = sha(LOADER)
                result['preload_sha256'] = sha(PRELOAD)
                result['config_sha256'] = sha(config)
    except BaseException as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    finally:
        finalize()
        reservation = host.reservation_state(scratch.token)
        cleanup = {'scratch_absent': not os.path.lexists(scratch.root), 'groups_absent': c.all_groups_absent(scratch.record),
                   'pids_absent': c.all_owned_pids_absent(scratch.record),
                   'launches_joined': joined(scratch), 'open_files_absence_checked': bool(scratch.record.get('open_files_absent')), 'output_bounded': not scratch.record.get('output_bound_exceeded', False),
                   'reservation_absent': reservation['absent'] and not cleanup_errors}
        if reservation['error'] or cleanup_errors:
            error = error or 'Reservation cleanup: ' + str(reservation['error'] or cleanup_errors)
        try:
            unchanged = catalogue() == before
        except BaseException as exc:
            unchanged = False
            error = error or ('Final catalogue: ' + type(exc).__name__ + ': ' + str(exc))
        passed = bool(result and result['rc'] == 0 and not result['issue'] and counts.get('tests') == plan['expected_test_count']
                      and counts.get('pass') == plan['expected_test_count'] and counts.get('fail') == 0
                      and counts.get('skipped') == 0 and counts.get('cancelled') == 0 and counts.get('todo') == 0
                      and unchanged and all(cleanup.values()) and not error)
        receipt = {'run': name, 'grant': grant, 'passed': passed, 'result': result, 'counts': counts, 'error': error,
                   'source_and_installed_unchanged': unchanged, 'cleanup': cleanup, 'manifest': str(scratch.manifest),
                   'owned_processes': scratch.record, 'samples': samples, 'catalogue': before}
        r.atomic_json(receipt_path, receipt)
        print(json.dumps({'receipt': str(receipt_path), 'passed': passed, 'counts': counts, 'cleanup': cleanup, 'error': error}))
    return 0 if passed else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['catalogue', 'execute'])
    parser.add_argument('--catalogue', required=True, type=Path)
    parser.add_argument('--catalogue-sha256')
    parser.add_argument('--dispatcher-grant')
    args = parser.parse_args()
    if args.mode == 'catalogue':
        plan = catalogue()
        args.catalogue.write_text(json.dumps(plan, indent=2) + '\n')
        print(json.dumps({'source_files': len(plan['sources']), 'edges': len(plan['edges']),
                          'installed_files': len(plan['installed']['files']), 'selected_tests': plan['expected_test_count'],
                          'catalogue_sha256': sha(args.catalogue), 'executed': False}))
        return 0
    if not args.dispatcher_grant or not args.catalogue_sha256 or sha(args.catalogue) != args.catalogue_sha256:
        raise RuntimeError('Execution requires dispatcher grant and exact reviewed catalogue hash')
    return run(json.loads(args.catalogue.read_text()), args.dispatcher_grant)

if __name__ == '__main__':
    sys.exit(main())
