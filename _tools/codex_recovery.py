#!/usr/bin/python3
"""Observe a registered Codex root and request a verified same-thread continuation.

No inference client, credentials, model configuration or work queue lives here. Native
app-server state is authoritative; inability to read it always suppresses submission.
"""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import struct
import subprocess
import sys
import time
import uuid

VERSION = "1.0.1"
DEFAULT_GIT_TOOL = "_tools/scaffold_git.py"
INTERVAL = 10
REGISTRATION_TTL = 12 * 3600
BACKOFF = 30
MAX_BACKOFF = 900
RPC_TIMEOUT = 3
MAX_RESPONSE = 2 * 1024 * 1024
DIRECTIVE = ("Continue the registered dev-inbox poller under the current project AGENTS.md and current "
             "shared dev-inbox code-poller procedure. Read the current run directive, scope, ownership, "
             "leases, stop/pause decisions and checkpoint before acting. Reconcile native turn history "
             "and any partially streamed work with actual tool results; resume from that checkpoint. "
             "Do not blindly replay tools or repeat completed actions. Preserve human acceptance and "
             "the existing provider/model. A recoverable inference-service failure interrupted this turn.")


class RecoveryError(Exception):
    pass


def directory(root):
    base = root / '.claude'
    path = base / 'codex-recovery'
    if base.is_symlink() or path.is_symlink():
        raise RecoveryError('recovery state directories must not be symbolic links')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    ignore = path / '.gitignore'
    if ignore.is_symlink():
        raise RecoveryError('recovery ignore file must not be a symbolic link')
    expected = '# Local native recovery coordination; never commit this directory.\n*\n'
    if not ignore.exists() or ignore.read_text() != expected:
        fd = os.open(str(ignore), os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as handle:
            handle.write(expected)
            handle.flush()
            os.fsync(handle.fileno())
    return path


@contextmanager
def locked(root):
    path = directory(root) / '.lock'
    if path.is_symlink():
        raise RecoveryError('recovery lock must not be a symbolic link')
    with path.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def state_path(root, thread):
    return directory(root) / (thread + '.json')


def read_state(root, thread):
    path = state_path(root, thread)
    if path.is_symlink():
        raise RecoveryError('recovery state must not be a symbolic link')
    try:
        if path.stat().st_size > 32768:
            raise RecoveryError('oversized recovery registration')
        state = json.loads(path.read_text())
    except FileNotFoundError:
        return {'enabled': False, 'phase': 'unregistered', 'thread': thread}
    if not isinstance(state, dict) or state.get('thread') != thread or state.get('root') != str(root):
        raise RecoveryError('recovery registration identity mismatch')
    return state


def save(root, state):
    path = state_path(root, state['thread'])
    state['revision'] = state.get('revision', 0) + 1
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    try:
        fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            json.dump(state, handle, sort_keys=True)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
    finally:
        if temporary.exists():
            temporary.unlink()


def process_start_identity(pid):
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return None
    env = dict(os.environ)
    env['LC_ALL'] = 'C'
    try:
        result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'lstart='],
                                capture_output=True, text=True, timeout=1, env=env)
        identity = result.stdout.strip()
        return identity if result.returncode == 0 and identity else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def alive(pid, expected_identity):
    return bool(expected_identity and process_start_identity(pid) == expected_identity)


