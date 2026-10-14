/*
 * Shared UI primitives for the vehicle-matcher block.
 *
 * Deliberately tiny and brand-/mode-agnostic: the lowest-level helpers that
 * every interface "mode" (see modes/) needs, with no dependency on the quiz,
 * the engine client, or any brand copy. Anything a second mode would obviously
 * reuse lives here; anything still coupled to the questions flow stays in
 * modes/questionnaire.js until a second mode actually needs it.
 */

/** Create an element with an optional class and text — the workhorse the whole
 * block builds its DOM with. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Small cardinals as words, for prose where a numeral would read oddly ("the
 * three cars" beats "the 3 cars"). Anything larger falls back to the numeral,
 * which is fine — it only reads awkwardly at small counts. */
export const CARDINALS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const cardinal = (n) => CARDINALS[n] ?? String(n);

/** Money, GBP, no pence. */
export const gbp = (n) => `£${n.toLocaleString('en-GB')}`;

/**
 * Keep `container` to a single row of its children, never scrolling sideways: any child that would
 * start a second row or run past the right edge is hidden. Re-checked on resize and on new children.
 */
export function keepOneRow(container) {
  if (typeof ResizeObserver === 'undefined') return;
  let frame = 0;
  // A container that is moved (taken out and put back on a redraw) keeps its fitting, so the
  // observers aren't disconnected when it is briefly off the page; they go with the element.
  const fit = () => {
    frame = 0;
    if (!container.isConnected) return;
    const kids = [...container.children];
    kids.forEach((k) => {
      if (k.dataset.vmRowHidden) { k.style.display = ''; delete k.dataset.vmRowHidden; }
    });
    const shown = kids.filter((k) => k.getClientRects().length);
    if (!shown.length) return;
    const cs = getComputedStyle(container);
    const right = container.getBoundingClientRect().right
      - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) + 1;
    const top = shown[0].getBoundingClientRect().top + 1;
    shown.slice(1).forEach((k) => {
      const r = k.getBoundingClientRect();
      if (r.top > top || r.right > right) {
        k.style.display = 'none';
        k.dataset.vmRowHidden = '1';
      }
    });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
  const resize = new ResizeObserver(schedule);
  resize.observe(container);
  const added = new MutationObserver(schedule);
  added.observe(container, { childList: true });
}

/**
 * Size `node` to the page (less `gutter` each side, at most `maxWidth`) and centre it on the page
 * whatever its parent's offset, so the space either side is equal. The width excludes any scroll
 * bar (clientWidth, not 100vw). Re-measured as the page or node resizes, until the node is removed.
 */
export function centreOnPage(node, { maxWidth = 1400, gutter = 24 } = {}) {
  if (typeof ResizeObserver === 'undefined') return;
  const page = document.documentElement;
  let placed = false; // only a node that has been on the page can be "removed"
  const fit = () => {
    if (!node.isConnected) {
      if (!placed) return;
      observer.disconnect();
      window.removeEventListener('resize', fit);
      return;
    }
    placed = true;
    const parent = node.parentElement;
    if (!parent || node.hidden) return;
    const view = page.clientWidth;
    const width = Math.min(view - 2 * gutter, maxWidth);
    // The margin runs from the parent's content edge, so allow for its border and padding.
    const cs = getComputedStyle(parent);
    const contentLeft = parent.getBoundingClientRect().left
      + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    node.style.width = `${width}px`;
    node.style.maxWidth = 'none';
    node.style.marginLeft = `${(view - width) / 2 - contentLeft}px`;
    node.style.marginRight = '0';
    // A centring flex parent would split the margin; start-aligned, the offset lands exactly.
    node.style.alignSelf = 'flex-start';
  };
  const observer = new ResizeObserver(fit);
  observer.observe(node);
  observer.observe(page);
  window.addEventListener('resize', fit, { passive: true });
}
