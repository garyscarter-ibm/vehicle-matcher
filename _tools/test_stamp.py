#!/usr/bin/env python3
"""test_stamp.py -- scoped validation by default, bounded resumable execution, and full-suite stamps when required.
Vendored into a project's `_tools/` by project-scaffolding;
the project's own settings say what "the tests" are.

Usage (from anywhere; the project root is the parent of this file's folder unless --root is given)
  test_stamp.py --affected [BASE]  T1. The tests affected by what changed in BASE...HEAD plus uncommitted changes, for
                                   languages that have an affected-test plug-in (python and maven; see "Language
                                   plug-ins"). Prints its choice, then runs it. For any other language, or when the
                                   plug-in fails or cannot tell, it says so and runs the full suite instead.
                                   BASE defaults to the record's `base_branch`, else main, else master.
  test_stamp.py --targeted [BASE] [--command CMD] [--reason TEXT]
                                   Strict scoped validation: select affected tests or run exactly CMD. Unsupported,
                                   uncertain or empty automatic selections require --command (exit 2). Successful
                                   runs write targeted evidence, including dirty code identity, never a full stamp.
  test_stamp.py --full [--jobs N] [--force]
                                   T2. The whole suite for a documented broad effect or required checkpoint.
                                   On a tree that already has a
                                   passing stamp it prints the stamp and exits 0 without running, unless --force.
  test_stamp.py --status           Print the stamp that matches this tree, or `none` (exit 1).
  --variant NAME                   Run (or look up) a named variant of the suite: its extra environment, and its own
                                   stamp. Variants are declared in the settings, e.g. one with ACM_SITE=1 that makes
                                   the suite also exercise a live site; the stamp for it is separate.
  --command CMD                    Use CMD instead of the settings' test command.
  --dry-run (with --full, --affected or --targeted)   print the plan and run nothing.
  --resume                        Resume a matching checkpoint; completed chunks are reused only for the same
                                  code, configured inputs, environment, interpreter, variant and selected ids.

Settings: the "tests" block of <project>/.claude/scaffolding.json
  {"tests": {"command": "python3 -B -m unittest discover -s tests",   # run once for --full (through the shell)
             "cwd": ".",                                              # where it runs, relative to the project root
             "language": "python",                                    # picks the affected-test plug-in: python, maven;
                                                                      # free text else (no plug-in)
             "t0_paths": ["docs/", "*.md", "backlog/"],               # docs-only paths: they run nothing, and a
                                                                      # change to them keeps a stamp
             "python": {"roots": ["tools", "tests"],                  # the python plug-in's settings (tests.<language>)
                        "test_glob": "tests/test_*.py", "unittest_top": "."},
             "maven": {"args": ["-B"], "goal": "test"},               # the maven plug-in's settings
             "variants": {"site": {"env": {"ACM_SITE": "1"}}},        # --variant site
             "jobs": 1}}                                              # default for --jobs
  Only `command` is needed. With no "tests" block the command falls back to `inbox.test` from the same record. With
  neither (and no --command) the run stops with exit 2 and says what to add.
  A t0_paths entry ending in "/" matches that folder from the project root, an entry with * ? [ matches the whole
  path as a glob (* also crosses folders, so "*.md" is every markdown file), anything else is one exact path.

Stamp
  A passing --full on a clean tree writes stamp-<key>-<variant>.json in <shared checkout>/.claude/test-runs/: the
  key, the real tree hash (HEAD^{tree}) and HEAD for information, time, Ran count (python only), wall seconds, the
  variant, the Python version. The key is the sha256 of `git ls-tree -r HEAD` without the docs-only (T0) paths, so a
  result block or doc edit committed after the run keeps the stamp, and any other change loses it. "Clean" ignores
  git-ignored files and uncommitted T0 files; any other uncommitted file means no stamp is recorded or reused. The
  shared checkout is found from `git rev-parse --git-common-dir`, so every worktree reads the same stamps. They are
  never committed (.claude/ should be git-ignored). $TEST_STAMP_DIR overrides the folder (the tests use it).

Running
  A command that is not run by the python plug-in runs through the shell, in `cwd`, with the variant's
  environment added and owned temporary paths. Output is bounded in <test-runs>/logs/. The language plug-in
  (see below) runs the suite itself when it applies: the python plug-in runs independent unittest chunks when the
  language is python, no --command is given and the command mentions unittest. Timings and resource headroom plan
  chunks; --jobs is an upper bound and low headroom serialises work. Other commands are indivisible supervised units.

Language plug-ins (tests.language picks one; the kit's are affected/python.py and affected/maven.py next to this file)
  A plug-in is a module with these module-level functions (affected/python.py is the reference; all paths are
  relative to `cwd`, the folder the tests run in, unless noted):
    applies(st, command_overridden) -> bool        optional; whether the plug-in drives this run. Default: true unless
                                                   --command was given. python: "unittest" in the command and no
                                                   --command. maven: "mvn" in the command and no --command. When it is
                                                   false the plug-in is not used: the configured command runs as is.
    settings(raw) -> cfg                           `raw` is the "tests.<language>" block (None when absent); returns the
                                                   plug-in's settings with defaults applied. ValueError(message) means
                                                   the project's settings are wrong: reported as an error (exit 2).
    discover_modules(cwd, cfg) -> [id]             sorted ids of the units of test selection: python test modules,
                                                   maven modules (folder relative to cwd).
    select_affected(cwd, cwd_rel, cfg, changed, is_t0, modules) -> (kind, ids, notes)
                                                   `changed` are project-root-relative git paths, is_t0(path) says
                                                   whether a path is docs-only. kind is
                                                     "none"     nothing to run (T0 paths only);
                                                     "some"     run `ids` (a subset of `modules`);
                                                     "full"     run everything; notes[0] says why;
                                                     "unknown"  the plug-in cannot tell what the change affects:
                                                                run everything, and say it could not tell.
    run_bounded(cwd, cfg, modules, jobs, rdir, log_dir, env, say, dry_run, identity, resources_raw=None, resume=False,
                project=None) -> None | (ok, ran, skipped, wall)
                                                   run `modules` inside the resource contract (tests.resources, via
                                                   test_resources.execute); None for a dry run.
  "unknown" is never "nothing affected". A plug-in that raises, exits, returns an unknown or malformed answer, or fails
  to import falls back to the documented broad plan, the full test command, and says so on a line that names the plug-in
  and the reason: `falling back to the full suite (plug-in <language> failed): ...` or `(plug-in <language> could not
  tell): ...`. kind "full" is a plug-in's own decision, `falling back to the full suite: <reason>`. Under --targeted a
  failing or unknown plug-in is refused (exit 2), never a fallback. A failing plug-in is isolated by kit_ext (one stderr
  line `extension test_stamp/<language> skipped: ...`, skipped for the rest of the process).
  The kit's plug-ins live in affected/<language>.py. A project's own may live in _tools/ext/test_stamp/<language>.py
  when "<language>" is listed in "extensions": {"test_stamp": ["<language>"]} of .claude/scaffolding.json; the kit's
  plug-in of the same name wins (one warning). It sees CONFIG, the extension's config from the record.
  tests.resources configures the budgets, immutable input identities and output destination; see
  docs/design/2026-11-03-test-resources.md in agent-scaffolding. Only finished owned log folders are pruned.

Exit codes
  0  tests passed (or reused a stamp, or nothing was affected, or --status found a stamp)
  1  the tests failed, errored or crashed; or --status found none
  2  bad usage, missing settings, or git failed

Standard library only."""
import argparse
import fnmatch
import hashlib
import importlib.util
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import time

