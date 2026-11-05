"""Publication boundary: staged static files on IBM, CAS branch publishing in CI."""
import contextlib
import json
import os
import re
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid

MARKER = '# product-map hook v1'


def run(root, args, data=None, env=None, allowed=(0,)):
    p = subprocess.run(['git', *args], cwd=str(root), input=data, capture_output=True,
                       env=env, timeout=60)
    if p.returncode not in allowed:
        # Git remote errors may contain credential-bearing URLs. Do not copy stderr.
        raise ValueError('git %s failed (exit %d)' % (args[0], p.returncode))
    return p.stdout.decode('utf-8', 'replace').strip()


def common_dir(root):
    path = Path(run(root, ['rev-parse', '--git-common-dir']))
    return (root / path).resolve() if not path.is_absolute() else path.resolve()


@contextlib.contextmanager
def owned_temp(root, pm):
    """Small Git index/build allocation, with external ownership and finalizer."""
    identity = uuid.uuid4().hex
    folder = common_dir(root) / 'product-map-runs'
    folder.mkdir(parents=True, exist_ok=True)
    manifest = folder / (identity + '.json')
    # Parent path is chosen before mkdir and recorded outside the disposable root.
    scratch = Path(tempfile.gettempdir()) / ('product-map-' + identity)
    pm.write(manifest, {'root': str(scratch), 'owner_pid': os.getpid(), 'state': 'planned'})
    try:
        scratch.mkdir(mode=0o700)
        yield scratch
    finally:
        if scratch.exists() and not scratch.is_symlink():
            shutil.rmtree(scratch)
        pm.write(manifest, {'root': str(scratch), 'owner_pid': os.getpid(),
                            'state': 'removed' if not os.path.lexists(scratch) else 'cleanup-required'})


def config(root):
    path = root / '.claude/scaffolding.json'
    if not path.exists():
        return {'version': 1, 'pieces': {}}
    with path.open() as f:
        value = json.load(f)
    if not isinstance(value, dict):
        raise ValueError('invalid scaffolding configuration')
    return value


def site_path(root, directory):
    part = Path(directory)
    if part.is_absolute() or '..' in part.parts or part.parts and part.parts[0] in ('.git', '.claude', '_tools', '.product-map'):
        raise ValueError('site directory must be a repository site folder')
    path = root / part / 'product-map'
    if root not in path.resolve().parents or any(p.is_symlink() for p in [root / part, path]):
        raise ValueError('site directory leaves the repository or is a symlink')
    return path


