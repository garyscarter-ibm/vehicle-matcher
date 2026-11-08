import { defineGcspManualGallery } from './gcsp-manual-gallery.js';

const fixture = new URL(globalThis.location.href).searchParams.get('fixture');
if (fixture) {
  const { createManualGalleryFixtureAdapter, MANUAL_GALLERY_FIXTURES } = await import('./fixtures.js');
  if (MANUAL_GALLERY_FIXTURES.includes(fixture)) {
    const block = document.querySelector('gcsp-manual-gallery');
    if (block) block.adapter = createManualGalleryFixtureAdapter(fixture);
  }
}
defineGcspManualGallery();
