import { Component, OnInit, TemplateRef, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SideDrawerComponent } from './side-drawer.component';
import { TabsComponent } from './tabs.component';
import { VehicleDetailRow, VehicleDetailsComponent } from './vehicle-details.component';

@Component({
  imports: [VehicleDetailsComponent],
  template: '<gcsp-vehicle-details [name]="name()" [finishes]="finishes()" [facts]="facts()" [equipment]="equipment()" [additionalDetails]="additionalDetails()" /><ng-template #additional>Source-supplied specification detail</ng-template><ng-template #revised>Revised supplied decision detail</ng-template>',
})
class VehicleDetailsHost implements OnInit {
  @ViewChild('additional', { static: true }) additional!: TemplateRef<unknown>;
  @ViewChild('revised', { static: true }) revised!: TemplateRef<unknown>;
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

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('[data-vehicle-details-fixture]').forEach(node => node.remove());
  document.body.style.overflow = '';
});

describe('VehicleDetailsComponent', () => {
  it('retains long supplied facts and all 57 equipment items behind a truthful, focus-wired drawer', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    root.dataset['vehicleDetailsFixture'] = '';
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;

    expect(root.querySelector('.gcsp-vehicle-details-control > .gcsp-vehicle-details-entry')).toBe(entry);
    expect(entry.classList.contains('vm-btn')).toBe(true);
    const content = dialog.querySelector<HTMLElement>('.gcsp-vehicle-drawer-content')!;
    expect(content?.hidden).toBe(true);
    expect(entry.getAttribute('aria-haspopup')).toBe('dialog');
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(entry.textContent).toContain('Full specification · 57 selected equipment items');
    entry.click();
    fixture.detectChanges();

    expect(dialog.closest<HTMLElement>('.gcsp-side-drawer')!.hidden).toBe(false);
    expect(content.hidden).toBe(false);
    expect(dialog.querySelector('.gcsp-vehicle-specification')?.tagName).toBe('DIV');
    expect(dialog.querySelectorAll('.gcsp-vehicle-specification h4')).toHaveLength(0);
    expect(dialog.querySelectorAll('.vm-facts')).toHaveLength(2);
    expect(dialog.querySelectorAll('.gcsp-vehicle-equipment > ul')).toHaveLength(1);
    expect(entry.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.querySelector('.gcsp-side-drawer-context')?.textContent).toBe('Your offer');
    expect(dialog.querySelector('.gcsp-side-drawer-head h2')?.textContent).toBe('Car details');
    const bodyHeadings = dialog.querySelectorAll('.gcsp-vehicle-drawer-content > h3.gcsp-h2');
    expect(bodyHeadings).toHaveLength(1);
    expect(bodyHeadings[0].textContent).toBe(fixture.componentInstance.name());
    expect(dialog.textContent?.match(/BMW X2 M35i/g)).toHaveLength(1);
    expect(dialog.textContent).toContain('Source-supplied specification detail');
    expect(dialog.querySelectorAll('.vm-fact')).toHaveLength(6);
    expect(dialog.textContent).toContain('Not supplied');
    expect(dialog.textContent).toContain('M Alcantara Veganza combination Black contrast stitching with extended long text');
    expect(dialog.querySelectorAll('.gcsp-vehicle-equipment li')).toHaveLength(57);
    expect(dialog.textContent).toContain('Selected equipment item 57 with retained source wording');
    expect(document.activeElement).toBe(dialog.querySelector('.gcsp-side-drawer-head h2'));

    const tabs = dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[1].textContent).toContain('Selected equipment (57)');
    tabs[1].click();
    fixture.detectChanges();
    expect(dialog.querySelectorAll('.gcsp-vehicle-equipment li')).toHaveLength(57);
    expect(dialog.querySelector<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
    expect(entry.getAttribute('aria-expanded')).toBe('true');

    dialog.querySelector<HTMLButtonElement>('.gcsp-side-drawer-head button')!.click();
    fixture.detectChanges();
    expect(dialog.closest<HTMLElement>('.gcsp-side-drawer')!.hidden).toBe(true);
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(content.hidden).toBe(true);
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
    root.dataset['vehicleDetailsFixture'] = '';
    expect(root.querySelector('.gcsp-vehicle-details-hint')?.textContent).toBe('Full specification · Equipment not supplied');
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    const tabs = dialog.querySelectorAll('[role="tab"]');
    expect(tabs[1].textContent).toBe('Selected equipment');
    expect(dialog.querySelector('.gcsp-vehicle-equipment > p.gcsp-note')?.textContent).toBe('Equipment not supplied.');
    expect(dialog.textContent).not.toContain('Selected equipment (0)');
    fixture.destroy();
  });

  it('closes and resets to Specification when supplied content changes while open', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    root.dataset['vehicleDetailsFixture'] = '';
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
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

    expect(dialog.closest<HTMLElement>('.gcsp-side-drawer')!.hidden).toBe(true);
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(entry);
    expect(dialog.querySelector('.gcsp-vehicle-drawer-content > h3.gcsp-h2')?.textContent).toBe('BMW X2 M35i with updated supplied trim');
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
    root.dataset['vehicleDetailsFixture'] = '';
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    const focus = vi.spyOn(entry, 'focus');
    entry.click();
    fixture.detectChanges();
    fixture.destroy();

    expect(dialog.closest<HTMLElement>('.gcsp-side-drawer')!.hidden).toBe(true);
    expect(document.body.style.overflow).toBe('clip');
    expect(focus).not.toHaveBeenCalled();
    root.remove();
    document.body.style.overflow = '';
  });

  it('omits absent finishes while retaining supplied whitespace and explicit missing facts', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    const finishes = Object.freeze([
      Object.freeze({ label: 'Absent paint', value: null }), Object.freeze({ label: 'Empty interior', value: '' }),
      Object.freeze({ label: 'Supplied whitespace', value: '  ' }), Object.freeze({ label: 'Paint', value: 'Black Sapphire' }),
    ]);
    fixture.componentInstance.finishes.set(finishes);
    fixture.componentInstance.facts.set([{ label: 'Build month', value: null, missingLabel: 'Not confirmed' }]);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll('.gcsp-vehicle-specification .vm-fact');
    expect(Array.from(rows, row => row.querySelector('dt')?.textContent)).toEqual(['Supplied whitespace', 'Paint', 'Build month']);
    expect(Array.from(rows, row => row.querySelector('dd')?.textContent)).toEqual(['  ', 'Black Sapphire', 'Not confirmed']);
    expect(fixture.componentInstance.finishes()).toBe(finishes);
    expect(finishes).toHaveLength(4);
  });

  it('keeps the open drawer, selected equipment panel and focus across equivalent raw readback', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.dataset['vehicleDetailsFixture'] = '';
    document.body.append(root);
    root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!.click();
    fixture.detectChanges();
    const tab = root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    tab.click(); tab.focus(); fixture.detectChanges();
    fixture.componentInstance.finishes.set(fixture.componentInstance.finishes().map(row => ({ ...row })));
    fixture.componentInstance.facts.set(fixture.componentInstance.facts().map(row => ({ ...row })));
    fixture.componentInstance.equipment.set([...fixture.componentInstance.equipment()]);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.gcsp-side-drawer')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.gcsp-vehicle-drawer-content')?.hidden).toBe(false);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab);
  });

  it('closes and resets when the supplied decision template changes with unchanged raw details', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.dataset['vehicleDetailsFixture'] = '';
    document.body.append(root);
    const entry = root.querySelector<HTMLButtonElement>('.gcsp-vehicle-details-entry')!;
    entry.click(); fixture.detectChanges();
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click(); fixture.detectChanges();
    fixture.componentInstance.additionalDetails.set(fixture.componentInstance.revised);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.gcsp-side-drawer')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.gcsp-vehicle-drawer-content')?.hidden).toBe(true);
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Specification');
    expect(root.querySelector('.gcsp-vehicle-specification')?.textContent).toContain('Revised supplied decision detail');
    expect(document.activeElement).toBe(entry);
  });

  it('uses the source singular count without inventing an empty finish group', async () => {
    const fixture = TestBed.createComponent(VehicleDetailsHost);
    fixture.componentInstance.finishes.set([{ label: 'Paint', value: null }, { label: 'Interior', value: '' }]);
    fixture.componentInstance.equipment.set(['Only supplied item']);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.gcsp-vehicle-details-hint')?.textContent).toBe('Full specification · 1 selected equipment item');
    expect(root.querySelectorAll('.gcsp-vehicle-specification .vm-facts')).toHaveLength(1);
    expect(root.querySelectorAll('[role="tab"]')[1].textContent).toBe('Selected equipment (1)');
    expect(root.querySelector('.gcsp-vehicle-equipment > ul > li')?.textContent).toBe('Only supplied item');
  });
});
