import { useEffect, useState } from 'preact/hooks';
import { PAGES, PAGE_LABELS, type Page } from '../../shared/pages';
import type { Snapshot } from '../../shared/types';
import { Banners } from './Banners';
import { NowPlayingBar } from './NowPlayingBar';
import { DevicesPage } from './pages/DevicesPage';
import { LibraryPage } from './pages/LibraryPage';
import { PluginsPage } from './pages/PluginsPage';
import { QueuePage } from './pages/QueuePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupWizard } from './SetupWizard';
import { Sidebar } from './Sidebar';
import { StateMessage } from './StateMessage';

/**
 * The whole window: the setup wizard until setup is done, then the sidebar, the toolbar (page title and status, which
 * is also the title bar), the page, banners and the Now Playing bar.
 */
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    window.ui.onSnapshot(setSnapshot);
    window.ui.requestSnapshot();
  }, []);

  // The accent colour is a token switch on <html> (ui.css), so plugin panels and every control follow it.
  useEffect(() => {
    if (snapshot) document.documentElement.dataset['accent'] = snapshot.accent;
  }, [snapshot?.accent]);

  /** Switches page and remembers it for next time. */
  const navigate = (next: Page) => {
    setPage(next);
    window.ui.navigate(next);
  };

  // Alt+1 to Alt+6 switch pages.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const target = PAGES[Number(event.key) - 1];
      if (target) {
        event.preventDefault();
        navigate(target);
        document.getElementById('content')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!snapshot) return <div class="loading">Starting Playlish…</div>;
  if (snapshot.setup) return <SetupWizard view={snapshot.setup} />;

  const current = page ?? snapshot.lastPage;
  return (
    <div class="shell">
      <Sidebar current={current} onNavigate={navigate} panels={snapshot.pluginPanels.filter((p) => p.slot === 'sidebar')} />
      <div class="main">
        <header class="toolbar">
          <h1>{PAGE_LABELS[current]}</h1>
          <div id="status" class="status truncate" role="status" title={snapshot.status}>
            {snapshot.status}
          </div>
        </header>
        <main id="content" class="content" tabIndex={-1} aria-label={PAGE_LABELS[current]}>
          <Banners snapshot={snapshot} />
          {/* Settings and Plugins stay reachable while logged out: diagnostics and safe mode must work without a login. */}
          {current === 'settings' ? (
            <SettingsPage snapshot={snapshot} />
          ) : current === 'plugins' ? (
            <PluginsPage snapshot={snapshot} />
          ) : !snapshot.loggedIn && !snapshot.configError ? (
            <StateMessage kind="empty" icon="note" title="Log in to Spotify">
              <p>Playlish needs your Spotify login to play music.</p>
              <button id="login" class="primary pill" onClick={() => window.ui.login()}>
                Log in with Spotify
              </button>
            </StateMessage>
          ) : current === 'devices' ? (
            <DevicesPage snapshot={snapshot} />
          ) : current === 'search' ? (
            <SearchPage />
          ) : current === 'queue' ? (
            <QueuePage snapshot={snapshot} />
          ) : (
            <LibraryPage />
          )}
        </main>
      </div>
      <NowPlayingBar snapshot={snapshot} />
    </div>
  );
}
