"""FUCQ-369: implementation, side-by-side and prefs-zoom images. Usage: python3 -I compose.py <scratch>"""
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


def crop_box(section, img):
    # The Your preferences section, with a few pixels of margin so its border is visible.
    x0, y0 = max(0, int(section['x']) - 4), max(0, int(section['y']) - 4)
    return (x0, y0, min(img.width, int(section['x'] + section['width']) + 4), min(img.height, int(section['y'] + section['height']) + 4))


def zoom(img, box):
    return img.crop(box).resize(((box[2] - box[0]) * ZOOM, (box[3] - box[1]) * ZOOM), Image.LANCZOS)


def sheet(left, right, left_label, right_label, path, quality):
    width = left.width + (GUTTER + right.width if right else 0)
    canvas = Image.new('RGB', (width, STRIP + max(left.height, right.height if right else 0)), 'white')
    draw = ImageDraw.Draw(canvas)
    draw.text((4, 6), left_label, fill='black', font=label)
    canvas.paste(left, (0, STRIP))
    if right:
        draw.text((left.width + GUTTER + 4, 6), right_label, fill='black', font=label)
        canvas.paste(right, (left.width + GUTTER, STRIP))
    canvas.save(path, 'JPEG', quality=quality)


def clip(img):
    return img.crop((0, 0, img.width, min(img.height, MAXH)))


for name, entry in results['states'].items():
    impl = Image.open(os.path.join(scratch, 'impl369', name + '.png')).convert('RGB')
    clip(impl).save(os.path.join(here, name + '-implementation.jpg'), 'JPEG', quality=80)
    entry['implementationImage'] = name + '-implementation.jpg'
    entry['implementationSize'] = list(impl.size)
    ibox = crop_box(entry['impl']['sectionBox'], impl)
    entry['zoomCropImpl'] = list(ibox)
    ref_png = entry.get('referencePng')
    if not ref_png:
        sheet(zoom(impl, ibox), None, 'Implementation %s: %s preferences (2x, no reference)' % (short, name), '', os.path.join(here, name + '-prefs-zoom.jpg'), 78)
        entry['prefsZoom'] = name + '-prefs-zoom.jpg'
        continue
    ref = Image.open(os.path.join(repo, ref_png)).convert('RGB')
    entry['referenceSize'] = list(ref.size)
    rbox = crop_box(entry['ref']['sectionBox'], ref)
    entry['zoomCropRef'] = list(rbox)
    sheet(zoom(ref, rbox), zoom(impl, ibox), 'Reference 193cbf07 preferences (2x)', 'Implementation %s preferences (2x)' % short, os.path.join(here, name + '-prefs-zoom.jpg'), 78)
    entry['prefsZoom'] = name + '-prefs-zoom.jpg'
    sheet(clip(ref), clip(impl), 'Reference 193cbf07: %s.png' % name, 'Implementation %s: %s' % (short, name), os.path.join(here, name + '-side-by-side.jpg'), 78)
    entry['sideBySide'] = name + '-side-by-side.jpg'

# Count strip: the head of each Your preferences section for 0..6 considered categories, stacked.
rows = []
for n in range(7):
    shot = Image.open(os.path.join(scratch, 'impl369', '1440-count-%d.png' % n)).convert('RGB')
    rows.append(shot.crop((0, 0, shot.width, min(shot.height, 230))))
strip = Image.new('RGB', (rows[0].width, 7 * (rows[0].height + STRIP)), 'white')
draw = ImageDraw.Draw(strip)
for n, row in enumerate(rows):
    top = n * (row.height + STRIP)
    draw.text((4, top + 6), 'Implementation %s: %d considered, %s' % (short, n, results['counts']['1440-count-%d' % n]['text']), fill='black', font=label)
    strip.paste(row, (0, top + STRIP))
strip.save(os.path.join(here, '1440-count-strip-implementation.jpg'), 'JPEG', quality=80)
results['countStrip'] = '1440-count-strip-implementation.jpg'

with open(os.path.join(here, 'results.json'), 'w') as f:
    json.dump(results, f, indent=2)
