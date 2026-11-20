import { useEffect, useState } from 'react';
import { Keyboard, MousePointerClick, Tv } from 'lucide-react';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { BluetoothKeyboardWorkspace } from './components/BluetoothKeyboardWorkspace';
import { TvReceiverView } from './components/TvReceiverView';
import type { KeyboardWorkspaceTab } from './types/tv';

function isInitialTvMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('modo') === 'tv';
}

const NAV_TABS: Array<{ id: KeyboardWorkspaceTab; label: string }> = [
  { id: 'trackpad', label: 'Touchpad' },
  { id: 'keyboard', label: 'Teclado' },
];

export default function App() {
  const [tvMode, setTvMode] = useState<boolean>(isInitialTvMode);
  const [activeTab, setActiveTab] = useState<KeyboardWorkspaceTab>('trackpad');

  useEffect(() => {
    const onPopState = () => setTvMode(isInitialTvMode());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = tvMode ? '#0B0E14' : '#FFFFFF';
    }
  }, [tvMode]);

  const toggleTvMode = (next: boolean) => {
    setTvMode(next);
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set('modo', 'tv');
    } else {
      url.searchParams.delete('modo');
    }
    window.history.pushState({}, '', url.toString());
  };

  const handleSelectTab = (tab: KeyboardWorkspaceTab) => {
    if (tab === 'keyboard' && activeTab === 'keyboard') {
      setActiveTab('trackpad');
      return;
    }
    setActiveTab(tab);
  };

  if (tvMode) {
    return (
      <>
        <TvReceiverView onExitTvMode={() => toggleTvMode(false)} />
        <OfflineIndicator />
      </>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F4F6F9] text-[#0F172A]">
      <header className="sticky top-0 z-30 border-b border-[#E2E8F0] bg-white pt-safe">
        <div className="mx-auto flex h-12 sm:h-14 max-w-4xl items-center justify-between gap-8 px-4 sm:px-6">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('trackpad');
            }}
            className="font-display text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0"
          >
            TeclaTV
          </a>

          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#475569]"
          >
            {NAV_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectTab(tab.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'text-[#1D4ED8] underline underline-offset-8 decoration-2'
                      : 'hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => toggleTvMode(true)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0F172A] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1E293B] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Tv className="h-3.5 w-3.5" aria-hidden="true" />
              Modo TV
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <BluetoothKeyboardWorkspace
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          onOpenTvMode={() => toggleTvMode(true)}
        />
      </main>

      <nav
        aria-label="Abas do controle"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E2E8F0] bg-white/95 backdrop-blur-md pb-safe md:hidden"
      >
        <div className="grid h-14 grid-cols-2 items-center">
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.id === 'keyboard' ? Keyboard : MousePointerClick;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectTab(tab.id)}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive ? 'text-[#1D4ED8]' : 'text-[#64748B]'
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
