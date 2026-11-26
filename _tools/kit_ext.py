#!/usr/bin/env python3
VERSION = "1.3.0"      # first, so the update check finds it within its first lines, ahead of the long docstring
__doc__ = """kit_ext.py -- the one loader for the plugins and extensions of the kit's vendored tools. Vendored into a project's
`_tools/` by project-scaffolding. A tool (scaffold_git.py, jira_sync.py, ...) loads this file by path
(importlib.util.spec_from_file_location; sys.path is never touched), declares its hook points and calls run().

The rule: a project never forks a kit file. It adds an extension. Extensions only ADD to what the kit does, and a failing
extension is skipped and reported while the core command carries on.

Two kinds of plugin, both loaded here
  kit plugin   shipped by the kit, vendored to <root>/_tools/plugins/<tool>/<name>.py (the whole plugins/ tree is the
               kit's: refreshed on update when its content differs). A kit plugin that has the line `ALWAYS_ON = True`
               at module level (read from the source, not by importing) runs in every project; without it, it is opt-in.
  extension    the project's own, <root>/_tools/ext/<tool>/<name>.py. The kit never writes, overwrites or deletes anything
               under _tools/ext/.
A plugin file name must match ^[a-z][a-z0-9_]*$ (so does a tool name).

Enabling: .claude/scaffolding.json may hold an "extensions" object, {"<tool>": ["name", ...]} or
{"<tool>": {"name": {config...}}}. A listed name loads the kit plugin of that name if there is one, else
_tools/ext/<tool>/<name>.py. A file on disk that is not listed does not load. An extension can never shadow a kit plugin of
the same name: the kit plugin wins and one warning says so. A listed name with no file is reported as a failure. A malformed entry
drops only its own tool's entry from the record (the other tools' entries still load), a malformed "extensions" value as a
whole drops them all; either way one warning is given, ALWAYS_ON kit plugins still run, and run() reports a Failure of kind
"Record" for the tool being run when the problem touches it (that tool's entry, or the whole value), so a hook point with
on_error="refuse" refuses instead of letting a gate open on a record it could not read.
Before a plugin file is executed, its module gets CONFIG = the config dict from the record ({} when none).

Hook points: the tool declares HookPoint(tool, name, args=("root", ...), check=fn, on_error="skip"|"refuse", doc="...").
A plugin provides a hook by defining a module-level function of the hook's name, called with the run() arguments (the
number must match args). check(result) returns None when the result is well-formed, else a short problem string. A plugin
may list the hooks it promises in a module-level PROVIDES tuple; a hook named there but not defined is a failure, any
other missing hook just means the plugin does not provide it.

API
  run(root, hook, *args, warn=None) -> RunResult
      Calls the hook in every plugin that provides it: ALWAYS_ON kit plugins first (sorted by name), then the enabled
      ones in record order. RunResult is a list of (plugin_name, result) for the plugins that succeeded, so it iterates
      and unpacks like a plain list; it also has .results (a plain list copy), .failures (a list of Failure, one per
      enabled plugin that is broken, including ones that failed on an earlier call) and .ok (True when .failures is empty).
      A tool whose hook has on_error="refuse" must refuse when .failures is not empty; a tool with on_error="skip" ignores
      them. Failure has .tool, .name (None for a Record failure), .kind, .message (and .raw, the exception's own text, and .hook, the hook being called) and str() "extension <tool>/<name> skipped: <Kind>: <message>".
  forget(root, tool=None): drop the remembered failures for the root (a gate called as a library asks for a fresh judgement;
      warnings stay once-only)
  enabled(root, tool) -> list of names that would load for the tool (no import, no warnings)
  status(root) -> dict, as the CLI prints it
  HookPoint(tool, name, args=(), check=None, on_error="skip", doc="", legacy=None)
  default_warn(line): one line to stderr

Public API for a tool that loads plugin-like modules itself (test_stack's adapters); a tool that calls these should check
they exist first, because the vendored kit_ext.py can be older than the tool (versions skew), and fall back to loading nothing:
  read_record(root) -> ({tool: [(name, config), ...]}, problems), problems a list of (tool, message): tool is None when the
      whole "extensions" value is malformed, else the tool whose entry was dropped
  plan(root, tool, listed, legacy=None) -> object with .entries (dicts: tool, name, kind, path, config), .failures, .warnings
  load(root, entry, warn) -> the entry's module, or None when it failed (already recorded and warned)
  fail(root, entry, kind, message, warn, raw=None, hook=None) -> Failure, recorded as skipped for the process and warned once
  warn_once(root, line, warn): warn(line) once per (root, line) per process

Legacy file: a hook point may carry legacy=(name, "relative/path.py", notice): a file a project already has at that path
loads as if it were an enabled extension called `name` (no record entry needed), after the others, and `notice` is given
to warn once. It is skipped when `name` is listed in the record or a kit plugin has that name. It is never offered for
promotion. This is only for a seam that existed before the loader (scaffold_git's _tools/scaffold_ext.py).

Failures are contained. An import error (any exception or SystemExit at import), a PROVIDES hook that is missing, an
exception or SystemExit when called, or a result that fails check() skips that plugin for the rest of the process, for
every hook, and warn(line) gets exactly one line for it. Kind is the exception's class name, or MissingHook, NotFound,
BadResult. Module objects are cached per (root, tool, name, file mtime, config) within a process. run() writes nothing,
not even bytecode.

Promotion path: every enabled project extension's sha256 is compared with the ledger .claude/kit-ext-filed.json,
{"<tool>/<name>": {"sha256": ..., "story": "SCAF-n"}} (commit it). An extension that is not in the ledger is "new"; one
whose hash differs is "changed"; either needs a backlog story proposing it as a kit feature.

CLI (exit 0 done, 2 refused)
  status --root DIR                      print JSON {enabled: {tool: [names]}, failures: [...], needs_promotion:
                                         [{tool, name, sha256, reason}]}; imports each enabled plugin to find failures
  mark-filed --root DIR TOOL/NAME --story KEY   record the extension's current hash against the story that proposes it
Standard library only.
"""
import argparse, hashlib, importlib.util, json, os, re, sys

NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
ALWAYS_ON_RE = re.compile(r"(?m)^ALWAYS_ON\s*=\s*True\s*(?:#.*)?$")
STORY_RE = re.compile(r"^[A-Z][A-Z0-9]*-[0-9]+$")
LEDGER = os.path.join(".claude", "kit-ext-filed.json")
ON_ERROR = ("skip", "refuse")

_MODULES = {}      # (root, tool, name, mtime_ns, config json) -> module
_FAILED = {}       # (root, tool, name) -> Failure; a plugin that failed stays skipped for the rest of the process
_WARNED = set()    # (root, line) already given to a warn callable


class HookPoint(object):
    """A place a tool lets plugins in. `args` names the arguments run() passes (documentation, and the count is enforced)."""

    def __init__(self, tool, name, args=(), check=None, on_error="skip", doc="", legacy=None):
        if not NAME_RE.match(tool or "") or not NAME_RE.match(name or ""):
            raise ValueError("hook point tool and name must match %s: %r %r" % (NAME_RE.pattern, tool, name))
        if on_error not in ON_ERROR:
            raise ValueError("on_error must be one of %s, not %r" % (ON_ERROR, on_error))
        self.tool, self.name, self.args = tool, name, tuple(args)
        self.check, self.on_error, self.doc = check, on_error, doc
        self.legacy = tuple(legacy) if legacy else None      # (name, path relative to the root, notice)

    def __repr__(self):
        return "HookPoint(%s.%s, on_error=%s)" % (self.tool, self.name, self.on_error)


class Failure(object):
    def __init__(self, tool, name, kind, message, raw=None, hook=None):
        self.tool, self.name, self.kind = tool, name, kind
        self.message = " ".join(str(message).split())
        self.raw = " ".join(str(message if raw is None else raw).split())      # the exception's own text, for a tool's own wording
        self.hook = hook                                                       # the hook being called when it failed, else None

    def __str__(self):
        if self.name is None:
            return "extensions for %s skipped: %s: %s" % (self.tool, self.kind, self.message)
        return "extension %s/%s skipped: %s: %s" % (self.tool, self.name, self.kind, self.message)

    __repr__ = __str__

    def as_dict(self):
        plugin = None if self.name is None else "%s/%s" % (self.tool, self.name)
        return {"plugin": plugin, "kind": self.kind, "message": self.message}


