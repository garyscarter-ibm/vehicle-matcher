import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthPort } from '../auth/auth.port';
import { safeReturnTo } from '../auth/route-policy';
import { ButtonDirective } from '../kit/button.directive';
import { StatusScreenComponent } from '../kit/status-screen.component';
@Component({ selector: 'gcsp-state-page', imports: [StatusScreenComponent, ButtonDirective], template: `
  @if (auth.state().status === 'loading' || callbackBusy) { <gcsp-status-screen title="Loading your account" message="Please wait." [busy]="true" /> }
  @else if (kind === 'denied' || auth.state().status === 'denied') { <gcsp-status-screen title="Access not available" message="Your account does not have access to this page."><button gcspButton type="button" (click)="home()">Go to your home</button></gcsp-status-screen> }
  @else if (kind === 'sign-in' && auth.state().status !== 'unavailable') { <gcsp-status-screen title="Sign in" message="Sign in to your Group Car Schemes account."><button gcspButton type="button" [disabled]="working" (click)="signIn()">Sign in</button></gcsp-status-screen> }
  @else if (auth.state().status === 'unavailable' || kind === 'unavailable' || kind === 'callback' || callbackFailed) { <gcsp-status-screen title="Account unavailable" message="We could not load your account. Please try again."><button gcspButton type="button" [disabled]="working" (click)="retry()">Try again</button></gcsp-status-screen> }
  @else if (kind === 'not-found') { <gcsp-status-screen title="Page not found" message="Check the link or return to your home."><button gcspButton type="button" (click)="home()">Go to your home</button></gcsp-status-screen> }
  @else { <gcsp-status-screen [title]="title" message="This page is not available yet." /> }
  @if (actionFailed) { <p role="alert" class="gcsp-field-error">We could not complete that request. Please try again.</p> }
` })
export class StatePageComponent implements OnInit {
  readonly auth = inject(AuthPort); private readonly route = inject(ActivatedRoute); private readonly router = inject(Router);
  readonly kind: string = this.route.snapshot.data['kind'] ?? 'feature'; readonly title: string = this.route.snapshot.data['title'] ?? 'Group Car Schemes';
  working = false; callbackBusy = false; callbackFailed = false; actionFailed = false;
  async ngOnInit(): Promise<void> {
    if (this.kind !== 'callback') return;
    this.callbackBusy = true;
    try { const target = await this.auth.completeSignIn(); if (this.auth.state().status === 'ready') await this.router.navigateByUrl(safeReturnTo(typeof target === 'string' ? target : null).replace(/^\/gcsp/, '')); else this.callbackFailed = true; }
    catch { this.callbackFailed = true; } finally { this.callbackBusy = false; }
  }
  async signIn(): Promise<void> { await this.run(() => this.auth.signIn(safeReturnTo(this.route.snapshot.queryParamMap.get('returnTo')))); }
  async retry(): Promise<void> { await this.run(async () => { await this.auth.retry(); if (this.auth.state().status === 'ready') await this.router.navigateByUrl('/'); }); }
  async home(): Promise<void> { await this.router.navigateByUrl('/'); }
  private async run(action: () => Promise<unknown>): Promise<void> { if (this.working) return; this.working = true; this.actionFailed = false; try { await action(); } catch { this.actionFailed = true; } finally { this.working = false; } }
}
