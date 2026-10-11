import { useEffect, useState } from 'preact/hooks';
import { PAGES, type Page } from '../../shared/pages';
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

/** The whole window: the setup wizard until setup is done, then sidebar, page, banners and the Now Playing bar. */
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    window.ui.onSnapshot(setSnapshot);
    window.ui.requestSnapshot();
  }, []);

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
      <main id="content" class="content" tabIndex={-1} aria-label={current}>
        <div id="status" class="status" role="status">
          {snapshot.status}
        </div>
        <Banners snapshot={snapshot} />
        {/* Settings and Plugins stay reachable while logged out: diagnostics and safe mode must work without a login. */}
        {current === 'settings' ? (
          <SettingsPage snapshot={snapshot} />
        ) : current === 'plugins' ? (
          <PluginsPage snapshot={snapshot} />
        ) : !snapshot.loggedIn && !snapshot.configError ? (
          <section class="card">
            <h2>Log in to Spotify</h2>
            <p>Playlish needs your Spotify login to play music.</p>
            <button id="login" class="primary" onClick={() => window.ui.login()}>
              Log in with Spotify
            </button>
          </section>
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
      <NowPlayingBar snapshot={snapshot} />
    </div>
  );
}
