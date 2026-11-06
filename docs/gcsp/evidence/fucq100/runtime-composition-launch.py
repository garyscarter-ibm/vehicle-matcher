"""Owned launch adapter. Imported only after all frozen helper hashes are checked.

Diagnosis: static review of the shared run_process found Popen outside its try,
then a cancellation window before child registration. No reproduction was run.
This adapter owns a handle before calling Popen.__init__, persists launch intent,
defers handled signals, and refuses scratch deletion/release for uncertain launches.
"""
import contextlib
import os
from pathlib import Path
import signal
import subprocess
import threading
import time


def install(helpers):
    resources = helpers.resources
    cancellation = threading.Event()
    base_scratch = helpers.SafeScratch
    instances = {}

    def joined(scratch):
        return all(row.get('state') == 'joined' for row in scratch.record.get('launches', []))

    class OwnedScratch(base_scratch):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            instances[self.token] = self

        def __exit__(self, kind, value, tb):
            for source, target in self.record.get('retained_outputs', {}).items():
                source, target = Path(source), Path(target)
                if source.parent != self.root or target.parent != self.manifest.parent.parent:
                    raise resources.ResourceError('Invalid retained output ownership')
                if source.exists():
                    limit = 262144 if source.suffix == '.log' else 524288
                    with source.open('rb') as stream: data = stream.read(limit + 1)
                    if len(data) > limit:
                        data = data[:limit]
                        self.record['output_bound_exceeded'] = True
                    target.write_bytes(helpers.redact_log(data) if source.suffix == '.log' else data)
            if not joined(self):
                raise resources.ResourceError('Unregistered/uncertain launch; preserve scratch and reservation: ' + str(self.root))
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
        path = Path(log); path.parent.mkdir(parents=True, exist_ok=True)
        # Record an owned launch intent before allocating any child. The Python
        # handle is retained before __init__ can create it, including error paths.
        row = {'state': 'creating', 'pid': None, 'start': None}
        scratch.record.setdefault('launches', []).append(row)
        resources.atomic_json(scratch.manifest, scratch.record)
        process = subprocess.Popen.__new__(subprocess.Popen)
        scratch.__dict__.setdefault('_composition_handles', []).append(process)
        output = None
        try:
            output = path.open('w', encoding='utf-8')
            child_env = scratch.env(env)
            if host: child_env['TEST_RESOURCE_PARENT_RESERVATION'] = scratch.token
            # No handled signal raises between creation and durable registration.
            subprocess.Popen.__init__(process, command, cwd=cwd, env=child_env, stdout=output,
                                      stderr=subprocess.STDOUT, start_new_session=True)
            row.update(state='created', pid=process.pid, start=resources.process_identity(process.pid))
            scratch.record.setdefault('owned_pids', []).append({'pid': process.pid, 'start': row['start'], 'pgid': process.pid})
            if process.pid not in scratch.record['groups']: scratch.record['groups'].append(process.pid)
            resources.atomic_json(scratch.manifest, scratch.record)
            row['state'] = 'registered'
            resources.atomic_json(scratch.manifest, scratch.record)
            while process.poll() is None:
                used = scratch.sample(); rss = resources.group_rss(process.pid); peak_rss = max(peak_rss, rss)
                if host: host.update(scratch.token, used, rss)
                combined = sum(item.stat().st_size for item in scratch.root.iterdir()
                               if item.is_file() and (item.suffix in ('.log', '.jsonl')))
                if cancellation.is_set() or (cancel is not None and cancel.is_set()): issue = 'Handled cancellation'
                elif used > disk_limit: issue = 'Scratch budget exceeded'
                elif rss > ram_limit: issue = 'Recursive aggregate RSS budget exceeded'
                elif resources.shutil.disk_usage(scratch.root).free < policy.reserve: issue = 'Emergency free-space reserve'
                elif time.monotonic() - started > timeout: issue = 'Chunk time budget exceeded'
                elif combined > 2 * resources.MIB or path.stat().st_size > int(policy.log_mib * resources.MIB): issue = 'Combined/log output budget exceeded'
                if issue: break
                time.sleep(0.1)
        finally:
            # Never accept an empty ownership record as evidence when a local
            # handle exists. Adopt its PID before stop/join even if registration
            # or the first atomic ownership write raised.
            pid = getattr(process, 'pid', None)
            if type(pid) is int and pid > 0:
                if pid not in scratch.record['groups']: scratch.record['groups'].append(pid)
                if not any(entry['pid'] == pid for entry in scratch.record.get('owned_pids', [])):
                    scratch.record.setdefault('owned_pids', []).append({'pid': pid, 'start': resources.process_identity(pid), 'pgid': pid})
                resources.stop_group(process)
                process.wait(timeout=5)
                if not helpers.await_owned_absence(scratch.record):
                    raise resources.ResourceError('Owned launch/descendant remains; preserve scratch and reservation')
                row.update(state='joined', pid=pid)
                resources.atomic_json(scratch.manifest, scratch.record)
            else:
                # Popen failed without an established handle: no deletion or
                # reservation release can be justified by an empty PID list.
                row['state'] = 'uncertain-no-pid'
                resources.atomic_json(scratch.manifest, scratch.record)
            if output is not None: output.close()
        if not joined(scratch): raise resources.ResourceError('Uncertain child creation')
        used = scratch.sample()
        if not issue and used > disk_limit: issue = 'Final scratch budget exceeded'
        combined = sum(item.stat().st_size for item in scratch.root.iterdir()
                       if item.is_file() and item.suffix in ('.log', '.jsonl'))
        if combined > 2 * resources.MIB: issue = issue or 'Final combined output budget exceeded'
        if cancellation.is_set(): issue = issue or 'Handled cancellation'
        cap = int(policy.log_mib * resources.MIB)
        if path.stat().st_size > cap:
            with path.open('rb') as stream:
                stream.seek(-cap, os.SEEK_END); tail = stream.read()
            path.write_bytes(tail)
            issue = issue or 'Output burst exceeded log bound'
        return {'rc': process.returncode, 'wall': time.monotonic() - started, 'issue': issue,
                'issue_kind': None, 'peak_scratch': scratch.record['peak'], 'peak_rss': peak_rss,
                'manifest': str(scratch.manifest), 'log': str(path)}

    helpers.SafeScratch = OwnedScratch
    base_budget = resources.HostBudget
    class OwnedBudget(base_budget):
        def release(self, token):
            scratch = instances.get(token)
            if scratch is not None and (os.path.lexists(scratch.root) or not joined(scratch)
                                       or not helpers.await_owned_absence(scratch.record)):
                raise resources.ResourceError('Unproved cleanup; owned reservation remains charged')
            return super().release(token)
    resources.HostBudget = OwnedBudget
    resources.run_process = run_process
    resources.handled_termination = handled
    return joined
