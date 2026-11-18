# Brand hero photos (drop-in)

The demo homepage ([index.html](../../index.html)) shows a full-bleed hero
band behind each brand's headline. If a photo is present here it is used as the
hero background; if not, the band falls back to a flat brand-accent colour panel
(`.demo-hero.is-plain`) so the demo never looks broken. **No code change is
needed to add a photo — just drop the file in.**

## What to add

One landscape photo per brand, named exactly:

| File | Brand |
| --- | --- |
| `bmw.jpg` | BMW |
| `mini.jpg` | MINI |
| `ford.jpg` | Ford |
| `honda.jpg` | Honda |
| `motorrad.jpg` | BMW Motorrad |
| `ram.jpg` | RAM |

The shell probes `assets/brand-hero/<brand>.jpg` at load; the filename is the
only wiring. (To change it, see `renderShell`'s `heroUrl` in index.html.)

## Specs

- **Orientation:** wide/landscape. The headline overlays the left third, so
  favour images with an uncluttered left side (or a subject on the right).
- **Size:** roughly 1600px wide is plenty. Target **~200-400 KB** each so the
  demo stays snappy — compress before committing.
- **Legibility:** a dark left-weighted gradient scrim is drawn over every photo
  automatically, so light headline text stays readable over most images. Very
  bright, busy top-left corners are the only thing to avoid.

## Where to source them

Each brand's press/media newsroom serves real high-resolution brand photography
as static files (the consumer homepages are JS-gated and don't expose usable
images):

- BMW / MINI / BMW Motorrad -> BMW Group PressClub (press.bmwgroup.com)
- Ford -> Ford Media Center (media.ford.com / media.ford.co.uk)
- Honda -> Honda News EU (hondanews.eu)

RAM provenance (2026-11-18): `ram.jpg` is the official [2026 RAM 1500 marketing hero](https://www.ramtrucks.com/content/dam/fca-brands/na/ramtrucks/en_us/2026/ram-1500/overview/desktop/my26-ram-1500-vlp-hero-slider-02-desktop.jpg), resized to 1600 pixels wide. It illustrates the brand; result cards use each listing's own photo. `../brand-logos/ram.svg` embeds the unaltered official [RAM header mark](https://www.ramtrucks.com/content/dam/fca-brands/na/ramtrucks/en_us/global/header/ram-logo-black.jpg). Both source assets were linked by the official RAM 1500 page.

## Licensing

These are brand-owned, trademarked marketing assets. Committing them is
acceptable **only for this internal, non-published pitch demo**. Do not ship
them to production. The same caveat applies to the marks in
[../brand-logos/](../brand-logos/).
