import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { IconAsk, IconDatabase, IconSettings } from './components/Icons';
import { UpdateBanner } from './components/UpdateBanner';
import { RemoteUpdate } from './components/RemoteUpdate';
import { RUOLO_LABEL, useAccess } from './lib/access';
import { useOnline } from './lib/online';
import { AskPage } from './pages/Ask';
import { DatabasePage } from './pages/Database';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';

type Tab = 'chiedi' | 'database' | 'impostazioni';

const TABS: { id: Tab; label: string; Icon: ComponentType }[] = [
  { id: 'chiedi', label: 'Chiedi', Icon: IconAsk },
  { id: 'database', label: 'Archivio', Icon: IconDatabase },
  { id: 'impostazioni', label: 'Impostazioni', Icon: IconSettings }
];

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '').split('/')[0];
  return (TABS.some((t) => t.id === h) ? h : 'chiedi') as Tab;
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const online = useOnline();
  const access = useAccess();

  // Routing via hash: funziona su GitHub Pages senza configurazioni lato server
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => {
    if (location.hash.replace('#', '') !== t) location.hash = t;
    window.scrollTo(0, 0);
  };

  if (access === undefined) return <div class="app" aria-busy="true" />;

  if (access === null) {
    return (
      <div class="app">
        <main>
          <UpdateBanner />
          <LoginPage online={online} />
        </main>
      </div>
    );
  }

  const current = TABS.find((t) => t.id === tab)!;
  const isAdmin = access.ruolo === 'admin';

  return (
    <div class="app">
      <header class="topbar">
        <h1>{tab === 'chiedi' ? 'Consulta' : current.label}</h1>
        <div class="topbar-right">
          <span class={`role-badge role-${access.ruolo}`}>{RUOLO_LABEL[access.ruolo]}</span>
          <span class={`badge ${online ? 'badge-online' : 'badge-offline'}`} role="status" aria-live="polite">
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>

      <main>
        <UpdateBanner />
        <RemoteUpdate ruolo={access.ruolo} />
        {access.ruolo === 'demo' && tab === 'chiedi' && (
          <p class="demo-banner" role="note">Modalità demo: stai vedendo una selezione dei contenuti.</p>
        )}
        {tab === 'chiedi' && <AskPage online={online} access={access} />}
        {tab === 'database' && <DatabasePage online={online} isAdmin={isAdmin} />}
        {tab === 'impostazioni' && <SettingsPage online={online} access={access} />}
      </main>

      <nav class="tabbar" aria-label="Sezioni">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