def configure(args, pm):
    root = args.root.resolve()
    rec = config(root)
    settings = rec.setdefault('product_map', {})
    if not isinstance(settings, dict):
        raise ValueError('product_map must be an object')
    if args.remote.startswith('-') or args.remote not in run(root, ['remote']).splitlines():
        raise ValueError('choose an existing remote')
    base = run(root, ['symbolic-ref', '--short', 'refs/remotes/' + args.remote + '/HEAD'], allowed=(0, 1, 128))
    base = base.split('/', 1)[-1] if base else 'main'
    if args.branch == base or run(root, ['check-ref-format', '--branch', args.branch], allowed=(0, 128)) != args.branch:
        raise ValueError('publication branch must be valid and different from the source branch')
    publish = {'mode': args.mode, 'site_dir': args.site_dir, 'branch': args.branch,
               'remote': args.remote, 'base_branch': base}
    site_path(root, args.site_dir)
    if args.mode == 'static-main':
        site_path(root, args.site_dir)
        gitdir = common_dir(root)
        hooks = gitdir / 'product-map-hooks'
        effective = run(root, ['config', '--get', 'core.hooksPath'], allowed=(0, 1))
        previous = Path(effective) if effective else gitdir / 'hooks'
        if not previous.is_absolute():
            previous = root / previous
        previous = previous.resolve()
        if previous == hooks:
            previous = Path(settings.get('publish', {}).get('previous_hooks', str(gitdir / 'hooks')))
        publish['previous_hooks'] = str(previous)
        hooks.mkdir(exist_ok=True)
        # Preserve every existing hook, including future event types. Each wrapper
        # runs the original script directly, without changing or renaming it.
        events = {'pre-commit', 'pre-merge-commit', 'post-merge', 'reference-transaction'}
        if previous.is_dir():
            events.update(p.name for p in previous.iterdir() if p.is_file() and os.access(p, os.X_OK) and not p.name.endswith('.sample'))
        for event in sorted(events):
            if '/' in event or not event.replace('-', '').isalnum():
                continue
            destination = hooks / event
            if destination.exists() and MARKER not in destination.read_text():
                raise ValueError('custom hook in managed hooks directory: ' + event)
            original = previous / event
            if event == 'reference-transaction':
                # Read once and replay identical bytes/arguments to both hooks.
                # The original prepared-state veto must stop the transaction.
                body = '#!/usr/bin/env python3\n' + MARKER + '\n'
                body += 'import os, subprocess, sys\nfrom pathlib import Path\n'
                body += 'data = sys.stdin.buffer.read()\noriginal = %r\n' % str(original)
                body += 'if os.access(original, os.X_OK):\n'
                body += '    result = subprocess.run([original, *sys.argv[1:]], input=data)\n'
                body += '    if result.returncode: sys.exit(result.returncode)\n'
                body += 'if len(sys.argv) < 2 or sys.argv[1] != "committed": sys.exit(0)\n'
                body += 'try:\n'
                body += '    root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True, stderr=subprocess.DEVNULL).strip()\n'
                body += '    tool = Path(root) / "_tools/product_map.py"\n'
                body += '    supported = tool.is_file() and \"\\nREFERENCE_TRANSACTION_HOOK = 1\\n\" in tool.read_text()\n'
                body += '    if supported:\n'
                body += '        result = subprocess.run([sys.executable, "-I", "-B", str(tool), "--root", root, "hook", "--event", "reference-transaction", "--hook-args", *sys.argv[1:]], input=data)\n'
                body += '        if result.returncode: print("WARN Product map: Pages build trigger could not complete", file=sys.stderr)\n'
                body += 'except (OSError, UnicodeError, subprocess.SubprocessError):\n'
                body += '    print("WARN Product map: Pages build trigger could not complete", file=sys.stderr)\n'
                destination.write_text(body)
                destination.chmod(0o755)
                continue
            body = '#!/bin/sh\n' + MARKER + '\n'
            body += 'if [ -x %s ]; then\n  %s "$@" || exit $?\nfi\n' % (shlex.quote(str(original)), shlex.quote(str(original)))
            if event in ('pre-commit', 'pre-merge-commit', 'post-merge'):
                body += 'map_root=$(git rev-parse --show-toplevel) || exit 1\n'
                body += 'if [ -f "$map_root/_tools/product_map.py" ]; then\n'
                body += '  exec /usr/bin/env python3 -I -B "$map_root/_tools/product_map.py" --root "$map_root" hook --event ' + event
                body += ' --squash "${1:-0}"' if event == 'post-merge' else ''
                body += '\nfi\n'
            destination.write_text(body)
            destination.chmod(0o755)
        run(root, ['config', '--local', 'core.hooksPath', str(hooks)])
    else:
        path = root / '.github/workflows/product-map.yml'
        if path.exists() and '# Managed product map workflow v1' not in path.read_text():
            raise ValueError('existing product-map workflow is custom; integrate it explicitly')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(workflow(base, args.branch, args.site_dir, args.remote))
    settings['publish'] = publish
    rec.setdefault('pieces', {})['product-map'] = 'on'
    pm.write(root / '.claude/scaffolding.json', rec)
    if args.mode == 'static-main':
        print('Configured static-main publication; set Pages source to %s /%s' % (base, args.site_dir))
    else:
        print('Configured Actions publication; set Pages source to GitHub Actions')


