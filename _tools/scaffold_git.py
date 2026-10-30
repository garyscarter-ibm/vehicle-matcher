#!/usr/bin/env python3
VERSION = "1.3.0"      # first, so the update check finds it within its first lines, ahead of the long docstring
__doc__ = """scaffold_git.py -- the one place a scaffolded project runs git for its dev inbox and its team. Vendored into a
project's `_tools/` by project-scaffolding; a generic port of the Account Corpus's corpus_git.py.

Subcommands
  sweep                    rename stale .git lockfiles (older than 10 minutes) aside, for repos on mounts that refuse
                           unlink; works whatever "sweep_locks" says (see Settings and "Why this file exists")
  status [--paths P ...]   print uncommitted changes (porcelain lines), only under P when given; read-only, exit 0
  commit --message MSG [--paths P ...] [--dry-run]
                           lock-aware, identity-checked, size-guarded commit; with --paths it stages
                           (git add -A -- P) and commits only under P, leaving the rest of the tree as it was
  fetch [--branch B]       fetch the remote's B (default: the base branch) into <remote>/B; the working tree is untouched
  list-tree REF PREFIX     list files under PREFIX in REF; read-only
  show REF PATH            print PATH as held in REF; read-only
  diff BASE HEAD           list the files HEAD changed since it left BASE (three-dot); read-only
                           (these three refuse, exit 2, any REF, BASE, HEAD, PREFIX or PATH that starts with `-`, which
                           git could take for an option; the library functions list_tree, show and changed_files too)
  push                     push the base branch to the remote, refused if the remote's copy has commits the local one
                           lacks (never merges); done if git exits non-zero but the remote matches afterwards
  pull                     bring <remote>/<base> into the base branch in the shared checkout (fast-forward, else a
                           merge commit); aborts cleanly on conflict, so the branch is as it was. Refused (2) while a
                           merge is already in progress there (MERGE_HEAD exists): it is never aborted for you
  worktree --id ID         new worktree .claude/worktrees/ID on a new branch dev/ID from the base branch
  merge --branch dev/ID    merge a dev/ branch into the base branch in the shared checkout; aborts cleanly on conflict
  drop-branch --id ID      remove the worktree and delete the branch dev/ID, once it is merged into the base branch;
                           in team mode it also deletes the story's lease (see "Story claims")
  claim --id ID --points N claim a waiting story (see "Story claims" below)
  claim-release --id ID    delete a story's lease by hand: ours, or the story is in neither code-inbox nor in-progress
  leases [--prefix P]      list the remote's refs/leases/* with holder login, host and taken time, one tab-separated
                           line each; read-only. P (e.g. story/) limits it to leases under refs/leases/P
  pen take|renew|release|status|sync
                           the pen: one data writer's Mac at a time writes the protected paths (see "The pen")
  guard                    offline: exit 0 when this machine may write the protected paths, else exit 2 with the reason
                           (see "Protected paths and the merge check")

Settings: top-level keys of <project>/.claude/scaffolding.json (the record test_stamp.py also reads)
  "base_branch": "main"    the branch the dev inbox merges into and pushes. Absent: `main` if that branch exists,
                           else `master`.
  "remote": "origin"       the remote fetched from and pushed to. Absent: origin.
  "sweep_locks": false     true: before and after every git call, rename aside the .git lockfiles older than 10
                           minutes (STALE_LOCK_SECS), for repos on mounts that refuse unlink (OneDrive, Box). Default
                           false. Anything but true or false is refused with exit 2.
  A linked worktree with no record of its own reads the shared checkout's. A malformed value (empty, or a name git
  could take for an option) is refused with exit 2 and the key named.
  "team": {..., "data_writers": [...],
           "protected": {"paths": ["model/", "changes/"], "label": "model data"},
           "pen_ref": "refs/leases/model"}
                           all optional (see "The pen" and "Protected paths and the merge check"). `protected.paths` are
                           repo-relative prefixes (a trailing / for a folder; no absolute path, no `..`, no empty string,
                           no backslash); `label` names them in messages (default "protected data"); `pen_ref` is the
                           pen's lease ref (default refs/leases/pen; a lease ref, and not under refs/leases/story/).
                           Without `protected`, none of the pen or merge-check rules apply.

Extension: <project>/_tools/scaffold_ext.py, optional
  def commit_lock(root) -> ("held", detail) | ("free", "")
      Whether something in the project is mid-write, so that a commit would capture half-finished files (the corpus's
      apply lock). Held: commit, pull and merge refuse (exit 2) and say why. The file is loaded by path with importlib,
      so _tools is never put on sys.path for it; an extension that needs its siblings adds the path itself. An
      extension that raises, or answers with anything but those two shapes, is reported as a refusal naming the
      error, never as a traceback. No file, or no commit_lock in it: no lock.
  def pre_merge_checks(root, branch) -> list of refusal strings | [] | None
      Extra refusals for `merge --branch dev/ID`, asked after this tool's own checks and before it merges, only in
      team mode with protected paths. Any string refuses (exit 2) and is said. An extension that raises, or answers with
      anything but a list of strings, is reported as a refusal naming the error. No pre_merge_checks in it: none.

One command at a time per checkout
----------------------------------
pull, merge, claim, claim-release, commit, drop-branch, worktree and the pen's take, renew, release and sync each hold a
mutex for their whole run: fcntl.flock on `scaffold-git.mutex` in the shared checkout's git common dir (so every worktree
of the repository shares it; the name does not end `.lock`, so no sweep touches it). A command that finds it held retries
for up to 30 seconds, then exits 2 "another scaffold_git.py command is running in <root>". It is re-entrant within one
process (claim and pen take call pull), is released on any exit, exception included, and is the open file, so a dead
process frees it. On a platform without fcntl it does nothing. pull, merge and claim also refuse up front (exit 2) while
`git rev-parse -q --verify MERGE_HEAD` succeeds: "a merge is already in progress in <root>; finish or abort it first",
because someone is resolving it by hand and a failed merge here would abort their work.

Team mode: the `team` block of the record (.claude/scaffolding.json) and, per machine, .claude/member.json
({"login": ...}, git-ignored). The block is read as dev_mail.py reads it: "mode": "team", "members" (login -> {name,
prefix}), "data_writers" (a list; the old string "data_writer" reads as a one-item list) and "owner" (default: the member
with the empty prefix, else the first listed). The login in member.json must be a member. A linked worktree with no
member.json (or record) of its own reads the shared checkout's. Without a team block (or with "mode": "single") the
tool behaves as a single-player project: no leases.

The pen
-------
Only with a `team.protected` block (team mode): the refs/leases/pen lease (or the record's `team.pen_ref`, e.g. the
Account Corpus's refs/leases/model) is a parentless commit of the empty tree whose message is JSON
{"login","host","taken","expires","client"}; expiry is 2 hours from take or renew. Every write to it is a compare-and-swap push
(--force-with-lease=<ref>:<old sha>, or : for "must not exist"), so two Macs racing for it cannot both win.
  pen take     pull first (refused if that fails), then create the lease, or replace it when expired or already ours;
               refused (2) while someone else holds it unexpired
  pen renew    extend our own lease
  pen release  delete our own lease; refused while the protected paths have uncommitted changes or the base branch has
               commits <remote>/<base> lacks (push first), so the next writer pulls everything
  pen status   print the holder and expiry, or none
  pen sync     the one call the poller makes each pass on a writer Mac: acts only when this Mac's member is one of 2 or
               more data_writers; takes the pen when .claude/pen-wanted.json was touched in the last 30 minutes (guard
               touches it whenever a write is refused or allowed), renews it while wanted, releases it when idle
Without protected paths every pen command prints `PEN not used: no protected paths` and exits 0.
Every take, renew and release writes (release removes) the git-ignored mirror .claude/pen.json
{"login","expires","sha","client"} in the shared checkout, which the guard reads without touching the network. The
member's login comes from .claude/member.json.
  take         after the compare-and-swap push wins it pulls once more (the writer before us may have pushed in between)
               and says the result in its message; if that pull fails the pen stays taken and the message says so.
  release      clears the mirror first, so a guard that runs meanwhile sees no pen; then refuses while the project's
               commit lock is held (a write in flight), while the protected paths are dirty or while commits are unpushed;
               then deletes the lease. The mirror is put back on any refusal or failure.
  sync         a pen it keeps (protected paths dirty, or unpushed commits) it renews, and says "PEN KEPT and renewed
               until <expires>: <reason>"; a failed renewal is reported as it is.
Clock skew: the guard treats the pen as expired PEN_SKEW_SECS (5 minutes) before its expiry, so this Mac stops writing
before another could take the lease; take keeps waiting until the expiry itself.
A push that git reports as failed but that landed (the remote's lease is the commit we pushed) counts as done, for the
pen and for story claims.

Clients
-------
Two Macs may share one member login. Each clone has an id, `git config scaffold.clientId` in the shared checkout's
config (client_id(root); made as uuid4().hex[:12] and written there the first time), and every lease (pen and story)
carries it as "client". A lease is ours when the login and the client both match; a lease with our login and another
client is refused ("TAKEN by <login> on <host> (another clone of the same member)" for a claim, held-by-other for the
pen). A lease with no "client" (written by an older tool such as the corpus's corpus_git.py) is ours when the login and
the host (socket.gethostname()) match, and another clone otherwise. The guard also checks the mirror's "client" against
this clone's.

Per-machine files
-----------------
.claude/member.json, .claude/pen.json, .claude/pen.json.released, .claude/pen-wanted.json and .claude/jira-sync.json
belong to one machine and are never committed. ensure_ignored(root, names) appends any of them missing to the shared
checkout's .git/info/exclude (the file is created if absent, its content kept, one line each, idempotent); it runs
whenever this tool writes one of them and whenever member_login finds member.json. commit refuses (exit 2, naming the
file) to stage any of them even when the project's ignore rules miss them, e.g. after `git add -f`. The module also offers pen_line(root, now) (`pen none`, `pen <login> until <iso>`
or `pen expired`, from the mirror) for dev_mail.py's team listing.

Protected paths and the merge check
-----------------------------------
`team.protected.paths` name what only a data writer may change, the `label` what to call it in messages.
  guard        offline, no network: exit 0 when this machine may write them, else exit 2 and the reason. Not in team
               mode, or no protected paths: allowed. Else the member must be in data_writers; with two or more writers
               the mirror must also show an unexpired pen of ours. A refusal for lack of the pen (and a success)
               touches .claude/pen-wanted.json so the poller on this Mac takes the pen. Unusable settings refuse.
               Any harness or a project's own command can call it, or import data_writer_problem(root, now) (None
               when allowed) and require_data_writer(root) (raises NotDataWriter).
  merge        in team mode, before merging dev/<id>:
               - the claimer is the holder of the story lease (refs/leases/story/<id>: the only record written by
                 compare-and-swap, and it lives until drop-branch, which runs after the merge); failing that,
                 `claimed_by:` in _dev/in-progress/<id>.md on the BASE branch. The story file on the branch being merged
                 is never read: its author can edit it. A lease that cannot be read is exit 3, never a pass.
               - a branch that changed the `team` block of .claude/scaffolding.json (the parsed value at the base branch
                 against the branch) is refused unless the claimer is the team's owner. This applies whenever there is a
                 team block, protected paths or not.
               - with protected paths: list the files the branch changed since it left the base branch; if any is under a
                 protected path, refuse (exit 2) unless the claimer is in data_writers, naming the first 5 files, the label
                 and the claimer. With two or more data_writers the merging Mac must also pass data_writer_problem(root),
                 that is hold the pen; refused otherwise, with that reason.
               - then scaffold_ext.pre_merge_checks(root, branch), if defined, may refuse too (protected paths only).
               This holds for any harness, with no project-specific guard. Path matching ignores case and Unicode
               normalisation, so a checkout on a case-insensitive disk cannot slip past it.
Without a team block, merge is as before; with a team block but no protected paths only the team-block rule applies.

Story claims
------------
The story queue is shared between team members, so a claim is a lease: refs/leases/story/<ID> on the remote, a
parentless empty-tree commit whose message is JSON {"login","host","story","taken","client"}, created with a create-only
compare-and-swap push (--force-with-lease=<ref>:), so of two Macs claiming one story at once exactly one wins. It has
no expiry. The same lease primitive (lease_read, lease_commit, lease_push) serves any ref under refs/leases/; a ref
outside it, or with an unsafe path part, is refused (exit 2 from a command, rc 2 from the function), so no caller can
push an arbitrary ref.
  claim        pull; refuse (TAKEN, 2) when the story is no longer in _dev/code-inbox or another member holds its
               lease; take the lease; move the story to _dev/in-progress/ adding `story_points: N`, `agent: <harness>` (when
               $SCAFFOLDING_HARNESS is set: letters, digits . _ -; `claude` is written as `claude-code`) and
               `claimed_by: <login>` (replacing a `claimed_by:` a re-queued story still carries); commit those two paths as "dev: claim <ID> <title>"; push (once more after a pull
               when the remote moved; still refused, the commit stays local and the claim is done, push pending). A
               failure before the commit puts the story back and deletes the lease. Without a team block there is no
               lease and no claimed_by line. A lease that is already ours (an earlier claim that stopped part-way) is
               reused.
  drop-branch  also deletes the story's lease once it is merged; a lease that cannot be deleted is said in the
               message, never fails the drop
  claim-release  deletes a lease by hand: ours, or the story is in neither code-inbox nor in-progress. Open or not is
               decided from <remote>/<base> after a fetch (list-tree), never from the local working tree, which may be
               stale; if the fetch fails it refuses (3) rather than guess

Why this file exists
--------------------
Some mounts (OneDrive, Box) refuse unlink ("Operation not permitted") but permit rename. git tolerates a failed
unlink of an object temp file, but a LEFTOVER .git/index.lock makes a later write fail with "Unable to create
'.git/index.lock': File exists". Renaming the lock aside into .git/_stale/ is the mount-legal equivalent of deleting
it. That rename is only right for a lock nobody holds, so sweeping is opt-in and age-limited: on an ordinary disk it can
break git's own locking (a `git commit` in a dev worktree holds .git/worktrees/<id>/index.lock while its editor is
open). The rule:
  - "sweep_locks": true in the record (a repo on a mount that refuses unlink): sweep() runs before and after every git
    call, moving aside only lockfiles whose mtime is older than 10 minutes (STALE_LOCK_SECS);
  - otherwise (the default) never sweep beforehand. A git call that fails with "Unable to create '...lock': File exists"
    sweeps that one lock, only if it is older than 10 minutes, and is retried once;
  - the `sweep` command always sweeps the locks older than 10 minutes.

Route every dev-inbox write through this module, so one place decides the base branch, the remote, the identity check,
the size guard and the lock.

Exit codes
  0  done, or nothing to do (a claim whose push is pending is 0, and says so)
  2  refused: lock held, no repo-local identity, size guard tripped, wrong branch or checkout, bad settings or arguments,
     a bad team block, no team member on this machine, a story TAKEN by someone else, a lease ref outside refs/leases/, the pen held by
     someone else, a merge that touches protected paths without a data writer's claim (or without the pen, with several writers),
     a merge that changes the team block without the owner's claim, a merge already in progress, another scaffold_git.py
     command holding the checkout's mutex for 30 seconds, an argument starting with `-`, a refusal from pre_merge_checks
  3  git itself failed (including a lease push lost for a reason other than another member's lease; claim-release when
     the remote cannot be fetched)
On any non-zero exit the working tree is left exactly as it was -- dirty -- so a human sees it.

Stdlib only. No network except fetch, push, pull and the lease commands (claim, claim-release, drop-branch in team mode, leases,
pen); guard never touches the network.
Session-agnostic: the project root is derived from this file's
location (<root>/_tools/scaffold_git.py) unless --root is given.
"""
import argparse
import contextlib
import datetime
import errno
import functools
import importlib.util
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import unicodedata
import uuid

