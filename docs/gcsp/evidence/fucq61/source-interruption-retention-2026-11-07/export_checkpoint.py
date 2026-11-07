"""Export the retained primary after a stopped/joined source child; never delete it."""
import hashlib, json, os, pathlib, re, stat, sys

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

def export(directory):
    directory = pathlib.Path(directory).resolve(strict=True)
    primary = directory / "collector-checkpoint.json"
    info = primary.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 16777216:
        raise ValueError("retained-checkpoint-not-bounded-regular-file")
    raw = primary.read_bytes()
    envelope = json.loads(raw)
    if envelope.get("schemaVersion") != "1" or digest(envelope["content"]) != envelope.get("contentDigest"):
        raise ValueError("retained-checkpoint-integrity")
    state = envelope["content"]
    def retain(relative, data):
        target = directory / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with target.open("xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError:
            if not target.is_file() or target.is_symlink() or target.read_bytes() != data:
                raise ValueError("retained-export-conflict:" + str(relative))
    retain("collector-state.json", raw)
    if state.get("batchEvidence"):
        for name in ("tree", "options"):
            artifact = state["batchEvidence"][name]
            data = encoded(artifact["document"])
            if hashlib.sha256(data).hexdigest() != artifact["sha256"] or len(data) != artifact["bytes"]:
                raise ValueError("retained-source-artifact-integrity")
            retain(name + ".json", data)
    for row in state.get("sourceCaptures", []):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,95}", row["candidateId"]):
            raise ValueError("retained-source-candidate-identity")
        artifact = row["solver"]
        data = encoded(artifact["document"])
        if hashlib.sha256(data).hexdigest() != artifact["sha256"] or len(data) != artifact["bytes"]:
            raise ValueError("retained-solver-artifact-integrity")
        retain("solver/" + row["candidateId"] + ".json", data)
    retain("accepted.jsonl", b"".join(encoded(row) for row in state.get("accepted", [])))
    summary = {"status": "exported", "checkpointSha256": hashlib.sha256(raw).hexdigest(),
               "primaryRetained": str(primary), "accepted": len(state.get("accepted", [])),
               "sourceCaptures": len(state.get("sourceCaptures", [])), "cursor": state.get("cursor"),
               "sourceBindingSemantics": "requires-source-binder-verification; hashes-only-export"}
    retain("checkpoint-export.json", encoded(summary))
    return summary

if __name__ == "__main__":
    try:
        print(json.dumps(export(sys.argv[1])))
    except Exception as error:
        destination = pathlib.Path(sys.argv[1]) / "checkpoint-export-failure.json"
        if not destination.exists():
            with destination.open("x") as stream:
                json.dump({"issue": "retained-checkpoint-export-failed", "errorType": type(error).__name__,
                           "primaryPreserved": True}, stream)
        raise
