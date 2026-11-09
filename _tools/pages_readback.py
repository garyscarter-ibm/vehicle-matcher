"""Bounded public readback gate for the Pages product map (FUCQ-166).
Polls the served data.json until its sha256 matches the uploaded file, else fails with a receipt."""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SCHEMA = "pages-public-readback.v1"
KEEP_EACH_END = 50
HEADERS_KEPT = ("Age", "X-Cache", "Cache-Control", "Last-Modified", "ETag",
                "x-github-edge-region", "X-GitHub-Request-Id", "X-Served-By")
LOCAL_HOSTS = ("127.0.0.1", "localhost")


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def validate_url(url):
    """Return url if https (or http to localhost for tests); raise ValueError otherwise."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme == "https" and parts.hostname:
        return url
    if parts.scheme == "http" and parts.hostname in LOCAL_HOSTS:
        return url
    raise ValueError("url must be https (plain http only for 127.0.0.1 or localhost): %s" % url)


def with_token(url, token):
    parts = urllib.parse.urlsplit(url)
    query = parts.query + "&" if parts.query else ""
    return urllib.parse.urlunsplit(parts._replace(query=query + "readback=" + token))


def digest_info(body):
    """Return (sha256, generated_at) for a body; generated_at only from a JSON object."""
    generated = None
    try:
        doc = json.loads(body.decode("utf-8"))
        if isinstance(doc, dict) and isinstance(doc.get("generated_at"), str):
            generated = doc["generated_at"]
    except (ValueError, UnicodeDecodeError):
        pass
    return hashlib.sha256(body).hexdigest(), generated


def fetch_once(url, request_timeout):
    """One GET; returns a dict of status/error, body bytes and kept headers. Never raises."""
    req = urllib.request.Request(url, headers={
        "Cache-Control": "no-cache", "Pragma": "no-cache",
        "User-Agent": "vehicle-matcher-pages-readback/1"})
    result = {"status": None, "body": None, "headers": {}}
    try:
        with urllib.request.urlopen(req, timeout=request_timeout) as resp:
            result["status"], result["body"] = resp.status, resp.read()
            headers = resp.headers
    except urllib.error.HTTPError as err:
        result["status"], headers = err.code, err.headers
        try:
            result["body"] = err.read()
        except Exception:  # noqa: BLE001 - an unreadable error body is not fatal
            result["body"] = b""
    except Exception as err:  # noqa: BLE001 - every failure is recorded, none escapes
        result["error"] = "%s: %s" % (type(err).__name__, str(err)[:160])
        return result
    for name in HEADERS_KEPT:
        value = headers.get(name)
        if value is not None:
            result["headers"][name] = value
    return result


def cap_attempts(attempts):
    if len(attempts) <= 2 * KEEP_EACH_END:
        return attempts, 0
    return attempts[:KEEP_EACH_END] + attempts[-KEEP_EACH_END:], len(attempts) - 2 * KEEP_EACH_END


def write_receipt(path, receipt):
    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(receipt, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, path)
    except OSError as err:
        print("warning: could not write receipt %s: %s" % (path, err), file=sys.stderr)


def append_summary(receipt, last):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    exp = receipt["expected"]
    lines = [
        "### Public product map readback", "",
        "- Outcome: **%s**" % receipt["outcome"],
        "- URL: %s" % receipt["url"],
        "- Deployed: sha256 `%s`, generated_at `%s`" % (exp["sha256"][:12], exp["generated_at"]),
        "- Last served: sha256 `%s`, generated_at `%s`" % (
            (last.get("sha256") or "none")[:12], last.get("generated_at")),
        "- Attempts: %d" % (len(receipt["attempts"]) + receipt["attempts_dropped"]),
        "- Elapsed: %.0f s" % receipt["elapsed_seconds"], ""]
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError as err:
        print("warning: could not write step summary: %s" % err, file=sys.stderr)


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--file", required=True)
    p.add_argument("--url", required=True)
    p.add_argument("--timeout", type=float, default=600)
    p.add_argument("--interval", type=float, default=15)
    p.add_argument("--request-timeout", type=float, default=20)
    p.add_argument("--artifact-id", default=None)
    p.add_argument("--receipt", required=True)
    return p.parse_args(argv)


def run(argv, clock=time.monotonic, sleep=time.sleep, fetch=fetch_once):
    args = parse_args(argv)
    try:
        url = validate_url(args.url)
        with open(args.file, "rb") as fh:
            expected_body = fh.read()
    except (ValueError, OSError) as err:
        print("error: %s" % err, file=sys.stderr)
        return 2
    exp_sha, exp_generated = digest_info(expected_body)
    env = os.environ
    run_id, attempt_no = env.get("GITHUB_RUN_ID", "local"), env.get("GITHUB_RUN_ATTEMPT", "0")
    started_at, t0 = utc_now(), clock()
    deadline = t0 + args.timeout
    attempts, served_after, last_200 = [], None, None
    n = 0
    while True:
        n += 1
        token = "%s-%s-%d-%d" % (run_id, attempt_no, n, int(time.time() * 1000))
        remaining = deadline - clock()
        res = fetch(with_token(url, token), max(1.0, min(args.request_timeout, remaining)))
        rec = {"n": n, "at": utc_now()}
        body = res.get("body")
        if res.get("error"):
            rec["error"] = res["error"]
        else:
            rec["status"] = res["status"]
        sha, generated = digest_info(body) if body is not None else (None, None)
        rec.update({"bytes": len(body) if body is not None else None, "sha256": sha,
                    "generated_at": generated, "match": bool(res.get("status") == 200 and sha == exp_sha)})
        rec.update(res["headers"] if "headers" in res else {})
        attempts.append(rec)
        if res.get("status") == 200:
            last_200 = rec
        print("attempt %d status=%s bytes=%s sha256=%s generated_at=%s Age=%s X-Cache=%s match=%s" % (
            n, rec.get("status", rec.get("error")), rec["bytes"], (sha or "none")[:12], generated,
            rec.get("Age"), rec.get("X-Cache"), rec["match"]), flush=True)
        if rec["match"]:
            served_after = clock() - t0
            break
        remaining = deadline - clock()
        if remaining <= 0:
            break
        sleep(min(args.interval, remaining))
    elapsed = clock() - t0
    outcome = "served" if served_after is not None else ("stale" if last_200 else "unreachable")
    kept, dropped = cap_attempts(attempts)
    last = last_200 or attempts[-1]
    receipt = {
        "schemaVersion": SCHEMA, "url": url,
        "expected": {"path": args.file, "bytes": len(expected_body), "sha256": exp_sha,
                     "generated_at": exp_generated},
        "publication": {"run_id": run_id, "run_attempt": attempt_no,
                        "event": env.get("GITHUB_EVENT_NAME"),
                        "pages_build_version": env.get("GITHUB_SHA"), "artifact_id": args.artifact_id},
        "started_at": started_at, "finished_at": utc_now(), "elapsed_seconds": round(elapsed, 3),
        "outcome": outcome,
        "served_after_seconds": round(served_after, 3) if served_after is not None else None,
        "attempts": kept, "attempts_dropped": dropped}
    write_receipt(args.receipt, receipt)
    append_summary(receipt, last)
    if outcome == "served":
        return 0
    served = "none (%s)" % (last.get("error") or "HTTP %s" % last.get("status")) if not last_200 else (
        "sha256=%s generated_at=%s" % (last.get("sha256"), last.get("generated_at")))
    print("::error::Public product map %s after %.0f s: served %s, deployed sha256=%s generated_at=%s. "
          "Deploy success alone is not public freshness." % (outcome, elapsed, served, exp_sha, exp_generated))
    return 1


def main():
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