def assemble_site(args):
    """Export only committed site blobs; never copy checkout credentials/cache."""
    root = args.root.resolve()
    site_path(root, args.site_dir)
    directory = Path(args.site_dir).as_posix().strip('/')
    prefix = '' if directory == '.' else directory + '/'
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    entries = subprocess.run(['git', 'ls-tree', '-r', '-z', 'HEAD', '--', directory],
                             cwd=str(root), check=True, capture_output=True, timeout=60).stdout
    for entry in entries.split(b'\0'):
        if not entry:
            continue
        meta, raw_path = entry.split(b'\t', 1)
        mode, kind, sha = meta.decode('ascii').split()
        name = raw_path.decode('utf-8')
        if not name.startswith(prefix):
            continue
        relative = Path(name[len(prefix):])
        # Dot directories/files carry machine and automation configuration.
        # .nojekyll is the one intentional Pages marker.
        if any(part.startswith('.') and part != '.nojekyll' for part in relative.parts):
            continue
        if mode not in ('100644', '100755') or kind != 'blob':
            raise ValueError('site contains a symlink or non-file: ' + str(relative))
        target = output / relative
        if output not in target.resolve().parents or any(p.is_symlink() for p in (target, *target.parents) if p != output):
            raise ValueError('site output leaves its destination')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('wb') as stream:
            subprocess.run(['git', 'cat-file', 'blob', sha], cwd=str(root), stdout=stream,
                           check=True, stderr=subprocess.PIPE, timeout=60)


def workflow(base, branch, site_dir='docs', remote='origin'):
    # Trusted default-branch code; branch-provided records are read only as JSON.
    return '''# Managed product map workflow v1
name: Product map
on:
  push:
    branches-ignore:
      - %s
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: product-map-publish
  cancel-in-progress: false
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: %s
          fetch-depth: 0
      - name: Collect current refs
        run: git fetch origin %s
      - name: Check product map setting
        id: enabled
        run: |
          python3 - <<'PY' >> "$GITHUB_OUTPUT"
          import json
          from pathlib import Path
          p = Path('.claude/scaffolding.json')
          rec = json.loads(p.read_text()) if p.exists() else {}
          print('enabled=' + str(rec.get('pieces', {}).get('product-map') != 'off').lower())
          PY
      - name: Generate map
        if: steps.enabled.outputs.enabled == 'true'
        run: |
          python3 -I -B _tools/product_map.py assemble-site --site-dir %s --output "$RUNNER_TEMP/product-site"
          python3 -I -B _tools/product_map.py build --output "$RUNNER_TEMP/product-site/product-map"
      - uses: actions/upload-pages-artifact@v3
        if: steps.enabled.outputs.enabled == 'true'
        with:
          path: ${{ runner.temp }}/product-site
      - uses: actions/deploy-pages@v4
        id: deployment
        if: steps.enabled.outputs.enabled == 'true'
''' % (json.dumps(branch), json.dumps(base), shlex.quote('+refs/heads/*:refs/remotes/' + remote + '/*'), shlex.quote(site_dir))


def ibm_repository(remote):
    """Accept only ordinary IBM remotes with credential-free, safe paths."""
    match = re.fullmatch(
        r'(?:https://github\.ibm\.com/|git@github\.ibm\.com:|ssh://git@github\.ibm\.com(?::22)?/)'
        r'([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9_][A-Za-z0-9_.-]*)/?', remote)
    if not match:
        return None
    owner, repository = match.groups()
    if repository.endswith('.git'):
        repository = repository[:-4]
    if not repository or repository in ('.', '..'):
        return None
    return owner + '/' + repository


