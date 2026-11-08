#!/usr/bin/env python3
"""Offline, streaming selection audit. Source rows are referenced, never copied."""
import collections
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path('/Users/usget/Claude/vehicle-matcher')
OUT = Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f60-exact10000-retained-coverage-20261107')
AUDITS = ROOT / '.claude/f58-63-overnight-20261106/f58'
EXPECTED = {
    '8051': '27f64e520748836f9f88db39f15725e78daa535db9f253e1ae7b9772ad1f2991',
    '10351': '09ca95146b2ae87bb494d9f5bf3fccc12af69ba4cc68ed3d83b79965cd2df4bc',
}
CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def write(name, value):
    raw = canonical(value) + b'\n'
    path = OUT / name
    path.write_bytes(raw)
    return {'path': str(path), 'sha256': sha(raw), 'bytes': len(raw)}


def load_index(label):
    audit_path = AUDITS / ('global-union%s-parent-audit.json' % label)
    audit = json.loads(audit_path.read_bytes())
    pin = audit['canonicalPin']
    raw = Path(pin['path']).read_bytes()
    check(sha(raw) == pin['sha256'] == EXPECTED[label], 'canonical index pin ' + label)
    index = json.loads(raw)
    entries = {e['configurationId']: e for e in index['entries']
               if any(o['kind'] == 'admitted-source' for o in e['origins'])}
    check(len(entries) == int(label), 'admitted count ' + label)
    return entries, {'audit': {'path': str(audit_path), 'sha256': sha(audit_path.read_bytes())}, 'canonical': pin}


def fact(value):
    if not isinstance(value, dict):
        return {'state': 'unknown', 'value': None}
    return {'state': value.get('state', 'unknown'), 'value': value.get('value')}


def projection(row):
    catalogue = row.get('catalogue', {})
    binding = catalogue.get('sourceBinding', {})
    confirmed = binding.get('confirmedContext', {})
    scope = binding.get('requestScope', {})
    identity = row.get('canonicalIdentity', {})
    selection = binding.get('selection', {})
    options = identity.get('factoryOptionCodes', [])
    group = {
        'vgModelCode': identity.get('vgModelCode'), 'agModelCode': identity.get('agModelCode'),
        'rawModelRange': fact(confirmed.get('rawModelRange')),
        'market': scope.get('market'), 'locale': scope.get('locale'),
        'orderDate': fact(confirmed.get('orderDate')), 'effectDate': fact(confirmed.get('effectDate')),
        'taxDate': fact(confirmed.get('taxDate')), 'steeringLiteral': fact(confirmed.get('steeringLiteral')),
        'paint': fact(row.get('paint')), 'upholstery': fact(row.get('upholstery')),
        # A raw range code does not establish a body shape.
        'body': fact(binding.get('optionalFacts', {}).get('body')),
    }
    equipment = catalogue.get('equipment', {})
    stats = {
        'status': catalogue.get('status'), 'schemaVersion': catalogue.get('schemaVersion'),
        'observedDate': catalogue.get('observedDate'), 'retrievedDate': catalogue.get('retrievedDate'),
        'completeness': catalogue.get('completeness', {}),
        'factStates': {key: {'state': value.get('state'), 'definition': value.get('definition'),
                             'unit': value.get('unit'), 'completeness': value.get('completeness')}
                       for key, value in catalogue.get('facts', {}).items()},
        'equipmentStates': {key: value.get('state') for key, value in equipment.items() if isinstance(value, dict)},
        'optionalFactStates': {key: value.get('state') for key, value in binding.get('optionalFacts', {}).items()},
        'factoryOptionCount': len(options), 'selectedAccessoryCount': len(row.get('selectedAccessories', [])),
    }
    # These are bounded observed-category tokens, not inferred availability or body labels.
    ag = (identity.get('vgModelCode'), identity.get('agModelCode'))
    tokens = {canonical(['group', group]).decode()}
    for name, value in group.items():
        tokens.add(canonical(['dimension', name, value]).decode())
    for code in options:
        tokens.add(canonical(['model-ag-selected-factory-code', ag, code]).decode())
    for accessory in row.get('selectedAccessories', []):
        code = accessory.get('code') if isinstance(accessory, dict) else accessory
        tokens.add(canonical(['model-ag-selected-accessory-code', ag, code]).decode())
    return group, stats, tokens, {
        'sourceSchemaVersion': catalogue.get('schemaVersion'),
        'snapshotVersion': catalogue.get('snapshotVersion'),
        'bindingDigest': row.get('lookupIdentity', {}).get('bindingDigest'),
        'sourceCanonicalIdentityCanonicalJsonSha256': sha(canonical(identity)),
        'sourceCatalogueCanonicalJsonSha256': sha(canonical(catalogue)),
        'completeSelectedElementsCanonicalJsonSha256': sha(canonical(row.get('selectedElements'))),
        'sourceBindingSelectionCanonicalJsonSha256': sha(canonical(selection)),
    }


