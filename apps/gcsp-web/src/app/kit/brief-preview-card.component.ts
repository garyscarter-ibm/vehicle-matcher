import { Component, computed, input, signal } from '@angular/core';
import { FactListComponent, FactRow } from './fact-list.component';

export interface BriefPreviewCardView {
  readonly id: string; readonly name: string; readonly line: string;
  readonly photo: string | null; readonly caption: string | null; readonly terms: string;
  readonly facts: readonly FactRow[]; readonly gate: 'eligible' | 'ineligible' | 'needs-confirmation';
  readonly groups: readonly { readonly label: string; readonly entries: readonly string[] }[];
  readonly score?: number; readonly scoreLabel?: { readonly text: string; readonly title: string } | null;
}

/** Frozen matchCard/previewTile explicit view. Callers supply all facts and decisions. */
@Component({ selector: 'gcsp-brief-preview-card', imports: [FactListComponent], host: { style: 'display: contents' }, template: `
  <article class="vm-card vm-card-explicit" [class.vm-card-compact]="view().gate !== 'eligible'" [attr.data-member-id]="view().id" [attr.data-gate]="view().gate">
    <div class="vm-card-media" [class.has-photo]="!!photo()">
      @if (photo(); as photo) { <img class="vm-card-photo" [src]="photo" [alt]="view().name" loading="lazy" (error)="failPhoto(photo)" /> }
      <span class="vm-card-soon">No image for this car yet</span><span class="vm-card-line">{{ view().line }}</span>
      @if (photo() && view().caption) { <span class="vm-media-caption">{{ view().caption }}</span> }
    </div>
    <div class="vm-card-body">
      <div class="vm-card-head"><h3 class="vm-card-name">{{ view().name }}</h3><span class="vm-score" [hidden]="!scoreText()" [title]="view().scoreLabel?.title || 'Preference match score'">{{ scoreText() }}</span></div>
      <div class="vm-card-terms"><p class="vm-specs">{{ view().terms }}</p></div>
      <div class="vm-card-facts"><gcsp-fact-list presentation="source" [rows]="view().facts" /></div>
      <div class="vm-card-decision"><p class="vm-card-gate">{{ view().gate === 'eligible' ? 'Eligible' : view().gate === 'needs-confirmation' ? 'Needs confirmation' : 'Not eligible' }}</p>
        @for (group of view().groups; track group.label) { @if (group.entries.length) { <p class="vm-why-label">{{ group.label }}</p><ul class="vm-reasons">@for (reason of group.entries; track $index) { <li>{{ reason }}</li> }</ul> } }
      </div>
      <div class="vm-pick" role="group" aria-label="Exact cars" hidden></div><div class="vm-card-actions"></div>
    </div>
  </article>
` })
export class BriefPreviewCardComponent {
  readonly view = input.required<BriefPreviewCardView>();
  private readonly failedPhotos = signal<readonly string[]>([]);
  readonly photo = computed(() => {
    const src = this.view().photo;
    return src && (/^\/(?!\/)/.test(src) || /^https:\/\//.test(src)) && !this.failedPhotos().includes(`${this.view().id}\n${src}`) ? src : null;
  });
  readonly scoreText = computed(() => this.view().scoreLabel === undefined
    ? Number.isFinite(this.view().score) ? `${this.view().score}%` : '' : this.view().scoreLabel?.text ?? '');
  failPhoto(src: string): void { this.failedPhotos.update(failed => [...failed, `${this.view().id}\n${src}`]); }
}
