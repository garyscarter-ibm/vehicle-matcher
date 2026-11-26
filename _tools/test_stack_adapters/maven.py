"""Configured Maven tests and bounded JVM arguments.

``tool_versions(ctx)`` returns ``{'jdk': JAVA_VERSION}`` from the configured JDK's
release file. It is read-only and never starts a JVM or initializes stack state. ``tool_env(ctx)`` gives a build
that lists ``maven`` in its tools the same JDK as JAVA_HOME. ``java_home`` expands ``~``, ``$NAME`` and
``${NAME:-default}`` (core ``expand_path``), so one record serves the Mac and CI.
``java_test_plan`` and ``jvm_args`` expose the same configuration used by the CLI.
"""
import argparse
import contextlib
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading


NAME = "maven"
_HEAP = re.compile(r"^[1-9][0-9]*[mMgG]$")
_ROLES = ("test", "maven", "proof")
_DEFAULTS = {"test": "1g", "maven": "512m", "proof": "768m"}
_ARG_ENV = ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "MAVEN_OPTS")
_LIMITS = ["-XX:+UseSerialGC", "-XX:ReservedCodeCacheSize=128m"]


def _config(ctx):
    adapters = getattr(ctx, "adapter_configs", ctx.test_stack.get("adapters", {}))
    return adapters.get(NAME, {}) if isinstance(adapters, dict) else {}


def _no_metaspace(ctx, value):
    if isinstance(value, dict):
        for item in value.values():
            _no_metaspace(ctx, item)
    elif isinstance(value, (tuple, list)):
        for item in value:
            _no_metaspace(ctx, item)
    elif isinstance(value, str) and "maxmetaspacesize" in value.lower():
        raise ctx.core.StackError("MaxMetaspaceSize is refused: cap only the heap; metaspace caps caused JVM failures")


def jvm_args(ctx, role, heap=None, base_env=None):
    """Return role arguments; role environment overrides win over a requested heap.

    AGENT_JVM_HEAP_PROOF takes precedence over the legacy PROOF_API_HEAP alias.
    Maven itself has only its heap flag; test/proof JVMs use the serial collector.
    """
    if role not in _ROLES:
        raise ctx.core.StackError("JVM role must be test, maven or proof")
    config = _config(ctx)
    env = os.environ if base_env is None else base_env
    _no_metaspace(ctx, config)
    _no_metaspace(ctx, [env.get(name, "") for name in _ARG_ENV])
    chosen = env.get("AGENT_JVM_HEAP_" + role.upper())
    if chosen is None and role == "proof":
        chosen = env.get("PROOF_API_HEAP")
    if chosen is None:
        chosen = heap if heap is not None else config.get(role + "_heap", _DEFAULTS[role])
    if not isinstance(chosen, str) or not _HEAP.fullmatch(chosen):
        raise ctx.core.StackError("%s heap must look like 768m or 1g (positive integer)" % role)
    args = ["-Xmx" + chosen]
    if role == "proof":
        args.insert(0, "-Xms64m")
    if role != "maven":
        args.extend(_LIMITS)
    return args


def _java_home(ctx):
    value = _config(ctx).get("java_home")
    if not isinstance(value, str) or not value.strip():
        raise ctx.core.StackError("maven.java_home must name the configured JDK directory")
    path = Path(ctx.core.expand_path(value, "maven.java_home"))
    if not path.is_absolute():
        path = ctx.project_root / path
    return ctx.core.guard_path(path, ctx.machine)


def tool_env(ctx):
    """Environment a build listing ``tools: ["maven"]`` runs with: the configured JDK, the one its key records."""
    return {"JAVA_HOME": str(_java_home(ctx))}


def tool_versions(ctx):
    """Return the actual configured JDK release, without state or service creation."""
    path = ctx.core.guard_path(_java_home(ctx) / "release", ctx.machine)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ctx.core.StackError("cannot read configured JDK release file (%s)" % type(error).__name__)
    entries = [line for line in text.splitlines() if re.match(r"^\s*JAVA_VERSION\s*=", line)]
    match = re.fullmatch(r'\s*JAVA_VERSION="([0-9][A-Za-z0-9._+\-]*)"\s*', entries[0]) if len(entries) == 1 else None
    if match is None:
        raise ctx.core.StackError("configured JDK release must contain one valid quoted JAVA_VERSION")
    return {"jdk": match.group(1)}


def java_test_plan(ctx, worktree, db_env, maven_args, heap=None, base_env=None):
    """Build the configured command, guarded working directory and exact JVM flags."""
    config = _config(ctx)
    env = dict(os.environ if base_env is None else base_env)
    _no_metaspace(ctx, maven_args)
    test_args = jvm_args(ctx, "test", heap=heap, base_env=env)
    maven = jvm_args(ctx, "maven", base_env=env)
    command = config.get("command", ["./mvnw", "-B", "test"])
    if not isinstance(command, list) or not command or not all(isinstance(item, str) and item for item in command):
        raise ctx.core.StackError("maven.command must be a non-empty list of arguments")
    module = config.get("module", ".")
    if not isinstance(module, str) or not module:
        raise ctx.core.StackError("maven.module must name the command directory")
    cwd = ctx.core.guard_path(Path(worktree).expanduser().absolute() / module, ctx.machine)
    env.update(dict(db_env))
    _no_metaspace(ctx, [env.get(name, "") for name in _ARG_ENV])
    env["JAVA_HOME"] = str(_java_home(ctx))
    env["MAVEN_OPTS"] = " ".join(maven)
    return {"command": command + ["-DargLine=" + " ".join(test_args)] + list(maven_args),
            "cwd": str(cwd), "env": env}


