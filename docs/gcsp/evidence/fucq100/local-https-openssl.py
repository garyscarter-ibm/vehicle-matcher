"""One direct Darwin native spawn, with retained PID and wait4 accounting.

Called only by local-https-preload.cjs. Never logs certificate, key or OpenSSL output.
Darwin posix_spawn creates the executable image without an interpreted child or
forked Python memory phase. The broker retains the returned PID until wait4.
"""
import hashlib
import json
import os
from pathlib import Path
import selectors
import resource
import signal
import subprocess
import sys
import time

CONFIG = '[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=server\n[subject]\nCN=localhost\n[server]\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(path, row):
    path = Path(path); st = path.stat()
    if digest(path) != row['sha256'] or str(path.resolve()) != row['realpath'] \
            or (st.st_dev, st.st_ino, path.is_symlink()) != (row['device'], row['inode'], row['symlink']):
        raise RuntimeError('Pinned certificate executable/helper drift')


def main():
    cfg_path = Path(os.environ['FUCQ100_COMPOSITION_CONFIG'])
    if digest(cfg_path) != os.environ['FUCQ100_COMPOSITION_CONFIG_SHA256']:
        raise RuntimeError('Certificate configuration drift')
    cfg = json.loads(cfg_path.read_text()); spec = cfg['certificate']
    args = sys.argv[2:]
    if sys.argv[1] != '--broker' or len(args) != 13:
        raise RuntimeError('Unadmitted certificate argv')
    if sys.platform != 'darwin' or not hasattr(os, 'posix_spawn'):
        raise RuntimeError('Only the reviewed direct Darwin spawn is admitted')
    root = Path(args[6]).parent
    expected = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(root / 'localhost.key'),
                '-out', str(root / 'localhost.crt'), '-days', '1', '-config', str(root / 'openssl.cnf')]
    if args != expected or not root.name.startswith('gcsp-local-https-') \
            or root.parent != Path(spec['scratch']) or root.is_symlink() \
            or str(root.resolve()) != str(root) or any(os.environ.get(k) != spec['scratch'] for k in ('TMPDIR', 'TMP', 'TEMP')) \
            or (root / 'openssl.cnf').read_text() != CONFIG:
        raise RuntimeError('Unadmitted certificate inputs')
    for path, row in spec['pins'].items(): verify(path, row)
    native_env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C',
                  'TMPDIR': spec['scratch'], 'TMP': spec['scratch'], 'TEMP': spec['scratch'],
                  'OPENSSL_CONF': str(root / 'openssl.cnf')}
    journal = Path(spec['journal']); deadline = min(time.monotonic() + 9,
        time.monotonic() + max(0, spec['workDeadlineEpochMs'] / 1000 - time.time()))
    # Intent and finalizer state precede this broker's first probe/child.
    state = {'kind': 'certificate', 'brokerPid': os.getpid(), 'pid': None, 'start': None,
             'pgid': os.getpgrp(), 'state': 'creating', 'epochMs': round(time.time() * 1000),
             'spawn': 'darwin-os.posix_spawn'}
    def emit():
        line = (json.dumps(state, separators=(',', ':')) + '\n').encode()
        fd = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            if os.fstat(fd).st_size + len(line) > 65536: raise RuntimeError('Certificate journal bound')
            os.write(fd, line)
        finally: os.close(fd)
    emit()
    # Intent and retained state exist before even pipe allocation. No other
    # reaper touches this PID, including on cancellation or a failed anchor.
    handle = {'pid': None, 'returncode': None}
    read_fd = write_fd = None
    joined = False; usage = None; cancelled = False
    def cancel(number, frame):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM, cancel); signal.signal(signal.SIGINT, cancel)
    def query(arguments, pid=None, until=None):
        left = (deadline if until is None else until) - time.monotonic()
        if left <= 0: raise TimeoutError('Certificate registration deadline')
        p = subprocess.run(['/bin/ps', '-p', str(handle['pid'] if pid is None else pid), '-o', arguments],
                           capture_output=True, text=True, timeout=min(1, left))
        if p.returncode or p.stderr or not p.stdout.strip() or len(p.stdout) > 8192:
            raise RuntimeError('Unknown certificate process accounting')
        return p.stdout.strip()
    def reap(block=False):
        nonlocal joined, usage
        pid, status, measured = os.wait4(handle['pid'], 0 if block else os.WNOHANG)
        if pid:
            handle['returncode'] = os.waitstatus_to_exitcode(status)
            usage = measured
            joined = True
            if type(measured.ru_maxrss) not in (int, float) or measured.ru_maxrss <= 0:
                raise RuntimeError('Unknown native certificate RSS')
        return joined
    error = None; output = bytearray()
    try:
        state.update(brokerStart=query('lstart=', os.getpid()), brokerPgid=os.getpgrp(),
                     nodePid=os.getppid())
        emit()
        if cancelled or time.monotonic() >= deadline: raise TimeoutError('Certificate launch cancelled')
        read_fd, write_fd = os.pipe()
        if min(read_fd, write_fd) <= 2 or os.get_inheritable(read_fd) or os.get_inheritable(write_fd):
            raise RuntimeError('Certificate pipe unexpectedly inheritable')
        # The broker is single-threaded. Inventory currently open descriptors
        # after listdir closes its own directory FD; all nonstandard descriptors
        # are closed in the child after the output dup actions. No journal or
        # configuration descriptor may leak, even if inherited by the broker.
        descriptors = {read_fd, write_fd}
        for value in os.listdir('/dev/fd'):
            fd = int(value)
            if fd <= 2: continue
            try: os.fstat(fd)
            except OSError as exc:
                if exc.errno != 9: raise
            else: descriptors.add(fd)
        actions = [(os.POSIX_SPAWN_CLOSE, 0),
                   (os.POSIX_SPAWN_DUP2, write_fd, 1), (os.POSIX_SPAWN_DUP2, write_fd, 2)]
        actions += [(os.POSIX_SPAWN_CLOSE, fd) for fd in sorted(descriptors)]
        defaults = tuple(getattr(signal, name) for name in
                         ('SIGPIPE', 'SIGINT', 'SIGTERM', 'SIGXFZ', 'SIGXFSZ') if hasattr(signal, name))
        verify('/usr/bin/openssl', spec['pins']['/usr/bin/openssl'])
        if cancelled or time.monotonic() >= deadline: raise TimeoutError('Certificate launch cancelled')
        # Direct libc/kernel spawn only: no Popen/fork fallback or Python child
        # branch. Flag-only handlers cannot throw away a returned native PID.
        handle['pid'] = os.posix_spawn('/usr/bin/openssl', ['/usr/bin/openssl', *args], native_env,
            file_actions=actions, setsigmask=(), setsigdef=defaults)
        state['pid'] = handle['pid']; state['state'] = 'created'; emit()
        os.close(write_fd); write_fd = None
        state.update(start=query('lstart='), pgid=int(query('pgid=')),
                     state='registered')
        if state['pgid'] != os.getpgrp(): raise RuntimeError('Certificate group unknown')
        state['probePeakRssBytes'] = int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
        if state['probePeakRssBytes'] <= 0: raise RuntimeError('Unknown registration probe RSS')
        emit()
        with selectors.DefaultSelector() as selector:
            os.set_blocking(read_fd, False)
            selector.register(read_fd, selectors.EVENT_READ)
            while selector.get_map() or not joined:
                if cancelled or time.monotonic() >= deadline: raise TimeoutError('Certificate work deadline/cancellation')
                for key, _ in selector.select(timeout=0.01):
                    data = os.read(key.fd, min(4096, 8193 - len(output)))
                    output.extend(data)
                    if len(output) > 8192: raise RuntimeError('Certificate 8 KiB output bound')
                    if not data: selector.unregister(key.fileobj)
                if not joined: reap()
    except BaseException as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    finally:
        end = time.monotonic() + 0.5
        try:
            if handle['pid'] is not None and handle['returncode'] is None and not joined:
                # A retained direct child cannot be PID-reused until wait4 reaps it.
                # A fresh lstart/group anchor is additionally required to signal it.
                if not reap():
                    if not state.get('start'):
                        state.update(start=query('lstart=', until=end), pgid=int(query('pgid=', until=end)))
                    if query('lstart=', until=end) != state['start'] or int(query('pgid=', until=end)) != state['pgid']:
                        raise RuntimeError('Certificate cancellation anchor uncertain')
                    os.kill(handle['pid'], signal.SIGKILL)
        except BaseException as exc:
            error = error or type(exc).__name__ + ': ' + str(exc)
        finally:
            # Anchor/probe/signal errors must not bypass direct wait4 or closure.
            try:
                if handle['pid'] is not None and handle['returncode'] is None and not joined:
                    while not reap() and time.monotonic() < end: time.sleep(0.005)
                    if not joined: raise RuntimeError('Certificate direct join uncertain')
            except BaseException as exc:
                error = error or type(exc).__name__ + ': ' + str(exc)
            finally:
                for fd in (read_fd, write_fd):
                    if fd is not None:
                        try: os.close(fd)
                        except OSError as exc: error = error or type(exc).__name__ + ': ' + str(exc)
        state.update(state='joined' if joined else 'uncertain', returncode=handle['returncode'],
                     nativePeakRssBytes=None if usage is None else int(usage.ru_maxrss),
                     brokerPeakRssBytes=int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss),
                     outputBytes=len(output), error=error, finishedEpochMs=round(time.time() * 1000))
        if error or handle['returncode'] != 0:
            journal.with_name('openssl-output.log').write_bytes(output[:8192])
        emit()
    # Success preserves the utility's execFile callback contract. Failure passes
    # a nonzero exit, without echoing random key-generation output or private paths.
    return 0 if joined and handle['returncode'] == 0 and error is None else 1


if __name__ == '__main__':
    sys.exit(main())
