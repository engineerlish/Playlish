import { render } from 'preact';
import type { UiApi } from '../../shared/types';
import { App } from './App';

/*
 * Entry point of the main window. Preact is internal to this window: the playback host page and (later) plugins never
 * depend on it.
 */

declare global {
  interface Window {
    ui: UiApi;
  }
}

/** Sends uncaught errors and unhandled promise rejections in this page to the main process log. */
function forwardPageErrors(report: (message: string, stack?: string) => void): void {
  window.addEventListener('error', (event) => {
    const error = event.error as unknown;
    report(event.message || String(error), error instanceof Error ? error.stack : undefined);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    report(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined);
  });
}

forwardPageErrors((message, stack) => window.ui.reportError(message, stack));
const root = document.getElementById('app');
if (root) render(<App />, root);
