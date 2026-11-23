import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TaskGroup, TaskListComponent } from './task-list.component';

@Component({
  imports: [TaskListComponent],
  template: `<section gcspTaskList [groups]="groups()" [heading]="heading()" [emptyText]="emptyText()" [level]="level()" [rows]="rows()"></section>`,
})
class TaskHarness {
  readonly groups = input<readonly TaskGroup[]>([]);
  readonly heading = input('Tasks');
  readonly emptyText = input('No tasks.');
  readonly level = input<1 | 2 | 3 | 4 | 5 | 6>(2);
  readonly rows = input(false);
}

async function render(groups: readonly TaskGroup[] = []) {
  const fixture = TestBed.createComponent(TaskHarness);
  fixture.componentRef.setInput('groups', groups);
  await fixture.whenStable();
  return fixture;
}

describe('TaskListComponent source port', () => {
  it('keeps the source section, named heading and empty state without empty groups', async () => {
    const fixture = await render([{ heading: 'Empty group', items: [] }]);
    const root: HTMLElement = fixture.nativeElement.querySelector('section');
    expect(root.tagName).toBe('SECTION');
    expect(root.className).toBe('gcsp-task-list');
    const heading = root.querySelector('h2.gcsp-task-heading')!;
    expect(heading.textContent).toBe('Tasks');
    expect(root.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(root.querySelector('.gcsp-task-empty')?.textContent).toBe('No tasks.');
    expect(root.querySelector('.gcsp-task-group')).toBeNull();
  });

  it('groups real owned rows with source tone flags, due time and acknowledgement detail', async () => {
    const fixture = await render([
      { heading: 'Your tasks', items: [
        { id: 'terms', label: 'Read terms', owner: 'You', status: 'Needs acknowledgement', tone: 'overdue', due: '2026-07-02T08:00:00Z', detail: 'Acknowledgement, not a signature' },
        { id: 'failed', label: 'Evidence', owner: 'You', status: 'Do not repeat failed status', tone: 'failed', reason: 'Upload rejected' },
      ] },
      { heading: 'Empty', items: [] },
      { heading: 'Being handled by others', items: [{ id: 'employer', label: 'Employer check', owner: 'Employer', status: 'Checking', tone: 'in-progress' }] },
    ]);
    const root: HTMLElement = fixture.nativeElement.querySelector('section');
    expect(Array.from(root.querySelectorAll('.gcsp-task-group-heading')).map(node => node.textContent)).toEqual(['Your tasks', 'Being handled by others']);
    expect(Array.from(root.querySelectorAll('.gcsp-task')).map(node => node.className)).toEqual(['gcsp-task is-overdue', 'gcsp-task is-failed', 'gcsp-task is-in-progress']);
    expect(root.querySelector('.gcsp-task-meta')?.textContent).toBe('You. Needs acknowledgement. Due 2 Jul 2026, 09:00.');
    expect(Array.from(root.querySelectorAll('.gcsp-task-flag')).map(node => node.textContent)).toEqual(['Overdue', 'Failed: Upload rejected']);
    expect(root.textContent).not.toContain('Do not repeat failed status');
    expect(root.querySelector('.gcsp-task-detail')?.textContent).toBe('Acknowledgement, not a signature');
  });

  it('uses valid supplied tones and omits invalid due values without inventing metadata', async () => {
    const fixture = await render([{ items: [
      { id: 'todo', label: 'To do', due: 'not-a-date' },
      { id: 'done', label: 'Done', tone: 'done', due: null },
      { id: 'unknown', label: 'Unknown', tone: 'unrecognised', due: '' },
    ] }]);
    const root: HTMLElement = fixture.nativeElement.querySelector('section');
    expect(Array.from(root.querySelectorAll('.gcsp-task')).map(node => node.className)).toEqual(['gcsp-task is-todo', 'gcsp-task is-done', 'gcsp-task is-todo']);
    expect(root.querySelector('.gcsp-task-meta, .gcsp-task-flag')).toBeNull();
  });

  it('calls only the selected caller action with its exact task id', async () => {
    const selected: string[] = [];
    const fixture = await render([{ items: [{ id: 'document/version-2', label: 'Terms', action: { label: 'Acknowledge', onSelect: id => selected.push(id) } }] }]);
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect([button.type, button.className, button.textContent]).toEqual(['button', 'vm-btn vm-btn-primary', 'Acknowledge']);
    expect(selected).toEqual([]);
    button.click();
    expect(selected).toEqual(['document/version-2']);
  });

  it('disables unavailable actions and associates each visible reason with only its own button', async () => {
    const selected: string[] = [];
    const group: TaskGroup = { items: [
      { id: 'disabled', label: 'Saving', action: { label: 'Acknowledge', disabled: true, reason: 'Being processed', onSelect: id => selected.push(id) } },
      { id: 'no-caller', label: 'Unavailable', action: { label: 'Acknowledge', reason: 'Preview only' } },
    ] };
    const fixture = await render([group]);
    const other = await render([group]);
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.map(button => button.disabled)).toEqual([true, true]);
    for (const button of buttons) button.click();
    expect(selected).toEqual([]);
    const ids = buttons.map(button => button.getAttribute('aria-describedby')!);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set([...ids, ...[...other.nativeElement.querySelectorAll('button')].map((button: HTMLButtonElement) => button.getAttribute('aria-describedby'))]).size).toBe(4);
    expect(ids.map(id => fixture.nativeElement.querySelector(`#${id}`)?.textContent)).toEqual(['Being processed', 'Preview only']);
  });

  it('updates source row mode, heading levels and empty copy without mutating caller data', async () => {
    const groups = Object.freeze([Object.freeze({ heading: 'Owned', items: Object.freeze([Object.freeze({ id: 'safe', label: '<b>Source text</b>' })]) })]);
    const fixture = await render(groups);
    fixture.componentRef.setInput('heading', 'Documents');
    fixture.componentRef.setInput('level', 6);
    fixture.componentRef.setInput('rows', true);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement.querySelector('section');
    expect(root.className).toBe('gcsp-task-list is-rows');
    expect(Array.from(root.querySelectorAll('h6')).map(node => node.textContent)).toEqual(['Documents', 'Owned']);
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.gcsp-task-label')?.textContent).toBe('<b>Source text</b>');
    fixture.componentRef.setInput('groups', []);
    fixture.componentRef.setInput('emptyText', 'Nothing to do.');
    await fixture.whenStable();
    expect(root.querySelector('.gcsp-task-empty')?.textContent).toBe('Nothing to do.');
    expect(groups[0].items[0].id).toBe('safe');
  });
});