VERSION = "1.3.1"

sys.dont_write_bytecode = True
TOOLS = os.path.dirname(os.path.abspath(__file__))
DEFAULT_JOBS = 1
BASE_CANDIDATES = ("main", "master")
KEEP_LOG_FOLDERS = 6
DEFAULT_T0 = ["docs/", "*.md", "backlog/"]
UNSPECIFIED = "unspecified"


class RunError(Exception):
    pass


def resource_module():
    spec = importlib.util.spec_from_file_location("test_stamp_resources", os.path.join(TOOLS, "test_resources.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------- git and the shared folder

def _git(root, args):
    p = subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True)
    if p.returncode != 0:
        raise RunError("git %s failed: %s" % (" ".join(args), (p.stderr or p.stdout).strip()[:300]))
    return p.stdout


def tree_hash(root):
    return _git(root, ["rev-parse", "HEAD^{tree}"]).strip()


def head_commit(root):
    return _git(root, ["rev-parse", "HEAD"]).strip()


def dirty_lines(root):
    """Uncommitted changes, git-ignored files left out: (status code, path) pairs, renames giving both paths."""
    out = _git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])
    parts = out.split("\0")
    res, i = [], 0
    while i < len(parts):
        e = parts[i]
        i += 1
        if len(e) < 4:
            continue
        code, path = e[:2], e[3:]
        res.append((code, path))
        if "R" in code or "C" in code:
            if i < len(parts) and parts[i]:
                res.append((code, parts[i]))
            i += 1
    return res


def dirty_code_lines(root, is_t0):
    """dirty_lines without the docs-only (T0) paths: what blocks recording or reusing a stamp."""
    return [(c, p) for c, p in dirty_lines(root) if not is_t0(p)]


def stamp_key(root, is_t0):
    """What a stamp is keyed on: sha256 of HEAD's tree without the docs-only (T0) paths: mode, type, object id and
    path of every other entry. A result block or doc edit committed after the run leaves it unchanged."""
    out = _git(root, ["ls-tree", "-r", "-z", "HEAD"])
    h = hashlib.sha256()
    for entry in out.split("\0"):
        if not entry:
            continue
        meta, _, path = entry.partition("\t")
        if is_t0(path):
            continue
        h.update(("%s\t%s\0" % (meta, path)).encode("utf-8", "surrogateescape"))
    return h.hexdigest()


def shared_checkout(root):
    common = _git(root, ["rev-parse", "--git-common-dir"]).strip()
    return os.path.dirname(os.path.normpath(os.path.join(root, common)))


def runs_dir(root):
    env = os.environ.get("TEST_STAMP_DIR")
    if env:
        return os.path.abspath(env)
    return os.path.join(shared_checkout(root), ".claude", "test-runs")


def ref_exists(root, ref):
    p = subprocess.run(["git", "-C", root, "rev-parse", "--verify", "--quiet", ref + "^{commit}"],
                       capture_output=True, text=True)
    return p.returncode == 0


def changed_files(root, base):
    """The paths that differ between base and HEAD: what HEAD's branch changed since it left base (three-dot)."""
    return [l for l in _git(root, ["diff", "--name-only", "%s...HEAD" % base]).splitlines() if l]


def changed_paths(root, base):
    paths = set(changed_files(root, base))
    for _code, p in dirty_lines(root):
        paths.add(p)
    return sorted(paths)


def resolve_base(root, requested, record_base):
    """BASE for --affected: the one asked for, else the record's base branch, else main, else master."""
    if requested:
        return requested
    for cand in ([record_base] if record_base else []) + list(BASE_CANDIDATES):
        if ref_exists(root, cand):
            return cand
    raise RunError("no base branch found (tried %s); pass one: --affected BASE"
                   % ", ".join(([record_base] if record_base else []) + list(BASE_CANDIDATES)))


