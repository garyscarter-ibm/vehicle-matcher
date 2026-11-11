#!/usr/bin/env python3
"""Seed selected-code labels from retained option reports, without fetching or changing a corpus."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(root):
    store = root / "server/data/gcsp/vehicle-evidence/demo-fleet.v1"
    pointer = json.loads((store / "active.json").read_text())["selected"]
    directory = store / "versions" / pointer["directory"]
    corpus = directory / "configurations.jsonl"
    needed = defaultdict(set)
    applicability = defaultdict(lambda: {"generations": set(), "agModelCodes": set()})
    population = []
    for line in corpus.open():
        row = json.loads(line)
        urls = [url for url in row["sourceContext"]["sourceRefs"] if "/options/languages/" in url]
        population.append((row, urls[0] if len(urls) == 1 else None))
        if len(urls) != 1:
            continue
        url = urls[0]
        needed[url].update(row["catalogue"]["equipment"]["selected"]["options"])
        applicability[url]["generations"].add(row["configuration"]["generation"])
        applicability[url]["agModelCodes"].add(row["configuration"]["agModelCode"])
    reports = defaultdict(list)
    for path in sorted((root / "docs/gcsp/evidence").rglob("options.json")):
        report = json.loads(path.read_text())
        url = report.get("observation", {}).get("request", {}).get("url")
        if url in needed:
            reports[url].append((path, report))
    variants = []
    for url, codes in sorted(needed.items()):
        definitions = defaultdict(dict)
        sources = []
        for path, report in reports[url]:
            observation = report["observation"]
            source_id = len(sources)
            sources.append({"path": str(path.relative_to(root)), "sha256": digest(path),
                            "responseSha256": observation["responseSha256"],
                            "observedDate": observation["observedAt"][:10]})
            for candidate in report.get("report", {}).get("candidates", []):
                for definition in candidate.get("definitions", []):
                    code = definition.get("code")
                    label = " ".join(definition.get("longDescription", "").split())
                    category = definition.get("optionType")
                    if code not in codes or not label or not category or definition.get("issues"):
                        continue
                    key = (label, category)
                    definitions[code].setdefault(key, []).append(source_id)
        parsed = urlparse(url)
        parts = parsed.path.split("/")
        after = lambda key: parts[parts.index(key) + 1]
        variant = {"source": url, "market": after("countries").upper(),
                   "vgModelCode": after("models"), "orderDate": after("order-dates"),
                   "effectDate": after("effect-dates"), "trim": parse_qs(parsed.query).get("trim", [None])[0],
                   **{key: sorted(value) for key, value in applicability[url].items()},
                   "sources": sources, "definitions": {}}
        for code in sorted(codes):
            choices = definitions[code]
            variant["definitions"][code] = {"state": "known" if len(choices) == 1 else "unknown",
                "reason": None if len(choices) == 1 else "ambiguous-definition" if choices else "definition-unavailable",
                "candidates": [{"label": label, "category": category, "sources": indexes}
                               for (label, category), indexes in sorted(choices.items())]}
        variants.append(variant)
    by_source = {variant["source"]: variant for variant in variants}
    unresolved = defaultdict(int)
    selected_count = resolved_count = fully_resolved = matched = 0
    for row, url in population:
        variant = by_source.get(url)
        selected = row["catalogue"]["equipment"]["selected"]
        codes = selected.get("options") or []
        selected_count += len(codes)
        resolved = 0
        if variant and variant["sources"]:
            matched += 1
        for code in codes:
            definition = variant and variant["definitions"].get(code)
            if definition and definition["state"] == "known":
                resolved += 1
            else:
                unresolved[code] += 1
        resolved_count += resolved
        fully_resolved += bool(codes) and resolved == len(codes)
    return {"schemaVersion": "1", "version": "configuration-definitions-2026-11-11.v1",
        "createdDate": "2026-11-11", "sourceKind": "retained-bmw-uk-options",
        "population": {"datasetId": json.loads((directory / "manifest.json").read_text())["datasetId"],
            "manifestDigest": pointer["manifestDigest"], "configurationSha256": digest(corpus),
            "configurations": len(population), "matchedConfigurations": matched,
            "fullyLabelledConfigurations": fully_resolved, "selectedCodes": selected_count,
            "resolvedCodes": resolved_count, "unresolvedCodes": dict(sorted(unresolved.items()))},
        "gaps": ["Labels describe selected catalogue configuration, not verified physical-car fitment.",
                 "Only retained reports with the same market, model, dates and trim source are joined.",
                 "Availability, unselected equipment and accessory quantities are not inferred.",
                 "Retained reports contain no supported swatch colours; swatches remain unknown.",
                 "Unknown and conflicting labels remain unknown; no cross-variant fallback is used."],
        "variants": variants}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    target = args.output or args.root / "server/data/gcsp/vehicle-evidence/configuration-definitions.v1.json"
    data = build(args.root.resolve())
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"path": str(target), "sha256": digest(target), "bytes": target.stat().st_size,
                      "population": data["population"]}))
