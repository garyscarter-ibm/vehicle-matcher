"""Configured local PostgreSQL clusters and registry-owned per-run databases."""
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shlex
import socket
import subprocess
import threading
import time

NAME = 'postgres'
SOCKET_LIMIT = 90
DEFAULT_SETTINGS = {'fsync': 'off', 'synchronous_commit': 'off', 'full_page_writes': 'off',
                    'shared_buffers': '64MB', 'max_connections': '60', 'work_mem': '4MB'}
_IDENTIFIER = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]{0,62}$')
_ENV_KEY = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:16]


def _config(ctx):
    adapters = getattr(ctx, 'adapter_configs', ctx.test_stack.get('adapters', {}))
    value = adapters.get(NAME, {}) if isinstance(adapters, dict) else {}
    if not isinstance(value, dict):
        raise ctx.core.StackError('postgres configuration must be an object')
    return value


def _identifier(value, error):
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise error('PostgreSQL identifiers must contain letters, digits or underscores and be at most 63 bytes')
    return '"' + value + '"'


def format_env(pairs, fmt='env'):
    if fmt == 'json':
        return json.dumps(dict(pairs), indent=2)
    prefix = 'export ' if fmt == 'export' else ''
    return '\n'.join('%s%s=%s' % (prefix, key, shlex.quote(str(value))) for key, value in pairs)