# ---------------------------------------------------------------- files

def _atomic_write_json(path, obj):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _prune_logs(log_root):
    try:
        names = sorted(n for n in os.listdir(log_root) if os.path.isdir(os.path.join(log_root, n))
                       and not os.path.islink(os.path.join(log_root, n))
                       and (_read_json(os.path.join(log_root, n, "run.json"), {}) or {}).get("finished"))
    except OSError:
        return
    for n in names[:-KEEP_LOG_FOLDERS]:
        d = os.path.join(log_root, n)
        for fn in os.listdir(d):
            try:
                os.unlink(os.path.join(d, fn))
            except OSError:
                pass
        try:
            os.rmdir(d)
        except OSError:
            pass


# ---------------------------------------------------------------- settings

class Settings:
    """What to run, read from <root>/.claude/scaffolding.json (plus --command)."""

    def __init__(self, root, command, cwd_rel, language, t0, python, variants, jobs, base_branch):
        self.root, self.command, self.cwd_rel, self.language = root, command, cwd_rel, language
        self.t0_patterns, self.python, self.variants, self.jobs = t0, python, variants, jobs
        self.base_branch = base_branch
        self.resources = {}
        self.plugin_block = python      # the "tests.<language>" block the language plug-in reads (None when absent)
        self.cwd = os.path.normpath(os.path.join(root, cwd_rel))

    def is_t0(self, path):
        for pat in self.t0_patterns:
            if pat.endswith("/"):
                if path.startswith(pat):
                    return True
            elif any(c in pat for c in "*?["):
                if fnmatch.fnmatchcase(path, pat):
                    return True
            elif path == pat:
                return True
        return False


def load_settings(root, command_override=None):
    path = os.path.join(root, ".claude", "scaffolding.json")
    record = None
    if os.path.isfile(path):
        record = _read_json(path, None)
        if not isinstance(record, dict):
            raise RunError("%s is not a JSON object" % path)
    record = record or {}
    tests = record.get("tests")
    if tests is not None and not isinstance(tests, dict):
        raise RunError('"tests" in %s must be an object' % path)
    tests = tests or {}
    inbox = record.get("inbox") if isinstance(record.get("inbox"), dict) else {}
    command = command_override or tests.get("command") or inbox.get("test")
    if not command or not isinstance(command, str):
        raise RunError(
            'no test command: add a "tests" block to %s, e.g. {"tests": {"command": "python3 -B -m unittest discover '
            '-s tests"}}, or set "inbox.test", or pass --command' % path)
    cwd_rel = tests.get("cwd", ".")
    t0 = tests.get("t0_paths", DEFAULT_T0)
    variants = tests.get("variants", {})
    jobs = tests.get("jobs", DEFAULT_JOBS)
    if not isinstance(cwd_rel, str) or os.path.isabs(cwd_rel) or ".." in cwd_rel.split("/"):
        raise RunError('"tests.cwd" must be a folder inside the project, relative to its root')
    if not (isinstance(t0, list) and all(isinstance(p, str) for p in t0)):
        raise RunError('"tests.t0_paths" must be a list of strings')
    if not isinstance(variants, dict) or not all(isinstance(v, dict) and isinstance(v.get("env", {}), dict)
                                                 for v in variants.values()):
        raise RunError('"tests.variants" must map a name to {"env": {...}}')
    if not isinstance(jobs, int) or isinstance(jobs, bool) or jobs < 1:
        raise RunError('"tests.jobs" must be a whole number of at least 1')
    language = tests.get("language") or UNSPECIFIED
    python = tests.get("python")
    base = record.get("base_branch") if isinstance(record.get("base_branch"), str) else None
    st = Settings(root, command, cwd_rel.rstrip("/") or ".", str(language), t0, python, variants, jobs, base)
    st.resources = tests.get("resources", {})
    block = tests.get(st.language) if re.fullmatch(r"[a-z][a-z0-9_]*", st.language) else None
    st.plugin_block = python if st.language == "python" else block if isinstance(block, dict) else None
    resource_module().Policy(st.resources)
    return st


def variant_env(st, name):
    """(stamp suffix, extra environment) for --variant NAME."""
    if not name:
        return "default", {}
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise RunError("--variant %r: use letters, digits, - _ . only" % name)
    if name not in st.variants:
        known = ", ".join(sorted(st.variants)) or "none declared"
        raise RunError('--variant %s is not in "tests.variants" (%s)' % (name, known))
    env = st.variants[name].get("env", {})
    return name, {str(k): str(v) for k, v in env.items()}


# ---------------------------------------------------------------- plug-ins

class PluginFailed(RunError):
    """A language plug-in failed, or answered in a way the contract does not allow."""


PLUGIN_ERRORS = {}      # (root, language) -> the one line saying why the plug-in is skipped for the rest of this process
_PLUGIN_ENTRIES = {}    # (root, language) -> the kit_ext entry it was loaded as
_KIT_EXT = []
_KIT_EXT_API = ("default_warn", "read_record", "load", "fail", "warn_once")


def _kit_ext():
    """kit_ext.py beside this file (loaded by path), or None when it is missing or older than the API used here."""
    if not _KIT_EXT:
        found = None
        try:
            spec = importlib.util.spec_from_file_location("test_stamp_kit_ext", os.path.join(TOOLS, "kit_ext.py"))
            found = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(found)
            if not all(callable(getattr(found, n, None)) for n in _KIT_EXT_API):
                found = None
        except (Exception, SystemExit):
            found = None
        _KIT_EXT.append(found)
    return _KIT_EXT[0]


def _plugin_root(root):
    return os.path.abspath(root or os.path.dirname(TOOLS))


def plugin_failure(root, language):
    """The line saying why the language's plug-in is skipped (it failed earlier in this process), else None."""
    return PLUGIN_ERRORS.get((_plugin_root(root), language))