class RunResult(list):
    """A list of (plugin_name, result), plus .failures; see the module docstring."""

    def __init__(self, items=(), failures=()):
        list.__init__(self, items)
        self.failures = list(failures)
        self.kinds = {}        # plugin name -> "kit" | "ext": where each answer came from (a gate trusts only "kit")

    def kind_of(self, name):
        """"kit" when the answer named `name` came from a kit plugin (_tools/plugins/<tool>/), "ext" for a project
        extension, None when there is no such answer."""
        return self.kinds.get(name)

    @property
    def results(self):
        return list(self)

    @property
    def ok(self):
        return not self.failures


def default_warn(line):
    sys.stderr.write(line + "\n")


def warn_once(root, line, warn):
    if (root, line) not in _WARNED:
        _WARNED.add((root, line))
        warn(line)


def read_record(root):
    """({tool: [(name, config), ...]}, problems). problems is a list of (tool, message): a malformed entry drops only its
    own tool's entry (tool is that key); a malformed "extensions" value as a whole drops everything (tool is None)."""
    try:
        with open(os.path.join(root, ".claude", "scaffolding.json"), encoding="utf-8") as handle:
            record = json.load(handle)
    except (OSError, ValueError):
        return {}, []
    block = record.get("extensions") if isinstance(record, dict) else None
    if block is None:
        return {}, []
    if not isinstance(block, dict):
        return {}, [(None, "extensions in .claude/scaffolding.json is malformed: it is not an object; the extensions from "
                           "the record are ignored")]
    out, problems = {}, []
    for tool, value in block.items():
        try:
            if not NAME_RE.match(tool):
                raise ValueError("tool name %r is not %s" % (tool, NAME_RE.pattern))
            if isinstance(value, list):
                pairs = [(n, {}) for n in value]
            elif isinstance(value, dict):
                pairs = list(value.items())
            else:
                raise ValueError("it is neither a list of names nor an object of name: config")
            seen = []
            for name, config in pairs:
                if not isinstance(name, str) or not NAME_RE.match(name):
                    raise ValueError("name %r is not %s" % (name, NAME_RE.pattern))
                if not isinstance(config, dict):
                    raise ValueError("%s: the config is not an object" % name)
                if name in seen:
                    raise ValueError("%s is listed twice" % name)
                seen.append(name)
        except ValueError as e:
            problems.append((tool, "extensions.%s in .claude/scaffolding.json is malformed: %s; its extensions are ignored"
                             % (tool, e)))
            continue
        out[tool] = pairs
    return out, problems


class _Plan(object):
    def __init__(self):
        self.entries = []      # dicts: tool, name, kind ("kit" | "ext"), path, config
        self.failures = []     # Failure
        self.warnings = []     # str


def plan(root, tool, listed, legacy=None):
    """What would load for `tool` given `listed` [(name, config)]: a _Plan with .entries, .failures (listed names with no
    file) and .warnings (shadowing, the legacy notice). Imports nothing."""
    plan = _Plan()
    kitdir = os.path.join(root, "_tools", "plugins", tool)
    extdir = os.path.join(root, "_tools", "ext", tool)
    kit = {}
    try:
        names = sorted(os.listdir(kitdir))
    except OSError:
        names = []
    for fname in names:
        stem = fname[:-3]
        path = os.path.join(kitdir, fname)
        if fname.endswith(".py") and NAME_RE.match(stem) and os.path.isfile(path):
            kit[stem] = path
    always = []
    for name, path in kit.items():
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                if ALWAYS_ON_RE.search(handle.read()):
                    always.append(name)
        except OSError:
            pass
    configs = dict(listed)

    def entry(name, kind, path):
        plan.entries.append({"tool": tool, "name": name, "kind": kind, "path": path, "config": configs.get(name, {})})

    def shadow_check(name):
        if os.path.isfile(os.path.join(extdir, name + ".py")):
            plan.warnings.append("extension %s/%s ignored: a kit plugin of that name exists and wins" % (tool, name))

    for name in always:
        entry(name, "kit", kit[name])
        shadow_check(name)
    for name, _config in listed:
        if name in always:
            continue
        if name in kit:
            entry(name, "kit", kit[name])
            shadow_check(name)
            continue
        path = os.path.join(extdir, name + ".py")
        if os.path.isfile(path):
            entry(name, "ext", path)
        else:
            plan.failures.append(Failure(tool, name, "NotFound", "listed in .claude/scaffolding.json but there is no kit "
                                         "plugin plugins/%s/%s.py and no _tools/ext/%s/%s.py" % (tool, name, tool, name)))
    if legacy:
        lname, lrel, lnotice = legacy
        lpath = os.path.join(root, *lrel.split("/"))
        if lname not in configs and lname not in kit and os.path.isfile(lpath):
            entry(lname, "legacy", lpath)
            plan.warnings.append(lnotice)
    return plan


