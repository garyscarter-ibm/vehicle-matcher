#!/usr/bin/env python3
"""Shared, local test-stack build cache: one node_modules per lockfile, one build per commit.

State lives under $GCSP_TEST_STACK_DIR (default ~/Library/Caches/gcsp-test-stack), never a synced folder.
Usage: test_stack_build.py node link|unlink|gc ...   test_stack_build.py build api|web|gc ..."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

NODE_VERSION = "24.22.3"
NPM_VERSION = "11.19.1"
JAVA_HOME = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
PINNED_NPX = ["npx", "-y", "-p", f"node@{NODE_VERSION}", "-p", f"npm@{NPM_VERSION}"]
INSTALL_FILES = ("package.json", "package-lock.json", ".npmrc")
# The Angular build also compiles this CSS from outside the app, so it is part of the web key.
WEB_PATHS = ("apps/gcsp-web", "blocks/gcsp/shell")
API_PATH = "services/gcsp-api"
LOG = lambda msg: print(msg, file=sys.stderr)


class StackError(Exception):
    pass


def refuse_synced(path):
    text = str(path)
    for candidate in (text, str(Path(text).resolve())):
        if "OneDrive" in candidate or "/Library/CloudStorage" in candidate:
            raise StackError(f"Refusing a state root in a synced folder: {candidate}")


def state_root(env=None):
    env = os.environ if env is None else env
    raw = env.get("GCSP_TEST_STACK_DIR") or str(Path.home() / "Library/Caches/gcsp-test-stack")
    root = Path(raw).expanduser()
    refuse_synced(root)
    return root


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def node_key(app):
    lock = Path(app) / "package-lock.json"
    if not lock.is_file():
        raise StackError(f"No package-lock.json in {app}")
    return hashlib.sha256(f"{sha256_file(lock)}|node@{NODE_VERSION}|npm@{NPM_VERSION}".encode()).hexdigest()[:24]


@contextlib.contextmanager
def key_lock(root, name):
    locks = Path(root) / "locks"
    locks.mkdir(parents=True, exist_ok=True)
    with open(locks / f"{name}.lock", "a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def touch(path):
    now = time.time()
    os.utime(path, (now, now))


def run(cmd, cwd, env=None, quiet_stdout=True):
    merged = dict(os.environ)
    merged.update(env or {})
    # Child stdout goes to stderr so the tool's own stdout stays machine-readable.
    result = subprocess.run(cmd, cwd=cwd, env=merged, stdout=sys.stderr if quiet_stdout else None)
    if result.returncode:
        raise StackError(f"Command failed ({result.returncode}): {' '.join(cmd)}")


def npm_ci(stage):
    run(PINNED_NPX + ["npm", "ci", "--prefer-offline", "--no-audit", "--no-fund"], stage)


# ---- node ----

def ensure_node(app, root, installer=npm_ci):
    """Return the cache key dir for this app's lockfile, installing once under a per-key lock."""
    root = Path(root)
    key = node_key(app)
    final = root / "node" / key
    if (final / "node_modules").is_dir():
        return final, False
    with key_lock(root, f"node-{key}"):
        if (final / "node_modules").is_dir():
            return final, False
        (root / "node").mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=root / "node"))
        try:
            for name in INSTALL_FILES:
                if (Path(app) / name).is_file():
                    shutil.copy2(Path(app) / name, stage / name)
            installer(stage)
            if not (stage / "node_modules").is_dir():
                raise StackError("Installer did not produce node_modules")
            os.rename(stage, final)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
        return final, True


def link_node(app, root, replace=False, installer=npm_ci):
    app = Path(app)
    final, installed = ensure_node(app, root, installer)
    target = final / "node_modules"
    link = app / "node_modules"
    state = "linked"
    if link.is_symlink():
        if os.readlink(link) == str(target):
            state = "already linked"
        else:
            link.unlink()
            state = "repointed"
    elif link.exists():
        if not replace:
            touch(final)
            return {"key": final.name, "installed": installed, "state": "kept real directory (use --replace)", "linked": False}
        shutil.rmtree(link)
        state = "replaced real directory"
    if state != "already linked":
        link.symlink_to(target)
    touch(final)
    return {"key": final.name, "installed": installed, "state": state, "linked": True}


