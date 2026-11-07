#!/usr/bin/env python3
"""Project durable work facts into a dependency-free, static product map.

Only JSON is collected from other refs. Run this trusted copy, never scripts
from an unmerged branch. Python standard library, compatible with Python 3.9.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

VERSION = 1
REFERENCE_TRANSACTION_HOOK = 1
LIMIT = 4 * 1024 * 1024
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
STATES = {'complete': 1, 'in-progress': .5, 'blocked': 0, 'not-started': 0}
STATUS = {'to do': 'developing', 'todo': 'developing', 'backlog': 'developing',
          'not started': 'developing', 'in progress': 'developing', 'developing': 'developing',
          'blocked': 'developing', 'in review': 'review', 'review': 'review',
          'done': 'accepted', 'completed': 'accepted', 'accepted': 'accepted',
          'rejected': 'removed', 'removed': 'removed', 'cancelled': 'removed', 'canceled': 'removed'}
LABELS = {'developing': 'In development', 'review': 'Development complete · awaiting acceptance',
          'accepted': 'Accepted', 'unknown': 'Incomplete progress data',
          'removed': 'Removed from scope', 'empty': 'No planned stories'}


class Error(Exception):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else None
    except ValueError:
        return None


def text(value, maximum=2000):
    return value[:maximum] if isinstance(value, str) else ''


def url(value):
    value = text(value)
    try:
        p = urlsplit(value)
        return value if p.scheme in ('https', 'http') and p.hostname and not p.username and not p.password else ''
    except ValueError:
        return ''


def percentage(value):
    if value is None:
        return 'Unknown'
    # Round for display, but keep genuinely incomplete values below 100%.
    shown = round(max(0, min(value, 100)), 1)
    if value < 100:
        shown = min(shown, 99.9)
    return ('%g' % shown) + '%'


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key: ' + key)
        result[key] = value
    return result


def decode(raw):
    if len(raw) > LIMIT:
        raise ValueError('source exceeds 4 MiB limit')
    value = json.loads(raw, object_pairs_hook=unique_pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON number')))
    if not isinstance(value, dict) or value.get('version') != VERSION:
        raise ValueError('expected a version 1 JSON object')
    return value


def read(path):
    with Path(path).open('rb') as f:
        return decode(f.read(LIMIT + 1))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Reject symlinks: atomic replacement must not conceal an unexpected target.
    if path.is_symlink():
        raise Error('refusing to replace symlink: ' + str(path))
    import tempfile
    fd, temp = tempfile.mkstemp(prefix='.' + path.name + '-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write('\n')
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def story_progress(story):
    """Development and acceptance are separate; unknown never masquerades as zero."""
    state = STATUS.get(text(story.get('status')).strip().lower(), 'unknown')
    slices = story.get('slices')
    counts = dict.fromkeys(('complete', 'in_progress', 'blocked', 'not_started', 'unknown', 'total'), 0)
    invalid = False
    if isinstance(slices, list):
        seen = set()
        for item in slices:
            if not isinstance(item, dict) or not ID.fullmatch(text(item.get('id'))):
                invalid = True
                counts['unknown'] += 1
                counts['total'] += 1
                continue
            if item['id'] in seen:
                invalid = True
                continue
            seen.add(item['id'])
            status = item.get('status')
            key = status.replace('-', '_') if isinstance(status, str) and status in STATES else 'unknown'
            counts[key] += 1
            counts['total'] += 1
    result = {'progress': None, 'lower_bound': 0, 'state': state, 'slice_counts': counts,
              'status_label': LABELS[state]}
    if story.get('conflict'):
        result['state'] = 'unknown'
    elif state in ('review', 'accepted'):
        result['progress'] = 100
    elif state == 'removed':
        pass
    elif state != 'unknown' and not invalid:
        if counts['total'] and not counts['unknown']:
            result['progress'] = 100 * (counts['complete'] + .5 * counts['in_progress']) / counts['total']
            if result['progress'] == 100:
                result['state'] = 'review'
                result['status_label'] = 'Awaiting story review transition'
        elif story.get('unsliced') is True and not counts['total']:
            result['progress'] = 0
        else:
            result['state'] = 'unknown'
    else:
        result['state'] = 'unknown'
    if result['progress'] is None and result['state'] not in ('removed',):
        result['status_label'] = LABELS['unknown']
        if counts['total'] and not invalid and not story.get('conflict'):
            result['lower_bound'] = 100 * (counts['complete'] + .5 * counts['in_progress']) / counts['total']
    elif result['progress'] is not None:
        result['lower_bound'] = result['progress']
    result['progress_label'] = percentage(result['progress'])
    return result


def worker(row, clock):
    if not isinstance(row, dict) or not text(row.get('name')):
        return None
    observed, expires = timestamp(row.get('observed_at')), timestamp(row.get('expires_at'))
    return {'name': text(row.get('name'), 200), 'harness': text(row.get('harness'), 40),
            'role': text(row.get('role'), 100), 'observed_at': text(row.get('observed_at'), 50),
            'expires_at': text(row.get('expires_at'), 50), 'source': text(row.get('source'), 200),
            'active': bool(observed and expires and observed <= clock < expires),
            'status': text(row.get('status'), 100)}


def normal_story(row, clock):
    result = {key: text(row.get(key), 2000 if key == 'title' else 300)
              for key in ('id', 'title', 'status', 'original_status', 'assignee', 'observed_at', 'branch', 'type')}
    result.update({key: url(row.get(key)) for key in ('url', 'pr')})
    result['sources'] = row.get('_sources', [])
    result['conflict'] = bool(row.get('conflict'))
    result['historical'] = bool(row.get('historical'))
    result['unsliced'] = row.get('unsliced') is True
    result['slices'] = [{key: text(s.get(key), 500) for key in ('id', 'title', 'status', 'evidence', 'observed_at')}
                        for s in row.get('slices', []) if isinstance(s, dict)] if isinstance(row.get('slices'), list) else []
    result['workers'] = [w for w in (worker(s, clock) for s in row.get('workers', []) if isinstance(row.get('workers'), list)) if w] if isinstance(row.get('workers', []), list) else []
    result.update(story_progress(row))
    if result['state'] in ('accepted', 'removed') or result['historical']:
        for w in result['workers']:
            w['active'] = False
    return result


def git(root, *args, check=False):
    p = subprocess.run(['git', *args], cwd=str(root), capture_output=True, timeout=30)
    if check and p.returncode:
        raise Error('git ' + args[0] + ' failed')
    return p.stdout.decode('utf-8', 'replace').strip() if p.returncode == 0 else None


def branch_blob(root, sha, path):
    size = git(root, 'cat-file', '-s', sha + ':' + path)
    if size is None:
        return None
    if int(size) > LIMIT:
        raise ValueError('branch source exceeds 4 MiB limit')
    raw = git(root, 'show', sha + ':' + path, check=True)
    return decode(raw)


def publication_settings(root):
    try:
        settings = read(Path(root) / '.claude/scaffolding.json').get('product_map', {}).get('publish', {})
        return settings if isinstance(settings, dict) else {}
    except (OSError, ValueError, AttributeError):
        return {}


def collect(root, include_branches, diagnostics, staged=False, revision=None):
    """Baseline plus only divergent active refs; never run their code."""
    head = git(root, 'rev-parse', '--verify', 'HEAD')
    current = git(root, 'symbolic-ref', '--short', 'HEAD') or 'detached'
    remote = text(publication_settings(root).get('remote')) or 'origin'
    base_ref = git(root, 'symbolic-ref', '--short', 'refs/remotes/' + remote + '/HEAD')
    if not base_ref:
        base_ref = 'main' if git(root, 'rev-parse', '--verify', 'main') else current
    base = git(root, 'rev-parse', '--verify', base_ref) if head else None
    refs = [('baseline', base_ref, base)] if base else []
    if include_branches and head:
        lines = (git(root, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads', 'refs/remotes/' + remote) or '').splitlines()
        seen = {base, head}
        for line in lines:
            ref, sha = line.rsplit(' ', 1)
            if sha in seen or ref.endswith('/HEAD') or ref.rsplit('/', 1)[-1] in ('gh-pages', 'product-map-pages'):
                continue
            # Refs already merged into the baseline cannot resurrect old work.
            if git(root, 'merge-base', '--is-ancestor', sha, base or head) is not None:
                continue
            seen.add(sha)
            refs.append(('branch', ref, sha))
    refs.append(('working', current, head))
    records, sources = [], []
    for kind, ref, sha in refs:
        for filename, key in [('components.json', 'components'), ('work.json', 'stories')]:
            path = '.product-map/' + filename
            source = {'path': path, 'branch': ref, 'sha': sha, 'kind': kind, 'parsed': 0, 'rejected': 0}
            try:
                if kind == 'working' and revision:
                    value = branch_blob(root, revision, path)
                    source.update(kind='committed', sha=git(root, 'rev-parse', revision))
                elif kind == 'working' and staged:
                    value = branch_blob(root, '', path)
                    source.update(kind='index', sha=git(root, 'rev-parse', ':' + path))
                else:
                    if kind == 'working' and any(p.is_symlink() for p in (root / '.product-map', root / path)):
                        raise ValueError('source symlinks are not supported')
                    value = read(root / path) if kind == 'working' else branch_blob(root, sha, path)
                if value is None:
                    continue
                source['observed_at'] = text(value.get('observed_at'), 50)
                rows = value.get(key)
                if not isinstance(rows, list) or len(rows) > 5000:
                    raise ValueError(key + ' must be an array of at most 5000 rows')
                accepted, seen = [], set()
                for row in rows:
                    if not isinstance(row, dict) or not ID.fullmatch(text(row.get('id'))) or row['id'] in seen:
                        source['rejected'] += 1
                        continue
                    seen.add(row['id'])
                    row = copy.deepcopy(row)
                    if key == 'stories':
                        row.setdefault('observed_at', source['observed_at'])
                    accepted.append(row)
                source['parsed'] = len(accepted)
                # Compare branch records with their own fork point, not today's
                # default branch. A stale copied file is not a work update.
                ancestor = git(root, 'merge-base', sha, base) if sha and base else None
                if kind != 'baseline' and ancestor and ancestor != base:
                    old_doc = branch_blob(root, ancestor, path) or {}
                    old_rows = {r['id']: r for r in old_doc.get(key, []) if isinstance(r, dict) and isinstance(r.get('id'), str)}
                    if key == 'stories':
                        for old_row in old_rows.values():
                            old_row.setdefault('observed_at', text(old_doc.get('observed_at'), 50))
                    baseline_rows = {r['id']: r for k, rk, rr, _, _ in records if k == 'baseline' and rk == key for r in rr}
                    changed = []
                    for row in accepted:
                        old = old_rows.get(row['id'])
                        if fingerprint(row) == fingerprint(old):
                            continue
                        main_row = baseline_rows.get(row['id'])
                        if main_row != old and main_row != row:
                            source.setdefault('conflicts', []).append(row['id'])
                        changed.append(row)
                    accepted = changed
                records.append((kind, key, accepted, source, value.get('project', {})))
                if source['rejected']:
                    diagnostics.append('%s (%s): rejected %d malformed or duplicate rows' % (path, ref, source['rejected']))
            except (OSError, ValueError, Error) as error:
                detail = type(error).__name__ if isinstance(error, OSError) else str(error)
                source['error'] = detail
                diagnostics.append('%s (%s): %s' % (path, ref, detail))
            sources.append(source)
    return records, sources


def fingerprint(row):
    return json.dumps(row, sort_keys=True, separators=(',', ':'))


def merge_records(records, key, diagnostics):
    baseline, variants, origins, changed_origins = {}, {}, {}, {}
    for kind, record_key, rows, source, _ in records:
        if record_key != key:
            continue
        if kind == 'baseline':
            baseline = {r['id']: r for r in rows}
            origins.update({r['id']: [source] for r in rows})
            continue
        for row in rows:
            identity = row['id']
            origins.setdefault(identity, []).append(source)
            if identity not in baseline or fingerprint(row) != fingerprint(baseline[identity]):
                variants.setdefault(identity, {})[fingerprint(row)] = row
                changed_origins.setdefault(identity, []).append(source)
    result = []
    for identity in sorted(set(baseline) | set(variants)):
        choices = list(variants.get(identity, {}).values())
        row = copy.deepcopy(choices[0] if choices else baseline[identity])
        if len(choices) > 1 or any(identity in s.get('conflicts', []) for s in origins.get(identity, [])):
            row['conflict'] = True
            diagnostics.append('%s %s: conflicting active-branch facts; reconcile the records' % (key, identity))
        row['_sources'] = [{k: s.get(k) for k in ('branch', 'sha', 'path', 'observed_at')} for s in origins.get(identity, [])]
        if choices:
            row.setdefault('branch', changed_origins[identity][0]['branch'])
        result.append(row)
    return result


def project(root, include_branches=True, staged=False, revision=None):
    root = Path(root).resolve()
    diagnostics = []
    records, sources = collect(root, include_branches, diagnostics, staged, revision)
    clock = dt.datetime.now(dt.timezone.utc)
    stories = [normal_story(r, clock) for r in merge_records(records, 'stories', diagnostics)]
    if any(s.get('error') and s['path'].endswith('work.json') and s['kind'] in ('working', 'index', 'committed') for s in sources):
        for story in stories:
            story['historical'] = True
            for claim in story['workers']:
                claim['active'] = False
    by_id = {s['id']: s for s in stories}
    components = []
    for row in merge_records(records, 'components', diagnostics):
        problems = []
        ids = row.get('stories', [])
        invalid_scope = not isinstance(ids, list)
        if not isinstance(ids, list):
            ids = []
            problems.append('Story associations must be an array')
        elif any(not isinstance(i, str) or not ID.fullmatch(i) for i in ids):
            invalid_scope = True
            problems.append('Rejected malformed story association')
        linked = []
        for identity in dict.fromkeys(i for i in ids if isinstance(i, str) and ID.fullmatch(i)):
            if identity not in by_id:
                problems.append('Missing story ' + identity)
                linked.append(normal_story({'id': identity, 'title': identity}, clock))
            else:
                linked.append(by_id[identity])
        scoped = [s for s in linked if s['state'] != 'removed']
        unknown = sum(s['progress'] is None for s in scoped)
        lower = sum(s['lower_bound'] for s in scoped) / len(scoped) if scoped else 0
        progress = lower if scoped and not unknown and not row.get('conflict') and not invalid_scope else None
        state = ('unknown' if invalid_scope or row.get('conflict') else 'empty' if not scoped else 'unknown' if progress is None else
                 'accepted' if all(s['state'] == 'accepted' for s in scoped) else
                 'review' if progress == 100 else 'developing')
        connections = []
        for edge in row.get('connections', []) if isinstance(row.get('connections', []), list) else []:
            if isinstance(edge, dict) and ID.fullmatch(text(edge.get('to'))):
                connections.append({'to': edge['to'], 'label': text(edge.get('label'), 300)})
            else:
                problems.append('Rejected malformed connection')
        components.append({'id': row['id'], 'name': text(row.get('name')) or row['id'],
                           'description': text(row.get('description')), 'connections': connections,
                           'paths': [text(p) for p in row.get('paths', []) if isinstance(p, str)] if isinstance(row.get('paths', []), list) else [],
                           'stories': linked, 'progress': progress, 'lower_bound': lower,
                           'progress_label': ((('≥ ' + percentage(lower)) if lower else 'Unknown') + ' · %d unknown' % unknown) if unknown else percentage(progress),
                           'state': state, 'status_label': LABELS[state], 'unknown': unknown,
                           'accepted': sum(s['state'] == 'accepted' for s in scoped), 'total': len(scoped),
                           'developed': sum(s['progress'] == 100 for s in scoped),
                           'workers': [w for s in scoped for w in s['workers']],
                           'diagnostics': problems, 'sources': row['_sources'],
                           'conflict': bool(row.get('conflict')), 'branch': text(row.get('branch'))})
        components[-1]['references'] = [
            {key: by_id[identity].get(key, '') for key in ('id', 'title', 'type', 'status', 'url')}
            for identity in (row.get('references') if isinstance(row.get('references'), list) else [])
            if isinstance(identity, str) and identity in by_id]
    known = {c['id'] for c in components}
    for c in components:
        for edge in c['connections']:
            if edge['to'] not in known:
                c['diagnostics'].append('Connection target missing: ' + edge['to'])
    project_data = next((p for _, k, _, _, p in reversed(records) if k == 'components' and isinstance(p, dict)), {})
    observations = [s['observed_at'] for s in sources if timestamp(s.get('observed_at'))]
    refs = {}
    remote = text(publication_settings(root).get('remote')) or 'origin'
    prefix = 'refs/remotes/' + remote + '/'
    for line in (git(root, 'for-each-ref', '--format=%(refname) %(objectname)', prefix) or '').splitlines():
        ref, sha = line.rsplit(' ', 1)
        branch = ref[len(prefix):]
        if branch not in ('HEAD', 'gh-pages', 'product-map-pages'):
            refs[branch] = sha
    return {'version': VERSION, 'project': {'name': text(project_data.get('name')) or root.name},
            'generated_at': now(), 'observed_at': min(observations) if observations else None,
            'sources': sources, 'ref_remote': remote, 'ref_snapshot': refs, 'diagnostics': diagnostics, 'stories': stories, 'components': components}


def build(root, output, include_branches=True, staged=False, revision=None):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    assets = Path(__file__).resolve().with_name('product_map_assets')
    for name in ('index.html', 'map.css', 'map.js', 'plex-sans-regular.woff2',
                 'plex-sans-semibold.woff2', 'LICENSE-plex.txt', 'LICENSE-carbon.txt'):
        if (output / name).is_symlink():
            raise Error('refusing symlink output: ' + name)
        shutil.copyfile(assets / name, output / name)
    data = project(root, include_branches, staged, revision)
    write(output / 'data.json', data)
    # data.js permits file:// previews. Escape script delimiters and JS line separators.
    encoded = json.dumps(data, ensure_ascii=True, allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    target = output / 'data.js'
    if target.is_symlink():
        raise Error('refusing symlink output: data.js')
    target.write_text('window.PRODUCT_MAP_DATA = ' + encoded + ';\n', encoding='utf-8')
    return data


def init(root):
    root = Path(root)
    for name, data in [('components', {'version': VERSION, 'project': {'name': root.name}, 'components': []}),
                       ('work', {'version': VERSION, 'observed_at': now(), 'stories': []})]:
        path = root / '.product-map' / (name + '.json')
        if not path.exists():
            write(path, data)


def import_jira(root, payload):
    """Import a minimal allowlist, preserving local slice plans and worker claims."""
    issues = payload.get('issues') if isinstance(payload, dict) else None
    if not isinstance(issues, list):
        raise Error('Jira export must contain an issues array')
    path = Path(root) / '.product-map/work.json'
    work = read(path)
    rows = {s['id']: s for s in work['stories'] if isinstance(s, dict) and 'id' in s}
    observed = now()
    try:
        tracker = read(Path(root) / '.claude/scaffolding.json').get('backlog', {})
    except (OSError, ValueError):
        tracker = {}
    mapping = []
    for canonical, value in tracker.get('statuses', {}).items():
        rule = {'status': value} if isinstance(value, str) else value
        if isinstance(rule, dict) and isinstance(rule.get('status'), str):
            mapping.append((canonical, rule))
    for issue in issues:
        if not isinstance(issue, dict) or not ID.fullmatch(text(issue.get('key'))):
            raise Error('invalid Jira issue key')
        fields = issue.get('fields', {})
        if not isinstance(fields, dict):
            raise Error('invalid Jira fields')
        key = issue['key']
        row = rows.setdefault(key, {'id': key})
        def named(name, field):
            value = fields.get(name)
            return text(value.get(field)) if isinstance(value, dict) else ''
        original = named('status', 'name')
        labels = fields.get('labels', [])
        labels = labels if isinstance(labels, list) else []
        matches = [(canonical, rule) for canonical, rule in mapping
                   if rule['status'] == original and (not rule.get('label') or rule['label'] in labels)]
        # A label-qualified status wins over its unqualified terminal status.
        qualified = [canonical for canonical, rule in matches if rule.get('label')]
        choices = qualified or [canonical for canonical, _ in matches]
        status = choices[0] if len(choices) == 1 else 'Unknown' if choices else original
        row.update(title=text(fields.get('summary')), status=status, original_status=original,
                   assignee=named('assignee', 'displayName'), type=named('issuetype', 'name'), observed_at=observed,
                   url=url(issue.get('url')) or url('https://' + text(tracker.get('site')) + '/browse/' + key))
    work.update(stories=list(rows.values()), observed_at=observed)
    write(path, work)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=Path.cwd())
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('init')
    b = sub.add_parser('build'); b.add_argument('--output', type=Path, required=True); b.add_argument('--no-branches', action='store_true')
    sub.add_parser('snapshot')
    j = sub.add_parser('import-jira'); j.add_argument('--issues', type=Path, required=True)
    s = sub.add_parser('story'); s.add_argument('--file', type=Path, required=True)
    plan = sub.add_parser('plan'); plan.add_argument('--story', required=True); plan.add_argument('--slice', action='append', required=True)
    sl = sub.add_parser('slice'); sl.add_argument('--story', required=True); sl.add_argument('--slice', required=True); sl.add_argument('--status', choices=list(STATES), required=True); sl.add_argument('--evidence')
    publication = sub.add_parser('configure-publish')
    publication.add_argument('--mode', choices=('static-main', 'actions'), required=True)
    publication.add_argument('--site-dir', default='docs')
    publication.add_argument('--branch', default='gh-pages')
    publication.add_argument('--remote', default='origin')
    hook = sub.add_parser('hook'); hook.add_argument('--event', choices=('pre-commit', 'pre-merge-commit', 'post-merge', 'reference-transaction'), required=True)
    hook.add_argument('--squash', choices=('0', '1'), default='0')
    hook.add_argument('--hook-args', nargs=argparse.REMAINDER, default=[])
    publish = sub.add_parser('publish'); publish.add_argument('--output', type=Path, required=True); publish.add_argument('--branch', default='gh-pages'); publish.add_argument('--remote', default='origin'); publish.add_argument('--source-sha')
    site = sub.add_parser('assemble-site'); site.add_argument('--output', type=Path, required=True); site.add_argument('--site-dir', default='docs')
    args = p.parse_args(argv)
    root = args.root.resolve()
    try:
        if args.command in ('configure-publish', 'hook', 'publish', 'assemble-site'):
            import importlib.util
            spec = importlib.util.spec_from_file_location('map_publish', Path(__file__).with_name('product_map_publish.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.dispatch(args, sys.modules[__name__])
        if args.command == 'init':
            init(root)
        elif args.command == 'build':
            data = build(root, args.output, not args.no_branches)
            print('%d components; %d diagnostics' % (len(data['components']), len(data['diagnostics'])))
        elif args.command == 'snapshot':
            print(json.dumps(project(root), ensure_ascii=False, indent=2))
        elif args.command == 'import-jira':
            with args.issues.open() as f:
                import_jira(root, json.load(f))
        else:
            path = root / '.product-map/work.json'
            work = read(path)
            if args.command == 'story':
                with args.file.open() as f:
                    row = json.load(f)
                if not isinstance(row, dict) or not ID.fullmatch(text(row.get('id'))):
                    raise Error('story requires a valid id')
                row['observed_at'] = now()
                rows = [s for s in work['stories'] if s.get('id') != row['id']]
                work['stories'] = rows + [row]
            else:
                matches = [s for s in work['stories'] if s.get('id') == args.story]
                if len(matches) != 1:
                    raise Error('record the story before its plan or slices')
                row = matches[0]
                if args.command == 'plan':
                    old = {s['id']: s for s in row.get('slices', [])}
                    slices, seen = [], set()
                    for value in args.slice:
                        identity, sep, title = value.partition('=')
                        if not sep or not title or not ID.fullmatch(identity) or identity in seen:
                            raise Error('use unique --slice ID=TITLE entries')
                        seen.add(identity)
                        slices.append(dict(old.get(identity, {'id': identity, 'status': 'not-started'}), title=title))
                    row.update(slices=slices, unsliced=False)
                else:
                    matches = [s for s in row.get('slices', []) if s['id'] == args.slice]
                    if len(matches) != 1:
                        raise Error('slice is not in the declared plan')
                    if args.status == 'complete' and not args.evidence:
                        raise Error('complete requires --evidence from the lead delivery checks')
                    matches[0].update(status=args.status, observed_at=now())
                    if args.evidence:
                        matches[0]['evidence'] = text(args.evidence, 500)
                row['observed_at'] = now()
            # Do not freshen other stories or a Jira observation by changing a local slice.
            write(path, work)
    except (OSError, ValueError, Error, subprocess.TimeoutExpired) as error:
        p.exit(2, 'product-map: %s\n' % error)


if __name__ == '__main__':
    main()
