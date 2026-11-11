document.querySelectorAll('[data-gallery]').forEach((gallery) => {
  const hero = gallery.querySelector('.hero');
  const thumbnails = [...gallery.querySelectorAll('.thumbs .thumb')];
  const dialog = gallery.querySelector('.gallery-dialog');
  const largeImage = dialog.querySelector('.gallery-large');
  const title = dialog.querySelector('h2');
  const position = dialog.querySelector('.gallery-position');
  const enlarge = gallery.querySelector('.gallery-enlarge');
  const allThumbnails = [...gallery.querySelectorAll('[data-gallery-index]')];
  let selected = Number(gallery.dataset.galleryStart || 0);

  function select(index) {
    selected = (index + thumbnails.length) % thumbnails.length;
    const thumbnail = thumbnails[selected];
    const image = thumbnail.querySelector('img');
    const label = thumbnail.querySelector('span').textContent;
    const description = `${label} of the BMW 3 Series Touring`;
    hero.src = image.src;
    hero.alt = description;
    largeImage.src = image.src;
    largeImage.alt = description;
    title.textContent = label;
    position.textContent = `${selected + 1} of ${thumbnails.length}`;
    enlarge.setAttribute('aria-label', `Enlarge ${label.toLowerCase()} image`);
    allThumbnails.forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.galleryIndex) === selected));
    });
    if (dialog.open) {
      const active = dialog.querySelector(`[data-gallery-index="${selected}"]`);
      const strip = active.parentElement;
      strip.scrollLeft = active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.clientWidth) / 2;
    }
  }

  allThumbnails.forEach((button) => button.addEventListener('click', () => select(Number(button.dataset.galleryIndex))));
  enlarge.addEventListener('click', () => {
    dialog.showModal();
    select(selected);
  });
  dialog.querySelector('.gallery-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.previous').addEventListener('click', () => select(selected - 1));
  dialog.querySelector('.next').addEventListener('click', () => select(selected + 1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      select(selected + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('close', () => enlarge.focus({ preventScroll: true }));
  select(selected);
  if (gallery.hasAttribute('data-gallery-open')) {
    dialog.showModal();
    select(selected);
  }
});
