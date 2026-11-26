"""Project-configured builds backed by the shared content-keyed cache.

``Build(ctx).build(name, worktree)`` retains its consumer lease on success, including
when a CLI invocation exits. Consumers release ``lease`` with ``ctx.cache.release``
when finished, or renew it with ``ctx.cache.leases.touch(token, ttl)`` while using
the output. The default 24-hour TTL is a backstop, not a replacement for renewal
by longer-lived consumers; the lease owner is the context's selected session.

Selected Node builds use Node.command and Node.link's environment. Babel supports
BABEL_CACHE_PATH natively. Vite must wire cacheDir to AGENT_VITE_CACHE_DIR and
ESLint must pass AGENT_ESLINT_CACHE_LOCATION as --cache-location. These two names
are configured-consumer conventions; unknown writers need ``node link --private``.
"""
import contextlib
import hashlib
import json
import math
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


NAME = "build"
DEFAULT_TTL = 24 * 60 * 60
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_ENV = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class _Cancelled(BaseException):
    def __init__(self, signum):
        self.signum = signum


@contextlib.contextmanager
def _cancellation():
    previous = {}
    def forward(signum, _frame):
        raise _Cancelled(signum)
    try:
        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                previous[signum] = signal.signal(signum, forward)
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


class Build:
    def __init__(self, ctx):
        self.ctx = ctx

    def _error(self, message):
        return self.ctx.core.StackError(message)

    def _configs(self):
        adapters = getattr(self.ctx, "adapter_configs", self.ctx.test_stack.get("adapters", {}))
        config = adapters.get(NAME, {}) if isinstance(adapters, dict) else {}
        if not isinstance(config, dict):
            raise self._error("build configuration must map names to build objects")
        for name, value in config.items():
            if not isinstance(name, str) or not _NAME.fullmatch(name) or name == "gc":
                raise self._error("build name must be a safe component other than gc")
            if not isinstance(value, dict):
                raise self._error("configured build %s must be an object" % name)
        return config

    def _relative(self, value, field, root=False):
        if (not isinstance(value, str) or not value or "\0" in value or
                Path(value).is_absolute() or ".." in Path(value).parts or
                (not root and Path(value) == Path("."))):
            raise self._error("build.%s must be a relative path within its root" % field)
        return Path(value).as_posix()

    def _worktree(self, value):
        path = Path(self.ctx.project_root if value is None else value).expanduser().absolute()
        return self.ctx.core.guard_path(path, self.ctx.machine)

    def _path(self, worktree, value):
        path = worktree / value
        safe = self.ctx.core.guard_path(path, self.ctx.machine)
        root = self.ctx.core.guard_path(worktree, self.ctx.machine)
        try:
            safe.relative_to(root)
        except ValueError:
            raise self._error("build path escapes its worktree: %s" % value)
        return path

    def _plan(self, name, worktree):
        config = self._configs().get(name)
        if config is None:
            raise self._error("unknown configured build: %s" % name)
        command = config.get("command")
        if (not isinstance(command, list) or not command or
                not all(isinstance(arg, str) and arg and "\0" not in arg for arg in command)):
            raise self._error("build.%s.command must be a non-empty argument list" % name)
        inputs = config.get("inputs")
        extras = config.get("extra_inputs", [])
        tools = config.get("tools", [])
        if not isinstance(inputs, list) or not inputs:
            raise self._error("build.%s.inputs must be a non-empty path list" % name)
        if not isinstance(extras, list):
            raise self._error("build.%s.extra_inputs must be a path list" % name)
        if not isinstance(tools, list) or not all(isinstance(item, str) and item for item in tools):
            raise self._error("build.%s.tools must be adapter names" % name)
        plan = {"name": name, "kind": "build-" + name,
                "cwd": self._relative(config.get("cwd", "."), "cwd", root=True),
                "inputs": [self._relative(item, "inputs", root=True) for item in inputs],
                "extra_inputs": [self._relative(item, "extra_inputs") for item in extras],
                "output": self._relative(config.get("output"), "output"),
                "result": self._relative(config.get("result", "."), "result", root=True),
                "env_var": config.get("env_var"), "command": list(command), "tools": list(tools)}
        if (not isinstance(plan["env_var"], str) or not _ENV.fullmatch(plan["env_var"]) or
                plan["env_var"] in {"kind", "key", "path", "cached", "dirty", "lease", "ttl", "env_var"}):
            raise self._error("build.%s.env_var must be an environment variable name distinct from result metadata" % name)
        for value in [plan["cwd"], plan["output"]] + plan["inputs"] + plan["extra_inputs"]:
            self._path(worktree, value)
        plan["node"] = None
        if config.get("node") is not None:
            plan["node"] = self._relative(config["node"], "node", root=True)
            self._path(worktree, plan["node"])
            node = self._adapter("node")
            if not callable(getattr(node, "Node", None)):
                raise self._error("configured node adapter has no Node interface")
            plan["node_adapter"] = node.Node(self.ctx)
            plan["command"] = plan["node_adapter"].command(plan["command"])
            if "node" not in plan["tools"]:
                plan["tools"].append("node")
        return plan

    def _adapter(self, name):
        module = self.ctx._adapters.get(name)
        if module is None:
            raise self._error("build requires loaded adapter: %s" % name)
        return module

    def _git(self, worktree, *args):
        try:
            result = subprocess.run(["git", "-C", str(worktree)] + list(args),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as error:
            raise self._error("cannot launch git (%s)" % type(error).__name__) from error
        if result.returncode:
            raise self._error("git failed while inspecting build inputs")
        return result.stdout

    def _extra(self, worktree, value):
        base = self._path(worktree, value)
        rows = []
        def visit(path):
            info = path.lstat()
            if stat.S_ISREG(info.st_mode):
                digest = hashlib.sha256()
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(65536), b""):
                        digest.update(chunk)
                rows.append([path.relative_to(base.parent).as_posix(), "file", digest.hexdigest(),
                             bool(info.st_mode & 0o111)])
            elif stat.S_ISDIR(info.st_mode):
                rows.append([path.relative_to(base.parent).as_posix(), "directory"])
                for child in sorted(path.iterdir()):
                    visit(child)
            else:
                raise self._error("extra input must contain only regular files/directories: %s" % value)
        try:
            visit(base)
        except OSError as error:
            raise self._error("cannot read configured extra input: %s" % value) from error
        return rows

    def _tool_env(self, plan):
        """Environment from each listed tool's optional tool_env(ctx), e.g. maven's JAVA_HOME (SCAF-81)."""
        env = {}
        for name in plan["tools"]:
            callback = getattr(self._adapter(name), "tool_env", None)
            if not callable(callback):
                continue
            value = callback(self.ctx)
            if not isinstance(value, dict) or not all(isinstance(k, str) and _ENV.fullmatch(k) and isinstance(v, str)
                                                      for k, v in value.items()):
                raise self._error("build tool %s gave an invalid tool_env" % name)
            env.update(value)
        return env

    def _fingerprint(self, plan, worktree):
        versions = {}
        for name in plan["tools"]:
            callback = getattr(self._adapter(name), "tool_versions", None)
            if not callable(callback):
                raise self._error("build adapter has no tool_versions(ctx): %s" % name)
            try:
                value = callback(self.ctx)
                if not isinstance(value, dict) or not value:
                    raise ValueError("empty tool version map")
                json.dumps(value, allow_nan=False)
            except Exception as error:
                raise self._error("cannot determine build tool versions for %s (%s)" %
                                  (name, type(error).__name__)) from error
            versions[name] = value
        trees = {value: self._git(worktree, "rev-parse", "--verify",
                 "HEAD^{tree}" if value == "." else "HEAD:" + value).decode().strip()
                 for value in plan["inputs"]}
        inputs = {"trees": trees, "extra_inputs": {value: self._extra(worktree, value)
                  for value in plan["extra_inputs"]}, "command": plan["command"],
                  "cwd": plan["cwd"], "output": plan["output"], "result": plan["result"],
                  "node": plan["node"], "os": platform.system(), "arch": platform.machine()}
        encoded = json.dumps({"inputs": inputs, "tools": versions}, sort_keys=True,
                             separators=(",", ":"), allow_nan=False).encode()
        return hashlib.sha256(encoded).hexdigest(), inputs, versions

    def key(self, name, worktree=None):
        worktree = self._worktree(worktree)
        return self._fingerprint(self._plan(name, worktree), worktree)[0]

    def _dirty(self, plan, worktree):
        exclude = {self._relative(config.get("output"), "output") for config in self._configs().values()}
        cache = self.ctx.cache
        for record in cache._records(cache.links).values():
            if record.get("run") != str(worktree):
                continue
            try:
                path = Path(record["meta"]["path"])
                relative = path.relative_to(worktree)
                if relative.parts and cache._live_link(record):
                    exclude.add(relative.as_posix())
            except (KeyError, TypeError, ValueError, OSError):
                continue
        args = ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--"]
        args += [":(literal)" + value for value in plan["inputs"]]
        args += [":(exclude,literal)" + value for value in sorted(exclude)]
        return bool(self._git(worktree, *args))

    def is_dirty(self, name, worktree=None):
        worktree = self._worktree(worktree)
        return self._dirty(self._plan(name, worktree), worktree)

    def _output(self, plan, worktree, required=True):
        output = self._path(worktree, plan["output"])
        # Output symlinks must remain relative and inside the copied tree. Otherwise
        # a read-only cached symlink could expose a writable worktree/external file.
        def check(path):
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                if os.path.isabs(target):
                    raise self._error("build output contains an absolute symlink")
                try:
                    path.resolve(strict=True).relative_to(output.resolve(strict=True))
                except (ValueError, OSError, RuntimeError):
                    raise self._error("build output symlink escapes output or is broken")
            elif stat.S_ISDIR(info.st_mode):
                for child in path.iterdir():
                    check(child)
            elif not stat.S_ISREG(info.st_mode):
                raise self._error("build output contains an unsupported file")
        if output.is_symlink():
            raise self._error("build output must not be a symlink")
        if not output.exists():
            if required:
                raise self._error("configured build did not produce its output")
            return output
        check(output)
        result = output / plan["result"] if plan["result"] != "." else output
        if required and not result.exists():
            raise self._error("configured build result does not exist inside its output")
        return output

    def _run(self, plan, worktree, env):
        child, reader = None, None
        previous, errors = {}, []
        destination = sys.stderr
        def forward(signum, _frame):
            raise _Cancelled(signum)
        def drain():
            try:
                while True:
                    chunk = child.stdout.read(65536)
                    if not chunk:
                        break
                    if not errors:
                        try:
                            destination.write(chunk)
                            destination.flush()
                        except Exception as error:
                            errors.append(error)  # Keep draining so a noisy child cannot block.
            except Exception as error:
                errors.append(error)
        try:
            if threading.current_thread() is threading.main_thread():
                for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                    previous[signum] = signal.signal(signum, forward)
            child = subprocess.Popen(plan["command"], cwd=self._path(worktree, plan["cwd"]), env=env,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, errors="replace", start_new_session=True)
            reader = threading.Thread(target=drain, name="build-output", daemon=True)
            reader.start()
            code = child.wait()
            if code:
                raise self._error("configured build command failed (%s)" % code)
        except OSError as error:
            raise self._error("cannot launch configured build command (%s)" % type(error).__name__) from error
        finally:
            for signum in previous:
                signal.signal(signum, signal.SIG_IGN)
            try:
                if child is not None:
                    self.ctx.core.resources.stop_group(child)
                if reader is not None:
                    reader.join()
                if child is not None and child.stdout is not None:
                    child.stdout.close()
            finally:
                for signum, handler in previous.items():
                    signal.signal(signum, handler)
        if errors:
            raise self._error("cannot forward build output (%s)" % type(errors[0]).__name__)

    def build(self, name, worktree=None, owner=None, run="", ttl=DEFAULT_TTL):
        with _cancellation():
            return self._build(name, worktree, owner, run, ttl)

    def _build(self, name, worktree, owner, run, ttl):
        worktree = self._worktree(worktree)
        plan = self._plan(name, worktree)
        if isinstance(ttl, bool) or not isinstance(ttl, (int, float)) or not math.isfinite(ttl) or ttl <= 0:
            raise self._error("build lease TTL must be a positive finite number")
        env = dict(os.environ)
        env.update(self._tool_env(plan))
        # Worktree outputs are shared even by different keys or configured builds.
        digest = hashlib.sha256(str(worktree).encode()).hexdigest()
        with self.ctx.core.file_lock(self.ctx.root / "locks" / ("build-worktree-" + digest + ".lock"),
                                     machine=self.ctx.machine):
            if plan["node"] is not None:
                linked = plan["node_adapter"].link(plan["node"], worktree=worktree,
                           owner=self.ctx.owner if owner is None else owner, run=run or str(worktree))
                env.update(linked["env"])
            key, inputs, versions = self._fingerprint(plan, worktree)
            dirty = self._dirty(plan, worktree)
            self._output(plan, worktree, required=False)
            if dirty:
                print("%s: working tree is dirty; building without caching" % name, file=sys.stderr, flush=True)
                self._run(plan, worktree, env)
                output = self._output(plan, worktree)
                result = {"kind": plan["kind"], "key": key, "path": str(output),
                          "cached": False, "lease": None}
            else:
                def create(stage):
                    self._run(plan, worktree, env)
                    output = self._output(plan, worktree)
                    if self._dirty(plan, worktree) or self._fingerprint(plan, worktree)[0] != key:
                        raise self._error("build inputs changed during the build; no output cached")
                    if output.is_dir():
                        shutil.copytree(output, stage / "output", symlinks=True)
                    else:
                        shutil.copy2(output, stage / "output")
                result = self.ctx.cache.ensure(plan["kind"], key, create, inputs=inputs, tools=versions,
                    readonly=True, owner=self.ctx.owner if owner is None else owner, run=run or str(worktree), ttl=ttl)
                output = Path(result["path"]) / "output"
            result_path = output if plan["result"] == "." else output / plan["result"]
            result.update({plan["env_var"]: str(result_path), "dirty": dirty, "ttl": ttl,
                           "env_var": plan["env_var"]})
            return result

    def gc(self, kinds=None, keep=None):
        configured = self._configs()
        names = list(configured) if kinds is None else kinds
        if (not isinstance(names, list) or not names or
                any(not isinstance(name, str) or name not in configured for name in names)):
            if kinds is None and not configured:
                return {"removed": [], "kept": [], "removed_keys": 0}
            raise self._error("build gc kinds must select configured build names")
        return self.ctx.cache.gc(keep=keep, kinds=["build-" + name for name in names])


