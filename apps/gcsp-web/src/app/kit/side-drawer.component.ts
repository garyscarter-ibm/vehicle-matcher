import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, inject, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';

let drawerSequence = 0;
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, iframe, [tabindex]:not([tabindex="-1"])';

@Component({
  selector: 'gcsp-side-drawer',
  standalone: true,
  imports: [ButtonDirective],
  templateUrl: './side-drawer.component.html',
  styleUrl: './side-drawer.component.css',
})
export class SideDrawerComponent implements OnDestroy {
  readonly title = input.required<string>();
  readonly context = input('');
  readonly dismissible = input(true);
  readonly closed = output<void>();
  readonly titleId = `gcsp-side-drawer-title-${++drawerSequence}`;

  @ViewChild('root', { static: true }) private rootRef!: ElementRef<HTMLElement>;
  @ViewChild('panel', { static: true }) private panelRef!: ElementRef<HTMLElement>;
  @ViewChild('heading', { static: true }) private headingRef!: ElementRef<HTMLHeadingElement>;
  private readonly document = inject(DOCUMENT);
  private opener: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;
  private readonly background: { node: Element; inert: boolean }[] = [];
  private opened = false;
  private destroyed = false;

  open(opener?: HTMLElement): void {
    if (this.opened || this.destroyed) return;
    const active = this.document.activeElement;
    this.opener = opener ?? (active instanceof HTMLElement ? active : null);
    this.previousBodyOverflow = this.document.body.style.overflow;
    const root = this.rootRef.nativeElement;
    root.hidden = false;
    this.opened = true;
    this.document.addEventListener('keydown', this.onKey);
    this.document.addEventListener('focusin', this.onFocus);
    for (let node = root; node.parentElement && node.parentElement !== this.document.documentElement; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node) continue;
        const inert = sibling.hasAttribute('inert');
        this.background.push({ node: sibling, inert });
        if (!inert) sibling.setAttribute('inert', '');
      }
    }
    this.document.body.style.overflow = 'hidden';
    this.headingRef.nativeElement.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    if (!this.opened) return;
    this.opened = false;
    this.document.removeEventListener('keydown', this.onKey);
    this.document.removeEventListener('focusin', this.onFocus);
    this.rootRef.nativeElement.hidden = true;
    for (const { node, inert } of this.background) if (!inert) node.removeAttribute('inert');
    this.background.length = 0;
    this.document.body.style.overflow = this.previousBodyOverflow ?? '';
    this.previousBodyOverflow = null;
    const opener = this.opener;
    this.opener = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    this.closed.emit();
  }

  onCancel(event: Event): void {
    event.preventDefault();
    if (this.dismissible()) this.close();
  }

  onDialogClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && this.dismissible()) this.close();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.close(false);
  }

  private visible(node: HTMLElement): boolean {
    if (node.closest('[hidden], [inert]')) return false;
    for (let parent = node.parentElement; parent && parent !== this.panelRef.nativeElement; parent = parent.parentElement) {
      if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(node)) return false;
    }
    return true;
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { this.onCancel(event); return; }
    if (event.key !== 'Tab') return;
    const panel = this.panelRef.nativeElement;
    // Traverse in document order even when a selector engine groups comma-separated matches.
    const items = Array.from(panel.querySelectorAll<HTMLElement>('*')).filter(node => node.matches(FOCUSABLE) && this.visible(node));
    if (!items.length) { event.preventDefault(); this.headingRef.nativeElement.focus(); return; }
    const active = this.document.activeElement;
    const inside = panel.contains(active);
    if (event.shiftKey && (!inside || active === items[0] || active === this.headingRef.nativeElement)) {
      event.preventDefault(); items.at(-1)!.focus();
    } else if (!event.shiftKey && (!inside || active === items.at(-1))) {
      event.preventDefault(); items[0].focus();
    }
  };

  private readonly onFocus = (event: FocusEvent): void => {
    if (this.opened && !this.panelRef.nativeElement.contains(event.target as Node)) this.headingRef.nativeElement.focus();
  };
}
