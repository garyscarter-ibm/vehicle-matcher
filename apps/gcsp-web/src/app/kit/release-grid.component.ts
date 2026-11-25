import { ChangeDetectorRef, Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { LoadingSkeletonComponent } from './loading-skeleton.component';

export interface ReleaseTile { readonly id: string; readonly imageSrc: string; readonly label: string }
type Preload = (sources: readonly string[]) => Promise<ReadonlySet<string>>;
@Component({ selector: 'gcsp-release-grid', host: { style: 'display: contents' }, imports: [LoadingSkeletonComponent], template: `
  <div class="gcsp-release-grid" role="grid" [attr.aria-label]="label()" [style.--gcsp-release-columns]="width()" [attr.aria-busy]="busy() ? 'true' : null" (keydown)="key($event)" (focusout)="tip.set(null)" (mouseleave)="tip.set(null)">
    @if (busy()) { <div gcspLoadingSkeleton label="Loading released cars" layout="release-grid" [role]="null" [items]="tiles().length || width() * 5"></div> }
    @else { @for (row of rows(); track $index) {
      <div class="gcsp-release-row" role="row">@for (cell of row; track cell.tile.id) {
        <div class="gcsp-release-tile" role="gridcell" [class.is-queued]="queued()" [class.is-in]="!queued()" [attr.aria-label]="cell.tile.label" [attr.data-tile-id]="cell.tile.id" [attr.tabindex]="active() === cell.index ? 0 : -1" [style.--gcsp-release-delay]="delay(cell.index)" (focus)="showTip($event, cell.index)" (mouseover)="showTip($event, cell.index)">
          @if (cell.tile.imageSrc && !failed().has(cell.tile.id)) { <img [src]="cell.tile.imageSrc" alt="" [hidden]="!loaded().has(cell.tile.imageSrc)" (load)="imageLoaded(cell.tile.imageSrc)" (error)="imageFailed(cell.tile.id)" /> }
          @if (!cell.tile.imageSrc || failed().has(cell.tile.id) || !loaded().has(cell.tile.imageSrc)) { <span class="gcsp-release-tile-label">{{ cell.tile.label }}</span> }
        </div>
      }</div>
    } }
    <div class="gcsp-release-tip" aria-hidden="true" [hidden]="!tip()" [class.is-below]="tip()?.below" [style.left.px]="tip()?.left" [style.top.px]="tip()?.top">{{ tip()?.label }}</div>
  </div>
` })
export class ReleaseGridComponent implements OnDestroy {
  readonly settled = output<void>();
  readonly tiles = input<readonly ReleaseTile[]>([]); readonly label = input('Released cars'); readonly columns = input(20);
  readonly loading = input(false); readonly animate = input(true); readonly timeoutMs = input(4000); readonly preload = input<Preload | null>(null);
  readonly width = computed(() => Math.max(1, Math.floor(this.columns()) || 20));
  readonly busy = signal(true); readonly queued = signal(false); readonly active = signal(0);
  readonly loaded = signal<ReadonlySet<string>>(new Set()); readonly failed = signal<ReadonlySet<string>>(new Set());
  readonly painted = signal<readonly ReleaseTile[]>([]);
  readonly rows = computed(() => { const list = this.painted().map((tile, index) => ({ tile, index })); return Array.from({ length: Math.ceil(list.length / this.width()) }, (_, i) => list.slice(i * this.width(), (i + 1) * this.width())); });
  readonly tip = signal<{ label: string; left: number; top: number; below: boolean } | null>(null);
  private readonly detector = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private generation = 0; private disposed = false; private cancelPreload: (() => void) | null = null; private frame: number | null = null; private completion: ReturnType<typeof setTimeout> | null = null;
  constructor() { effect(() => { const tiles = this.tiles(); const loading = this.loading(); const preload = this.preload(); const animate = this.animate(); void this.paint(tiles, loading, preload, animate); }); }
  delay(index: number): string { return `${Math.round(index * (this.painted().length > 1 ? 850 / (this.painted().length - 1) : 0))}ms`; }
  imageLoaded(source: string): void { this.loaded.update(before => new Set([...before, source])); }
  imageFailed(id: string): void { this.failed.update(before => new Set([...before, id])); }
  private async paint(tiles: readonly ReleaseTile[], loading: boolean, preload: Preload | null, animate: boolean): Promise<void> {
    const generation = ++this.generation; this.cancelPreload?.(); if (this.completion !== null) clearTimeout(this.completion); if (this.frame !== null) cancelAnimationFrame(this.frame);
    const focused = this.host.nativeElement.contains(this.host.nativeElement.ownerDocument.activeElement);
    this.busy.set(true); this.tip.set(null); this.painted.set([]); this.active.set(0); this.failed.set(new Set());
    if (loading) return;
    const sources = [...new Set(tiles.map(tile => tile.imageSrc).filter(Boolean))]; let loaded: ReadonlySet<string>;
    try { loaded = sources.length ? await (preload ? preload(sources) : this.loadImages(sources)) : new Set(); } catch { loaded = new Set(); }
    if (this.disposed || generation !== this.generation) return;
    this.loaded.set(loaded); this.painted.set(tiles); this.busy.set(false);
    let reduced = false; try { reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { /* Motion is optional. */ }
    const motion = animate && !reduced; this.queued.set(motion);
    if (!motion) this.settled.emit();
    this.frame = requestAnimationFrame(() => {
      if (this.disposed || generation !== this.generation) return; this.queued.set(false); if (focused) this.cells()[0]?.focus();
      if (motion) this.completion = setTimeout(() => { if (!this.disposed && generation === this.generation) this.settled.emit(); }, 1200);
    });
  }
  private loadImages(sources: readonly string[]): Promise<ReadonlySet<string>> {
    return new Promise(resolve => {
      const loaded = new Set<string>(); let remaining = sources.length; const images: HTMLImageElement[] = [];
      const finish = () => { clearTimeout(timer); images.forEach(image => { image.onload = null; image.onerror = null; }); resolve(loaded); };
      const timer = setTimeout(finish, this.timeoutMs()); this.cancelPreload = finish;
      for (const source of sources) { const image = new Image(); images.push(image); const settle = (ok: boolean) => { if (ok) loaded.add(source); if (--remaining === 0) finish(); }; image.onload = () => settle(true); image.onerror = () => settle(false); image.src = source; }
    });
  }
  private cells(): HTMLElement[] { return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role=gridcell]')); }
  showTip(event: Event, index: number): void {
    const cell = event.currentTarget as HTMLElement; const grid = cell.closest<HTMLElement>('[role=grid]')!; const below = cell.offsetTop === 0;
    if (event.type === 'focus') this.active.set(index);
    const label = this.painted()[index]?.label ?? ''; const top = cell.offsetTop + (below ? cell.offsetHeight : 0);
    this.tip.set({ label, left: 0, top, below }); this.detector.detectChanges();
    const half = (grid.querySelector<HTMLElement>('.gcsp-release-tip')?.offsetWidth ?? 0) / 2;
    this.tip.set({ label, left: Math.max(half, Math.min(grid.clientWidth - half, cell.offsetLeft + cell.offsetWidth / 2)), top, below });
  }
  key(event: KeyboardEvent): void {
    const cells = this.cells(); const at = cells.indexOf((event.target as HTMLElement).closest<HTMLElement>('[role=gridcell]')!); if (at < 0) return;
    const width = this.width(); const last = cells.length - 1; const start = at - at % width; const control = event.ctrlKey || event.metaKey;
    const target: Record<string, number> = { ArrowRight: Math.min(at + 1, last), ArrowLeft: Math.max(0, at - 1), ArrowDown: Math.floor(at / width) < Math.floor(last / width) ? Math.min(at + width, last) : at, ArrowUp: at >= width ? at - width : at, Home: control ? 0 : start, End: control ? last : Math.min(start + width - 1, last) };
    if (target[event.key] === undefined) return; event.preventDefault(); this.active.set(target[event.key]); cells[target[event.key]].focus();
  }
  ngOnDestroy(): void { this.disposed = true; this.generation++; this.cancelPreload?.(); if (this.completion !== null) clearTimeout(this.completion); if (this.frame !== null) cancelAnimationFrame(this.frame); }
}