try:
    import fcntl
except ImportError:      # a platform without flock (Windows): the per-checkout mutex below is then a no-op
    fcntl = None

sys.dont_write_bytecode = True

MAX_BLOB_BYTES = 50 * 1024 * 1024      # GitHub warns above this
MAX_STAGED_BYTES = 200 * 1024 * 1024   # a runaway staging set
MAX_STAGED_FILES = 5000

DEV_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
REF_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")     # a branch or remote name; never starts like an option
ATTRIBUTION = "Co-Authored-By: Claude Code <noreply@anthropic.com>"
DEFAULT_REMOTE = "origin"
BASE_CANDIDATES = ("main", "master")
ISO = "%Y-%m-%dT%H:%M:%SZ"
LEASE_ROOT = "refs/leases/"
LEASE_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")      # one path part of a lease ref; never starts like an option
STORY_LEASE = LEASE_ROOT + "story/"
POINTS = (1, 2, 3, 5, 8, 13, 21)
INBOX, WIP = "_dev/code-inbox/", "_dev/in-progress/"
DONE = "_dev/done/"
PEN_REF = LEASE_ROOT + "pen"        # the default pen lease; the record's team.pen_ref overrides it
PEN_TTL = 2 * 3600                  # a lease lasts 2 hours from take or renew
PEN_WANTED_SECS = 30 * 60           # pen-wanted.json touched within this long means a writer on this Mac wants the pen
DEFAULT_LABEL = "protected data"
PEN_UNUSED = "PEN not used: no protected paths"
MUTEX_NAME = "scaffold-git.mutex"   # in the shared checkout's git common dir; not *.lock, so no sweep touches it
MUTEX_WAIT = 30.0                   # seconds a command waits for another scaffold_git.py command before it gives up
SCAFFOLDING_RECORD = ".claude/scaffolding.json"
STALE_LOCK_SECS = 600               # a git lockfile younger than this may belong to a command that is running
PEN_SKEW_SECS = 300                 # the guard treats the pen as expired this long before its expiry (clock skew)
LOCAL_FILES = (".claude/member.json", ".claude/pen.json", ".claude/pen.json.released", ".claude/pen-wanted.json",
               ".claude/jira-sync.json")      # per-machine files; never committed
CLONE_NOTE = " (another clone of the same member)"


class SettingsError(Exception):
    """A malformed value in the record's base_branch, remote or team block."""


def project_root(override=None):
    if override:
        return os.path.abspath(override)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def is_repo(root):
    """A git checkout: .git is a directory, or, in a linked worktree, a file naming the real one ("gitdir: ...")."""
    dot = os.path.join(root, ".git")
    if os.path.isdir(dot):
        return True
    try:
        with open(dot, encoding="utf-8") as f:
            return f.read(8) == "gitdir: "
    except OSError:
        return False


def is_linked_worktree(root):
    return os.path.isfile(os.path.join(root, ".git"))


def _lock_is_stale(path, min_age):
    try:
        return time.time() - os.stat(path).st_mtime > min_age
    except OSError:
        return False


def _move_aside(src, stale_dir, rel):
    """Rename one lockfile into stale_dir (the mount-legal equivalent of deleting it). True when moved."""
    try:
        os.makedirs(stale_dir, exist_ok=True)
        os.replace(src, os.path.join(stale_dir, "%s.%d" % (rel.replace(os.sep, "_"), time.time_ns())))
        return True
    except OSError as e:
        print("WARN could not sweep %s: %s" % (src, e), file=sys.stderr)
        return False


def sweep(root, verbose=False, min_age=STALE_LOCK_SECS):
    """Rename aside every git lockfile (`*.lock`, `gc.pid`) under root/.git whose mtime is older than min_age seconds
    (default STALE_LOCK_SECS, 10 minutes), worktrees' included. A younger lock may belong to a git command that is
    running now (a commit with its editor open), so it is never touched. Returns how many were moved."""
    gitdir = os.path.join(root, ".git")
    stale = os.path.join(gitdir, "_stale")
    if not os.path.isdir(gitdir):
        return 0
    moved = 0
    for here, dirs, files in os.walk(gitdir):
        if os.path.abspath(here).startswith(os.path.abspath(stale)):
            dirs[:] = []
            continue
        for fn in files:
            if fn.endswith(".lock") or fn == "gc.pid":
                src = os.path.join(here, fn)
                if _lock_is_stale(src, min_age) and _move_aside(src, stale, os.path.relpath(src, gitdir)):
                    moved += 1
                    if verbose:
                        print("swept %s" % os.path.relpath(src, root))
    return moved


def _sweeping_on(root):
    """Whether root's own record sets "sweep_locks": true. Read straight from the file, because git() calls this; a bad
    value counts as off here and is refused by main() (sweep_locks). A linked worktree has no .git directory to sweep."""
    if not os.path.isdir(os.path.join(root, ".git")):
        return False
    try:
        with open(os.path.join(root, SCAFFOLDING_RECORD), encoding="utf-8") as f:
            rec = json.load(f)
    except (OSError, ValueError):
        return False
    return isinstance(rec, dict) and rec.get("sweep_locks") is True


def sweep_locks(root):
    """The record's `sweep_locks` setting: True or False (default). SettingsError for any other value."""
    value = read_record(root).get("sweep_locks", False)
    if not isinstance(value, bool):
        raise SettingsError("scaffolding.json: sweep_locks %r must be true or false" % (value,))
    return value


LOCK_EXISTS = re.compile(r"Unable to create '([^'\n]+\.lock)': File exists")


def _sweep_failed_lock(root, err):
    """After a git call failed: when git says it could not create one `.lock` because it exists, and that file is older
    than STALE_LOCK_SECS, move just it aside. True when something was moved (the call is worth retrying)."""
    m = LOCK_EXISTS.search(err or "")
    if not m:
        return False
    path = os.path.normpath(os.path.join(root, m.group(1)))
    gitdir = path
    while os.path.basename(gitdir) != ".git":                 # the .git directory that holds it
        parent = os.path.dirname(gitdir)
        if parent == gitdir:
            return False
        gitdir = parent
    if not os.path.isfile(path) or not _lock_is_stale(path, STALE_LOCK_SECS):
        return False
    return _move_aside(path, os.path.join(gitdir, "_stale"), os.path.relpath(path, gitdir))


def git(root, args, capture=True, input=None):
    """Run git in root. Returns (rc, out, err). With "sweep_locks": true in the record, stale locks (STALE_LOCK_SECS) are
    swept before and after. Either way, a call that fails on "Unable to create '...lock': File exists" sweeps that one
    lock if it is stale, and is retried once."""
    sweeping = _sweeping_on(root)
    if sweeping:
        sweep(root)
    p = subprocess.run(["git", "-C", root] + args, capture_output=capture, text=True, input=input)
    if p.returncode != 0 and _sweep_failed_lock(root, p.stderr):
        p = subprocess.run(["git", "-C", root] + args, capture_output=capture, text=True, input=input)
    if sweeping:
        sweep(root)
    return p.returncode, (p.stdout or ""), (p.stderr or "")


def _git_error(text):
    """git's own error lines. A remote's pre-receive hooks prefix every push's output with "remote:" lines, which
    would otherwise fill the message and hide the error; the "To <url>" line says nothing either."""
    lines = [l.strip() for l in text.splitlines()
             if l.strip() and not l.startswith("remote:") and not l.startswith("To ")]
    return ("; ".join(lines) or text.strip())[-300:]


# ---------------------------------------------------------------- the per-checkout mutex

class MutexBusy(Exception):
    """Another scaffold_git.py command held the checkout's mutex for the whole wait."""


_mutex_held = threading.local()      # per thread: mutex file -> how many times this thread has taken it


def _mutex_path(root):
    """The mutex file in the shared checkout's git common dir (one per repository, whichever worktree root is), or None
    when git cannot say."""
    rc, out, _ = git(root, ["rev-parse", "--git-common-dir"])
    if rc != 0 or not out.strip():
        return None
    common = os.path.realpath(os.path.join(root, out.strip()))
    return os.path.join(common, MUTEX_NAME) if os.path.isdir(common) else None


@contextlib.contextmanager
def checkout_mutex(root):
    """Hold the repository's mutex (fcntl.flock on <git common dir>/scaffold-git.mutex) for the block, so that two
    scaffold_git.py commands never write the same checkout at once. Contention is retried for MUTEX_WAIT seconds, then
    MutexBusy. Re-entrant within one thread (claim and pen take call pull). The lock is the open file, so it is gone
    when the block ends, by return or exception, and when the process dies. Where there is no fcntl, or the mount
    refuses flock or the file, it does nothing."""
    path = _mutex_path(root)
    held = vars(_mutex_held).setdefault("held", {})
    if fcntl is None or path is None:
        yield
        return
    if path in held:
        held[path] += 1
        try:
            yield
        finally:
            held[path] -= 1
        return
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        fd = None                                 # a read-only .git: nothing to lock with
    try:
        if fd is not None:
            deadline = time.monotonic() + MUTEX_WAIT
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError as e:
                    if e.errno not in (errno.EAGAIN, errno.EACCES, errno.EWOULDBLOCK):
                        break                     # this filesystem has no flock: go on unlocked, as on Windows
                    if time.monotonic() >= deadline:
                        raise MutexBusy("another scaffold_git.py command is running in %s" % shared_checkout(root))
                    time.sleep(0.05)
        held[path] = 1
        try:
            yield
        finally:
            del held[path]
    finally:
        if fd is not None:
            os.close(fd)