def _command(args, ctx):
    builds = Build(ctx)
    try:
        if args.build_name == "gc":
            print(json.dumps(builds.gc(kinds=args.kind, keep=args.keep), sort_keys=True))
        else:
            result = builds.build(args.build_name, args.worktree, ttl=args.ttl)
            if args.format == "json":
                print(json.dumps(result, sort_keys=True))
            else:
                print(result["env_var"] + "=" + result[result["env_var"]])
    except _Cancelled as error:
        return 128 + error.signum
    return 0


def add_commands(subparsers, ctx):
    parser = subparsers.add_parser(NAME, help="reuse configured builds by committed input trees")
    commands = parser.add_subparsers(dest="build_name", required=True)
    for name in Build(ctx)._configs():
        command = commands.add_parser(name)
        command.add_argument("--worktree", required=True)
        command.add_argument("--format", choices=("env", "json"), default="env")
        command.add_argument("--ttl", type=float, default=DEFAULT_TTL,
                             help="consumer lease TTL in seconds; renew while using long-lived outputs")
        command.set_defaults(func=lambda args: _command(args, ctx))
    collector = commands.add_parser("gc")
    collector.add_argument("--kind", action="append")
    collector.add_argument("--keep", type=int)
    collector.set_defaults(func=lambda args: _command(args, ctx))


def status(ctx):
    names = {"build-" + name for name in Build(ctx)._configs()}
    inventory = ctx.cache.status()
    return {"kinds": {name: value for name, value in inventory["kinds"].items() if name in names}}


def gc(ctx):
    return Build(ctx).gc()
