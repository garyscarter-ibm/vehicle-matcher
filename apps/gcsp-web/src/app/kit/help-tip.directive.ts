import { AfterViewInit, Directive, ElementRef, inject, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';

export type HelpTipPlacement = 'below-start' | 'above-end';
export interface HelpTipOptions {
  host: HTMLElement; triggers?: readonly HTMLElement[]; text?: string; id: string;
  placement?: HelpTipPlacement; dismissOnActivate?: boolean;
}

/** Source helpTip lifecycle; the Angular directive supplies its host and native triggers. */
export function helpTip({ host, triggers = [], text = '', id, placement = 'below-start', dismissOnActivate = true }: HelpTipOptions) {
  const doc = host.ownerDocument; const root = doc.createElement('p');
  root.className = `gcsp-help-tip gcsp-help-tip-${['below-start', 'above-end'].includes(placement) ? placement : 'below-start'}`;
  root.textContent = text; root.id = id; root.setAttribute('role', 'tooltip'); root.hidden = true; host.append(root);
  const undo: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(node: HTMLElement, type: K, run: (event: HTMLElementEventMap[K]) => void) => {
    node.addEventListener(type, run); undo.push(() => node.removeEventListener(type, run));
  };
  const added = triggers.map((trigger) => {
    const ids = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean); const had = ids.includes(id);
    if (!had) trigger.setAttribute('aria-describedby', [...ids, id].join(' ')); return had;
  });
  let dismissed = false; let pointerIn = false; let focusIn = false; let keyFocus = false; let pointerFocus = false; let listening = false;
  const outside = (event: PointerEvent) => { if (!host.contains(event.target as Node)) dismiss(); };
  function show() {
    if (!root.hidden) return; root.hidden = false;
    if (!listening) { doc.addEventListener('pointerdown', outside); listening = true; }
  }
  function hide() { root.hidden = true; if (listening) { doc.removeEventListener('pointerdown', outside); listening = false; } }
  function dismiss() { dismissed = true; hide(); }
  const maybeShow = () => { if (!dismissed) show(); };
  const release = () => { if (dismissed && !pointerIn && !focusIn) dismissed = false; };
  for (const trigger of triggers) {
    on(trigger, 'pointerenter', (event) => { if (event.pointerType !== 'touch') maybeShow(); });
    on(trigger, 'pointerdown', () => { pointerFocus = true; });
    on(trigger, 'keydown', () => { pointerFocus = false; });
    on(trigger, 'focus', () => { if (pointerFocus) { pointerFocus = false; return; } keyFocus = true; maybeShow(); });
    on(trigger, 'blur', () => { keyFocus = false; pointerFocus = false; });
    on(trigger, 'click', () => { pointerFocus = false; if (dismissOnActivate) dismiss(); else { dismissed = false; show(); } });
  }
  on(host, 'pointerenter', (event) => { if (event.pointerType !== 'touch') pointerIn = true; });
  on(host, 'pointerleave', () => { pointerIn = false; if (!keyFocus) hide(); release(); });
  on(host, 'focusin', () => { focusIn = true; });
  on(host, 'focusout', (event) => { if (host.contains(event.relatedTarget as Node)) return; focusIn = false; keyFocus = false; hide(); release(); });
  on(host, 'keydown', (event) => { if (event.key === 'Escape' && !root.hidden) dismiss(); });
  return {
    root, show, hide, dismiss,
    setText(next: string) { root.textContent = next; },
    destroy() {
      undo.forEach((off) => off()); hide(); root.remove();
      triggers.forEach((trigger, at) => {
        if (added[at]) return;
        const rest = (trigger.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((one) => one && one !== id);
        if (rest.length) trigger.setAttribute('aria-describedby', rest.join(' ')); else trigger.removeAttribute('aria-describedby');
      });
    },
  };
}

@Directive({ selector: '[gcspHelpTip]', exportAs: 'gcspHelpTip' })
export class HelpTipDirective implements AfterViewInit, OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  @Input({ required: true }) gcspHelpTip = '';
  @Input({ required: true }) helpTipId = '';
  @Input() helpTipPlacement: HelpTipPlacement = 'below-start';
  @Input() helpTipDismissOnActivate = true;
  @Input() helpTipTriggers = 'input, button';
  private ready = false;
  private tip?: ReturnType<typeof helpTip>;
  ngAfterViewInit(): void { this.ready = true; this.mount(); }
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.ready) return;
    if (this.tip && this.gcspHelpTip && Object.keys(changes).every((key) => key === 'gcspHelpTip')) this.tip.setText(this.gcspHelpTip); else this.mount();
  }
  private mount(): void {
    this.tip?.destroy(); this.tip = undefined; if (!this.gcspHelpTip) return;
    this.tip = helpTip({ host: this.host.nativeElement, triggers: Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(this.helpTipTriggers)),
      text: this.gcspHelpTip, id: this.helpTipId, placement: this.helpTipPlacement, dismissOnActivate: this.helpTipDismissOnActivate });
  }
  dismiss(): void { this.tip?.dismiss(); }
  show(): void { this.tip?.show(); }
  hide(): void { this.tip?.hide(); }
  ngOnDestroy(): void { this.tip?.destroy(); }
}
