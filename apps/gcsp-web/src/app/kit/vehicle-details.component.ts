import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, computed, effect, input, signal, viewChild } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { SideDrawerComponent } from './side-drawer.component';
import { GcspTabItem, TabsComponent } from './tabs.component';

export interface VehicleDetailRow {
  readonly label: string;
  readonly value: string | null;
  readonly missingLabel?: string;
}

@Component({
  selector: 'gcsp-vehicle-details',
  standalone: true,
  imports: [ButtonDirective, NgTemplateOutlet, SideDrawerComponent, TabsComponent],
  templateUrl: './vehicle-details.component.html',
  styleUrl: './vehicle-details.component.css',
})
export class VehicleDetailsComponent {
  readonly name = input.required<string>();
  readonly finishes = input<readonly VehicleDetailRow[]>([]);
  readonly facts = input<readonly VehicleDetailRow[]>([]);
  readonly equipment = input<readonly string[]>([]);
  readonly additionalDetails = input<TemplateRef<unknown> | null>(null);
  readonly isOpen = signal(false);

  private readonly specificationTemplate = viewChild.required<TemplateRef<unknown>>('specificationTemplate');
  private readonly equipmentTemplate = viewChild.required<TemplateRef<unknown>>('equipmentTemplate');
  private readonly drawer = viewChild(SideDrawerComponent);
  private readonly tabs = viewChild(TabsComponent);
  readonly tabItems = computed<readonly GcspTabItem[]>(() => {
    const equipmentCount = this.equipment().length;
    return [
      { id: 'specification', label: 'Specification', content: this.specificationTemplate() },
      { id: 'equipment', label: `Selected equipment${equipmentCount ? ` (${equipmentCount})` : ''}`, content: this.equipmentTemplate() },
    ];
  });

  private previousSnapshot: string | null = null;
  private previousAdditionalDetails: TemplateRef<unknown> | null = null;

  constructor() {
    effect(() => {
      const snapshot = JSON.stringify({ name: this.name(), finishes: this.finishes(), facts: this.facts(), equipment: this.equipment() });
      const additionalDetails = this.additionalDetails();
      if (this.previousSnapshot !== null && (snapshot !== this.previousSnapshot || additionalDetails !== this.previousAdditionalDetails)) {
        this.drawer()?.close(true);
        this.tabs()?.select('specification');
      }
      this.previousSnapshot = snapshot;
      this.previousAdditionalDetails = additionalDetails;
    });
  }

  openDrawerFromEvent(event: MouseEvent): void {
    this.openDrawer(event.currentTarget as HTMLElement);
  }

  openDrawer(opener: HTMLElement): void {
    if (this.isOpen()) return;
    this.drawer()?.open(opener);
    this.isOpen.set(true);
  }

  displayValue(row: VehicleDetailRow): string {
    return row.value ?? row.missingLabel ?? 'Not supplied';
  }

  onDrawerClosed(): void {
    this.isOpen.set(false);
  }
}
