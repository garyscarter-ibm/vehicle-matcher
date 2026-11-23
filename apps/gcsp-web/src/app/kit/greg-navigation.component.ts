import { Component, TemplateRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScreenIntroComponent } from './screen-intro.component';
import { TabsComponent } from './tabs.component';

export const GREG_VIEWS = [
  { id: 'next-order', label: 'Next order', path: '/greg/plan' },
  { id: 'dashboard', label: 'Demand and supply', path: '/greg' },
  { id: 'policy', label: 'Policy', path: '/greg', fragment: 'policy' },
  { id: 'orders', label: 'Order requests', path: '/greg/plan', fragment: 'gcsp-order-requests' },
  { id: 'comparison', label: 'Route comparison', path: '/comparison' },
  { id: 'cases', label: 'Renewal cases', path: '/greg/cases' },
] as const;
export type GregView = typeof GREG_VIEWS[number]['id'];

@Component({
  selector: 'gcsp-greg-navigation', imports: [ScreenIntroComponent, TabsComponent],
  template: `@if (showIntro()) { <gcsp-screen-intro [title]="title()" [lede]="selected() === 'dashboard' ? lede() : ''" /> }<gcsp-tabs label="Employee car ordering" [items]="items()" [activeId]="selected()" (selectionChange)="select($event, true)" /><ng-template #empty />`,
})
export class GregNavigationComponent {
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);
  private readonly empty = viewChild<TemplateRef<unknown>>('empty');
  readonly page = input.required<GregView>();
  readonly showIntro = input(false);
  readonly lede = input('');
  readonly title = computed(() => GREG_VIEWS.find(view => view.id === this.selected())!.label);
  readonly panels = input.required<Partial<Record<GregView, TemplateRef<unknown>>>>();
  readonly selected = computed<GregView>(() => {
    const tree = this.router.parseUrl(this.url());
    const requested = tree.queryParams['view'] ?? tree.fragment;
    if (this.page() === 'dashboard' && (requested === 'policy' || requested === 'publish')) return 'policy';
    if (this.page() === 'next-order' && (requested === 'orders' || requested === 'gcsp-order-requests')) return 'orders';
    return this.page();
  });
  readonly items = computed(() => {
    const empty = this.empty(); const panels = this.panels();
    return empty ? GREG_VIEWS.map(view => ({ id: view.id, label: view.label, content: panels[view.id] ?? empty })) : [];
  });
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => { if (event instanceof NavigationEnd) this.url.set(event.urlAfterRedirects); });
  }
  async select(id: string, focusTab = false): Promise<void> {
    const view = GREG_VIEWS.find(view => view.id === id); if (!view) return;
    await this.router.navigate([view.path], { info: { gcspGregNavigation: true, focusTab }, queryParamsHandling: 'merge', queryParams: { view: null }, fragment: 'fragment' in view ? view.fragment : undefined });
  }
}
