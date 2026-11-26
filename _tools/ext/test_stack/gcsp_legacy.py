"""DRAFT project extension for vehicle-matcher (SCAF-71): stop the old GCSP PostgreSQL cluster when moving to the kit test_stack.

Install in vehicle-matcher as _tools/ext/test_stack/gcsp_legacy.py and list it:
  {"extensions": {"test_stack": {"gcsp_legacy": {"bin": "/opt/homebrew/opt/postgresql@17/bin"}}}}

Why: the GCSP fork keeps ONE long-lived cluster under $GCSP_TEST_STACK_DIR (default ~/Library/Caches/gcsp-test-stack/pg/data).
The kit's postgres adapter keeps its own cluster under ~/Library/Caches/agent-scaffolding/test-stack/pg/<key>/. The layouts differ, so
the old state cannot be adopted, and a forgotten old cluster would be a second PostgreSQL on a 16 GB Mac. This adapter adds two
read-mostly commands for the cutover, then can be deleted from the project:

  test_stack.py gcsp-legacy status   JSON {dir, present, running, pid, databases} of the old cluster (never starts anything)
  test_stack.py gcsp-legacy down     stop the old cluster with pg_ctl -m fast (refuses while the old databases.json lists a
                                     database, unless --force); prints JSON {stopped, ...}. It deletes nothing: remove the old
                                     folder yourself once `status` says present and not running.

The old folder is $GCSP_TEST_STACK_DIR when set, else ~/Library/Caches/gcsp-test-stack. Config (CONFIG): `bin` the PostgreSQL bin
folder holding pg_ctl (default: pg_ctl on PATH). Contract: NAME, add_commands, status, gc (kit test_stack adapter contract).
Standard library only."""
import json
import os
from pathlib import Path
import subprocess

NAME = "gcsp_legacy"


def _old_root():
    raw = os.environ.get("GCSP_TEST_STACK_DIR") or os.path.join(os.path.expanduser("~"), "Library/Caches/gcsp-test-stack")
    return Path(raw).expanduser()


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def inspect():
    """Read-only facts about the old cluster: nothing is started, stopped or written."""
    root = _old_root()
    data = root / "pg" / "data"
    pid, running = None, False
    try:
        pid = int((data / "postmaster.pid").read_text().splitlines()[0])
        running = _alive(pid)
    except (OSError, ValueError, IndexError):
        pass
    try:
        databases = sorted((json.loads((root / "databases.json").read_text()) or {}).get("databases", {}))
    except (OSError, ValueError, AttributeError):
        databases = []
    return {"dir": str(root), "present": data.is_dir(), "running": running, "pid": pid, "databases": databases}


def _pg_ctl():
    folder = CONFIG.get("bin")
    return str(Path(os.path.expandvars(os.path.expanduser(folder))) / "pg_ctl") if folder else "pg_ctl"


def down(force=False):
    facts = inspect()
    if not facts["running"]:
        return dict(facts, stopped=False, reason="not running")
    if facts["databases"] and not force:
        return dict(facts, stopped=False, refused=True,
                    reason="the old registry lists databases: %s (use --force)" % ", ".join(facts["databases"]))
    done = subprocess.run([_pg_ctl(), "stop", "-D", str(Path(facts["dir"]) / "pg" / "data"), "-m", "fast", "-w", "-t", "60"],
                          capture_output=True, text=True, timeout=120)
    if done.returncode:
        return dict(facts, stopped=False, error=(done.stderr or done.stdout).strip()[:300])
    return dict(inspect(), stopped=True)


CONFIG = globals().get("CONFIG", {})      # kit_ext sets CONFIG (the record's config) before the module runs; {} elsewhere


def _command(args):
    result = inspect() if args.legacy_cmd == "status" else down(args.force)
    print(json.dumps(result, sort_keys=True))
    return 1 if result.get("refused") or result.get("error") else 0


def add_commands(subparsers, ctx):
    parser = subparsers.add_parser("gcsp-legacy", help="the old GCSP test-stack cluster (cutover helper)")
    commands = parser.add_subparsers(dest="legacy_cmd", required=True)
    commands.add_parser("status").set_defaults(func=_command)
    stop = commands.add_parser("down")
    stop.add_argument("--force", action="store_true")
    stop.set_defaults(func=_command)


def status(ctx):
    return inspect()


def gc(ctx):
    return {}
