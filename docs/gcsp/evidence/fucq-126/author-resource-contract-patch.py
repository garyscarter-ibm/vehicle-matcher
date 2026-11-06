#!/usr/bin/env python3
"""Author an exact coordinator patch in memory. Never import or change the shared helper."""
import ast
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
SOURCE = ROOT / '_tools/test_resources.py'
BASE = '3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d'
original = SOURCE.read_text()
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != BASE:
    raise RuntimeError('Shared helper changed; coordinator must rebase this proposal, never overwrite it.')
candidate = original


def replace_once(old, new):
    global candidate
    if candidate.count(old) != 1:
        raise RuntimeError('Patch anchor is not unique: ' + old[:100])
    candidate = candidate.replace(old, new, 1)


replace_once('VERSION = "1.0.1"', 'VERSION = "1.0.1"\nRESOURCE_REVIEW_CONTRACT = 1\nLEDGER_BYTES = 2 * 1024 ** 2')
start = candidate.index('@contextlib.contextmanager\ndef handled_termination():')
end = candidate.index('\n\ndef read_json(', start)
candidate = candidate[:start] + '''@contextlib.contextmanager
def handled_termination():
    """Let normal finalizers run for SIGTERM/SIGHUP and Python's normal Ctrl-C."""
    main = threading.current_thread() is threading.main_thread()
    previous = {}

    def interrupt(signum, frame):
        raise KeyboardInterrupt("test supervisor received signal %d" % signum)

    try:
        if main:
            for signum in (signal.SIGTERM, signal.SIGHUP):
                previous[signum] = signal.getsignal(signum)
                signal.signal(signum, interrupt)
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
''' + candidate[end:]
replace_once('            yield\n        finally:\n            fcntl.flock(f, fcntl.LOCK_UN)',
             '            yield f\n        finally:\n            fcntl.flock(f, fcntl.LOCK_UN)')
