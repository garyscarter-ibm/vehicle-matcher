import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SideDrawerComponent } from './side-drawer.component';

@Component({
  imports: [SideDrawerComponent],
  template: `<button #opener type="button">Open details</button>
    <gcsp-side-drawer title="Car details" [context]="context()" [dismissible]="dismissible()" (closed)="closedCount = closedCount + 1">
      <p>Supplied details</p><a href="#car-record">Car record</a>
      <button type="button" disabled>Unavailable</button>
      <div hidden><button type="button">Hidden action</button></div>
      <div inert><button type="button">Inert action</button></div>
      <fieldset disabled><input aria-label="Unavailable field" /></fieldset>
      <details><summary>Scheme terms</summary><input aria-label="Hidden terms field" /></details>
      <button drawer-footer type="button">Continue</button>
    </gcsp-side-drawer>`,
})
class DrawerHost {
  readonly context = signal('Your offer');
  readonly dismissible = signal(true);
  closedCount = 0;
  @ViewChild('opener', { static: true }) opener!: ElementRef<HTMLButtonElement>;
  @ViewChild(SideDrawerComponent) drawer!: SideDrawerComponent;
}

async function host() {
  const fixture = TestBed.createComponent(DrawerHost);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  root.dataset['drawerFixture'] = '';
  document.body.append(root);
  const overlay = root.querySelector<HTMLElement>('.gcsp-side-drawer')!;
  const panel = root.querySelector<HTMLElement>('.gcsp-side-drawer-panel')!;
  return { fixture, root, overlay, panel, drawer: fixture.componentInstance.drawer, opener: fixture.componentInstance.opener.nativeElement };
}

function key(value: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('[data-drawer-fixture]').forEach(node => node.remove());
  document.body.style.overflow = '';
});