class Native:
    """RFC6455 JSON-RPC to the existing owner's Unix control socket only."""
    def __init__(self, env=None):
        self.env = os.environ if env is None else env

    def __enter__(self):
        self.sequence = 0
        self.buffer = b''
        home = self.env.get('CODEX_HOME') or str(Path.home() / '.codex')
        control = self.env.get('SCAFFOLDING_CODEX_CONTROL_SOCKET') or str(
            Path(home) / 'app-server-control/app-server-control.sock')
        if not os.path.isabs(control):
            raise RecoveryError('control socket must be absolute')
        self.connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.connection.settimeout(RPC_TIMEOUT)
        try:
            self.connection.connect(control)
            key = base64.b64encode(os.urandom(16)).decode('ascii')
            request = ('GET /rpc HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n'
                       'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n'
                       'Sec-WebSocket-Key: ' + key + '\r\n\r\n')
            self.connection.sendall(request.encode('ascii'))
            deadline = time.monotonic() + RPC_TIMEOUT
            while b'\r\n\r\n' not in self.buffer:
                self.receive(deadline)
                if len(self.buffer) > 16384:
                    raise RecoveryError('oversized native WebSocket handshake')
            head, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
            lines = head.decode('ascii').split('\r\n')
            headers = {}
            for line in lines[1:]:
                name, value = line.split(':', 1)
                name = name.strip().lower()
                if name in headers:
                    raise RecoveryError('duplicate native WebSocket handshake header')
                headers[name] = value.strip()
            accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            if (lines[0].split()[:2] != ['HTTP/1.1', '101'] or headers.get('sec-websocket-accept') != accept
                    or headers.get('upgrade', '').lower() != 'websocket'
                    or 'upgrade' not in [v.strip().lower() for v in headers.get('connection', '').split(',')]
                    or 'sec-websocket-extensions' in headers):
                raise RecoveryError('invalid native WebSocket handshake')
            self.call('initialize', {'clientInfo': {'name': 'scaffolding_recovery', 'version': VERSION},
                                     'capabilities': {'experimentalApi': True}})
            self.write({'method': 'initialized', 'params': {}})
            return self
        except Exception:
            self.connection.close()
            raise

    def receive(self, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RecoveryError('native control read timed out')
        self.connection.settimeout(remaining)
        chunk = self.connection.recv(65536)
        if not chunk:
            raise RecoveryError('native control socket disconnected')
        self.buffer += chunk
        if len(self.buffer) > MAX_RESPONSE + 65536:
            raise RecoveryError('native response exceeded bounded read')

    def take(self, size, deadline):
        while len(self.buffer) < size:
            self.receive(deadline)
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data

    def send_frame(self, opcode, payload):
        if len(payload) > MAX_RESPONSE or (opcode >= 8 and len(payload) > 125):
            raise RecoveryError('native outbound frame exceeds bound')
        size = len(payload)
        if size < 126:
            header = bytes([0x80 | opcode, 0x80 | size])
        elif size <= 65535:
            header = bytes([0x80 | opcode, 0x80 | 126]) + struct.pack('!H', size)
        else:
            header = bytes([0x80 | opcode, 0x80 | 127]) + struct.pack('!Q', size)
        mask = os.urandom(4)
        body = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.connection.settimeout(RPC_TIMEOUT)
        self.connection.sendall(header + mask + body)

    def write(self, value):
        self.send_frame(1, json.dumps(value).encode())

    def message(self, deadline):
        fragments = bytearray()
        fragmented = False
        while True:
            first, second = self.take(2, deadline)
            final, opcode = bool(first & 0x80), first & 15
            if first & 0x70 or second & 0x80:
                raise RecoveryError('invalid native WebSocket frame flags')
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', self.take(2, deadline))[0]
                if size < 126:
                    raise RecoveryError('noncanonical native frame length')
            elif size == 127:
                size = struct.unpack('!Q', self.take(8, deadline))[0]
                if size < 65536 or size >= 2 ** 63:
                    raise RecoveryError('invalid native frame length')
            if size > MAX_RESPONSE or len(fragments) + size > MAX_RESPONSE:
                raise RecoveryError('native response exceeded bounded read')
            if opcode >= 8:
                if not final or size > 125 or opcode not in (8, 9, 10):
                    raise RecoveryError('invalid native WebSocket control frame')
                payload = self.take(size, deadline)
                if opcode == 8:
                    raise RecoveryError('native WebSocket closed')
                if opcode == 9:
                    self.send_frame(10, payload)
                continue
            if opcode not in (0, 1) or (opcode == 0) != fragmented:
                raise RecoveryError('invalid native WebSocket fragmentation')
            fragments.extend(self.take(size, deadline))
            if final:
                return json.loads(fragments.decode('utf-8'))
            fragmented = True

    def call(self, method, params):
        self.sequence += 1
        self.write({'id': self.sequence, 'method': method, 'params': params})
        deadline = time.monotonic() + RPC_TIMEOUT
        received = 0
        while time.monotonic() < deadline:
            message = self.message(deadline)
            received += 1
            if received > 256 or not isinstance(message, dict):
                raise RecoveryError('native response exceeded bounded message count')
            if message.get('id') == self.sequence:
                if 'error' in message or not isinstance(message.get('result'), dict):
                    raise RecoveryError('native request unavailable')
                return message['result']
        raise RecoveryError('native control read timed out')

    def snapshot(self, root, thread):
        metadata = self.call('thread/read', {'threadId': thread, 'includeTurns': False})['thread']
        if metadata.get('id') != thread or Path(metadata.get('cwd', '')).resolve() != root:
            raise RecoveryError('native root identity mismatch')
        if metadata.get('parentThreadId'):
            raise RecoveryError('recovery registration must name a root thread')
        status = metadata.get('status', {}).get('type')
        if status not in ('idle', 'active', 'notLoaded', 'systemError'):
            raise RecoveryError('unknown native thread status')
        turns = self.call('thread/turns/list', {'threadId': thread, 'limit': 1,
                                               'sortDirection': 'desc', 'itemsView': 'summary'})
        queue = self.call('thread/queue/list', {'threadId': thread, 'limit': 1})
        if not isinstance(turns.get('data'), list) or not isinstance(queue.get('data'), list):
            raise RecoveryError('incomplete native state')
        if 'nextCursor' not in queue or (not queue['data'] and queue['nextCursor']):
            raise RecoveryError('incomplete native queue state')
        turn = turns['data'][0] if turns['data'] else None
        return status, turn, queue['data']

    def __exit__(self, *_):
        self.connection.close()


def _owner_live(root, state, now):
    """Read dev_mail's existing lease authority including same-clone ownership."""
    if not state.get('enabled') or state.get('expires_at', 0) <= now:
        return False
    try:
        record = json.loads((root / '.claude/scaffolding.json').read_text())
        tool = record['inbox']['git_tool']
    except (OSError, ValueError, KeyError, TypeError):
        tool = None
    selected = tool.strip() if isinstance(tool, str) and tool.strip() else DEFAULT_GIT_TOOL
    path = root / selected
    if not path.is_file():
        raise RecoveryError('poller lease authority unavailable')
    spec = importlib.util.spec_from_file_location('_recovery_scaffold_git', str(path))
    if spec is None or spec.loader is None:
        raise RecoveryError('selected poller lease authority cannot be loaded')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not all(callable(getattr(module, name, None)) for name in ('_poller_setup', 'pen_read', '_poller_resumable')):
        raise RecoveryError('selected poller lease authority lacks the owner API')
    context, early = module._poller_setup(str(root), state['poller'])
    if early:
        # Without a remote, the explicit local start/stop registration owns lifecycle.
        if early[0] == 0 and 'no remote: no lease' in early[1]:
            return True
        raise RecoveryError('poller lease status unavailable')
    rc, _, lease = module.pen_read(str(root), context['ref'])
    if rc:
        raise RecoveryError('poller lease read failed')
    return bool(lease and lease.get('exp', 0) > now and module._poller_resumable(str(root), lease, context))


def owner_live(root, state, now):
    # scaffold_git may fetch a remote lease; bound that read and its git child.
    def expired(*_):
        raise RecoveryError('poller lease read timed out')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, 5)
    try:
        return _owner_live(root, state, now)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def gateway_failure(turn):
    """Accept native inference overload or the observed gateway422, never tool-slot refusal."""
    if not turn or turn.get('status') != 'failed':
        return False
    error = turn.get('error') or {}
    message = str(error.get('message', '')) + ' ' + str(error.get('additionalDetails', ''))
    info = error.get('codexErrorInfo')
    if info == 'serverOverloaded':
        return True
    status = None
    if isinstance(info, dict):
        for details in info.values():
            if isinstance(details, dict) and details.get('httpStatusCode') is not None:
                status = details['httpStatusCode']
    return bool(('Frontier Advantage credits exhausted' in message)
                and (status == 422 or (status is None and re.search(r'\b422\b', message))))