def _serialised(fn):
    """Run fn(root, ...) under checkout_mutex(root); a busy mutex is a refusal, (2, message)."""
    @functools.wraps(fn)
    def wrapper(root, *args, **kwargs):
        try:
            with checkout_mutex(root):
                return fn(root, *args, **kwargs)
        except MutexBusy as e:
            return 2, str(e)
    return wrapper


# ---------------------------------------------------------------- settings

def shared_checkout(root):
    """The folder of the main checkout, from any worktree of it; root itself when git cannot say."""
    rc, out, _ = git(root, ["rev-parse", "--git-common-dir"])
    if rc != 0 or not out.strip():
        return root
    return os.path.dirname(os.path.normpath(os.path.join(root, out.strip())))


def read_record(root):
    """The parsed .claude/scaffolding.json: root's own, else (a linked worktree without one) the shared checkout's.
    {} when there is none or it is not a JSON object."""
    paths = [os.path.join(root, ".claude", "scaffolding.json")]
    if is_linked_worktree(root):
        paths.append(os.path.join(shared_checkout(root), ".claude", "scaffolding.json"))
    for path in paths:
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as f:
                    rec = json.load(f)
            except (OSError, ValueError):
                return {}
            return rec if isinstance(rec, dict) else {}
    return {}


def _setting(rec, key):
    """A branch or remote name from the record, or None when absent. Raises SettingsError when it is malformed."""
    if key not in rec or rec[key] is None:
        return None
    value = rec[key]
    if not isinstance(value, str) or not REF_NAME.match(value) or ".." in value or value.endswith(("/", ".lock")):
        raise SettingsError("scaffolding.json: %s %r is not a usable name" % (key, value))
    return value


def remote_name(root):
    """The remote to fetch from and push to: the record's `remote`, else origin."""
    return _setting(read_record(root), "remote") or DEFAULT_REMOTE


def base_branch(root):
    """The branch the dev inbox merges into: the record's `base_branch`, else main if that branch exists, else master."""
    named = _setting(read_record(root), "base_branch")
    if named:
        return named
    for cand in BASE_CANDIDATES:
        if _branch_exists(root, cand):
            return cand
    return BASE_CANDIDATES[-1]


# ---------------------------------------------------------------- time and team

def iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime(ISO)


def parse_iso(s):
    """Epoch seconds of an ISO UTC stamp, None when it is not one."""
    try:
        return datetime.datetime.strptime(s, ISO).replace(tzinfo=datetime.timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def team_block(root):
    """The record's `team` block, normalised as dev_mail.py's load_team reads it, or None when the project is
    single-player (no block, or "mode": "single"). The returned dict keeps every key of the block and sets `members`
    (login -> its entry), `data_writers` (a list; the old string `data_writer` reads as a one-item list) and `owner`
    (default: the member with the empty prefix, else the first listed). Raises SettingsError for a block that is
    there but unusable, so a claim never runs leaseless by mistake."""
    team = read_record(root).get("team")
    if team is None or (isinstance(team, dict) and team.get("mode") == "single"):
        return None
    where = "scaffolding.json team"
    if not isinstance(team, dict) or team.get("mode") != "team":
        raise SettingsError("%s: mode must be 'team' (or 'single')" % where)
    members = team.get("members")
    if not isinstance(members, dict) or not members:
        raise SettingsError("%s: members must be an object of login -> {name, prefix}" % where)
    writers = team.get("data_writers", team.get("data_writer"))
    writers = [] if writers is None else [writers] if isinstance(writers, str) else writers
    if not isinstance(writers, list) or not all(isinstance(w, str) for w in writers):
        raise SettingsError("%s: data_writers must be a list of member logins" % where)
    for w in writers:
        if w not in members:
            raise SettingsError("%s: data_writer %r is not a member" % (where, w))
    owner = team.get("owner")
    if owner is None:
        owner = next((l for l, m in members.items() if isinstance(m, dict) and m.get("prefix") == ""),
                     next(iter(members)))
    elif owner not in members:
        raise SettingsError("%s: owner %r is not a member" % (where, owner))
    return dict(team, members=members, data_writers=writers, owner=owner)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def member_login(root):
    """This machine's member login from .claude/member.json (a linked worktree without one reads the shared
    checkout's), or None: not in team mode, no file, a bad file, or a login that is not a member."""
    team = team_block(root)
    if not team:
        return None
    me = _read_json(os.path.join(root, ".claude", "member.json"))
    if me is None and is_linked_worktree(root):
        me = _read_json(os.path.join(shared_checkout(root), ".claude", "member.json"))
    if me is not None:
        ensure_ignored(root)                      # member.json exists on this machine: it must never be committed
    login = me.get("login") if isinstance(me, dict) else None
    return login if isinstance(login, str) and login in team["members"] else None


def ensure_ignored(root, names=LOCAL_FILES):
    """Append any of `names` (repo-relative paths) missing from the shared checkout's .git/info/exclude, one line each,
    keeping what is there; creates the file if absent. Idempotent, best effort (a read-only .git is left alone). Returns
    True when every name is covered afterwards."""
    try:
        rc, out, _ = git(root, ["rev-parse", "--git-path", "info/exclude"])    # the common dir's, from any worktree
        if rc != 0 or not out.strip():
            return False
        path = os.path.join(root, out.strip())
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            text = ""
        have = {l.strip().lstrip("/") for l in text.splitlines()}
        missing = [n for n in names if n not in have]
        if missing:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(("\n" if text and not text.endswith("\n") else "") + "".join(n + "\n" for n in missing))
        return True
    except OSError:
        return False


def client_id(root):
    """This clone's id: `git config scaffold.clientId` of the shared checkout, made (uuid4().hex[:12]) and written there
    the first time. Two Macs with one member login differ by it, so a lease says which clone holds it."""
    shared = shared_checkout(root)
    rc, out, _ = git(shared, ["config", "--local", "--get", "scaffold.clientId"])
    if rc == 0 and out.strip():
        return out.strip()
    cid = uuid.uuid4().hex[:12]
    git(shared, ["config", "--local", "scaffold.clientId", cid])
    return cid


def lease_ours(root, holder, login):
    """Whether a lease (its JSON plus "sha") is this clone's: the same login and the same client. A lease with no
    `client` field (written by an older tool) is ours when the login and the host (socket.gethostname()) match."""
    if not holder or not login or holder.get("login") != login:
        return False
    client = holder.get("client")
    if isinstance(client, str) and client:
        return client == client_id(root)
    return holder.get("host") == socket.gethostname()


def _same_member(holder, login):
    """The note to add when a lease names our login but is not ours (so it is another clone of the same member)."""
    return CLONE_NOTE if holder and login and holder.get("login") == login else ""


# ---------------------------------------------------------------- the extension point

def _load_ext(root):
    """<root>/_tools/scaffold_ext.py as a module, or None when there is no such file. Loaded by path; sys.path is not
    touched. Raises whatever the file raises at import."""
    path = os.path.join(root, "_tools", "scaffold_ext.py")
    if not os.path.isfile(path):
        return None
    spec = importlib.util.spec_from_file_location("scaffold_ext", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def commit_lock_state(root):
    """('free'|'held'|'error', detail) from the extension's commit_lock(root). 'error' means the extension failed or
    answered badly; detail names why."""
    try:
        ext = _load_ext(root)
        fn = getattr(ext, "commit_lock", None) if ext is not None else None
        if fn is None:
            return "free", ""
        answer = fn(root)
    except (Exception, SystemExit) as e:
        return "error", "_tools/scaffold_ext.py failed: %s: %s" % (type(e).__name__, e)
    if (isinstance(answer, (tuple, list)) and len(answer) == 2 and answer[0] in ("held", "free")
            and isinstance(answer[1], str)):
        return answer[0], answer[1]
    return "error", "_tools/scaffold_ext.py commit_lock returned %r, not ('held', detail) or ('free', '')" % (answer,)


def lock_refusal(root, what):
    """None when `what` (commit, pull, merge) may go ahead, else the refusal text."""
    state, detail = commit_lock_state(root)
    if state == "held":
        return "the project's commit lock is held (%s); a write is in flight, so %s is refused" % (detail, what)
    if state == "error":
        return "%s; %s is refused" % (detail, what)
    return None


# ---------------------------------------------------------------- read-only helpers

def fetch(root, branch=None):
    """Fetch one branch of the remote into refs/remotes/<remote>/<branch> (default: the base branch); the working
    tree and index are untouched. Returns (rc, message)."""
    branch = branch or base_branch(root)
    remote = remote_name(root)
    rc, o, e = git(root, ["fetch", "--quiet", remote, "+refs/heads/%s:refs/remotes/%s/%s" % (branch, remote, branch)])
    return rc, (e or o).strip()


class BadArgument(RuntimeError):
    """A REF, BASE, HEAD, PREFIX or PATH starting with '-', which git could take for an option. The command line
    exits 2 on it."""


def _no_option(**named):
    """Raise BadArgument for any of the named values that starts with '-'."""
    for label, value in named.items():
        if isinstance(value, str) and value.startswith("-"):
            raise BadArgument("%s %r starts with '-', so git could take it for an option; refused" % (label, value))


def list_tree(root, ref, prefix):
    """The file paths under prefix in ref (e.g. origin/main), read from the object store only. BadArgument for a ref or
    prefix that starts with '-'."""
    _no_option(ref=ref, prefix=prefix)
    rc, o, e = git(root, ["ls-tree", "-r", "--name-only", ref, "--", prefix])
    if rc != 0:
        raise RuntimeError("git ls-tree %s failed: %s" % (ref, (e or o).strip()[:300]))
    return [l for l in o.splitlines() if l]


def show(root, ref, path):
    """The text of path in ref, read from the object store only. BadArgument for a ref or path that starts with '-'."""
    _no_option(ref=ref, path=path)
    rc, o, e = git(root, ["show", "%s:%s" % (ref, path)])
    if rc != 0:
        raise RuntimeError("git show %s:%s failed: %s" % (ref, path, (e or o).strip()[:300]))
    return o


def changed_files(root, base, head):
    """The paths that differ between base and head: what head's branch changed since it left base (three-dot).
    BadArgument for a base or head that starts with '-'."""
    _no_option(base=base, head=head)
    rc, o, e = git(root, ["diff", "--name-only", "-z", "--no-renames", "%s...%s" % (base, head)])
    if rc != 0:
        raise RuntimeError("git diff %s...%s failed: %s" % (base, head, (e or o).strip()[:300]))
    return [p for p in o.split("\0") if p]            # -z: names as they are, never quoted; no renames: both sides


def current_branch(root):
    """The checked-out branch's name ('HEAD' when detached)."""
    rc, o, e = git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        raise RuntimeError("git rev-parse failed: %s" % (e or o).strip()[:300])
    return o.strip()


def identity(root):
    rc1, name, _ = git(root, ["config", "--local", "--get", "user.name"])
    rc2, mail, _ = git(root, ["config", "--local", "--get", "user.email"])
    return (name.strip() if rc1 == 0 else ""), (mail.strip() if rc2 == 0 else "")


def _branch_exists(root, branch):
    return git(root, ["show-ref", "--verify", "--quiet", "refs/heads/" + branch])[0] == 0


def _merged_into(root, branch, base):
    return git(root, ["merge-base", "--is-ancestor", branch, base])[0] == 0


def _spec(paths):
    """The pathspec tail for a git command: [] for the whole tree, else ['--', p, ...]."""
    return ["--"] + list(paths) if paths else []


def staged_paths(root, paths=None):
    rc, out, _ = git(root, ["diff", "--cached", "--name-only", "-z"] + _spec(paths))
    if rc != 0:
        return []
    return [p for p in out.split("\0") if p]


def known_paths(root, paths):
    """The pathspecs git can act on: those matching a tracked file or an untracked, not-ignored one. git add and
    git commit fail outright on a pathspec that matches nothing (a folder not made yet, or holding only ignored
    files)."""
    keep = []
    for p in paths:
        rc1, cur, _ = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--", p])
        rc2, old, _ = git(root, ["ls-tree", "-r", "--name-only", "HEAD", "--", p])   # fails before a first commit
        if (rc1 == 0 and cur.strip()) or (rc2 == 0 and old.strip()):
            keep.append(p)
    return keep


def status_lines(root, paths=None):
    """`git status --porcelain` lines (untracked files listed one by one), limited to the pathspecs `paths` when
    given. Read-only; raises RuntimeError."""
    if not is_repo(root):
        raise RuntimeError("%s is not a git repository" % root)
    rc, out, err = git(root, ["status", "--porcelain", "--untracked-files=all"] + _spec(paths))
    if rc != 0:
        raise RuntimeError("git status failed: %s" % err.strip()[:500])
    return [l for l in out.splitlines() if l.strip()]


def dirty_paths(root, paths=None):
    """The paths with uncommitted changes (staged, unstaged or untracked), as git status shows them; only those
    under the pathspecs `paths` when given."""
    return [l[3:] for l in status_lines(root, paths)]


# ---------------------------------------------------------------- commit

@_serialised
def commit_paths(root, message, paths=None, dry_run=False, log=None, check_paths=True):
    """Stage and commit `paths` (every pathspec when None) with message; the body of `commit`. Returns (rc, message):
    the closing line of the command (COMMITTED..., NOCHANGES..., DRYRUN... or an ERR line) and the exit code, 0 / 2 / 3
    as in the module doc. `log(stream, text)`, when given, receives the lines said on the way (stream 'out' or 'err').
    check_paths=False skips the per-pathspec existence probe (two git calls each) for a caller whose paths come from
    `git status`."""
    say = log or (lambda stream, text: None)
    if not is_repo(root):
        return 2, "ERR %s is not a git repository" % root

    name, mail = identity(root)
    if not name or not mail:
        return 2, ("ERR no repo-local git identity in .git/config "
                   "(user.name=%r user.email=%r). An unattended commit cannot proceed; "
                   "run: git -C %s config user.name '...' && git -C %s config user.email '...'"
                   % (name, mail, root, root))

    refusal = lock_refusal(root, "the commit")
    if refusal:
        return 2, "ERR %s. Nothing staged, nothing committed; the tree is left dirty." % refusal
    ensure_ignored(root)                      # so `git add -A` leaves this machine's own files alone

    only = None                               # paths: stage and commit under these pathspecs only
    if paths:
        only = known_paths(root, paths) if check_paths else list(paths)
        if not only:
            return 0, "NOCHANGES nothing under %s" % " ".join(paths)

    rc, _, err = git(root, ["add", "-A"] + _spec(only))
    if rc != 0:
        return 3, "ERR git add failed: %s" % err.strip()[:500]

    rc, _, _ = git(root, ["diff", "--cached", "--quiet"] + _spec(only))
    if rc == 0:
        return 0, ("NOCHANGES nothing staged -- working tree already matches HEAD"
                   + (" under %s" % " ".join(only) if only else ""))

    staged = staged_paths(root, only)
    local = [p for p in staged if _fold(p) in {_fold(n) for n in LOCAL_FILES}]      # git add -f, or a missed ignore rule
    if local:
        git(root, ["reset", "-q"] + _spec(only))
        return 2, ("ERR refusing to commit %s: a per-machine file that is never committed (git add -f, or an ignore rule "
                   "that misses it). Unstaged; the tree is left dirty." % ", ".join(local))
    total = 0
    offenders = []
    for rel in staged:
        ap = os.path.join(root, rel)
        if os.path.isfile(ap):
            sz = os.path.getsize(ap)
            total += sz
            if sz > MAX_BLOB_BYTES:
                offenders.append((rel, sz))
    if offenders or total > MAX_STAGED_BYTES or len(staged) > MAX_STAGED_FILES:
        for rel, sz in offenders:
            say("err", "ERR staged blob over %d bytes: %s (%d)" % (MAX_BLOB_BYTES, rel, sz))
        if total > MAX_STAGED_BYTES:
            say("err", "ERR staged set is %d bytes, over the %d limit" % (total, MAX_STAGED_BYTES))
        if len(staged) > MAX_STAGED_FILES:
            say("err", "ERR %d staged files, over the %d limit" % (len(staged), MAX_STAGED_FILES))
        git(root, ["reset", "-q"] + _spec(only))
        return 2, ("ERR refusing to commit. Something not in .gitignore has grown to remote-"
                   "hostile size. Unstaging and leaving the tree dirty.")

    say("out", "staged %d files, %d bytes" % (len(staged), total))
    if dry_run:
        for rel in staged[:40]:
            say("out", "  would commit %s" % rel)
        return 0, "DRYRUN no commit made; staged changes left in the index"

    rc, out, err = git(root, ["commit", "-q", "-m", message] + _spec(only))   # others' staged work stays staged
    if rc != 0:
        return 3, "ERR git commit failed: %s" % (err.strip() or out.strip())[:500]
    rc, sha, _ = git(root, ["rev-parse", "--short", "HEAD"])
    return 0, "COMMITTED %s  %d files  %d bytes" % (sha.strip(), len(staged), total)


# ---------------------------------------------------------------- push and pull

def _remote_matches_base(root, base):
    """Whether the remote's base branch, freshly fetched, is the local one."""
    if fetch(root, base)[0] != 0:
        return False
    rc, o, _ = git(root, ["rev-parse", base, "%s/%s" % (remote_name(root), base)])
    shas = o.split()
    return rc == 0 and len(shas) == 2 and shas[0] == shas[1]


def push(root):
    """Push the base branch to the remote, only when the remote's copy holds nothing the local branch lacks (it never
    merges). Returns (rc, message): 0 pushed, 2 refused, 3 git failed."""
    base, remote = base_branch(root), remote_name(root)
    rc, msg = fetch(root, base)
    remote_known = rc == 0
    if rc != 0 and "couldn't find remote ref" not in msg:
        return 3, "fetching %s/%s failed: %s" % (remote, base, msg[:300])
    if remote_known:
        rc, o, e = git(root, ["log", "--oneline", "%s..%s/%s" % (base, remote, base)])
        if rc != 0:
            return 3, "git log failed: %s" % (e or o).strip()[:300]
        ahead = [l for l in o.splitlines() if l]
        if ahead:
            return 2, "%s/%s has %d commit(s) that %s lacks; merge them first: %s" % (
                remote, base, len(ahead), base, "; ".join(ahead[:5]))
    rc, o, e = git(root, ["push", "--quiet", remote, "%s:%s" % (base, base)])
    if rc != 0:
        # git can exit non-zero after the remote has taken the commits, e.g. when another writer pushes the same
        # branch at the same moment. Only the remote's branch says whether the push happened.
        if _remote_matches_base(root, base):
            rc2, o2, _ = git(root, ["rev-parse", "--short", base])
            return 0, "PUSHED %s %s (git exited %d, but %s's %s already matches)" % (base, o2.strip(), rc, remote, base)
        return 3, "git push failed: %s" % _git_error(e or o)
    rc, o, e = git(root, ["rev-parse", "--short", base])
    return 0, "PUSHED %s %s" % (base, o.strip())


def _merge_failure(root, e, o, theirs=None):
    """After a failed merge: abort it and say what conflicted, or git's own error. Only our own merge is aborted: when
    MERGE_HEAD is not the commit we tried to merge (someone started theirs in between), it is left alone."""
    rc2, conflicts, _ = git(root, ["diff", "--name-only", "--diff-filter=U"])
    rc_m, head, _ = git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])
    rc_t, want, _ = git(root, ["rev-parse", "-q", "--verify", theirs + "^{commit}"]) if theirs else (1, "", "")
    if rc_m == 0 and (theirs is None or (rc_t == 0 and head.strip() == want.strip())):
        git(root, ["merge", "--abort"])
    return ("conflicts in %s" % ", ".join(conflicts.split()[:8])) if conflicts.strip() else _git_error(e or o)


