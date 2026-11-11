# Side-by-sides: frozen reference crop on the left, gallery implementation on the right.
import sys
from PIL import Image, ImageDraw
ref_dir, shots, out = sys.argv[1:4]
PAIRS = [
    ('1440-selected-side-by-side.png', 'review/1440-selected.png', (560, 560, 911, 660), '1440-c-five.png', 'bottom-right'),
    ('1440-initial-side-by-side.png', 'review/1440-initial.png', (560, 560, 911, 660), '1440-b-selected.png', 'bottom-right'),
    ('320-rating-tooltip-long-side-by-side.png', 'review/320-rating-tooltip-long.png', (0, 180, 320, 345), '320-d-tip-long.png', 'whole'),
]
for name, ref, box, impl, mode in PAIRS:
    left = Image.open(f'{ref_dir}/{ref}').convert('RGB').crop(box)
    right = Image.open(f'{shots}/{impl}').convert('RGB')
    if mode == 'bottom-right':
        w, h = right.size; right = right.crop((max(0, w - (box[2] - box[0])), h - (box[3] - box[1]), w, h))
    gap = 16; label = 18
    sheet = Image.new('RGB', (left.width + right.width + gap, max(left.height, right.height) + label), 'white')
    d = ImageDraw.Draw(sheet); d.text((2, 2), 'reference', fill='black'); d.text((left.width + gap + 2, 2), 'implementation', fill='black')
    sheet.paste(left, (0, label)); sheet.paste(right, (left.width + gap, label)); sheet.save(f'{out}/{name}', optimize=True)
