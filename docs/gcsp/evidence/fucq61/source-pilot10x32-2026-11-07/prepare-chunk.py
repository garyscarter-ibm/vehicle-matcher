"""Prepare one unspent pilot allocation. This script never performs HTTP."""
import sys
sys.dont_write_bytecode = True
import copy, hashlib, json, pathlib, datetime
ROOT = pathlib.Path("/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032")
DIRECTORY = pathlib.Path(__file__).resolve().parent
sha = lambda value: hashlib.sha256(value).hexdigest()
def digest(value): return sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())
def read(path): return json.loads(path.read_text())
def put(path, value):
 with path.open("x") as stream: stream.write(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
number, size = int(sys.argv[1]), int(sys.argv[2])
assert 1 <= number <= 10 and size in [16,32]
manifest = read(DIRECTORY / "pilot-plan.json"); row = manifest["chunks"][number-1]; target = pathlib.Path(row["directory"])
assert not (target / "execution-once.json").exists() and not (target / "collector-checkpoint.json").exists()
plan_path = target / ("collection-plan" + str(size) + ".json"); plan = read(plan_path)
assert digest(plan) == row["plans"][str(size)]["digest"]
assert sha((target / "run-live.mjs").read_bytes()) == row["runnerSha256"]
assert sha(pathlib.Path(row["supervisor"]["path"]).read_bytes()) == row["supervisor"]["sha256"]
prior=read(DIRECTORY / "initial-canonical-index.json"); spent=read(DIRECTORY / "initial-spent-request-index.json")
assert digest(prior)==manifest["initialCanonicalIndexDigest"] and digest(spent)==manifest["initialSpentIndexDigest"]
prior_map={entry["configurationId"]:entry for entry in prior["entries"]}
for previous in manifest["chunks"][:number-1]:
 old=pathlib.Path(previous["directory"]); receipt=read(old / "receipt.json")
 assert receipt["reason"] in ["queue-exhausted","supervisor-resource-bound"] and (old / "checkpoint-export.json").exists() and not (old / "checkpoint-export-failure.json").exists(), "previous chunk failed; stop pilot"
 if receipt["reason"]=="supervisor-resource-bound": assert size==16,"resource ceiling requires16candidate fallback"
 envelope=read(old / "collector-checkpoint.json"); assert digest(envelope["content"])==envelope["contentDigest"]
 for accepted in envelope["content"]["accepted"]:
  assert accepted["admission"] is True and accepted["sourceKind"]=="dated-snapshot"
  prior_map.setdefault(accepted["configurationId"],{"configurationId":accepted["configurationId"],"origins":[]})["origins"].append({"path":str((old / "accepted.jsonl").relative_to(ROOT)),"kind":"admitted-source"})
 oldplan=read(old / "collection-plan.json")
 events=[json.loads(line) for line in (old / "source-events.jsonl").read_text().splitlines()]
 started_solver_count=sum(event["phase"]=="started" and "/rulesolver/" in event["url"] for event in events)
 for candidate in oldplan["candidates"][:started_solver_count]:
  spent["entries"].append({"candidateId":candidate["candidateId"],"requestDigest":digest({"modelRegistration":oldplan["modelRegistration"],"request":candidate["request"]}),"outcome":"prior-completed-pilot"})
prior["entries"]=sorted(prior_map.values(),key=lambda entry:entry["configurationId"])
assert len({entry["requestDigest"] for entry in spent["entries"]})==len(spent["entries"])
used={entry["requestDigest"] for entry in spent["entries"]}
assert all(digest({"modelRegistration":plan["modelRegistration"],"request":entry["request"]}) not in used for entry in plan["candidates"])
put(target / "collection-plan.json",plan);put(target / "prior-canonical-index.json",prior);put(target / "spent-request-index.json",spent)
old=read(DIRECTORY.parent / "source-batch32-2026-11-07/execution-plan.json")
paths=list(manifest["sourceCodePins"])+[str((target / name).relative_to(ROOT)) for name in ["run-live.mjs","collection-plan.json","prior-canonical-index.json","spent-request-index.json","retained-deliverables.json"]]+[manifest["retention"]["exporterPath"]]
for path, expected in manifest["sourceCodePins"].items(): assert sha((ROOT/path).read_bytes())==expected
assert sha((ROOT / manifest["retention"]["exporterPath"]).read_bytes())==manifest["retention"]["exporterSha256"]
allocation={**old,"id":"f61-source-pilot%02d-%d-20261107-once"%(number,size),"purpose":"finite retained-primary pilot chunk","selectedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"authorisation":"Root-approved finite pilot; explicit traffic/lane approval required before launcher execution","planDigest":digest(plan),"priorIndexDigest":digest(prior),"spentIndexDigest":digest(spent),"attempts":size+4,"decodedBytes":8388608,"deadlineMs":120000,"codeCommit":manifest["codeCommit"],"codePins":{path:sha((ROOT/path).read_bytes()) for path in paths},"snapshotVersion":"bmw-gb-t5mj-pilot%02d-2026-11-07.v2"%number,"artifactDestination":str(target),"checkpointFile":"collector-checkpoint.json","retainedDeliverables":read(target / "retained-deliverables.json"),"resources":{"scratchBytes":67108864,"ramBytes":536870912,"childCeilingBytes":469762048,"sourceDeadlineSeconds":120,"supervisorSeconds":180,"sourceWorkers":1,"expectedRetainedBytes":4194304}}
put(target / "execution-plan.json",allocation)
print(json.dumps({"chunk":number,"candidates":size,"planDigest":allocation["planDigest"],"spent":len(spent["entries"]),"priorAdmitted":sum(any(origin["kind"]=="admitted-source" for origin in entry["origins"]) for entry in prior["entries"]),"destination":str(target)}))