def _fail_plugin(root, language, kind, message):
    """Record the plug-in as skipped for the rest of the process: kit_ext's one warning line, kept in PLUGIN_ERRORS."""
    ke, key = _kit_ext(), (root, language)
    if ke is None:
        line = "extension test_stamp/%s skipped: %s: %s" % (language, kind, " ".join(str(message).split()))
        sys.stderr.write(line + "\n")
    else:
        entry = _PLUGIN_ENTRIES.get(key) or {"tool": "test_stamp", "name": language, "kind": "kit", "path": "", "config": {}}
        line = str(ke.fail(root, entry, kind, message, ke.default_warn))
    PLUGIN_ERRORS[key] = line


def load_plugin(language, root=None):
    """The affected-test plug-in for `language`, or None (no such plug-in, or it failed: see plugin_failure).
    The kit's is affected/<language>.py next to this file; a project's own is _tools/ext/test_stamp/<language>.py, when
    `language` is listed in .claude/scaffolding.json extensions.test_stamp. The kit's wins on a clash (one warning).
    Loaded through kit_ext, so a plug-in that fails to import is skipped with one warning line and the core carries on."""
    if not re.fullmatch(r"[a-z][a-z0-9_]*", language or ""):
        return None
    root = _plugin_root(root)
    key = (root, language)
    if key in PLUGIN_ERRORS:
        return None
    kit_path = os.path.join(TOOLS, "affected", language + ".py")
    ext_path = os.path.join(root, "_tools", "ext", "test_stamp", language + ".py")
    ke = _kit_ext()
    listed = {}
    if ke is not None:
        record, problems = ke.read_record(root)
        for tool, problem in problems:
            if tool is None or tool == "test_stamp":
                ke.warn_once(root, problem, ke.default_warn)
        listed = dict(record.get("test_stamp", []))
    if os.path.isfile(kit_path):
        entry = {"tool": "test_stamp", "name": language, "kind": "kit", "path": kit_path,
                 "config": listed.get(language, {})}
        if ke is not None and language in listed and os.path.isfile(ext_path):
            ke.warn_once(root, "extension test_stamp/%s ignored: a kit plug-in of that name exists and wins" % language,
                         ke.default_warn)
    elif language in listed:
        entry = {"tool": "test_stamp", "name": language, "kind": "ext", "path": ext_path, "config": listed[language]}
        if not os.path.isfile(ext_path):
            _PLUGIN_ENTRIES[key] = entry
            _fail_plugin(root, language, "NotFound", "listed in .claude/scaffolding.json but there is no kit plug-in "
                         "affected/%s.py and no _tools/ext/test_stamp/%s.py" % (language, language))
            return None
    else:
        return None
    _PLUGIN_ENTRIES[key] = entry
    if ke is None:
        if entry["kind"] == "ext":
            _fail_plugin(root, language, "NoLoader", "project plug-ins need kit_ext.py beside test_stamp.py")
            return None
        try:      # an old vendored tool set without the shared loader: still isolate a failing kit plug-in
            spec = importlib.util.spec_from_file_location("test_stamp_affected_" + language, kit_path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except (Exception, SystemExit) as error:
            _fail_plugin(root, language, type(error).__name__, "at import: %s" % (error,))
            return None

    def warn(line):      # kit_ext.load calls this once, when the import fails
        PLUGIN_ERRORS[key] = line
        ke.default_warn(line)
    return ke.load(root, entry, warn)


def _plugin_call(st, what, fn, *args):
    """Call a plug-in function. An exception or SystemExit skips the plug-in for the rest of the process (one warning
    line, kit_ext's wording) and raises PluginFailed, which callers turn into a labelled fallback to the broad plan."""
    try:
        return fn(*args)
    except (Exception, SystemExit) as error:
        if isinstance(error, RunError) or "ResourceError" in [c.__name__ for c in type(error).__mro__]:
            raise      # the tool's own refusals (bad settings, git, the resource contract) are not the plug-in failing
        _fail_plugin(_plugin_root(st.root), st.language, type(error).__name__, "%s: %s" % (what, error))
        raise PluginFailed(plugin_failure(st.root, st.language))


def plugin_in_play(st):
    """True when a language plug-in other than python exists for this project's language and it has settings (its
    tests.<language> block): only then does that block belong in the execution identity, so a project with no plug-in keeps
    the stamps it had. A plug-in that fails at run time still counts (the identity must not change mid-run)."""
    if st.plugin_block is None or st.language == "python":
        return False
    load_plugin(st.language, st.root)
    entry = _PLUGIN_ENTRIES.get((_plugin_root(st.root), st.language))
    return bool(entry) and os.path.isfile(entry.get("path") or "")


def plugin_for_run(st, command_overridden):
    """(plug-in, its settings) when the language plug-in drives this suite, else (None, None). A plug-in drives it when
    it says so: its applies(st, command_overridden) (default: no --command was given). One that fails is skipped."""
    plugin = load_plugin(st.language, st.root)
    if plugin is None:
        return None, None
    applies = getattr(plugin, "applies", None)
    try:
        if callable(applies):
            if not _plugin_call(st, "applies", applies, st, command_overridden):
                return None, None
        elif command_overridden:
            return None, None
    except PluginFailed:
        return None, None
    try:
        return plugin, plugin.settings(st.plugin_block)
    except ValueError as e:
        raise RunError("tests.%s" % e)
    except (Exception, SystemExit) as error:
        _fail_plugin(_plugin_root(st.root), st.language, type(error).__name__, "settings: %s" % (error,))
        return None, None


def plugin_select(st, plugin, pcfg, changed, modules):
    """plugin.select_affected, checked: (kind, chosen, notes) with kind none, some, full or unknown. Raises PluginFailed
    when the plug-in raises or answers in a shape the contract does not allow."""
    answer = _plugin_call(st, "select_affected", plugin.select_affected, st.cwd, st.cwd_rel, pcfg, changed,
                          st.is_t0, modules)
    problem = None
    try:
        kind, chosen, notes = answer
        if kind not in ("none", "some", "full", "unknown"):
            problem = "kind %r is not none, some, full or unknown" % (kind,)
        elif not (isinstance(chosen, (list, tuple)) and all(isinstance(c, str) for c in chosen)
                  and set(chosen) <= set(modules)):
            problem = "the chosen ids are not a list of ids from discover_modules"
        elif kind == "some" and not chosen:
            problem = "kind some with no ids"
        elif not (isinstance(notes, (list, tuple)) and all(isinstance(n, str) for n in notes)):
            problem = "notes is not a list of strings"
    except (TypeError, ValueError):
        problem = "expected (kind, ids, notes)"
    if problem:
        _fail_plugin(_plugin_root(st.root), st.language, "BadResult", "select_affected returned %r: %s" % (answer, problem))
        raise PluginFailed(plugin_failure(st.root, st.language))
    return kind, list(chosen), list(notes) or ["no reason given"]


def plugin_modules(st, plugin, pcfg):
    """plugin.discover_modules, checked: a sorted list of ids. Raises PluginFailed like plugin_select."""
    found = _plugin_call(st, "discover_modules", plugin.discover_modules, st.cwd, pcfg)
    if not (isinstance(found, (list, tuple)) and all(isinstance(m, str) for m in found)):
        _fail_plugin(_plugin_root(st.root), st.language, "BadResult",
                     "discover_modules returned %r: not a list of ids" % (found,))
        raise PluginFailed(plugin_failure(st.root, st.language))
    return list(found)


def fallback_line(st, why):
    """The one line that labels a run of the broad plan as a fallback (never silent success)."""
    return "falling back to the full suite (plug-in %s %s): %s" % (
        st.language, "failed" if why == "failed" else "could not tell", plugin_failure(st.root, st.language) or "")


# ---------------------------------------------------------------- stamps

def stamp_path(rdir, key, variant):
    return os.path.join(rdir, "stamp-%s-%s.json" % (key, variant))


def find_stamp(rdir, key, variant):
    return _read_json(stamp_path(rdir, key, variant), None)


def format_stamp(s):
    ran = "%d tests Ran" % s["ran"] if s.get("ran") is not None else "tests passed"
    return "stamp: key %s (tree %s, HEAD %s), %s, wall %.0fs, %s, variant %s, Python %s" % (
        s["key"][:12], s["tree"][:12], s["head"][:8], ran, s["wall"], s["time"], s["variant"], s["python"])


def record_stamp(rdir, root, key, variant, ran, wall, skipped=0, identity=None):
    s = {"key": key, "tree": tree_hash(root), "head": head_commit(root), "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
         "ran": ran, "skipped": skipped, "wall": round(wall, 1), "variant": variant, "python": platform.python_version(),
         "execution_identity": identity}
    _atomic_write_json(stamp_path(rdir, key, variant), s)
    return s


# ---------------------------------------------------------------- running

def new_log_dir(rdir):
    log_root = os.path.join(rdir, "logs")
    os.makedirs(log_root, exist_ok=True)
    d = tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=log_root)
    _atomic_write_json(os.path.join(d, "run.json"), {"owner": os.getpid(), "started": time.time(), "finished": False})
    _prune_logs(log_root)
    return d


