#!/usr/bin/env bash
# Local startup proof for the portable fast-jar: env-only config, three runs, no Node. See README.md here.
set -euo pipefail

MOD="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$MOD/tools/artifact-proof"
PY=(python3 -I "$HERE/oidc.py")
SCRATCH="" DBURL="" SKIP_BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --scratch) SCRATCH="$2"; shift 2;;
    --db-url) DBURL="$2"; shift 2;;
    --skip-build) SKIP_BUILD=1; shift;;
    *) echo "usage: run.sh --scratch DIR --db-url JDBC_URL [--skip-build]" >&2; exit 2;;
  esac
done
[ -n "$SCRATCH" ] && [ -n "$DBURL" ] || { echo "--scratch and --db-url are required" >&2; exit 2; }
case "$SCRATCH" in /*) ;; *) echo "--scratch must be absolute" >&2; exit 2;; esac
case "$SCRATCH" in *OneDrive*|*CloudStorage*) echo "refusing a synced path" >&2; exit 2;; esac
mkdir -p "$SCRATCH"
D="$(cd "$SCRATCH" && pwd)"
export TMPDIR="${TMPDIR:-$D}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
JAVA="$JAVA_HOME/bin/java"
JAR="target/quarkus-app/quarkus-run.jar"
ISSUER="https://issuer.proof.test/realms/gcsp"; AUD="gcsp-api"; AZP="gcsp-web"
STOREPASS="proof-throwaway"
REQUIRED="identity,persistence,account,scenario,supply,allocation-candidates,ordering,approvals,documents,appointments,returns"
DBNAME="$(printf '%s' "$DBURL" | sed -E 's#^jdbc:postgresql://[^/]+/([^?]+).*#\1#')"
ACCOUNTS='[{"subject":"sub-paula","roles":["employee"],"employeeId":"employee-paula"},{"subject":"sub-alex","roles":["employee"],"employeeId":"employee-alex"},{"subject":"sub-sam","roles":["employee"],"employeeId":"employee-sam"},{"subject":"sub-jordan","roles":["employee"],"employeeId":"employee-jordan"},{"subject":"sub-greg","roles":["greg"]}]'

SUMMARY="$D/summary.txt"; : > "$SUMMARY"
FAILS=0 JARPID="" JWKSPID=""
cleanup() {
  [ -n "$JARPID" ] && kill -KILL "$JARPID" 2>/dev/null || true
  [ -n "$JWKSPID" ] && kill -KILL "$JWKSPID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rec() { # rec PASS|FAIL name detail
  printf '%-4s %-34s %s\n' "$1" "$2" "$3" | tee -a "$SUMMARY"
  [ "$1" = PASS ] || FAILS=$((FAILS + 1))
}
check() { if [ "$1" = 0 ]; then rec PASS "$2" "$3"; else rec FAIL "$2" "$3"; fi; }
now() { python3 -I -c 'import time;print(time.time())'; }
free_port() { python3 -I -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
get() { # get URL OUT [TOKEN] -> http code
  if [ -n "${3:-}" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$3" | curl -s -m 10 -K - -o "$2" -w '%{http_code}' "$1" || true
  else
    curl -s -m 10 -o "$2" -w '%{http_code}' "$1" || true
  fi
}
has() { grep -q -- "$2" "$1"; }

start_jar() { # start_jar RUN PORT [java flags -- ] ... env KEY=VAL... via ENVS array
  local run="$1" port="$2"; shift 2
  env -i PATH="$PATH" JAVA_HOME="$JAVA_HOME" TMPDIR="$TMPDIR" PORT="$port" ${ENVS[@]+"${ENVS[@]}"} \
    "$JAVA" "$@" -jar "$JAR" > "$D/run-$run.log" 2>&1 &
  JARPID=$!
  local i
  for i in $(seq 1 300); do
    grep -q 'started in' "$D/run-$run.log" 2>/dev/null && return 0
    kill -0 "$JARPID" 2>/dev/null || { echo "run $run exited early" >&2; return 1; }
    sleep 0.2
  done
  echo "run $run did not start in 60 s" >&2; return 1
}
start_ms() { sed -nE 's/.* started in ([0-9.]+)s.*/\1/p' "$D/run-$1.log" | head -1; }
stop_hard() { kill -KILL "$JARPID" 2>/dev/null || true; wait "$JARPID" 2>/dev/null || true; JARPID=""; }

cd "$MOD"
{ echo "# artifact proof $(date -u +%Y-%m-%dT%H:%M:%SZ) HEAD $(git rev-parse --short HEAD)"; } >> "$SUMMARY"

# ---- build -------------------------------------------------------------------------------------
if [ "$SKIP_BUILD" = 0 ]; then
  s=$(now)
  if ./mvnw -B -q package -DskipTests > "$D/build.log" 2>&1; then
    check 0 "build" "$(python3 -I -c "print(round($(now)-$s))") s, log $D/build.log"
  else
    check 1 "build" "failed, see $D/build.log"; tail -20 "$D/build.log" >&2; exit 1
  fi
