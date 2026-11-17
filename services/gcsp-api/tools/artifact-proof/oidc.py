"""Throwaway OIDC kit for the artifact proof: stdlib only, run as `python3 -I oidc.py`. Signing uses openssl."""
import base64
import http.server
import json
import os
import ssl
import subprocess
import sys
import time
import zipfile


def b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def openssl(*args, data=None):
    return subprocess.run(["openssl", *args], input=data, check=True, capture_output=True).stdout


def setup(d, keytool, storepass):
    sig, tls, cert = (os.path.join(d, n) for n in ("sig.key", "tls.key", "tls.crt"))
    for key in (sig, tls):
        openssl("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", key)
    openssl("req", "-x509", "-new", "-key", tls, "-subj", "/CN=localhost", "-days", "2",
            "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-out", cert)
    mod = openssl("rsa", "-in", sig, "-noout", "-modulus").decode().strip().split("=", 1)[1]
    jwk = {"kty": "RSA", "kid": "proof-key-1", "use": "sig", "alg": "RS256",
           "n": b64u(bytes.fromhex(mod)), "e": "AQAB"}
    with open(os.path.join(d, "jwks.json"), "w") as f:
        json.dump({"keys": [jwk]}, f)
    trust = os.path.join(d, "trust.p12")
    if os.path.exists(trust):
        os.remove(trust)
    subprocess.run([keytool, "-importcert", "-noprompt", "-alias", "gcsp-proof", "-file", cert,
                    "-keystore", trust, "-storetype", "PKCS12", "-storepass", storepass],
                   check=True, capture_output=True)


def serve(d):
    body = open(os.path.join(d, "jwks.json"), "rb").read()

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(os.path.join(d, "tls.crt"), os.path.join(d, "tls.key"))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    with open(os.path.join(d, "jwks.port"), "w") as f:
        f.write(str(srv.server_address[1]))
    srv.serve_forever()


def token(d, iss, aud, azp, sub, roles):
    now = int(time.time())
    head = {"alg": "RS256", "typ": "JWT", "kid": "proof-key-1"}
    claims = {"iss": iss, "aud": aud, "azp": azp, "sub": sub, "scope": "openid gcsp-api",
              "iat": now, "exp": now + 3600, "realm_access": {"roles": roles}}
    signing = b64u(json.dumps(head).encode()) + "." + b64u(json.dumps(claims).encode())
    sig = openssl("dgst", "-sha256", "-sign", os.path.join(d, "sig.key"), data=signing.encode())
    return signing + "." + b64u(sig)


def jget(path, expr):
    """Print a dotted path of a JSON file; `checks[name=x]` picks a list item by field."""
    cur = json.load(open(path))
    for part in expr.split("."):
        if "[" in part:
            name, sel = part[:-1].split("[", 1)
            k, v = sel.split("=", 1)
            cur = next(i for i in cur[name] if i.get(k) == v)
        else:
            cur = cur[part]
    print(cur if isinstance(cur, str) else json.dumps(cur, separators=(",", ":")))


def scan(root):
    """Class files that reference ProcessBuilder or Runtime.exec (a utf8 constant "exec" beside Runtime)."""
    for base, _, names in os.walk(root):
        for n in sorted(names):
            if not n.endswith(".class"):
                continue
            p = os.path.join(base, n)
            b = open(p, "rb").read()
            if b"java/lang/ProcessBuilder" in b or (b"java/lang/Runtime" in b and b"\x01\x00\x04exec" in b):
                print(os.path.relpath(p, root))


def jsentries(jar):
    for n in zipfile.ZipFile(jar).namelist():
        if n.endswith((".js", ".mjs")):
            print(n)


if __name__ == "__main__":
    cmd, a = sys.argv[1], sys.argv[2:]
    if cmd == "setup":
        setup(*a)
    elif cmd == "serve":
        serve(*a)
    elif cmd == "token":
        print(token(a[0], a[1], a[2], a[3], a[4], a[5:]))
    elif cmd == "jget":
        jget(*a)
    elif cmd == "scan":
        scan(*a)
    elif cmd == "jsentries":
        jsentries(*a)
    else:
        sys.exit("unknown command " + cmd)
