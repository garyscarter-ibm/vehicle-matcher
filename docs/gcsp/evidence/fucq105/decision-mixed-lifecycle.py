"""Owned105 launch bookkeeping. Importing this module creates no processes, scratch or reservations."""
from contextlib import contextmanager
import signal


@contextmanager
def deferred_cancellation(cancel, signals=signal):
    """Record handled signals as cancellation, including during spawn, persistence and finalizers.

    This changes Python handlers rather than the signal mask: an exec'ed child must not inherit
    blocked SIGINT/SIGTERM. The shared launcher's polling loop receives the same cancel event.
    Install before allocation and restore only after the entire cleanup receipt is written.
    """
    previous = {}
    try:
        for number in (signals.SIGINT, signals.SIGTERM):
            previous[number] = signals.getsignal(number)
            signals.signal(number, lambda signum, frame: cancel.set())
        yield
    finally:
        for number, handler in previous.items():
            signals.signal(number, handler)


class LaunchOwnership:
    """Never infer absence from an empty group list after an attempted launch."""
    def __init__(self, resources, scratch):
        self.resources = resources
        self.scratch = scratch
        self.process = None
        self.attempted = False
        self.safe = True
        self.record = {'attempted': False, 'state': 'not-started', 'pid': None,
                       'registration_persisted': False, 'joined': False, 'issues': []}
        scratch.record['child_launch'] = self.record

    def persist(self):
        self.resources.atomic_json(self.scratch.manifest, self.scratch.record)

    def begin(self):
        # Durable intent precedes entry into the shared launcher, even before its Popen.
        self.attempted = True
        self.safe = False
        self.record.update(attempted=True, state='creating', joined=False)
        self.persist()

    def register(self, process):
        # Retain the actual handle before identity reads or any fallible persistence.
        self.process = process
        self.attempted = True
        self.safe = False
        self.record.update(attempted=True, state='owned', pid=process.pid, registration_persisted=False, joined=False)
        if process.pid not in self.scratch.record['groups']:
            self.scratch.record['groups'].append(process.pid)
        start = self.resources.process_identity(process.pid)
        if start:
            self.scratch.record['processes'].append({'pid': process.pid, 'start': start})
        self.record['registration_persisted'] = True
        try:
            self.persist()
        except BaseException:
            self.record['registration_persisted'] = False
            raise

    def finish(self):
        """Adopt the retained handle even if registration failed, stop/join, then prove absence.

        A launcher exception before register() leaves a durable creating intent with no handle.
        It is unresolved, not proof of no child: preserve scratch/reservation for reconciliation.
        All failures are bounded type names, without subprocess/provider output.
        """
        if not self.attempted:
            return True
        self.safe = False
        self.record['issues'] = []
        if self.process is None:
            self.record.update(state='unresolved', joined=False)
            self.record['issues'].append('LaunchHandleUnknown')
        else:
            process = self.process
            if process.pid not in self.scratch.record['groups']:
                self.scratch.record['groups'].append(process.pid)
            self.record.update(pid=process.pid, state='stopping', joined=False)
            try:
                self.scratch.sample()
            except BaseException as error:
                self.record['issues'].append(type(error).__name__)
            try:
                if process.poll() is None or self.resources.group_has_live_members(process.pid) is not False:
                    self.resources.stop_group(process)
                else:
                    process.wait()  # Reap the captured leader even if it already exited.
            except BaseException as error:
                self.record['issues'].append(type(error).__name__)
            try:
                absent = process.poll() is not None \
                    and all(self.resources.group_has_live_members(group) is False for group in self.scratch.record['groups']) \
                    and all(not self.resources.process_alive(row) for row in self.scratch.record['processes'])
            except BaseException as error:
                absent = False
                self.record['issues'].append(type(error).__name__)
            self.safe = absent and not self.record['issues']
            self.record.update(state='joined' if self.safe else 'unresolved', joined=self.safe)
        try:
            self.persist()
        except BaseException as error:
            self.safe = False
            self.record.update(state='unresolved', joined=False)
            self.record['issues'].append(type(error).__name__)
        return self.safe

    def require_safe(self):
        if not self.finish():
            raise self.resources.ResourceError('Child ownership/join is unresolved; preserve owned scratch and reservation.')