def snapshot(root, thread):
    with Native() as native:
        return native.snapshot(root, thread)


def step(root, thread):
    now = time.time()
    with locked(root):
        state = read_state(root, thread)
        generation = state.get('generation')
        revision = state.get('revision')
    if not state.get('enabled'):
        return state
    try:
        if not owner_live(root, state, now):
            return disarm(root, thread, generation, 'disarmed', 'poller ownership ended')
        else:
            runtime, turn, queued = snapshot(root, thread)
            state.update(native_control='verified', observed_at=now,
                         observed_turn=turn.get('id') if turn else None,
                         observed_turn_status=turn.get('status') if turn else None)
            attempt = state.get('attempt')
            if attempt:
                matching = [item for item in queued
                            if item.get('clientUserMessageId') == attempt['client_user_message_id']]
                if not matching and queued and not attempt.get('queued_submission_id'):
                    with Native() as native:
                        match = find_pending(native, thread, attempt['client_user_message_id'])
                    matching = [match] if match else []
                if matching:
                    attempt['queued_submission_id'] = matching[0]['id']
                    state.update(queued_at=state.get('queued_at') or now, phase='queued')
            if attempt and turn and turn.get('id') != attempt['failed_turn']:
                started = turn.get('startedAt')
                ours = any(item.get('type') == 'userMessage' and item.get('clientId') == attempt['client_user_message_id']
                           for item in turn.get('items', []))
                if not ours:
                    disabled = disarm(root, thread, generation, 'disarmed', 'new turn superseded recovery')
                    return record_recent_outcome(root, thread, disabled)
                if isinstance(started, (int, float)) and started >= int(attempt['requested_at']):
                    state.update(started_turn=turn['id'], started_at=started, phase='started')
                    attempt['started_turn'] = turn['id']
                    if turn.get('status') in ('completed', 'failed', 'interrupted'):
                        state.update(phase=turn['status'], outcome=turn['status'])
                        attempt['outcome'] = turn['status']
                        if turn['status'] == 'completed':
                            state['consecutive_failures'] = 0
                else:
                    state.update(phase='waiting', reason='new turn lacks start evidence')
            if runtime == 'active' or (turn and turn.get('status') == 'inProgress'):
                if state.get('phase') != 'started':
                    state.update(phase='active')
            elif queued:
                if not attempt:
                    state.update(phase='pending_queue')
            elif runtime not in ('idle', 'systemError') or (runtime == 'systemError' and not gateway_failure(turn)):
                state.update(reason='native thread is not confirmed idle')
            elif gateway_failure(turn):
                failed_turn = turn.get('id')
                if not isinstance(failed_turn, str) or not failed_turn:
                    raise RecoveryError('failed turn lacks identity')
                fingerprint = hashlib.sha256((thread + ':' + failed_turn).encode()).hexdigest()
                if state.get('failure_fingerprint') != fingerprint:
                    count = state.get('consecutive_failures', 0) + 1
                    delay = min(MAX_BACKOFF, BACKOFF * (2 ** min(count - 1, 5)))
                    state.update(failure_fingerprint=fingerprint, consecutive_failures=count,
                                 next_attempt_at=now + delay, phase='backoff')
                elif not attempt or attempt['failed_turn'] != failed_turn:
                    if now >= state.get('next_attempt_at', now + BACKOFF):
                        return submit(root, thread, state, generation)
            elif not attempt:
                state.update(phase='waiting', reason='no eligible terminal gateway failure')
    except Exception:
        # Never persist native error bodies, CLI output, prompts or credentials.
        state.update(native_control='unavailable', reason='native or poller state unavailable; waiting')
    with locked(root):
        current = read_state(root, thread)
        if (current.get('generation') != generation or not current.get('enabled')
                or current.get('revision') != revision):
            return current
        save(root, state)
    return state


