import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FinishLabelComponent } from './finish-label.component';
import { finishShade } from './finish-shades';

describe('source decorative finish shades', () => {
  it.each([
    [{ label: 'Paint', value: 'Portimao Blue metallic' }, 'blue'],
    [{ label: '  ＣＯＬＯＵＲ ', value: '  ALPINE\u00a0WHITE   SOLID ' }, 'white'],
    [{ label: 'Interior', value: 'Black with blue stitching Vernasca leather' }, 'black'],
    [{ label: 'Upholstery', value: 'Oyster Veganza' }, 'beige'],
    [{ label: 'Paint', value: 'Alpine White', shade: ' ＲＥＤ ' }, 'red'],
    [{ label: 'Paint', value: 'Alpine White', shade: 'unsupported' }, null],
    [{ label: 'Paint', value: 'Alpine White', shade: 0 }, null],
    [{ label: 'Paint', value: 'BMW Individual paintwork' }, null],
    [{ label: 'Upholstery', value: 'Coral red/black Veganza' }, null],
    [{ label: 'Paint', value: 'A new blue paint name' }, null],
    [{ label: 'Upholstery', value: 'Unknown black with blue stitching' }, null],
    [{ label: 'Other', value: 'Alpine White' }, null],
    [{ label: 'Paint', value: null }, null],
  ])('maps only an exact recognised name or supported explicit shade: %j', (finish, want) => {
    expect(finishShade(finish)).toBe(want);
  });

  it('keeps the full supplied value readable beside a decorative known swatch', async () => {
    const fixture = TestBed.createComponent(FinishLabelComponent);
    fixture.componentRef.setInput('label', 'Upholstery');
    fixture.componentRef.setInput('value', 'Black with blue stitching Vernasca leather');
    fixture.componentRef.setInput('labelled', true);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-finish-copy .gcsp-finish-label')?.textContent).toBe('Upholstery');
    expect(root.querySelector('.gcsp-finish-value')?.textContent).toBe('Black with blue stitching Vernasca leather');
    const swatch = root.querySelector<HTMLElement>('.gcsp-finish-swatch')!;
    expect(swatch.getAttribute('aria-hidden')).toBe('true');
    expect(swatch.style.backgroundColor).toBe('rgb(29, 29, 31)');
    expect(swatch.classList.contains('is-unknown')).toBe(false);
  });

  it('retains an unsupported explicit shade as neutral while the full name stays readable', async () => {
    const fixture = TestBed.createComponent(FinishLabelComponent);
    fixture.componentRef.setInput('label', 'Paint');
    fixture.componentRef.setInput('value', 'Alpine White');
    fixture.componentRef.setInput('shade', 'not a supported shade');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.gcsp-finish-value')?.textContent).toBe('Alpine White');
    expect(root.querySelector('.gcsp-finish-label')).toBeNull();
    expect(root.querySelector<HTMLElement>('.gcsp-finish-swatch.is-unknown')?.style.backgroundColor).toBe('rgb(200, 204, 206)');
  });

  it('shows a missing finish without inventing its colour', async () => {
    const fixture = TestBed.createComponent(FinishLabelComponent);
    fixture.componentRef.setInput('label', 'Paint');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.gcsp-finish-value')?.textContent).toBe('Paint not supplied');
    expect(fixture.nativeElement.querySelector('.gcsp-finish-swatch.is-unknown')?.getAttribute('aria-hidden')).toBe('true');
  });
});