class _Cancelled(BaseException):
    def __init__(self, signum):
        self.signum = signum


def _held(ctx):
    token = os.environ.get("AGENT_HEAVY_SLOT")
    if not token:
        return False
    queue = ctx.core.Slots(ctx.core.host_dir(ctx.machine), machine=ctx.machine)
    return ctx.core.valid_nested_slot(queue, token)


def _reenter(ctx, args, maven_args):
    if args.heavy_reentry:
        raise ctx.core.StackError("java-test heavy re-entry has no valid ancestor slot; refusing recursive admission")
    command = [sys.executable, "-B", str(Path(__file__).absolute().parents[1] / "test_stack.py"),
               "--project", ctx.project, "--state-root", str(ctx.root), "java-test",
               "--worktree", args.worktree, "--run", args.run, "--heavy-reentry",
               "--ram-gib", str(args.ram_gib), "--wait-min", str(args.wait_min)]
    if args.heap is not None:
        command += ["--heap", args.heap]
    if args.running:
        command.append("--running")
    if args.slots is not None:
        command += ["--slots", str(args.slots)]
    if args.allow_daytime:
        command.append("--allow-daytime")
    command += ["--"] + maven_args
    return ctx.core.heavy_run(command, ctx=ctx, label="java-test " + args.run,
                              ram_gib=args.ram_gib, wait_min=args.wait_min, slots=args.slots,
                              allow_daytime=args.allow_daytime)


def java_test(ctx, args):
    """Admit first; own the command group and exactly the returned database names.

    Pg.create_dbs owns partial-creation rollback until it returns its names. Cleanup
    failures retain Pg's registry records and are reported without replacing an
    original command failure or cancellation status.
    """
    database = _config(ctx).get("database", "postgres")
    adapter = ctx._adapters.get(database) if isinstance(database, str) else None
    if database != "postgres" or adapter is None:
        raise ctx.core.StackError("java-test requires the configured postgres adapter")
    maven_args = args.maven_args[1:] if args.maven_args[:1] == ["--"] else args.maven_args
    # Validate the complete effective command before admission or service mutation.
    java_test_plan(ctx, args.worktree, [], maven_args, args.heap)
    if not _held(ctx):
        return _reenter(ctx, args, maven_args)
    if threading.current_thread() is not threading.main_thread():
        raise ctx.core.StackError("java-test must run on the main thread to own cancellation cleanup")
    pg = adapter.Pg(ctx)
    names = None
    child = None
    previous = {}
    result = None
    failure = None
    cleanup_errors = []

    def forward(signum, _frame):
        if child is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(child.pid, signum)
        raise _Cancelled(signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            previous[signum] = signal.signal(signum, forward)
        pg.up()
        pg_config = ctx.test_stack.get("adapters", {}).get("postgres", {})
        created = pg.create_dbs(args.run, running=args.running, owner=ctx.core.resources.owner(),
                               fixed=bool(pg_config.get("fixed_names")))
        names = created["names"]
        plan = java_test_plan(ctx, args.worktree, pg.env_pairs(created["port"], names), maven_args, args.heap)
        try:
            child = subprocess.Popen(plan["command"], cwd=plan["cwd"], env=plan["env"], start_new_session=True)
        except OSError as error:
            raise ctx.core.StackError("cannot launch configured Maven command (%s)" % type(error).__name__) from error
        code = child.wait()
        result = 128 - code if code < 0 else code
    except _Cancelled as error:
        result = 128 + error.signum
    except BaseException as error:
        failure = error
    finally:
        for signum in previous:
            signal.signal(signum, signal.SIG_IGN)
        try:
            try:
                if child is not None:
                    ctx.core.resources.stop_group(child)
            except Exception as error:
                cleanup_errors.append(error)
            if names is not None:
                try:
                    pg.drop_names(names)
                except Exception as error:
                    cleanup_errors.append(error)
            if cleanup_errors:
                for error in cleanup_errors:
                    print("java-test cleanup failed; owned resources remain pending: %s" % error,
                          file=sys.stderr, flush=True)
                if result == 0:
                    result = 2
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)
    if failure is not None:
        raise failure
    return result


def _print_args(ctx, args):
    print(" ".join(jvm_args(ctx, args.role, heap=args.heap)))
    return 0


def add_commands(subparsers, ctx):
    """Register commands only: PostgreSQL is resolved later, after adapter loading."""
    java = subparsers.add_parser("java-test", help="run configured Maven tests under heavy admission")
    java.add_argument("--worktree", required=True)
    java.add_argument("--run", required=True)
    java.add_argument("--running", action="store_true")
    java.add_argument("--heap", help="test JVM heap, e.g. 1g")
    java.add_argument("--ram-gib", type=float, default=_config(ctx).get("ram_gib", 2))
    java.add_argument("--wait-min", type=float, default=30)
    java.add_argument("--slots", type=int)
    java.add_argument("--allow-daytime", action="store_true")
    java.add_argument("--heavy-reentry", action="store_true", help=argparse.SUPPRESS)
    java.add_argument("maven_args", nargs=argparse.REMAINDER)
    java.set_defaults(func=lambda args: java_test(ctx, args))
    jvm = subparsers.add_parser("jvm", help="shared JVM options")
    children = jvm.add_subparsers(dest="jvm_command", required=True)
    args = children.add_parser("args", help="print arguments for a JVM role")
    args.add_argument("--role", choices=_ROLES, required=True)
    args.add_argument("--heap")
    args.set_defaults(func=lambda args: _print_args(ctx, args))


def status(ctx):
    return {}


def gc(ctx):
    return {}
