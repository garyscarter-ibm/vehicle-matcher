import { Component, input } from '@angular/core';
@Component({ selector: 'gcsp-labelled-field', template: `<div class="gcsp-field"><label [for]="controlId()">{{ label() }}</label>@if (hint()) { <p [id]="controlId() + '-hint'" class="gcsp-note">{{ hint() }}</p> }<ng-content />@if (error()) { <p [id]="controlId() + '-error'" class="gcsp-field-error">{{ error() }}</p> }</div>` })
export class LabelledFieldComponent { readonly controlId = input.required<string>(); readonly label = input.required<string>(); readonly hint = input(''); readonly error = input(''); }
