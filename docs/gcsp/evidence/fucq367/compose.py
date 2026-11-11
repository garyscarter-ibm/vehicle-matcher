"""FUCQ-367: implementation, side-by-side and rating-zoom images. Usage: python3 -I compose.py <scratch>"""
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
GUTTER, STRIP, MAXH, ZOOM = 24, 28, 4000, 2


def font(size):
    for path in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


label = font(15)


def crop_box(media, width, narrow, img):
    # Bottom-right of the image box: 420x160 css px at desktop, full image width (taller, to hold the tip) at <=375.
    w = int(round(media['width'])) if narrow else min(420, int(round(media['width'])))
    h = int(round(media['height'])) if narrow else 160
    x1, y1 = int(round(media['x'] + media['width'])), int(round(media['y'] + media['height']))
    x0, y0 = max(0, x1 - w), max(0, y1 - h)
    return (x0, y0, min(img.width, x1), min(img.height, y1))


def zoom(img, box):
    return img.crop(box).resize(((box[2] - box[0]) * ZOOM, (box[3] - box[1]) * ZOOM), Image.LANCZOS)


def sheet(left, right, left_label, right_label, path, quality):
    a, b = left, right
    width = a.width + (GUTTER + b.width if b else 0)
    canvas = Image.new('RGB', (width, STRIP + max(a.height, b.height if b else 0)), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((4, 6), left_label, fill='black', font=label)
    canvas.paste(a, (0, STRIP))
    if b:
        draw.text((a.width + GUTTER + 4, 6), right_label, fill='black', font=label)
        canvas.paste(b, (a.width + GUTTER, STRIP))
    canvas.save(path, 'JPEG', quality=quality)


for name, entry in results['states'].items():
    impl = Image.open(os.path.join(scratch, 'impl367', name + '.png')).convert('RGB')
    impl.crop((0, 0, impl.width, min(impl.height, MAXH))).save(os.path.join(here, name + '-implementation.jpg'), 'JPEG', quality=80)
    entry['implementationImage'] = name + '-implementation.jpg'
    entry['implementationSize'] = list(impl.size)
    narrow = entry['viewport']['width'] <= 375
    ibox = crop_box(entry['impl']['media'], entry['viewport']['width'], narrow, impl)
    entry['zoomCropImpl'] = list(ibox)
    izoom = zoom(impl, ibox)
    ref_png = entry.get('referencePng')
    if not ref_png:
        sheet(izoom, None, 'Implementation %s: %s (2x, no reference)' % (short, name), '', os.path.join(here, name + '-rating-zoom.jpg'), 82)
        entry['ratingZoom'] = name + '-rating-zoom.jpg'
        continue
    ref = Image.open(os.path.join(repo, ref_png)).convert('RGB')
    entry['referenceSize'] = list(ref.size)
    rbox = crop_box(entry['ref']['media'], entry['viewport']['width'], narrow, ref)
    entry['zoomCropRef'] = list(rbox)
    sheet(zoom(ref, rbox), izoom, 'Reference 193cbf07 (2x)', 'Implementation %s (2x)' % short, os.path.join(here, name + '-rating-zoom.jpg'), 82)
    entry['ratingZoom'] = name + '-rating-zoom.jpg'
    a, b = ref.crop((0, 0, ref.width, min(ref.height, MAXH))), impl.crop((0, 0, impl.width, min(impl.height, MAXH)))
    sheet(a, b, 'Reference 193cbf07: %s.png' % os.path.basename(ref_png)[:-4], 'Implementation %s: %s' % (short, name), os.path.join(here, name + '-side-by-side.jpg'), 80)
    entry['sideBySide'] = name + '-side-by-side.jpg'

with open(os.path.join(here, 'results.json'), 'w') as f:
    json.dump(results, f, indent=2)
