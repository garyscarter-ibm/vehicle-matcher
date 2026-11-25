import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorSummaryComponent, FieldError } from './error-summary.component';

const errors: readonly FieldError[] = Object.freeze([Object.freeze({ controlId: 'summary-email', message: 'Enter an email address.' })]);
const fixtures: ComponentFixture<ErrorSummaryComponent>[] = [];
const extras: HTMLElement[] = [];
afterEach(() => { fixtures.splice(0).forEach(fixture => { (fixture.nativeElement as HTMLElement).remove(); fixture.destroy(); }); extras.splice(0).forEach(node => node.remove()); TestBed.resetTestingModule(); });

interface Settings { source?: boolean; id?: string; title?: string; errors?: readonly FieldError[] }
function create(settings: Settings = {}) {
  const fixture = TestBed.createComponent(ErrorSummaryComponent); fixtures.push(fixture);
  fixture.componentRef.setInput('presentation', settings.source ? 'source' : 'default');
  fixture.componentRef.setInput('errors', settings.errors ?? errors);
  if (settings.id !== undefined) fixture.componentRef.setInput('summaryId', settings.id);
  if (settings.title !== undefined) fixture.componentRef.setInput('title', settings.title);
  return fixture;
}
async function render(settings: Settings = {}) {
  const fixture = create(settings); await fixture.whenStable(); fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement; document.body.append(host);
  return { fixture, host, section: host.querySelector<HTMLElement>('section')!, heading: host.querySelector<HTMLHeadingElement>('h2')!, link: host.querySelector<HTMLAnchorElement>('a')! };
}
function extra(tag: 'input' | 'button', id?: string) { const node = document.createElement(tag); if (id) node.id = id; document.body.append(node); extras.push(node); return node; }

describe('compatible source ErrorSummary', () => {
  it('keeps the default alert, section focus, heading identity and message contract', async () => {
    const { fixture, section, heading, link } = await render();
    expect(section.className).toBe('gcsp-error-summary'); expect(section.getAttribute('role')).toBe('alert'); expect(section.tabIndex).toBe(-1);
    expect((fixture.nativeElement as HTMLElement).classList.contains('is-source')).toBe(false);
    expect(heading.id).toBe('error-summary-title'); expect(heading.textContent).toBe('Check the following'); expect(heading.className).toBe('');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id); expect(link.getAttribute('href')).toBe('#summary-email'); expect(link.textContent).toBe('Enter an email address.');
    fixture.componentInstance.focus(); expect(document.activeElement).toBe(section);
  });

  it('keeps empty default summaries out of the DOM', async () => {
    const { fixture, host } = await render({ errors: [] }); expect(host.querySelector('section')).toBeNull();
    expect(() => fixture.componentInstance.focus()).not.toThrow();
  });

  it('uses source heading/link classes and distinct supplied identities with truthful titles', async () => {
    const a = await render({ source: true, id: 'offer-errors', title: 'Check before continuing' });
    const b = await render({ source: true, id: 'other-errors' });
    expect(a.heading.id).toBe('offer-errors-title'); expect(b.heading.id).toBe('other-errors-title');
    expect(a.host.classList.contains('is-source')).toBe(true);
    expect(a.heading.textContent).toBe('Check before continuing'); expect(b.heading.textContent).toBe('Check your choices');
    expect(a.heading.className).toBe('gcsp-h2'); expect(a.heading.tabIndex).toBe(-1);
    expect(a.section.querySelector('ul')?.className).toBe('gcsp-error-links'); expect(a.section.getAttribute('aria-labelledby')).toBe(a.heading.id);
    expect(a.section.hasAttribute('role')).toBe(false); expect(a.section.hasAttribute('tabindex')).toBe(false);
    expect(a.link.textContent).toBe('Enter an email address.'); expect(a.link.getAttribute('href')).toBe('#summary-email');
  });

  it('focuses the source heading explicitly without taking focus on mount', async () => {
    const outside = extra('button'); outside.focus();
    const { fixture, heading } = await render({ source: true, id: 'offer-errors' });
    expect(document.activeElement).toBe(outside); fixture.componentInstance.focus(); expect(document.activeElement).toBe(heading);
  });

  it('retains a hidden source root when empty and updates it without implicit focus', async () => {
    const outside = extra('button'); outside.focus();
    const { fixture, section, heading, host } = await render({ source: true, id: 'offer-errors', errors: [] });
    expect(section).not.toBeNull(); expect(section.hidden).toBe(true); expect(section.querySelectorAll('li')).toHaveLength(0);
    expect(host.classList.contains('is-source')).toBe(true);
    fixture.componentInstance.focus(); expect(document.activeElement).toBe(outside);
    fixture.componentRef.setInput('errors', errors); await fixture.whenStable();
    expect(host.querySelector('section')).toBe(section); expect(host.querySelector('h2')).toBe(heading); expect(section.hidden).toBe(false);
    expect(section.querySelector('a')?.textContent).toBe('Enter an email address.'); expect(document.activeElement).toBe(outside);
    fixture.componentRef.setInput('errors', []); await fixture.whenStable(); expect(section.hidden).toBe(true); expect(host.classList.contains('is-source')).toBe(true);
  });

  it('focuses the actual native source target and prevents fragment navigation', async () => {
    const control = extra('input', 'summary-email'); const { link } = await render({ source: true, id: 'offer-errors' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true }); expect(link.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true); expect(document.activeElement).toBe(control);
  });

  it('delegates a source link to the caller without replacing its intent with global lookup', async () => {
    extra('input', 'summary-email'); const outside = extra('button'); outside.focus();
    const { fixture, link } = await render({ source: true, id: 'offer-errors' }); const select = vi.fn();
    fixture.componentRef.setInput('onSelect', select); fixture.detectChanges();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true }); link.dispatchEvent(event);
    expect(select).toHaveBeenCalledExactlyOnceWith('summary-email'); expect(event.defaultPrevented).toBe(true); expect(document.activeElement).toBe(outside);
    expect(fixture.componentInstance.errors()).toBe(errors); expect(errors[0].message).toBe('Enter an email address.');
  });

  it('prevents a source link with a missing target without inventing a successful focus', async () => {
    const outside = extra('button'); outside.focus(); const { link } = await render({ source: true, id: 'offer-errors' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true }); link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(document.activeElement).toBe(outside);
  });

  it('preserves the default missing-target click behavior', async () => {
    const { fixture, link } = await render(); const event = new MouseEvent('click', { cancelable: true });
    Object.defineProperty(event, 'target', { value: link }); fixture.componentInstance.focusControl(event, 'missing-control'); expect(event.defaultPrevented).toBe(false);
  });

  it.each([undefined, ''])('requires a nonempty source summary ID: %s', id => {
    const fixture = create({ source: true, id }); expect(() => fixture.detectChanges()).toThrowError('A unique summary id is required.');
  });

  it('keeps supplied title and message markup literal', async () => {
    const title = '<img src=x onerror=alert(1)>Check'; const message = 'Enter <b>an email</b>.';
    const { host, heading, link } = await render({ source: true, id: 'offer-errors', title, errors: [{ controlId: 'summary-email', message }] });
    expect(heading.textContent).toBe(title); expect(link.textContent).toBe(message); expect(host.querySelector('img, b')).toBeNull();
  });
});