fi
[ -f "$JAR" ] || { rec FAIL "jar present" "$JAR missing (build first)"; exit 1; }
JV="$("$JAVA" -version 2>&1 | head -1)"
MV="$(./mvnw -v 2>/dev/null | head -1)"
SHA="$(shasum -a 256 "$JAR" | cut -d' ' -f1)"
NFILES="$(find target/quarkus-app -type f | wc -l | tr -d ' ')"
printf 'java: %s\nmaven: %s\njar sha256: %s\nquarkus-app files: %s\n' "$JV" "$MV" "$SHA" "$NFILES" | tee -a "$SUMMARY"

# ---- run A: bare start -------------------------------------------------------------------------
ENVS=(); PORT_A="$(free_port)"
if start_jar A "$PORT_A"; then
  U="http://127.0.0.1:$PORT_A"
  c=$(get "$U/q/health/live" "$D/a-live.json"); check $([ "$c" = 200 ] && echo 0 || echo 1) "A live" "HTTP $c, started in $(start_ms A)s"
  c=$(get "$U/q/health/ready" "$D/a-ready.json"); check $([ "$c" = 200 ] && echo 0 || echo 1) "A ready (bare)" "HTTP $c"
  c=$(get "$U/api/gcsp/v1/context" "$D/a-context.json")
  check $([ "$c" = 401 ] && has "$D/a-context.json" bearer-missing && echo 0 || echo 1) "A context, no token" "HTTP $c $(head -c 120 "$D/a-context.json")"
else check 1 "A start" "see $D/run-A.log"; fi
stop_hard