class Pg:
    """One cluster per binary/version/settings/user; one registry authority for all clusters.

    Registry callbacks and SQL never run under the registry metadata lock. Cluster
    locks serialize service transitions and SQL, while creator claims protect the
    interval between registration and acquiring the cluster lock.
    """
    def __init__(self, ctx, _profile=None):
        self.ctx = ctx
        self.core = ctx.core
        self.R = self.core.resources
        self.error = self.core.StackError
        config = _config(ctx) if _profile is None else _profile
        binary = config.get('bin')
        if not isinstance(binary, str) or not binary:
            raise self.error('postgres.bin must name the configured PostgreSQL binary directory')
        self.bin = str(Path(self.core.expand_path(binary, 'postgres.bin')).absolute())
        self.version = str(config.get('version', '17'))
        if not re.fullmatch(r'[1-9][0-9]*', self.version):
            raise self.error('postgres.version must be a PostgreSQL major version')
        self.user = config.get('user', 'test_stack')
        _identifier(self.user, self.error)
        settings = config.get('settings', {})
        if not isinstance(settings, dict):
            raise self.error('postgres.settings must be an object')
        self.settings = dict(DEFAULT_SETTINGS)
        self.settings.update(settings)
        for key, value in self.settings.items():
            if (not isinstance(key, str) or not re.fullmatch(r'[a-z][a-z0-9_]*', key) or
                    not isinstance(value, (str, int, float, bool)) or
                    not re.fullmatch(r'[A-Za-z0-9_.+ -]+', str(value))):
                raise self.error('invalid PostgreSQL setting')
            if key in ('listen_addresses', 'port', 'unix_socket_directories', 'hba_file', 'data_directory'):
                raise self.error('PostgreSQL network and state paths are managed by the adapter')
        self.profile = {'bin': self.bin, 'version': self.version, 'user': self.user, 'settings': self.settings}
        self.key = _digest(self.profile)
        self.root = ctx.root
        self.pg = self.core.guard_path(self.root / 'pg' / self.key, ctx.machine)
        self.data = self.pg / 'data'
        self.sock = self.pg / 'sock'
        self.state_path = self.pg / 'state.json'
        self.lock_path = self.root / 'locks' / ('postgres-' + self.key + '.lock')
        prefix = config.get('prefix')
        if prefix is None:
            slug = re.sub(r'[^a-z0-9]+', '_', ctx.project_root.name.lower()).strip('_') or 'project'
            prefix = slug[:12] + '_' + _digest(ctx.project)[:6]
        _identifier(prefix, self.error)
        if len(prefix) > 24:
            raise self.error('postgres.prefix must be at most 24 characters')
        self.prefix = prefix
        self.fixed_names = config.get('fixed_names', [])
        if not isinstance(self.fixed_names, list) or len(self.fixed_names) > 2:
            raise self.error('postgres.fixed_names must be a list of at most two identifiers')
        for name in self.fixed_names:
            _identifier(name, self.error)
        if len(set(self.fixed_names)) != len(self.fixed_names):
            raise self.error('postgres.fixed_names must be distinct')
        self.env = config.get('env', {})
        if not isinstance(self.env, dict) or any(not isinstance(k, str) or not _ENV_KEY.fullmatch(k) or not isinstance(v, str)
                                                 for k, v in self.env.items()):
            raise self.error('postgres.env must map shell variable names to string templates')
        try:
            for template in self.env.values():
                template.format(port=1, user=self.user, db='db', db2='db2')
        except (KeyError, ValueError, IndexError, AttributeError) as error:
            raise self.error('postgres.env templates support {port}, {user}, {db}, {db2}') from error

    @property
    def registry(self):
        return self.ctx.registry('databases', reclaim=self._reclaim)

    @contextlib.contextmanager
    def _lock(self):
        # A callback can re-enter on this thread; separate Pg instances share the
        # same process lock, and the outermost entry owns the cross-process flock.
        identity = str(self.lock_path)
        with _LOCKS_GUARD:
            entry = _LOCKS.setdefault(identity, (threading.RLock(), threading.local()))
        mutex, state = entry
        with mutex:
            if getattr(state, 'held', False):
                yield
            else:
                with self.core.file_lock(self.lock_path, machine=self.ctx.machine):
                    state.held = True
                    try:
                        yield
                    finally:
                        state.held = False

    def _state(self):
        try:
            value = json.loads(self.core.guard_path(self.state_path, self.ctx.machine).read_text())
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise self.error('cannot read PostgreSQL cluster state') from error
        if not isinstance(value, dict):
            raise self.error('invalid PostgreSQL cluster state')
        if ('profile' in value or 'cluster' in value) and (value.get('cluster') != self.key or
                not isinstance(value.get('profile'), dict) or _digest(value['profile']) != self.key):
            raise self.error('PostgreSQL state cluster profile identity mismatch')
        return value

    def _write_state(self, value):
        self.core.guard_path(self.pg, self.ctx.machine).mkdir(parents=True, exist_ok=True)
        self.R.atomic_json(self.core.guard_path(self.state_path, self.ctx.machine), value)

    def _records(self):
        # Snapshot only: callbacks may acquire a different cluster's lock. Never
        # invoke Registry.read while holding a cluster lock (cross-cluster order).
        return self.registry._snapshot()

    def _cluster_records(self, records=None):
        records = self._records() if records is None else records
        return {key: record for key, record in records.items()
                if record.get('meta', {}).get('cluster') == self.key}

    def _owned_records(self):
        return {key: record for key, record in self._cluster_records().items()
                if record.get('project') == self.ctx.project}

    def _refresh_empty(self, ignore=None):
        records = self._cluster_records()
        if ignore is not None:
            records.pop(ignore, None)
        state = self._state()
        if not state:
            return None
        if records:
            state['empty_since'] = None
        elif state.get('empty_since') is None:
            state['empty_since'] = time.time()
        self._write_state(state)
        return state.get('empty_since')

    def run_tool(self, name, *args, check=True):
        binary = Path(self.bin) / name
        try:
            result = subprocess.run([str(binary)] + list(args), capture_output=True, text=True,
                                    env=dict(os.environ, LC_ALL='C'), timeout=120)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise self.error('PostgreSQL %s unavailable or timed out' % name) from error
        if check and result.returncode:
            raise self.error('PostgreSQL %s failed (%d): %s' %
                             (name, result.returncode, (result.stderr or result.stdout).strip()[:400]))
        return result

    def actual_version(self):
        result = self.run_tool('postgres', '--version')
        match = re.search(r'PostgreSQL\)?\s+(\d+)(?:\.|\s|$)', result.stdout)
        if match is None:
            raise self.error('cannot read PostgreSQL binary version')
        if match[1] != self.version:
            raise self.error('PostgreSQL binary version %s does not match configured version %s' % (match[1], self.version))
        return match[1]

    def port(self):
        port = self._state().get('port')
        if port is not None and (isinstance(port, bool) or not isinstance(port, int) or not 0 < port < 65536):
            raise self.error('invalid PostgreSQL state port')
        return port

    def running(self):
        if not self.core.guard_path(self.data / 'PG_VERSION', self.ctx.machine).is_file():
            return False
        return self.run_tool('pg_ctl', 'status', '-D', str(self.data), check=False).returncode == 0

    @staticmethod
    def free_port():
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            return listener.getsockname()[1]

    @staticmethod
    def port_free(port):
        with socket.socket() as listener:
            try:
                listener.bind(('127.0.0.1', port))
                return True
            except OSError:
                return False

    def _check_socket(self):
        if len(os.fsencode(self.sock)) > SOCKET_LIMIT:
            raise self.error('PostgreSQL socket directory is too long; configure a shorter local test-stack root')

    def initdb(self):
        self._check_socket()
        self.core.guard_path(self.sock, self.ctx.machine).mkdir(parents=True, exist_ok=True)
        self.run_tool('initdb', '-D', str(self.data), '-U', self.user, '-E', 'UTF8', '--locale=C', '-A', 'trust')
        (self.data / 'pg_hba.conf').write_text('local all all trust\nhost all all 127.0.0.1/32 trust\n')
        with (self.data / 'postgresql.conf').open('a') as handle:
            handle.write("\ninclude_if_exists = 'test-stack.conf'\n")

    def write_conf(self, port):
        quote = lambda value: "'" + str(value).replace("'", "''") + "'"
        lines = ['# test-only durability settings', "listen_addresses = '127.0.0.1'", 'port = %d' % port,
                 'unix_socket_directories = ' + quote(self.sock)]
        for key, value in sorted(self.settings.items()):
            value = str(value).lower() if isinstance(value, bool) else str(value)
            lines.append('%s = %s' % (key, value if re.fullmatch(r'[0-9]+|on|off|true|false', value) else quote(value)))
        (self.data / 'test-stack.conf').write_text('\n'.join(lines) + '\n')

    def up(self):
        self._check_socket()
        self.actual_version()
        with self._lock():
            marker = self.core.guard_path(self.data / 'PG_VERSION', self.ctx.machine)
            if marker.exists() and marker.read_text().strip() != self.version:
                raise self.error('cluster PostgreSQL version does not match configured version')
            if not marker.exists():
                self.initdb()
            state = self._state()
            if not self.running():
                port = self.port()
                if not port or not self.port_free(port):
                    port = self.free_port()
                self.core.guard_path(self.sock, self.ctx.machine).mkdir(parents=True, exist_ok=True)
                self.write_conf(port)
                state.pop('postmaster', None)
                state.update(port=port, user=self.user)
                self._write_state(state)
                self.run_tool('pg_ctl', 'start', '-D', str(self.data), '-w', '-t', '60', '-l', str(self.pg / 'server.log'))
            elif not state.get('port'):
                raise self.error('cluster is running but PostgreSQL state has no port')
            state = self._state()
            state.update(cluster=self.key, profile=self.profile, postmaster=self._server_identity())
            self._write_state(state)
            self._refresh_empty()
            return {'port': self.port(), 'user': self.user, 'data': str(self.data)}

    def _server_identity(self):
        try:
            lines = self.core.guard_path(self.data / 'postmaster.pid', self.ctx.machine).read_text().splitlines()
            pid, port = int(lines[0]), int(lines[3])
            if lines[1] != str(self.data) or port != self.port() or pid <= 0:
                raise ValueError('data or port mismatch')
            start = self.R.process_identity(pid)
            if not start:
                raise ValueError('process identity unavailable')
            identity = {'pid': pid, 'start': start}
            expected = self._state().get('postmaster')
            if expected is not None and expected != identity:
                raise ValueError('postmaster identity changed')
            if not self.R.process_alive(identity):
                raise ValueError('postmaster exited')
            return identity
        except (OSError, ValueError, IndexError) as error:
            raise self.error('PostgreSQL endpoint identity/data/port cannot be verified') from error

    def sql(self, statement, database='postgres'):
        with self._lock():
            port = self.port()
            if port is None:
                raise self.error('no PostgreSQL cluster state: run pg up first')
            if not self._state().get('postmaster'):
                raise self.error('PostgreSQL endpoint identity is missing; run pg up first')
            self._server_identity()  # A recycled port must never address another cluster.
            return self.run_tool('psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
                                 '-p', str(port), '-U', self.user, '-d', database, '-c', statement).stdout

    def require_fixed_slot(self):
        token = os.environ.get('AGENT_HEAVY_SLOT')
        queue = self.core.Slots(directory=self.core.host_dir(self.ctx.machine), machine=self.ctx.machine)
        if not self.core.valid_nested_slot(queue, token):
            raise self.error('--fixed requires a valid held ancestral heavy slot')

    def _reclaim(self, record):
        meta = record.get('meta', {})
        profile = meta.get('profile')
        if not isinstance(profile, dict):
            raise self.error('database record has no recorded cluster profile')
        target = self if meta.get('cluster') == self.key else Pg(self.ctx, _profile=profile)
        name = meta.get('database')
        _identifier(name, self.error)
        if (target.key != meta.get('cluster') or _digest(profile) != target.key or
                record.get('name') != target.key + ':' + name):
            raise self.error('database record cluster identity does not match its profile')
        with target._lock():
            target.sql('DROP DATABASE IF EXISTS %s WITH (FORCE)' % _identifier(name, self.error))
            target._refresh_empty(ignore=record['name'])

    def create_dbs(self, run_id, running=False, owner=None, fixed=False):
        if fixed:
            self.require_fixed_slot()
            if len(self.fixed_names) < (2 if running else 1):
                raise self.error('--fixed needs configured postgres.fixed_names')
            names = self.fixed_names[:2 if running else 1]
        else:
            run = re.sub(r'[^a-z0-9]+', '_', str(run_id).lower()).strip('_') or 'run'
            length = 63 - len(self.prefix) - 8
            names = [self.prefix + '_' + run[:min(32, length)] + '_' + secrets.token_hex(3)
                     for _ in range(2 if running else 1)]
        owner = self.ctx.owner if owner is None else owner
        registered = []
        try:
            for name in names:
                key = self.key + ':' + name
                meta = {'cluster': self.key, 'profile': self.profile, 'database': name}
                def create(record, name=name, key=key):
                    # Only a callback that actually ran owns this registration.
                    registered.append(key)
                    with self._lock():
                        self._refresh_empty()
                        if fixed:
                            self.sql('DROP DATABASE IF EXISTS %s WITH (FORCE)' % _identifier(name, self.error))
                        self.sql('CREATE DATABASE %s' % _identifier(name, self.error))
                self.registry.register(key, project=self.ctx.project, run=str(run_id), owner=owner,
                                       meta=meta, create=create)
        except BaseException:
            for key in registered:
                # Registry keeps failed SQL callbacks reclaim-pending. Preserve
                # the original CREATE error after attempting every exact key.
                with contextlib.suppress(Exception):
                    self.registry.drop(key)
            raise
        return {'port': self.port(), 'names': names}

    def env_pairs(self, port, names):
        names = list(names)
        values = {'port': port, 'user': self.user, 'db': names[0], 'db2': names[1] if len(names) > 1 else ''}
        return [(key, template.format(**values)) for key, template in self.env.items()
                if '{db2}' not in template or values['db2']]

    def drop_names(self, names):
        selected = set(names)
        dropped = []
        failed = []
        for key, record in self._owned_records().items():
            name = record.get('meta', {}).get('database')
            if name in selected:
                if self.registry.drop(key):
                    dropped.append(name)
                else:
                    failed.append(name)
        with self._lock():
            self._refresh_empty()
        if failed:
            raise self.error('PostgreSQL database cleanup failed; registry records retained: ' + ', '.join(failed))
        return dropped

    def drop_run(self, run_id):
        return self.drop_names([record['meta']['database'] for record in self._owned_records().values()
                                if record.get('run') == str(run_id)])

    def touch_run(self, run_id):
        touched = []
        for key, record in self._owned_records().items():
            if record.get('run') == str(run_id):
                self.registry.touch(key)
                touched.append(record['meta']['database'])
        return touched

    def down(self, if_idle=False, force=False):
        self.registry.gc()  # callbacks can route to other clusters; no cluster lock held
        with self._lock():
            records = self._cluster_records()
            names = sorted(record.get('meta', {}).get('database', key) for key, record in records.items())
            if names and (if_idle or not force):
                return {'stopped': False, 'refused': True, 'reason': 'databases held by live owners or pending cleanup',
                        'databases': names}
            if not self.running():
                return {'stopped': False, 'reason': 'not running', 'databases': names}
            self._server_identity()
            self.run_tool('pg_ctl', 'stop', '-D', str(self.data), '-m', 'fast', '-w', '-t', '60')
            return {'stopped': True, 'databases': names}

    def status(self):
        self.registry.gc()
        with self._lock():
            self._refresh_empty()
            return {'running': self.running(), 'port': self.port(), 'databases': self._cluster_records(),
                    'data': str(self.data), 'data_bytes': self.R.allocated_bytes(self.data) if self.data.exists() else 0}

    def _recorded_clusters(self):
        """Find only state whose profile, key and exact directory agree."""
        directory = self.core.guard_path(self.root / 'pg', self.ctx.machine)
        if not directory.is_dir():
            return []
        targets = []
        for entry in directory.iterdir():
            if (entry.is_symlink() or not entry.is_dir() or not re.fullmatch(r'[0-9a-f]{16}', entry.name)
                    or entry.name == self.key):
                continue
            state_path = entry / 'state.json'
            if state_path.is_symlink():
                continue
            try:
                state = json.loads(self.core.guard_path(state_path, self.ctx.machine).read_text())
                profile = state.get('profile')
                if (not isinstance(profile, dict) or state.get('cluster') != entry.name or
                        _digest(profile) != entry.name):
                    continue
                target = Pg(self.ctx, _profile=profile)
                if target.pg != entry or target.key != entry.name:
                    continue
                targets.append(target)
            except (OSError, ValueError, AttributeError, self.error):
                # Unknown metadata is never authority to operate a service.
                continue
        return targets

    def gc(self):
        before = self._records()
        remaining = self.registry.gc()
        dropped = [record['meta']['database'] for key, record in before.items() if key not in remaining
                   and record.get('meta', {}).get('database')]
        hours = self.ctx.test_stack.get('idle_stop_hours', self.ctx.machine_test_stack.get('idle_stop_hours', 4))
        if isinstance(hours, bool) or not isinstance(hours, (int, float)) or not math.isfinite(hours) or hours < 0:
            raise self.error('test_stack.idle_stop_hours must be a non-negative number')
        stopped = []
        for target in [self] + self._recorded_clusters():
            with target._lock():
                empty_since = target._refresh_empty()
                if empty_since is not None and time.time() - empty_since >= hours * 3600 and target.running():
                    target._server_identity()
                    target.run_tool('pg_ctl', 'stop', '-D', str(target.data), '-m', 'fast', '-w', '-t', '60')
                    stopped.append(target.key)
        return {'dropped': dropped, 'stopped': self.key in stopped, 'stopped_clusters': stopped}


