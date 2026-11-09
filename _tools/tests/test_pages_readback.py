"""FUCQ-166: the Pages public readback gate fails unless the served map matches the upload.

Synthetic bodies on a local 127.0.0.1 server (ports 9070-9079 only); no external network."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pages_readback", ROOT / "_tools/pages_readback.py")
PR = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PR)
PORTS = range(9070, 9080)


def body(tag):
    return json.dumps({"generated_at": "2026-11-07T00:00:%02dZ" % tag, "tag": tag}).encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        srv = self.server
        with srv.lock:
            srv.requests.append({"path": self.path, "cache": self.headers.get("Cache-Control")})
            idx = len(srv.requests) - 1
        status, payload = srv.respond(idx)
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Age", "7")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class PagesReadback(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gc016-")
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.servers = []
        self.addCleanup(self.stop_servers)
        env = mock_env({"GITHUB_STEP_SUMMARY": None, "GITHUB_RUN_ID": "99", "GITHUB_RUN_ATTEMPT": "2",
                        "GITHUB_EVENT_NAME": "workflow_run", "GITHUB_SHA": "abc123"})
        env.__enter__()
        self.addCleanup(env.__exit__, None, None, None)

    def stop_servers(self):
        for srv, thread in self.servers:
            srv.shutdown()
            srv.server_close()
            thread.join(5)

    def serve(self, respond):
        for port in PORTS:
            try:
                srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            except OSError:
                continue
            srv.respond, srv.requests, srv.lock = respond, [], threading.Lock()
            thread = threading.Thread(target=srv.serve_forever, daemon=True)
            thread.start()
            self.servers.append((srv, thread))
            return srv, "http://127.0.0.1:%d/product-map/data.json" % port
        self.skipTest("no free port in 9070-9079")

    def free_port(self):
        for port in PORTS:
            with socket.socket() as sock:
                try:
                    sock.bind(("127.0.0.1", port))
                    return port
                except OSError:
                    continue
        self.skipTest("no free port in 9070-9079")

    def file(self, tag):
        path = self.dir / "data.json"
        path.write_bytes(body(tag))
        return str(path)

    def go(self, url, file, timeout="3", interval="0.05", **kw):
        receipt = str(self.dir / "receipt.json")
        argv = ["--file", file, "--url", url, "--timeout", timeout, "--interval", interval,
                "--request-timeout", "2", "--receipt", receipt, "--artifact-id", "555"]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = PR.run(argv, **kw)
        data = json.loads(Path(receipt).read_text()) if Path(receipt).exists() else None
        return code, out.getvalue(), err.getvalue(), data

    def test_two_publications_pass_by_exact_hash(self):
        a, b = body(1), body(2)
        srv, url = self.serve(lambda i: (200, a))
        code, _, _, rc = self.go(url, self.file(1))
        self.assertEqual((code, rc["outcome"]), (0, "served"))
        self.assertEqual(rc["publication"], {"run_id": "99", "run_attempt": "2", "event": "workflow_run",
                                             "pages_build_version": "abc123", "artifact_id": "555"})
        srv.respond = lambda i: (200, a) if i < 3 else (200, b)  # 1 request used above, then 2 stale
        code, out, _, rc = self.go(url, self.file(2))
        self.assertEqual((code, rc["outcome"]), (0, "served"))
        shas = [x["sha256"] for x in rc["attempts"]]
        self.assertEqual([PR.digest_info(a)[0], PR.digest_info(a)[0], PR.digest_info(b)[0]], shas)
        self.assertIsNotNone(rc["served_after_seconds"])
        self.assertEqual(rc["expected"]["sha256"], PR.digest_info(b)[0])
        self.assertEqual(rc["attempts"][0]["Age"], "7")
        self.assertNotIn("readback=", rc["url"])

    def test_stale_server_fails_with_receipt(self):
        a = body(1)
        _, url = self.serve(lambda i: (200, a))
        start = __import__("time").monotonic()
        code, out, _, rc = self.go(url, self.file(2), timeout="1", interval="0.2")
        self.assertLess(__import__("time").monotonic() - start, 2)
        self.assertEqual((code, rc["outcome"]), (1, "stale"))
        self.assertIn("::error::", out)
        self.assertEqual(rc["expected"]["sha256"], PR.digest_info(body(2))[0])
        self.assertEqual(rc["attempts"][-1]["sha256"], PR.digest_info(a)[0])
        self.assertIsNone(rc["served_after_seconds"])

    def test_every_request_has_unique_token_and_no_cache(self):
        a = body(1)
        srv, url = self.serve(lambda i: (200, a))
        self.go(url + "?x=1", self.file(2), timeout="0.5", interval="0.05")
        reqs = srv.requests
        self.assertGreater(len(reqs), 3)
        tokens = [parse_qs(urlsplit(r["path"]).query)["readback"][0] for r in reqs]
        self.assertEqual(len(set(tokens)), len(tokens))
        self.assertTrue(tokens[0].startswith("99-2-1-"))
        self.assertTrue(all("x=1" in r["path"] and r["cache"] == "no-cache" for r in reqs))

    def test_500s_and_refused_connection_are_unreachable(self):
        srv, url = self.serve(lambda i: (500, b"boom"))
        code, out, err, rc = self.go(url, self.file(1), timeout="0.5", interval="0.1")
        self.assertEqual((code, rc["outcome"]), (1, "unreachable"))
        self.assertTrue(all(x["status"] == 500 and not x["match"] for x in rc["attempts"]))
        self.assertNotIn("Traceback", out + err)
        refused = "http://127.0.0.1:%d/x.json" % self.free_port()
        code, out, err, rc = self.go(refused, self.file(1), timeout="0.5", interval="0.1")
        self.assertEqual((code, rc["outcome"]), (1, "unreachable"))
        self.assertTrue(all("error" in x and "status" not in x for x in rc["attempts"]))
        self.assertNotIn("Traceback", out + err)

    def test_url_validation(self):
        for good in ("https://example.github.io/x.json", "http://127.0.0.1:9070/x", "http://localhost/x"):
            self.assertEqual(PR.validate_url(good), good)
        for bad in ("http://example.com/x", "ftp://example.com/x", "file:///etc/passwd", "not a url"):
            with self.assertRaises(ValueError):
                PR.validate_url(bad)
        called = []
        code, _, err, rc = self.go("http://example.com/x", self.file(1), fetch=lambda *a: called.append(a))
        self.assertEqual((code, called, rc), (2, [], None))
        self.assertIn("error:", err)
        code, _, err, rc = self.go("https://example.github.io/x", str(self.dir / "missing.json"),
                                   fetch=lambda *a: called.append(a))
        self.assertEqual((code, called, rc), (2, [], None))

    def test_step_summary_is_appended(self):
        a = body(1)
        _, url = self.serve(lambda i: (200, a))
        summary = self.dir / "summary.md"
        summary.write_text("existing\n")
        with mock_env({"GITHUB_STEP_SUMMARY": str(summary)}):
            self.go(url, self.file(2), timeout="0.3", interval="0.1")
        text = summary.read_text()
        self.assertTrue(text.startswith("existing\n"))
        self.assertIn("Public product map readback", text)
        self.assertIn("**stale**", text)

    def test_attempt_cap_keeps_first_and_last_fifty(self):
        a = body(1)
        _, url = self.serve(lambda i: (200, a))
        clock = {"t": 0.0}
        code, _, _, rc = self.go(url, self.file(2), timeout="150", interval="1",
                                 clock=lambda: clock["t"], sleep=lambda s: clock.update(t=clock["t"] + s))
        self.assertEqual(code, 1)
        self.assertEqual(len(rc["attempts"]), 100)
        self.assertGreater(rc["attempts_dropped"], 0)
        self.assertEqual(rc["attempts"][49]["n"], 50)
        self.assertEqual(rc["attempts"][50]["n"], 50 + rc["attempts_dropped"] + 1)

    def test_workflow_wiring(self):
        text = (ROOT / ".github/workflows/pages.yml").read_text()
        deploy, verify = text.index("actions/deploy-pages@v4"), text.index("_tools/pages_readback.py")
        self.assertGreater(verify, deploy)
        tail = text[deploy:]
        for needle in ("_site/product-map/data.json", "steps.deployment.outputs.page_url",
                       "steps.artifact.outputs.artifact_id"):
            self.assertIn(needle, tail)
        self.assertRegex(text, r"- id: artifact\n\s+uses: actions/upload-pages-artifact@v3")


@contextlib.contextmanager
def mock_env(changes):
    saved = {k: os.environ.get(k) for k in changes}
    try:
        for k, v in changes.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
