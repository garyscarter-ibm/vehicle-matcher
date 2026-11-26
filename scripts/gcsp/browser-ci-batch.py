#!/usr/bin/env python3
"""CI adapter for the existing registered GCSP browser runner; no hosted services."""
import argparse
import ast
import contextlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git
import test_resources as resources

FAMILIES = ('f340', 'f548', 'f549', 'f550', 'f551', 'f552', 'f553', 'f554',
            'f555', 'f556', 'f557', 'f558', 'f559', 'f560', 'f561', 'f520', 'f521', 'f595')
REFERENCE = 'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38'
RAM = 3584 * resources.MIB
WORKING_DISK = 4 * resources.GIB  # Shared installs/cache plus the runner's independently bounded 2 GiB scratch.
COUNTS = ('tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo')


def local_path(value):
    """Reject synced paths and link targets before inspecting them."""
    path = Path(value)
    if not path.is_absolute() or re.search('OneDrive|CloudStorage', str(path), re.I):
        raise ValueError('Browser temp paths must be absolute and outside synced folders')
    pending, resolved, links = list(path.parts[1:]), Path('/'), 0
    while pending:
        resolved /= pending.pop(0)
        try:
            item = resolved.lstat()
        except FileNotFoundError:
            return resolved.joinpath(*pending)
        if stat.S_ISLNK(item.st_mode):
            links += 1
            target = Path(os.path.abspath(resolved.parent / os.readlink(resolved)))
            if links > 32 or re.search('OneDrive|CloudStorage', str(target), re.I):
                raise ValueError('Browser temp path link is forbidden')
            pending, resolved = list(target.parts[1:]) + pending, Path('/')
    return resolved


def native_temp_base(env):
    # tempfile may probe candidates: reject all supplied candidates before asking it.
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        if candidate := env.get(key):
            local_path(candidate)
    return local_path(tempfile.gettempdir())


def browser_root_stat(root):
    try:
        return root.lstat()
    except FileNotFoundError:
        return None


