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
INSTALLED = RECORDS / 'runtime-installed-closure.json'
NODE = Path('/opt/homebrew/bin/node')
PG_ENTRY = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules/pg/esm/index.mjs')
SELECTED = ['server/test/gcsp-greg-driver-eligibility.test.js', 'server/test/gcsp-greg-demand.test.js']
CHANGED = ['server/gcsp/manual-context/recommendation-facts.js', 'server/gcsp/greg/index.js',
           'server/gcsp/greg/publish/index.js', 'server/gcsp/greg/publish/fit.js', *SELECTED]
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
        r'|^(?:LIBPATH|SHLIB_PATH|BASH_ENV|ENV|ZDOTDIR|FUCQ100_GREG_LOADER_SHA256)$', re.I)
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
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('Duplicate reservation JSON key')
            value[key] = item
        return value

    def constant(value):
        raise ValueError('Nonstandard reservation JSON constant: ' + value)

    def ledger(path):
        value = json.loads(path.read_text(), object_pairs_hook=pairs, parse_constant=constant)
        if not isinstance(value, dict):
            raise ValueError('Reservation ledger is not an object')
        for token, entry in value.items():
            if not isinstance(token, str) or not token or not isinstance(entry, dict) \
                or not {'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'} <= entry.keys():
                raise ValueError('Invalid reservation entry')
            owner = entry.get('owner')
            if not isinstance(owner, dict) or type(owner.get('pid')) is not int or owner['pid'] <= 0 \
                or not isinstance(owner.get('start'), str) or not owner['start'].strip():
                raise ValueError('Invalid reservation owner')
            if any(type(entry.get(key)) is not int or entry[key] < 0 for key in ('disk', 'ram', 'used', 'rss')):
                raise ValueError('Invalid reservation accounting')
            if any(entry.get(key) is not None and (not isinstance(entry[key], str) or not entry[key])
                   for key in ('parent', 'root')):
                raise ValueError('Invalid reservation binding')
        return value

    class StrictBudget(resources.HostBudget):
        def release(self, token):
            with resources.locked(self.directory / 'reservations.lock'):
                entries = ledger(self.path)
                entries.pop(token, None)
                resources.atomic_json(self.path, entries)

        def reservation_state(self, token):
            try:
                with resources.locked(self.directory / 'reservations.lock'):
                    return {'absent': token not in ledger(self.path), 'error': None}
            except (OSError, ValueError, resources.ResourceError) as exc:
                return {'absent': False, 'error': type(exc).__name__ + ': ' + str(exc)}

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
            elif specifier == 'pg':
                edge['installed'] = str(PG_ENTRY)
            else:
                raise RuntimeError('Undeclared package: ' + str(edge))
            edges.append(edge)
    for relative in ['package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']:
        path = ROOT / relative
        if path.is_file():
            sources[relative] = sha(path)
    installed = json.loads(INSTALLED.read_text())
    for path, row in installed['files'].items():
        if sha(path) != row['sha256']:
            raise RuntimeError('Installed dependency drift: ' + path)
    helpers = [Path(__file__).resolve(), BASE_RUNNER, INSTALLED, ROOT / '_tools/test_resources.py', ROOT / '_tools/scaffold_git.py', ROOT / '_tools/test_stamp.py', ROOT / '.claude/scaffolding.json',
               ROOT / 'docs/gcsp/evidence/fucq100/greg-eligibility-stamp.py']
    titles = {path: re.findall(r'''\btest\(\s*['"](.*?)['"]''', (ROOT / path).read_text()) for path in SELECTED}
    return {'kind': 'finite ordinary owned-source Greg eligibility validation; not executed',
            'base': 'f5f83cbaac71740d25e3de18498022c3f416998f', 'selected': SELECTED, 'changed': CHANGED,
            'sources': dict(sorted(sources.items())), 'edges': edges, 'installed': installed,
            'installed_identities': {path: {'device': Path(path).stat().st_dev, 'inode': Path(path).stat().st_ino,
                                           'realpath': str(Path(path).resolve()), 'symlink': Path(path).is_symlink()}
                                     for path in installed['files']},
            'python': {'path': '/usr/bin/python3', 'sha256': sha('/usr/bin/python3')},
            'helpers': {str(path): sha(path) for path in helpers}, 'node': {'path': str(NODE), 'sha256': sha(NODE)},
            'tests': titles, 'expected_test_count': sum(map(len, titles.values())),
            'command_template': [str(NODE), '--no-warnings', '--experimental-loader', '<owned-root>/loader.mjs',
                                 '--test-concurrency=1', '--test-reporter=tap', '--test', *SELECTED],
            'limits': {'seconds': 120, 'rss_bytes': 768 * 1024 ** 2, 'scratch_bytes': 128 * 1024 ** 2,
                       'combined_logs_bytes': 2 * 1024 ** 2, 'workers': 1},
            'listener': 'One existing gcsp-greg-demand buildServer test uses an owned ephemeral127.0.0.1 listener; explicit grant required',
            'exclusions': ['no browser/native/full/external provider', 'no103 scorer/source adoption',
                           'no unchanged100 nine-case rerun', 'no production-source overlay', 'no unrelated shared files']}


