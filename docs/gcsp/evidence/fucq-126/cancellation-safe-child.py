"""Source-only future harness helper; product/test execution still requires a reviewed freeze."""
import contextlib
import signal
import subprocess
import sys
import threading


class ChildCleanupError(RuntimeError):
    pass


@contextlib.contextmanager
def cancellation_safe_child(command, *, ownership, identify, register, stop_join, verify_absent, **popen_options):
    """Own Popen through failed registration and handled cancellation.

    The caller must create the external ownership/checkpoint record before entering,
    wrap the complete supervisor in handled termination, and persist `ownership` in
    register(process, ownership). stop_join and verify_absent operate on this actual
    handle, independently of whether the registry contains it. verify_absent must
    check the exact recorded PID/start identity and process group; only True passes.
    This helper neither acquires nor releases the caller's resource reservation.
    """
    if threading.current_thread() is not threading.main_thread():
        raise RuntimeError('Launch and signal ownership require the main thread.')
    if popen_options.get('start_new_session', True) is not True:
        raise ValueError('The child must own a new session/process group.')
    popen_options['start_new_session'] = True
    process = None
    critical = True
    pending = []
    previous = {}
    ownership.update(phase='before-create', registered=False, cleanupVerified=False)

    def terminate(signum, _frame):
        # Defer Python's asynchronous exception until creation/registration or cleanup is safe.
        # No OS signal mask is inherited by the child.
        if critical:
            pending.append(signum)
        else:
            raise KeyboardInterrupt('Owned child cancelled by signal %d' % signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, terminate)
        ownership['phase'] = 'creating'
        process = subprocess.Popen(command, **popen_options)
        # Handled cancellation cannot raise between Popen returning and these assignments.
        ownership.update(pid=process.pid, pgid=process.pid, phase='created')
        ownership['start'] = identify(process.pid)
        if not ownership['start']:
            raise RuntimeError('Cannot establish the created child start identity.')
        ownership['phase'] = 'registering'
        register(process, ownership)
        ownership.update(phase='registered', registered=True)
        critical = False
        if pending:
            raise KeyboardInterrupt('Owned child cancelled during creation/registration: %r' % pending)
        yield process
    finally:
        # Cleanup always owns the local handle, including callback failure before persistence.
        # A second handled cancellation is queued until stop/join and verification finish.
        body_failed = sys.exc_info()[0] is not None
        critical = True
        cleanup_error = None
        try:
            if process is not None:
                ownership['phase'] = 'stopping'
                try:
                    stop_join(process)
                except BaseException as error:
                    cleanup_error = ChildCleanupError('Owned child stop/join failed: %s' % type(error).__name__)
                # Close only pipe handles created by this Popen, including a failed register callback.
                for name in ('stdin', 'stdout', 'stderr'):
                    handle = getattr(process, name)
                    if popen_options.get(name) == subprocess.PIPE and handle is not None:
                        try:
                            handle.close()
                        except BaseException as error:
                            cleanup_error = ChildCleanupError('Owned pipe close failed: %s' % type(error).__name__)
                try:
                    stopped = process.poll() is not None
                    absent = verify_absent(process, ownership) is True
                    if not stopped or not absent or not ownership.get('start'):
                        cleanup_error = ChildCleanupError('Exact child/group absence is incomplete or uncertain.')
                    elif cleanup_error is None:
                        ownership.update(phase='stopped-verified', cleanupVerified=True)
                except BaseException as error:
                    cleanup_error = ChildCleanupError('Owned child absence verification failed: %s' % type(error).__name__)
                if cleanup_error is not None:
                    ownership.update(phase='cleanup-issue', cleanupVerified=False)
            else:
                ownership['phase'] = 'no-child-created'
        finally:
            ownership['deferredSignals'] = list(pending)
            # The handle and any cleanup issue are recorded before restoring handlers.
            for signum, handler in previous.items():
                signal.signal(signum, handler)
        if cleanup_error is not None:
            raise cleanup_error
        if pending and not body_failed:
            raise KeyboardInterrupt('Owned child cancelled during cleanup: %r' % pending)