class BrowserTemps:
    """Account and recover only this batch's separately journalled Linux browser roots."""
    def __init__(self, output, source, base, outer):
        self.output, self.source = Path(output), source
        self.base, self.outer = local_path(base), Path(outer)
        self.peaks = {}

    def records(self, family=None):
        for folder in ([Path(family)] if family else sorted(self.output.glob('f*'))):
            for manifest in sorted(folder.glob('**/browser-temp-ownership/*.json')):
                if local_path(manifest) != manifest:
                    raise ValueError('Browser ownership manifest path changed')
                yield folder, manifest, resources.read_json(manifest, {})

    def validate(self, family, manifest, record):
        token = record.get('token', '')
        root = Path(record.get('root', ''))
        scratch = Path(record.get('scratch', ''))
        owner = record.get('owner_pid')
        if (record.get('schema') != 'gcsp-browser-temp/1' or not isinstance(token, str)
                or not re.fullmatch('[0-9a-f]{32}', token) or manifest.name != token + '.json'
                or record.get('source_revision') != self.source or not record.get('run_id')
                or type(owner) is not int or owner <= 0
                or record.get('state') not in ('planned', 'active', 'cleanup-pending', 'removed')
                or record.get('base') != str(self.base) or root.parent != self.base
                or root.name != 'gcsp-b-' + token or not root.is_absolute()
                or re.search('OneDrive|CloudStorage', str(root), re.I)
                or self.outer not in scratch.parents or scratch.parent != self.outer):
            raise ValueError('Invalid browser temp ownership metadata')
        registered = False
        for inner_manifest in (family / 'ownership').glob('*.json'):
            if local_path(inner_manifest) != inner_manifest:
                raise ValueError('Inner ownership manifest path changed')
            inner = resources.read_json(inner_manifest, {})
            if (inner.get('version') == 1 and inner.get('root') == str(scratch)
                    and scratch.name == 'test-stamp-shard-' + str(inner.get('token'))):
                registered = True
        if not registered:
            raise ValueError('Browser temp scratch is not registered to this family')
        if local_path(self.base) != self.base:
            raise ValueError('Native browser temp base path changed')
        return root

    def identity(self, root, record):
        item = browser_root_stat(root)
        if item is not None and (not stat.S_ISDIR(item.st_mode)
                or (item.st_dev, item.st_ino) != (record.get('device'), record.get('inode'))):
            raise ValueError('Browser temp root identity changed or is unowned')
        return item

    def sample(self):
        used = 0
        for family, manifest, record in self.records():
            root = self.validate(family, manifest, record)
            # Publication precedes mkdir; the child publishes inode/device immediately afterwards.
            if record['state'] == 'planned':
                continue
            item = self.identity(root, record)
            if record['state'] == 'removed' and item is not None:
                raise ValueError('Removed browser temp root is still present')
            amount = resources.allocated_bytes(root) if item is not None else 0
            self.peaks[str(manifest)] = max(self.peaks.get(str(manifest), 0), amount, record.get('peak_bytes', 0))
            used += amount
        return used

    @contextlib.contextmanager
    def account(self, scratch):
        original = scratch.sample

        def sample():
            amount = original() + self.sample()
            scratch.record['peak'] = max(scratch.record['peak'], amount)
            return amount

        scratch.sample = sample
        try:
            yield
        finally:
            scratch.sample = original

    def finalize(self, family=None):
        result = {'complete': True, 'allocations': [], 'leftovers': []}
        try:
            records = list(self.records(family))
        except (OSError, ValueError) as error:
            result.update(complete=False, leftovers=[{'manifest': str(family or self.output), 'reason': str(error)}])
            return result
        for folder, manifest, record in records:
            row = {'manifest': str(manifest), 'root': record.get('root'), 'cleanup': 'unverified'}
            result['allocations'].append(row)
            try:
                root = self.validate(folder, manifest, record)
                item = self.identity(root, record)
                peak = max(self.peaks.get(str(manifest), 0), record.get('peak_bytes', 0))
                if item is not None:
                    peak = max(peak, resources.allocated_bytes(root))
                    if resources.process_alive({'pid': record['owner_pid']}):
                        raise ValueError('Browser temp owner is still live or unverified')
                    cleanup = resources.read_json(folder / 'process-cleanup.json', {})
                    if cleanup.get('remaining') != []:
                        raise ValueError('Browser child process cleanup is unverified')
                    if record['state'] == 'removed':
                        raise ValueError('Removed browser temp root is still present')
                    # A launch can fail before Playwright returns a journalled browser handle.
                    # Match the existing abandoned-scratch contract: uncertain users preserve it.
                    record.update(state='cleanup-pending', peak_bytes=peak)
                    resources.atomic_json(manifest, record)
                    try:
                        opened = subprocess.run([shutil.which('lsof') or '/usr/sbin/lsof', '-t', '+D', str(root)],
                                                capture_output=True, timeout=5)
                    except (OSError, subprocess.TimeoutExpired) as error:
                        raise ValueError('Browser temp open-file status is unverified') from error
                    if opened.returncode != 1 or opened.stdout or opened.stderr:
                        raise ValueError('Browser temp has open files or uncertain status')
                    self.identity(root, record)
                    shutil.rmtree(root)
                    if os.path.lexists(root):
                        raise ValueError('Browser temp root cleanup incomplete')
                    row['cleanup'] = 'recovered'
                else:
                    row['cleanup'] = 'removed' if record['state'] == 'removed' else 'already-absent'
                row['peak_bytes'] = peak
                record.update(state='removed', peak_bytes=peak)
                resources.atomic_json(manifest, record)
            except (OSError, ValueError, TypeError) as error:
                result['complete'] = False
                result['leftovers'].append({**row, 'reason': str(error)})
        return result


def registration():
    tree = ast.parse((ROOT / 'apps/gcsp-web/e2e/run.py').read_text())
    cases = next(ast.literal_eval(node.value) for node in tree.body
                 if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                 and target.id == 'CASES' for target in node.targets))
    if tuple(cases) != FAMILIES or len(set(cases.values())) != len(FAMILIES):
        raise ValueError('Registered family union changed; reconcile the CI batch before running')
    return cases


