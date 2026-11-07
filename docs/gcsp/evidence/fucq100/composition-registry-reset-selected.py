"""Exact, once-only registry/reset variant of the reviewed F100 selected lifecycle.

No implicit/full execution path. The existing targeted stamp retains code/input
identity semantics; its command adapter uses one explicitly owned reservation,
the exact admitted Node argv and the existing strict launch/module guards.
"""
import atexit
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import shlex
import signal
import subprocess
import sys
import time
import types

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PLAN = HERE / 'composition-registry-reset-plan-2026-11-06.json'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


def identity(path, expected):
    path = Path(path); st = path.stat()
    if sha(path) != expected['sha256'] or (st.st_dev, st.st_ino) != (expected['device'], expected['inode']) \
            or str(path.resolve()) != expected['realpath'] or path.is_symlink() != expected['symlink']:
        raise RuntimeError('Physical identity drift: ' + str(path))


def main():
    if len(sys.argv) != 7 or sys.argv[1] != 'registry-reset' \
            or any(not re.fullmatch('[a-f0-9]{64}', value) for value in (sys.argv[2], sys.argv[4], sys.argv[6])):
        raise RuntimeError('Use registry-reset, exact plan SHA, execution review path/SHA and separate grant path/SHA')
    chunk = sys.argv[1]; started = time.monotonic(); total_deadline = started + 180
    if sha(PLAN) != sys.argv[2]: raise RuntimeError('Unreviewed registry/reset plan')
    plan = json.loads(PLAN.read_text())
    grant_path = Path(sys.argv[5])
    if not grant_path.is_absolute() or sha(grant_path) != sys.argv[6]:
        raise RuntimeError('Separate execution grant missing or changed')
    grant = json.loads(grant_path.read_text())
    run = Path(plan['records']) / chunk
    if plan.get('executionAuthorised') is not False or grant.get('executionAuthorised') is not True \
            or grant.get('scope') != 'FUCQ-100 registry/reset two cases' \
            or grant.get('planSHA256') != sys.argv[2] or grant.get('commandSHA256') != plan['commandSHA256'] \
            or grant.get('records') != str(run) or not re.fullmatch('fucq100-registry-reset-[a-zA-Z0-9_.-]+', grant.get('grantId', '')):
        raise RuntimeError('No exact separate once-only registry/reset execution grant')
    selection = {'grant': grant['grantId'], 'command': plan['command'], 'counts': plan['expectedCounts'],
                 'excludedCaseCounts': plan['allowedExplicitExclusionCounts'],
                 'selectedTitles': plan['selectedTitles'], 'excludedTitles': plan['excludedTitles']}
    if len(selection['selectedTitles']) != 2 or len(selection['excludedTitles']) != 5 \
            or selection['counts'] != {'tests': 2, 'pass': 2, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}:
        raise RuntimeError('Exact two-case selection changed')
    run.mkdir(parents=True, exist_ok=False)
    provisional = run / 'provisional.json'; receipt_path = run / 'receipt.json'
    scratch = host = c = r = joined = None
    final = False; errors = []; result = None; failure = None; counts = {}; source_ok = False; base_samples = []
    state = {'schemaVersion': 1, 'chunk': chunk, 'grant': selection['grant'], 'pid': os.getpid(),
             'phase': 'intent before first probe', 'planSHA256': sys.argv[2], 'scratch': None,
             'selectionLaunched': False, 'actualRuntimeRequested': False, 'limits': plan['limits'], 'run': str(run),
             'grantPath': str(grant_path), 'grantSHA256': sys.argv[6]}
    def persist(path, value):
        data = (json.dumps(value, indent=2) + '\n').encode()
        other = sum(p.stat().st_size for p in run.rglob('*.json') if p != path)
        if len(data) + other > 262144: raise RuntimeError('Combined receipt headroom exceeded')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.tmp')
        with temporary.open('wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    def save(): persist(provisional, state)
    def finalize():
        nonlocal final
        if final: return
        final = True
        if scratch is not None and host is not None:
            try:
                if not os.path.lexists(scratch.root) and joined(scratch) and c.await_owned_absence(scratch.record):
                    status = host.reservation_state(scratch.token)
                    if status['binding_owned'] and not status['released']:
                        try: host.update(scratch.token, r.allocated_bytes(run), max(row['rss'] for row in base_samples))
                        except BaseException as exc: errors.append(type(exc).__name__ + ': ' + str(exc))
                        host.release(scratch.token)
            except BaseException as exc: errors.append(type(exc).__name__ + ': ' + str(exc))
        save()
    save(); atexit.register(finalize)
    def hard_stop(number, frame):
        # Absolute total deadline also covers final cleanup/output. Never claim
        # a cleanup result on hard expiry; leave exact manifest/token charged.
        if scratch is not None:
            state['selectionLaunched'] = state['actualRuntimeRequested'] and any(row.get('kind') == 'selected-command' and row.get('pid') for row in scratch.record.get('launches', []))
        state.update(phase='180 second hard deadline', cleanup='uncertain; inspect named manifest/token')
        try: save()
        finally: os._exit(124)
    signal.signal(signal.SIGALRM, hard_stop); signal.setitimer(signal.ITIMER_REAL, 180)
    try:
        review = Path(sys.argv[3])
        if sha(review) != sys.argv[4]: raise RuntimeError('Independent review drift')
        review_text = review.read_text()
        if 'Verdict: PASS' not in review_text or 'Execution admission: PASS' not in review_text \
                or sys.argv[2] not in review_text or selection['grant'] not in review_text or sys.argv[6] not in review_text:
            raise RuntimeError('Independent exact execution review has not passed; source-only PASS cannot launch')
        for p, value in plan['helperHashes'].items():
            if sha(p) != value: raise RuntimeError('Helper drift: ' + p)
        if sha(grant_path) != sys.argv[6]: raise RuntimeError('Separate grant drift')
        static_catalogue = module('registry_static_catalogue', HERE / 'local-https-catalogue.py')
        def unchanged():
            if sha(PLAN) != sys.argv[2] or sha(review) != sys.argv[4] \
                    or sha(grant_path) != sys.argv[6]:
                raise RuntimeError('Final frozen plan/review/grant/topology drift')
            for p, value in plan['helperHashes'].items():
                if sha(p) != value: raise RuntimeError('Final helper drift: ' + p)
            for p, value in plan['sources'].items():
                if sha(ROOT / p) != value: raise RuntimeError('Source/input drift: ' + p)
            for p, value in plan['reviewedProductTest'].items():
                if sha(ROOT / p) != value: raise RuntimeError('Reviewed product/test drift: ' + p)
            for p, members in plan['directories'].items():
                actual = sorted(str(q.relative_to(ROOT)) for q in (ROOT / p).rglob('*') if q.is_file())
                if actual != sorted(members): raise RuntimeError('Input directory membership drift: ' + p)
            if sha(plan['installedPath']) != plan['installedSHA256']: raise RuntimeError('Installed inventory drift')
            installed = json.loads(Path(plan['installedPath']).read_text())
            for p, row in installed['files'].items(): identity(p, row)
            for row in installed['packages']:
                st = Path(row['path']).stat()
                if (st.st_dev, st.st_ino) != (row['device'], row['inode']): raise RuntimeError('Installed package root drift')
                actual = {str(p) for p in Path(row['path']).rglob('*') if p.is_file()}
                expected = {p for p in installed['files'] if p.startswith(row['path'] + '/')}
                if actual != expected: raise RuntimeError('Installed package namespace drift')
            for row in installed['absent_optional']:
                if any(Path(p).exists() for p in row['paths']): raise RuntimeError('Optional resolution drift')
            for p, row in plan['executables'].items(): identity(p, row)
            for p, row in plan['nativeClosure']['files'].items(): identity(p, row)
            identity(plan['nativeClosure']['platformPath'], plan['nativeClosure']['platform'])
            # Re-resolve actual load coordinates, including Homebrew opt aliases
            # and earlier rpath candidates, rather than trusting old realpaths.
            if static_catalogue.native_closure(plan['executables']) != plan['nativeClosure']:
                raise RuntimeError('Native load-coordinate/rpath resolution drift')
            if '-'.join((os.uname().sysname, os.uname().release, os.uname().machine)) != plan['platformDescriptor']:
                raise RuntimeError('Physical platform descriptor drift')
            return installed
        installed = unchanged()
        base = module('registry_base', HERE / 'runtime-composition-supervisor.py')
        c = module('registry_lifecycle', base.BASE_RUNNER); base.install_strict_pid_probe(c)
        r = c.resources; base.install_strict_budget(r)
        class AllRows(r.HostBudget):
            def _capacity(self, rows, free, memory):
                if type(memory) is not int or memory < 0: raise r.ResourceError('Unknown physical host memory')
                disk = sum(max(row['disk'], row['used']) for row in rows.values())
                ram = sum(max(row['ram'], row['rss']) for row in rows.values())
                value = {'free': free, 'physicalMemory': memory, 'disk': max(0, free - self.policy.reserve - disk),
                         'ram': max(0, memory - int(self.policy.ram_reserve_mib * r.MIB) - ram),
                         'rawRows': rows, 'chargedDisk': disk, 'chargedRam': ram,
                         'active': len(rows), 'low': free < self.policy.preferred, 'parent': None}
                state['lockedAdmission'] = value; save()
                return value
        r.HostBudget = AllRows
        launch = module('registry_launch', base.LAUNCH); original_joined = launch.install(c, plan['executables'])
        base_samples = original_joined.samples
        joined = original_joined
        def charge():
            # Reuse the corrected supervisor's completed direct-child lifetime charge.
            # There is no certificate/native command in this selection.
            direct_peak = int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
            if direct_peak < 0: raise r.ResourceError('Unknown direct-child native RSS')
            scratch.record['direct_child_peak_rss'] = direct_peak
            return direct_peak
        budget_class = r.HostBudget
        class Charged(budget_class):
            def update(self, token, used, rss):
                total = rss + charge()
                scratch.record['aggregate_peak_rss'] = max(scratch.record.get('aggregate_peak_rss', 0), total)
                r.atomic_json(scratch.manifest, scratch.record)
                if total > 768 * r.MIB: raise r.ResourceError('Aggregate RSS including completed direct-child peaks exceeded')
                return super().update(token, used, total)
        r.HostBudget = Charged
        policy = r.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 0.25})
        host = r.HostBudget(policy)
        scratch_class = c.SafeScratch
        class Measured(scratch_class):
            def sample(self):
                used = super().sample() + r.allocated_bytes(run)
                log_bytes = sum(p.stat().st_size for p in run.rglob('*') if p.is_file() and p.suffix in ('.log', '.jsonl'))
                log_bytes += sum(p.stat().st_size for p in self.root.glob('*') if p.is_file() and p.suffix in ('.log', '.jsonl'))
                receipt_bytes = sum(p.stat().st_size for p in run.rglob('*.json') if p.is_file())
                if used > 128 * r.MIB or log_bytes > 2 * r.MIB or receipt_bytes > 262144:
                    raise r.ResourceError('Combined owned disk/log/receipt budget exceeded')
                self.record['peak'] = max(self.record['peak'], used)
                self.record['combined_log_peak'] = max(self.record.get('combined_log_peak', 0), log_bytes)
                charge()
                return used
            def __exit__(self, *args):
                charge()
                return super().__exit__(*args)
        scratch = Measured(run, ROOT, policy, expected=2 * r.MIB, checkpoint=receipt_path)
        state.update(scratch=str(scratch.root), manifest=str(scratch.manifest), reservationToken=scratch.token,
                     phase='manifest before reservation/allocation')
        scratch.record['retained_outputs'] = {str(scratch.root / n): str(run / n) for n in ('raw.log', 'esm-modules.jsonl', 'cjs-modules.jsonl')}
        r.atomic_json(scratch.manifest, scratch.record); save()
        g = module('registry_git', ROOT / '_tools/scaffold_git.py')
        metadata_index = 0
        def owned_git_run(argv, capture_output=True, text=True, input=None):
            nonlocal metadata_index
            if not capture_output or not text or input is not None or argv[:2] != ['git', '-C'] or Path(argv[2]) != ROOT:
                raise RuntimeError('Unexpected scaffold Git invocation')
            metadata_index += 1
            log = scratch.root / ('metadata-%03d.log' % metadata_index)
            before = len(scratch.record.get('launches', []))
            try:
                answer = r.run_process(['/usr/bin/git', *argv[1:]], ROOT,
                    {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': '/Users/garycarter', 'LC_ALL': 'C'},
                    log, scratch, policy, allocation['disk'], allocation['ram'],
                    min(10, max(0.1, total_deadline - time.monotonic() - 45)), host)
                output = log.read_text()
                if answer['issue']: raise RuntimeError('Owned metadata Git refused: ' + answer['issue'])
                return subprocess.CompletedProcess(argv, answer['rc'], output, output if answer['rc'] else '')
            finally:
                for row in scratch.record.get('launches', [])[before:]:
                    if row['kind'] == 'selected-command': row['kind'] = 'metadata-git'
                r.atomic_json(scratch.manifest, scratch.record)
        g.subprocess = types.SimpleNamespace(run=owned_git_run)
        def git(args):
            with g.checkout_mutex(ROOT): code, out, err = g.git(ROOT, args)
            if code: raise RuntimeError('Scaffold Git read refused: ' + err[:1000])
            return out.strip()
        # One reservation owns metadata and the selected worker serially. Git
        # processes use the same retained-handle/recursive-group lifecycle.
        allocation = host.acquire(scratch.token, 128 * r.MIB, 768 * r.MIB, ROOT, root=scratch.root,
                                  minimum_disk=128 * r.MIB, minimum_ram=768 * r.MIB)
        with r.handled_termination(), scratch:
            branch = git(['branch', '--show-current'])
            head = git(['rev-parse', 'HEAD']); upstream = git(['rev-parse', '@{upstream}'])
            remote = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/' + branch]).split()[0]
            if git(['status', '--porcelain', '--untracked-files=normal']) or head != upstream or head != remote:
                raise RuntimeError('Clean HEAD/upstream/live-remote gate refused')
            changed = git(['diff', '--name-only', plan['productCheckpoint'], head]).splitlines()
            if any(p not in plan['publicationPaths'] for p in changed):
                raise RuntimeError('Consequential delta after product review')
            state.update(head=head, upstream=upstream, liveRemote=remote, review=str(review), reviewSHA256=sys.argv[4]); save()
            # Deliberate allowlist: deployed/database/trust/injection credentials never enter child environment.
            env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': '/Users/garycarter', 'LC_ALL': 'C', 'TZ': 'Europe/London'}
            env = scratch.env(env)
            stamp = module('registry_targeted', ROOT / '_tools/test_stamp.py')
            # Python platform.platform() shells out to uname/file on Darwin.
            # Use the actual frozen syscall/OS-file platform identity instead.
            stamp.platform = types.SimpleNamespace(platform=lambda: plan['platformDescriptor'],
                                                   python_version=lambda: sys.version.split()[0])
            stamp._atomic_write_json = lambda path, value: persist(Path(path), value)
            stamp._git = lambda root, args: git(list(args))
            def ref_exists(root, ref):
                with g.checkout_mutex(ROOT): code, _, _ = g.git(ROOT, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])
                return code == 0
            stamp.ref_exists = ref_exists
            command = shlex.join(selection['command'])
            def selected_command(st, requested, env_extra, rdir, say=print, dry_run=False, args=None, identity=None):
                nonlocal result, counts, source_ok
                if requested != command or dry_run: raise RuntimeError('Unexpected targeted command/dry execution')
                # Fresh physical source/dependency/executable identities immediately before locked admission.
                unchanged()
                fresh = host.headroom(ROOT)
                if not host.reservation_state(scratch.token)['binding_owned'] \
                        or fresh['physicalMemory'] < int(policy.ram_reserve_mib * r.MIB) + fresh['chargedRam'] \
                        or fresh['free'] < policy.reserve + fresh['chargedDisk']:
                    raise RuntimeError('Fresh locked physical admission no longer supports every raw reservation plus reserves')
                files = {str(ROOT / p): {'sha256': value, 'device': (ROOT / p).stat().st_dev,
                         'inode': (ROOT / p).stat().st_ino, 'realpath': str((ROOT / p).resolve())} for p, value in plan['sources'].items()}
                for p, value in plan['helperHashes'].items():
                    files[p] = {'sha256': value, 'device': Path(p).stat().st_dev, 'inode': Path(p).stat().st_ino, 'realpath': str(Path(p).resolve())}
                files.update(installed['files'])
                seconds = min(120, total_deadline - time.monotonic() - 45)
                if seconds < 10: raise RuntimeError('Insufficient finite work/cleanup envelope')
                config = scratch.root / 'admission.json'
                config.write_text(json.dumps({'files': files, 'parentURL': ROOT.as_uri() + '/',
                    'entries': {'pg': str(base.PG_ENTRY), 'jsdom': str(base.JSDOM_ENTRY)},
                    'esmJournal': str(scratch.root / 'esm-modules.jsonl'), 'cjsJournal': str(scratch.root / 'cjs-modules.jsonl')}, separators=(',', ':')))
                env.update(FUCQ100_COMPOSITION_CONFIG=str(config), FUCQ100_COMPOSITION_CONFIG_SHA256=sha(config))
                state.update(phase='exact selected launch', configSHA256=sha(config),
                             environmentSHA256=hashlib.sha256(json.dumps(env, sort_keys=True).encode()).hexdigest())
                persist(run / 'execution.json', {'command': selection['command'], 'environment': env,
                    'head': head, 'planSHA256': sys.argv[2], 'configSHA256': sha(config),
                    'clock': {'supervisorStartMonotonic': started, 'currentMonotonic': time.monotonic(), 'currentEpochMs': round(time.time() * 1000), 'workSeconds': seconds}})
                save()
                state['actualRuntimeRequested'] = True; save()
                result = r.run_process(selection['command'], ROOT, env, scratch.root / 'raw.log', scratch, policy,
                    allocation['disk'], allocation['ram'], seconds, host)
                state['selectionLaunched'] = any(row.get('kind') == 'selected-command' and row.get('pid') for row in scratch.record['launches'])
                host.update(scratch.token, scratch.sample(), max(row['rss'] for row in base_samples))
                result['peak_rss'] = scratch.record['aggregate_peak_rss']
                raw = (scratch.root / 'raw.log').read_text()
                counts = c.parse_counts(raw)
                executed = re.findall(r'(?m)^ok \d+ - (.+?)(?: #.*)?$', raw)
                skipped = re.findall(r'(?m)^ok \d+ - (.+?) # SKIP.*$', raw)
                actual_titles = [title for title in executed if title not in skipped]
                good_tap = (counts == selection['counts'] and not skipped) or (
                    counts == selection['excludedCaseCounts'] and sorted(skipped) == sorted(selection['excludedTitles']))
                source_ok = bool(unchanged())
                ok = result['rc'] == 0 and not result['issue'] and good_tap \
                    and actual_titles == selection['selectedTitles'] and source_ok
                if not ok: result['issue'] = result['issue'] or 'Exact registry/reset TAP/title/source acceptance failed'
                return ok, counts.get('pass', 0) + counts.get('skipped', 0), counts.get('skipped', 0), result['wall']
            stamp.run_command = selected_command
            # The adapter above owns the single reservation and actual launch. All
            # standard targeted identity/zero-check/full-stamp exclusions stay intact.
            os.environ.clear(); os.environ.update(env)
            os.environ['TEST_STAMP_DIR'] = str(run / 'targeted')
            cli = ['--root', str(ROOT), '--jobs', '1', '--targeted', plan['productCheckpoint'], '--command', command,
                   '--reason', 'Exact registry/reset two-case selection ' + selection['grant'] + '; eight-handler memoization/startup and mechanics-reset authority only. Other composition/lifecycle/consumer, HTTPS/browser/native/live/full checks excluded.']
            code = stamp.main(cli)
            proofs = list((run / 'targeted').glob('targeted-*.json'))
            if len(proofs) != 1: raise RuntimeError('Exact targeted evidence missing or ambiguous')
            proof = json.loads(proofs[0].read_text())
            if proof.get('scope') != 'targeted' or proof.get('result') != 'passed' or proof.get('head') != head or proof.get('commands') != [command]:
                raise RuntimeError('Targeted identity/evidence mismatch')
            unchanged()
            if code: failure = 'Targeted validation returned ' + str(code)
    except BaseException as exc:
        failure = type(exc).__name__ + ': ' + str(exc)
    finally:
        if scratch is not None:
            state['selectionLaunched'] = bool(state['selectionLaunched'] or state['actualRuntimeRequested'] and any(row.get('kind') == 'selected-command' and row.get('pid') for row in scratch.record.get('launches', [])))
        finalize()
        cleanup = {'scratchAbsent': scratch is not None and not os.path.lexists(scratch.root),
                   'groupsAbsent': False, 'pidsAbsent': False, 'joined': False, 'openFilesAbsent': False, 'reservationAbsent': False}
        if scratch is not None:
            try:
                cleanup.update(groupsAbsent=c.all_groups_absent(scratch.record), pidsAbsent=c.all_owned_pids_absent(scratch.record),
                    joined=joined(scratch), openFilesAbsent=bool(scratch.record.get('open_files_absent')),
                    reservationAbsent=host.reservation_state(scratch.token)['absent'] and not errors)
            except BaseException as exc: errors.append(type(exc).__name__ + ': ' + str(exc))
        passed = bool(result and result['rc'] == 0 and not result['issue'] and not failure and not errors
                      and source_ok and all(cleanup.values()) and state['selectionLaunched'])
        summary = {'schemaVersion': 1, 'scope': 'targeted registry/reset two cases only', 'chunk': chunk, 'grant': selection['grant'],
                   'grantPath': str(grant_path), 'grantSHA256': sys.argv[6],
                   'planSHA256': sys.argv[2], 'review': str(sys.argv[3]), 'reviewSHA256': sys.argv[4],
                   'head': state.get('head'), 'passed': passed, 'result': result, 'counts': counts,
                   'failure': failure, 'cleanup': cleanup, 'cleanupErrors': errors, 'sourceUnchanged': source_ok,
                   'selectionLaunched': state['selectionLaunched'], 'manifest': state.get('manifest'),
                   'reservationToken': state.get('reservationToken'), 'elapsedSeconds': time.monotonic() - started}
        persist(receipt_path, summary)
        state.update(phase='complete' if passed else 'stopped', receipt=str(receipt_path), passed=passed); save()
        signal.setitimer(signal.ITIMER_REAL, 0)
        print(json.dumps(summary))
    return 0 if passed else 1


if __name__ == '__main__': sys.exit(main())