def run(plan, grant):
    before = catalogue()
    if before != plan:
        raise RuntimeError('Frozen catalogue mismatch before helper import or allocation')
    c = module('greg_resource_helpers', BASE_RUNNER)
    install_strict_pid_probe(c)
    r = c.resources
    install_strict_budget(r)
    policy = r.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 0.25})
    host = r.HostBudget(policy)
    name = 'greg-eligibility-' + uuid.uuid4().hex
    receipt_path = RECORDS / (name + '-receipt.json')
    scratch = c.SafeScratch(RECORDS, ROOT, policy, expected=65536, checkpoint=receipt_path)
    env, removed = sanitized_environment(c)
    samples = []
    original_stop = r.stop_group
    def sample(pgid):
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
                raise RuntimeError('Shared descendant group refused')
            if group not in scratch.record['groups']:
                scratch.record['groups'].append(group)
        r.atomic_json(scratch.manifest, scratch.record)
        samples.append({'at': time.time(), 'members': len(members), 'rss': sum(row['rss'] for row in members)})
        return sum(row['rss'] for row in members)
    def stop(process):
        original_stop(process)
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
            raise RuntimeError('Owned process survived; scratch is preserved')
    r.group_rss, r.stop_group = sample, stop
    cleanup_errors = []
    def finalize():
        if not scratch.root.exists() and c.await_owned_absence(scratch.record):
            try:
                host.release(scratch.token)
            except (OSError, ValueError, r.ResourceError) as exc:
                cleanup_errors.append(type(exc).__name__ + ': ' + str(exc))
    atexit.register(finalize)
    result, error, counts = None, None, {}
    r.atomic_json(RECORDS / (name + '-plan.json'), {'catalogue': plan, 'grant': grant,
                  'manifest': str(scratch.manifest), 'scratch': str(scratch.root), 'removed_environment_names': sorted(removed)})
    try:
        with r.handled_termination():
            allocation = host.acquire(scratch.token, 64 * r.MIB, 768 * r.MIB, ROOT,
                                      root=scratch.root, minimum_disk=65536, minimum_ram=128 * r.MIB)
            with scratch:
                files = {str(ROOT / path): value for path, value in plan['sources'].items()}
                files.update({path: row['sha256'] for path, row in plan['installed']['files'].items()})
                allowed = {Path(path).as_uri(): value for path, value in files.items()}
                loader = scratch.root / 'loader.mjs'
                journal = scratch.root / 'modules.jsonl'
                loader.write_text('import{readFileSync,appendFileSync,existsSync,statSync}from"node:fs";import{createHash}from"node:crypto";'
                    + 'const allowed=new Map(Object.entries(' + json.dumps(allowed) + '));const journal=' + json.dumps(str(journal)) + ';'
                    + 'const own=import.meta.url,ownParent=' + json.dumps(ROOT.as_uri() + '/') + ',ownHash=process.env.FUCQ100_GREG_LOADER_SHA256;'
                    + 'function record(u,expected){if(!expected||createHash("sha256").update(readFileSync(new URL(u))).digest("hex")!==expected)throw Error("Module drift "+u);'
                    + 'if(existsSync(journal)&&statSync(journal).size>131072)throw Error("Module journal bound");'
                    + 'appendFileSync(journal,JSON.stringify({url:u,sha256:expected})+"\\n");}'
                    + 'export async function resolve(s,c,next){const r=s==="pg"?{url:' + json.dumps(PG_ENTRY.as_uri())
                    + ',shortCircuit:true}:await next(s,c);if(r.url===own){if(s!==own||c.parentURL!==ownParent)throw Error("Invalid loader registration");record(own,ownHash);}'
                    + 'else if(r.url.startsWith("file:")&&!allowed.has(r.url))throw Error("Undeclared module "+r.url);return r;}'
                    + 'export async function load(u,c,next){if(u.startsWith("file:"))record(u,u===own?ownHash:allowed.get(u));return next(u,c);}\n')
                env['FUCQ100_GREG_LOADER_SHA256'] = sha(loader)
                argv = [str(NODE), '--no-warnings', '--experimental-loader', str(loader), '--test-concurrency=1',
                        '--test-reporter=tap', '--test', *SELECTED]
                result = r.run_process(argv, ROOT, env, scratch.root / 'raw.log', scratch, policy,
                                       min(policy.scratch_limit, allocation['disk']), min(768 * r.MIB, allocation['ram']), 120, host)
                raw = (scratch.root / 'raw.log').read_bytes()
                clean = c.redact_log(raw)
                (RECORDS / (name + '.log')).write_bytes(clean)
                if journal.exists():
                    (RECORDS / (name + '-modules.jsonl')).write_bytes(journal.read_bytes())
                counts = c.parse_counts(clean.decode())
                result['retained_log'] = str(RECORDS / (name + '.log'))
                result['retained_module_journal'] = str(RECORDS / (name + '-modules.jsonl'))
                result['loader_sha256'] = sha(loader)
    except BaseException as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    finally:
        finalize()
        reservation = host.reservation_state(scratch.token)
        cleanup = {'scratch_absent': not os.path.lexists(scratch.root), 'groups_absent': c.all_groups_absent(scratch.record),
                   'pids_absent': c.all_owned_pids_absent(scratch.record),
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
                      and counts.get('skipped', 0) == 0 and counts.get('cancelled', 0) == 0 and counts.get('todo', 0) == 0
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