def unlink_node(app):
    link = Path(app) / "node_modules"
    if link.is_symlink():
        link.unlink()
        return True
    return False


def live_worktrees(repo):
    out = subprocess.run(["git", "-C", str(repo), "worktree", "list", "--porcelain"], capture_output=True, text=True)
    if out.returncode:
        raise StackError(f"git worktree list failed in {repo}")
    return [Path(line[len("worktree "):]) for line in out.stdout.splitlines() if line.startswith("worktree ")]


def linked_keys(root, repo):
    """Keys that some live worktree's apps/gcsp-web/node_modules points at."""
    base = str(Path(root) / "node")
    keys = set()
    for wt in live_worktrees(repo):
        link = wt / "apps/gcsp-web/node_modules"
        if link.is_symlink():
            dest = os.readlink(link)
            if dest.startswith(base + os.sep):
                keys.add(dest[len(base) + 1:].split(os.sep)[0])
    return keys


def gc_node(root, repo, keep=2):
    base = Path(root) / "node"
    if not base.is_dir():
        return [], []
    keys = sorted((p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    protected = linked_keys(root, repo)
    removed, kept = [], []
    for index, path in enumerate(keys):
        if index < keep or path.name in protected:
            kept.append(path.name)
            continue
        with key_lock(root, f"node-{path.name}"):
            shutil.rmtree(path, ignore_errors=True)
        removed.append(path.name)
    return removed, kept


# ---- build ----

def git(wt, *args):
    out = subprocess.run(["git", "-C", str(wt)] + list(args), capture_output=True, text=True)
    if out.returncode:
        raise StackError(f"git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout.strip()


def tree_key(wt, paths):
    trees = [git(wt, "rev-parse", f"HEAD:{p}") for p in paths]
    if len(trees) == 1:
        return trees[0]
    return hashlib.sha256("|".join(trees).encode()).hexdigest()[:40]


# Build outputs and the linked node_modules (a symlink that `node_modules/` ignore rules miss) are not source.
NOT_SOURCE = tuple(f":(exclude,glob)**/{d}" for d in ("node_modules", "node_modules/**", "target/**", "dist/**", ".angular/**"))


def is_dirty(wt, paths):
    return bool(git(wt, "status", "--porcelain", "--", *paths, *NOT_SOURCE))


def emit(values, fmt):
    if fmt == "json":
        print(json.dumps(values, sort_keys=True))
    else:
        for name, value in values.items():
            if name.startswith("PROOF_"):
                print(f"{name}={value}")


def mvn_package(wt):
    env = {"JAVA_HOME": os.environ.get("JAVA_HOME", JAVA_HOME), "MAVEN_OPTS": "-Xmx512m"}
    run(["./mvnw", "-B", "-q", "-DskipTests", "package"], Path(wt) / API_PATH, env)


def ng_build(wt, root):
    link_node(Path(wt) / "apps/gcsp-web", root)
    run(PINNED_NPX + ["npm", "run", "build"], Path(wt) / "apps/gcsp-web")


def build_cached(root, kind, key, wt, dirty, builder, inner, var):
    """Build (or reuse) and return the result dict; `inner` is the cached output's name under the key dir."""
    final = Path(root) / "build" / kind / key
    cached_path = final / inner
    if not dirty and cached_path.exists():
        touch(final)
        return {var: str(cached_path), "key": key, "cached": True, "dirty": False}
    if dirty:
        LOG(f"{kind}: working tree is dirty under its source paths, building without caching")
        builder(wt)
        return {var: str(produced_path(wt, kind)), "key": key, "cached": False, "dirty": True}
    (Path(root) / "build" / kind).mkdir(parents=True, exist_ok=True)
    with key_lock(root, f"build-{kind}-{key}"):
        if cached_path.exists():
            touch(final)
            return {var: str(cached_path), "key": key, "cached": True, "dirty": False}
        builder(wt)
        stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=Path(root) / "build" / kind))
        try:
            shutil.copytree(produced_path(wt, kind), stage / inner, symlinks=True)
            os.rename(stage, final)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
    return {var: str(cached_path), "key": key, "cached": False, "dirty": False}


def produced_path(wt, kind):
    if kind == "api":
        return Path(wt) / API_PATH / "target/quarkus-app"
    return Path(wt) / "apps/gcsp-web/dist/gcsp-web/browser"


def build_api(wt, root, mvn=mvn_package):
    dirty = is_dirty(wt, [API_PATH])
    key = tree_key(wt, [API_PATH])
    result = build_cached(root, "api", key, wt, dirty, mvn, "quarkus-app", "PROOF_API_JAR")
    result["PROOF_API_JAR"] = str(Path(result["PROOF_API_JAR"]) / "quarkus-run.jar")
    return result


def build_web(wt, root, ng=None):
    ng = ng or (lambda tree: ng_build(tree, root))
    dirty = is_dirty(wt, list(WEB_PATHS))
    key = tree_key(wt, list(WEB_PATHS))
    return build_cached(root, "web", key, wt, dirty, ng, "browser", "PROOF_WEB_BROWSER")


def gc_build(root, kind, keep=3):
    base = Path(root) / "build" / kind
    if not base.is_dir():
        return [], []
    entries = sorted((p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    removed = []
    for path in entries[keep:]:
        with key_lock(root, f"build-{kind}-{path.name}"):
            shutil.rmtree(path, ignore_errors=True)
        removed.append(path.name)
    return removed, [p.name for p in entries[:keep]]


# ---- CLI ----

def repo_of(app):
    return Path(git(app, "rev-parse", "--show-toplevel"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    top = parser.add_subparsers(dest="group", required=True)
    node = top.add_parser("node").add_subparsers(dest="cmd", required=True)
    link = node.add_parser("link")
    link.add_argument("--app", required=True)
    link.add_argument("--replace", action="store_true")
    unlink = node.add_parser("unlink")
    unlink.add_argument("--app", required=True)
    node_gc = node.add_parser("gc")
    node_gc.add_argument("--keep", type=int, default=2)
    node_gc.add_argument("--repo", default=".")
    build = top.add_parser("build").add_subparsers(dest="cmd", required=True)
    for kind in ("api", "web"):
        sub = build.add_parser(kind)
        sub.add_argument("--worktree", required=True)
        sub.add_argument("--format", choices=("env", "json"), default="env")
    build_gc_parser = build.add_parser("gc")
    build_gc_parser.add_argument("--keep", type=int, default=3)
    build_gc_parser.add_argument("--kind", choices=("api", "web"), action="append")
    args = parser.parse_args(argv)
    try:
        root = state_root()
        if args.group == "node" and args.cmd == "link":
            info = link_node(args.app, root, args.replace)
            LOG(f"node {info['key']}: {'installed' if info['installed'] else 'cache hit'}, {info['state']}")
            print(json.dumps(info, sort_keys=True))
        elif args.group == "node" and args.cmd == "unlink":
            LOG("symlink removed" if unlink_node(args.app) else "no symlink to remove")
        elif args.group == "node":
            removed, kept = gc_node(root, repo_of(args.repo), args.keep)
            print(json.dumps({"removed": removed, "kept": kept}))
        elif args.cmd == "api":
            emit(build_api(args.worktree, root), args.format)
        elif args.cmd == "web":
            emit(build_web(args.worktree, root), args.format)
        else:
            for kind in args.kind or ("api", "web"):
                removed, kept = gc_build(root, kind, args.keep)
                print(json.dumps({"kind": kind, "removed": removed, "kept": kept}))
    except StackError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