def parse_options(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', action='store_true', help='List the selected registered families and budgets without running')
    parser.add_argument('--case', action='append', choices=FAMILIES, dest='cases',
                        help='Run this registered family; repeat to combine. Default: all 18 registered families.')
    arguments = list(sys.argv[1:] if argv is None else argv)
    # The workflow passes its optional single-family input as data, never shell source.
    if selected := os.environ.get('GCSP_BROWSER_CASE'):
        arguments.extend(['--case', selected])
    options = parser.parse_args(arguments)
    options.cases = list(dict.fromkeys(options.cases or FAMILIES))
    return options


def finish_summary(summary):
    selected = summary['selected_cases']
    executed = [row['family'] for row in summary['families']]
    summary['unrun_selected_cases'] = [family for family in selected if family not in executed]
    summary['unselected_cases'] = [family for family in FAMILIES if family not in selected]
    summary['complete'] = (executed == selected and all(row['complete'] for row in summary['families']))
    summary['full_union_complete'] = summary['complete'] and not summary['unselected_cases']
    summary['counts'] = {name: sum(row['counts'].get(name, 0) for row in summary['families']) for name in COUNTS}
    summary['green'] = (not summary['failure'] and summary['complete']
                        and all(row['green'] for row in summary['families'])
                        and summary['cleanup'].get('browser_temps', {'complete': True})['complete']
                        and summary['cleanup']['scratch_absent'])


def git_value(root, *args):
    code, output, _ = scaffold_git.git(root, list(args))
    if code:
        raise RuntimeError('Cannot read checkout identity')
    return output.strip()


def counts(text):
    values = {name: int(value) for name, value in re.findall(
        r'^(?:# |ℹ )?(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', text, re.M)}
    valid = (all(name in values for name in COUNTS) and values['tests'] > 0
             and sum(values[name] for name in ('pass', 'fail', 'cancelled', 'skipped', 'todo')) == values['tests'])
    return {'valid': valid, **values}


def family_result(output, family, source):
    receipt = resources.read_json(output / 'run-receipt.json', {})
    result = receipt.get('result', {})
    inventory = counts((output / 'suite.log').read_text(errors='replace')) if (output / 'suite.log').is_file() else {'valid': False}
    cleanup = resources.read_json(output / 'process-cleanup.json', {})
    complete = (receipt.get('source_revision') == source and receipt.get('selected_cases') == [family]
                and receipt.get('mode') == 'automated' and receipt.get('node_reference', {}).get('revision') == REFERENCE
                and receipt.get('finished') and receipt.get('scratch_removed') is True
                and receipt.get('database_dropped') is True and cleanup.get('remaining') == []
                and isinstance(result.get('rc'), int) and not result.get('issue') and inventory['valid'])
    return {'family': family, 'receipt': str(output / 'run-receipt.json'), 'complete': bool(complete),
            'counts': inventory, 'green': bool(complete and result['rc'] == 0
            and not any(inventory[name] for name in ('fail', 'cancelled', 'todo'))),
            'skips': [line[:1000] for line in (output / 'suite.log').read_text(errors='replace').splitlines()
                      if re.search(r'# SKIP|# skip|﹣|\(skipped\)', line)][:100]
                     if (output / 'suite.log').is_file() else []}


@contextlib.contextmanager
def owned_stack(scratch, env, summary, output, browser_temps):
    scratch.__enter__()
    env.update(scratch.env(env))
    env['GCSP_TEST_STACK_DIR'] = str(scratch.root / 'stack')
    try:
        with browser_temps.account(scratch):
            yield
    finally:
        # Stop the owned native cluster before removing its data, including on setup failure.
        # A refused/failed stop preserves scratch and its external manifest for investigation.
        cleanup = summary['cleanup']
        cleanup['browser_temps'] = browser_temps.finalize()
        if not cleanup['browser_temps']['complete']:
            resources.atomic_json(output / 'batch-receipt.json', summary)
            raise RuntimeError('Browser temp cleanup unverified; named roots preserved')
        cleanup['inner_scratch_manifests_removed'] = all(
            resources.read_json(path, {}).get('state') == 'removed'
            for path in output.glob('f*/ownership/*.json'))
        if not cleanup['inner_scratch_manifests_removed']:
            raise RuntimeError('Registered runner cleanup incomplete; owned scratch preserved')
        stopped = subprocess.run([sys.executable, '-B', '_tools/test_stack.py', 'pg', 'down', '--if-idle'],
                                 cwd=ROOT, env=env, capture_output=True, text=True, timeout=90)
        try:
            cleanup['postgres'] = json.loads(stopped.stdout)
        except ValueError:
            cleanup['postgres'] = {'evidence': 'unparseable'}
        if stopped.returncode or cleanup['postgres'].get('refused') or not (
                cleanup['postgres'].get('stopped') is True or cleanup['postgres'].get('reason') == 'not running'):
            resources.atomic_json(output / 'batch-receipt.json', summary)
            raise RuntimeError('Native PostgreSQL cleanup unverified; owned scratch preserved')
        scratch.__exit__(None, None, None)


def main(argv=None):
    options = parse_options(argv)
    # Always validate the entire registration, including when only one family is selected.
    cases = registration()
    coverage = 'registered-union' if set(options.cases) == set(cases) else 'registered-subset'
    plan = {'families': {family: cases[family] for family in options.cases},
            'registered_families': cases, 'selected_cases': options.cases, 'coverage_scope': coverage,
            'serial': True, 'per_family_ram_mib': 3584,
            'per_family_scratch_mib': 2048, 'per_family_seconds': 600, 'node_reference': REFERENCE,
            'aggregate_install_cache_and_scratch_mib': 4096}
    if options.plan:
        print(json.dumps(plan, indent=2))
        return 0
    if os.environ.get('GITHUB_ACTIONS') != 'true' or sys.platform != 'linux':
        raise ValueError('This adapter is for the ephemeral Linux Actions job; use the registered local runner locally')
    source = os.environ['GITHUB_SHA']
    if not re.fullmatch(r'[0-9a-f]{40}', source) or git_value(ROOT, 'rev-parse', 'HEAD') != source:
        raise ValueError('Event source pin does not match the checkout')
    if git_value(ROOT, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Source checkout must start clean')
    reference = Path(os.environ['GCSP_NODE_REFERENCE']).resolve()
    if reference == ROOT or git_value(reference, 'rev-parse', 'HEAD') != REFERENCE or git_value(reference, 'status', '--porcelain'):
        raise ValueError('Frozen reference must be a separate clean checkout at the exact pin')
    output = Path(os.environ['RUNNER_TEMP']).resolve() / ('gcsp-browser-' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT'])
    output.mkdir(exist_ok=False)
    summary_path = output / 'batch-receipt.json'
    summary = {'schema': 'gcsp-browser-ci-batch/1', 'source_revision': source, 'node_reference_revision': REFERENCE,
               'selected_cases': options.cases, 'coverage_scope': coverage,
               'plan': plan, 'started': time.time(), 'families': [], 'setup': [], 'cleanup': {},
               'covering_disposition': ('selected-family evidence only; full 18-family batch remains separate; '
                                        if coverage == 'registered-subset' else 'pending-root-batch-reconciliation; ')
                                       + 'skipped tests remain skipped'}
    native_base = native_temp_base(os.environ)
    policy = resources.Policy({'output_root': str(output), 'chunk_ram_mib': 3584, 'chunk_scratch_mib': 4096,
                               'local_scratch_reason': 'Ephemeral CI working data; no OneDrive access', 'log_mib': 2})
    scratch = resources.Scratch(output, ROOT, policy, expected=WORKING_DISK)
    browser_temps = BrowserTemps(output, source, native_base, scratch.root)
    # The external ownership manifest is written before allocation. The context is the supervisor finalizer.
    resources.atomic_json(summary_path, summary)
    env = os.environ.copy()
    env['GCSP_E2E_NATIVE_TMPDIR'] = str(native_base)
    failure = None
    try:
        with resources.handled_termination(), owned_stack(scratch, env, summary, output, browser_temps):
            env.update(GCSP_E2E_PG_MODULE=str(ROOT / 'server/node_modules/pg/lib/index.js'),
                       GCSP_NODE_REFERENCE=str(reference))
            env.pop('GCSP_HEAVY_SLOT', None)

            def command(argv, label, seconds=600, heavy=True):
                summary['current_chunk'] = label
                resources.atomic_json(summary_path, summary)
                print(json.dumps({'state': 'starting', 'chunk': label}), flush=True)
                actual = ([sys.executable, '-B', '_tools/test_stack.py', 'heavy', '--label', label,
                           '--ram-gib', '3.5', '--wait-min', '1', '--'] + argv) if heavy else argv
                result = resources.run_process(actual, ROOT, env, output / (label + '.log'), scratch,
                                               policy, WORKING_DISK, RAM, seconds)
                summary['setup'].append({'label': label, **result})
                resources.atomic_json(summary_path, summary)
                if result['rc'] or result['issue']:
                    raise RuntimeError(label + ' failed; see bounded log')
                return (output / (label + '.log')).read_text().strip()

            versions = {}
            for name, argv in {'node': ['node', '--version'], 'npm': ['npm', '--version'],
                               'java': [str(Path(env['JAVA_HOME']) / 'bin/java'), '-version'],
                               'postgres': [str(Path(env['GCSP_PG_BIN']) / 'postgres'), '--version'],
                               'chrome': [env['GCSP_E2E_BROWSER_PATH'], '--version']}.items():
                versions[name] = command(argv, 'version-' + name, 30, heavy=False)
            if versions['node'] != 'v24.22.3' or versions['npm'] != '11.19.1' or not re.search(r'version "21[.\"]', versions['java']) or not re.search(r'PostgreSQL\) 17\.', versions['postgres']):
                raise ValueError('Pinned Node/npm or required JDK/PostgreSQL major version mismatch')
            summary['environment'] = versions
            for app in ('apps/gcsp-web', 'server'):
                command([sys.executable, '-B', '_tools/test_stack_build.py', 'node', 'link', '--app', str(ROOT / app)],
                        'install-' + Path(app).name)
            for kind, variable in (('api', 'PROOF_API_JAR'), ('web', 'PROOF_WEB_BROWSER')):
                built = command([sys.executable, '-B', '_tools/test_stack_build.py', 'build', kind, '--worktree', str(ROOT)], 'build-' + kind)
                env[variable] = next(line.partition('=')[2] for line in built.splitlines() if line.startswith(variable + '='))
            for family in options.cases:
                if git_value(ROOT, 'rev-parse', 'HEAD') != source:
                    raise RuntimeError('Source identity changed between chunks')
                family_output = output / family
                env['GCSP_E2E_OUTPUT'] = str(family_output)
                summary['current_chunk'] = family
                resources.atomic_json(summary_path, summary)
                print(json.dumps({'state': 'starting', 'family': family}), flush=True)
                # Existing runner owns the 3.5 GiB heavy reservation, ten-minute chunk,
                # PostgreSQL database, journalled process cleanup and scratch finalizer.
                result = resources.run_process(['npm', '--prefix', 'apps/gcsp-web', 'run', 'test:e2e', '--', '--case', family],
                                               ROOT, env, output / (family + '-launcher.log'), scratch, policy,
                                               WORKING_DISK, RAM, 690)
                record = family_result(family_output, family, source)
                record['browser_temps'] = browser_temps.finalize(family_output)
                record['complete'] = record['complete'] and record['browser_temps']['complete']
                record['launcher'] = result
                record['green'] = record['green'] and record['complete'] and result['rc'] == 0 and not result['issue']
                summary['families'].append(record)
                resources.atomic_json(summary_path, summary)
                print(json.dumps({'family': family, 'complete': record['complete'], 'green': record['green'], 'counts': record['counts']}), flush=True)
                if not record['complete'] or result['issue']:
                    raise RuntimeError(family + ' has incomplete evidence or cleanup; later chunks unrun')
    except BaseException as error:
        failure = type(error).__name__ + ': ' + str(error)[:400]
    finally:
        # All run_process children have joined before this cleanup. The runner owns each database.
        # The owned_stack finalizer stops the cluster before Scratch removes its data.
        for app in ('apps/gcsp-web', 'server'):
            link = ROOT / app / 'node_modules'
            if link.is_symlink() and str(link.readlink()).startswith(str(scratch.root) + '/'):
                link.unlink()
        summary['failure'] = failure
        summary['finished'] = time.time()
        summary['cleanup']['scratch_absent'] = not os.path.lexists(scratch.root)
        summary['cleanup']['ownership_manifest'] = str(scratch.manifest)
        finish_summary(summary)
        resources.atomic_json(summary_path, summary)
    print(json.dumps({key: summary[key] for key in ('selected_cases', 'coverage_scope', 'complete',
                     'full_union_complete', 'green', 'counts')} | {'receipt': str(summary_path)}))
    return 0 if summary['green'] else 1


if __name__ == '__main__':
    sys.exit(main())
