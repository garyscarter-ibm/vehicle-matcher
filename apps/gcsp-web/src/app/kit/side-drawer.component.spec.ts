import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { SideDrawerComponent } from './side-drawer.component';

@Component({
  imports: [SideDrawerComponent],
  template: '<button #opener type="button">Open details</button><gcsp-side-drawer title="Car details" context="Your offer" [dismissible]="dismissible()" (closed)="closedCount = closedCount + 1"><p>Supplied details</p><button drawer-footer type="button">Continue</button></gcsp-side-drawer>',
})
class DrawerHost {
  readonly dismissible = signal(true);
  closedCount = 0;
  @ViewChild('opener', { static: true }) opener!: ElementRef<HTMLButtonElement>;
  @ViewChild(SideDrawerComponent) drawer!: SideDrawerComponent;
}

function stubDialog(dialog: HTMLDialogElement): void {
  Object.defineProperty(dialog, 'showModal', { configurable: true, value: () => dialog.setAttribute('open', '') });
  Object.defineProperty(dialog, 'close', { configurable: true, value: () => dialog.removeAttribute('open') });
}

describe('SideDrawerComponent', () => {
  it('opens a labelled native modal, focuses its heading, and returns focus on close', async () => {
    const fixture = TestBed.createComponent(DrawerHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    const opener = fixture.componentInstance.opener.nativeElement;
    opener.focus();

    fixture.componentInstance.drawer.open(opener);

    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    expect(dialog.querySelector('h2')?.textContent).toContain('Car details');
    expect(document.activeElement).toBe(dialog.querySelector('h2'));
    expect(document.body.style.overflow).toBe('hidden');
    expect(root.querySelector('.gcsp-side-drawer-body p')?.textContent).toBe('Supplied details');
    expect(root.querySelector('[drawer-footer]')?.textContent).toContain('Continue');

    fixture.componentInstance.drawer.close();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
    expect(fixture.componentInstance.closedCount).toBe(1);
    root.remove();
    fixture.destroy();
  });

  it('blocks Escape and Close while nondismissible, then closes only on an outside-panel click when enabled', async () => {
    const fixture = TestBed.createComponent(DrawerHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    const drawer = fixture.componentInstance.drawer;
    drawer.open(fixture.componentInstance.opener.nativeElement);
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();

    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('header button')?.disabled).toBe(true);

    fixture.componentInstance.dismissible.set(true);
    fixture.detectChanges();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog.open).toBe(false);
    expect(fixture.componentInstance.closedCount).toBe(1);
    root.remove();
    fixture.destroy();
  });

  it('cleans scroll state on destroy without focusing a removed opener', async () => {
    document.body.style.overflow = 'clip';
    const fixture = TestBed.createComponent(DrawerHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    const opener = fixture.componentInstance.opener.nativeElement;
    const focus = vi.spyOn(opener, 'focus');
    fixture.componentInstance.drawer.open(opener);
    opener.remove();

    fixture.destroy();

    expect(dialog.open).toBe(false);
    expect(document.body.style.overflow).toBe('clip');
    expect(focus).not.toHaveBeenCalled();
    root.remove();
    document.body.style.overflow = '';
  });
});
