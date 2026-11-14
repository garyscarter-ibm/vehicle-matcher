import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, inject, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';

let drawerSequence = 0;

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

  @ViewChild('dialog', { static: true }) private dialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('heading', { static: true }) private headingRef!: ElementRef<HTMLHeadingElement>;
  private readonly document = inject(DOCUMENT);
  private opener: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;
  private opened = false;
  private destroyed = false;

  open(opener?: HTMLElement): void {
    if (this.opened || this.destroyed) return;
    const active = this.document.activeElement;
    this.opener = opener ?? (active instanceof HTMLElement ? active : null);
    this.previousBodyOverflow = this.document.body.style.overflow;
    const dialog = this.dialogRef.nativeElement;
    this.document.body.style.overflow = 'hidden';
    try {
      dialog.showModal();
      this.opened = true;
      this.headingRef.nativeElement.focus({ preventScroll: true });
    } catch (error) {
      this.document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
      this.opener = null;
      throw error;
    }
  }

  close(restoreFocus = true): void {
    if (!this.opened) return;
    const dialog = this.dialogRef.nativeElement;
    if (dialog.open) dialog.close();
    this.finishClose(restoreFocus);
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

  private finishClose(restoreFocus: boolean): void {
    if (!this.opened) return;
    this.opened = false;
    this.document.body.style.overflow = this.previousBodyOverflow ?? '';
    this.previousBodyOverflow = null;
    const opener = this.opener;
    this.opener = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    this.closed.emit();
  }
}