def record_recent_outcome(root, thread, state):
    """Read prior owned outcome only after superseding work has disarmed recovery."""
    attempt = state.get('attempt')
    if state.get('enabled') or not attempt or attempt.get('outcome'):
        return state
    found = None
    try:
        with Native() as native:
            cursor = None
            for _ in range(2):
                page = native.call('thread/turns/list', {'threadId': thread, 'sortDirection': 'desc',
                                   'limit': 20, 'itemsView': 'summary', 'cursor': cursor})
                for turn in page['data']:
                    own = any(item.get('type') == 'userMessage' and item.get('clientId') == attempt['client_user_message_id']
                              for item in turn.get('items', []))
                    started = turn.get('startedAt')
                    if (own and isinstance(started, (int, float)) and started >= int(attempt['requested_at'])
                            and turn.get('status') in ('completed', 'failed', 'interrupted')):
                        found = turn
                        break
                next_cursor = page.get('nextCursor')
                if found or not next_cursor or next_cursor == cursor:
                    break
                cursor = next_cursor
    except Exception:
        return state
    if not found:
        return state
    with locked(root):
        current = read_state(root, thread)
        current_attempt = current.get('attempt') or {}
        if (current.get('enabled') or current.get('generation') != state.get('generation')
                or current_attempt.get('client_user_message_id') != attempt['client_user_message_id']):
            return current
        current.update(started_turn=found['id'], started_at=found['startedAt'], outcome=found['status'],
                       outcome_source='native_history', outcome_observed_at=time.time())
        current_attempt.update(started_turn=found['id'], outcome=found['status'])
        save(root, current)
    return current


