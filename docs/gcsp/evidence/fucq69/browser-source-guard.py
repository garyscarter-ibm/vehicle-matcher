#!/usr/bin/env python3
"""Static, finite read-only fixture asset closure; never imports product code or launches Chrome."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[4]
MANIFEST = Path(__file__).with_name('browser-assets.json')
ENTRY = 'gcsp-manual-gallery.html'
LOGO = 'assets/brand-logos/bmwgroup-bmw-mini.svg'
LOGO_SHA = '703c69d19aa0d2eda773a1b4022af2bf474c1058a4bafb84468abf7df63557ac'


def closure():
    pending, seen, edges = [ENTRY], {}, []

    def add(owner, target, kind):
        if target.startswith(('data:', '#')):
            return
        uri = urlsplit(target)
        if uri.scheme or uri.netloc:
            raise ValueError('External asset/import is not permitted: %s' % target)
        relative = unquote(uri.path)
        path = (ROOT / relative.lstrip('/') if relative.startswith('/') else ROOT / owner.parent / relative).resolve()
        rel = str(path.relative_to(ROOT))
        if not path.is_file() or path.is_symlink():
            raise ValueError('Required asset missing or indirect: %s' % rel)
        edges.append({'from': str(owner), 'to': rel, 'kind': kind})
        if rel not in seen:
            pending.append(rel)

    while pending:
        rel = pending.pop()
        if rel in seen:
            continue
        path = ROOT / rel
        if not path.is_file() or path.is_symlink():
            raise ValueError('Missing/indirect source: %s' % rel)
        raw = path.read_bytes()
        seen[rel] = hashlib.sha256(raw).hexdigest()
        if len(seen) > 128 or sum((ROOT / item).stat().st_size for item in seen) > 16 * 1024 * 1024:
            raise ValueError('Static fixture closure exceeds finite preparation bounds')
        owner = Path(rel)
        if path.suffix == '.html':
            from html.parser import HTMLParser
            class Assets(HTMLParser):
                def handle_starttag(self, tag, attrs):
                    values = dict(attrs)
                    if tag in ('script', 'img', 'source') and values.get('src'):
                        add(owner, values['src'], 'html-src')
                    if tag == 'link' and values.get('href'):
                        add(owner, values['href'], 'html-link')
                    if values.get('srcset'):
                        raise ValueError('Unreviewed HTML srcset')
            Assets().feed(raw.decode())
        elif path.suffix == '.css':
            text = re.sub(r'/\*.*?\*/', '', raw.decode(), flags=re.S)
            for value in re.findall(r'@import\s+[\'"]([^\'"]+)[\'"]', text):
                add(owner, value, 'css-import')
            for value in re.findall(r'url\(\s*[\'\"]?([^\'\"\s)]+)[\'\"]?\s*\)', text):
                add(owner, value, 'css-url')
        elif path.suffix == '.js':
            text = raw.decode()
            # These pinned ES modules use literal import declarations. Reject any new dynamic shape.
            for value in re.findall(r'^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?[\'\"]([^\'\"]+)[\'\"]', text, re.M):
                add(owner, value, 'module-import')
            dynamic = list(re.finditer(r'\bimport\s*\(', text))
            literal = list(re.finditer(r'\bimport\s*\(\s*[\'\"]([^\'\"]+)[\'\"]\s*\)', text))
            if {item.start() for item in dynamic} != {item.start() for item in literal}:
                raise ValueError('Unreviewed nonliteral module import in %s' % rel)
            for item in literal:
                add(owner, item.group(1), 'dynamic-literal-import')
            urls = list(re.finditer(r'new\s+URL\s*\(', text))
            static_urls = list(re.finditer(r'new\s+URL\s*\(\s*[\'\"]([^\'\"]+)[\'\"]\s*,\s*import\.meta\.url\s*\)', text))
            reviewed = {item.start() for item in static_urls}
            for item in static_urls:
                add(owner, item.group(1), 'module-url')
            if rel == 'blocks/gcsp/shell/portal-shell.js':
                template = 'new URL(`../../../assets/brand-logos/${name}.svg`, import.meta.url)'
                if text.count(template) != 1:
                    raise ValueError('Shell logo template changed; re-review required')
                calls = list(re.finditer(r'\bLOGO\s*\(', text))
                named = list(re.finditer(r'\bLOGO\s*\(\s*[\'\"]([^\'\"]+)[\'\"]\s*\)', text))
                if {item.start() for item in calls} != {item.start() for item in named}:
                    raise ValueError('Unreviewed dynamic shell logo call')
                if [item.group(1) for item in named] != ['bmwgroup-bmw-mini']:
                    raise ValueError('Shell fixture logo changed; re-review required')
                add(owner, '../../../' + LOGO, 'reviewed-shell-template')
                reviewed.add(text.index(template))
            if rel == 'blocks/gcsp/manual-gallery/harness.js':
                location_url = 'new URL(globalThis.location.href)'
                if text.count(location_url) != 1:
                    raise ValueError('Fixture selector URL shape changed')
                reviewed.add(text.index(location_url))
            if {item.start() for item in urls} != reviewed:
                raise ValueError('Unreviewed dynamic URL constructor in %s' % rel)
            for value in re.findall(r'[\'\"](/assets/[^\'\"]+)[\'\"]', text):
                add(owner, value, 'fixture-asset-literal')
    if seen.get(LOGO) != LOGO_SHA:
        raise ValueError('Reviewed shell logo bytes changed')
    return {'version': 1, 'entry': ENTRY, 'files': dict(sorted(seen.items())),
            'edges': sorted(edges, key=lambda row: (row['from'], row['to'], row['kind'])),
            'reviewedDynamicBoundaries': [
                'Shell LOGO literal call resolves only bmwgroup-bmw-mini.svg; other navigation icons use inline SVG path data.',
                'Harness new URL(globalThis.location.href) selects a named read-only fixture, not an asset.',
                'Shared mediaWell accepts fixture photo/image URLs; the pinned fixture supplies only /assets/brand-hero/bmw.jpg or null.',
                'Imported authenticated HTTP adapters are unused by the explicit fixture adapter; no API is served, external requests remain blocked.'
            ]}


def check():
    current = closure()
    approved = json.loads(MANIFEST.read_text())
    if current != approved:
        missing = sorted(set(current['files']) - set(approved['files']))
        changed = sorted(p for p, h in current['files'].items() if approved['files'].get(p) != h)
        raise ValueError('Pinned browser asset closure changed; re-review required: %s' % {'unlisted': missing, 'changed': changed})
    return {'state': 'passed', 'files': len(current['files']), 'edges': len(current['edges']),
            'manifestSha256': hashlib.sha256(MANIFEST.read_bytes()).hexdigest(), 'shellLogoSha256': LOGO_SHA}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--write-reviewed-manifest', action='store_true', help='Preparation only; never used by browser supervisor')
    args = parser.parse_args()
    if args.write_reviewed_manifest:
        MANIFEST.write_text(json.dumps(closure(), indent=2) + '\n')
    print(json.dumps(check(), sort_keys=True))
