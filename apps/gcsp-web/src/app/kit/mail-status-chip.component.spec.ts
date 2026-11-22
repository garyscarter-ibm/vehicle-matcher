import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { MailStatusChipComponent } from './mail-status-chip.component';

const CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
const REFRESH = ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'];
const CROSS = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9 9l6 6', 'M15 9l-6 6'];
const CLOCK = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'];

describe('MailStatusChipComponent source presentation', () => {
  let fixture: ComponentFixture<MailStatusChipComponent> | undefined;
  afterEach(() => { fixture?.destroy(); fixture = undefined; TestBed.resetTestingModule(); });
  async function render(state: string, transport: string | null = null, label = 'Delivery status unknown') {
    fixture = TestBed.createComponent(MailStatusChipComponent);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('transport', transport);
    fixture.componentRef.setInput('label', label);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it.each([
    ['sent', 'captured', 'ok', CHECK],
    ['sent', 'configured', 'ok', CHECK],
    ['sent', null, 'wait', CLOCK],
    ['sent', 'unrecognised', 'wait', CLOCK],
    ['pending', null, 'wait', CLOCK],
    ['sending', null, 'wait', CLOCK],
    ['retrying', null, 'warn', REFRESH],
    ['failed', null, 'bad', CROSS],
    ['provider-awaiting-proof', 'configured', 'wait', CLOCK],
    ['toString', 'configured', 'wait', CLOCK],
    ['', null, 'wait', CLOCK],
  ] as const)('pairs %s/%s with the source %s tone and icon', async (state, transport, tone, paths) => {
    const root = await render(state, transport);
    const chip = root;
    expect(chip.className).toBe(`gcsp-mail-status is-${tone}`);
    expect(Array.from(chip.children).map(node => node.tagName.toLowerCase())).toEqual(['svg', 'span']);
    expect(Array.from(chip.querySelectorAll('svg > path')).map(path => path.getAttribute('d'))).toEqual(paths);
  });

  it('keeps the source SVG decorative so only the supplied label names the status', async () => {
    const root = await render('retrying', 'configured', 'Retrying');
    const svg = root.querySelector('svg')!;
    for (const [attribute, value] of Object.entries({
      class: 'gcsp-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    })) expect(svg.getAttribute(attribute)).toBe(value);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.querySelector('title')).toBeNull();
    expect(root.querySelector(':scope > span')?.textContent).toBe('Retrying');
    expect(root.querySelector('[role], [aria-label], [tabindex]')).toBeNull();
  });

  it('replaces an accepted check with a neutral clock when transport becomes unknown', async () => {
    const root = await render('sent', 'configured', 'Accepted by email provider');
    fixture!.componentRef.setInput('transport', null);
    fixture!.componentRef.setInput('label', 'Delivery status unknown');
    await fixture!.whenStable();
    expect(root.className).toBe('gcsp-mail-status is-wait');
    expect(Array.from(root.querySelectorAll('path')).map(path => path.getAttribute('d'))).toEqual(CLOCK);
    expect(root.querySelector(':scope > span')?.textContent).toBe('Delivery status unknown');
  });

  it('renders supplied copy as text without treating it as markup', async () => {
    const label = '<img src=x onerror=alert(1)> Preparing';
    const root = await render('pending', null, label);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector(':scope > span')?.textContent).toBe(label);
  });
});
