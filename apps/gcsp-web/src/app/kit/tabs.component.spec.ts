import { Component, OnInit, TemplateRef, ViewChild, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GcspTabItem, TabsComponent } from './tabs.component';

@Component({
  imports: [TabsComponent],
  template: '<ng-template #specification>Every supplied specification fact</ng-template><ng-template #equipment>All selected equipment</ng-template><ng-template #history>Updated details</ng-template><gcsp-tabs label="Car details" [items]="items()" [initialSelectedId]="initialSelectedId" /><gcsp-tabs label="Other details" [items]="items()" />',
})
class TabsHost implements OnInit {
  @ViewChild('specification', { static: true }) specification!: TemplateRef<unknown>;
  @ViewChild('equipment', { static: true }) equipment!: TemplateRef<unknown>;
  @ViewChild('history', { static: true }) history!: TemplateRef<unknown>;
  readonly items = signal<readonly GcspTabItem[]>([]);
  initialSelectedId: string | undefined = 'specification';

  ngOnInit(): void { this.items.set(this.makeItems()); }

  makeItems(ids: readonly string[] = ['specification', 'equipment']): readonly GcspTabItem[] {
    const templates: Record<string, TemplateRef<unknown>> = {
      specification: this.specification,
      equipment: this.equipment,
      history: this.history,
    };
    return ids.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), content: templates[id] }));
  }
}

describe('TabsComponent', () => {
  it('keeps every panel rendered and wires the selected state to accessible tab and panel ids', async () => {
    const fixture = TestBed.createComponent(TabsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = fixture.debugElement.query(By.directive(TabsComponent)).componentInstance as TabsComponent;
    const buttons = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const panels = root.querySelectorAll<HTMLElement>('[role="tabpanel"]');

    expect(root.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Car details');
    expect(buttons).toHaveLength(4);
    expect(panels).toHaveLength(4);
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(buttons[0].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);
    expect(buttons[0].getAttribute('aria-controls')).toBe(panels[0].id);
    expect(panels[0].getAttribute('aria-labelledby')).toBe(buttons[0].id);
    expect(panels[1].hidden).toBe(true);
    expect(panels[1].textContent).toContain('All selected equipment');
    expect(new Set(Array.from(buttons, (button) => button.id)).size).toBe(buttons.length);
    expect(root.querySelectorAll('[role="tablist"]')[0].querySelector('[role="tab"]')?.id)
      .not.toBe(root.querySelectorAll('[role="tablist"]')[1].querySelector('[role="tab"]')?.id);
    expect(tabs.selectedId()).toBe('specification');
    fixture.destroy();
  });

  it('autoactivates and focuses on wrapped arrows, Home and End, and ignores unknown selections', async () => {
    const fixture = TestBed.createComponent(TabsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = fixture.debugElement.query(By.directive(TabsComponent)).componentInstance as TabsComponent;
    const buttons = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const changes: string[] = [];
    tabs.selectionChange.subscribe((id) => changes.push(id));

    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(tabs.selectedId()).toBe('equipment');
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[0]);
    expect(tabs.selectedId()).toBe('specification');
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(buttons[1]);
    expect(tabs.selectedId()).toBe('equipment');
    tabs.select('missing');
    expect(tabs.selectedId()).toBe('equipment');
    expect(changes).toEqual(['equipment', 'specification', 'equipment']);
    fixture.destroy();
  });

  it('retains a valid selection across equivalent readback and chooses the initial or first valid id when removed', async () => {
    const fixture = TestBed.createComponent(TabsHost);
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const tabs = fixture.debugElement.query(By.directive(TabsComponent)).componentInstance as TabsComponent;
    tabs.select('equipment');
    host.items.set(host.makeItems());
    fixture.detectChanges();
    expect(tabs.selectedId()).toBe('equipment');

    host.initialSelectedId = 'history';
    host.items.set(host.makeItems(['history']));
    fixture.detectChanges();
    expect(tabs.selectedId()).toBe('history');
    fixture.destroy();
  });
});