def _merge_in_progress(root):
    """A refusal when a merge is already under way in root (MERGE_HEAD exists), else None. Whoever is mid-merge is
    resolving it by hand; a command here would abort it or build on it."""
    if git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])[0] == 0:
        return "a merge is already in progress in %s; finish or abort it first" % root
    return None


def _shared_checkout_guard(root, base, what):
    """A refusal when root is a linked worktree or has another branch checked out, else None."""
    if is_linked_worktree(root):
        return "%s is a linked worktree; %s from the shared checkout" % (root, what)
    cur = current_branch(root)
    if cur != base:
        return "the shared checkout has %r checked out; %s needs %s" % (cur, what, base)
    return None


@_serialised
def pull(root):
    """Bring <remote>/<base> into the base branch in the shared checkout: fast-forward when the branch has nothing
    new, else a merge commit. Returns (rc, message): 0 up to date / fast-forwarded / merged, 2 refused, 3 git failed
    or conflicted (the merge is aborted, so the branch is as it was)."""
    base, remote = base_branch(root), remote_name(root)
    refusal = _shared_checkout_guard(root, base, "pull") or _merge_in_progress(root)
    if refusal:
        return 2, refusal
    refusal = lock_refusal(root, "the pull")
    if refusal:
        return 2, refusal
    name, mail = identity(root)
    if not name or not mail:
        return 2, "no repo-local git identity in .git/config"
    rc, msg = fetch(root, base)
    if rc != 0:
        if "couldn't find remote ref" in msg:
            return 0, "UP TO DATE (%s has no %s)" % (remote, base)
        return 3, "fetching %s/%s failed: %s" % (remote, base, msg[:300])
    theirs = "%s/%s" % (remote, base)

    def short(ref):
        return git(root, ["rev-parse", "--short", ref])[1].strip()
    rc, o, e = git(root, ["merge-base", "--is-ancestor", theirs, base])
    if rc == 0:
        return 0, "UP TO DATE %s %s" % (base, short(base))
    if rc != 1:
        return 3, "git merge-base failed: %s" % _git_error(e or o)
    rc, o, e = git(root, ["merge-base", "--is-ancestor", base, theirs])
    if rc == 0:
        rc, o, e = git(root, ["merge", "--ff-only", "-q", theirs])
        if rc == 0:
            return 0, "FAST-FORWARDED %s to %s" % (base, short("HEAD"))
    elif rc == 1:
        rc, o, e = git(root, ["merge", "--no-ff", "-q", "-m", "Merge %s\n\n%s" % (theirs, ATTRIBUTION), theirs])
        if rc == 0:
            return 0, "MERGED %s into %s at %s" % (theirs, base, short("HEAD"))
    else:
        return 3, "git merge-base failed: %s" % _git_error(e or o)
    what = _merge_failure(root, e, o, theirs)
    return 3, "pull of %s failed (%s); aborted, %s is as it was" % (theirs, what, base)


# ---------------------------------------------------------------- dev worktrees

def _dev_branch(story_id):
    return "dev/" + story_id


def worktree_path(root, story_id):
    return os.path.join(root, ".claude", "worktrees", story_id)


@_serialised
def worktree_add(root, story_id):
    """New worktree for a dev story: branch dev/<id> from the base branch, at .claude/worktrees/<id>. Returns
    (rc, message): 0 made, 2 refused, 3 git failed. Run in the shared checkout, which stays on the base branch."""
    if not DEV_ID.match(story_id or ""):
        return 2, "story id %r is not usable as a branch name" % story_id
    if is_linked_worktree(root):
        return 2, "%s is itself a linked worktree; make dev worktrees from the shared checkout" % root
    base = base_branch(root)
    branch, path = _dev_branch(story_id), worktree_path(root, story_id)
    if _branch_exists(root, branch):
        return 2, "branch %s already exists" % branch
    if os.path.exists(path):
        return 2, "%s already exists" % path
    if not _branch_exists(root, base):
        return 2, "there is no %s branch to start from" % base
    rc, o, e = git(root, ["worktree", "add", "-q", "-b", branch, path, base])
    if rc != 0:
        return 3, "git worktree add failed: %s" % _git_error(e or o)
    return 0, "WORKTREE %s %s" % (path, branch)