describe('SideDrawerComponent', () => {
  it('exposes one source-labelled aside with a separate backdrop, head, body and action foot', async () => {
    const { root, overlay, panel } = await host();
    expect(root.querySelector('dialog')).toBeNull();
    expect(overlay.hidden).toBe(true);
    expect(Array.from(overlay.children).map(node => `${node.tagName}.${node.className}`)).toEqual([
      'DIV.gcsp-side-drawer-backdrop', 'ASIDE.gcsp-side-drawer-panel',
    ]);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(Array.from(panel.children).map(node => node.className)).toEqual([
      'gcsp-side-drawer-head', 'gcsp-side-drawer-body', 'gcsp-side-drawer-foot',
    ]);
    const heading = panel.querySelector('.gcsp-side-drawer-head > .gcsp-side-drawer-titles > h2.gcsp-side-drawer-title');
    expect(heading?.textContent).toBe('Car details');
    expect(panel.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(panel.querySelector('.gcsp-side-drawer-context')?.textContent).toBe('Your offer');
    expect(panel.querySelector('.gcsp-side-drawer-body p')?.textContent).toBe('Supplied details');
    expect(panel.querySelector('.gcsp-side-drawer-body [drawer-footer]')).toBeNull();
    expect(panel.querySelector('.gcsp-side-drawer-foot > [drawer-footer]')?.textContent).toBe('Continue');
  });

  it('focuses its heading, contains scrolling, restores prior scrolling and returns focus once on close', async () => {
    document.body.style.overflow = 'clip';
    const { fixture, overlay, panel, drawer, opener } = await host();
    opener.focus();
    drawer.open(opener);
    expect(overlay.hidden).toBe(false);
    expect(document.activeElement).toBe(panel.querySelector('h2'));
    expect(document.body.style.overflow).toBe('hidden');
    drawer.open(opener);
    drawer.close();
    drawer.close();
    expect(overlay.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('clip');
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('blocks Escape, Close and backdrop dismissal while nondismissible and still permits terminal API close', async () => {
    const { fixture, overlay, panel, drawer, opener } = await host();
    drawer.open(opener);
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('.gcsp-side-drawer-head button')?.disabled).toBe(true);
    panel.querySelector<HTMLButtonElement>('.gcsp-side-drawer-head button')!.click();
    overlay.querySelector<HTMLElement>('.gcsp-side-drawer-backdrop')?.click();
    expect(overlay.hidden).toBe(false);
    expect(fixture.componentInstance.closedCount).toBe(0);
    drawer.close();
    expect(overlay.hidden).toBe(true);
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('closes on the source backdrop or Escape while body clicks retain the open record', async () => {
    const { fixture, overlay, panel, drawer, opener } = await host();
    drawer.open(opener);
    panel.querySelector<HTMLElement>('.gcsp-side-drawer-body p')!.click();
    expect(overlay.hidden).toBe(false);
    overlay.querySelector<HTMLElement>('.gcsp-side-drawer-backdrop')?.click();
    expect(overlay.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    drawer.open(opener);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(overlay.hidden).toBe(true);
    expect(fixture.componentInstance.closedCount).toBe(2);
  });

  it('wraps Tab at source boundaries and excludes disabled, hidden and closed-details controls', async () => {
    const { panel, drawer, opener } = await host();
    drawer.open(opener);
    const close = panel.querySelector<HTMLButtonElement>('.gcsp-side-drawer-head button')!;
    const last = panel.querySelector<HTMLButtonElement>('[drawer-footer]')!;
    expect(key('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(key('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    panel.querySelector('summary')!.focus();
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(key('ArrowDown').defaultPrevented).toBe(false);
    last.remove();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    panel.querySelector('details')!.open = true;
    panel.querySelector<HTMLInputElement>('input[aria-label="Hidden terms field"]')!.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('uses the heading when no visible enabled controls remain and redirects escaped focus', async () => {
    const { fixture, panel, drawer, opener } = await host();
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();
    panel.querySelector('a')!.remove();
    panel.querySelector('details')!.remove();
    panel.querySelector('[drawer-footer]')!.remove();
    drawer.open(opener);
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('h2'));
    opener.focus();
    expect(document.activeElement).toBe(panel.querySelector('h2'));
    drawer.close(false);
    opener.focus();
    expect(document.activeElement).toBe(opener);
    expect(key('Escape').defaultPrevented).toBe(false);
  });

  it('makes background siblings inert and restores only attributes it introduced', async () => {
    const { root, drawer, opener } = await host();
    const priorInert = document.createElement('div');
    priorInert.setAttribute('inert', 'already');
    priorInert.dataset['drawerFixture'] = '';
    document.body.append(priorInert);
    drawer.open(opener);
    expect(opener.hasAttribute('inert')).toBe(true);
    expect(root.hasAttribute('inert')).toBe(false);
    expect(priorInert.getAttribute('inert')).toBe('already');
    drawer.close();
    expect(opener.hasAttribute('inert')).toBe(false);
    expect(priorInert.getAttribute('inert')).toBe('already');
  });

  it('cleans scroll, background and listeners on destroy without focusing a removed opener', async () => {
    document.body.style.overflow = 'clip';
    const { fixture, root, overlay, drawer, opener } = await host();
    const focus = vi.spyOn(opener, 'focus');
    drawer.open(opener);
    opener.remove();
    fixture.destroy();
    expect(overlay.hidden).toBe(true);
    expect(document.body.style.overflow).toBe('clip');
    expect(root.hasAttribute('inert')).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(key('Escape').defaultPrevented).toBe(false);
    drawer.open(opener);
    expect(overlay.hidden).toBe(true);
  });

  it('omits absent context and keeps unique labels across independent drawers', async () => {
    const first = await host();
    const second = await host();
    second.fixture.componentInstance.context.set('');
    second.fixture.detectChanges();
    expect(second.panel.querySelector('.gcsp-side-drawer-context')).toBeNull();
    expect(first.panel.getAttribute('aria-labelledby')).not.toBe(second.panel.getAttribute('aria-labelledby'));
  });
});
