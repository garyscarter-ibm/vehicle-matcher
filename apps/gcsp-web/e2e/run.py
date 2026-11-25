#!/usr/bin/env python3
"""Owned local composition for the persistent GCSP browser suite. No hosted services."""
import json
import argparse
import contextlib
import os
from pathlib import Path
import shutil
import shlex
import signal
import subprocess
import sys
import time
import threading
from urllib.parse import urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "_tools"))
import scaffold_git
import test_resources as resources

CASES = {
    'f340': 'apps/gcsp-web/e2e/suv-walkthrough.test.mjs',
    'f548': 'apps/gcsp-web/e2e/notification-bell.test.mjs',
    'f549': 'apps/gcsp-web/e2e/navigation-parity.test.mjs',
    'f550': 'apps/gcsp-web/e2e/live-refresh.test.mjs',
    'f551': 'apps/gcsp-web/e2e/account-parity.test.mjs',
    'f552': 'apps/gcsp-web/e2e/preferences-parity.test.mjs',
    'f555': 'apps/gcsp-web/e2e/offer-parity.test.mjs',
    'f556': 'apps/gcsp-web/e2e/orders-parity.test.mjs',
    'f561': 'apps/gcsp-web/e2e/presenter-parity.test.mjs',
    'f595': 'apps/gcsp-web/e2e/account-release-parity.test.mjs',
}


def parse_options(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', action='append', choices=tuple(CASES), dest='cases',
                        help='Run this registered case family; repeat to combine. Default: all registered cases.')
    parser.add_argument('--manual', action='store_true',
                        help='Hold only --case f340 for a person to operate, within the existing ten-minute run budget.')
    options = parser.parse_args(argv)
    options.cases = list(dict.fromkeys(options.cases or CASES))
    if options.manual and options.cases != ['f340']:
        parser.error('--manual requires --case f340 alone')
    return options


def selected_cases(argv):
    return parse_options(argv).cases


def suite_command(node, selected, manual=False):
    if manual:
        return [str(node), 'apps/gcsp-web/e2e/suv-walkthrough.manual.mjs']
    return [str(node), '--test', '--test-concurrency=1', *[CASES[name] for name in selected]]


def manual_ready(record, retained, run_id, source):
    if not isinstance(record, dict) or any(record.get(key) != value for key, value in
            [('state', 'ready'), ('run', run_id), ('sourceRevision', source),
             ('stopFile', str(retained / 'f340' / ('manual-stop-' + run_id)))]):
        return False
    origins = record.get('origins', {})
    if not isinstance(origins, dict):
        return False
    for name, host in [('web', 'gcsp-web.localhost'), ('api', 'gcsp-api.localhost')]:
        try:
            origin = urlsplit(origins.get(name, ''))
            if (origin.scheme != 'https' or origin.hostname != host or not origin.port
                    or origin.username or origin.password or origin.path or origin.query or origin.fragment):
                return False
        except (TypeError, ValueError):
            return False
    return record.get('links') == {'presenter': origins['web'] + '/gcsp/presenter',
                                   'paula': origins['web'] + '/gcsp/preferences'}


def observe_manual_session(retained, run_id, source, stop):
    while not stop.wait(.2):
        record = resources.read_json(retained / 'f340' / 'manual-session.json')
        if manual_ready(record, retained, run_id, source):
            print('F340 manual session ready. Open these links and sign in separately:\n'
                  'Presenter: ' + record['links']['presenter'] + '\nPaula: ' + record['links']['paula']
                  + '\nAPI certificate check: ' + record['origins']['api'] + '/api/gcsp/v1/context'
                  + '\nStop this session: touch -- ' + shlex.quote(record['stopFile'])
                  + '\nThe existing ten-minute startup/run budget still applies; Ctrl+C cancels and cleans up.', flush=True)
            return


@contextlib.contextmanager
def manual_readiness(retained, run_id, source):
    stop = threading.Event()
    observer = threading.Thread(target=observe_manual_session, args=(retained, run_id, source, stop),
                                name='f340-manual-readiness')
    observer.start()
    try:
        yield
    finally:
        stop.set()
        observer.join()