# ---- run B: required but unconfigured ----------------------------------------------------------
ENVS=("GCSP_REQUIRED_PROVIDERS=$REQUIRED"); PORT_B="$(free_port)"
if start_jar B "$PORT_B"; then
  U="http://127.0.0.1:$PORT_B"
  c=$(get "$U/q/health/ready" "$D/b-ready.json")
  check $([ "$c" = 503 ] && echo 0 || echo 1) "B ready is 503" "HTTP $c"
  st=$("${PY[@]}" jget "$D/b-ready.json" 'checks[name=required-providers].status' 2>&1 || true)
  un=$("${PY[@]}" jget "$D/b-ready.json" 'checks[name=required-providers].data.unconfigured' 2>&1 || true)
  ok=0; [ "$st" = DOWN ] || ok=1
  for p in ${REQUIRED//,/ }; do printf '%s' "$un" | grep -q "$p" || ok=1; done
  check $ok "B required-providers DOWN" "$st unconfigured=$un"
else check 1 "B start" "see $D/run-B.log"; fi
stop_hard

# ---- run C: dev composition over the database --------------------------------------------------
"${PY[@]}" setup "$D" "$JAVA_HOME/bin/keytool" "$STOREPASS"
rm -f "$D/jwks.port"
"${PY[@]}" serve "$D" > "$D/jwks-server.log" 2>&1 &
JWKSPID=$!
for i in $(seq 1 50); do [ -s "$D/jwks.port" ] && break; sleep 0.1; done
JWKS_PORT="$(cat "$D/jwks.port")"
TOK="$("${PY[@]}" token "$D" "$ISSUER" "$AUD" "$AZP" sub-paula employee)"
ENVS=("GCSP_REQUIRED_PROVIDERS=$REQUIRED"
  "GCSP_IDENTITY_PROVIDER=oidc" "GCSP_OIDC_ISSUER=$ISSUER" "GCSP_OIDC_JWKS_URI=https://127.0.0.1:$JWKS_PORT/jwks"
  "GCSP_OIDC_AUDIENCE=$AUD" "GCSP_OIDC_AUTHORIZED_PARTY=$AZP" "GCSP_OIDC_REQUIRED_SCOPES=gcsp-api"
  "GCSP_OIDC_ACCOUNTS=$ACCOUNTS"
  "GCSP_ACCOUNT_PROVIDER=repository" "GCSP_SCENARIO_PROVIDER=demo" "GCSP_SUPPLY_PROVIDER=demo"
  "GCSP_ALLOCATION_CANDIDATES_PROVIDER=recommendation" "GCSP_ORDERING_PROVIDER=synthetic"
  "GCSP_APPROVALS_PROVIDER=synthetic" "GCSP_DOCUMENTS_PROVIDER=synthetic"
  "GCSP_APPOINTMENTS_PROVIDER=synthetic" "GCSP_RETURNS_PROVIDER=synthetic"
  "GCSP_DATABASE_URL=$DBURL" "GCSP_EXPECTED_DATABASE=$DBNAME" "GCSP_ENVIRONMENT_ID=artifact-proof-dev"
  "GCSP_RESET_ALLOWED=true" "GCSP_RUN_ID=run-1" "GCSP_POLICY_VERSION=gcsp-policy-v1" "GCSP_SHUTDOWN_TIMEOUT=10s")
PORT_C="$(free_port)"
if start_jar C "$PORT_C" -Djavax.net.ssl.trustStore="$D/trust.p12" -Djavax.net.ssl.trustStorePassword="$STOREPASS" -Djavax.net.ssl.trustStoreType=PKCS12; then
  U="http://127.0.0.1:$PORT_C"; CPID="$JARPID"
  rec PASS "C started" "started in $(start_ms C)s (jar to listening)"
  c=$(get "$U/q/health/ready" "$D/c-ready.json"); st=$("${PY[@]}" jget "$D/c-ready.json" 'checks[name=required-providers].status' 2>&1 || true)
  check $([ "$c" = 200 ] && [ "$st" = UP ] && echo 0 || echo 1) "C ready, providers UP" "HTTP $c required-providers=$st"
  c=$(get "$U/api/gcsp/v1/context" "$D/c-context.json" "$TOK")
  st=$("${PY[@]}" jget "$D/c-context.json" status 2>&1 || true); emp=$("${PY[@]}" jget "$D/c-context.json" value.employeeId 2>&1 || true)
  check $([ "$c" = 200 ] && [ "$st" = ok ] && [ "$emp" = employee-paula ] && echo 0 || echo 1) "C context, paula bearer" "HTTP $c status=$st employeeId=$emp"
  c=$(get "$U/api/gcsp/v1/manual/account" "$D/c-account.json" "$TOK")
  st=$("${PY[@]}" jget "$D/c-account.json" status 2>&1 || true)
  check $([ "$c" = 200 ] && [ "$st" = ok ] && echo 0 || echo 1) "C manual/account, paula" "HTTP $c status=$st"

  # no-Node checks, sampled before and after the calls
  kids=0; for i in 1 2 3; do n=$( (pgrep -P "$CPID" || true) | wc -l | tr -d ' '); kids=$((kids + n)); sleep 0.5; done
  check $([ "$kids" = 0 ] && echo 0 || echo 1) "NoNode a: jar has no children" "3 samples, $kids child processes"
  desc=$(ps -axo pid=,ppid=,comm= | awk -v root="$CPID" '{pp[$1]=$2; cm[$1]=$3} END{for(p in pp){a=p; while(a!=""&&a!=0&&a!=1){if(a==root&&p!=root){print cm[p]; break}; a=pp[a]}}}')
  nodes=$(printf '%s\n' "$desc" | grep -c 'node' || true)
  check $([ "$nodes" = 0 ] && echo 0 || echo 1) "NoNode b: no node descendant" "descendants: ${desc:-none}"

  sleep 3; RSS=$(ps -o rss= -p "$CPID" | tr -d ' ')
  rec PASS "C idle RSS" "$((RSS / 1024)) MB ($RSS KB)"

  # ---- SIGTERM ---------------------------------------------------------------------------------
  t0=$(now); kill -TERM "$CPID"; gone=1
  for i in $(seq 1 75); do kill -0 "$CPID" 2>/dev/null || { gone=0; break; }; sleep 0.2; done
  rc=0; [ "$gone" = 0 ] && { wait "$CPID" 2>/dev/null || rc=$?; }; t1=$(now); JARPID=""
  secs=$(python3 -I -c "print(round($t1-$t0,2))")
  check $([ "$gone" = 0 ] && [ "$rc" = 143 ] && echo 0 || echo 1) "SIGTERM exit 143, pid gone" "exit $rc after ${secs}s (limit 15 s)"
  check $(has "$D/run-C.log" 'GCSP API stopping' && has "$D/run-C.log" 'stopped in' && echo 0 || echo 1) "SIGTERM log lines" "$(grep -o 'stopped in [0-9.]*s' "$D/run-C.log" | head -1)"
  kill -0 "$CPID" 2>/dev/null && stop_hard || true
else check 1 "C start" "see $D/run-C.log"; stop_hard; fi
kill -KILL "$JWKSPID" 2>/dev/null || true; wait "$JWKSPID" 2>/dev/null || true; JWKSPID=""

# ---- static no-Node checks ---------------------------------------------------------------------
rm -rf "$D/unzipped"; mkdir -p "$D/unzipped"; js=""; refs=""
for j in target/quarkus-app/app/*.jar target/quarkus-app/quarkus/generated-bytecode.jar; do
  [ -f "$j" ] || continue
  out="$D/unzipped/$(basename "$j" .jar)"; mkdir -p "$out"; unzip -q -o "$j" -d "$out"
  js="$js$("${PY[@]}" jsentries "$j")"
  refs="$refs$("${PY[@]}" scan "$out" | sed "s#^#$(basename "$j"):#")"
done
check $([ -z "$js" ] && echo 0 || echo 1) "NoNode c: no .js/.mjs in app jars" "${js:-none} (library jars out of scope)"
check $([ -z "$refs" ] && echo 0 || echo 1) "NoNode c: no process spawn in app jars" "${refs:-none} (library jars out of scope)"
src=$(grep -rn 'ProcessBuilder\|Runtime.getRuntime' src/main/java || true)
check $([ -z "$src" ] && echo 0 || echo 1) "NoNode d: src/main/java grep empty" "${src:-none}"

echo; echo "== summary ($FAILS failing) =="; cat "$SUMMARY"
[ "$FAILS" = 0 ]