def fail(root, e, kind, message, warn, raw=None, hook=None):
    failure = Failure(e["tool"], e["name"], kind, message, raw, hook)
    _FAILED[(root, e["tool"], e["name"])] = failure
    warn_once(root, str(failure), warn)
    return failure


def load(root, e, warn):
    """The plugin's module, or None when it failed (already recorded and warned)."""
    if (root, e["tool"], e["name"]) in _FAILED:
        return None
    try:
        st = os.stat(e["path"])
        mtime = (st.st_mtime_ns, st.st_size, st.st_ino)
    except OSError as err:
        fail(root, e, type(err).__name__, err, warn)
        return None
    ckey = (root, e["tool"], e["name"], mtime, json.dumps(e["config"], sort_keys=True, default=str))
    if ckey in _MODULES:
        return _MODULES[ckey]
    # the root's hash is in the name, so two projects loaded by one process never share a module name
    modname = "kit_ext_plugin_%s_%s_%s" % (hashlib.sha1(root.encode("utf-8", "replace")).hexdigest()[:8], e["tool"], e["name"])
    keep = sys.dont_write_bytecode
    sys.dont_write_bytecode = True      # run() and status write nothing, not even __pycache__
    try:
        spec = importlib.util.spec_from_file_location(modname, e["path"])
        mod = importlib.util.module_from_spec(spec)
        mod.CONFIG = dict(e["config"])
        sys.modules[modname] = mod
        spec.loader.exec_module(mod)
    except (Exception, SystemExit) as err:
        sys.modules.pop(modname, None)
        fail(root, e, type(err).__name__, "at import: %s" % (err,), warn, raw=err)
        return None
    finally:
        sys.dont_write_bytecode = keep
    for old in [k for k in _MODULES if k[:3] == ckey[:3]]:
        del _MODULES[old]
    _MODULES[ckey] = mod
    return mod


def _call(root, e, mod, hook, args, results, warn):
    """Call the plugin's hook; append (name, result) to results, or record the failure."""
    provides = getattr(mod, "PROVIDES", ())
    provides = provides if isinstance(provides, (tuple, list)) else ()
    fn = getattr(mod, hook.name, None)
    if not callable(fn):
        if hook.name in provides:
            fail(root, e, "MissingHook", "PROVIDES names %s but the module defines no function of that name" % hook.name, warn)
        return
    try:
        result = fn(*args)
    except (Exception, SystemExit) as err:
        fail(root, e, type(err).__name__, "%s: %s" % (hook.name, err), warn, raw=err, hook=hook.name)
        return
    try:
        bad = hook.check(result) if hook.check else None
    except Exception as err:
        bad = "the check itself failed: %s: %s" % (type(err).__name__, err)
    if bad is not None:
        fail(root, e, "BadResult", "%s returned %r: %s" % (hook.name, result, bad), warn, hook=hook.name)
    else:
        results.append((e["name"], result))


def run(root, hook, *args, warn=None):
    root = os.path.abspath(root)
    warn = warn or default_warn
    if len(args) != len(hook.args):
        raise TypeError("hook %s.%s takes %d argument(s) %s, got %d" % (hook.tool, hook.name, len(hook.args), hook.args, len(args)))
    record, problems = read_record(root)
    results, failures = RunResult(), []
    for ptool, problem in problems:
        warn_once(root, problem, warn)
        if ptool is None or ptool == hook.tool:      # the record could not be read for this tool: say so, never let a gate open on it
            failures.append(Failure(hook.tool, None, "Record", problem))
    pl = plan(root, hook.tool, record.get(hook.tool, []), hook.legacy)
    for line in pl.warnings:
        warn_once(root, line, warn)
    for failure in pl.failures:
        warn_once(root, str(failure), warn)
        failures.append(failure)
    for e in pl.entries:
        mod = load(root, e, warn)
        if mod is not None:
            _call(root, e, mod, hook, args, results, warn)
            if results and results[-1][0] == e["name"]:
                results.kinds[e["name"]] = e["kind"]
        failed = _FAILED.get((root, e["tool"], e["name"]))
        if failed is not None:
            failures.append(failed)
    results.failures = failures
    return results


