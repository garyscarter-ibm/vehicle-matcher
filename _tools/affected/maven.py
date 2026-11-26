"""affected/maven.py -- test_stamp.py's Java/Maven plug-in: which Maven modules a change affects, and a bounded `mvn` runner.
Loaded by path from test_stamp.py for `"language": "maven"` (affected/<language>.py next to it); it is not a command. It
implements the language plug-in contract written down in test_stamp.py's docstring and references/extensions.md.

Settings (the "maven" block of "tests" in .claude/scaffolding.json; all optional)
  args      extra arguments before the module selection, default ["-B"] (batch mode). Put profiles and -D options here.
  goal      what to run, default "test" (a string; "clean test" is two goals).
  mvn       the executable; default `mvnw` in the test folder when there is one, else `mvn` from PATH.
  upstream  "reactor" (default) adds -am, so the selected modules build against the current source of the modules they
            depend on and nothing has to be installed in ~/.m2 first; "installed" omits -am, for a project whose upstream
            modules are installed already (the upstream modules' own tests then do not run).
  tests.command should be the same maven command (keep goal/args consistent with it): this plug-in drives the run when
  the command mentions mvn and --command was not given, and then builds its own command from these settings; the
  configured command itself is what a fallback to the full suite runs.

Modules
  The reactor is read from `<cwd>/pom.xml` and its <modules> (recursively). A module's id is its folder relative to
  `cwd`, "." for the root, exactly what `mvn -pl` takes. A pom outside the reactor is not a module.

Affected (conservative: when unsure, run more)
  A changed file belongs to the module of its nearest ancestor folder that holds a pom.xml (a file anywhere under src/ of
  a module, its pom.xml, a resource; a file with no pom.xml between it and the root belongs to the root module). That module is affected, and so is every module that depends on it, transitively: a module whose
  <dependencies> list its artifactId (match on artifactId alone, so same-named artifacts of two groups both count), or
  that names it as its <parent> (a change to a parent pom reaches every child). <dependencyManagement> and plugin
  dependencies do not count as dependencies. Properties in artifactIds are not resolved.
  - kind "none": only T0 paths changed.
  - kind "full": a changed path is outside the test folder (cwd) and outside the T0 paths.
  - kind "unknown": the plug-in cannot tell what the change affects: a pom it cannot parse, a deleted pom.xml, or a file whose
    nearest pom.xml is not in the reactor (a stray or unlisted module). test_stamp runs the full suite and says that this plug-in could not tell.

The command (build_command)
  mvn <args> -pl <affected modules> -am <goal>
  We compute the dependents ourselves and put them in -pl, so the plan is printable and the same set is chunked by the
  resource contract. That is the set `-pl <changed> -amd` (also-make-dependents) would build. -am is added on top so the
  modules build against current upstream source; Maven then also runs the upstream modules' tests (it has no per-module
  "skip tests" on the command line), which costs time but never gives a false pass. With upstream="installed" -am is left
  out. When the modules to run are the whole reactor the command is plain `mvn <args> <goal>`.

Bounded runs
  Each module is one unit of the resource plan (tests.resources: estimates, chunk_seconds, scratch and RAM budgets, the
  checkpoint and --resume); modules are packed into `mvn` runs that fit the budget, and one run is started at a time,
  because runs share the modules' target folders. Output goes to a log in log_dir, bounded by the contract; a passing
  run's log is deleted, a failing one's is kept. The counts come from surefire's "Tests run: N, Failures: F, Errors: E,
  Skipped: S" module summaries and the BUILD SUCCESS / BUILD FAILURE line.

Standard library only."""
import importlib.util
import os
import re
import shlex
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULTS = {"args": ["-B"], "goal": "test", "mvn": None, "upstream": "reactor"}
NOT_USED = "the maven affected-test plug-in drives mvn only and the test command does not use it"
TOTAL_RE = re.compile(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$")
BUILD_RE = re.compile(r"BUILD (SUCCESS|FAILURE)")
SKIP_DIRS = {"target", "node_modules", ".git"}


def helper(name):
    path = Path(__file__).resolve().parent.parent / (name + ".py")
    spec = importlib.util.spec_from_file_location("test_stamp_" + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def applies(st, command_overridden):
    """The plug-in drives the suite when the test command is a Maven command and --command did not replace it."""
    return not command_overridden and re.search(r"\bmvnw?\b", st.command) is not None


def settings(raw):
    """The maven block with defaults applied and the types checked. Raises ValueError with a plain message."""
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError('"maven" must be an object')
    cfg = dict(DEFAULTS)
    cfg.update(raw)
    if not (isinstance(cfg["args"], list) and all(isinstance(a, str) and a for a in cfg["args"])):
        raise ValueError('"maven.args" must be a list of non-empty strings')
    if not isinstance(cfg["goal"], str) or not cfg["goal"].strip():
        raise ValueError('"maven.goal" must be a non-empty string')
    if cfg["mvn"] is not None and (not isinstance(cfg["mvn"], str) or not cfg["mvn"]):
        raise ValueError('"maven.mvn" must be a non-empty string')
    if cfg["upstream"] not in ("reactor", "installed"):
        raise ValueError('"maven.upstream" must be "reactor" or "installed"')
    return cfg


# ---------------------------------------------------------------- the reactor

def _tag(element):
    return element.tag.rsplit("}", 1)[-1]


def _child(element, name):
    for child in element:
        if _tag(child) == name:
            return child
    return None


def _text(element, name):
    child = _child(element, name)
    return (child.text or "").strip() if child is not None and child.text else ""


def _dependencies(element):
    """artifactIds in this element's <dependencies> (not <dependencyManagement>, not plugin dependencies)."""
    block = _child(element, "dependencies")
    return [_text(d, "artifactId") for d in (block if block is not None else []) if _tag(d) == "dependency"]


def read_pom(path):
    """{artifact, parent, modules, deps} of one pom.xml; ET.ParseError / OSError when it cannot be read."""
    root = ET.parse(path).getroot()
    if _tag(root) != "project":
        raise ValueError("%s is not a Maven pom (root element %s)" % (path, _tag(root)))
    parent = _child(root, "parent")
    modules = _child(root, "modules")
    deps = _dependencies(root)
    profiles = _child(root, "profiles")
    for profile in (profiles if profiles is not None else []):
        deps += _dependencies(profile)
    mods = list(modules) if modules is not None else []
    for profile in (profiles if profiles is not None else []):
        more = _child(profile, "modules")
        mods += list(more) if more is not None else []
    return {"artifact": _text(root, "artifactId"), "parent": _text(parent, "artifactId") if parent is not None else "",
            "modules": [(m.text or "").strip() for m in mods if _tag(m) == "module" and (m.text or "").strip()],
            "deps": [d for d in deps if d]}


def reactor(cwd):
    """{module id: pom info} for the reactor rooted at <cwd>/pom.xml, in discovery order; {} with no root pom.
    A <module> that has no pom, or that is outside cwd, is not part of it."""
    root_pom = os.path.join(cwd, "pom.xml")
    if not os.path.isfile(root_pom):
        return {}
    found = {}

    def walk(folder):
        rel = os.path.relpath(folder, cwd).replace(os.sep, "/")
        if rel in found:
            return
        pom = os.path.join(folder, "pom.xml")
        info = read_pom(pom)
        found[rel] = info
        for name in info["modules"]:
            target = os.path.normpath(os.path.join(folder, name))
            if os.path.isfile(target):          # <module> may name the pom file itself
                target = os.path.dirname(target)
            inside = os.path.commonpath([os.path.abspath(cwd), os.path.abspath(target)]) == os.path.abspath(cwd)
            if inside and os.path.isfile(os.path.join(target, "pom.xml")):
                walk(target)
    walk(os.path.normpath(cwd))
    return found


def dependents(poms):
    """{module id: set of module ids that depend on it, directly (dependency or parent)}."""
    by_artifact = {}
    for mid, info in poms.items():
        by_artifact.setdefault(info["artifact"], []).append(mid)
    out = {mid: set() for mid in poms}
    for mid, info in poms.items():
        for name in set(info["deps"]) | ({info["parent"]} if info["parent"] else set()):
            for upstream in by_artifact.get(name, []):
                if upstream != mid:
                    out[upstream].add(mid)
    return out


def discover_modules(cwd, cfg):
    """The module ids of the reactor (folders relative to cwd, "." for the root), sorted. [] when there is no pom.xml."""
    return sorted(reactor(cwd))


# ---------------------------------------------------------------- affected

def select_affected(cwd, cwd_rel, cfg, changed, is_t0, modules):
    """Which modules a change set affects: the changed modules and everything that depends on them, transitively.
    Returns (kind, modules, notes): "none" (T0 only), "some", "full" (a path outside cwd, or .mvn/ or the wrapper; notes[0] says why) or
    "unknown" (the plug-in cannot tell; notes[0] says why)."""
    prefix = "" if cwd_rel in ("", ".") else cwd_rel.rstrip("/") + "/"
    try:
        poms = reactor(cwd)
    except (ET.ParseError, OSError, ValueError) as error:
        return "unknown", [], ["cannot read the Maven reactor under %s: %s" % (cwd, error)]
    hit, notes, t0 = {}, [], []
    for path in sorted(set(changed)):
        if is_t0(path):
            t0.append(path)
            continue
        if not path.startswith(prefix):
            return "full", [], ["%s is outside the test folder %s and outside the T0 paths" % (path, cwd_rel)]
        rel = path[len(prefix):]
        if rel.startswith(".mvn/") or rel in ("mvnw", "mvnw.cmd"):      # the build's own settings: every module is affected
            return "full", [], ["%s changes how every module is built (.mvn/ and the Maven wrapper)" % path]
        if rel.rsplit("/", 1)[-1] == "pom.xml" and not os.path.exists(os.path.join(cwd, rel)):
            return "unknown", [], ["%s was deleted, so the modules that depended on it cannot be found" % path]
        # the nearest pom.xml on disk owns the file; that pom has to be a module of the reactor
        folder = os.path.dirname(rel) or "."
        while folder != "." and not os.path.isfile(os.path.join(cwd, folder, "pom.xml")):
            folder = os.path.dirname(folder) or "."
        module = folder if folder in poms else None
        if module is None:
            return "unknown", [], ["%s is in no module of the reactor at %s/pom.xml (nearest pom: %s)" % (
                path, cwd_rel, "none" if folder == "." and "." not in poms else folder + "/pom.xml")]
        hit.setdefault(module, []).append(path)
    if not hit:
        return "none", [], ["T0 only: " + ", ".join(t0)] if t0 else ["nothing changed"]
    users = dependents(poms)
    chosen, queue = set(hit), list(hit)
    while queue:
        for user in sorted(users[queue.pop()]):
            if user not in chosen:
                chosen.add(user)
                queue.append(user)
    for module in sorted(hit):
        extra = sorted(chosen & _closure(users, module) - {module})
        notes.append("%s -> module %s%s" % (", ".join(hit[module]), module,
                                           " (+ dependents: %s)" % ", ".join(extra) if extra else ""))
    return "some", sorted(chosen), notes


def _closure(users, module):
    seen, queue = set(), [module]
    while queue:
        for user in users[queue.pop()]:
            if user not in seen:
                seen.add(user)
                queue.append(user)
    return seen


# ---------------------------------------------------------------- running

def build_command(cwd, cfg, ids, all_ids):
    """The mvn command line that runs the modules `ids` (see the docstring). The whole reactor runs without -pl."""
    exe = cfg["mvn"]
    if exe is None:
        wrapper = os.path.join(cwd, "mvnw")
        exe = wrapper if os.path.isfile(wrapper) else "mvn"
    command = [exe] + list(cfg["args"])
    if set(ids) != set(all_ids):
        command += ["-pl", ",".join(sorted(ids))]
        if cfg["upstream"] == "reactor":
            command.append("-am")
    return command + shlex.split(cfg["goal"])


def parse_log(text):
    """From a run's output: ran, skipped, status (OK/FAILED/None) and the first failing lines."""
    ran = skipped = 0
    seen, status, bad = False, None, []
    for line in text.splitlines():
        plain = re.sub(r"^\[[A-Z]+\]\s*", "", line)
        m = TOTAL_RE.search(plain)
        if m and "Time elapsed" not in plain:      # the module summary, not a test class's line
            seen = True
            ran += int(m.group(1))
            skipped += int(m.group(4))
            continue
        m = BUILD_RE.search(line)
        if m:
            status = "OK" if m.group(1) == "SUCCESS" else "FAILED"
        elif line.startswith("[ERROR] ") and line.strip() != "[ERROR]" and len(bad) < 10 \
                and "-> [Help" not in line and "Re-run Maven" not in line:
            bad.append(line[8:].strip())
    return {"ran": ran if seen or status else None, "skipped": skipped, "status": status, "bad": bad}


def run_bounded(cwd, cfg, modules, jobs, rdir, log_dir, env, say, dry_run, identity, resources_raw=None,
                resume=False, project=None, runner=None):
    """Resource-aware execution used by test_stamp. `runner` replaces test_resources.run_process (tests inject one).
    Returns None for a dry run, else (ok, ran, skipped, wall). One `mvn` run at a time whatever `jobs` says."""
    resources = helper("test_resources")
    policy = resources.Policy(resources_raw)
    everything = discover_modules(cwd, cfg)
    units = []
    for module in modules:
        estimate = policy.estimates.get(module, {})
        units.append({"id": module, "seconds": float(estimate.get("seconds", 30)),
                      "disk": int(estimate.get("scratch_mib", policy.unit_scratch_mib) * resources.MIB),
                      "ram": int(estimate.get("ram_mib", policy.unit_ram_mib) * resources.MIB)})
    say("plan: %d module%s, one mvn run at a time (the runs share the modules' target folders); bounded chunks" % (
        len(modules), "" if len(modules) == 1 else "s"))
    say("command: " + " ".join(build_command(cwd, cfg, modules, everything)))
    if dry_run:
        return None

    def launch(chunk, scratch, log, disk_limit, ram_limit, timeout, host, cancel):
        ids = [u["id"] for u in chunk]
        command = build_command(cwd, cfg, ids, everything)
        result = (runner or resources.run_process)(command, cwd, env, log, scratch, policy, disk_limit, ram_limit,
                                                   timeout, host, cancel)
        result.update(parse_log(Path(log).read_text(encoding="utf-8", errors="replace")))
        if result["rc"] == 0 and result["status"] is None:
            result["issue"] = result.get("issue") or "mvn exited 0 without a BUILD SUCCESS or BUILD FAILURE line"
        elif result["status"] is None:
            result["issue"] = result.get("issue") or "mvn stopped without a build result (exit %s)" % result["rc"]
        result.update(ids=ids, command=command, planned=sum(u["seconds"] for u in chunk))
        result["log_retained"] = bool(result["rc"] or result.get("issue") or result["status"] != "OK")
        if not result["log_retained"]:
            Path(log).unlink()
        return result

    data = resources.execute(units, identity, project or cwd, rdir, log_dir, policy, 1, launch, resume=resume, say=say)
    results = [c["result"] for c in data["completed"].values()]
    ran = sum(r["ran"] or 0 for r in results)
    skipped = sum(r["skipped"] for r in results)
    ok = data["state"] == "complete" and all(r["status"] == "OK" and r["rc"] == 0 for r in results)
    say("Ran %d tests in %d mvn run%s, %s%s, wall %.1fs" % (
        ran, len(results), "" if len(results) == 1 else "s", "INCOMPLETE" if data["state"] != "complete" else
        "OK" if ok else "FAILED", " (skipped=%d)" % skipped if skipped else "", data["wall"]))
    for r in results:
        if r["status"] != "OK" or r["rc"] != 0:
            for line in r["bad"]:
                say("  " + line)
            say("  mvn exit %d; see %s" % (r["rc"], r["log"]))
    if data["state"] != "complete":
        done = {i for c in data["completed"].values() for i in c["ids"]}
        say("INCOMPLETE: %d planned unit(s) still need validation; resume with --resume" %
            len([u for u in data["units"] if u["id"] not in done]))
        ok = False
    say("logs: %s" % log_dir)
    return ok, ran, skipped, data["wall"]
