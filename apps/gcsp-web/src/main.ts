import { inject, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { ShellComponent } from './app/shell/shell.component';
import { routes } from './app/routes';
import { AuthPort } from './app/auth/auth.port';
import { OidcAuthService } from './app/auth/oidc-auth.service';
import { BootstrapConfig, INITIAL_RUNTIME_CONFIG, loadRuntimeConfig, RuntimeConfigError } from './app/auth/runtime-config';
async function start(): Promise<void> {
  let initial: BootstrapConfig;
  try { initial = { value: await loadRuntimeConfig(globalThis.fetch.bind(globalThis), window.location.origin) }; }
  catch (error) { initial = { error: error instanceof RuntimeConfigError ? error : new RuntimeConfigError('config-unavailable') }; }
  await bootstrapApplication(ShellComponent, { providers: [provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })), { provide: INITIAL_RUNTIME_CONFIG, useValue: initial }, { provide: AuthPort, useExisting: OidcAuthService }, provideAppInitializer(() => inject(AuthPort).initialize())] });
}
void start().catch(() => { document.body.textContent = 'The portal could not be loaded. Please refresh the page.'; });
