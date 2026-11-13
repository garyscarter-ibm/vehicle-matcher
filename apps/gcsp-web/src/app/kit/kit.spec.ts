import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ButtonDirective } from './button.directive';
import { ErrorSummaryComponent } from './error-summary.component';
import { LabelledFieldComponent } from './labelled-field.component';
import { StatusScreenComponent } from './status-screen.component';
@Component({ imports: [ButtonDirective, LabelledFieldComponent, ErrorSummaryComponent], template: `<button gcspButton type="button" disabled>Continue</button><gcsp-error-summary [errors]="[{ controlId: 'email', message: 'Enter an email.' }]" /><gcsp-labelled-field controlId="email" label="Email" hint="Notification address" error="Enter an email."><input id="email" aria-invalid="true" aria-describedby="email-hint email-error" /></gcsp-labelled-field>` })
class FieldHarness {}
describe('shared Angular kit', () => {
  it('renders a busy status with a single page heading', async () => {
    const fixture = TestBed.createComponent(StatusScreenComponent);
    fixture.componentRef.setInput('title', 'Loading your account'); fixture.componentRef.setInput('busy', true); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]').getAttribute('aria-busy')).toBe('true');
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Loading your account');
  });
  it('uses native disabled controls, associated labels, descriptions and summary focus', async () => {
    const fixture = TestBed.createComponent(FieldHarness); await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement; const input = root.querySelector('input')!;
    expect(root.querySelector('button')?.disabled).toBe(true);
    expect(root.querySelector('label')?.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-describedby')?.split(' ').every((id) => root.querySelector(`#${id}`))).toBe(true);
    document.body.append(root); root.querySelector<HTMLAnchorElement>('.gcsp-error-summary a')!.click();
    expect(document.activeElement).toBe(input); root.remove();
  });
  it('does not announce an empty error summary', async () => { const fixture = TestBed.createComponent(ErrorSummaryComponent); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull(); });
});
