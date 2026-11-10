// One bounded browser pass. The Python supervisor owns TMPDIR and process teardown.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = `${folder}review`;
await mkdir(output, { recursive: true });
const port = process.env.MOCKUP_PORT ?? '4876';
const base = `http://127.0.0.1:${port}/docs/gcsp/mockups/account-preferences-2026-11-10/index.html`;
const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });
const serverExit = once(server, 'exit');
let browser;
const receipt = { run: 'account-preferences-20261110-01a1c6a0', kind: 'scoped mockup review', checks: [], screenshots: [], consoleErrors: [], failures: [], codeIdentity: {}, independentReview: 'See visual-review.md for independent critique and corrective review.' };
const check = (label, passed) => { receipt.checks.push({ label, passed }); assert.ok(passed, label); };
try {
  await once(server.stdout, 'data');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  receipt.environment = { browser: browser.version(), deviceScaleFactor: 1, reducedMotion: 'reduce', capture: 'fullPage', locale: 'en-GB' };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', locale: 'en-GB' });
  const page = await context.newPage();
  page.on('pageerror', (error) => receipt.consoleErrors.push(error.message));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('gcsp:account-preferences-discussion:2026-11-10:v1')));
  const colours = (selector) => page.locator(selector).first().evaluate((node) => {
    const style = getComputedStyle(node.matches('.concept-category-open') ? node.parentElement : node);
    return { background: style.backgroundColor, border: style.borderColor, colour: style.color };
  });
  const snap = async (name) => {
    await page.evaluate(() => scrollTo(0, 0));
    const state = await page.evaluate(() => ({
      model: document.querySelector('#current-car-title').innerText,
      rating: Number(document.querySelector('.concept-stars input:checked')?.value ?? 0),
      buddy: document.querySelector('#buddy-status').innerText,
      understanding: document.querySelector('.concept-score-value').innerText,
      sameAgain: document.querySelector('#same-again').checked,
      categories: [...document.querySelectorAll('.concept-category')].map((node) => ({
        label: node.querySelector('.concept-category-open').getAttribute('aria-label'),
        considered: node.classList.contains('is-considered'), important: node.classList.contains('is-important'),
        expanded: node.querySelector('.concept-category-open').getAttribute('aria-expanded'),
      })),
      visibleTooltips: [...document.querySelectorAll('[role=tooltip]:not([hidden])')].map((node) => node.id),
      record: document.querySelector('[role=dialog]')?.innerText ?? null,
      feedback: document.querySelector('#preference-status').innerText,
      activeElement: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id,
    }));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    receipt.screenshots.push(`${name}.png`);
    (receipt.captures ??= []).push({ file: `${name}.png`, viewport: page.viewportSize(), fixtureQuery: new URL(page.url()).search, state });
  };
  const fit = async (name) => {
    await page.locator('.vm-card-photo').evaluate((image) => image.complete ? undefined : new Promise((resolve) => image.addEventListener('load', resolve, { once: true })));
    const result = await page.evaluate(() => {
      const bounds = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const image = document.querySelector('.vm-card-photo'); const imageBox = bounds('.vm-card-photo');
      const scale = Math.min(imageBox.width / image.naturalWidth, imageBox.height / image.naturalHeight);
      const drawnImage = { x: imageBox.x + (imageBox.width - image.naturalWidth * scale) / 2,
        y: imageBox.y + (imageBox.height - image.naturalHeight * scale) / 2,
        width: image.naturalWidth * scale, height: image.naturalHeight * scale };
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, image: !!document.querySelector('.vm-card-photo')?.naturalWidth,
        imageBox, drawnImage,
        media: bounds('.vm-card-media'), rating: bounds('.concept-rating'), ratingBackground: getComputedStyle(document.querySelector('.concept-rating')).backgroundColor,
        canvas: bounds('.concept-page'), content: bounds('.gcsp-content'),
        buddyFont: parseFloat(getComputedStyle(document.querySelector('#buddy-status')).fontSize),
        buddyLamp: bounds('.concept-buddy-lamp') };
    });
    (receipt.viewports ??= []).push({ name, ...result });
    check(`${name}: no horizontal page overflow`, result.scroll <= result.width);
    check(`${name}: car image has useful height`, result.media.height >= 140);
    check(`${name}: rating is a compact transparent image overlay`, result.rating.height <= 48 && result.ratingBackground === 'rgba(0, 0, 0, 0)'
      && result.rating.x >= result.drawnImage.x + 4 && result.rating.x + result.rating.width <= result.drawnImage.x + result.drawnImage.width - 4
      && result.rating.y >= result.drawnImage.y + 4 && result.rating.y + result.rating.height <= result.drawnImage.y + result.drawnImage.height - 4);
    check(`${name}: media wraps the actual image without internal letterboxing`, Math.abs(result.media.height - result.drawnImage.height) < 1
      && Math.abs(result.media.y - result.drawnImage.y) < 1);
    check(`${name}: rating sits at the right image edge`, Math.abs(result.drawnImage.x + result.drawnImage.width - result.rating.x - result.rating.width - 8) < 1);
    check(`${name}: Buddy status and lamp have prominent readable sizing`, result.buddyFont >= 20 && result.buddyLamp.width === 18 && result.buddyLamp.height === 18);
    return result;
  };
  await page.goto(`${base}?state=empty`); await page.locator('.concept-page').waitFor(); await page.evaluate(() => document.fonts.ready);
  check('Initially show categories without options', !await page.locator('#category-options').isVisible());
  check('Initial understanding is 1 of 11', await page.locator('.concept-score-value').innerText() === '1 / 11');
  check('Six supported categories', await page.locator('.concept-category').count() === 6);
  check('Buddy starts disengaged with an explicit label', await page.locator('#buddy-status').innerText() === 'Buddy disengaged');
  check('Account header contains no allowance information', !/allowance|1,300|points/i.test(await page.locator('.concept-page-head').innerText()));
  check('Points cost lives in current-car facts with cost and budget', await page.locator('.concept-car .vm-fact').filter({ hasText: 'Points cost' }).innerText() === 'Points cost\n1,100 / 1,300 points per month');
  check('Preferences have no Save button', await page.getByRole('button', { name: /Save preferences/i }).count() === 0);
  check('Your Cars imports only GC’s replacement control', await page.locator('.concept-car').getByRole('button', { name: 'Choose a replacement', exact: true }).count() === 1
    && await page.locator('.concept-car .gcsp-account-key, .concept-car .gcsp-summary-live, .concept-car .gcsp-account-rows, .concept-car .gcsp-data-table').count() === 0);
  check('GC history and details follow Preferences in both document and layout order', await page.evaluate(() => {
    const preferences = document.querySelector('#your-preferences'); const history = document.querySelector('.gcsp-account-history');
    const details = document.querySelector('.gcsp-account-section');
    return !!(preferences.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!(history.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)
      && history.getBoundingClientRect().top >= preferences.getBoundingClientRect().bottom
      && details.getBoundingClientRect().top >= history.getBoundingClientRect().bottom;
  }));
  check('GC components retain the single shared history table and Employee/Drivers rows', await page.locator('.concept-secondary table').count() === 1
    && await page.locator('.gcsp-account-row').count() === 2 && await page.locator('.concept-secondary details').count() === 0);
  check('GC record projection handles supplied hyphenated statuses', await page.evaluate(async () => {
    const { recordSections } = await import('./gc-record-preview.js');
    const sections = recordSections({ contract: { status: 'awaiting-order', orderStatus: 'awaiting-release' }, model: { slots: [] } });
    return sections.map((node) => node.textContent).join(' ').includes('Awaiting order')
      && sections.map((node) => node.textContent).join(' ').includes('Awaiting release');
  }));
  await page.getByRole('button', { name: 'Choose a replacement', exact: true }).click();
  check('Discussion replacement action does not navigate or submit an order', page.url() === `${base}?state=empty`
    && (await page.locator('#preference-status').innerText()).includes('does not place an order'));
  await page.locator('h1').click();
  const sameInfo = page.getByRole('button', { name: 'About Same again, please!', exact: true });
  const sameTip = page.locator('#same-again-help');
  const ratingTip = page.locator('#rating-help');
  const description = 'BMW 3 Series Touring 320i M Sport · Petrol';
  check('Same again guidance lives in an initially hidden tooltip', !await sameTip.isVisible()
    && await sameTip.textContent() === `Select this option if you just love everything about your current car, and your next best car would be another ${description}`);
  await sameInfo.hover();
  check('Same again info reveals help on hover', await sameTip.isVisible());
  await snap('1440-same-tooltip');
  await sameTip.hover();
  check('Tooltip remains available when the pointer enters its text', await sameTip.isVisible());
  await page.locator('h1').hover();
  check('Hover tooltip closes after pointer leaves', !await sameTip.isVisible());
  await sameInfo.focus();
  check('Same again info reveals help on keyboard focus', await sameTip.isVisible());
  await page.keyboard.press('Escape');
  check('Escape dismisses help without moving focus', !await sameTip.isVisible() && await sameInfo.evaluate((node) => node === document.activeElement));
  await sameInfo.click();
  check('Tapping info opens help without selecting Same again', await sameTip.isVisible()
    && !await page.getByRole('switch', { name: 'Same again, please!', exact: true }).isChecked());
  await page.locator('h1').click();
  check('Outside tap dismisses help', !await sameTip.isVisible());
  await page.getByRole('radio', { name: '3 stars: It’s okay', exact: true }).hover();
  check('Stars show the requested current-car tooltip on hover', await ratingTip.isVisible()
    && await ratingTip.textContent() === `How highly do you rate your ${description}?`);
  await snap('1440-rating-tooltip');
  await page.getByRole('radio', { name: '3 stars: It’s okay', exact: true }).focus();
  check('Stars also expose help on keyboard focus', await ratingTip.isVisible());
  await page.keyboard.press('Escape');
  check('Rating tooltip closes on Escape and retains radio focus', !await ratingTip.isVisible()
    && await page.getByRole('radio', { name: '3 stars: It’s okay', exact: true }).evaluate((node) => node === document.activeElement));
  const threeStars = page.getByRole('radio', { name: '3 stars: It’s okay', exact: true });
  await threeStars.click();
  check('Selecting a star dismisses its tooltip while retaining focus', !await ratingTip.isVisible()
    && await threeStars.isChecked() && await threeStars.evaluate((node) => node === document.activeElement));
  await threeStars.click();
  check('Clicking the selected star clears and saves the rating', await page.locator('.concept-stars input:checked').count() === 0
    && (await stored()).rating === 0 && !await ratingTip.isVisible());
  await page.goto(base); await page.locator('.concept-page').waitFor();
  check('Cleared rating survives reload', await page.locator('.concept-stars input:checked').count() === 0);
  await threeStars.focus(); await page.keyboard.press('Space');
  check('Space selects a focused star and dismisses help', await threeStars.isChecked() && !await ratingTip.isVisible());
  await page.keyboard.press('Space');
  check('Space on the selected star clears it and keeps focus', await page.locator('.concept-stars input:checked').count() === 0
    && await threeStars.evaluate((node) => node === document.activeElement) && !await ratingTip.isVisible());
  await page.keyboard.press('ArrowRight');
  check('Native arrow navigation still selects the next star and dismisses help', await page.getByRole('radio', { name: '4 stars: I really like it', exact: true }).isChecked()
    && (await stored()).rating === 4 && !await ratingTip.isVisible());
  await page.locator('h1').click();
  const lamp = async () => page.locator('.concept-buddy-lamp').evaluate((node) => { const style = getComputedStyle(node); return { colour: style.backgroundColor, animation: style.animationName }; });
  const red = await lamp();
  check('Disengaged lamp is static red', red.animation === 'none' && Number(red.colour.match(/\d+/g)[0]) > Number(red.colour.match(/\d+/g)[1]));
  check('Real local car image loads', (await fit('1440 initial')).image);
  check('No inline script/event handlers', await page.locator('script:not([src]),[onclick],[onchange]').count() === 0);
  await snap('1440-initial');
  await page.getByRole('button', { name: 'Engage Buddy', exact: true }).click();
  check('Fewer than three categories gets a clear validation', (await page.locator('#preference-status').innerText()).includes('Choose 3 more categories'));
  await snap('1440-validation');
  for (const [category, option] of [['body', 'Touring / Estate'], ['fuel', 'Petrol'], ['comfort', 'As comfortable as possible']]) {
    await page.locator(`#category-${category}`).click();
    if (category === 'comfort') {
      const slider = page.getByRole('slider', { name: 'How much comfort would you like?', exact: true });
      check('Three-stop slider defaults to the middle choice', await slider.inputValue() === '50' && await slider.getAttribute('step') === '50' && await slider.getAttribute('aria-valuetext') === 'A bit of both');
      check('Opening a three-stop category considers and auto-saves its midpoint', await page.locator('.concept-category.is-considered').count() === 3
        && await page.evaluate(() => JSON.parse(localStorage.getItem('gcsp:account-preferences-discussion:2026-11-10:v1')).values.comfort === '50'));
      await snap('1440-slider-default');
      await page.goto(base); await page.locator('.concept-page').waitFor();
      check('Midpoint survives reload without pressing Done', await page.getByRole('button', { name: 'Comfort, considered: A bit of both', exact: true }).count() === 1);
      await page.locator('#category-comfort').click();
      await slider.focus(); await page.keyboard.press('Home');
      check('Slider Home selects and names the first choice', await slider.inputValue() === '0' && await slider.getAttribute('aria-valuetext') === 'Simple and functional');
      await page.keyboard.press('End');
      check('Slider End selects and names the last choice', await slider.inputValue() === '100' && await slider.getAttribute('aria-valuetext') === option);
    } else await page.getByRole('checkbox', { name: option, exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  check('Three configured categories are distinct', await page.locator('.concept-category.is-considered').count() === 3);
  for (const [category, selection] of [['Body', 'Touring / Estate'], ['Fuel', 'Petrol'], ['Comfort', 'As comfortable as possible']]) {
    check(`${category} announces its retained choice`, await page.getByRole('button', { name: `${category}, considered: ${selection}`, exact: true }).count() === 1);
  }
  check('Three configured categories illustrate score 6', await page.locator('.concept-score-value').innerText() === '6 / 11');
  await page.getByRole('radio', { name: '5 stars: I love it', exact: true }).check();
  check('Preference edits give automatic-save feedback', (await page.locator('#preference-status').innerText()).includes('saved automatically'));
  await page.goto(base); await page.locator('.concept-page').waitFor();
  check('Reload preserves three categories without a save action', await page.locator('.concept-category.is-considered').count() === 3);
  check('Reload preserves five-star rating', await page.getByRole('radio', { name: '5 stars: I love it', exact: true }).isChecked());
  check('Editing preferences does not silently engage Buddy', await page.locator('#buddy-status').innerText() === 'Buddy disengaged');
  await page.getByRole('button', { name: 'Engage Buddy', exact: true }).click();
  check('Explicit engagement updates top status and main action', await page.locator('#buddy-status').innerText() === 'Buddy engaged' && await page.getByRole('button', { name: 'Disengage Buddy', exact: true }).count() === 1);
  const green = await lamp();
  check('Engaged lamp is static green', green.animation === 'none' && Number(green.colour.match(/\d+/g)[1]) > Number(green.colour.match(/\d+/g)[0]));
  await page.reload(); await page.locator('.concept-page').waitFor();
  check('Reload preserves explicit engagement', await page.locator('#buddy-status').innerText() === 'Buddy engaged');
  await snap('1440-selected');
  await page.getByRole('button', { name: 'Disengage Buddy', exact: true }).click();
  check('Disengage keeps preferences and changes the lamp', await page.locator('.concept-category.is-considered').count() === 3 && await page.locator('#buddy-status').innerText() === 'Buddy disengaged' && (await lamp()).colour === red.colour);
  await page.getByRole('button', { name: 'Engage Buddy', exact: true }).click();
  await page.locator('#category-body').click(); await snap('1440-options');
  await page.getByRole('button', { name: 'Remove Body preference', exact: true }).click();
  check('Remove asks for confirmation', await page.getByRole('button', { name: 'Remove preference', exact: true }).isVisible());
  check('Bin action has not removed or saved a deletion', await page.evaluate(() => !!JSON.parse(localStorage.getItem('gcsp:account-preferences-discussion:2026-11-10:v1')).values.body));
  await snap('1440-remove-confirmation');
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  check('Cancel retains category', await page.locator('.concept-category.is-considered').count() === 3);
  check('Cancel preserves engagement', await page.locator('#buddy-status').innerText() === 'Buddy engaged');
  await page.getByRole('button', { name: 'Remove Body preference', exact: true }).click();
  await page.getByRole('button', { name: 'Remove preference', exact: true }).click();
  check('Confirmed removal clears category', await page.locator('.concept-category.is-considered').count() === 2);
  check('Falling below the minimum clearly disengages Buddy', await page.locator('#buddy-status').innerText() === 'Buddy disengaged' && (await page.locator('#preference-status').innerText()).includes('Buddy disengaged'));
  await page.reload(); await page.locator('.concept-page').waitFor();
  check('Confirmed deletion auto-saves and survives reload', await page.locator('.concept-category.is-considered').count() === 2);
  await page.locator('#category-body').click(); await page.getByRole('checkbox', { name: 'Touring / Estate', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).check();
  check('Same again is 11', await page.locator('.concept-score-value').innerText() === '11 / 11');
  check('Same again disables six category selectors', await page.locator('.concept-category-open:disabled').count() === 6);
  check('Same again keeps stored categories', await page.locator('.concept-category.is-considered').count() === 3);
  await snap('1440-same-again');
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).uncheck();
  check('Untoggle restores categories and normal score', await page.locator('.concept-score-value').innerText() === '6 / 11');
  for (const category of ['sportiness', 'economy', 'size']) {
    await page.locator(`#category-${category}`).click();
    check(`${category} opens and saves the neutral midpoint`, await page.locator('#category-options input[type=range]').inputValue() === '50'
      && await page.evaluate((id) => JSON.parse(localStorage.getItem('gcsp:account-preferences-discussion:2026-11-10:v1')).values[id] === '50', category));
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    check(`${category} Done only closes its options`, !await page.locator('#category-options').isVisible()
      && (await page.locator(`#category-${category}`).getAttribute('aria-label')).includes('A bit of both'));
  }
  check('All preference categories cap the score at 10', await page.locator('.concept-score-value').innerText() === '10 / 11');
  for (const [width, variant] of [[1920, 'selected'], [1100, 'selected'], [1024, 'selected'], [900, 'selected'], [820, 'selected'], [375, 'selected'], [320, 'long']]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}?state=${variant}`); await page.locator('.concept-page').waitFor();
    await fit(`${width} ${variant}`); await snap(`${width}-${variant}`);
    if (width === 375) {
      await page.getByRole('button', { name: 'Engage Buddy', exact: true }).click();
      await snap('375-engaged');
    }
    if (width === 320) {
      await page.locator('#category-comfort').click(); await fit('320 long options'); await snap('320-long-options');
      const slider = page.getByRole('slider', { name: 'How much comfort would you like?', exact: true });
      await slider.focus();
      await page.keyboard.press('Home'); check('Narrow slider Home picks first choice', await slider.inputValue() === '0');
      await page.keyboard.press('ArrowRight'); check('One arrow moves exactly one slider stop', await slider.inputValue() === '50' && await slider.getAttribute('aria-valuetext') === 'A bit of both');
      await snap('320-slider-midpoint');
      await page.keyboard.press('End'); check('Narrow slider End picks last choice', await slider.inputValue() === '100');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Remove Comfort preference', exact: true }).click(); await fit('320 remove confirmation'); await snap('320-remove-confirmation');
      await page.getByRole('button', { name: 'Keep it', exact: true }).click();
      await page.getByRole('switch', { name: 'Same again, please!', exact: true }).check(); await snap('320-same-again');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(`${base}?state=empty`); await page.locator('.concept-page').waitFor();
  await page.locator('#category-body').click();
  const importance = page.getByRole('switch', { name: 'This is really important', exact: true });
  const estate = page.getByRole('checkbox', { name: 'Touring / Estate', exact: true });
  check('Importance is one visible switch with no disclosure or three-choice control', await importance.isVisible()
    && await page.locator('#category-options details, #category-options input[type=radio]').count() === 0);
  check('Unchosen preference disables and unchecks importance', await importance.isDisabled() && !await importance.isChecked());
  check('Unchosen preference has an accessible selection hint', await importance.getAttribute('aria-describedby') === 'importance-hint'
    && await page.getByText('Choose a preference first.', { exact: true }).isVisible());
  await snap('1440-importance-unselected');
  await estate.check();
  check('Chosen preference automatically saves medium importance', (await stored()).weights.body === 'medium'
    && await importance.isEnabled() && !await importance.isChecked());
  check('Chosen preference removes the obsolete selection hint', await importance.getAttribute('aria-describedby') === null
    && !await page.getByText('Choose a preference first.', { exact: true }).isVisible());
  await snap('1440-importance-medium');
  const mediumColour = await colours('#category-body');
  const mediumOptionColour = await colours('#category-options .vm-option.is-selected');
  const mediumScore = await page.locator('.concept-score-value').innerText();
  await page.locator('.concept-importance label').click();
  check('Clicking the importance label saves high', await importance.isChecked() && (await stored()).weights.body === 'high');
  const highColour = await colours('#category-body');
  check('High importance changes both category and selected-option colour', highColour.background !== mediumColour.background
    && highColour.border !== mediumColour.border && (await colours('#category-options .vm-option.is-selected')).background !== mediumOptionColour.background);
  check('High importance is announced as well as coloured', (await page.locator('#category-body').getAttribute('aria-label')).includes('really important'));
  check('Importance does not add categories or inflate understanding', await page.locator('.concept-score-value').innerText() === mediumScore
    && await page.locator('.concept-category.is-considered').count() === 1);
  await snap('1440-importance-high');
  await importance.focus(); await page.keyboard.press('Space');
  check('Space switches importance back to medium and keeps focus', !await importance.isChecked()
    && (await stored()).weights.body === 'medium' && await importance.evaluate((node) => node === document.activeElement));
  check('Turning importance off restores normal selection colour', (await colours('#category-body')).background === mediumColour.background);
  await page.keyboard.press('Space');
  check('Space enables high importance without replacing the focused input', await importance.isChecked()
    && (await stored()).weights.body === 'high' && await importance.evaluate((node) => node === document.activeElement));
  await page.goto(base); await page.locator('.concept-page').waitFor(); await page.locator('#category-body').click();
  check('Reload preserves high importance', await importance.isChecked() && (await stored()).weights.body === 'high');
  await estate.uncheck();
  check('Clearing the final option immediately clears importance', await importance.isDisabled() && !await importance.isChecked()
    && !Object.hasOwn((await stored()).weights, 'body') && !Object.hasOwn((await stored()).values, 'body'));
  await estate.check();
  check('Choosing again after clearing starts at medium', (await stored()).weights.body === 'medium' && !await importance.isChecked());
  await importance.check();
  await page.getByRole('button', { name: 'Remove Body preference', exact: true }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  check('Cancelling removal preserves high importance', (await stored()).weights.body === 'high');
  await page.locator('#category-body').click();
  check('Cancelled preference reopens with high importance', await importance.isChecked());
  await page.getByRole('button', { name: 'Remove Body preference', exact: true }).click();
  await page.getByRole('button', { name: 'Remove preference', exact: true }).click();
  check('Confirmed bin removal clears its importance', !Object.hasOwn((await stored()).weights, 'body'));
  await page.locator('#category-body').click(); await estate.check();
  check('Choosing a removed category again defaults to medium', !await importance.isChecked() && (await stored()).weights.body === 'medium');
  await importance.check();
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).check();
  check('Same again makes importance unavailable while retaining it', await importance.count() === 0
    && !await page.locator('#category-options').isVisible() && (await stored()).weights.body === 'high');
  const overriddenColour = await colours('#category-body');
  check('Same again removes blue and urgent selection colours', overriddenColour.background !== mediumColour.background
    && overriddenColour.background !== highColour.background && overriddenColour.background === (await colours('#category-fuel')).background
    && await page.locator('.concept-category.is-important').count() === 0);
  await snap('1440-same-again-retained-high');
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).uncheck(); await page.locator('#category-body').click();
  check('Turning Same again off restores retained high importance', await importance.isChecked());
  check('Turning Same again off restores urgent selection colour', (await colours('#category-body')).background === highColour.background);
  await page.setViewportSize({ width: 320, height: 1000 }); await page.goto(`${base}?state=empty`); await page.locator('#category-fuel').click();
  check('Unchosen Fuel is also unimportant', await importance.isDisabled() && !await importance.isChecked());
  await fit('320 importance unselected'); await snap('320-importance-unselected');
  const hybrid = page.getByRole('checkbox', { name: 'Plug-in hybrid', exact: true });
  await hybrid.check();
  check('Fuel selection saves medium by default', (await stored()).weights.fuel === 'medium' && !await importance.isChecked());
  await importance.check(); await fit('320 importance high'); await snap('320-importance-high');
  await hybrid.uncheck();
  check('Clearing final Fuel option also clears high importance', await importance.isDisabled() && !await importance.isChecked()
    && !Object.hasOwn((await stored()).weights, 'fuel'));
  await page.goto(`${base}?state=long`); await page.locator('.concept-page').waitFor();
  await sameInfo.click();
  check('Narrow touch opens Same again tooltip', await sameTip.isVisible());
  const helpBounds = await sameTip.boundingBox();
  check('Long Same again guidance stays inside the 320px viewport', helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= 320);
  check('Tooltip uses the full long model and specification', (await sameTip.textContent()).includes('BMW 3 Series 330e xDrive M Sport Pro Touring M Sport Pro · Plug-in hybrid · BMW Individual specification'));
  await snap('320-same-tooltip-long');
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).check();
  await snap('320-same-again-neutral');
  check('Narrow Same again keeps saved preferences neutral', (await colours('#category-body')).background === (await colours('#category-size')).background);
  const fourStars = page.getByRole('radio', { name: '4 stars: I really like it', exact: true });
  await fourStars.focus();
  const ratingHelpBounds = await ratingTip.boundingBox();
  check('Narrow focus reveals help before rating interaction', await ratingTip.isVisible() && await fourStars.isChecked());
  check('Long rating tooltip remains in the 320px viewport', ratingHelpBounds.x >= 0 && ratingHelpBounds.x + ratingHelpBounds.width <= 320);
  await snap('320-rating-tooltip-long');
  await fourStars.click();
  check('Narrow repeated activation clears the rating and dismisses help', await page.locator('.concept-stars input:checked').count() === 0
    && (await stored()).rating === 0 && !await ratingTip.isVisible());
  await fourStars.click();
  check('Narrow activation selects and saves a star without sticky help', await fourStars.isChecked()
    && (await stored()).rating === 4 && !await ratingTip.isVisible());
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => localStorage.setItem('gcsp:account-preferences-discussion:2026-11-10:v1', JSON.stringify({
    values: { body: ['estate'], fuel: [], comfort: '0', economy: 'invalid' },
    weights: { body: 'low', fuel: 'high', comfort: 'high', sportiness: 'high', economy: 'high' },
  })));
  await page.goto(base); await page.locator('#category-body').click();
  check('Legacy selected low importance normalizes to medium', await importance.isEnabled() && !await importance.isChecked());
  await page.getByRole('radio', { name: '4 stars: I really like it', exact: true }).check();
  const normalized = (await stored()).weights;
  check('Normalized storage removes weights for empty or invalid preferences', normalized.body === 'medium' && normalized.comfort === 'high'
    && Object.keys(normalized).length === 2);
  await page.locator('#category-comfort').click();
  check('A selected slider retains its high importance', await importance.isChecked());
  await page.goto(`${base}?state=missing`); await page.locator('.concept-page').waitFor(); await snap('1440-missing-image');
  check('Missing car image has a useful fallback', await page.getByText('No image available for your car', { exact: true }).isVisible());
  const contrast = await page.locator('.vm-card-soon').evaluate((node) => {
    const luminance = (rgb) => {
      const channels = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => Number(v) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const text = luminance(getComputedStyle(node).color); const background = luminance(getComputedStyle(node.parentElement).backgroundColor);
    return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
  });
  check('Missing-image text has readable contrast', contrast >= 4.5);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}?state=selected`);
    const record = page.locator('.gcsp-account-history tbody button').first();
    await record.click();
    const drawer = page.getByRole('dialog');
    check(`${width}: GC record opens in the shared drawer`, await drawer.isVisible()
      && await drawer.getByRole('heading', { name: 'BMW 3 Series Touring 320i', exact: true }).count() === 1);
    check(`${width}: record sections identify contract, collection and vehicle`, await drawer.getByRole('heading', { name: 'Contract', exact: true }).count() === 1
      && await drawer.getByRole('heading', { name: 'Order and vehicle', exact: true }).count() === 1);
    const box = await drawer.boundingBox();
    check(`${width}: drawer fits the viewport`, box.x >= 0 && box.x + box.width <= width);
    await snap(`${width}-record-drawer`);
    await page.keyboard.press('Escape');
    check(`${width}: closing record returns focus to its named row`, !await drawer.count() && await record.evaluate((node) => node === document.activeElement));
  }
  check('No uncaught page errors', receipt.consoleErrors.length === 0);
} catch (error) { receipt.failures.push(error.stack); process.exitCode = 1; }
finally {
  await browser?.close(); server.kill('SIGTERM'); await serverExit;
  for (const name of ['index.html', 'mockup.js', 'mockup.css', 'gc-record-preview.js']) receipt.codeIdentity[name] = createHash('sha256').update(await readFile(`${folder}${name}`)).digest('hex');
  await writeFile(`${output}/browser-review.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ checks: receipt.checks.length, screenshots: receipt.screenshots.length, failures: receipt.failures, consoleErrors: receipt.consoleErrors }));
}