def request_pages_build(root, repository):
    """Best effort after publication; never expose API bodies or credentials."""
    client = shutil.which('gh')
    fallback = Path.home() / '.claude-tools/bin/gh'
    if not client and fallback.is_file() and os.access(fallback, os.X_OK):
        client = str(fallback)
    if not client:
        print('WARN Product map: Pages build was not requested; gh is unavailable', file=sys.stderr)
        return
    try:
        result = subprocess.run([client, 'api', '--hostname', 'github.ibm.com', '--method', 'POST',
                                 'repos/' + repository + '/pages/builds'], cwd=str(root),
                                capture_output=True, timeout=15)
        if result.returncode:
            print('WARN Product map: Pages build request failed (exit %d)' % result.returncode, file=sys.stderr)
    except (OSError, subprocess.SubprocessError):
        print('WARN Product map: Pages build request could not complete', file=sys.stderr)


def reference_transaction(args, data):
    """Request after a committed remote tracking-ref notification (push or fetch).

    Git may supply a zero/unknown old SHA even for an unchanged push; that can
    cause a harmless redundant request. There is no persistent deduplication.
    """
    if not args.hook_args or args.hook_args[0] != 'committed':
        return
    try:
        root = args.root.resolve()
        rec = config(root)
        if rec.get('pieces', {}).get('product-map') == 'off':
            return
        settings = rec.get('product_map', {}).get('publish', {})
        if settings.get('mode') != 'static-main':
            return
        remote = settings.get('remote', 'origin')
        target = 'refs/remotes/' + remote + '/' + settings.get('base_branch', 'main')
        changed = False
        for line in data.decode('ascii', 'replace').splitlines():
            parts = line.split()
            if len(parts) != 3:
                continue
            old, new, ref = parts
            if (ref == target and old != new and re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', new)
                    and set(new) != {'0'}):
                changed = True
                break
        if not changed:
            return
        repository = ibm_repository(run(root, ['remote', 'get-url', remote]))
        if repository:
            request_pages_build(root, repository)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        # The remote operation has already succeeded. Publication must not turn
        # its local tracking-ref notification into an apparent push failure.
        print('WARN Product map: Pages build trigger could not complete', file=sys.stderr)


def hook(args, pm):
    if args.event == 'reference-transaction':
        return reference_transaction(args, sys.stdin.buffer.read())
    root = args.root.resolve()
    if os.environ.get('PRODUCT_MAP_GENERATED_COMMIT') == '1':
        return
    if args.event == 'post-merge' and getattr(args, 'squash', '0') == '1':
        # The squash is still staged work. Its eventual pre-commit builds it.
        return
    rec = config(root)
    if rec.get('pieces', {}).get('product-map') == 'off':
        return
    settings = rec.get('product_map', {}).get('publish', {})
    if settings.get('mode') != 'static-main':
        return
    branch = run(root, ['symbolic-ref', '--short', 'HEAD'], allowed=(0, 1))
    if branch != settings.get('base_branch', 'main'):
        return
    output = site_path(root, settings.get('site_dir', 'docs'))
    staged = args.event != 'post-merge'
    data = pm.build(root, output, staged=staged, revision=None if staged else 'HEAD')
    if data['diagnostics']:
        print('Product map: %d source diagnostics are visible in the map' % len(data['diagnostics']))
    files = [str((output / name).relative_to(root)) for name in ('index.html', 'map.css', 'map.js', 'data.js', 'data.json')]
    run(root, ['add', '--', *files])
    if args.event == 'post-merge':
        # A fast-forward has no pre-merge-commit. Commit only generated files,
        # preserving any unrelated staged work and custom hooks.
        env = dict(os.environ, PRODUCT_MAP_GENERATED_COMMIT='1')
        run(root, ['commit', '--only', '-m', 'Refresh product map after merge\n\nCo-Authored-By: Codex <noreply@openai.com>', '--', *files], env=env)


