#!/usr/bin/env python3
"""List historical GCSP evidence and restore one verified file without overwriting local work."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'docs/gcsp/evidence-archive-2026-11-11.json'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def restore(record, destination, archive=None):
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError('Output already exists; choose another path.')
    if not destination.parent.is_dir():
        raise ValueError('Output parent directory must already exist.')
    temporary = destination.with_name('.' + destination.name + '.evidence-' + str(os.getpid()))
    owned = False
    try:
        with temporary.open('xb') as output:
            owned = True
            if archive:
                with tarfile.open(archive, 'r|gz') as contents:
                    for member in contents:
                        if member.name == 'objects/' + record['sha256']:
                            if not member.isfile() or member.size != record['size']:
                                raise ValueError('Archive member type or size differs from the index.')
                            with contents.extractfile(member) as source:
                                shutil.copyfileobj(source, output, 1024 * 1024)
                            break
                    else:
                        raise ValueError('The requested object is absent from the archive.')
            else:
                result = subprocess.run(['git', '-C', str(ROOT), 'cat-file', 'blob', record['gitBlob']],
                                        stdout=output, stderr=subprocess.PIPE)
                if result.returncode:
                    raise ValueError('Git object unavailable; supply --archive /path/to/objects.tar.gz.')
        if temporary.stat().st_size != record['size'] or sha256(temporary) != record['sha256']:
            raise ValueError('Restored bytes do not match the recorded size and SHA-256.')
        temporary.chmod(record['mode'])
        # Linking the sibling temporary file refuses an output created since the initial check.
        os.link(temporary, destination)
    finally:
        if owned:
            temporary.unlink(missing_ok=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    listing = commands.add_parser('list', help='Show totals, or files beneath a historical evidence prefix.')
    listing.add_argument('--prefix')
    restoring = commands.add_parser('restore', help='Restore one file from Git history or the external archive.')
    restoring.add_argument('--path', required=True, help='Exact original repository-relative evidence path.')
    restoring.add_argument('--output', required=True, help='New output file; never overwrites an existing file.')
    restoring.add_argument('--archive', type=Path, help='Optional content-addressed objects.tar.gz archive.')
    args = parser.parse_args()
    index = json.loads(INDEX.read_text())
    if args.command == 'list':
        if args.prefix is None:
            print(json.dumps(index['summary'], indent=2))
        else:
            for record in index['files']:
                if record['path'].startswith(args.prefix):
                    print(f"{record['size']:>10}  {record['path']}")
        return
    path = PurePosixPath(args.path)
    if path.is_absolute() or '..' in path.parts or not args.path.startswith('docs/gcsp/evidence/'):
        parser.error('--path must be an original repository-relative evidence path without traversal.')
    record = next((item for item in index['files'] if item['path'] == args.path), None)
    if record is None:
        parser.error('The requested file is not in the historical evidence index.')
    try:
        destination = restore(record, args.output, args.archive)
    except (ValueError, OSError, tarfile.TarError) as error:
        parser.exit(1, str(error) + '\n')
    print(f"Restored and SHA-256 verified: {destination}")


if __name__ == '__main__':
    main()
