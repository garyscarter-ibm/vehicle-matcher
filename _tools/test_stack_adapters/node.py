"""Pinned Node installs shared by complete lockfile fingerprints.

Babel uses its native BABEL_CACHE_PATH. Vite and ESLint require configured
consumers: Vite ``cacheDir: process.env.AGENT_VITE_CACHE_DIR`` and ESLint
``--cache-location "$AGENT_ESLINT_CACHE_LOCATION"``. These AGENT variables are
adapter conventions, not native tool settings. Use ``node link --private`` for
unknown tools or consumers that cannot redirect writes outside node_modules.
Project .npmrc is referenced only during installation and removed before cache
publication; its complete captured bytes still join the fingerprint.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import threading
import uuid


NAME = 'node'
_PIN = re.compile(r'^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$')
_INSTALL_FILES = ('package.json', 'package-lock.json', '.npmrc')


def _config(ctx):
    adapters = getattr(ctx, 'adapter_configs', ctx.test_stack.get('adapters', {}))
    return adapters.get(NAME, {}) if isinstance(adapters, dict) else {}


def tool_versions(ctx):
    versions = {name: _config(ctx).get(name) for name in ('node', 'npm')}
    for name, value in versions.items():
        if not isinstance(value, str) or not _PIN.fullmatch(value):
            raise ctx.core.StackError('node.%s must be an exact pinned version, e.g. 24.22.3' % name)
    return versions


class _Cancelled(SystemExit):
    def __init__(self, signum):
        self.signum = signum
        super().__init__(128 + signum)


@contextlib.contextmanager
def _cancellation():
    previous = {}
    def cancel(signum, _frame):
        raise _Cancelled(signum)
    try:
        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                previous[signum] = signal.signal(signum, cancel)
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


class Node:
    def __init__(self, ctx):
        self.ctx = ctx

    def command(self, argv):
        versions = tool_versions(self.ctx)
        return ['npx', '-y', '-p', 'node@' + versions['node'], '-p', 'npm@' + versions['npm']] + list(argv)

    def _app(self, app, worktree=None):
        path = Path(app).expanduser()
        if not path.is_absolute():
            path = (self.ctx.project_root if worktree is None else Path(worktree).expanduser().absolute()) / path
        return self.ctx.core.guard_path(path, self.ctx.machine)

    def _worktree(self, app, worktree):
        if worktree is not None:
            return self.ctx.core.guard_path(Path(worktree).expanduser().absolute(), self.ctx.machine)
        try:
            result = subprocess.run(['git', '-C', str(app), 'rev-parse', '--show-toplevel'],
                                    capture_output=True, text=True, timeout=5)
            if result.returncode == 0 and result.stdout.strip():
                return self.ctx.core.guard_path(result.stdout.strip(), self.ctx.machine)
        except (OSError, subprocess.TimeoutExpired):
            pass
        return self.ctx.core.guard_path(self.ctx.project_root, self.ctx.machine)

    def cache_env(self, worktree):
        try:
            wt = self.ctx.core.guard_path(Path(worktree).expanduser().absolute(), self.ctx.machine)
            base = self.ctx.core.guard_path(wt / '.cache/test-stack', self.ctx.machine)
            paths = {name: self.ctx.core.guard_path(base / leaf, self.ctx.machine)
                     for name, leaf in (('BABEL_CACHE_PATH', 'babel'),
                                        ('AGENT_VITE_CACHE_DIR', 'vite'),
                                        ('AGENT_ESLINT_CACHE_LOCATION', 'eslint'))}
            # Resolve every ancestor and existing leaf before creating anything.
            for path in [base] + list(paths.values()):
                path.relative_to(wt)
        except (ValueError, self.ctx.core.StackError) as error:
            raise self.ctx.core.StackError('Node tool cache paths must remain inside the worktree') from error
        base.mkdir(parents=True, exist_ok=True)
        # Babel versions may use a file or directory; leave the leaf uncreated.
        return {name: str(path) for name, path in paths.items()}

    def _install(self, stage, files, npmrc_source):
        for name, data in files.items():
            if name != '.npmrc':
                (stage / name).write_bytes(data)
        child = None
        npmrc = stage / '.npmrc'
        try:
            if npmrc_source is not None:
                # Keep project-config precedence without creating another credential file.
                npmrc.symlink_to(npmrc_source)
            try:
                child = subprocess.Popen(self.command(['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund']),
                                         cwd=stage, stdout=sys.stderr, stderr=sys.stderr, start_new_session=True)
            except OSError as error:
                raise self.ctx.core.StackError('cannot launch pinned Node installer (%s)' % type(error).__name__) from error
            code = child.wait()
            if code:
                raise self.ctx.core.StackError('pinned Node installer failed (%s)' % code)
            if npmrc_source is not None:
                try:
                    current = self.ctx.core.guard_path(npmrc_source, self.ctx.machine)
                    unchanged = current.read_bytes() == files['.npmrc']
                except (OSError, self.ctx.core.StackError):
                    unchanged = False
                if not unchanged:
                    raise self.ctx.core.StackError('.npmrc changed during installation; no output cached')
            self._installed(stage)
        finally:
            previous = {}
            try:
                # A second cancellation must not interrupt stop/join or config unlink.
                if threading.current_thread() is threading.main_thread():
                    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                        previous[signum] = signal.signal(signum, signal.SIG_IGN)
                if child is not None:
                    self.ctx.core.resources.stop_group(child)
            finally:
                try:
                    if os.path.lexists(npmrc):
                        npmrc.unlink()
                finally:
                    for signum, handler in previous.items():
                        signal.signal(signum, handler)

    def _installed(self, path):
        try:
            if stat.S_ISDIR(os.lstat(Path(path) / 'node_modules').st_mode):
                return
        except FileNotFoundError:
            pass
        raise self.ctx.core.StackError('Node installer/cache did not contain a real node_modules directory')

    def ensure(self, app, owner=None, run=''):
        app = self._app(app)
        versions = tool_versions(self.ctx)
        files = {}
        npmrc_source = None
        try:
            for name in _INSTALL_FILES:
                source = self.ctx.core.guard_path(app / name, self.ctx.machine)
                try:
                    files[name] = source.read_bytes()
                    if name == '.npmrc':
                        npmrc_source = source
                except FileNotFoundError:
                    if name != '.npmrc':
                        raise self.ctx.core.StackError('Node install requires %s in %s' % (name, app))
        except OSError as error:
            raise self.ctx.core.StackError('cannot read Node install inputs (%s)' % type(error).__name__) from error
        inputs = {'lockfile': hashlib.sha256(files['package-lock.json']).hexdigest(),
                  'npmrc': hashlib.sha256(files['.npmrc']).hexdigest() if '.npmrc' in files else None,
                  'os': platform.system(), 'arch': platform.machine()}
        fingerprint = json.dumps({'inputs': inputs, 'tools': versions}, sort_keys=True, separators=(',', ':'))
        key = hashlib.sha256(fingerprint.encode('utf-8')).hexdigest()
        with _cancellation():
            result = self.ctx.cache.ensure(NAME, key, lambda stage: self._install(stage, files, npmrc_source),
                                           inputs=inputs, tools=versions, owner=owner, run=run)
            try:
                self._installed(result['path'])
            except BaseException:
                self.ctx.cache.release(result['lease'])
                raise
        return result

    def _app_lock(self, path):
        digest = hashlib.sha256(str(path).encode('utf-8')).hexdigest()
        return self.ctx.core.file_lock(self.ctx.root / 'locks' / ('node-link-' + digest + '.lock'),
                                       machine=self.ctx.machine)

    def _records(self, link):
        return {name: row for name, row in self.ctx.cache.links.read().items()
                if row.get('meta', {}).get('kind') == NAME and row['meta'].get('path') == str(link)}

    def _matches(self, link, row):
        try:
            if not link.is_symlink():
                return False
            target = os.readlink(link)
            actual = os.path.normpath(target if os.path.isabs(target) else str(link.parent / target))
            expected = self.ctx.root / 'cache' / NAME / row['meta']['key'] / 'node_modules'
            return actual == str(expected)
        except FileNotFoundError:
            return False

    @staticmethod
    def _remove_destination(path):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            path.unlink()
        elif path.exists():
            shutil.rmtree(path)

    def link(self, app, worktree=None, replace=False, private=False, owner=None, run=''):
        app = self._app(app, worktree)
        wt = self._worktree(app, worktree)
        link = app / 'node_modules'
        with _cancellation(), self._app_lock(link):
            result = self.ensure(app, owner=owner, run=run or str(wt))
            try:
                result.update(linked=False, private=False, env=self.cache_env(wt))
                if os.path.lexists(link) and not link.is_symlink() and not replace:
                    return result
                target = Path(result['path']) / 'node_modules'
                records = self._records(link)
                if private:
                    stage = app / ('.node-modules-' + uuid.uuid4().hex)
                    try:
                        # Dereference package links so private copies own all bytes.
                        shutil.copytree(target, stage, symlinks=False)
                        self._remove_destination(link)
                        os.replace(stage, link)
                    finally:
                        if stage.exists():
                            shutil.rmtree(stage)
                    result['private'] = True
                elif any(row['meta'].get('key') == result['key'] and self._matches(link, row)
                         for row in records.values()):
                    result['linked'] = True
                    return result
                else:
                    created = []
                    temp = app / ('.node-modules-' + uuid.uuid4().hex)
                    def publish(record):
                        created.append(record)
                        try:
                            temp.symlink_to(target, target_is_directory=True)
                            if os.path.lexists(link) and not link.is_symlink():
                                self._remove_destination(link)
                            os.replace(temp, link)
                        finally:
                            if os.path.lexists(temp):
                                temp.unlink()
                    try:
                        self.ctx.cache.record_link(NAME, result['key'], link, create=publish,
                                                   owner=owner, run=str(wt))
                    except BaseException:
                        for row in created:
                            if self._matches(link, row):
                                link.unlink()
                            self.ctx.cache.release_link(row['name'])
                        raise
                    result['linked'] = True
                for token in records:
                    self.ctx.cache.release_link(token)
                return result
            finally:
                self.ctx.cache.release(result['lease'])
                result.pop('lease', None)

    def unlink(self, app, worktree=None):
        app = self._app(app, worktree)
        link = app / 'node_modules'
        with self._app_lock(link):
            records = self._records(link)
            removed = any(self._matches(link, row) for row in records.values())
            if removed:
                link.unlink()
            for token in records:
                self.ctx.cache.release_link(token)
            return removed

    def gc(self):
        return self.ctx.cache.gc(kinds=[NAME])


def _command(ctx, args):
    adapter = Node(ctx)
    if args.node_command == 'link':
        result = adapter.link(args.app, worktree=args.worktree, replace=args.replace, private=args.private)
    elif args.node_command == 'unlink':
        result = {'unlinked': adapter.unlink(args.app, worktree=args.worktree)}
    else:
        result = adapter.gc()
    print(json.dumps(result, sort_keys=True))
    return 0


def add_commands(subparsers, ctx):
    commands = subparsers.add_parser(NAME, help='shared pinned Node dependencies').add_subparsers(
        dest='node_command', required=True)
    for command in ('link', 'unlink'):
        parser = commands.add_parser(command)
        parser.add_argument('--app', required=True)
        parser.add_argument('--worktree')
        if command == 'link':
            parser.add_argument('--replace', action='store_true')
            parser.add_argument('--private', action='store_true')
        parser.set_defaults(func=lambda args: _command(ctx, args))
    commands.add_parser('gc').set_defaults(func=lambda args: _command(ctx, args))


def status(ctx):
    return {}


def gc(ctx):
    return Node(ctx).gc()
