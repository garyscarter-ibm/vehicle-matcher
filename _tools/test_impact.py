"""Compact static dependencies and observed per-test function contexts, gathered during required validation.

Function-call observations cover the worker's main Python thread. Imports, shared fixtures, subprocesses,
unobserved branches and stale identities remain unknown; observations never narrow a static selection alone.
"""
import ast
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import time

VERSION = "1.0.0"
MAX_CONTEXTS = 10000
MAX_SITES = 100000


def _resources():
    spec = importlib.util.spec_from_file_location("impact_resources", Path(__file__).with_name("test_resources.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


R = _resources()


def file_key(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def inventory(cwd, cfg, modules, graph, module_rel):
    files, functions = {}, {}
    for rel, absolute in sorted(graph.files.items()):
        try:
            files[rel] = file_key(absolute)
            tree = ast.parse(Path(absolute).read_text(encoding="utf-8"))
            functions[rel] = sorted({"%d:%s" % (n.lineno, n.name) for n in ast.walk(tree)
                                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))})
        except (OSError, SyntaxError, ValueError):
            functions[rel] = []
    dependencies = {m: sorted(graph.closure(module_rel(cfg, m))) for m in modules}
    return {"version": 1, "files": files, "functions": functions, "static": dependencies,
            "boundaries": cfg.get("boundaries", []), "cwd": os.path.realpath(cwd)}


class FunctionContexts:
    """Bounded call-site sets; a shared context accounts for loading and class/module fixture execution."""
    def __init__(self, cwd, files, limit=100000):
        self.allowed = {os.path.abspath(os.path.join(cwd, rel)): rel for rel in files}
        self.context = "<imports-and-shared-fixtures>"
        self.contexts = {}
        self.count = 0
        self.limit = limit
        self.truncated = False
        self.previous = None
        self.enabled = False

    def _profile(self, frame, event, arg):
        if event != "call":
            return
        code = frame.f_code
        rel = self.allowed.get(code.co_filename)
        if rel is None:
            # Importers may preserve './' in co_filename even though the inventory is normalized.
            rel = self.allowed.get(os.path.abspath(code.co_filename))
        if rel is None:
            return
        site = "%s:%d:%s" % (rel, code.co_firstlineno, code.co_name)
        sites = self.contexts.setdefault(self.context, set())
        if site not in sites:
            if self.count >= self.limit:
                self.truncated = True
                return
            sites.add(site)
            self.count += 1

    def __enter__(self):
        self.previous = sys.getprofile()
        if self.previous is None:
            sys.setprofile(self._profile)
            self.enabled = True
        return self

    def __exit__(self, kind, value, tb):
        if self.enabled:
            sys.setprofile(self.previous)

    def result(self):
        return {"kind": "observed-function-calls", "enabled": self.enabled, "truncated": self.truncated,
                "main_thread_only": True, "subprocesses_observed": False,
                "contexts": {k: sorted(v) for k, v in self.contexts.items()}}


def record(rdir, snapshot, identity, results, timings):
    """Atomically replace current entries and retain compatible observations only, with a compact size bound."""
    directory = Path(rdir) / "impact"
    with R.locked(directory / "index.lock"):
        current = R.read_json(directory / "index.json", {}) or {}
        observed = current.get("observed", {}) if current.get("files") == snapshot["files"] else {}
        for result in results:
            data = result.get("observations") or {}
            for test, sites in data.get("contexts", {}).items():
                observed[test] = {"sites": sites, "identity": R.digest(identity),
                                  "complete": bool(data.get("enabled")) and not data.get("truncated", False),
                                  "main_thread_only": True}
        # Bound observations independently of suite size. Omitted contexts are explicitly unknown.
        omitted = max(0, len(observed) - MAX_CONTEXTS)
        omitted_sites = 0
        bounded, remaining = {}, MAX_SITES
        for test, context in sorted(observed.items())[:MAX_CONTEXTS]:
            sites = context["sites"]
            kept = sites[:remaining]
            omitted_sites += len(sites) - len(kept)
            bounded[test] = dict(context, sites=kept, complete=context["complete"] and len(kept) == len(sites))
            remaining -= len(kept)
        observed = bounded
        index = dict(snapshot, identity=identity, observed=observed, omitted_contexts=omitted, omitted_sites=omitted_sites,
                     timings=timings, updated=time.time(),
                     limitations=["function calls, not line/branch coverage", "main worker thread only",
                                  "subprocess and external/config boundaries require reviewed checks",
                                  "absence of an observation never excludes a test"])
        R.atomic_json(directory / "index.json", index)
        return directory / "index.json"


def describe(index, changed):
    """Selection hints for a human/launcher; stale identities are disclosed rather than used as exclusions."""
    hints = []
    for path in changed:
        static = sorted(m for m, deps in index.get("static", {}).items() if path in deps)
        observed = sorted(t for t, context in index.get("observed", {}).items()
                          if any(site.startswith(path + ":") for site in context["sites"]))
        hints.append({"path": path, "static_modules": static, "observed_contexts": observed,
                      "file_identity": index.get("files", {}).get(path), "exclusion_safe": False})
    return hints
