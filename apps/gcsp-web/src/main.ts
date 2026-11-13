import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { ShellComponent } from './app/shell/shell.component';
import { routes } from './app/routes';
bootstrapApplication(ShellComponent, { providers: [provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' }))] })
  .catch(() => { document.body.textContent = 'The portal could not be loaded. Please refresh the page.'; });
