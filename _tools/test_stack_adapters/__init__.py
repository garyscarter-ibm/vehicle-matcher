"""Load project-enabled test-stack adapters (adjacent modules, or project extensions) through kit_ext, fault-isolated."""
import importlib.util
import os
from pathlib import Path
import re
import sys


_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_REQUIRED = ("add_commands", "status", "gc")
_KIT_EXT_API = ("default_warn", "read_record", "plan", "load", "fail", "warn_once")      # public since kit_ext 1.2.0


def _configured(ctx, error_type):
    value = ctx.test_stack.get("adapters", {})
    if value is None:
        return {}
    if isinstance(value, list):
        if not all(isinstance(name, str) for name in value):
            raise error_type('project "test_stack.adapters" must contain adapter names')
        value = {name: {} for name in value}
    if not isinstance(value, dict):
        raise error_type('project "test_stack.adapters" must be an object or list')
    if not all(isinstance(name, str) and isinstance(config, dict) for name, config in value.items()):
        raise error_type('project "test_stack.adapters" must map names to objects')
    return value


def _kit_ext(directory):
    """The shared loader kit_ext.py, two levels up from here: _tools/kit_ext.py, next to test_stack.py (loaded by path)."""
    cached = getattr(_kit_ext, "module", None)
    if cached is None:
        path = directory.parent / "kit_ext.py"
        spec = importlib.util.spec_from_file_location("agent_test_stack_kit_ext", path) if path.is_file() else None
        if spec is None or spec.loader is None:
            raise FileNotFoundError("cannot load adjacent kit_ext.py")
        cached = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cached)
        _kit_ext.module = cached
    return cached


def _interface_problem(module, name):
    if getattr(module, "NAME", None) != name:
        return "NAME is not %r" % name
    missing = [attr for attr in _REQUIRED if not callable(getattr(module, attr, None))]
    return "missing required function(s): %s" % ", ".join(missing) if missing else None


def load_adapters(ctx, subparsers, error_type=RuntimeError):
    """Load the enabled adapters and attach their CLI commands. An adapter is the configured adjacent ``<name>.py``
    (test_stack.adapters in the project record) or a project extension ``_tools/ext/test_stack/<name>.py`` listed in
    extensions.test_stack, both through kit_ext's loader. One that fails to import, lacks a required function, or whose
    add_commands raises is skipped with one warning line (kit_ext's wording); the others and the core commands carry on."""
    configured = _configured(ctx, error_type)
    ctx.adapter_configs = configured
    directory = Path(__file__).resolve().parent
    for name in configured:
        if not _NAME.fullmatch(name):
            raise error_type("adapter name must be a simple identifier")
    try:
        ke = _kit_ext(directory)
    except Exception as error:
        # No loader, no isolation: skip every adapter rather than load one unguarded. Core commands still work.
        if configured:
            sys.stderr.write("test_stack adapters skipped: cannot load adjacent kit_ext.py (%s)\n" % type(error).__name__)
        return ctx._adapters
    try:
        _load_through(ke, ctx, subparsers, directory, configured)
    except Exception as error:
        # kit_ext.py can be older than this file (two vendoring routes), or break: skip the adapters, keep the core commands.
        sys.stderr.write("test_stack adapters skipped: kit_ext.py is not usable here (%s: %s)\n"
                         % (type(error).__name__, " ".join(str(error).split())))
    return ctx._adapters


def _load_through(ke, ctx, subparsers, directory, configured):
    for needed in _KIT_EXT_API:
        if not callable(getattr(ke, needed, None)):
            raise AttributeError("kit_ext.py has no %s (an older version)" % needed)
    warn = ke.default_warn
    root = os.path.abspath(ctx.project)
    entries = [{"tool": "test_stack", "name": name, "kind": "adapter", "path": os.fspath(directory / (name + ".py")),
                "config": config} for name, config in configured.items()]
    record, problems = ke.read_record(root)
    for tool, problem in problems:
        if tool is None or tool == "test_stack":
            ke.warn_once(root, problem, warn)
    plan = ke.plan(root, "test_stack", record.get("test_stack", []))
    for line in plan.warnings:
        ke.warn_once(root, line, warn)
    for failure in plan.failures:
        ke.warn_once(root, str(failure), warn)
    taken = set(configured)
    for e in plan.entries:
        if e["name"] in taken:
            ke.warn_once(root, "extension test_stack/%s ignored: an adapter of that name is configured in "
                         "test_stack.adapters" % e["name"], warn)
        else:
            taken.add(e["name"])
            entries.append(e)
    for e in entries:
        name = e["name"]
        if name in ctx._adapters:
            continue
        if not os.path.isfile(e["path"]):
            ke.fail(root, e, "NotFound", "configured adapter module is missing: %s" % e["path"], warn)
            continue
        module = ke.load(root, e, warn)
        if module is None:
            continue
        problem = _interface_problem(module, name)
        if problem:
            ke.fail(root, e, "BadInterface", "invalid adapter interface: %s" % problem, warn)
            continue
        try:
            module.add_commands(subparsers, ctx)
        except (Exception, SystemExit) as error:
            ke.fail(root, e, type(error).__name__, "add_commands: %s" % (error,), warn)
            continue
        ctx._adapters[name] = module


def _each(ctx, attribute):
    out = {}
    for name, module in ctx._adapters.items():
        try:
            out[name] = getattr(module, attribute)(ctx)
        except (Exception, SystemExit) as error:
            out[name] = {"error": "%s: %s" % (type(error).__name__, " ".join(str(error).split()))}
    return out


def status(ctx):
    return _each(ctx, "status")


def gc(ctx):
    return _each(ctx, "gc")
