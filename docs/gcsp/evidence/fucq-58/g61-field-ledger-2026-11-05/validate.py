"""Offline artifact checks only. Standard library; no requests or profile writes."""
import hashlib
import json
from pathlib import Path
import re
import sys


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def conforms(value, spec, location="$", count=None):
    """Evaluate the finite JSON Schema keyword subset used by schema.json.

    Unknown assertion keywords fail rather than silently weakening this check.
    This is an artifact-local contract checker, not a general JSON Schema engine.
    """
    count[0] += 1
    allowed = {"$schema", "$id", "title", "type", "const", "enum", "required",
               "properties", "additionalProperties", "items", "minItems",
               "maxItems", "minLength", "pattern"}
    require(not set(spec) - allowed, f"Unsupported schema keyword at {location}")
    if "const" in spec:
        require(value == spec["const"], f"Const mismatch at {location}")
    if "enum" in spec:
        require(value in spec["enum"], f"Enum mismatch at {location}")
    kinds = spec.get("type", [])
    kinds = [kinds] if isinstance(kinds, str) else kinds
    matches = {"object": isinstance(value, dict), "array": isinstance(value, list),
               "string": isinstance(value, str), "null": value is None}
    if kinds:
        require(all(k in matches for k in kinds), f"Unsupported type at {location}")
        require(any(matches[k] for k in kinds), f"Type mismatch at {location}")
    if isinstance(value, dict):
        require(set(spec.get("required", [])) <= set(value), f"Missing keys at {location}")
        if spec.get("additionalProperties") is False:
            require(set(value) <= set(spec.get("properties", {})), f"Unexpected keys at {location}")
        for key, child in spec.get("properties", {}).items():
            if key in value:
                conforms(value[key], child, f"{location}/{key}", count)
    if isinstance(value, list):
        require(len(value) >= spec.get("minItems", 0), f"Too few items at {location}")
        require(len(value) <= spec.get("maxItems", sys.maxsize), f"Too many items at {location}")
        if "items" in spec:
            for index, item in enumerate(value):
                conforms(item, spec["items"], f"{location}/{index}", count)
    if isinstance(value, str):
        require(len(value) >= spec.get("minLength", 0), f"String too short at {location}")
        if "pattern" in spec:
            require(re.search(spec["pattern"], value) is not None, f"Pattern mismatch at {location}")