@_serialised
def merge_branch(root, branch):
    """Merge a dev/ branch into the base branch (a merge commit) in the shared checkout. Returns (rc, message):
    0 merged, 2 refused, 3 git failed or conflicted (the merge is aborted, so the base branch is as it was)."""
    if not branch.startswith("dev/") or not DEV_ID.match(branch[4:]):
        return 2, "only dev/<id> branches are merged here, not %r" % branch
    base = base_branch(root)
    refusal = _shared_checkout_guard(root, base, "merge") or _merge_in_progress(root)
    if refusal:
        return 2, refusal
    if not _branch_exists(root, branch):
        return 2, "branch %s does not exist" % branch
    refusal = lock_refusal(root, "the merge")
    if refusal:
        return 2, refusal
    if _merged_into(root, branch, base):
        return 2, "branch %s is already merged into %s" % (branch, base)
    name, mail = identity(root)
    if not name or not mail:
        return 2, "no repo-local git identity in .git/config"
    refusal = merge_refusal(root, branch, base)
    if refusal:
        return refusal
    rc, o, e = git(root, ["merge", "--no-ff", "-q", "-m", "Merge %s\n\n%s" % (branch, ATTRIBUTION), branch])
    if rc != 0:
        what = _merge_failure(root, e, o, branch)
        return 3, "merge of %s failed (%s); aborted, %s is as it was" % (branch, what, base)
    rc, sha, _ = git(root, ["rev-parse", "--short", "HEAD"])
    return 0, "MERGED %s into %s at %s" % (branch, base, sha.strip())


@_serialised
def drop_branch(root, story_id):
    """Remove the worktree and delete branch dev/<id>, only once the branch is merged into the base branch and the
    worktree holds nothing uncommitted. Returns (rc, message): 0 dropped, 2 refused, 3 git failed."""
    if not DEV_ID.match(story_id or ""):
        return 2, "story id %r is not usable as a branch name" % story_id
    base = base_branch(root)
    branch, path = _dev_branch(story_id), worktree_path(root, story_id)
    if not _branch_exists(root, branch):
        return 2, "branch %s does not exist" % branch
    if not _merged_into(root, branch, base):
        return 2, "branch %s is not merged into %s; it is not dropped" % (branch, base)
    if os.path.exists(path):
        if status_lines(path):
            return 2, "%s has uncommitted changes; it is not removed" % path
        rc, o, e = git(root, ["worktree", "remove", path])
        if rc != 0:
            return 3, "git worktree remove failed: %s" % _git_error(e or o)
    git(root, ["worktree", "prune"])
    rc, o, e = git(root, ["branch", "-d", branch])
    if rc != 0:
        return 3, "git branch -d failed: %s" % _git_error(e or o)
    return 0, "DROPPED %s and its worktree%s" % (branch, _release_story_lease(root, story_id))


# ---------------------------------------------------------------- leases

def lease_ref_error(ref):
    """None when ref is a lease ref this tool may touch (refs/leases/ and safe path parts), else why not."""
    if not isinstance(ref, str) or not ref.startswith(LEASE_ROOT):
        return "%r is not a lease ref (refs/leases/...)" % (ref,)
    parts = ref[len(LEASE_ROOT):].split("/")
    if not all(LEASE_PART.match(p) and ".." not in p and not p.endswith(".lock") for p in parts):
        return "%r is not a usable lease ref" % ref
    return None


def _lease_remote(root):
    """(remote name, None), or (None, message) for a bad `remote` setting."""
    try:
        return remote_name(root), None
    except SettingsError as e:
        return None, str(e)


def _lease_json(text):
    """The lease commit message's JSON object; {} when the message is not one."""
    try:
        rec = json.loads(text)
    except ValueError:
        return {}
    return rec if isinstance(rec, dict) else {}


def _lease_holder(root, remote, ref, sha):
    """(rc, message, holder) for the lease commit `sha` found at `ref`: its message's JSON plus "sha"."""
    rc, o, e = git(root, ["fetch", "--quiet", remote, ref])               # the commit object only, into FETCH_HEAD
    if rc != 0:
        return 3, "fetching %s failed: %s" % (ref, _git_error(e or o)), None
    rc, o, e = git(root, ["show", "-s", "--format=%B", sha])
    if rc != 0:
        return 3, "git show %s failed: %s" % (sha[:8], _git_error(e or o)), None
    return 0, "", dict(_lease_json(o), sha=sha)


def _remote_leases(root, remote, full_prefix):
    """(rc, message, [(ref, sha)]) of the remote's refs under full_prefix, sorted by ref."""
    rc, o, e = git(root, ["ls-remote", remote, LEASE_ROOT + "*"])
    if rc != 0:
        return 3, "git ls-remote failed: %s" % _git_error(e or o), []
    found = []
    for line in o.splitlines():
        sha, _, ref = line.partition("\t")
        if ref.startswith(full_prefix) and not lease_ref_error(ref):
            found.append((ref, sha))
    return 0, "", sorted(found)


def lease_read(root, ref):
    """A lease on the remote (a story claim, the pen). Returns (rc, message, holder): holder is None when the ref does
    not exist, else the lease commit's JSON message plus "sha" (just the sha when the message is not JSON). rc 2 for a
    ref that is not a lease ref, 3 when git failed."""
    bad = lease_ref_error(ref)
    if bad:
        return 2, bad, None
    remote, bad = _lease_remote(root)
    if bad:
        return 2, bad, None
    rc, o, e = git(root, ["ls-remote", remote, ref])
    if rc != 0:
        return 3, "git ls-remote failed: %s" % _git_error(e or o), None
    sha = next((l.split()[0] for l in o.splitlines() if l.split()[1:] == [ref]), "")   # exact ref, not a longer one
    if not sha:
        return 0, "none", None
    return _lease_holder(root, remote, ref, sha)


def lease_commit(root, rec):
    """A parentless commit of the empty tree whose message is the lease's JSON. Returns (rc, message, sha)."""
    rc, tree, e = git(root, ["mktree"], input="")                          # the empty tree
    if rc != 0:
        return 3, "git mktree failed: %s" % _git_error(e or tree), None
    rc, sha, e = git(root, ["commit-tree", tree.strip(), "-m", json.dumps(rec, sort_keys=True)])
    if rc != 0:
        return 3, "git commit-tree failed: %s" % _git_error(e or sha), None
    return 0, "", sha.strip()


def lease_push(root, ref, new, old):
    """The compare-and-swap push of a lease to the remote: create (old ''), replace (new, old) or delete (new None).
    Returns (rc, message): 0 done, 2 not a lease ref or bad arguments, else git's exit code."""
    bad = lease_ref_error(ref)
    if bad:
        return 2, bad
    if any(v and not re.fullmatch(r"[0-9a-f]{40,64}", v) for v in (new, old)):
        return 2, "a lease push needs full commit ids, got %r and %r" % (new, old)
    remote, bad = _lease_remote(root)
    if bad:
        return 2, bad
    spec = "--force-with-lease=%s:%s" % (ref, old or "")
    rc, o, e = git(root, ["push", "--quiet", spec, remote, ":" + ref if new is None else "%s:%s" % (new, ref)])
    return rc, _git_error(e or o)


def lease_list(root, prefix=""):
    """The remote's leases under refs/leases/<prefix>. Returns (rc, message, [holder]): each holder is the lease's JSON
    plus "sha" and "ref". Read-only apart from fetching the commit objects."""
    if prefix and (lease_ref_error(LEASE_ROOT + prefix.rstrip("/")) or ".." in prefix):
        return 2, "%r is not a usable lease prefix" % prefix, []
    remote, bad = _lease_remote(root)
    if bad:
        return 2, bad, []
    full = LEASE_ROOT + prefix
    rc, msg, found = _remote_leases(root, remote, full)
    if rc != 0 or not found:
        return rc, msg, []
    rc, o, e = git(root, ["fetch", "--quiet", remote] + [ref for ref, _ in found])
    if rc != 0:
        return 3, "fetching the leases failed: %s" % _git_error(e or o), []
    out = []
    for ref, sha in found:
        rc, o, e = git(root, ["show", "-s", "--format=%B", sha])
        if rc != 0:
            return 3, "git show %s failed: %s" % (sha[:8], _git_error(e or o)), []
        out.append(dict(_lease_json(o), sha=sha, ref=ref))
    return 0, "", out


def story_lease_ref(story_id):
    return STORY_LEASE + story_id


def _release_story_lease(root, story_id):
    """In team mode, delete the merged story's claim lease. '' when done or there was none, else a note; never fails
    the drop."""
    try:
        if not team_block(root):
            return ""
        ref = story_lease_ref(story_id)
        rc, msg, h = lease_read(root, ref)
        if rc == 0 and not h:
            return ""
        if rc == 0:
            rc, msg = lease_push(root, ref, None, h["sha"])
    except SettingsError as e:
        return " (lease not released: %s)" % e
    return "" if rc == 0 else " (lease not released: %s)" % msg


# ---------------------------------------------------------------- story claims

def _field(text, key):
    m = re.search(r"(?m)^%s:[ \t]*(.*)$" % key, text.split("\n## Result")[0])
    return m.group(1).strip() if m else None


def _claimed_text(text, points, login):
    """The story's text with `story_points:` (only when absent) and, in team mode, `claimed_by: <login>` added after its
    `requested:` line (else `id:`). A `claimed_by:` the story already carries (a re-queued story) is replaced, never kept."""
    lines = text.split("\n")
    header = next((i for i, l in enumerate(lines) if l.startswith("## Result")), len(lines))
    add = [] if _field(text, "story_points") is not None else ["story_points: %d" % points]
    harness = re.sub(r"[^a-z0-9._-]", "", os.environ.get("SCAFFOLDING_HARNESS", "").strip().lower())[:64]
    harness = {"claude": "claude-code"}.get(harness, harness)
    if harness:
        old = next((i for i, l in enumerate(lines[:header]) if re.match(r"agent:", l)), None)
        if old is None:
            add.append("agent: %s" % harness)
        else:
            lines[old] = "agent: %s" % harness
    if login:
        old = next((i for i, l in enumerate(lines[:header]) if re.match(r"claimed_by:", l)), None)
        if old is None:
            add.append("claimed_by: %s" % login)
        else:
            lines[old] = "claimed_by: %s" % login
    if add:
        at = next((i for i, l in enumerate(lines) if l.startswith("requested:")),
                  next((i for i, l in enumerate(lines) if l.startswith("id:")), -1))
        lines = lines[:at + 1] + add + lines[at + 1:]
    return "\n".join(lines)


def _commit_two(root, message, paths):
    """Commit exactly `paths` (the claim's move) with the same guards as `commit`: no commit lock held, an identity,
    nothing else already staged. Returns (rc, message)."""
    refusal = lock_refusal(root, "the claim")
    if refusal:
        return 2, refusal
    name, mail = identity(root)
    if not name or not mail:
        return 2, "no repo-local git identity in .git/config"
    if staged_paths(root):
        return 2, "something else is already staged (%s); not committing over it" % ", ".join(staged_paths(root)[:3])
    rc, o, e = git(root, ["add", "-A", "--"] + paths)
    if rc == 0:
        rc, o, e = git(root, ["commit", "-q", "-m", message, "--"] + paths)
    if rc != 0:
        git(root, ["reset", "-q", "--"] + paths)
        return 3, "git commit failed: %s" % _git_error(e or o)
    return 0, git(root, ["rev-parse", "--short", "HEAD"])[1].strip()