def local_path(value):
    path = Path(value).expanduser()
    pending = list(Path(os.path.abspath(path)).parts[1:])
    resolved, links = Path('/'), 0
    while pending:
        resolved /= pending.pop(0)
        # Check each target before any inspection; Path.resolve() could already follow a forbidden link.
        if any(word in str(resolved).lower() for word in ('onedrive', 'cloudstorage')):
            raise ValueError("Browser-suite paths must be local, outside synced folders")
        if resolved.is_symlink():
            links += 1
            if links > 32:
                raise ValueError("Too many path links")
            target = Path(os.path.abspath(resolved.parent / os.readlink(resolved)))
            if any(word in str(target).lower() for word in ('onedrive', 'cloudstorage')):
                raise ValueError("Browser-suite path link points into a forbidden synced folder")
            pending = list(target.parts[1:]) + pending
            resolved = Path('/')
    return resolved


def git_value(*args):
    code, value, error = scaffold_git.git(ROOT, list(args))
    if code:
        raise RuntimeError("Cannot read the suite's source identity: " + error[:200])
    return value.strip()


def run(command, env, *, capture=False):
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=capture, check=True)
    return result.stdout.strip() if capture else None


def identity(pid):
    result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'comm='],
                            text=True, capture_output=True, timeout=3)
    parts = result.stdout.split()
    if result.returncode or result.stderr or len(parts) < 8:
        return None
    return {'pid': int(parts[0]), 'pgid': int(parts[1]), 'start': ' '.join(parts[2:7]), 'executable': ' '.join(parts[7:])}


def journal_records(retained):
    journal = resources.read_json(retained / 'processes.json', {}) or {}
    return journal.get('processes', [])


def same_identity(record, current):
    return current is not None and all(current.get(key) == record.get(key) for key in ('pid', 'pgid', 'start', 'executable'))


def stop_recorded(retained):
    """Only direct children registered by the Node owner; no ancestry guesses or machine-wide signals."""
    evidence = {'signals': [], 'remaining': []}
    for record in reversed(journal_records(retained)):
        pid, group = record['pid'], record['pgid']
        current = identity(pid)
        if current is None:
            if group == pid and resources.group_has_live_members(group) is not False:
                evidence['remaining'].append({'name': record['name'], 'pid': pid, 'reason': 'leader absent; group state uncertain'})
            continue
        if not same_identity(record, current):
            evidence['remaining'].append({'name': record['name'], 'pid': pid, 'reason': 'identity changed; no signal sent'})
            continue
        for sig in (signal.SIGTERM, signal.SIGKILL):
            current = identity(pid)
            if current is None:
                break
            if not same_identity(record, current):
                break
            if group == pid:
                if group in (os.getpid(), os.getpgrp()):
                    raise resources.ResourceError('Refused to signal the supervisor group')
                os.killpg(group, sig)
            else:
                os.kill(pid, sig)
            evidence['signals'].append({'name': record['name'], 'identity': current, 'signal': sig.name})
            deadline = time.monotonic() + 3
            while identity(pid) is not None and time.monotonic() < deadline:
                time.sleep(.1)
        if identity(pid) is not None or group == pid and resources.group_has_live_members(group) is not False:
            evidence['remaining'].append({'name': record['name'], 'pid': pid, 'reason': 'owned child/group did not disappear'})
    resources.atomic_json(retained / 'process-cleanup.json', evidence)
    return evidence


@contextlib.contextmanager
def owned_scratch(retained, policy):
    scratch = resources.Scratch(retained, ROOT, policy, expected=2 * resources.GIB)
    scratch.__enter__()
    normal_rss = resources.group_rss

    def owned_rss(root_group):
        groups = {root_group}
        for record in journal_records(retained):
            if same_identity(record, identity(record['pid'])):
                groups.add(record['pgid'])
        return sum(normal_rss(group) for group in groups)

    resources.group_rss = owned_rss
    try:
        yield scratch
    finally:
        resources.group_rss = normal_rss
        cleanup = stop_recorded(retained)
        if cleanup['remaining']:
            scratch.record.update(state='cleanup-pending', cleanup=cleanup)
            resources.atomic_json(scratch.manifest, scratch.record)
            raise resources.ResourceError('Owned process cleanup is incomplete; scratch preserved in the manifest')
        scratch.__exit__(None, None, None)