def recovery_directive(state):
    return (DIRECTIVE + ' Before any task work, read .claude/codex-recovery/' + state['thread'] +
            '.json. Proceed only while enabled is true and generation equals ' + state['generation'] +
            '; otherwise return without task work. Check the current human directive before continuing.')


def find_pending(native, thread, client_id):
    cursor = None
    seen = set()
    for _ in range(20):
        page = native.call('thread/queue/list', {'threadId': thread, 'limit': 100, 'cursor': cursor})
        for item in page['data']:
            if item.get('clientUserMessageId') == client_id:
                return item
        cursor = page.get('nextCursor')
        if not cursor:
            return None
        if cursor in seen:
            raise RecoveryError('native queue cursor did not advance')
        seen.add(cursor)
    raise RecoveryError('native queue reconciliation requires another bounded check')


def cancel_pending(root, thread, state):
    attempt = state.get('attempt')
    if not attempt:
        return state
    try:
        with Native() as native:
            submission_id = attempt.get('queued_submission_id')
            if not submission_id:
                match = find_pending(native, thread, attempt['client_user_message_id'])
                if match:
                    submission_id = match['id']
                    attempt['queued_submission_id'] = submission_id
            if submission_id:
                result = native.call('thread/queue/delete', {'threadId': thread, 'queuedSubmissionId': submission_id})
                attempt['cancellation'] = 'deleted' if result.get('deleted') else 'no_longer_pending'
            else:
                attempt['cancellation'] = 'not_observed'
    except Exception:
        attempt['cancellation'] = 'unverified'
    return state


def disarm(root, thread, generation, phase, reason):
    # Persist the guard first: a native dequeue may already have copied our input.
    # Exact-ID deletion cannot retract it; the directive also checks this guard.
    with locked(root):
        state = read_state(root, thread)
        if generation and state.get('generation') != generation:
            return state
        if not state.get('generation'):
            return state
        state.update(enabled=False, phase=phase, reason=reason, stopped_at=time.time())
        save(root, state)
    state = cancel_pending(root, thread, state)
    with locked(root):
        current = read_state(root, thread)
        if current.get('generation') != state['generation'] or current.get('enabled'):
            return current
        save(root, state)
    return state


def submit(root, thread, state, generation):
    # Re-read the same loaded owner's activity/turn/queue immediately before add.
    if not owner_live(root, state, time.time()):
        return disarm(root, thread, generation, 'disarmed', 'poller ownership ended')
    with Native() as native:
        runtime, turn, queued = native.snapshot(root, thread)
        if runtime not in ('idle', 'systemError') or queued or not gateway_failure(turn):
            return state
        failed_turn = turn['id']
        fingerprint = hashlib.sha256((thread + ':' + failed_turn).encode()).hexdigest()
        if fingerprint != state['failure_fingerprint']:
            return state
        with locked(root):
            current = read_state(root, thread)
            if (current.get('generation') != generation or not current.get('enabled')
                    or current.get('revision') != state.get('revision')):
                return current
            if current.get('attempt', {}).get('failed_turn') == failed_turn:
                return current
            state.update(attempt={'failed_turn': failed_turn, 'requested_at': time.time(),
                                  'client_user_message_id': str(uuid.uuid4())},
                         phase='submitting', queued_at=None, started_turn=None, outcome=None)
            # Durable identity precedes the potentially ambiguous write. Never add twice.
            save(root, state)
        with locked(root):
            current = read_state(root, thread)
            if current.get('generation') != generation or not current.get('enabled'):
                return current
        try:
            result = native.call('thread/queue/add', {'threadId': thread,
                         'clientUserMessageId': state['attempt']['client_user_message_id'],
                         'input': [{'type': 'text', 'text': recovery_directive(state)}]})
            state['attempt']['queued_submission_id'] = result['queuedSubmission']['id']
            state.update(phase='queued', queued_at=time.time())
        except Exception:
            state.update(phase='unverified', reason='submission outcome unknown; awaiting native evidence')
    with locked(root):
        current = read_state(root, thread)
        if current.get('generation') != generation or not current.get('enabled'):
            # Stop may have raced the add response; cancel only this exact submission.
            cancel = True
        elif current.get('revision') != state.get('revision'):
            return current
        else:
            save(root, state)
            return state
    if cancel:
        cancel_pending(root, thread, state)
    return current