def histogram(rows, get):
    c = collections.Counter(canonical(get(r)).decode() for r in rows)
    return [{'value': json.loads(k), 'count': v} for k, v in sorted(c.items())]


def coverage(rows):
    values = list(rows)
    return {
        'configurations': len(values),
        'groups': histogram(values, lambda r: r['group']),
        'dimensions': {name: histogram(values, lambda r: r['group'].get(name)) for name in values[0]['group']},
        'catalogue': {name: histogram(values, lambda r: r['stats'].get(name)) for name in (
            'status', 'schemaVersion', 'observedDate', 'retrievedDate', 'completeness', 'factStates',
            'equipmentStates', 'optionalFactStates', 'selectedAccessoryCount')},
        'factoryOptionCount': {'minimum': min(r['stats']['factoryOptionCount'] for r in values),
                               'maximum': max(r['stats']['factoryOptionCount'] for r in values)},
        'observedCategoryTokens': len(set().union(*(r['tokens'] for r in values))),
    }


def main():
    check(OUT.parent.is_dir(), 'cloud output parent exists')
    OUT.mkdir(exist_ok=False)
    baseline, baseline_pin = load_index('8051')
    union, union_pin = load_index('10351')
    check(set(baseline) <= set(union), 'all baseline source ids in final union')
    origin_for = {}
    for config_id, entry in union.items():
        # Baseline origin wins; source alternatives never replace a baseline source pin.
        selected_entry = baseline.get(config_id, entry)
        candidates = sorted(o['path'] for o in selected_entry['origins'] if o['kind'] == 'admitted-source')
        p = Path(candidates[0])
        origin_for[config_id] = str(p if p.is_absolute() else ROOT / p)
    wanted_by_file = collections.defaultdict(set)
    for config_id, path in origin_for.items():
        wanted_by_file[path].add(config_id)
    file_pins = []
    rows = {}
    input_bytes = 0
    for file_index, (path, wanted) in enumerate(sorted(wanted_by_file.items())):
        p = Path(path)
        raw_hash = hashlib.sha256()
        offset = 0
        found = set()
        single_json = p.suffix == '.json'
        with p.open('rb') as stream:
            iterator = [stream.read()] if single_json else stream
            for line_number, raw in enumerate(iterator, 1):
                raw_hash.update(raw)
                if not raw.strip():
                    offset += len(raw)
                    continue
                row = json.loads(raw)
                config_id = row['configurationId']
                if config_id in wanted:
                    check(config_id not in found, 'unique row per source file')
                    check(row.get('admission') is True, 'source row admitted')
                    catalogue = row.get('catalogue', {})
                    binding = catalogue.get('sourceBinding', {})
                    identity = row.get('canonicalIdentity', {})
                    selection = binding.get('selection', {})
                    check(str(catalogue.get('schemaVersion')) == '2', 'source row schema2')
                    check(catalogue.get('requestedIdentity') == catalogue.get('resolvedIdentity'), 'no catalogue substitution')
                    check(catalogue.get('lookupIdentity') == catalogue.get('resolvedLookupIdentity'), 'no lookup substitution')
                    check(binding.get('canonicalIdentity') == identity, 'exact canonical source binding')
                    check(selection.get('factoryComplete') is True and selection.get('accessoryCodesComplete') is True,
                          'source complete selected factory/accessory codes')
                    check(selection.get('factoryOptionCodes') == identity.get('factoryOptionCodes'), 'full factory source selection')
                    check(selection.get('elements') == row.get('selectedElements'), 'full selected source elements')
                    check(catalogue.get('requestedIdentity', {}).get('configurationId') == config_id, 'exact requested configuration')
                    group, stats, tokens, pins = projection(row)
                    rows[config_id] = {'configurationId': config_id, 'configurationIdSha256': sha(config_id.encode()),
                        'baseline8051': config_id in baseline, 'sourceFileIndex': file_index,
                        'sourceLine': None if single_json else line_number, 'sourceJsonPointer': '$' if single_json else None,
                        'sourceByteOffset': offset, 'sourceByteLength': len(raw), 'sourceRowSha256': sha(raw),
                        **pins, 'group': group, 'stats': stats, 'tokens': tokens}
                    found.add(config_id)
                offset += len(raw)
        check(found == wanted, 'all canonical source rows located: ' + path)
        check(offset == p.stat().st_size, 'stream consumed exact source bytes')
        input_bytes += offset
        file_pins.append({'path': path, 'sha256': raw_hash.hexdigest(), 'bytes': offset,
                          'format': 'json' if single_json else 'jsonl'})
    check(set(rows) == set(union), 'streamed every admitted canonical id')
    image_code = (Path(__file__).resolve().parents[5] / 'server/gcsp/vehicle-evidence/registered-corpus-images.js').read_text()
    historical_id = re.search(r"const CONFIGURATION_ID = '([^']+)';", image_code).group(1)
    image_ids = [historical_id] + re.findall(r"configurationId: '([^']+)'", image_code)
    check(historical_id in baseline, 'historical candidate record is preserved baseline')
    selected = set(baseline)
    covered = set().union(*(rows[i]['tokens'] for i in selected))
    remaining = sorted(set(union) - selected, key=lambda i: (sha(i.encode()), i))
    novelty_picks = []
    while len(selected) < 10000:
        scores = [(len(rows[i]['tokens'] - covered), i) for i in remaining]
        best_score = max(score for score, _ in scores)
        if best_score == 0:
            break
        chosen = next(i for score, i in scores if score == best_score)
        novelty_picks.append({'configurationIdSha256': rows[chosen]['configurationIdSha256'],
                              'newObservedCategoryTokens': best_score})
        selected.add(chosen)
        covered.update(rows[chosen]['tokens'])
        remaining.remove(chosen)
    filler = 10000 - len(selected)
    selected.update(remaining[:filler])
    check(len(selected) == 10000, 'exact10000 selected')
    check(set(baseline) <= selected, 'baseline8051 preserved')
    check(len(selected - set(baseline)) == 1949, 'exact1949 additions')
    check(len(set(union) - selected) == 351, 'exact351 retained surplus')
    all_tokens = set().union(*(r['tokens'] for r in rows.values()))
    selected_tokens = set().union(*(rows[i]['tokens'] for i in selected))
    check(selected_tokens == all_tokens, 'all declared observed category tokens preserved')
    group_values = sorted({canonical(r['group']).decode() for r in rows.values()})
    group_index = {group: i for i, group in enumerate(group_values)}
    entries = []
    for config_id in sorted(selected):
        r = rows[config_id]
        entries.append({k: v for k, v in r.items() if k not in ('tokens', 'stats', 'group')} | {
            'historicalCandidateRecord': config_id == historical_id,
            'strictV2CandidateRecord': config_id != historical_id,
            'coverageGroupIndex': group_index[canonical(r['group']).decode()]})
    addition_shards = []
    combined_additions = hashlib.sha256()
    shard_hash = hashlib.sha256()
    shard_ids = []
    shard_bytes = 0
    def close_shard():
        nonlocal shard_hash, shard_ids, shard_bytes
        if not shard_ids:
            return
        addition_shards.append({'filename': 'global-union1949-part%02d-2026-11-07-12.jsonl' % (len(addition_shards) + 1),
            'rows': len(shard_ids), 'bytes': shard_bytes, 'sha256': shard_hash.hexdigest(),
            'configurationIdsCanonicalJsonSha256': sha(canonical(shard_ids)),
            'configurationIdSha256InOrder': [sha(i.encode()) for i in shard_ids]})
        shard_hash = hashlib.sha256()
        shard_ids = []
        shard_bytes = 0
    addition_read_bytes = 0
    for config_id in sorted(selected - set(baseline)):
        r = rows[config_id]
        pin = file_pins[r['sourceFileIndex']]
        check(pin['format'] == 'jsonl', 'addition is exact JSONL')
        with Path(pin['path']).open('rb') as stream:
            stream.seek(r['sourceByteOffset'])
            raw = stream.read(r['sourceByteLength'])
        check(sha(raw) == r['sourceRowSha256'], 'addition byte range unchanged')
        check(raw.endswith(b'\n') and raw.count(b'\n') == 1, 'addition exact one-line framing')
        if shard_bytes + len(raw) > 32 * 1024 ** 2:
            close_shard()
        shard_ids.append(config_id)
        shard_hash.update(raw)
        combined_additions.update(raw)
        shard_bytes += len(raw)
        addition_read_bytes += len(raw)
    close_shard()
    check(sum(s['rows'] for s in addition_shards) == 1949, 'all additions in planned shards')
    check(all(s['bytes'] <= 32 * 1024 ** 2 for s in addition_shards), 'bounded32MiB shards')
    manifest = write('selection-manifest.json', {
        'schemaVersion': 'gcsp-f60-retained-selection.v1', 'status': 'sealed-offline-selection',
        'sourceCalls': 0, 'testReplays': 0, 'sourceAcceptance': False,
        'inputs': {'baseline8051': baseline_pin, 'final10351': union_pin},
        'counts': {'selectedSource': 10000, 'preservedBaselineSource': 8051, 'newSource': 1949,
                   'strictV2CandidateRecords': 9999, 'historicalCandidateRecords': 1, 'surplusSource': 351},
        'method': {'order': ['all8051 baseline ids', 'greedy maximum newly represented observed categories',
                             'ascending sha256(configurationId), then configurationId'],
                   'noveltyPicks': novelty_picks, 'hashOrderedFiller': filler,
                   'tokens': ['exact source model/AG/context/paint/upholstery/body-state group',
                              'individual source dimension values including unknowns',
                              'selected factory/accessory code within source model/AG'],
                   'noInference': ['body from range', 'availability', 'policy or scheme coverage',
                                   'VIN/stock identity', 'image fidelity from requested options']},
        'digestMeaning': {'sourceRowSha256': 'exact raw JSONL line including newline; full file for JSON',
                          'CanonicalJsonSha256': 'UTF8 JSON, sorted keys, compact separators, Unicode unescaped'},
        'additionShards': {'status': 'metadata-only-no-raw-shards-written', 'order': 'ascending configurationId',
            'combinedBytesSha256': combined_additions.hexdigest(), 'bytes': addition_read_bytes,
            'rows': 1949, 'maximumShardBytes': 32 * 1024 ** 2, 'shards': addition_shards},
        'sourceFiles': file_pins, 'coverageGroups': [json.loads(s) for s in group_values], 'entries': entries,
    })
    coverage_pin = write('coverage.json', {
        'schemaVersion': 'gcsp-f60-retained-coverage.v1', 'manifest': manifest,
        'baseline8051': coverage(rows[i] for i in baseline), 'final10351': coverage(rows.values()),
        'selected10000': coverage(rows[i] for i in selected),
        'surplus351': coverage(rows[i] for i in set(union) - selected),
        'categoryPreservation': {'allDeclaredObservedTokensPreserved': True, 'tokens': len(all_tokens)},
        'registeredImageAssociations': [
            {'configurationId': i, 'configurationIdSha256': sha(i.encode()), 'baseline8051': i in baseline,
             'selected10000': i in selected, 'kind': 'exact-code-owned-association',
             'view': 'HEROFRONT', 'width': 2560, 'height': 1646, 'contentType': 'image/webp',
             'fidelity': {'model': 'observed' if i == historical_id else 'unknown',
                          'paint': 'observed' if i == historical_id else 'unknown',
                          'wheels': 'unknown', 'interior': 'unknown', 'equipment': 'unknown', 'exactVehicle': 'unknown'}}
            for i in image_ids],
        'boundary': {'body': 'Unknown unless explicitly evidenced; rawModelRange is retained separately.',
                     'technical': 'Immutable accepted catalogues only; separately qualified OTD pilot is not broadcast.',
                     'images': 'Exact code-owned associations only; validation evidence reused, no image revalidation replay.',
                     'profileAndWmi': 'F58 profile and WMI gaps remain unresolved.'},
    })
    write('selection-receipt.json', {'status': 'complete-scoped-offline-audit', 'checks': CHECKS,
        'errors': [], 'sourceCalls': 0, 'testReplays': 0, 'rawSourceCopies': 0,
        'sourceFilesRead': len(file_pins), 'sourceBytesRead': input_bytes,
        'selectedAdditionByteRangesRead': 1949, 'selectedAdditionBytesRead': addition_read_bytes,
        'selectedManifest': manifest, 'coverage': coverage_pin,
        'counts': {'selectedSource': 10000, 'baseline': 8051, 'additions': 1949, 'surplus': 351},
        'sourceAcceptance': False, 'f60Acceptance': False})
    print(json.dumps({'status': 'sealed', 'checks': CHECKS, 'manifest': manifest,
                      'coverage': coverage_pin, 'noveltyPicks': len(novelty_picks), 'hashFiller': filler}))


if __name__ == '__main__':
    main()
