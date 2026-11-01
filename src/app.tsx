import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { IconAsk, IconDatabase, IconSettings } from './components/Icons';
import { UpdateBanner } from './components/UpdateBanner';
import { RemoteUpdate } from './components/RemoteUpdate';
import { useOnline } from './lib/online';
import { AskPage } from './pages/Ask';
import { DatabasePage } from './pages/Database';
import { SettingsPage } from './pages/Settings';

type Tab = 'chiedi' | 'database' | 'impostazioni';

const TABS: { id: Tab; label: string; Icon: ComponentType }[] = [
  { id: 'chiedi', label: 'Chiedi', Icon: IconAsk },
  { id: 'database', label: 'Database', Icon: IconDatabase },
  { id: 'impostazioni', label: 'Impostazioni', Icon: IconSettings }
];

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '').split('/')[0];
  return (TABS.some((t) => t.id === h) ? h : 'chiedi') as Tab;
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const online = useOnline();

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

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div class="app">
      <header class="topbar">
        <h1>{tab === 'chiedi' ? 'Consulta' : current.label}</h1>
        <span class={`badge ${online ? 'badge-online' : 'badge-offline'}`} role="status" aria-live="polite">
          {online ? 'Online' : 'Offline'}
        </span>
      </header>

      <main>
        <UpdateBanner />
        <RemoteUpdate />
        {tab === 'chiedi' && <AskPage online={online} />}
        {tab === 'database' && <DatabasePage online={online} />}
        {tab === 'impostazioni' && <SettingsPage online={online} />}
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