def start(root, thread, poller, watch=True):
    with locked(root):
        state = read_state(root, thread)
        now = time.time()
        for path in directory(root).glob('*.json'):
            if path.name == thread + '.json':
                continue
            other = read_state(root, path.stem)
            if other.get('enabled') and other.get('expires_at', 0) > now:
                raise RecoveryError('another root thread is registered; stop it before transferring ownership')
        if state.get('enabled') and state.get('poller') != poller:
            raise RecoveryError('thread is registered to a different poller')
        if not state.get('enabled'):
            state = {'version': VERSION, 'root': str(root), 'thread': thread, 'poller': poller,
                     'generation': uuid.uuid4().hex, 'enabled': True, 'phase': 'registered',
                     'native_control': 'unverified', 'registered_at': now}
        state['expires_at'] = now + REGISTRATION_TTL
        if watch and not alive(state.get('watcher_pid'), state.get('watcher_start_identity')):
            process = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(Path(__file__).resolve()),
                                        'watch', '--root', str(root), '--thread', thread,
                                        '--generation', state['generation']], cwd=str(root),
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       start_new_session=True, close_fds=True)
            state['watcher_pid'] = process.pid
            state['watcher_start_identity'] = process_start_identity(process.pid)
        save(root, state)
    return state


def main(argv=None):
    os.umask(0o077)
    os.environ['SCAFFOLDING_HARNESS'] = 'codex'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', action='version', version=VERSION)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('start', 'status', 'stop', 'step', 'watch'):
        command = commands.add_parser(name)
        command.add_argument('--root', required=True)
        command.add_argument('--thread', required=True)
        if name == 'start':
            command.add_argument('--poller', required=True)
            command.add_argument('--no-watch', action='store_true', help=argparse.SUPPRESS)
        if name == 'watch':
            command.add_argument('--generation', required=True)
    args = parser.parse_args(argv)
    try:
        root = Path(args.root)
        if not root.is_absolute() or not root.is_dir():
            raise RecoveryError('--root must be an existing absolute directory')
        root = root.resolve()
        if str(uuid.UUID(args.thread)) != args.thread:
            raise RecoveryError('--thread must be a canonical UUID')
        if args.command == 'start':
            if not re.fullmatch(r'[a-z][a-z0-9]{1,15}', args.poller):
                raise RecoveryError('--poller must be a lowercase poller name of 2 to 16 letters/digits')
            result = start(root, args.thread, args.poller, not args.no_watch)
        elif args.command == 'step':
            result = step(root, args.thread)
        elif args.command == 'watch':
            next_tick = 0
            while True:
                with locked(root):
                    state = read_state(root, args.thread)
                if (not state.get('enabled') or state.get('generation') != args.generation
                        or state.get('watcher_pid') != os.getpid()):
                    break
                if time.monotonic() >= next_tick:
                    result = step(root, args.thread)
                    if not result.get('enabled'):
                        break
                    next_tick = time.monotonic() + INTERVAL
                time.sleep(.25)
            return 0
        elif args.command == 'stop':
            result = disarm(root, args.thread, None, 'stopped', 'explicit stop')
        else:
            with locked(root):
                result = read_state(root, args.thread)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (RecoveryError, OSError, ValueError) as exc:
        # Validation errors contain identifiers/paths only, never native response contents.
        parser.exit(2, 'codex_recovery: %s\n' % exc)


if __name__ == '__main__':
    sys.exit(main())