def pointer(value, address):
    require(address.startswith("/"), "JSON pointer must be absolute")
    for token in address[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


def main():
    plan, ledger, schema = [read(HERE / name) for name in ("plan.json", "ledger.json", "schema.json")]
    count = [0]
    conforms(ledger, schema, count=count)
    require(ledger["schemaVersion"] == schema["$id"], "Schema version differs")
    require(len(ledger["sources"]) == len(plan["inputs"]) == 5, "Wrong input count")
    sources = {s["id"]: s for s in ledger["sources"]}
    require(len(sources) == 5, "Duplicate source IDs")
    for source in sources.values():
        path = ROOT / source["path"]
        require(path.is_file() and ROOT in path.resolve().parents, "Unsafe/missing source path")
        require(sha(path) == source["artifactSha256"] == plan["inputs"][source["path"]],
                f"Input artifact hash differs: {source['id']}")
    ids = [row["id"] for row in ledger["rows"]]
    require(ids == plan["expectedRows"] and len(set(ids)) == len(ids), "Field IDs differ or duplicate")
    locator_count = 0
    for row in ledger["rows"]:
        for evidence in row["evidence"]:
            source = sources[evidence["sourceId"]]
            path = ROOT / source["path"]
            locator = evidence["locator"]
            if locator["kind"] == "json-pointer":
                pointer(read(path), locator["value"])
                require(locator["contains"] is None, "Pointer contains must be null")
            else:
                line = path.read_text().splitlines()[int(locator["value"]) - 1]
                require(locator["contains"] and locator["contains"] in line,
                        f"Line locator differs: {row['id']}")
            locator_count += 1

    rows = {row["id"]: row for row in ledger["rows"]}
    observation = read(ROOT / sources["observation"]["path"])
    selection = observation["modelSelection"]["selection"]
    for rid, key in {"model-code": "modelCode", "ag-code": "agModelCode",
                     "catalogue-range": "catalogueRangeKey", "payload-range": "modelRangeField",
                     "steering-literal": "steeringLiteral", "order-date": "orderDate",
                     "model-effect-date": "effectDate"}.items():
        require(rows[rid]["configuratorValue"] == selection[key], f"Source literal differs: {rid}")
    for rid, key in {"requested-market": "marketRequest", "requested-locale": "localeRequest",
                     "tree-effect-date": "treeRequestEffectDate"}.items():
        require(rows[rid]["configuratorValue"] == observation["requestedContext"][key],
                f"Request context differs: {rid}")
    require(rows["source-observation-date"]["configuratorValue"] == observation["observedAt"],
            "Observation date differs")
    for rid in ("production-date", "production-era", "model-year", "registration-date",
                "registration-year", "advertised-manufacture-date", "advertised-manufacture-year",
                "derivative", "powertrain", "drive", "transmission", "confirmed-market",
                "confirmed-steering", "import-status", "position9-convention", "position10-meaning",
                "descriptor-boundaries", "ag-descriptor-relation", "plant-allocation"):
        require(rows[rid]["candidateValue"] is None and rows[rid]["status"] == "unresolved",
                f"Unsupported candidate fact: {rid}")
    for rid, literal in {"wmi-literal": "WBY", "positions4to8-literal": "72HH0",
                         "position10-literal": "0", "plant-literal": "C"}.items():
        require(rows[rid]["candidateValue"] == literal and rows[rid]["status"] == "reported-only",
                f"Candidate literal/status differs: {rid}")
    require(rows["position9-arithmetic"]["candidateValue"] == "matches modulo-11 calculation",
            "Only arithmetic outcome may be retained for position nine")
    require(rows["sample-count"]["candidateValue"] ==
            {"candidateObservations": 1, "additionalDistinctCorroborations": 0}, "Sample count differs")
    require(rows["source-page-match"]["candidateValue"] is False, "Candidate is not independently matched")
    relation = ledger["relation"]
    require(relation["independentlyMatchedVehicle"] is False and relation["independentlyMatchedProfile"] is False,
            "Unqualified relation changed")
    registry = read(ROOT / sources["registry"]["path"])
    profiles = registry["profiles"]
    enabled = [p for p in profiles if p["status"] == "enabled"]
    candidates = [p["profileId"] for p in profiles if p["status"] == "candidate"]
    require(len(enabled) == 5 and all(p["referenceOnly"] and p["binding"]["market"] == "US"
            and p["binding"]["steering"] == "LHD" for p in enabled), "Reference scope differs")
    require(candidates == ["UK-OBS-001", "UK-OBS-002"], "Candidate registry differs")
    require(all(p["profileId"] != "UK-OBS-004" for p in profiles), "Candidate unexpectedly registered")
    require(not any(p["binding"]["generation"] == "G61" for p in enabled), "Unexpected G61 profile")
    reference = next(p for p in enabled if p["profileId"] == "wby-i5-edrive40-sedan-my2026")
    require(reference["binding"]["generation"] == "G60" and reference["binding"]["body"] == "Sedan",
            "G60 reference boundary differs")
    require(registry["identityScope"] == "delivered-and-current-cars-only", "Identity scope differs")
    require(ledger["qualification"]["status"] == "unqualified", "Profile unexpectedly qualified")

    readme = (HERE / "README.md").read_text()
    links = re.findall(r"\[[^\]]+\]\(([^)]+)\)", readme)
    for target in links:
        require("://" not in target and not target.startswith("/"), "README links must be local")
        path = (HERE / target.split("#", 1)[0]).resolve()
        require(path.is_file() and ROOT in path.parents, f"Missing/unsafe README link: {target}")
    story = ROOT / "_dev/in-progress/DEV-2026-11-04-031.md"
    prefix = story.read_text().split("## Result", 1)[0]
    require(hashlib.sha256(prefix.encode()).hexdigest() == plan["storyPrefixSha256"],
            "Story outside Result changed")
    require(sum(p.stat().st_size for p in HERE.iterdir() if p.is_file()) < 1048576, "Output exceeds 1 MiB")
    owned = ("plan.json", "ledger.json", "schema.json", "README.md", "validate.py")
    print(json.dumps({"status": "pass", "scope": "artifact-only; no runtime/full/regression suite",
                      "rows": len(rows), "inputArtifacts": len(sources), "sourceLocators": locator_count,
                      "localReadmeLinks": len(links), "schemaNodesChecked": count[0],
                      "artifactsSha256": {n: sha(HERE / n) for n in owned},
                      "storySha256": sha(story), "networkRequests": 0, "profileActivations": 0},
                     sort_keys=True))


if __name__ == "__main__":
    main()
