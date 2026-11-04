#!/usr/bin/env python3
"""Offline defect intake and verified image evidence. Python standard library only.

create --root DIR --report FILE_OR_JSON [--screenshot FILE ...]
evidence --root DIR --id DEV-ID
cache-evidence --root DIR --id DEV-ID --attachment-id N --file FILE

Jira creation/uploads/downloads belong to the authenticated session. This helper
stores no credentials or signed URLs. Exit 2 means an actionable refusal.
"""
import argparse
import datetime
import glob
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

VERSION = "1.0.0"


class Refused(Exception):
    pass


def mail_module():
    here = Path(__file__).resolve().parent
    candidates = [here / "dev_mail.py", here.parent.parent / "skills/dev-inbox/scripts/dev_mail.py"]
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        raise Refused("dev_mail.py is missing; run inbox_setup.py update or use the plugin copy")
    spec = importlib.util.spec_from_file_location("_defect_dev_mail", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def safe_path(root, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in (".", "..") for p in parts) or "\\" in str(relative):
        raise Refused("unsafe project path: " + str(relative))
    dest = root.joinpath(*parts)
    for n in range(1, len(parts) + 1):
        if root.joinpath(*parts[:n]).is_symlink():
            raise Refused("symlink is not allowed in evidence/report path: " + str(relative))
    return dest


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (ValueError, UnicodeError) as exc:
        raise Refused("invalid JSON: " + str(path)) from exc


def image_bytes(path):
    """Sniff raster bytes, checking PNG chunks/CRC and other format envelopes."""
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise Refused("image is missing or is a symlink: " + str(path))
    raw = path.read_bytes()
    mime = None
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        pos, kinds, compressed = 8, [], []
        while pos + 12 <= len(raw):
            length = struct.unpack(">I", raw[pos:pos + 4])[0]
            kind, data = raw[pos + 4:pos + 8], raw[pos + 8:pos + 8 + length]
            end = pos + 12 + length
            if end > len(raw) or zlib.crc32(kind + data) & 0xffffffff != struct.unpack(">I", raw[end - 4:end])[0]:
                break
            kinds.append(kind)
            if kind == b"IDAT":
                compressed.append(data)
            if kind == b"IHDR" and (length != 13 or not all(struct.unpack(">II", data[:8]))):
                break
            pos = end
            if kind == b"IEND":
                try:
                    decoded = zlib.decompress(b"".join(compressed))
                except zlib.error:
                    break
                if kinds[0] == b"IHDR" and compressed and decoded and pos == len(raw):
                    mime = "image/png"
                break
    elif raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9") and len(raw) > 20:
        mime = "image/jpeg"
    elif raw[:6] in (b"GIF87a", b"GIF89a") and len(raw) > 13 and raw.endswith(b";"):
        mime = "image/gif"
    elif len(raw) >= 20 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and struct.unpack("<I", raw[4:8])[0] + 8 == len(raw):
        mime = "image/webp"
    elif len(raw) >= 54 and raw[:2] == b"BM" and struct.unpack("<I", raw[2:6])[0] == len(raw):
        mime = "image/bmp"
    if mime is None:
        raise Refused("not a supported raster image (PNG, JPEG, GIF, WebP, BMP): " + str(path))
    return raw, mime, hashlib.sha256(raw).hexdigest()


def shared_root(root):
    result = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=root, capture_output=True, text=True)
    if result.returncode == 0:
        common = Path(os.path.abspath(root / result.stdout.strip()))
        if common.name == ".git":
            return common.parent
    return root