def finish_logs(log_dir):
    path = os.path.join(log_dir, "run.json")
    record = _read_json(path, {}) or {}
    record.update(finished=True, ended=time.time())
    _atomic_write_json(path, record)


def execution_identity(st, args, modules, env):
    resources = resource_module()
    policy = resources.Policy(st.resources)
    # Session/focus/temp bookkeeping is not part of a test's environment. Hash other values without persisting them.
    transient = {"TMPDIR", "TMP", "TEMP", "PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID", "TERM",
                 "TEST_STAMP_DIR", "TEST_RESOURCE_HOST_DIR", "TEST_STAMP_IMPACT_CONFIG",
                 "CODEX_THREAD_ID"}
    transient.add("TEST_RESOURCE_PARENT_RESERVATION")
    environment = {k: v for k, v in env.items() if k not in transient and not k.endswith("_TEST_RUNS_DIR") and
                   not k.startswith(("CODEX_", "CLAUDE_CODE_", "VSCODE_", "XPC_"))}
    inputs = {}
    for relative in policy.inputs:
        path = os.path.abspath(os.path.join(st.root, relative))
        paths = []
        if os.path.isdir(path):
            for folder, dirs, files in os.walk(path, followlinks=False):
                dirs[:] = sorted(d for d in dirs if not os.path.islink(os.path.join(folder, d)))
                paths.extend(os.path.join(folder, f) for f in sorted(files))
        else:
            paths = [path]
        for item in paths:
            digest = hashlib.sha256()
            if os.path.islink(item):
                raise RunError("configured test input is a symlink; identify its actual target explicitly: %s" % item)
            with open(item, "rb") as f:
                for block in iter(lambda: f.read(65536), b""):
                    digest.update(block)
            inputs[os.path.relpath(item, st.root)] = digest.hexdigest()
    return {"version": 1, "code": working_code_key(st.root, st.is_t0),
            "environment": resources.digest(environment), "inputs": inputs,
            "interpreter": [os.path.realpath(sys.executable), sys.version], "platform": platform.platform(),
            "settings": resources.digest(dict({"command": st.command, "cwd": st.cwd_rel, "python": st.python,
                                              "resources": st.resources},
                                             **({"plugin": st.plugin_block} if plugin_in_play(st) else {}))),
            "variant": args.variant or "default", "selected": modules,
            "scope": "full" if args.full else "targeted" if getattr(args, "targeted", None) is not None else "affected"}