@_serialised
def claim(root, story_id, points, now=None):
    """Claim a waiting story: in team mode take its lease on the remote first (refs/leases/story/<id>, create-only, so
    of two Macs claiming at once one wins), then move it to in-progress with `story_points:` and `claimed_by:`, commit
    and push. Returns (rc, message): 0 claimed (push may be pending), 2 refused or TAKEN by someone else, 3 git
    failed."""
    if not DEV_ID.match(story_id or "") or not story_id.startswith("DEV-"):
        return 2, "%r is not a story id" % story_id
    if points not in POINTS:
        return 2, "story points must be one of %s, not %r" % (", ".join(map(str, POINTS)), points)
    team = team_block(root)
    login = member_login(root) if team else None
    if team and not login:
        return 2, "this machine has no team member set (dev_mail.py team --me <login>)"
    refusal = _merge_in_progress(root)
    if refusal:
        return 2, refusal
    rc, msg = pull(root)
    if rc != 0:
        return rc, "not claimed, the pull failed: %s" % msg
    src, dst = INBOX + story_id + ".md", WIP + story_id + ".md"
    asrc, adst = os.path.join(root, src), os.path.join(root, dst)
    if not os.path.isfile(asrc):
        who = None
        if os.path.isfile(adst):
            with open(adst, encoding="utf-8") as f:
                who = _field(f.read(), "claimed_by")
        return 2, "TAKEN %s: not in code-inbox (claimed by %s)" % (story_id, who or "someone")
    ref, lease = story_lease_ref(story_id), None
    if team:
        rc, msg, h = lease_read(root, ref)
        if rc != 0:
            return rc, msg
        if h and not lease_ours(root, h, login):
            return 2, "TAKEN %s by %s on %s%s" % (story_id, h.get("login", "?"), h.get("host", "?"),
                                                  _same_member(h, login))
        if h:
            lease = h["sha"]                                    # ours already: an earlier claim that stopped part-way
        else:
            rc, msg, sha = lease_commit(root, {"login": login, "host": socket.gethostname(), "story": story_id,
                                               "taken": iso(time.time() if now is None else now),
                                               "client": client_id(root)})
            if rc != 0:
                return rc, msg
            rc, msg = lease_push(root, ref, sha, "")
            if rc != 0:
                rc2, _, h2 = lease_read(root, ref)
                if rc2 == 0 and h2 and h2.get("sha") == sha:
                    rc = 0                                      # git said failed, but our lease is on the remote
                elif rc2 == 0 and h2 and not lease_ours(root, h2, login):
                    return 2, "TAKEN %s by %s on %s%s" % (story_id, h2.get("login", "?"), h2.get("host", "?"),
                                                          _same_member(h2, login))
                else:
                    return 3, "git push of the claim's lease failed: %s" % msg
            lease = sha
    with open(asrc, encoding="utf-8") as f:
        before = f.read()
    title = _field(before, "title") or ""

    def undo(why):
        try:
            if os.path.isfile(adst) and not os.path.isfile(asrc):
                with open(asrc, "w", encoding="utf-8") as f:
                    f.write(before)
                os.remove(adst)
        except OSError:
            pass
        if lease:
            lease_push(root, ref, None, lease)
        return why
    try:
        os.makedirs(os.path.dirname(adst), exist_ok=True)
        with open(adst, "w", encoding="utf-8") as f:
            f.write(_claimed_text(before, points, login))
        os.remove(asrc)
    except OSError as e:
        return undo((3, "moving %s to in-progress failed: %s" % (story_id, e)))
    rc, msg = _commit_two(root, ("dev: claim %s %s" % (story_id, title)).strip(), [src, dst])
    if rc != 0:
        return undo((rc, "not claimed: %s" % msg))
    rc, pmsg = push(root)
    if rc == 2:
        if pull(root)[0] == 0:
            rc, pmsg = push(root)
    if rc != 0:
        return 0, "CLAIMED %s at %s (push pending: %s)" % (story_id, msg, pmsg)
    return 0, "CLAIMED %s by %s at %s" % (story_id, login or "this machine", msg)


@_serialised
def claim_release(root, story_id):
    """Delete a story's claim lease by hand: allowed when it is ours, or when the story is in neither code-inbox nor
    in-progress (merged, withdrawn). Returns (rc, message): 0 released or none, 2 refused, 3 git failed."""
    if not DEV_ID.match(story_id or ""):
        return 2, "%r is not a story id" % story_id
    rc, msg, h = lease_read(root, story_lease_ref(story_id))
    if rc != 0:
        return rc, msg
    if not h:
        return 0, "NO LEASE on %s" % story_id
    if not lease_ours(root, h, member_login(root)):
        # Open or closed is the remote's word, never the local tree's (it may be stale): fetch, then read <remote>/<base>.
        base, remote = base_branch(root), remote_name(root)
        rc, msg = fetch(root, base)
        if rc != 0:
            return 3, "cannot tell whether %s is still open: fetching %s/%s failed: %s" % (story_id, remote, base, msg[:300])
        try:
            live = any(list_tree(root, "%s/%s" % (remote, base), d + story_id + ".md") for d in (INBOX, WIP))
        except RuntimeError as e:
            return 3, "cannot tell whether %s is still open: %s" % (story_id, e)
        if live:
            return 2, "the lease on %s is %s's%s and the story is still open; their Mac releases it" % (
                story_id, h.get("login", "?"), _same_member(h, member_login(root)))
    rc, msg = lease_push(root, story_lease_ref(story_id), None, h["sha"])
    if rc != 0:
        return 3, "git push deleting the lease failed: %s" % msg
    return 0, "RELEASED the lease on %s" % story_id


# ---------------------------------------------------------------- protected paths and the pen's settings

class NotDataWriter(RuntimeError):
    """require_data_writer's refusal; the message says why this machine may not write protected data."""


def _protected_path_error(p):
    """None when p is a usable protected path (repo-relative, `/` separators, a trailing `/` for a folder), else why not."""
    if not isinstance(p, str) or not p.strip():
        return "%r is empty or not a string" % (p,)
    if any(ord(c) < 32 for c in p):
        return "%r has a control character" % p
    if p.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", p) or "\\" in p:
        return "%r is absolute or uses a backslash; use a repo-relative path with /" % p
    parts = p[:-1].split("/") if p.endswith("/") else p.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return "%r has an empty, '.' or '..' part" % p
    return None


def protected_block(root):
    """The record's `team.protected` block as {"paths": [...], "label": str}, or None when there are no protected paths
    (no block, or an empty list). Raises SettingsError for a block that is there but unusable: paths must be a list of
    repo-relative prefixes (no absolute paths, no `..`, no empty strings), label a non-empty string."""
    team = read_record(root).get("team")
    block = team.get("protected") if isinstance(team, dict) else None
    if block is None:
        return None
    where = "scaffolding.json team.protected"
    if not isinstance(block, dict):
        raise SettingsError("%s must be an object {paths, label}" % where)
    paths = block.get("paths")
    if not isinstance(paths, list):
        raise SettingsError("%s: paths must be a list of repo-relative paths" % where)
    for p in paths:
        bad = _protected_path_error(p)
        if bad:
            raise SettingsError("%s: path %s" % (where, bad))
    label = block.get("label", DEFAULT_LABEL)
    if not isinstance(label, str) or not label.strip():
        raise SettingsError("%s: label must be a non-empty string" % where)
    if not paths:
        return None
    return {"paths": list(paths), "label": label}


def pen_ref(root):
    """The pen's lease ref: the record's team.pen_ref, else refs/leases/pen. Raises SettingsError when it is not a lease
    ref this tool may touch (lease_ref_error), or sits in the story claims' namespace."""
    team = read_record(root).get("team")
    ref = team.get("pen_ref") if isinstance(team, dict) else None
    if ref is None:
        return PEN_REF
    bad = lease_ref_error(ref)
    if not bad and ref.startswith(STORY_LEASE):
        bad = "%r is in the story claims' namespace" % ref
    if bad:
        raise SettingsError("scaffolding.json team.pen_ref: %s" % bad)
    return ref


def _fold(path):
    """A path as the protected-path comparison sees it: Unicode-normalised and case-folded, so that a checkout on a
    case- or normalisation-insensitive filesystem cannot reach a protected folder through another spelling of it."""
    return unicodedata.normalize("NFC", path).casefold()


def under_protected(path, prefixes):
    """Whether `path` (repo-relative, `/` separators) lies under any of the protected prefixes."""
    f = _fold(path)
    for p in prefixes:
        q = _fold(p)
        if f == q.rstrip("/") or f.startswith(q if q.endswith("/") else q + "/"):
            return True
    return False


def _literal(paths):
    """Pathspecs git reads literally (no globbing, no magic), for the protected prefixes."""
    return [":(literal)" + p for p in paths]


# ---------------------------------------------------------------- the pen's local mirror and the offline guard

def _shared_file(root, name):
    return os.path.join(shared_checkout(root) if is_linked_worktree(root) else root, ".claude", name)


def read_pen(root):
    """The local pen mirror {"login","expires","sha"} from .claude/pen.json in the shared checkout, or None."""
    pen = _read_json(_shared_file(root, "pen.json"))
    return pen if isinstance(pen, dict) and pen.get("login") else None


def write_pen(root, pen):
    """Record the pen this Mac holds; pen=None clears it. A clear moves the mirror aside to pen.json.released (some
    mounts refuse unlink but permit rename); where even that is refused, it falls back to an empty file. Best effort."""
    path = _shared_file(root, "pen.json")
    ensure_ignored(root)
    try:
        if pen is None:
            try:
                os.replace(path, path + ".released")
            except FileNotFoundError:
                pass
            except OSError:
                pen = {}
        if pen is not None:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(pen, f)
                f.write("\n")
    except OSError:
        pass


def _now(now):
    return time.time() if now is None else now


def pen_line(root, now=None):
    """The `team` listing's pen line from the local mirror: `pen none`, `pen <login> until <iso>` or `pen expired`."""
    pen = read_pen(root)
    if not pen:
        return "pen none"
    exp = parse_iso(pen.get("expires"))
    return "pen %s until %s" % (pen["login"], pen["expires"]) if exp is not None and exp > _now(now) else "pen expired"


def touch_pen_wanted(root, login, now=None):
    """Say that this machine's writer wants the pen: .claude/pen-wanted.json {"login","at"} in the shared checkout, which
    `pen sync` reads (best effort; a read-only mount just means the poller is not told)."""
    path = _shared_file(root, "pen-wanted.json")
    ensure_ignored(root)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"login": login, "at": iso(_now(now))}, f)
            f.write("\n")
    except OSError:
        pass


def pen_wanted_age(root, now=None):
    """Seconds since pen-wanted.json was last touched, None when it never was."""
    rec = _read_json(_shared_file(root, "pen-wanted.json"))
    at = parse_iso(rec.get("at")) if isinstance(rec, dict) else None
    return None if at is None else _now(now) - at


