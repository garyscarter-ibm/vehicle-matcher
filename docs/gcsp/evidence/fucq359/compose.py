"""FUCQ-359: side-by-side images, implementation images and neighbour diffs. Usage: python3 -I compose.py <scratch>"""
import json
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

scratch = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.abspath(os.path.join(here, '..', '..', '..', '..'))
results_path = os.path.join(here, 'results.json')
with open(results_path) as f:
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


label_font = font(15)
for name, entry in results['states'].items():
    boxes = entry['boxes']
    entry['featureMediaMinusDrawnHeight'] = (boxes['featureMedia']['height'] - boxes['drawnImage']['height']) if boxes['drawnImage'] else None
    ref_file = os.path.join(repo, entry['referencePng'])
    impl_file = os.path.join(scratch, 'impl', name + '.png')
    ref = Image.open(ref_file).convert('RGB')
    impl = Image.open(impl_file).convert('RGB')
    cropped = max(ref.height, impl.height) > MAXH
    if cropped:
        ref, impl = ref.crop((0, 0, ref.width, min(ref.height, MAXH))), impl.crop((0, 0, impl.width, min(impl.height, MAXH)))
    width = ref.width + GUTTER + impl.width
    height = STRIP + max(ref.height, impl.height)
    canvas = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((4, 6), 'Reference 193cbf07: %s.png' % name, fill='black', font=label_font)
    draw.text((ref.width + GUTTER + 4, 6), 'Implementation %s: %s' % (short, name), fill='black', font=label_font)
    canvas.paste(ref, (0, STRIP))
    canvas.paste(impl, (ref.width + GUTTER, STRIP))
    canvas.save(os.path.join(here, name + '-side-by-side.jpg'), 'JPEG', quality=80)
    entry['sideBySide'] = {'file': name + '-side-by-side.jpg', 'cropTo4000': cropped,
                           'referenceSize': list(Image.open(ref_file).size), 'implementationSize': list(Image.open(impl_file).size)}
    big = os.path.getsize(impl_file) > 1.5 * 1024 * 1024
    if big:
        Image.open(impl_file).convert('RGB').save(os.path.join(here, name + '-implementation.jpg'), 'JPEG', quality=85)
        entry['implementationImage'] = name + '-implementation.jpg'
    else:
        with open(impl_file, 'rb') as src, open(os.path.join(here, name + '-implementation.png'), 'wb') as dst:
            dst.write(src.read())
        entry['implementationImage'] = name + '-implementation.png'

Image.MAX_IMAGE_PIXELS = None  # components.html is a very tall page; compared in bands to bound memory
BAND = 3000
JPEG_MAX = 65000
for page in results['neighbours']:
    stem = page.replace('.html', '')
    a = Image.open(os.path.join(scratch, 'neighbours', stem + '-base.png'))
    b = Image.open(os.path.join(scratch, 'neighbours', stem + '-branch.png'))
    w, h = max(a.width, b.width), max(a.height, b.height)
    count, left, top, right, bottom = 0, None, None, None, None
    first_diff_y = None
    for y in range(0, h, BAND):
        ba = Image.new('RGB', (w, min(BAND, h - y)), (255, 0, 255))
        bb = Image.new('RGB', (w, min(BAND, h - y)), (255, 0, 255))
        if y < a.height:
            ba.paste(a.crop((0, y, a.width, min(a.height, y + BAND))).convert('RGB'), (0, 0))
        if y < b.height:
            bb.paste(b.crop((0, y, b.width, min(b.height, y + BAND))).convert('RGB'), (0, 0))
        d = ImageChops.difference(ba, bb).convert('L').point(lambda v: 255 if v else 0)
        box = d.getbbox()
        if box:
            count += d.histogram()[255]
            first_diff_y = y + box[1] if first_diff_y is None else first_diff_y
            left = box[0] if left is None else min(left, box[0])
            right = box[2] if right is None else max(right, box[2])
            top = y + box[1] if top is None else min(top, y + box[1])
            bottom = y + box[3] if bottom is None else max(bottom, y + box[3])
    info = results['neighbours'][page]
    info.update({'baseSize': list(a.size), 'branchSize': list(b.size), 'differingPixels': count,
                 'bbox': [left, top, right, bottom] if count else None, 'identical': count == 0 and a.size == b.size})
    if count or page == 'components.html':
        info['saved'] = []
        for label, img in (('base', a), ('branch', b)):
            out = 'neighbour-%s-%s.jpg' % (stem, label)
            if img.height > JPEG_MAX:
                # JPEG caps at 65535px: keep a window starting 200px above the first difference.
                y0 = max(0, (first_diff_y or 0) - 200)
                img.crop((0, y0, img.width, min(img.height, y0 + 8000))).convert('RGB').save(os.path.join(here, out), 'JPEG', quality=80)
                info['windowFromY'] = y0
                info['windowNote'] = 'JPEG limit: saved window is 8000px tall from windowFromY of the full page'
            else:
                img.convert('RGB').save(os.path.join(here, out), 'JPEG', quality=80)
            info['saved'].append(out)
    else:
        for label in ('base', 'branch'):
            old = os.path.join(here, 'neighbour-%s-%s.jpg' % (stem, label))
            if os.path.exists(old):
                os.remove(old)

with open(results_path, 'w') as f:
    json.dump(results, f, indent=2)