start = candidate.index('    def _dead_owners(self):')
end = candidate.index('    def _usage(', start)
candidate = candidate[:start] + '''    def _read_ledger(self, lock_file):
        """Hold the existing stable lock; parse one bounded, no-follow ledger descriptor.

        Keep reservations.lock as the shared lock identity across atomic ledger replacement.
        Only ENOENT means a new empty ledger; uncertainty never erases foreign rows.
        """
        if lock_file.closed:
            raise ResourceError("reservation lock descriptor is closed")
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return {}
        except OSError as error:
            raise ResourceError("cannot read shared reservations: %s" % error)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > LEDGER_BYTES:
                raise ResourceError("shared reservation ledger is not a bounded regular file")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read(LEDGER_BYTES + 1)
            if len(raw) > LEDGER_BYTES:
                raise ResourceError("shared reservation ledger exceeded its bound")
            data = json.loads(raw, object_pairs_hook=self._unique_object)
            if not isinstance(data, dict) or len(data) > 10000:
                raise ValueError("invalid reservation object")
            for token, row in data.items():
                if not isinstance(token, str) or not token or not isinstance(row, dict):
                    raise ValueError("invalid reservation row")
                identity = row.get("owner")
                if not isinstance(identity, dict) or type(identity.get("pid")) is not int or identity["pid"] <= 0:
                    raise ValueError("invalid reservation owner")
                if identity.get("start") is not None and not isinstance(identity["start"], str):
                    raise ValueError("invalid owner start")
                for name in ("disk", "ram", "used", "rss"):
                    if type(row.get(name)) is not int or row[name] < 0:
                        raise ValueError("invalid reservation accounting")
                if row.get("root") is not None and (not isinstance(row["root"], str) or not Path(row["root"]).is_absolute()):
                    raise ValueError("invalid reservation root")
                if row.get("parent") is not None and not isinstance(row["parent"], str):
                    raise ValueError("invalid reservation parent")
                children = row.get("children", [])
                if not isinstance(children, list) or len(children) > 1000:
                    raise ValueError("invalid reservation children")
                if "launchPending" in row and type(row["launchPending"]) is not bool:
                    raise ValueError("invalid launch state")
                for child in children:
                    if (not isinstance(child, dict) or type(child.get("pid")) is not int or child["pid"] <= 0
                            or type(child.get("pgid")) is not int or child["pgid"] <= 0
                            or not isinstance(child.get("start"), str) or not child["start"]):
                        raise ValueError("invalid owned child identity")
            for token in data:
                seen = set(); current = token
                while current in data:
                    if current in seen:
                        raise ValueError("cyclic reservation parent")
                    seen.add(current); current = data[current].get("parent")
            return data
        except (OSError, ValueError, UnicodeError) as error:
            raise ResourceError("shared reservation ledger is unreadable or corrupt; preserved: %s" % error)
        finally:
            os.close(fd)

    @staticmethod
    def _unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate ledger key")
            result[key] = value
        return result

    def _write_ledger(self, data):
        if len(json.dumps(data).encode()) > LEDGER_BYTES:
            raise ResourceError("shared reservation ledger exceeds its bound; preserved")
        atomic_json(self.path, data)

    @staticmethod
    def _resources_absent(row):
        # Legacy rows with no root/child-state evidence remain charged for explicit reconciliation.
        if (not row.get("root") or "children" not in row or row.get("launchPending") is not False
                or os.path.lexists(row["root"])):
            return False
        for child in row["children"]:
            if process_alive(child) or group_has_live_members(child["pgid"]) is not False:
                return False
        return True

    def _dead_owners(self):
        # Snapshot under the shared lock, then perform bounded OS probes outside it.
        with locked(self.directory / "reservations.lock") as lock_file:
            data = self._read_ledger(lock_file)
        return {k: row for k, row in data.items()
                if not process_alive(row["owner"]) and self._resources_absent(row)}

    def _live(self, dead, lock_file):
        data = self._read_ledger(lock_file)
        # Retain every row whose identity, child binding or charge changed after the snapshot.
        return {k: row for k, row in data.items() if k not in dead or row != dead[k]}

    def begin_child(self, token):
        identity = owner()
        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._read_ledger(lock_file)
            if token not in live or live[token]["owner"] != identity:
                raise ResourceError("cannot bind a foreign or missing reservation")
            live[token]["launchPending"] = True
            self._write_ledger(live)

    def bind_child(self, token, child):
        identity = owner()
        if (type(child.get("pid")) is not int or child["pid"] <= 0
                or child.get("pgid") != child["pid"] or not child.get("start")):
            raise ResourceError("require exact owned PID/start/group identity")
        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._read_ledger(lock_file)
            if token not in live or live[token]["owner"] != identity or not live[token].get("launchPending"):
                raise ResourceError("child creation is not owned by this reservation")
            live[token].setdefault("children", []).append({key: child[key] for key in ("pid", "start", "pgid")})
            live[token]["launchPending"] = False
            self._write_ledger(live)

    def cancel_child_launch(self, token):
        """Caller requires actual guard no-child-created or verified local-handle cleanup, never an empty registry."""
        identity = owner()
        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._read_ledger(lock_file)
            if token not in live or live[token]["owner"] != identity:
                raise ResourceError("cannot clear a foreign or missing launch")
            live[token]["launchPending"] = False
            self._write_ledger(live)

''' + candidate[end:]
replace_once('import shutil\n', 'import shutil\nimport stat\n')
replace_once('''        with locked(self.directory / "reservations.lock"):
            live = self._live(dead)
            atomic_json(self.path, live)
            return self._capacity(live, free, memory)''', '''        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._live(dead, lock_file)
            return self._capacity(live, free, memory)''')
replace_once('''        with locked(self.directory / "reservations.lock"):
            live = self._live(dead)
            capacity = self._capacity(live, free, memory)''', '''        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._live(dead, lock_file)
            if token in live:
                raise ResourceError("reservation token already exists")
            capacity = self._capacity(live, free, memory)''')
replace_once('''                           "parent": capacity["parent"], "root": str(root) if root else None}
            atomic_json(self.path, live)''', '''                           "parent": capacity["parent"], "root": str(root) if root else None,
                           "children": [], "launchPending": False}
            self._write_ledger(live)''')
replace_once('        dead, identity = self._dead_owners(), owner()\n        free, memory',
             '        dead, identity = self._dead_owners(), owner()\n        if not identity.get("start"):\n            raise ResourceError("cannot establish reservation owner start identity")\n        free, memory')
