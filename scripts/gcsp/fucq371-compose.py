#!/usr/bin/env python3
"""FUCQ-371 C2: compose old|feedback side-by-sides (JPEG q85) from the capture folder. Usage: fucq371-compose.py <dir>"""
import sys, os
from PIL import Image, ImageDraw

d = sys.argv[1]
GAP, LABEL = 24, 28
for width in (1440, 375, 320):
    for other in ('feedback', 'feedback-longname', 'improvement-longname'):
        a, b = os.path.join(d, f'old-{width}.png'), os.path.join(d, f'{other}-{width}.png')
        if not (os.path.exists(a) and os.path.exists(b)):
            continue
        left, right = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
        h = max(left.height, right.height)
        sheet = Image.new('RGB', (left.width + right.width + GAP, h + LABEL), (255, 255, 255))
        draw = ImageDraw.Draw(sheet)
        draw.text((6, 8), f'old brief ({width})', fill=(0, 0, 0))
        draw.text((left.width + GAP + 6, 8), f'{other} ({width})', fill=(0, 0, 0))
        sheet.paste(left, (0, LABEL)); sheet.paste(right, (left.width + GAP, LABEL))
        out = os.path.join(d, f'side-by-side-old-vs-{other}-{width}.jpg')
        sheet.save(out, 'JPEG', quality=85)
        print(out, os.path.getsize(out))
