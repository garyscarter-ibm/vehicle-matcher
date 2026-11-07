import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, signal, subprocess, threading, time
ROOT = pathlib.Path("/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032")
OUT = ROOT / "docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07"
META = pathlib.Path("/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/retention-proof")
META.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location("resources", ROOT / "_tools/test_resources.py")
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location("exporter", OUT / "export_checkpoint.py")
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
policy = R.Policy({"chunk_scratch_mib": 16, "chunk_ram_mib": 512, "chunk_seconds": 30, "log_mib": 1})
plan = {"changed_paths": [str(OUT / p) for p in ["export_checkpoint.py", "run-proof.py", "proof-child.mjs", "proof-supervisor.py"]],
 "regression": "accepted source checkpoint survives forced SIGTERM/SIGKILL of supervisor+child group and scratch cleanup",
 "affected_callers": ["finite live source runner primary state path", "source supervisor finalizer/export"],
 "selected": ["two forced group termination cases", "retained envelope/hash export", "actual source binder after scratch removal"],
 "exclusions": "No production hot-path changes, network, UI, full suite or new capacity claim",
 "limits": {"workers":1,"scratchBytes":16777216,"ramBytes":536870912,"secondsPerCase":20},
 "retainedCheckpointRule": "primary state is a deliverable outside scratch and is never removed by finalizer"}
R.atomic_json(META / "plan.json", plan)
R.atomic_json(pathlib.Path("/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/f61-interruption-retention.json"), plan)
link = ROOT / "server/node_modules"; vendor = pathlib.Path("/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules")
link_identity = None
current = None
results = []
def teardown():
 global current, link_identity
 if current:
  scratch, host, retained, reserved, entered = current
  if any(R.group_has_live_members(pid) is not False for pid in scratch.record["groups"]): raise RuntimeError("owned groups remain")
  # Export retained primary before disposable scratch cleanup. Never delete the primary.
  export_error = None
  try:
   E.export(retained)
  except Exception as error:
   export_error = type(error).__name__
   R.atomic_json(retained / "checkpoint-export-failure.json", {"issue":"retained-checkpoint-export-failed","errorType":export_error,"primaryPreserved":True})
  if entered:
   f = subprocess.run(["/usr/sbin/lsof","-t","+D",str(scratch.root)],capture_output=True,timeout=10)
   if f.returncode not in [0,1] or f.stdout.strip(): raise RuntimeError("owned scratch open")
   scratch.__exit__(None,None,None)
  if reserved: host.release(scratch.token)
  for path in retained.glob("collector-checkpoint.json.writer-*.json"):
   row = json.loads(path.read_text())
   if row["pid"] not in scratch.record["groups"] and R.process_identity(row["pid"]) is not None:
    raise RuntimeError("writer ownership uncertain")
   # Exact token path owned by the now absent proof participant.
   staging = retained / ("collector-checkpoint.json.writing-" + str(row["pid"]) + "-" + row["token"])
   if staging.exists(): staging.unlink()
   path.unlink()
  R.atomic_json(retained / "cleanup.json", {"scratchAbsent":not scratch.root.exists(),"groupsAbsent":True,
    "reservationAbsent":scratch.token not in (R.read_json(host.path,{}) or {}),"removedAllocationBytes":scratch.record["peak"],
    "primaryRetained":str(retained / "collector-checkpoint.json"),"primaryBytes":(retained / "collector-checkpoint.json").stat().st_size if (retained / "collector-checkpoint.json").exists() else None,"exportError":export_error})
  current = None
 if link_identity:
  st = link.lstat()
  if (st.st_dev,st.st_ino) != link_identity or link.readlink() != vendor: raise RuntimeError("borrowed dependency link changed")
  link.unlink();link_identity=None
atexit.register(teardown)
with R.handled_termination():
 try:
  if os.path.lexists(link): raise RuntimeError("existing dependency path preserved")
  link.symlink_to(vendor,target_is_directory=True); st=link.lstat();link_identity=(st.st_dev,st.st_ino)
  for label, sig in [("sigterm",signal.SIGTERM),("sigkill",signal.SIGKILL)]:
   retained = OUT / label;retained.mkdir()
   R.atomic_json(META / (label + "-retained-deliverables.json"), {"directory":str(retained),"primary":str(retained / "collector-checkpoint.json"),"expectedBytes":2097152,"disposable":False,"neverDeletePrimary":True})
   scratch = R.Scratch(META,ROOT,policy,expected=16*R.MIB,checkpoint=retained / "collector-checkpoint.json")
   host=R.HostBudget(policy);host._dead_owners=lambda:{}
   current=(scratch,host,retained,False,False)
   host.acquire(scratch.token,16*R.MIB,512*R.MIB,ROOT,root=scratch.root);current=(scratch,host,retained,True,False)
   scratch.__enter__();current=(scratch,host,retained,True,True)
   (scratch.root / "disposable-proof.txt").write_text("owned scratch\n")
   def force():
    stop=time.monotonic()+10
    while time.monotonic()<stop:
     if (retained / "ready.json").exists() and scratch.record["groups"]:
      os.killpg(scratch.record["groups"][0],sig);return
     time.sleep(.05)
   killer=threading.Thread(target=force);killer.start()
   env={"PATH":"/opt/homebrew/bin:/usr/bin:/bin","LANG":"en_GB.UTF-8","TZ":"UTC"}
   result=R.run_process(["/usr/bin/python3","-I",str(OUT / "proof-supervisor.py"),str(retained)],ROOT,env,META / (label+".log"),scratch,policy,16*R.MIB,448*R.MIB,15,host)
   killer.join();assert (retained / "ready.json").exists(),"source-bound ready checkpoint never committed"
   assert result["rc"] == -int(sig) and result["issue"] is None, result
   # Root teardown reconciles the forced-stopped supervisor and removes only owned scratch.
   saved=current;teardown()
   # Borrowed dependencies are only needed for the semantic verification; restore the owned link after teardown.
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino)
   verify=subprocess.run(["/opt/homebrew/bin/node",str(OUT / "proof-child.mjs"),"verify",str(retained)],cwd=ROOT,capture_output=True,text=True,timeout=10,env={**env,"TMPDIR":str(retained),"TMP":str(retained),"TEMP":str(retained)})
   assert verify.returncode==0,verify.stderr[-2000:]
   semantic=json.loads(verify.stdout)
   result.update(case=label,semantic=semantic,checkpointPersistedOutsideScratch=True,primaryNeverDeleted=True)
   R.atomic_json(retained / "proof-result.json",result);results.append(result)
 finally:teardown()
R.atomic_json(OUT / "receipt.json",{"status":"passed","cases":results,"newSourceRequests":0,"capacityCredit":0,"dependencyLinkAbsent":not os.path.lexists(link),"source":"one immutable actual32 source-bound record reused in synthetic interruption harness"})
print(json.dumps({"status":"passed","cases":[r["case"] for r in results],"network":0,"linkAbsent":not os.path.lexists(link)}))