def find_report(root, sid, dm):
    if not dm.STORY_RE.fullmatch(sid):
        raise Refused("--id must be a DEV work-item id")
    for folder in ("code-inbox", "in-progress", "done/*"):
        for name in sorted(glob.glob(str(root / "_dev" / folder / (sid + ".md")))):
            path = safe_path(root, os.path.relpath(name, root))
            fields = dm.story_fields(path.read_text(encoding="utf-8"))
            key = dm.story_jira_key(fields)
            state = read_json(shared_root(root) / ".claude/jira-sync.json", {})
            types = state.get("work_item_types", {}) if isinstance(state, dict) else {}
            metadata = state.get("evidence", {}) if isinstance(state, dict) else {}
            current = types.get(key) if isinstance(types, dict) else None
            if key and current in ("bug", "story"):
                fields = dict(fields, work_item_type=current)
                if isinstance(metadata, dict) and key in metadata:
                    fields["evidence"] = json.dumps(metadata[key])
            if dm.work_item_type(fields) != "bug":
                raise Refused(sid + " is a Story, not a Bug")
            bad = dm.evidence_problems(fields, sid)
            if bad:
                raise Refused("; ".join(bad))
            return fields
    raise Refused("no Bug report " + sid + " in code-inbox, in-progress or done")


def latest_entries(root, sid, fields):
    """An in-progress report is immutable; sync state carries newer remote metadata."""
    state = read_json(shared_root(root) / ".claude/jira-sync.json", {})
    # State is an optional overlay for claimed records, not a download acknowledgement.
    current = state.get("evidence", {}) if isinstance(state, dict) else {}
    saved = current.get(fields.get("jira", "")) if isinstance(current, dict) else None
    if isinstance(saved, list):
        return saved
    return json.loads(fields["evidence"])


def cache_folder(root, sid):
    base = shared_root(root)
    return safe_path(base, ".claude/bug-evidence/" + sid)


def resolve_evidence(root, sid, dm):
    fields = find_report(root, sid, dm)
    entries = latest_entries(root, sid, fields)
    bad = dm.evidence_problems({"evidence": json.dumps(entries)}, sid)
    if bad:
        raise Refused("; ".join(bad))
    ready, missing = [], []
    for item in entries:
        try:
            if "attachment_id" in item:
                folder = cache_folder(root, sid)
                meta_path = safe_path(shared_root(root), os.path.relpath(folder / (item["attachment_id"] + ".json"), shared_root(root)))
                meta = read_json(meta_path, {})
                if not isinstance(meta, dict):
                    raise Refused("invalid cache metadata; download again")
                if any(meta.get(key) != item.get(key) for key in ("attachment_id", "filename", "mime_type", "size")):
                    raise Refused("download required")
                path = safe_path(shared_root(root), os.path.relpath(folder / (item["attachment_id"] + ".image"), shared_root(root)))
                digest = meta.get("sha256")
            else:
                path = safe_path(root, item["path"])
                digest = item["sha256"]
            raw, mime, actual = image_bytes(path)
            if actual != digest or mime != item["mime_type"] or ("size" in item and len(raw) != item["size"]):
                raise Refused("image metadata/checksum differs")
            ready.append(dict(item, path=str(path), sha256=actual))
        except (Refused, OSError) as exc:
            missing.append(dict(item, reason=str(exc)))
    return {"id": sid, "work_item_type": "bug", "ready": ready, "missing": missing}


def atomic_write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".defect-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def cache_evidence(root, sid, aid, source, dm):
    fields = find_report(root, sid, dm)
    entries = latest_entries(root, sid, fields)
    bad = dm.evidence_problems({"evidence": json.dumps(entries)}, sid)
    if bad:
        raise Refused("; ".join(bad))
    item = next((e for e in entries if e.get("attachment_id") == aid), None)
    if item is None:
        raise Refused("attachment is not listed on this Bug; refresh Jira metadata")
    raw, mime, digest = image_bytes(source)
    if mime != item["mime_type"] or ("size" in item and item["size"] != len(raw)):
        raise Refused("downloaded image does not match attachment metadata")
    folder = cache_folder(root, sid)
    folder.mkdir(parents=True, exist_ok=True)
    base = shared_root(root)
    # The cache is ignored even in a project with no scaffolding ignore rules.
    ignored = safe_path(base, ".claude/bug-evidence/.gitignore")
    if not ignored.exists():
        atomic_write(ignored, b"*\n")
    dest = safe_path(base, os.path.relpath(folder / (aid + ".image"), base))
    atomic_write(dest, raw)
    meta = dict(item, sha256=digest)
    atomic_write(safe_path(base, os.path.relpath(folder / (aid + ".json"), base)), json.dumps(meta).encode())
    return dict(meta, path=str(dest))