def publish(args, pm):
    root = args.root.resolve()
    output = args.output.resolve()
    remote, branch = args.remote, args.branch
    if remote.startswith('-') or remote not in run(root, ['remote']).splitlines():
        raise ValueError('choose an existing remote')
    if branch.startswith('-'):
        raise ValueError('invalid publication branch')
    run(root, ['check-ref-format', '--branch', branch])
    base = config(root).get('product_map', {}).get('publish', {}).get('base_branch', 'main')
    if branch == base:
        raise ValueError('refusing to publish over source branch')
    source = args.source_sha or run(root, ['rev-parse', 'HEAD'])
    remote_source = run(root, ['ls-remote', remote, 'refs/heads/' + base]).split()
    if not remote_source or remote_source[0] != source:
        raise ValueError('source is stale or not pushed; regenerate from the current remote default branch')
    # Also verify that the already-built directory belongs to this source set.
    data = pm.read(output / 'data.json')
    if data.get('ref_remote', 'origin') != remote:
        raise ValueError('generated map belongs to another remote; configure and regenerate')
    source_shas = {s.get('sha') for s in data.get('sources', [])}
    if source not in source_shas:
        raise ValueError('generated map does not include the current source SHA')
    def check_refs():
        current = {}
        for line in run(root, ['ls-remote', '--heads', remote]).splitlines():
            sha, ref = line.split()
            name = ref[len('refs/heads/'):]
            if name != branch:
                current[name] = sha
        expected = {name: sha for name, sha in data.get('ref_snapshot', {}).items() if name != branch}
        if current != expected:
            raise ValueError('source branches changed since generation; fetch refs and regenerate')
    check_refs()
    old_row = run(root, ['ls-remote', remote, 'refs/heads/' + branch]).split()
    old = old_row[0] if old_row else ''
    if old:
        run(root, ['fetch', '--quiet', remote, old])
    with owned_temp(root, pm) as scratch:
        env = dict(os.environ, GIT_INDEX_FILE=str(scratch / 'index'))
        run(root, ['read-tree', old if old else '--empty'], env=env)
        # Overlay only our five map files, keeping all unrelated Pages content.
        for name in ('index.html', 'map.css', 'map.js', 'data.js', 'data.json'):
            path = output / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size > pm.LIMIT:
                raise ValueError('invalid generated map file: ' + name)
            blob = run(root, ['hash-object', '-w', '--stdin'], data=path.read_bytes())
            run(root, ['update-index', '--add', '--cacheinfo', '100644,' + blob + ',product-map/' + name], env=env)
        tree = run(root, ['write-tree'], env=env)
        commit_args = ['commit-tree', tree, '-m', 'Refresh product map from ' + source + '\n\nCo-Authored-By: Codex <noreply@openai.com>']
        if old:
            commit_args += ['-p', old]
        identity = dict(os.environ)
        for key, value in [('GIT_AUTHOR_NAME', 'Product map publisher'), ('GIT_AUTHOR_EMAIL', 'noreply@github.com'),
                           ('GIT_COMMITTER_NAME', 'Product map publisher'), ('GIT_COMMITTER_EMAIL', 'noreply@github.com')]:
            identity.setdefault(key, value)
        commit = run(root, commit_args, env=identity)
        # Recheck source just before a lease-protected publication. The lease
        # also prevents concurrent/older jobs from replacing a newer site.
        current = run(root, ['ls-remote', remote, 'refs/heads/' + base]).split()
        if not current or current[0] != source:
            raise ValueError('source changed during generation; regenerate')
        check_refs()
        run(root, ['push', '--quiet', '--force-with-lease=refs/heads/' + branch + ':' + old,
                   remote, commit + ':refs/heads/' + branch])
    print('Published /product-map/ from ' + source[:12])


def dispatch(args, pm):
    if args.command == 'assemble-site':
        return assemble_site(args)
    if args.command == 'configure-publish':
        return configure(args, pm)
    if args.command == 'hook':
        return hook(args, pm)
    return publish(args, pm)
