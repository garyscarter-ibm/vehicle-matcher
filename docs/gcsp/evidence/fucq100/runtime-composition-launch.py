"""Owned launch adapter; imported only after frozen helper hashes are admitted.

Static review repair: bind every ledger mutation, anchor every group signal,
retain distinct PID/start histories, protect bounded direct joins, check open
files before deletion, and count the supervisor plus its complete child family.
No runtime/fault reproduction accompanies this authoring change.
"""
import contextlib
import hashlib
import os
from pathlib import Path
import selectors
import signal
import subprocess
import threading
import time


def install(helpers, executables):
    resources = helpers.resources
    cancellation = threading.Event()
    base_scratch = helpers.SafeScratch
    instances, samples = {}, []
    supervisor = {'pid': os.getpid(), 'start': resources.process_identity(os.getpid())}
    if not isinstance(supervisor['start'], str) or not supervisor['start'].strip():
        raise resources.ResourceError('Cannot bind launching supervisor PID/start')

    def persist(scratch):
        resources.atomic_json(scratch.manifest, scratch.record)

    def joined(scratch):
        return all(row.get('state') == 'joined' for row in scratch.record.get('launches', []))

    def remember(scratch, pid, start, group):
        # A reused PID is a new identity. Never replace or coalesce its history
        # merely because the numeric PID was seen before.
        rows = scratch.record.setdefault('owned_pids', [])
        if not any(row['pid'] == pid and row.get('start') == start for row in rows):
            rows.append({'pid': pid, 'start': start, 'pgid': group})
        if isinstance(start, str) and start.strip() and group != os.getpgrp() and group not in scratch.record['groups']:
            scratch.record['groups'].append(group)

    def remaining(deadline):
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise resources.ResourceError('Open-file probe timeout')
        return seconds

    def deadline_query(arguments, deadline):
        # These are the same ps interfaces as the shared probes, but each
        # subprocess receives only the remaining work budget. Never reset a
        # separate three-second allowance for each recorded identity.
        try:
            result = subprocess.run(['/bin/ps', *arguments], capture_output=True, text=True,
                                    timeout=min(3, remaining(deadline)))
        except subprocess.TimeoutExpired as exc:
            raise resources.ResourceError('Open-file process query timeout') from exc
        remaining(deadline)
        return result

    def process_identity(pid, deadline=None):
        if deadline is None:
            return resources.process_identity(pid)
        result = deadline_query(['-p', str(pid), '-o', 'lstart='], deadline)
        return result.stdout.strip() if result.returncode == 0 else None

    def process_snapshot(deadline=None):
        if deadline is None:
            return helpers.process_snapshot()
        result = deadline_query(['-axo', 'pid=,ppid=,pgid=,rss=,stat='], deadline)
        if result.returncode != 0 or result.stderr or not result.stdout.strip():
            raise resources.ResourceError('Cannot establish process ownership snapshot')
        rows = []
        for line in result.stdout.splitlines():
            remaining(deadline)
            parts = line.split()
            if len(parts) != 5 or not all(part.isascii() and part.isdigit() for part in parts[:4]):
                raise resources.ResourceError('Unparseable process ownership snapshot')
            rows.append({'pid': int(parts[0]), 'ppid': int(parts[1]), 'pgid': int(parts[2]),
                         'rss': int(parts[3]) * 1024, 'stat': parts[4]})
        return rows

    def capture(scratch, deadline=None):
        rows = process_snapshot(deadline)
        by_pid = {row['pid']: row for row in rows}
        root = by_pid.get(supervisor['pid'])
        if root is None or process_identity(supervisor['pid'], deadline) != supervisor['start']:
            raise resources.ResourceError('Launching supervisor identity is uncertain')
        selected = {supervisor['pid']}
        uncertain = set()
        starts = {}
        # Include detached recorded children only when their saved identity is
        # freshly verified. Unknown identities remain charged conservatively.
        for record in scratch.record.get('owned_pids', []):
            pid = record['pid']
            if pid not in by_pid:
                continue
            expected = record.get('start')
            if pid not in starts:
                starts[pid] = process_identity(pid, deadline)
            current = starts[pid]
            if isinstance(expected, str) and expected.strip() and current == expected:
                selected.add(pid)
            elif not isinstance(expected, str) or not expected.strip() or current is None:
                uncertain.add(pid)
        while True:
            if deadline is not None:
                remaining(deadline)
            expanded = selected | {row['pid'] for row in rows if row['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        # Only a live, verified child can anchor its group. Historical numeric
        # groups alone never make a process an owned child.
        for pid in selected - {supervisor['pid']}:
            row = by_pid[pid]
            if pid not in starts:
                starts[pid] = process_identity(pid, deadline)
            remember(scratch, pid, starts[pid], row['pgid'])
        accounted = [row for row in rows if row['pid'] in selected | uncertain]
        rss = sum(row['rss'] for row in accounted)
        samples.append({'at': time.time(), 'members': len(accounted), 'rss': rss,
                        'supervisor_rss': root['rss'],
                        'direct_children': [row['pid'] for row in accounted if row['ppid'] == supervisor['pid']],
                        'uncertain_pids_charged': sorted(uncertain)})
        scratch.record['rss_basis'] = 'launching supervisor and recursive child family, including then-active direct probes; unknown retained identities charged'
        scratch.record['aggregate_peak_rss'] = max(scratch.record.get('aggregate_peak_rss', 0), rss)
        persist(scratch)
        if deadline is not None:
            remaining(deadline)
        if rss > scratch.record.get('ram_limit', 768 * resources.MIB):
            raise resources.ResourceError('Supervisor/direct-probe/recursive aggregate RSS budget exceeded')
        return rss

    def group_signal(scratch, group, signum):
        if type(group) is not int or group <= 0 or group == os.getpgrp():
            raise resources.ResourceError('Shared/invalid process group refused')
        rows = helpers.process_snapshot()
        members = {row['pid']: row for row in rows if row['pgid'] == group and 'Z' not in row['stat']}
        if not members:
            return
        anchor = None
        for record in scratch.record.get('owned_pids', []):
            pid, expected = record['pid'], record.get('start')
            if pid not in members or not isinstance(expected, str) or not expected.strip():
                continue
            if resources.process_identity(pid) != expected:
                continue
            try:
                if os.getpgid(pid) != group:
                    continue
            except ProcessLookupError:
                continue
            anchor = {'pid': pid, 'start': expected}
            break
        if anchor is None:
            raise resources.ResourceError('No fresh PID/start anchor for retained group ' + str(group))
        try:
            os.killpg(group, signum)
            outcome = 'sent'
        except ProcessLookupError:
            outcome = 'absent'
        scratch.record.setdefault('signals', []).append(
            {'group': group, 'signal': int(signum), 'anchor': anchor, 'at': time.time(), 'outcome': outcome})
        persist(scratch)

    def stop_groups(scratch, groups=None):
        errors = []
        try:
            capture(scratch)
        except BaseException as exc:
            errors.append(exc)
        selected = list(scratch.record['groups'] if groups is None else groups)
        for signum in (signal.SIGTERM, signal.SIGKILL):
            for group in reversed(selected):
                try:
                    group_signal(scratch, group, signum)
                except BaseException as exc:
                    errors.append(exc)
            if signum == signal.SIGTERM:
                time.sleep(0.25)
        if errors:
            raise resources.ResourceError('Anchored group teardown error: ' + type(errors[0]).__name__ + ': ' + str(errors[0]))

    def direct_kill(scratch, process, row):
        expected = row.get('start')
        if process.poll() is not None:
            return
        if not isinstance(expected, str) or not expected.strip() or resources.process_identity(process.pid) != expected:
            raise resources.ResourceError('Direct-handle PID/start is uncertain; no signal sent')
        process.send_signal(signal.SIGKILL)
        scratch.record.setdefault('signals', []).append({'pid': process.pid, 'signal': int(signal.SIGKILL),
            'anchor': {'pid': process.pid, 'start': expected}, 'at': time.time(), 'outcome': 'direct-handle-sent'})
        persist(scratch)

    def finish_handle(scratch, process, row, streams, groups=None):
        errors = []
        pid = getattr(process, 'pid', None)
        try:
            if type(pid) is not int or pid <= 0:
                row['state'] = 'uncertain-no-pid'
                raise resources.ResourceError('Child creation has no established direct handle PID')
            try:
                # Adoption queries and group signalling are inside the same
                # protected region: none can bypass the bounded direct join.
                if process.poll() is None and not row.get('start'):
                    row['start'] = resources.process_identity(pid)
                remember(scratch, pid, row.get('start'), pid)
                if pid not in scratch.record['groups']:
                    scratch.record['groups'].append(pid)
                stop_groups(scratch, groups)
            except BaseException as exc:
                errors.append(exc)
            finally:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        direct_kill(scratch, process, row)
                    except BaseException as exc:
                        errors.append(exc)
                    finally:
                        try:
                            process.wait(timeout=5)
                        except BaseException as exc:
                            errors.append(exc)
                except BaseException as exc:
                    errors.append(exc)
            try:
                absent = helpers.await_owned_absence(scratch.record)
            except BaseException as exc:
                absent = False
                errors.append(exc)
            if process.returncode is None or not absent:
                row['state'] = 'uncertain-not-joined'
                errors.append(resources.ResourceError('Owned child/group absence is not proven'))
            else:
                row.update(state='joined', pid=pid)
        finally:
            # Stream closure is also protected from every signal/query/join error.
            for stream in streams:
                if stream is not None:
                    try:
                        stream.close()
                    except BaseException as exc:
                        errors.append(exc)
            try:
                persist(scratch)
            except BaseException as exc:
                errors.append(exc)
        if errors:
            raise resources.ResourceError('Bounded handle cleanup error: ' + type(errors[0]).__name__ + ': ' + str(errors[0]))

    def verify_executable(path):
        row = executables[str(path)]
        stat = path.stat()
        if path.is_symlink() != row['symlink'] or str(path.resolve()) != row['realpath'] \
            or (stat.st_dev, stat.st_ino) != (row['device'], row['inode']) \
            or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise resources.ResourceError('Pinned cleanup executable changed')

    def open_files_absent(scratch):
        path = Path('/usr/sbin/lsof')
        verify_executable(path)
        # Pin the directory before the probe and let shared Scratch recheck it
        # immediately before deletion as well.
        stat = scratch.root.lstat()
        if scratch.root.is_symlink() or (stat.st_dev, stat.st_ino) != (scratch.record['device'], scratch.record['inode']):
            raise resources.ResourceError('Owned scratch identity changed')
        row = {'kind': 'open-file-probe', 'state': 'creating', 'pid': None, 'start': None}
        scratch.record.setdefault('launches', []).append(row)
        persist(scratch)
        process = subprocess.Popen.__new__(subprocess.Popen)
        process._composition_row = row
        scratch.__dict__.setdefault('_composition_handles', []).append(process)
        output_bytes = {'stdout': 0, 'stderr': 0}
        deadline = time.monotonic() + 5
        try:
            subprocess.Popen.__init__(process, [str(path), '-t', '+D', str(scratch.root)], env=scratch.env(os.environ),
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            row.update(state='registered', pid=process.pid, start=process_identity(process.pid, deadline))
            remember(scratch, process.pid, row['start'], process.pid)
            persist(scratch)
            with selectors.DefaultSelector() as selector:
                for name in output_bytes:
                    stream = getattr(process, name)
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, name)
                next_sample = time.monotonic()
                while selector.get_map() or process.poll() is None:
                    for key, _ in selector.select(timeout=min(0.1, remaining(deadline))):
                        # One extra byte detects overflow; no communicate() or
                        # buffered read may collect unbounded child output.
                        allowance = 8192 - sum(output_bytes.values())
                        try:
                            data = os.read(key.fd, min(4096, allowance + 1))
                        except BlockingIOError:
                            continue
                        output_bytes[key.data] += len(data)
                        if sum(output_bytes.values()) > 8192:
                            raise resources.ResourceError('Open-file probe output bound')
                        if not data:
                            selector.unregister(key.fileobj)
                    remaining(deadline)
                    if time.monotonic() >= next_sample:
                        capture(scratch, deadline)
                        next_sample = time.monotonic() + 0.1
            remaining(deadline)
            if process.returncode != 1 or any(output_bytes.values()):
                raise resources.ResourceError('Open-file absence is unproven; scratch preserved')
        finally:
            # The five-second work deadline never bypasses protected teardown
            # and its existing independent bounded direct-handle joins.
            finish_handle(scratch, process, row, [getattr(process, 'stdout', None), getattr(process, 'stderr', None)],
                          groups=[process.pid] if type(getattr(process, 'pid', None)) is int else [])
        scratch.record['open_files_absent'] = {'executable': str(path), 'sha256': executables[str(path)]['sha256'],
                                               'returncode': 1, 'stdout_bytes': 0, 'stderr_bytes': 0}
        persist(scratch)

    class OwnedScratch(base_scratch):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.record['supervisor'] = dict(supervisor)
            instances[self.token] = self

        def __exit__(self, kind, value, tb):
            for source, target in self.record.get('retained_outputs', {}).items():
                source, target = Path(source), Path(target)
                if source.parent != self.root or target.parent != self.manifest.parent.parent:
                    raise resources.ResourceError('Invalid retained output ownership')
                if source.exists():
                    limit = 262144 if source.suffix == '.log' else 524288
                    with source.open('rb') as stream:
                        data = stream.read(limit + 1)
                    if len(data) > limit:
                        data = data[:limit]
                        self.record['output_bound_exceeded'] = True
                    target.write_bytes(helpers.redact_log(data) if source.suffix == '.log' else data)
            if not joined(self) or not helpers.await_owned_absence(self.record):
                raise resources.ResourceError('Unregistered/uncertain launch; preserve scratch and reservation: ' + str(self.root))
            if self.root.exists():
                open_files_absent(self)
            return super().__exit__(kind, value, tb)

    @contextlib.contextmanager
    def handled():
        main = threading.current_thread() is threading.main_thread()
        previous = {}
        if main:
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous[signum] = signal.getsignal(signum)
                signal.signal(signum, lambda number, frame: cancellation.set())
        try:
            yield
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)

    def run_process(command, cwd, env, log, scratch, policy, disk_limit, ram_limit, timeout, host=None, cancel=None):
        started = time.monotonic()
        timeout = min(float(timeout), 120)
        issue, peak_rss = None, 0
        path = Path(log)
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {'kind': 'selected-command', 'state': 'creating', 'pid': None, 'start': None}
        scratch.record.setdefault('launches', []).append(row)
        scratch.record['ram_limit'] = ram_limit
        persist(scratch)
        process = subprocess.Popen.__new__(subprocess.Popen)
        process._composition_row = row
        scratch.__dict__.setdefault('_composition_handles', []).append(process)
        output = None
        try:
            output = path.open('w', encoding='utf-8')
            child_env = scratch.env(env)
            if host:
                child_env['TEST_RESOURCE_PARENT_RESERVATION'] = scratch.token
            subprocess.Popen.__init__(process, command, cwd=cwd, env=child_env, stdout=output,
                                      stderr=subprocess.STDOUT, start_new_session=True)
            row.update(state='created', pid=process.pid, start=resources.process_identity(process.pid))
            remember(scratch, process.pid, row['start'], process.pid)
            if process.pid not in scratch.record['groups']:
                scratch.record['groups'].append(process.pid)
            persist(scratch)
            row['state'] = 'registered'
            persist(scratch)
            while True:
                # Count this supervisor and all its then-active direct probes
                # as well as the selected command's recursive process family.
                used = scratch.sample()
                rss = capture(scratch)
                peak_rss = max(peak_rss, rss)
                if host:
                    host.update(scratch.token, used, rss)
                combined = sum(item.stat().st_size for item in scratch.root.iterdir()
                               if item.is_file() and item.suffix in ('.log', '.jsonl'))
                if cancellation.is_set() or (cancel is not None and cancel.is_set()):
                    issue = 'Handled cancellation'
                elif used > disk_limit:
                    issue = 'Scratch budget exceeded'
                elif rss > ram_limit:
                    issue = 'Supervisor/direct-probe/recursive child aggregate RSS budget exceeded'
                elif resources.shutil.disk_usage(scratch.root).free < policy.reserve:
                    issue = 'Emergency free-space reserve'
                elif time.monotonic() - started > timeout:
                    issue = 'Chunk time budget exceeded'
                elif combined > 2 * resources.MIB or path.stat().st_size > int(policy.log_mib * resources.MIB):
                    issue = 'Combined/log output budget exceeded'
                if issue or process.poll() is not None:
                    break
                time.sleep(0.1)
        finally:
            finish_handle(scratch, process, row, [output])
        if not joined(scratch):
            raise resources.ResourceError('Uncertain child creation')
        used = scratch.sample()
        if not issue and used > disk_limit:
            issue = 'Final scratch budget exceeded'
        combined = sum(item.stat().st_size for item in scratch.root.iterdir()
                       if item.is_file() and item.suffix in ('.log', '.jsonl'))
        if combined > 2 * resources.MIB:
            issue = issue or 'Final combined output budget exceeded'
        if cancellation.is_set():
            issue = issue or 'Handled cancellation'
        cap = int(policy.log_mib * resources.MIB)
        if path.stat().st_size > cap:
            with path.open('rb') as stream:
                stream.seek(-cap, os.SEEK_END)
                tail = stream.read()
            path.write_bytes(tail)
            issue = issue or 'Output burst exceeded log bound'
        return {'rc': process.returncode, 'wall': time.monotonic() - started, 'issue': issue, 'issue_kind': None,
                'peak_scratch': scratch.record['peak'], 'peak_rss': max(peak_rss, scratch.record.get('aggregate_peak_rss', 0)),
                'manifest': str(scratch.manifest), 'log': str(path)}

    helpers.SafeScratch = OwnedScratch
    base_budget = resources.HostBudget

    class OwnedBudget(base_budget):
        def release(self, token):
            scratch = instances.get(token)
            if scratch is None or os.path.lexists(scratch.root) or not joined(scratch) \
                or not helpers.await_owned_absence(scratch.record):
                raise resources.ResourceError('Unproved cleanup; owned reservation remains charged')
            return super().release(token)

    resources.HostBudget = OwnedBudget
    def owned_stop(process):
        scratch = next((item for item in instances.values()
            if any(handle is process for handle in item.__dict__.get('_composition_handles', []))), None)
        row = getattr(process, '_composition_row', None)
        if scratch is None or not isinstance(row, dict):
            raise resources.ResourceError('Unbound direct handle refused')
        finish_handle(scratch, process, row, [])
    resources.stop_group = owned_stop
    resources.run_process = run_process
    resources.handled_termination = handled
    joined.samples = samples
    return joined