start = candidate.index('    def update(self, token, used, rss):')
end = candidate.index('\n\ndef group_has_live_members(', start)
candidate = candidate[:start] + '''    def update(self, token, used, rss):
        identity = owner()
        if any(type(value) is not int or value < 0 for value in (used, rss)):
            raise ResourceError("refuse uncertain resource telemetry")
        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._read_ledger(lock_file)
            if token not in live or live[token]["owner"] != identity:
                raise ResourceError("telemetry reservation is missing or foreign")
            live[token].update(used=used, rss=rss)
            self._write_ledger(live)
            return True

    def release(self, token):
        # Probe outside the lock, and retain the charge on any uncertainty or concurrent row change.
        identity = owner()
        with locked(self.directory / "reservations.lock") as lock_file:
            data = self._read_ledger(lock_file)
        row = data.get(token)
        if row is None:
            raise ResourceError("reservation disappeared before release")
        if row["owner"] != identity or not self._resources_absent(row):
            raise ResourceError("reservation release lacks owned child/scratch absence")
        with locked(self.directory / "reservations.lock") as lock_file:
            live = self._read_ledger(lock_file)
            if live.get(token) != row:
                raise ResourceError("reservation changed during release; charge retained")
            del live[token]
            self._write_ledger(live)
''' + candidate[end:]
start = candidate.index('def stop_group(process):')
end = candidate.index('\n\nclass Scratch:', start)
candidate = candidate[:start] + '''def stop_group(process, timeout=9):
    """Bound leader waits; callers still verify the exact identity and full group absence."""
    deadline = time.monotonic() + timeout
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        except PermissionError as error:
            if error.errno != errno.EPERM or group_has_live_members(process.pid) is not False:
                raise
            break
        try:
            process.wait(timeout=max(0.001, min(3, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            continue
    try:
        process.wait(timeout=max(0.001, deadline - time.monotonic()))
    except subprocess.TimeoutExpired as error:
        raise ResourceError("owned child did not join before cleanup deadline") from error


def group_rss(pgid):
    try:
        p = subprocess.run(["/bin/ps", "-axo", "pgid=,rss="], capture_output=True, text=True, timeout=3)
        if p.returncode != 0 or p.stderr or not p.stdout.strip():
            return None
        total = 0
        for line in p.stdout.splitlines():
            parts = line.split()
            if len(parts) != 2 or not all(value.isascii() and value.isdigit() for value in parts) or int(parts[0]) <= 0:
                return None
            if int(parts[0]) == pgid:
                total += int(parts[1]) * 1024
        return total
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def verify_no_open_files(root, timeout=5):
    if not os.path.lexists(root):
        return
    try:
        result = subprocess.run(["/usr/sbin/lsof", "-t", "+D", str(root)], capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ResourceError("cannot establish open-file absence; scratch retained: %s" % root) from error
    if result.returncode != 1 or result.stdout or result.stderr:
        raise ResourceError("open files or uncertain status; scratch retained: %s" % root)
''' + candidate[end:]
replace_once('''                raise ResourceError("owned scratch identity changed: %s" % self.root)
            shutil.rmtree(self.root)''', '''                raise ResourceError("owned scratch identity changed: %s" % self.root)
            verify_no_open_files(self.root)
            shutil.rmtree(self.root)''')
replace_once('''                rss = group_rss(process.pid)
                peak_rss = max(peak_rss, rss)''', '''                rss = group_rss(process.pid)
                if rss is None:
                    issue = "RAM observation uncertain; full reservation stays charged"
                    rss = ram_limit
                peak_rss = max(peak_rss, rss)''')

ast.parse(candidate, filename='_tools/test_resources.py (proposed patch)')
patch = ''.join(difflib.unified_diff(original.splitlines(True), candidate.splitlines(True),
                                  fromfile='a/_tools/test_resources.py', tofile='b/_tools/test_resources.py', n=0))
patch_path = HERE / 'shared-resource-contract-review-repair-2026-11-06.patch'
patch_path.write_text(patch)
receipt = {'date': '2026-11-06', 'kind': 'Exact coordinator patch only; shared helper remains untouched',
           'basePath': '_tools/test_resources.py', 'baseSha256': BASE,
           'resultSha256': hashlib.sha256(candidate.encode()).hexdigest(), 'resultBytes': len(candidate.encode()),
           'patchPath': str(patch_path.relative_to(ROOT)), 'patchSha256': hashlib.sha256(patch.encode()).hexdigest(),
           'requiredContract': 1, 'patchFormat': 'Zero-context unified diff; require exact base hash and --unidiff-zero if using Git apply.', 'covers': ['R1', 'R2', 'R3', 'R4 bounded wait', 'R7 helper open-file check'],
           'validation': 'Exact baseline hash, unique edit anchors, resulting Python AST and unified diff authoring only.',
           'remaining': ['Coordinator review/adoption and shared caller compatibility validation',
                         'No helper behavior, signal, corrupt-ledger, process, lsof or cancellation checks executed',
                         'Legacy rows lacking new child-state evidence stay charged for explicit reconciliation',
                         'Existing generic run_process still has its separate launch-registration gap; this126 supervisor uses its own guard',
                         'Apply the helper rollout to all participating launchers; an old unpatched copy can still rewrite the common ledger'],
           'applied': False, 'executed': False}
(HERE / 'shared-resource-contract-review-repair-2026-11-06.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
