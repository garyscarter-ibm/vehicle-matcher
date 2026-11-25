import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { HeadingLevel, ScreenIntroComponent } from './screen-intro.component';
import { StatusScreenComponent } from './status-screen.component';

@Component({
  imports: [ScreenIntroComponent, StatusScreenComponent],
  template: `<div gcspScreenIntro [presentation]="presentation()" title="Your offer" [level]="level()" [kicker]="kicker()" [lede]="message()"></div>
    <div gcspStatusScreen [presentation]="presentation()" title="Selection unavailable" [level]="level()" [kicker]="kicker()" [message]="message()" [announcement]="announcement()" [busy]="busy()">
      <button type="button" (click)="clicks = clicks + 1">Contact support</button><a href="#cars">Back to Your cars</a>
    </div>`,
})
class SourceScreenHost {
  readonly presentation = signal<'default' | 'source'>('source');
  readonly level = signal<HeadingLevel | undefined>(undefined);
  readonly kicker = signal('Your selection');
  readonly message = signal('The car stays reserved for you.');
  readonly announcement = signal<'status' | 'alert' | null>('status');
  readonly busy = signal(false);
  clicks = 0;
}

afterEach(() => TestBed.resetTestingModule());

describe('source screen heading and status presenters', () => {
  it('retains the legacy wrapper, first-level heading and unique interactive projected actions by default', async () => {
    const fixture = TestBed.createComponent(SourceScreenHost); const host = fixture.componentInstance;
    host.presentation.set('default'); await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
    const panel = root.querySelector('[gcspStatusScreen] > section.gcsp-panel.gcsp-status');
    expect(panel?.getAttribute('role')).toBe('status');
    expect(root.querySelector('[gcspScreenIntro] > h1.gcsp-page-title')?.getAttribute('tabindex')).toBe('-1');
    expect(panel?.querySelector('gcsp-screen-intro > h1.gcsp-page-title')?.textContent).toBe('Selection unavailable');
    expect(panel?.querySelectorAll('.gcsp-actions > button')).toHaveLength(1);
    panel?.querySelector<HTMLButtonElement>('button')!.click(); expect(host.clicks).toBe(1);
    expect(root.querySelector('[gcspStatusScreen]')?.classList.contains('vm-screen')).toBe(false);
  });
  it.each([[undefined, 2], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]] as const)(
    'uses the source root, copy classes and heading level %s', async (level, expected) => {
      const fixture = TestBed.createComponent(SourceScreenHost); fixture.componentInstance.level.set(level);
      await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
      const intro = root.querySelector('[gcspScreenIntro]')!; const status = root.querySelector('[gcspStatusScreen]')!;
      expect(intro.tagName).toBe('DIV'); expect(status.tagName).toBe('DIV');
      expect(Array.from(intro.children, child => [child.tagName, child.className, child.textContent])).toEqual([
        ['P', 'vm-kicker', 'Your selection'], [`H${expected}`, 'vm-title', 'Your offer'], ['P', 'vm-lede', 'The car stays reserved for you.'],
      ]);
      expect(status.classList.contains('vm-screen')).toBe(true); expect(status.classList.contains('vm-status')).toBe(true);
      expect(status.querySelector(`:scope > h${expected}.vm-title`)?.textContent).toBe('Selection unavailable');
      expect(status.querySelector('section, gcsp-screen-intro, .gcsp-actions')).toBeNull();
    },
  );
  it('keeps projected actions direct, unique and interactive while respecting role and busy inputs', async () => {
    const fixture = TestBed.createComponent(SourceScreenHost); const host = fixture.componentInstance;
    host.level.set(1); host.announcement.set('alert'); host.busy.set(true); await fixture.whenStable();
    const status = (fixture.nativeElement as HTMLElement).querySelector('[gcspStatusScreen]')!;
    expect(status.getAttribute('role')).toBe('alert'); expect(status.getAttribute('aria-busy')).toBe('true');
    expect(Array.from(status.children, child => child.tagName)).toEqual(['P', 'H1', 'P', 'BUTTON', 'A']);
    expect(status.querySelectorAll('button')).toHaveLength(1); status.querySelector<HTMLButtonElement>('button')!.click();
    expect(host.clicks).toBe(1);
    host.announcement.set(null); host.busy.set(false); fixture.detectChanges(); await fixture.whenStable();
    expect(status.hasAttribute('role')).toBe(false); expect(status.hasAttribute('aria-busy')).toBe(false);
    expect(status.querySelectorAll('a')).toHaveLength(1);
  });
  it('omits absent source kicker and lede without empty copy nodes', async () => {
    const fixture = TestBed.createComponent(SourceScreenHost); const host = fixture.componentInstance;
    host.kicker.set(''); host.message.set(''); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[gcspScreenIntro]')?.querySelectorAll('p')).toHaveLength(0);
    expect(root.querySelector('[gcspStatusScreen]')?.querySelectorAll('p')).toHaveLength(0);
  });
});
