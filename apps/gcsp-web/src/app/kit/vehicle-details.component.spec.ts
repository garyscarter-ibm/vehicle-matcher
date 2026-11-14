import { Component, OnInit, TemplateRef, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { SideDrawerComponent } from './side-drawer.component';
import { TabsComponent } from './tabs.component';
import { VehicleDetailRow, VehicleDetailsComponent } from './vehicle-details.component';

@Component({
  imports: [VehicleDetailsComponent],
  template: '<gcsp-vehicle-details [name]="name()" [finishes]="finishes()" [facts]="facts()" [equipment]="equipment()" [additionalDetails]="additionalDetails()" /><ng-template #additional>Source-supplied specification detail</ng-template>',
})
class VehicleDetailsHost implements OnInit {
  @ViewChild('additional', { static: true }) additional!: TemplateRef<unknown>;
  readonly name = signal('BMW X2 M35i in Black Sapphire with a long supplied upholstery and model description');
  readonly finishes = signal<readonly VehicleDetailRow[]>([
    { label: 'Paint', value: 'Black Sapphire' },
    { label: 'Upholstery', value: 'M Alcantara Veganza combination Black contrast stitching with extended long text' },
  ]);
  readonly facts = signal<readonly VehicleDetailRow[]>([
    { label: 'Body style', value: 'SUV' },
    { label: 'Fuel', value: 'Petrol' },
    { label: 'Transmission', value: 'Automatic' },
    { label: 'Build month', value: null },
  ]);
  readonly equipment = signal<readonly string[]>(Array.from({ length: 57 }, (_, index) => `Selected equipment item ${index + 1} with retained source wording`));
  readonly additionalDetails = signal<TemplateRef<unknown> | null>(null);

  ngOnInit(): void { this.additionalDetails.set(this.additional); }
}

function stubDialog(dialog: HTMLDialogElement): void {
  Object.defineProperty(dialog, 'showModal', { configurable: true, value: () => dialog.setAttribute('open', '') });
  Object.defineProperty(dialog, 'close', { configurable: true, value: () => dialog.removeAttribute('open') });
}

describe('VehicleDetailsComponent', () => {
  it('retains long supplied facts and all 57 equipment items behind a truthful, focus-wired drawer', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);

    expect(entry.getAttribute('aria-haspopup')).toBe('dialog');
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(entry.textContent).toContain('Full specification · 57 selected equipment items');
    entry.click();
    fixture.detectChanges();

    expect(dialog.open).toBe(true);
    expect(entry.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.querySelector('.gcsp-side-drawer-context')?.textContent).toBe('Your offer');
    expect(dialog.querySelector('.gcsp-side-drawer-header h2')?.textContent).toBe('Car details');
    const bodyHeadings = dialog.querySelectorAll('.gcsp-vehicle-details-body h3');
    expect(bodyHeadings).toHaveLength(1);
    expect(bodyHeadings[0].textContent).toBe(fixture.componentInstance.name());
    expect(dialog.textContent?.match(/BMW X2 M35i/g)).toHaveLength(1);
    expect(dialog.textContent).toContain('Source-supplied specification detail');
    expect(dialog.querySelectorAll('.gcsp-vehicle-detail-row')).toHaveLength(6);
    expect(dialog.textContent).toContain('Not supplied');
    expect(dialog.textContent).toContain('M Alcantara Veganza combination Black contrast stitching with extended long text');
    expect(dialog.querySelectorAll('.gcsp-vehicle-equipment li')).toHaveLength(57);
    expect(dialog.textContent).toContain('Selected equipment item 57 with retained source wording');
    expect(document.activeElement).toBe(dialog.querySelector('.gcsp-side-drawer-header h2'));

    const tabs = dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[1].textContent).toContain('Selected equipment (57)');
    tabs[1].click();
    fixture.detectChanges();
    expect(dialog.querySelectorAll('.gcsp-vehicle-equipment li')).toHaveLength(57);
    expect(dialog.querySelector<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
    expect(entry.getAttribute('aria-expanded')).toBe('true');

    dialog.querySelector<HTMLButtonElement>('.gcsp-side-drawer-header button')!.click();
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(entry);
    root.remove();
    fixture.destroy();
  });

  it('labels missing equipment without inventing a zero count', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    fixture.componentInstance.equipment.set([]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.gcsp-vehicle-details-entry')?.textContent).toContain('Equipment not supplied');
    const dialog = root.querySelector('dialog')!;
    const tabs = dialog.querySelectorAll('[role="tab"]');
    expect(tabs[1].textContent).toBe('Selected equipment');
    expect(dialog.textContent).toContain('Equipment not supplied');
    expect(dialog.textContent).not.toContain('Selected equipment (0)');
    fixture.destroy();
  });

  it('closes and resets to Specification when supplied content changes while open', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    entry.click();
    fixture.detectChanges();
    const tabs = dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].click();
    fixture.detectChanges();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    fixture.componentInstance.name.set('BMW X2 M35i with updated supplied trim');
    fixture.componentInstance.facts.set([{ label: 'Body style', value: 'SUV' }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(entry);
    expect(dialog.querySelector('.gcsp-vehicle-details-body h3')?.textContent).toBe('BMW X2 M35i with updated supplied trim');
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Specification');
    root.remove();
    fixture.destroy();
  });

  it('closes on destroy without focusing an opener that is being removed', async () => {
    document.body.style.overflow = 'clip';
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    const dialog = root.querySelector('dialog')!;
    stubDialog(dialog);
    const focus = vi.spyOn(entry, 'focus');
    entry.click();
    fixture.detectChanges();
    fixture.destroy();

    expect(dialog.open).toBe(false);
    expect(document.body.style.overflow).toBe('clip');
    expect(focus).not.toHaveBeenCalled();
    root.remove();
    document.body.style.overflow = '';
  });
});
