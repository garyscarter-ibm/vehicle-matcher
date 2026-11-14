import { AfterViewChecked, Component, computed, DoCheck, ElementRef, input, output, viewChildren } from '@angular/core';

export interface OptionListOption {
  readonly value: string;
  readonly label: string;
  readonly sub?: string;
  readonly disabled?: boolean;
}

@Component({
  selector: 'gcsp-option-list',
  standalone: true,
  templateUrl: './option-list.component.html',
  styleUrl: './option-list.component.css',
})
export class OptionListComponent implements DoCheck, AfterViewChecked {
  readonly groupId = input.required<string>();
  readonly label = input.required<string>();
  readonly options = input<readonly OptionListOption[]>([]);
  readonly value = input<string | null>(null);
  readonly disabled = input(false);
  readonly valueChange = output<string>();
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('optionButton');
  private restoreFocusValue: string | undefined;
  readonly tabValue = computed(() => {
    const enabled = this.disabled() ? [] : this.options().filter(option => !option.disabled);
    return enabled.find(option => option.value === this.value())?.value ?? enabled[0]?.value;
  });

  ngDoCheck(): void {
    this.restoreFocusValue = this.buttons().find(button => button.nativeElement === button.nativeElement.ownerDocument.activeElement)?.nativeElement.value;
  }

  ngAfterViewChecked(): void {
    const value = this.restoreFocusValue;
    this.restoreFocusValue = undefined;
    if (value === undefined) return;
    const buttons = this.buttons().map(button => button.nativeElement);
    const document = buttons[0]?.ownerDocument;
    if (document?.activeElement !== document?.body) return;
    const target = buttons.find(button => button.value === value && !button.disabled)
      ?? buttons.find(button => button.value === this.tabValue() && !button.disabled);
    target?.focus();
  }

  choose(option: OptionListOption): void {
    if (!this.disabled() && !option.disabled) this.valueChange.emit(option.value);
  }

  navigate(event: KeyboardEvent, option: OptionListOption): void {
    if (this.disabled() || option.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const enabled = this.options().filter(item => !item.disabled);
    if (!enabled.length) return;
    const index = enabled.findIndex(item => item.value === option.value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + enabled.length) % enabled.length;
    event.preventDefault();
    const target = enabled[next];
    const targetIndex = this.options().findIndex(item => item.value === target.value);
    this.buttons()[targetIndex]?.nativeElement.focus();
    this.choose(target);
  }
}
