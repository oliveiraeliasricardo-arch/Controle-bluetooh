import { BookOpen, Cast, Tv, Wifi } from 'lucide-react';
import type { AppSection } from '../types/tv';

interface HeaderProps {
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
}

const NAV_ITEMS: { id: AppSection; label: string; mobileLabel: string; icon: typeof Cast }[] = [
  { id: 'pair', label: 'Espelhar na TV', mobileLabel: 'Espelhar', icon: Cast },
  { id: 'guide', label: 'Guia nativo', mobileLabel: 'Guia', icon: BookOpen },
  { id: 'diagnostics', label: 'Diagnóstico Wi-Fi', mobileLabel: 'Wi-Fi', icon: Wifi },
  { id: 'tv', label: 'Receptor TV', mobileLabel: 'TV', icon: Tv },
];

export function Header({ activeSection, onNavigate }: HeaderProps) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[#E4E7EC] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-8 px-4 sm:h-16 sm:px-6">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('pair')}
            className="font-display text-xl font-bold tracking-tight text-[#101828] whitespace-nowrap shrink-0 cursor-pointer"
          >
            TelaLivre
          </button>

          {/* Zone 2: 4 clean single-line text nav links */}
          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#475467]"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`relative py-1 whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? 'text-[#101828] font-semibold after:absolute after:inset-x-0 after:-bottom-[21px] after:h-[2px] after:bg-[#1D4ED8]'
                      : 'hover:text-[#101828]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('tv')}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#1E40AF] active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Abrir tela TV
            </button>
          </div>
        </div>
      </header>

      {/* Mobile ergonomic bottom navigation bar (<= 15% aggregate sticky height with header) */}
      <nav
        aria-label="Navegação inferior"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E4E7EC] bg-white/95 backdrop-blur-md md:hidden pb-safe"
      >
        <div className="grid h-14 grid-cols-4 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors duration-150 cursor-pointer ${
                  isActive ? 'text-[#1D4ED8] font-semibold' : 'text-[#667085]'
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="text-[11px] leading-none whitespace-nowrap">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