def field_block(key, value):
    if isinstance(value, list):
        value = "\n".join("- " + str(v) for v in value)
    if not isinstance(value, str):
        raise Refused(key + " must be text (reproduction_steps may also be a list)")
    lines = value.strip().splitlines()
    return key + ":" + (" " + lines[0] + "\n" if len(lines) == 1 else "\n" + "".join("  " + line + "\n" for line in lines))


def create_report(root, report, screenshots, dm):
    record = read_json(root / ".claude/scaffolding.json", {})
    if not isinstance(record, dict):
        raise Refused("scaffolding.json must be a JSON object")
    if "backlog" in record:
        backend = record["backlog"]
        if not isinstance(backend, dict) or backend.get("backend") not in ("file", "jira"):
            raise Refused("backlog.backend must be file or jira; repair the configuration before intake")
        if backend["backend"] == "jira":
            raise Refused("this project uses Jira: create a Bug there; file intake would split the backlog")
    if not isinstance(record.get("pieces", {}), dict):
        raise Refused("pieces must be a JSON object")
    if not isinstance(report, dict) or not isinstance(report.get("title"), str) or not report["title"].strip():
        raise Refused("report needs a title")
    images, seen = [], set()
    for source in screenshots:
        raw, mime, digest = image_bytes(source)
        if digest not in seen:
            name = Path(source).name
            if any(ord(c) < 32 for c in name) or "\\" in name:
                raise Refused("screenshot needs a plain filename without control characters")
            images.append((raw, mime, digest, name))
            seen.add(digest)
    today = datetime.date.today().isoformat()
    tag = ""
    owner = dm.load_owner(str(root))
    requester = owner or "user"
    try:
        team = dm.load_team(str(root))
    except dm.MailError as exc:
        raise Refused(str(exc)) from exc
    if team:
        member = read_json(shared_root(root) / ".claude/member.json", {})
        login = member.get("login") if isinstance(member, dict) else None
        if login not in team["members"]:
            raise Refused(dm.NO_MEMBER)
        prefix = team["members"][login]["prefix"]
        requester = team["members"][login]["name"]
        tag = prefix + "-" if prefix else ""
    allowed = set(dm.STORY_FIELDS) | {"epic", "priority", "priority_reason", "size", "depends_on", "preconditions",
              "related_story", "story_link_basis", "reproduction_steps", "expected_behaviour", "actual_behaviour", "environment", "ui"}
    unknown = set(report) - allowed
    if unknown:
        raise Refused("unsupported report fields: " + ", ".join(sorted(unknown)))
    defaults = {"kind": "code", "design_impact": "no", "requested": today + ", by " + requester + " via chat", "epic": "none",
                "priority": "P3", "priority_reason": "default", "size": "M", "depends_on": "none",
                "goal": report["title"], "acceptance": "Verify the reported behaviour against the originating Story.",
                "files_or_areas": "unresolved: investigate the affected area", "decided": "none", "out_of_scope": "unrelated changes",
                "validate": "Reproduce the defect, add a regression check, then run scoped affected checks."}
    defaults.update(report)
    for key in ("related_story", "story_link_basis", "reproduction_steps", "expected_behaviour", "actual_behaviour"):
        if not defaults.get(key):
            defaults[key] = "unresolved: not supplied; investigate before implementation"
    fields = dict(defaults, work_item_type="bug")
    inbox = safe_path(root, "_dev/code-inbox")
    inbox.mkdir(parents=True, exist_ok=True)
    prefix = "DEV-" + today + "-" + tag
    names = list(root.glob("_dev/**/DEV-*.md")) + list(root.glob("_design/staged-stories/**/DEV-*.md"))
    used = [int(p.stem[len(prefix):]) for p in names if re.fullmatch(re.escape(prefix) + r"\d{3}", p.stem)]
    number = max(used, default=0) + 1
    while number <= 999:
        sid = prefix + f"{number:03d}"
        folder = safe_path(root, "_dev/attachments/" + sid)
        dest = safe_path(root, "_dev/code-inbox/" + sid + ".md")
        if dest.exists() or folder.exists():
            number += 1
            continue
        evidence, owned_folder = [], False
        try:
            if images:
                folder.parent.mkdir(parents=True, exist_ok=True)
                try:
                    folder.mkdir()
                except FileExistsError:
                    number += 1
                    continue
                owned_folder = True
                for raw, mime, digest, name in images:
                    filename = digest[:12] + "-" + name
                    path = safe_path(root, "_dev/attachments/" + sid + "/" + filename)
                    path.write_bytes(raw)
                    evidence.append({"filename": name, "mime_type": mime, "path": path.relative_to(root).as_posix(), "sha256": digest})
            fields["evidence"] = json.dumps(evidence, ensure_ascii=False)
            # Parse our own output so validation sees the same multiline representation as the poller.
            text = "id: " + sid + "\n" + "".join(field_block(k, v) for k, v in fields.items())
            fd, temp = tempfile.mkstemp(prefix=".defect-", dir=inbox)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    stream.write(text)
                os.link(temp, dest)  # Atomic publication, refusing any concurrent ID collision.
            finally:
                os.unlink(temp)
            break
        except FileExistsError:
            if owned_folder:
                shutil.rmtree(folder)
            number += 1
        except Exception:
            if owned_folder:
                shutil.rmtree(folder)
            raise
    else:
        raise Refused("daily DEV ID range is exhausted")
    parsed = dm.story_fields(text)
    problems = dm.field_problems(parsed, sid, owner)
    problems += [key + ": missing" for key in dm.STORY_FIELDS if not parsed.get(key, "").strip()]
    if parsed.get("kind") not in ("code", "data", "ui", "docs"):
        problems.append("kind: write code, data, ui or docs")
    try:
        dm.root_requester(parsed, sid, owner, team)
    except dm.MailError as exc:
        problems.append("requested: " + str(exc))
    related = parsed["related_story"]
    if dm.STORY_RE.fullmatch(related):
        origins = [p for p in root.glob("_dev/**/" + related + ".md") if not p.is_symlink()]
        if not origins or dm.work_item_type(dm.story_fields(origins[0].read_text())) != "story":
            problems.append("related_story: verify the originating Story; it is not a known Story")
    pickup = record.get("pieces", {}).get("inbox") == "on"
    return {"id": sid, "path": dest.relative_to(root).as_posix(), "work_item_type": "bug", "evidence": evidence,
            "held": bool(problems), "problems": problems, "pickup_enabled": pickup,
            "note": "Ready for queue validation" if pickup else "Report saved; inbox pickup is disabled"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--report", required=True, help="JSON file, inline JSON, or - for stdin")
    create.add_argument("--screenshot", action="append", default=[])
    for command in (create, sub.add_parser("evidence"), sub.add_parser("cache-evidence")):
        command.add_argument("--root", required=True)
        if command is not create:
            command.add_argument("--id", required=True)
        if command.prog.endswith("cache-evidence"):
            command.add_argument("--attachment-id", required=True)
            command.add_argument("--file", required=True)
    args = parser.parse_args(argv)
    try:
        root = Path(args.root).resolve()
        if not root.is_dir():
            raise Refused("--root must name an existing project folder")
        dm = mail_module()
        if args.command == "create":
            if args.report == "-":
                report = json.load(sys.stdin)
            elif args.report.lstrip().startswith("{"):
                report = json.loads(args.report)
            else:
                report = read_json(Path(args.report))
            result = create_report(root, report, args.screenshot, dm)
        elif args.command == "evidence":
            result = resolve_evidence(root, args.id, dm)
        else:
            result = cache_evidence(root, args.id, args.attachment_id, args.file, dm)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (Refused, OSError, ValueError) as exc:
        print("REFUSED: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