def data_writer_problem(root, now=None):
    """None when this machine may write protected data, else why not. No network: with two or more data writers it
    reads the local pen mirror. Not in team mode, or no protected paths set: None. Unusable settings: the problem is
    that (fails closed). It touches pen-wanted when the pen is needed, whether or not this Mac holds it."""
    try:
        team = team_block(root)
        prot = protected_block(root) if team else None
        if prot:
            pen_ref(root)                                       # validated here, so a bad setting fails closed
    except SettingsError as e:
        return "team mode: %s, so no machine may write protected data until that is fixed" % e
    if team is None or prot is None:
        return None
    label, writers = prot["label"], team["data_writers"]
    login = member_login(root)
    if not login:
        return ("team mode: this machine has no team member set (run dev_mail.py team --me <login>), so it may not "
                "change %s; only %s's machine does" % (label, " or ".join(writers) or "a data writer"))
    if login not in writers:
        if not writers:
            return ("team mode: nobody is a data writer, so no machine changes %s (the owner grants one with "
                    "dev_mail.py team --grant-writer)" % label)
        return ("team mode: only %s (%s) changes %s; this machine is %s. Other stories are fine; hand work on %s to %s"
                % ("the data writer" if len(writers) == 1 else "a data writer", " or ".join(writers), label, login,
                   label, " or ".join(writers)))
    if len(writers) < 2:
        return None
    pen = read_pen(root)
    exp = parse_iso(pen.get("expires")) if pen else None
    now = _now(now)
    mine = bool(pen) and pen.get("login") == login and pen.get("client", client_id(root)) == client_id(root)
    if mine and exp is not None and exp - PEN_SKEW_SECS > now:      # expired PEN_SKEW_SECS early: clocks differ
        touch_pen_wanted(root, login, now)                      # an active writer keeps the pen
        return None
    touch_pen_wanted(root, login, now)                          # the poller on this Mac takes the pen on its next pass
    held = pen and exp is not None and exp > now                # the mirror is what this Mac last knew; no network here
    if mine and held:
        seen = "ours but due to expire at %s, within %d minutes, so it counts as lapsed" % (pen.get("expires"), PEN_SKEW_SECS // 60)
    elif held:
        seen = "held by %s until %s" % (pen["login"], pen.get("expires"))
    else:
        seen = "not held by this Mac (scaffold_git.py pen status says who has it)"
    return ("team mode: several data writers take turns and this machine does not hold the pen; the pen is %s. The Code "
            "poller on this Mac takes it on its next pass, so try again after that" % seen)


def require_data_writer(root):
    """Raise NotDataWriter(why) unless data_writer_problem says this machine may write protected data."""
    why = data_writer_problem(root)
    if why:
        raise NotDataWriter(why)


# ---------------------------------------------------------------- the pen

def pen_read(root, ref=None):
    """The pen on the remote. Returns (rc, message, holder): holder is None when the lease does not exist, else the
    lease's JSON plus "sha" and "exp" (expiry in epoch seconds; 0 when the message is not a lease, so anyone may replace
    it). rc 3 when git failed."""
    rc, msg, rec = lease_read(root, ref or pen_ref(root))
    if rc != 0 or rec is None:
        return rc, msg, None
    try:
        holder = dict(rec, exp=parse_iso(rec["expires"]) or 0)
        holder["login"]
    except (KeyError, TypeError):
        holder = {"login": "?", "host": "?", "taken": "?", "expires": "?", "sha": rec["sha"], "exp": 0}
    return 0, "", holder


def _pen_lease_commit(root, login, taken, now):
    rec = {"login": login, "host": socket.gethostname(), "taken": iso(taken), "expires": iso(now + PEN_TTL),
           "client": client_id(root)}
    rc, msg, sha = lease_commit(root, rec)
    return (rc, msg, None) if rc != 0 else (0, "", dict(rec, sha=sha))


def _pen_mirror(root, login, holder):
    """Keep .claude/pen.json true to what the remote says: ours, or cleared when the lease is gone or someone else's."""
    if lease_ours(root, holder, login):
        write_pen(root, {"login": login, "expires": holder["expires"], "sha": holder["sha"],
                         "client": client_id(root)})
    else:
        mirror = read_pen(root)
        if mirror and mirror.get("login") == login:
            write_pen(root, None)


def _pen_describe(h, now):
    if not h:
        return "none"
    return "%s on %s until %s%s" % (h["login"], h.get("host", "?"), h["expires"], "" if h["exp"] > now else " (expired)")


def _pen_lost(root, ref, login, now, msg):
    """A renew or release whose compare-and-swap push failed: refused (2) when the remote's lease is no longer ours (it
    expired and another Mac took it, or it was deleted), mirror cleared; else 3, git failed."""
    rc, _, h = pen_read(root, ref)
    if rc == 0 and not lease_ours(root, h, login):
        _pen_mirror(root, login, h)
        return 2, "the pen is no longer ours (%s)" % _pen_describe(h, now)
    return 3, "git push of the pen failed: %s" % msg


def _pen_setup(root, need_login=True):
    """(ctx, None) for a project that uses the pen, else (None, (rc, message)): 0 PEN not used (no protected paths, or
    not in team mode), 2 bad settings or no member on this machine. ctx: ref, paths, label, team, login."""
    try:
        prot = protected_block(root)
        if prot is None:
            return None, (0, PEN_UNUSED)
        team = team_block(root)
        if team is None:
            return None, (0, "PEN not used: not in team mode")
        ref = pen_ref(root)
    except SettingsError as e:
        return None, (2, str(e))
    login = member_login(root)
    if need_login and not login:
        return None, (2, "this machine has no team member set (dev_mail.py team --me <login>)")
    return {"ref": ref, "paths": prot["paths"], "label": prot["label"], "team": team, "login": login}, None


def pen_status(root, now=None):
    """Returns (rc, message): 0 with the holder and expiry, or `none`; 3 git failed. The remote is not changed; a stale
    local mirror naming this Mac is tidied."""
    ctx, early = _pen_setup(root, need_login=False)
    if early:
        return early
    now = _now(now)
    rc, msg, h = pen_read(root, ctx["ref"])
    if rc != 0:
        return rc, msg
    if ctx["login"]:
        _pen_mirror(root, ctx["login"], h)
    return 0, _pen_describe(h, now)


@_serialised
def pen_take(root, now=None):
    """Take the pen: pull, then create the lease, or replace it when expired or already ours. Returns (rc, message):
    0 taken, 2 refused (held by someone else, no member, pull refused), 3 git failed."""
    ctx, early = _pen_setup(root)
    if early:
        return early
    now, login, ref = _now(now), ctx["login"], ctx["ref"]
    rc, msg = pull(root)
    if rc != 0:
        return rc, "pen not taken, the pull failed: %s" % msg
    rc, msg, h = pen_read(root, ref)
    if rc != 0:
        return rc, msg
    if h and not lease_ours(root, h, login) and h["exp"] > now:
        _pen_mirror(root, login, h)
        return 2, "the pen is held by %s%s" % (_pen_describe(h, now), _same_member(h, login))
    rc, msg, new = _pen_lease_commit(root, login, now, now)
    if rc != 0:
        return rc, msg
    rc, msg = lease_push(root, ref, new["sha"], h["sha"] if h else "")
    if rc != 0:
        rc2, _, h2 = pen_read(root, ref)
        if rc2 == 0 and h2 and h2["sha"] == new["sha"]:
            rc = 0                                              # git said failed, but our lease is on the remote
        elif rc2 == 0 and h2 and not lease_ours(root, h2, login) and h2["exp"] > now:
            return 2, "someone else took the pen first: %s%s" % (_pen_describe(h2, now), _same_member(h2, login))
        else:
            return 3, "git push of the pen failed: %s" % msg
    _pen_mirror(root, login, new)
    # The writer before us may have pushed between our first pull and our take: pull again, now that nobody else can
    # write the protected paths.
    rc, pmsg = pull(root)
    if rc != 0:
        return 3, ("PEN TAKEN by %s until %s, but the pull afterwards failed: %s; pull before writing"
                   % (login, new["expires"], pmsg))
    return 0, "PEN TAKEN by %s until %s; pull: %s" % (login, new["expires"], pmsg)


@_serialised
def pen_renew(root, now=None):
    """Extend our own lease by 2 hours from now. Returns (rc, message): 0 renewed, 2 refused (not ours), 3 git failed."""
    ctx, early = _pen_setup(root)
    if early:
        return early
    now, login, ref = _now(now), ctx["login"], ctx["ref"]
    rc, msg, h = pen_read(root, ref)
    if rc != 0:
        return rc, msg
    _pen_mirror(root, login, h)
    if not lease_ours(root, h, login):
        return 2, "the pen is not ours (%s%s); take it first" % (_pen_describe(h, now), _same_member(h, login))
    rc, msg, new = _pen_lease_commit(root, login, parse_iso(h.get("taken")) or now, now)
    if rc != 0:
        return rc, msg
    rc, msg = lease_push(root, ref, new["sha"], h["sha"])
    if rc != 0:
        return _pen_lost(root, ref, login, now, msg)
    _pen_mirror(root, login, new)
    return 0, "PEN RENEWED for %s until %s" % (login, new["expires"])


@_serialised
def pen_release(root, now=None):
    """Give the pen back, once everything this Mac wrote under the protected paths is committed and the base branch is
    pushed. The local mirror is cleared first, so a guard that runs while the checks are under way sees no pen; it comes
    back on any refusal or failure. Returns (rc, message): 0 released, 2 refused (not ours, a write in flight,
    uncommitted work, unpushed commits), 3 git failed."""
    ctx, early = _pen_setup(root)
    if early:
        return early
    now, login, ref = _now(now), ctx["login"], ctx["ref"]
    mirror = read_pen(root)
    write_pen(root, None)

    def keep(result):
        if mirror:
            write_pen(root, mirror)           # the refusal or failure leaves us holding the pen, so the guard may say so
        return result
    rc, msg, h = pen_read(root, ref)
    if rc != 0:
        return keep((rc, msg))
    if not lease_ours(root, h, login):
        _pen_mirror(root, login, h)
        return 2, "the pen is not ours (%s%s); nothing to release" % (_pen_describe(h, now), _same_member(h, login))
    mirror = mirror or {"login": login, "expires": h["expires"], "sha": h["sha"], "client": client_id(root)}
    refusal = lock_refusal(root, "the release")
    if refusal:
        return keep((2, refusal))
    dirty = dirty_paths(root, _literal(ctx["paths"]))
    if dirty:
        return keep((2, "uncommitted changes under %s (%d, e.g. %s); commit and push them first" % (
            ", ".join(ctx["paths"]), len(dirty), dirty[0])))
    base, remote = base_branch(root), remote_name(root)
    rc, msg = fetch(root, base)
    if rc == 0:
        rc, o, e = git(root, ["rev-list", "--count", "%s/%s..%s" % (remote, base, base)])
    elif "couldn't find remote ref" in msg:
        rc, o, e = git(root, ["rev-list", "--count", base])
    else:
        return keep((3, "fetching %s/%s failed: %s" % (remote, base, msg[:300])))
    if rc != 0:
        return keep((3, "git rev-list failed: %s" % _git_error(e or o)))
    if o.strip() != "0":
        return keep((2, "%s has %s commit(s) %s/%s lacks; push them first" % (base, o.strip(), remote, base)))
    rc, msg = lease_push(root, ref, None, h["sha"])
    if rc != 0:
        rc, msg = _pen_lost(root, ref, login, now, msg)
        return keep((rc, msg)) if rc == 3 else (rc, msg)
    write_pen(root, None)
    return 0, "PEN RELEASED by %s" % login


@_serialised
def pen_sync(root, now=None):
    """The poller's once-a-pass call on a writer Mac. Acts only when this Mac's member is one of two or more data
    writers. Held and idle: release (kept, and said so, if unpushed work stops it). Held and wanted: renew. Not held and
    wanted: take. Wanted = .claude/pen-wanted.json touched within 30 minutes; idle = not wanted and nothing uncommitted
    under the protected paths. Returns (rc, message) with one line saying what it did."""
    ctx, early = _pen_setup(root, need_login=False)
    if early:
        return early
    now, login, ref = _now(now), ctx["login"], ctx["ref"]
    writers = ctx["team"]["data_writers"]
    if not login or login not in writers or len(writers) < 2:
        return 0, "pen not needed"
    age = pen_wanted_age(root, now)
    wanted = age is not None and age <= PEN_WANTED_SECS
    rc, msg, h = pen_read(root, ref)
    if rc != 0:
        return rc, msg
    _pen_mirror(root, login, h)
    def kept(reason):
        """Kept, so renewed: our work has not reached the remote, and a lapsed lease would hand the pen to another
        writer while it is still local."""
        rc, msg = pen_renew(root, now)
        if rc == 2:
            return 0, "pen not kept: %s" % msg                            # no longer ours: nothing to renew, try again next pass
        if rc != 0:
            return rc, msg
        return 0, "PEN KEPT and renewed until %s: %s" % (msg.rpartition(" until ")[2], reason)
    if lease_ours(root, h, login):
        if wanted:
            return pen_renew(root, now)
        if dirty_paths(root, _literal(ctx["paths"])):
            return kept("not wanted, but %s have uncommitted changes" % ", ".join(ctx["paths"]))
        rc, msg = pen_release(root, now)
        return kept(msg) if rc == 2 else (rc, msg)
    if wanted:
        rc, msg = pen_take(root, now)
        return (0, "pen not taken: %s" % msg) if rc == 2 else (rc, msg)     # held by another Mac: try again next pass
    return 0, "pen idle: not held, not wanted (%s)" % _pen_describe(h, now)


# ---------------------------------------------------------------- the merge check

def _base_story_text(root, base, story_id):
    """The story's file as the base branch holds it (_dev/in-progress/<id>.md), or None. Never the branch being merged:
    its author can write anything into its own copy."""
    rc, o, _ = git(root, ["show", "%s:%s%s.md" % (base, WIP, story_id)])
    return o if rc == 0 else None


def story_claimer(root, branch, base):
    """(rc, message, login): who claimed the story of dev/<id>. The story lease's holder first: the lease is the only
    record written by compare-and-swap, and it lives until drop-branch, which runs after the merge. Failing that,
    `claimed_by:` in _dev/in-progress/<id>.md on the base branch (the claim commit), never the file on the branch being
    merged. login is None when neither says (rc 0); rc 3 when the lease cannot be read."""
    story_id = branch[len("dev/"):]
    rc, msg, h = lease_read(root, story_lease_ref(story_id))
    if rc != 0:
        return rc, msg, None
    who = h.get("login") if h else None
    if isinstance(who, str) and who:
        return 0, "", who
    text = _base_story_text(root, base, story_id)
    who = _field(text, "claimed_by") if text is not None else None
    return 0, "", who or None


def _team_value_at(root, ref):
    """The `team` value of .claude/scaffolding.json as `ref` holds it: None when the file or the key is absent, a
    marker string when the file is not JSON, so that an unreadable file differs from a readable one."""
    rc, o, _ = git(root, ["show", "%s:%s" % (ref, SCAFFOLDING_RECORD)])
    if rc != 0:
        return None
    try:
        rec = json.loads(o)
    except ValueError:
        return "<unreadable %s>" % SCAFFOLDING_RECORD
    return rec.get("team") if isinstance(rec, dict) else None


def pre_merge_refusals(root, branch):
    """('ok'|'refused'|'error', [text]) from the extension's pre_merge_checks(root, branch): a list of refusal strings
    (empty or None: none). 'error' means the extension failed or answered badly."""
    try:
        ext = _load_ext(root)
        fn = getattr(ext, "pre_merge_checks", None) if ext is not None else None
        if fn is None:
            return "ok", []
        answer = fn(root, branch)
    except (Exception, SystemExit) as e:
        return "error", ["_tools/scaffold_ext.py failed: %s: %s" % (type(e).__name__, e)]
    if answer is None:
        return "ok", []
    if not isinstance(answer, (list, tuple)) or not all(isinstance(a, str) for a in answer):
        return "error", ["_tools/scaffold_ext.py pre_merge_checks returned %r, not a list of strings" % (answer,)]
    return ("refused", list(answer)) if answer else ("ok", [])


def merge_refusal(root, branch, base):
    """None when `branch` may be merged into `base`, else (rc, text). Applies only in team mode:
      - a branch that changed the `team` block of .claude/scaffolding.json (compared as parsed JSON at `base` and at the
        branch) needs the team's owner as its claimer;
      - with protected paths, a branch that changed one needs a claimer who is a data writer and, when there are two or
        more data writers, the merging Mac must hold the pen (data_writer_problem); the extension's pre_merge_checks may
        add refusals.
    The claimer is story_claimer's (the lease, else the base branch's story file). Without a team block nothing is
    checked."""
    try:
        team = team_block(root)
        prot = protected_block(root) if team else None
    except SettingsError as e:
        return 2, "%s; the merge is refused" % e
    if team is None:
        return None
    claimed = []

    def claimer():
        if not claimed:
            claimed.append(story_claimer(root, branch, base))
        return claimed[0]

    rc, mb, e = git(root, ["merge-base", base, branch])           # where the branch left the base: a team change made on
    if rc != 0 or not mb.strip():                                   # the base since then is not the branch's change
        return 3, "git merge-base %s %s failed: %s" % (base, branch, _git_error(e or mb))
    if _team_value_at(root, mb.strip()) != _team_value_at(root, branch):
        rc, msg, who = claimer()
        if rc != 0:
            return rc, "cannot tell who claimed %s: %s" % (branch, msg)
        if who != team["owner"]:
            return 2, ("%s changes the team block of %s, which only the team's owner (%s) may do; its claimer is %s, so "
                       "it is not merged" % (branch, SCAFFOLDING_RECORD, team["owner"], who or "unknown"))
    if prot is not None:
        try:
            hits = [f for f in changed_files(root, base, branch) if under_protected(f, prot["paths"])]
        except RuntimeError as e:
            return 3, str(e)
        if hits:
            rc, msg, who = claimer()
            if rc != 0:
                return rc, "cannot tell who claimed %s: %s" % (branch, msg)
            files = "%s%s" % (", ".join(hits[:5]), " and %d more" % (len(hits) - 5) if len(hits) > 5 else "")
            if who is None:
                return 2, ("%s changes %s (%s), but nobody can be found who claimed it (no story lease, and no claimed_by: "
                           "in %s%s.md on %s), so it is not merged"
                           % (branch, prot["label"], files, WIP, branch[len("dev/"):], base))
            if who not in team["data_writers"]:
                return 2, ("%s changes %s (%s), but its claimer %s is not a data writer (%s); only a data writer's story "
                           "may change %s" % (branch, prot["label"], files, who,
                                              ", ".join(team["data_writers"]) or "none", prot["label"]))
            if len(team["data_writers"]) >= 2:
                why = data_writer_problem(root)
                if why:
                    return 2, ("%s changes %s (%s), and with several data writers the merging Mac must hold the pen: %s"
                               % (branch, prot["label"], files, why))
        state, texts = pre_merge_refusals(root, branch)
        if state == "error":
            return 2, "%s; the merge is refused" % texts[0]
        if texts:
            return 2, "%s is not merged: %s" % (branch, "; ".join(texts))
    return None


# ---------------------------------------------------------------- command line

def _report(rc_msg):
    rc, msg = rc_msg
    print(msg if rc == 0 else "ERR " + msg, file=sys.stdout if rc == 0 else sys.stderr)
    return rc


def _fail(e):
    print("ERR %s" % e, file=sys.stderr)
    return 3


def cmd_sweep(args):
    n = sweep(project_root(args.root), verbose=True)
    print("SWEPT %d" % n)
    return 0


def cmd_status(args):
    try:
        lines = status_lines(project_root(args.root), args.paths)
    except RuntimeError as e:
        return _fail(e)
    for l in lines:
        print(l)
    return 0


def cmd_commit(args):
    root = project_root(args.root)
    if not is_repo(root):
        print("ERR %s is not a git repository" % root, file=sys.stderr)
        return 2

    def log(stream, text):
        print(text, file=sys.stderr if stream == "err" else sys.stdout)

    rc, msg = commit_paths(root, args.message, args.paths, dry_run=args.dry_run, log=log)
    print(msg, file=sys.stderr if rc != 0 else sys.stdout)
    return rc


def cmd_fetch(args):
    root = project_root(args.root)
    branch = args.branch or base_branch(root)
    rc, msg = fetch(root, branch)
    print("FETCHED %s/%s" % (remote_name(root), branch) if rc == 0 else "ERR fetch failed: %s" % msg,
          file=sys.stdout if rc == 0 else sys.stderr)
    return 0 if rc == 0 else 3


def _refused(e):
    print("ERR %s" % e, file=sys.stderr)
    return 2


def cmd_list_tree(args):
    try:
        for p in list_tree(project_root(args.root), args.ref, args.prefix):
            print(p)
    except BadArgument as e:
        return _refused(e)
    except RuntimeError as e:
        return _fail(e)
    return 0


def cmd_show(args):
    try:
        sys.stdout.write(show(project_root(args.root), args.ref, args.path))
    except BadArgument as e:
        return _refused(e)
    except RuntimeError as e:
        return _fail(e)
    return 0


def cmd_diff(args):
    try:
        for p in changed_files(project_root(args.root), args.base, args.head):
            print(p)
    except BadArgument as e:
        return _refused(e)
    except RuntimeError as e:
        return _fail(e)
    return 0


def cmd_push(args):
    return _report(push(project_root(args.root)))


def cmd_pull(args):
    return _report(pull(project_root(args.root)))


def cmd_worktree(args):
    return _report(worktree_add(project_root(args.root), args.id))


def cmd_merge(args):
    return _report(merge_branch(project_root(args.root), args.branch))


def cmd_drop_branch(args):
    return _report(drop_branch(project_root(args.root), args.id))


def cmd_claim(args):
    return _report(claim(project_root(args.root), args.id, args.points))


def cmd_claim_release(args):
    return _report(claim_release(project_root(args.root), args.id))


def cmd_leases(args):
    rc, msg, found = lease_list(project_root(args.root), args.prefix or "")
    if rc != 0:
        print("ERR %s" % msg, file=sys.stderr)
        return rc
    for h in found:
        print("\t".join([h["ref"][len(LEASE_ROOT):]] + [str(h.get(k) or "-") for k in ("login", "host", "taken")]))
    return 0


def _core_commands(sub):
    sub.add_parser("sweep", help="rename stale .git lockfiles aside").set_defaults(func=cmd_sweep)
    s = sub.add_parser("status", help="print uncommitted changes (porcelain); read-only")
    s.add_argument("--paths", nargs="+", metavar="P", help="only changes under these pathspecs")
    s.set_defaults(func=cmd_status)
    c = sub.add_parser("commit", help="lock-aware, identity-checked, size-guarded commit")
    c.add_argument("--message", "-m", required=True)
    c.add_argument("--dry-run", action="store_true", help="stage and report, do not commit")
    c.add_argument("--paths", nargs="+", metavar="P",
                   help="stage and commit only these pathspecs; everything else is left as it was")
    c.set_defaults(func=cmd_commit)
    f = sub.add_parser("fetch", help="fetch one branch of the remote (default: the base branch); the working tree "
                                     "is untouched")
    f.add_argument("--branch")
    f.set_defaults(func=cmd_fetch)
    t = sub.add_parser("list-tree", help="list the files under PREFIX in REF (read-only)")
    t.add_argument("ref")
    t.add_argument("prefix")
    t.set_defaults(func=cmd_list_tree)
    w = sub.add_parser("show", help="print PATH as held in REF (read-only)")
    w.add_argument("ref")
    w.add_argument("path")
    w.set_defaults(func=cmd_show)
    df = sub.add_parser("diff", help="list the files HEAD changed since it left BASE (three-dot diff); read-only")
    df.add_argument("base")
    df.add_argument("head")
    df.set_defaults(func=cmd_diff)
    sub.add_parser("push", help="push the base branch to the remote; refuses if the remote has commits it lacks"
                   ).set_defaults(func=cmd_push)
    sub.add_parser("pull", help="bring the remote's base branch into the base branch in the shared checkout; "
                                "aborts on conflict").set_defaults(func=cmd_pull)
    wt = sub.add_parser("worktree", help="new worktree .claude/worktrees/ID on a new branch dev/ID from the base branch")
    wt.add_argument("--id", required=True)
    wt.set_defaults(func=cmd_worktree)
    mg = sub.add_parser("merge", help="merge a dev/ID branch into the base branch (shared checkout); aborts on conflict")
    mg.add_argument("--branch", required=True)
    mg.set_defaults(func=cmd_merge)
    db = sub.add_parser("drop-branch", help="remove the worktree and delete branch dev/ID, once merged")
    db.add_argument("--id", required=True)
    db.set_defaults(func=cmd_drop_branch)


def _lease_commands(sub):
    cl = sub.add_parser("claim", help="claim a waiting story: lease it on the remote (team mode), move it to "
                                      "in-progress, commit, push")
    cl.add_argument("--id", required=True)
    cl.add_argument("--points", required=True, type=int)
    cl.set_defaults(func=cmd_claim)
    cr = sub.add_parser("claim-release", help="delete a story's claim lease on the remote (ours, or the story is closed)")
    cr.add_argument("--id", required=True)
    cr.set_defaults(func=cmd_claim_release)
    ls = sub.add_parser("leases", help="list the remote's leases: ref, login, host, taken (tab-separated); read-only")
    ls.add_argument("--prefix", metavar="P", help="only leases under refs/leases/P, e.g. story/")
    ls.set_defaults(func=cmd_leases)


def cmd_pen(args):
    root = project_root(args.root)
    fn = {"take": pen_take, "renew": pen_renew, "release": pen_release, "status": pen_status, "sync": pen_sync}[args.action]
    return _report(fn(root))


def cmd_guard(args):
    root = project_root(args.root)
    why = data_writer_problem(root)
    if why:
        print("ERR %s" % why, file=sys.stderr)
        return 2
    print("OK this machine may write protected data")
    return 0


def _pen_commands(sub):
    pn = sub.add_parser("pen", help="the pen: one Mac at a time writes the protected paths (take, renew, release, "
                                    "status, sync)")
    pn.add_argument("action", choices=["take", "renew", "release", "status", "sync"])
    pn.set_defaults(func=cmd_pen)
    gd = sub.add_parser("guard", help="offline check that this machine may write the protected paths: exit 0, or 2 with "
                                      "the reason")
    gd.set_defaults(func=cmd_guard)


# Each registrar adds its subparsers to `sub`. Later groups of commands (claims and leases, the pen) append theirs
# here instead of editing build_parser.
COMMAND_GROUPS = [_core_commands, _lease_commands, _pen_commands]


def build_parser():
    ap = argparse.ArgumentParser(description="Mount-safe git operations for a scaffolded project's dev inbox.")
    ap.add_argument("--root", help="project root (default: derived from this file's location)")
    ap.add_argument("--version", action="version", version="scaffold_git.py " + VERSION)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for group in COMMAND_GROUPS:
        group(sub)
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        sweep_locks(project_root(args.root))                  # a bad "sweep_locks" is refused whatever the command
        return args.func(args)
    except SettingsError as e:
        print("ERR %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