def forget(root, tool=None):
    """Clear the remembered failures for `root`, for one tool or all, so the next run() tries those plugins again. For a
    long-lived process whose gate must judge each call afresh (scaffold_git called as a library): without it a plugin that
    failed once stays skipped until the process ends. Warnings stay de-duplicated: a plugin that still fails is reported
    in .failures again but warned about only once."""
    root = os.path.abspath(root)
    for key in [k for k in _FAILED if k[0] == root and (tool is None or k[1] == tool)]:
        del _FAILED[key]


def enabled(root, tool):
    root = os.path.abspath(root)
    record, _problems = read_record(root)
    return [e["name"] for e in plan(root, tool, record.get(tool, [])).entries]


def _sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def _ledger(root):
    """(map, problem)."""
    try:
        with open(os.path.join(root, LEDGER), encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError:
        return {}, None
    except ValueError as e:
        return {}, "%s is not valid JSON: %s" % (LEDGER, e)
    if not isinstance(data, dict) or not all(isinstance(v, dict) for v in data.values()):
        return {}, "%s is not an object of tool/name: {sha256, story}" % LEDGER
    return data, None


def status(root):
    root = os.path.abspath(root)
    record, problems = read_record(root)
    tools = list(record)
    try:
        tools += [t for t in sorted(os.listdir(os.path.join(root, "_tools", "plugins"))) if NAME_RE.match(t) and t not in tools]
    except OSError:
        pass
    out = {"enabled": {}, "failures": [], "needs_promotion": []}
    for _tool, problem in problems:
        out["failures"].append({"plugin": None, "kind": "Record", "message": problem})
    ledger, ledger_problem = _ledger(root)
    if ledger_problem:
        out["failures"].append({"plugin": None, "kind": "Ledger", "message": ledger_problem})
    quiet = lambda line: None
    for tool in tools:
        pl = plan(root, tool, record.get(tool, []))
        if pl.entries:
            out["enabled"][tool] = [e["name"] for e in pl.entries]
        out["failures"] += [f.as_dict() for f in pl.failures]
        out["failures"] += [{"plugin": None, "kind": "Shadowed", "message": w} for w in pl.warnings]
        for e in pl.entries:
            load(root, e, quiet)
            failed = _FAILED.get((root, tool, e["name"]))
            if failed is not None:
                out["failures"].append(failed.as_dict())
            if e["kind"] == "ext":
                digest = _sha256(e["path"])
                filed = ledger.get("%s/%s" % (tool, e["name"]))
                reason = "new" if not filed else ("changed" if filed.get("sha256") != digest else None)
                if reason:
                    out["needs_promotion"].append({"tool": tool, "name": e["name"], "sha256": digest, "reason": reason})
    return out


def mark_filed(root, ref, story):
    """Record the current hash of project extension `ref` ("tool/name") against `story`. Returns the ledger entry; raises
    ValueError when the request is refused."""
    root = os.path.abspath(root)
    parts = ref.split("/")
    if len(parts) != 2 or not all(NAME_RE.match(p) for p in parts):
        raise ValueError("%r is not <tool>/<name>" % ref)
    if not STORY_RE.match(story or ""):
        raise ValueError("%r is not a story key such as SCAF-12" % story)
    path = os.path.join(root, "_tools", "ext", parts[0], parts[1] + ".py")
    if not os.path.isfile(path):
        raise ValueError("there is no project extension at _tools/ext/%s/%s.py" % tuple(parts))
    ledger, problem = _ledger(root)
    if problem:
        raise ValueError(problem)
    entry = {"sha256": _sha256(path), "story": story}
    ledger[ref] = entry
    dest = os.path.join(root, LEDGER)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = "%s.%s.tmp" % (dest, os.getpid())
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(ledger, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, dest)
    return entry


def main(argv=None):
    ap = argparse.ArgumentParser(description="Status of the kit's plugins and extensions in a project.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status")
    st.add_argument("--root", required=True)
    mf = sub.add_parser("mark-filed")
    mf.add_argument("--root", required=True)
    mf.add_argument("ref", metavar="TOOL/NAME")
    mf.add_argument("--story", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "status":
        print(json.dumps(status(a.root), indent=2))
        return 0
    try:
        entry = mark_filed(a.root, a.ref, a.story)
    except (ValueError, OSError) as e:
        print("REFUSED: %s" % e, file=sys.stderr)
        return 2
    print(json.dumps({"filed": a.ref, "sha256": entry["sha256"], "story": entry["story"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