def main():
    options = parse_options(sys.argv[1:])
    selected = options.cases
    os.environ.setdefault("SCAFFOLDING_HARNESS", "codex")
    # Enter the shared slot before allocating/building. The inner supervisor launches the actual
    # Node session itself, so its RSS monitor covers that session rather than just the queue wrapper.
    if not os.environ.get("GCSP_HEAVY_SLOT"):
        return subprocess.call([sys.executable, "-B", str(ROOT / "_tools/test_stack.py"), "heavy", "--label", "gcsp-web-e2e",
                                "--ram-gib", "3.5", "--", sys.executable, "-B", str(Path(__file__).resolve()), *sys.argv[1:]], cwd=ROOT)
    run_id = "web-e2e-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    common = local_path(ROOT / git_value("rev-parse", "--git-common-dir"))
    retained = local_path(os.environ.get("GCSP_E2E_OUTPUT", str(common.parent / ".claude/test-runs/web-e2e" / run_id)))
    if ROOT != common.parent and ROOT in retained.parents:
        raise ValueError("Retained browser evidence must be outside the disposable worktree")
    retained.mkdir(parents=True, exist_ok=True)
    policy = resources.Policy({
        "local_scratch_reason": "Explicit human restriction: no OneDrive access; bounded local browser scratch only.",
        # Measured parity composition exceeded 3 GiB by 39 MiB; above-3-GiB runs remain night/CI work.
        "output_root": str(retained), "chunk_scratch_mib": 2048, "chunk_ram_mib": 3584,
        "chunk_seconds": 600, "log_mib": 2,
    })
    receipt = {"schema": "gcsp-browser-suite/1", "run": run_id, "started": time.time(),
               "source_revision": git_value("rev-parse", "HEAD"), "scope": "Registered browser cases, real Java/OIDC/PostgreSQL",
               "mode": "manual" if options.manual else "automated", "selected_cases": selected,
               "test_files": [] if options.manual else [CASES[name] for name in selected],
               "full_suites": "deferred to dispatcher batch", "retained": str(retained)}
    if options.manual:
        receipt.update(scope='Held F340 manual walkthrough; startup sign-in probes only, no automated journey tests',
                       manual_entrypoint='apps/gcsp-web/e2e/suv-walkthrough.manual.mjs')
    scratch = None
    database_created = False
    try:
        with resources.handled_termination(), owned_scratch(retained, policy) as scratch:
            env = scratch.env(os.environ)
            env.update({"GCSP_E2E_OUTPUT": str(retained), "SCRATCH": str(scratch.root),
                        "PROOF_RUN_TOKEN": run_id, "PROOF_SOURCE_REVISION": receipt["source_revision"]})
            deadline = time.monotonic() + 560
            receipt['chunks'] = []

            def bounded(command, label, capture=False):
                log = retained / (label + '.log')
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise resources.ResourceError('The owned ten-minute chunk is exhausted before ' + label)
                result = resources.run_process(command, ROOT, env, log, scratch, policy,
                                               2 * resources.GIB, 3.5 * resources.GIB, remaining)
                receipt['chunks'].append({'label': label, **result})
                if result['rc'] or result['issue']:
                    raise resources.ResourceError(label + ' failed; inspect ' + str(log))
                return log.read_text().strip() if capture else None

            node = local_path(env.get("GCSP_E2E_NODE") or env.get("npm_node_execpath") or shutil.which("node") or "node")
            if bounded([str(node), "--version"], 'node-version', capture=True) != "v24.22.3":
                raise ValueError("Use pinned Node 24.22.3 (or set GCSP_E2E_NODE to that executable)")
            receipt["node"] = str(node)
            if env.get('GCSP_NODE_REFERENCE'):
                reference = local_path(env['GCSP_NODE_REFERENCE'])
                code, revision, error = scaffold_git.git(reference, ['rev-parse', 'HEAD'])
                if code or revision.strip() != 'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38':
                    raise ValueError('The Node reference is not the pinned frozen commit')
                env['GCSP_NODE_REFERENCE'] = str(reference)
                env['GCSP_NODE_REFERENCE_REVISION'] = revision.strip()
                receipt['node_reference'] = {'path': str(reference), 'revision': revision.strip()}
                if env.get('GCSP_E2E_PG_MODULE'):
                    env['GCSP_E2E_PG_MODULE'] = str(local_path(env['GCSP_E2E_PG_MODULE']))
            # The shared helper reuses lockfile installs and builds; it never creates a new PG cluster per run.
            for kind, variable, key in (("api", "PROOF_API_JAR", "PROOF_API_JAR"), ("web", "PROOF_WEB_BROWSER", "PROOF_WEB_BROWSER")):
                if not env.get(variable):
                    output = bounded([sys.executable, "-B", "_tools/test_stack_build.py", "build", kind, "--worktree", str(ROOT)], 'build-' + kind, capture=True)
                    matches = [line.partition("=")[2] for line in output.splitlines() if line.startswith(key + "=")]
                    if not matches:
                        raise RuntimeError("Shared build did not return " + key)
                    env[variable] = matches[-1]
                env[variable] = str(local_path(env[variable]))
            bounded([sys.executable, "-B", "_tools/test_stack.py", "pg", "up"], 'pg-up')
            db = bounded([sys.executable, "-B", "_tools/test_stack.py", "pg", "db", "create", "--run", run_id,
                          "--format", "json", "--owner-pid", str(os.getpid())], 'pg-create', capture=True)
            database_created = True
            env.update(json.loads(db))
            # One owned session contains Node, Java and Playwright's browser descendants.
            # Java is spawned without detached:true so the outer group finalizer also covers cancellation.
            command = suite_command(node, selected, options.manual)
            try:
                with manual_readiness(retained, run_id, receipt['source_revision']) if options.manual else contextlib.nullcontext():
                    bounded(command, 'manual' if options.manual else 'suite')
                receipt["result"] = receipt['chunks'][-1]
            finally:
                # The database helper is itself a measured, joined child, with a cleanup reserve.
                dropped = resources.run_process([sys.executable, '-B', '_tools/test_stack.py', 'pg', 'db', 'drop', '--run', run_id],
                                                ROOT, env, retained / 'pg-drop.log', scratch, policy,
                                                2 * resources.GIB, 3.5 * resources.GIB, 30)
                receipt['chunks'].append({'label': 'pg-drop', **dropped})
                receipt['database_dropped'] = dropped['rc'] == 0 and not dropped['issue']
                database_created = not receipt['database_dropped']
    finally:
        if database_created:
            try:
                dropped = subprocess.run([sys.executable, "-B", "_tools/test_stack.py", "pg", "db", "drop", "--run", run_id],
                                         cwd=ROOT, text=True, capture_output=True, timeout=30)
                receipt["database_dropped"] = dropped.returncode == 0
            except Exception as error:
                receipt['database_dropped'] = False
                receipt['database_cleanup_issue'] = type(error).__name__
        receipt["finished"] = time.time()
        receipt["scratch_removed"] = scratch is not None and not os.path.lexists(scratch.root)
        if scratch is not None:
            receipt["scratch"] = str(scratch.root)
            receipt["manifest"] = str(scratch.manifest)
        resources.atomic_json(retained / "run-receipt.json", receipt)
    result = receipt.get("result", {})
    print(json.dumps({"receipt": str(retained / "run-receipt.json"), "exit": result.get("rc"),
                      "scratch_removed": receipt["scratch_removed"], "database_dropped": receipt.get("database_dropped")}))
    return 0 if result.get("rc") == 0 and not result.get("issue") and receipt["scratch_removed"] and receipt.get("database_dropped") else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # No environment values, tokens, authorization headers or request bodies are printed.
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(1)