def tool_versions(ctx):
    return {'postgres': Pg(ctx).actual_version()}


def status(ctx):
    return Pg(ctx).status()


def gc(ctx):
    return Pg(ctx).gc()


def _command(args, ctx):
    pg = Pg(ctx)
    if args.pg_cmd == 'db':
        if args.db_cmd == 'create':
            if args.fixed:
                pg.require_fixed_slot()  # Gate before up, initialization or SQL.
            owner = ctx.core.select_owner(args.owner, args.owner_pid)
            pg.up()
            made = pg.create_dbs(args.run, args.running, owner=owner, fixed=args.fixed)
            print(format_env(pg.env_pairs(made['port'], made['names']), args.format))
            return 0
        result = {'dropped' if args.db_cmd == 'drop' else 'touched':
                  pg.drop_run(args.run) if args.db_cmd == 'drop' else pg.touch_run(args.run)}
    elif args.pg_cmd == 'down':
        result = pg.down(args.if_idle, args.force)
    else:
        result = getattr(pg, args.pg_cmd)()
    print(json.dumps(result, indent=2))
    return 1 if result.get('refused') and not getattr(args, 'if_idle', False) else 0


def add_commands(subparsers, ctx):
    pg = subparsers.add_parser('pg', help='manage configured PostgreSQL clusters and per-run databases')
    commands = pg.add_subparsers(dest='pg_cmd', required=True)
    for name in ('up', 'status', 'gc'):
        item = commands.add_parser(name)
        item.set_defaults(func=lambda args: _command(args, ctx))
    down = commands.add_parser('down')
    down.add_argument('--if-idle', action='store_true')
    down.add_argument('--force', action='store_true')
    down.set_defaults(func=lambda args: _command(args, ctx))
    db = commands.add_parser('db')
    db_commands = db.add_subparsers(dest='db_cmd', required=True)
    for name in ('create', 'drop', 'touch'):
        item = db_commands.add_parser(name)
        item.add_argument('--run', required=True)
        if name == 'create':
            item.add_argument('--running', action='store_true')
            item.add_argument('--fixed', action='store_true')
            item.add_argument('--owner', choices=('session', 'shell'), default='session')
            item.add_argument('--owner-pid', type=int)
            item.add_argument('--format', choices=('env', 'export', 'json'), default='env')
        item.set_defaults(func=lambda args: _command(args, ctx))