def validation_identity(st, args, modules=None, scope="full", say=None):
    """Use the actual selected command/modules and variant environment for stamps as well as checkpoints."""
    context = argparse.Namespace(**vars(args))
    context.full = scope == "full"
    context.targeted = "" if scope == "targeted" else None
    _suffix, extra = variant_env(st, args.variant)
    env = dict(os.environ)
    env.update(extra)
    if modules is None:
        plugin, config = plugin_for_run(st, bool(args.command))
        if plugin is not None:
            try:
                modules = plugin_modules(st, plugin, config)
            except PluginFailed:
                plugin = None      # skipped now: the plan is the full command, as run_suite will run it
                if scope == "full" and say is not None:
                    say(fallback_line(st, "failed"))
        modules = [st.command] if plugin is None else modules
        if not modules:
            raise RunError("no test modules found for the selected validation plan")
    try:
        return execution_identity(st, context, modules, env)
    except OSError as error:
        raise RunError("cannot identify configured test inputs: %s" % error) from error


def run_command(st, command, env_extra, rdir, say=print, dry_run=False, args=None, identity=None):
    """Run the test command once, through the shell, in the settings' cwd. Returns (ok, ran, skipped, wall) or None
    for a dry run. Output goes to `say` and to a log file."""
    say("command: %s (in %s)" % (command, st.cwd_rel))
    if dry_run:
        return None
    env = dict(os.environ)
    env.update(env_extra)
    log_dir = new_log_dir(rdir)
    resources = resource_module()
    policy = resources.Policy(st.resources)
    identity = execution_identity(st, args, [command], env) if identity is None else identity
    units = [{"id": command, "seconds": policy.chunk_seconds, "disk": int(policy.unit_scratch_mib * resources.MIB),
              "ram": int(policy.unit_ram_mib * resources.MIB)}]

    def launch(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
        result = resources.run_process(["/bin/sh", "-c", command], st.cwd, env, log, scratch, policy,
                                       disk_limit, ram_limit, timeout, host, cancel)
        with open(log, encoding="utf-8", errors="replace") as f:
            text = f.read()
        for line in text.splitlines()[-120:]:
            say(line)
        # A short command transcript is a useful summary; successful verbose output is disposable.
        if result["rc"] == 0 and len(text) > 16384:
            with open(log, "w", encoding="utf-8") as f:
                f.write("Successful command output (last 16 KiB):\n" + text[-16384:])
        return result

    try:
        data = resources.execute(units, identity, st.root, rdir, log_dir, policy, 1, launch,
                                 resume=getattr(args, "resume", False), say=say)
    finally:
        finish_logs(log_dir)
    results = [c["result"] for c in data["completed"].values()]
    ok = data["state"] == "complete" and all(r["rc"] == 0 for r in results)
    rc = 0 if ok else next((r["rc"] for r in results if r["rc"]), 1)
    wall = data["wall"]
    say("%s (exit %d), wall %.1fs" % ("OK" if ok else "FAILED", rc, wall))
    say("logs: %s" % log_dir)
    return ok, None, 0, wall


def run_suite(st, args, modules, rdir, say, classes_fn=None, identity=None):
    """Run `modules` (None for the whole suite) the way the settings say. Returns (ok, ran, skipped, wall) or None.
    A language plug-in that fails here is skipped and the full command runs instead, labelled as a fallback."""
    _suffix, env_extra = variant_env(st, args.variant)
    plugin, pcfg = plugin_for_run(st, bool(args.command))
    if plugin is not None:
        env = dict(os.environ)
        env.update(env_extra)
        try:
            if modules is None:
                modules = plugin_modules(st, plugin, pcfg)
                if not modules:
                    raise RunError("no test modules found by the %s plug-in under %s (settings: %s)" % (
                        st.language, st.cwd, json.dumps(pcfg, sort_keys=True, default=str)))
            say("running %d module%s, jobs %d" % (len(modules), "" if len(modules) == 1 else "s", args.jobs))
            log_dir = os.path.join(rdir, "logs", "dry-run") if args.dry_run else new_log_dir(rdir)
            identity = execution_identity(st, args, modules, env) if identity is None else identity
            try:
                result = _plugin_call(st, "run_bounded", plugin.run_bounded, st.cwd, pcfg, modules, args.jobs, rdir,
                                      log_dir, env, say, args.dry_run, identity, st.resources,
                                      getattr(args, "resume", False), st.root)
            finally:
                if not args.dry_run:
                    finish_logs(log_dir)
            if args.dry_run:
                return result
            if not (isinstance(result, tuple) and len(result) == 4 and isinstance(result[0], bool)):
                _fail_plugin(_plugin_root(st.root), st.language, "BadResult",
                             "run_bounded returned %r: expected (ok, ran, skipped, wall)" % (result,))
                raise PluginFailed(plugin_failure(st.root, st.language))
            return result
        except PluginFailed as failure:
            if getattr(args, "targeted", None) is not None:
                raise RunError("targeted run refused, no checks executed: the %s plug-in failed (%s); supply an "
                               "explicit regression or verification --command" % (st.language, failure))
            say(fallback_line(st, "failed"))
            identity = None
    return run_command(st, st.command, env_extra, rdir, say, args.dry_run, args, identity)


# ---------------------------------------------------------------- commands

def _context(args):
    root = os.path.abspath(args.root) if args.root else os.path.dirname(TOOLS)
    st = load_settings(root, args.command)
    suffix, _env = variant_env(st, args.variant)
    return root, st, suffix


def cmd_status(args, say=print):
    root, st, variant = _context(args)
    rdir = runs_dir(root)
    if dirty_code_lines(root, st.is_t0):
        say("none (the working tree has uncommitted changes, so no stamp applies)")
        return 1
    s = find_stamp(rdir, stamp_key(root, st.is_t0), variant)
    if not s or s.get("execution_identity") != validation_identity(st, args):
        say("none (no passing --full run matches this tree, inputs, environment and plan; variant %s)" % variant)
        return 1
    say(format_stamp(s))
    return 0


def cmd_full(args, say=print, classes_fn=None):
    root, st, variant = _context(args)
    rdir = runs_dir(root)
    clean = not dirty_code_lines(root, st.is_t0)
    key = stamp_key(root, st.is_t0)
    code_before, head_before = working_code_key(root, st.is_t0), head_commit(root)
    identity = validation_identity(st, args, say=say)
    if clean and not args.force:
        s = find_stamp(rdir, key, variant)
        if s and s.get("execution_identity") == identity:
            say("this tree already passed the full suite; not running it again (--force to run anyway)")
            say(format_stamp(s))
            return 0
    if not clean:
        say("working tree has uncommitted changes: no stamp will be recorded or reused")
    say("full suite%s" % ("" if variant == "default" else " (variant %s)" % variant))
    res = run_suite(st, args, None, rdir, say, classes_fn, identity=identity)
    if res is None:
        return 0
    ok, ran, skipped, wall = res
    unchanged = working_code_key(root, st.is_t0) == code_before and head_commit(root) == head_before
    try:
        same_execution = validation_identity(load_settings(root, args.command), args) == identity
    except (RunError, OSError, RuntimeError):
        same_execution = False
    if ok and clean and unchanged and same_execution and not dirty_code_lines(root, st.is_t0):
        s = record_stamp(rdir, root, key, variant, ran, wall, skipped, identity=identity)
        say("recorded " + format_stamp(s))
    elif ok:
        say("passed, but no stamp recorded: the working tree is dirty" if not clean
            else "passed, but no stamp recorded: code identity changed during validation" if not unchanged
            else "passed, but no stamp recorded: input/environment/plan identity changed during validation")
    return 0 if ok else 1


def _full_fallback(args, say, classes_fn, line):
    say(line)
    args.force = False
    return cmd_full(args, say, classes_fn)


def cmd_affected(args, say=print, classes_fn=None):
    root, st, _variant = _context(args)
    rdir = runs_dir(root)
    if args.command:
        plugin = load_plugin(st.language, root)
        why = "--command overrides the settings' command" if plugin is not None else \
            "no affected-test plug-in for %s" % st.language
        return _full_fallback(args, say, classes_fn, "%s; running the full suite" % why)
    plugin = load_plugin(st.language, root)
    if plugin is None:
        failed = plugin_failure(root, st.language)
        return _full_fallback(args, say, classes_fn, "falling back to the full suite (plug-in %s failed): %s" % (
            st.language, failed) if failed else "no affected-test plug-in for %s; running the full suite" % st.language)
    loaded = plugin
    plugin, pcfg = plugin_for_run(st, False)
    if plugin is None:
        failed = plugin_failure(root, st.language)
        return _full_fallback(args, say, classes_fn, "falling back to the full suite (plug-in %s failed): %s" % (
            st.language, failed) if failed else "%s; running the full suite" % getattr(
                loaded, "NOT_USED", "the %s affected-test plug-in does not drive this test command" % st.language))
    base = resolve_base(root, args.affected if args.affected != "" else None, st.base_branch)
    changed = changed_paths(root, base)
    try:
        modules = plugin_modules(st, plugin, pcfg)
        kind, chosen, notes = plugin_select(st, plugin, pcfg, changed, modules)
    except PluginFailed:
        return _full_fallback(args, say, classes_fn, fallback_line(st, "failed"))
    if kind == "none":
        say("no tests affected (%s)" % notes[0])
        return 0
    if kind == "full":
        return _full_fallback(args, say, classes_fn, "falling back to the full suite: %s" % notes[0])
    if kind == "unknown":
        return _full_fallback(args, say, classes_fn, "falling back to the full suite (plug-in %s could not tell what "
                              "the change affects): %s" % (st.language, notes[0]))
    say("affected: %d of %d test modules (changes: %d file%s, base %s)" % (
        len(chosen), len(modules), len(changed), "" if len(changed) == 1 else "s", base))
    for n in notes:
        say("  " + n)
    say("modules: " + ", ".join(chosen))
    res = run_suite(st, args, chosen, rdir, say, classes_fn)
    if res is None:
        return 0
    return 0 if res[0] else 1


def working_code_key(root, is_t0):
    """Identity of actual non-T0 files, including uncommitted and untracked content (never ignored files)."""
    paths = set(_git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0"))
    digest = hashlib.sha256()
    for path in sorted(p for p in paths if p and not is_t0(p)):
        full = os.path.join(root, path)
        digest.update(path.encode("utf-8", "surrogateescape") + b"\0")
        try:
            info = os.lstat(full)
        except FileNotFoundError:
            digest.update(b"deleted\0")
            continue
        # Include the file type and executable bits, as git does, plus the current bytes.
        digest.update(("%o\0" % (info.st_mode & 0o170111)).encode("ascii"))
        if os.path.islink(full):
            content_key = hashlib.sha256(os.fsencode(os.readlink(full))).hexdigest()
        elif os.path.isfile(full):
            file_digest = hashlib.sha256()
            with open(full, "rb") as f:
                for block in iter(lambda: f.read(65536), b""):
                    file_digest.update(block)
            content_key = file_digest.hexdigest()
        else:
            raise RunError("cannot identify targeted code at %s; check submodules or special files" % path)
        digest.update(content_key.encode("ascii") + b"\0")
    return digest.hexdigest()


def cmd_targeted(args, say=print, classes_fn=None):
    root, st, variant = _context(args)  # Validate variants before any command runs.
    base = resolve_base(root, args.targeted or None, st.base_branch)
    base_commit = _git(root, ["rev-parse", "--verify", "--end-of-options", base + "^{commit}"]).strip()
    changed = changed_paths(root, base_commit)
    chosen, notes, commands = [], [], []
    if args.command is not None:
        if not args.command.strip():
            raise RunError("--targeted requires a non-empty --command")
        commands = [args.command]
    else:
        plugin, pcfg = plugin_for_run(st, False)
        if plugin is None:
            raise RunError("targeted selection is unsupported for language %s and its configured runner; "
                           "supply an explicit scoped verification --command" % st.language)
        try:
            modules = plugin_modules(st, plugin, pcfg)
            kind, chosen, notes = plugin_select(st, plugin, pcfg, changed, modules)
        except PluginFailed as failure:
            raise RunError("targeted selection failed (%s); supply an explicit regression or verification --command"
                           % failure)
        if kind != "some" or not chosen:
            why = "; ".join(notes) or "no tests selected"
            raise RunError("targeted selection cannot establish coverage (%s): %s; "
                           "supply an explicit regression or verification --command" % (kind, why))
    say("targeted validation (base %s, commit %s, variant %s)" % (base, base_commit[:12], variant))
    for note in notes:
        say("  " + note)
    if chosen:
        say("modules: " + ", ".join(chosen))
    code_key = working_code_key(root, st.is_t0)
    identity = validation_identity(st, args, chosen or None, scope="targeted")
    head, tree = head_commit(root), tree_hash(root)
    dirty = bool(dirty_code_lines(root, st.is_t0))
    rdir = runs_dir(root)
    res = run_suite(st, args, chosen, rdir, say, classes_fn, identity=identity)
    if res is None:
        return 0
    ok, ran, skipped, wall = res
    if not ok:
        return 1
    if chosen and (ran is None or ran <= skipped):
        raise RunError("targeted selection executed no checks (zero tests or all skipped); "
                       "supply an explicit regression or verification --command")
    try:
        same_execution = validation_identity(load_settings(root, args.command), args, chosen or None,
                                               scope="targeted") == identity
    except (RunError, OSError, RuntimeError):
        same_execution = False
    if working_code_key(root, st.is_t0) != code_key or head_commit(root) != head or not same_execution:
        say("passed, but no targeted evidence recorded: code, inputs, environment or plan changed during validation; "
            "rerun for the new identity")
        return 0
    proof = {"scope": "targeted", "result": "passed", "code_key": code_key, "head": head, "tree": tree,
             "dirty": dirty, "base": base, "base_commit": base_commit, "changed_paths": changed,
             "execution_identity": identity,
             "commands": commands, "modules": chosen, "cwd": st.cwd_rel, "variant": variant,
             "reason": args.reason, "selection_notes": notes, "ran": ran, "skipped": skipped,
             "wall": round(wall, 1), "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
             "python": platform.python_version()}
    path = os.path.join(rdir, "targeted-%s-%s-%d.json" % (code_key, variant, time.time_ns()))
    _atomic_write_json(path, proof)
    say("recorded targeted evidence: " + path)
    return 0


def build_parser():
    ap = argparse.ArgumentParser(description="Run the project's tests: affected ones, or the whole suite once with a "
                                 "stamp. Settings: the \"tests\" block of .claude/scaffolding.json.")
    ap.add_argument("--version", action="version", version="test_stamp.py " + VERSION)
    ap.add_argument("--root", help="project root (default: the parent of this file's folder)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--affected", nargs="?", const="", metavar="BASE",
                   help="run the tests affected by BASE...HEAD plus uncommitted changes (BASE default: the record's "
                        "base_branch, else main, else master)")
    g.add_argument("--targeted", nargs="?", const="", metavar="BASE",
                   help="run strictly scoped validation and record targeted evidence; never fall back to full")
    g.add_argument("--full", action="store_true", help="run the whole suite once and stamp a pass")
    g.add_argument("--status", action="store_true", help="print the stamp for this tree, or none (exit 1)")
    ap.add_argument("--variant", metavar="NAME", help="a variant from tests.variants: its env, and its own stamp")
    ap.add_argument("--reason", help="coverage rationale for --targeted evidence")
    ap.add_argument("--command", help="test command, instead of the settings' one")
    ap.add_argument("--jobs", type=int, default=None, help="parallel shards, python only (default: tests.jobs, else %d)"
                    % DEFAULT_JOBS)
    ap.add_argument("--force", action="store_true", help="run --full even when this tree has a stamp")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and run nothing")
    ap.add_argument("--resume", action="store_true", help="resume only a matching code/input/environment/plan checkpoint")
    return ap


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    args = build_parser().parse_args(argv)
    if args.jobs is not None and args.jobs < 1:
        print("ERR --jobs must be at least 1", file=sys.stderr)
        return 2
    try:
        if args.jobs is None:
            root = os.path.abspath(args.root) if args.root else os.path.dirname(TOOLS)
            args.jobs = load_settings(root, args.command).jobs
        if args.status:
            return cmd_status(args)
        if args.full:
            return cmd_full(args)
        if args.targeted is not None:
            return cmd_targeted(args)
        return cmd_affected(args)
    except KeyboardInterrupt:
        print("Interrupted; owned children stopped, scratch teardown attempted, checkpoint retained", file=sys.stderr)
        return 130
    except (RunError, RuntimeError) as e:
        print("ERR %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
