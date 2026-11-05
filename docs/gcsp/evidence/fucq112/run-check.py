#!/usr/bin/env python3
"""One admitted FUCQ-112 command, with bounded owned resources and a retained receipt."""
import hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "_tools"))
import scaffold_git as G
import test_resources as R
RUNS = Path("/Users/usget/Claude/vehicle-matcher/.claude/test-runs")
name, mode, *command = sys.argv[1:]
if not re.fullmatch(r"[a-z0-9-]+", name) or mode not in ("install", "root-install", "test", "full"): raise SystemExit("invalid run")
if mode not in ("install","root-install") and (command[:3] != ["node", "--test", "--test-concurrency=1"]): raise SystemExit("one test-file worker required")
if mode == "install" and command != ["npm", "ci", "--prefix", "server", "--ignore-scripts", "--no-audit", "--no-fund"]: raise SystemExit("unapproved install")
if mode == "root-install" and command != ["npm","ci","--ignore-scripts","--no-audit","--no-fund"]: raise SystemExit("unapproved root install")
disk = 128 if mode == "root-install" else 64
seconds = 180 if mode == "root-install" else 120
policy = R.Policy({"chunk_scratch_mib":disk,"chunk_ram_mib":256 if mode == "install" else 512,"chunk_seconds":seconds,"log_mib":1})
host=R.HostBudget(policy)
head=G.git(ROOT,["rev-parse","HEAD"])[1].strip()
changed=G.git(ROOT,["status","--porcelain"])[1]
files=[p for p in (ROOT/"server/gcsp").rglob("*") if p.is_file() and "node_modules" not in p.parts]
files += list((ROOT/"server/test").rglob("*.js")) + list((ROOT/"server/test/fixtures").rglob("*.json"))
files += [ROOT/"server/index.js",ROOT/"server/package-lock.json",ROOT/"package-lock.json",ROOT/"package.json",ROOT/"server/package.json"]
hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.exists()}
identity={"head":head,"base":G.git(ROOT,["rev-parse","gcsp-poc"])[1].strip(),"changed":changed,"hashes":hashes,"command":command,"node":subprocess.check_output(["node","--version"],text=True).strip(),"environmentHashes":{k:hashlib.sha256(os.environ[k].encode()).hexdigest() for k in ("NODE_OPTIONS","NODE_ENV","TZ") if k in os.environ}}
receipt=RUNS/("fucq112-"+name+".json")
R.atomic_json(receipt,{"state":"planned","identity":identity,"health":host.headroom(ROOT),"scope":"own server dependency restore" if mode=="install" else "scoped case service; repository/clock/identity/policy/brief/outbox boundary exercised in named file","excluded":"No retail UI, live PostgreSQL or BMW infrastructure; full held for merged133then55 and solefull admission"})
start=time.monotonic()
log=RUNS/("fucq112-"+name+".log")
with R.handled_termination():
 with R.Scratch(RUNS,ROOT,policy,expected=disk*R.MIB,checkpoint=receipt) as scratch:
  reserved=False
  try:
   host.acquire(scratch.token,disk*R.MIB,int(policy.chunk_ram_mib*R.MIB),ROOT,root=scratch.root); reserved=True
   env=scratch.env(os.environ)
   env.update({"npm_config_cache":str(scratch.root/"npm-cache"),"npm_config_update_notifier":"false","NODE_V8_COVERAGE":str(scratch.root/"coverage")})
   outcome=R.run_process(command,ROOT,env,log,scratch,policy,disk*R.MIB,int(policy.chunk_ram_mib*R.MIB),seconds,host=host)
  except (KeyboardInterrupt, Exception) as error:
   outcome={"rc":130 if isinstance(error,KeyboardInterrupt) else 1,"wall":time.monotonic()-start,
     "issue":"launcher interrupted" if isinstance(error,KeyboardInterrupt) else "launcher failed: "+type(error).__name__,
     "issue_kind":"interrupted" if isinstance(error,KeyboardInterrupt) else "launcher-error"}
  finally:
   if reserved: host.release(scratch.token)
  text=log.read_text() if log.exists() else ""
  result={"state":"passed" if outcome["rc"]==0 and not outcome["issue"] else "failed","identity":identity,"result":outcome,"tapSummary":[line for line in text.splitlines() if line.startswith(("# tests","# pass","# fail","# skipped","# duration","ℹ tests","ℹ pass","ℹ fail","ℹ skipped","ℹ duration"))],"failures":[line for line in text.splitlines() if line.startswith(("not ok","  error:","  expected:","  actual:"))],"coverage":"V8 function contexts collected for same required execution; bounded coverage removed after compact source/function map extraction","wall":time.monotonic()-start}
  contexts=[]
  for f in (scratch.root/"coverage").glob("*.json"):
   try:
    for script in json.loads(f.read_text()).get("result",[]):
     if script["url"].startswith("file://"+str(ROOT/"server/gcsp")):
      contexts.append({"file":script["url"].removeprefix("file://"),"functions":[x["functionName"] for x in script["functions"] if any(r["count"] for r in x["ranges"])]})
   except (ValueError,OSError): pass
  result["observedFunctionContexts"]=contexts
 result["cleanup"]={"scratch":str(scratch.root),"removed":not scratch.root.exists(),"manifest":str(scratch.manifest),"reservationAbsent":scratch.token not in R.read_json(host.path,{}),"groupsAbsent":all(R.group_has_live_members(g) is False for g in scratch.record["groups"]),"removedBytes":scratch.record["peak"]}
 if not all(result["cleanup"][key] for key in ("removed","reservationAbsent","groupsAbsent")):
  result["state"]="failed";result["cleanupIssue"]="Owned scratch, reservation or process-group cleanup is incomplete or uncertain."
 if result["state"]=="passed": log.unlink(missing_ok=True); result["successfulLogRemoved"]=True
 R.atomic_json(receipt,result)
 impact=RUNS/"impact"/("fucq112-"+name+".json")
 R.atomic_json(impact,{"identity":identity,"plan":{"cases/index.js":"all eight acceptance cases","cases/http.js":"trusted employee/run, ignored overrides and scheme owner authorization","cases/notification.js":"actual captured consume/retry/ack and atomic rollback","repository/schema.js+core.js":"active-case uniqueness and transaction replay","policy/seed-v1.json":"dated keyed triggers/extension/provenance","brief/index.js":"actual employee postDeclineChange confirmation"},"observed":contexts,"limitations":["V8 counts are per named-file worker, not per assertion","absence never excludes paths","live PostgreSQL and external integrations unverified"],"result":result["state"],"timing":result["wall"]})
 print(json.dumps({k:result[k] for k in ("state","result","tapSummary","failures","cleanup")},indent=2))
 raise SystemExit(0 if result["state"]=="passed" else 1)
