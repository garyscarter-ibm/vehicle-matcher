"""FUCQ-368: side-by-side reference/implementation images. Usage: python3 -I compose.py <scratch>"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

scratch = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.abspath(os.path.join(here, '..', '..', '..', '..'))
with open(os.path.join(here, 'results.json')) as f:
    results = json.load(f)
short = results['implementationCommit']
GUTTER, STRIP, MAXH = 24, 28, 4000


def font(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


label = font(15)
for name, entry in results['states'].items():
    impl_file = os.path.join(scratch, 'impl368', name + '.png')
    impl = Image.open(impl_file).convert('RGB')
    # Keep the implementation capture small: JPEG for the retained copy.
    impl.crop((0, 0, impl.width, min(impl.height, MAXH))).save(os.path.join(here, name + '-implementation.jpg'), 'JPEG', quality=82)
    entry['implementationImage'] = name + '-implementation.jpg'
    entry['implementationSize'] = list(impl.size)
    if not entry.get('referencePng'):
        continue
    ref_file = os.path.join(repo, entry['referencePng'])
    ref = Image.open(ref_file).convert('RGB')
    entry['referenceSize'] = list(ref.size)
    a, b = ref.crop((0, 0, ref.width, min(ref.height, MAXH))), impl.crop((0, 0, impl.width, min(impl.height, MAXH)))
    canvas = Image.new('RGB', (a.width + GUTTER + b.width, STRIP + max(a.height, b.height)), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((4, 6), 'Reference 193cbf07: %s.png' % name, fill='black', font=label)
    draw.text((a.width + GUTTER + 4, 6), 'Implementation %s: %s' % (short, name), fill='black', font=label)
    canvas.paste(a, (0, STRIP))
    canvas.paste(b, (a.width + GUTTER, STRIP))
    canvas.save(os.path.join(here, name + '-side-by-side.jpg'), 'JPEG', quality=80)
    entry['sideBySide'] = name + '-side-by-side.jpg'

with open(os.path.join(here, 'results.json'), 'w') as f:
    json.dump(results, f, indent=2)
