import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, effect, input, output, signal } from '@angular/core';

export interface GcspTabItem {
  readonly id: string;
  readonly label: string;
  readonly content: TemplateRef<unknown>;
}

let tabsSequence = 0;

@Component({
  selector: 'gcsp-tabs',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
})
export class TabsComponent {
  readonly items = input.required<readonly GcspTabItem[]>();
  readonly label = input.required<string>();
  readonly initialSelectedId = input<string | undefined>(undefined);
  readonly selectionChange = output<string>();
  readonly selectedId = signal<string | null>(null);
  readonly idPrefix = `gcsp-tabs-${++tabsSequence}`;

  constructor() {
    effect(() => {
      const items = this.items();
      const selected = this.selectedId();
      if (items.some((item) => item.id === selected)) return;
      const initial = this.initialSelectedId();
      this.selectedId.set(items.find((item) => item.id === initial)?.id ?? items[0]?.id ?? null);
    });
  }

  select(id: string): void {
    if (!this.items().some((item) => item.id === id) || this.selectedId() === id) return;
    this.selectedId.set(id);
    this.selectionChange.emit(id);
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const items = this.items();
    if (!items.length) return;
    let target: number;
    switch (event.key) {
      case 'ArrowRight': target = (index + 1) % items.length; break;
      case 'ArrowLeft': target = (index - 1 + items.length) % items.length; break;
      case 'Home': target = 0; break;
      case 'End': target = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    this.select(items[target].id);
    (event.currentTarget as HTMLElement).parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  }
}
