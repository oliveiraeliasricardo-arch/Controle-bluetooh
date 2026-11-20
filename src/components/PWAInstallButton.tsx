import { useEffect, useState } from 'react';
import { Check, Copy, Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!showGuide) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowGuide(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showGuide]);

  // Automatically hide once running as an installed standalone app
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard denial
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] transition-colors hover:bg-[#DBEAFE] active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Instalar app
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#101828]/50 p-4 sm:items-center"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#E4E7EC] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="Ícone TelaLivre"
                  className="h-11 w-11 rounded-xl border border-[#E4E7EC]"
                />
                <div>
                  <h2
                    id="pwa-install-title"
                    className="font-display text-base font-bold text-[#101828]"
                  >
                    Instalar TelaLivre
                  </h2>
                  <p className="text-xs text-[#667085]">App direto na tela inicial</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setShowGuide(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#667085] transition-colors hover:bg-[#F2F4F7] hover:text-[#101828] cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-5 space-y-3 text-sm text-[#344054]">
                <li className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold text-[#1D4ED8]">
                    1
                  </span>
                  <span>
                    Toque no botão{' '}
                    <strong className="inline-flex items-center gap-1 font-semibold text-[#101828]">
                      Compartilhar <Share className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                    </strong>{' '}
                    na barra do Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold text-[#1D4ED8]">
                    2
                  </span>
                  <span>
                    Role para baixo e toque em{' '}
                    <strong className="font-semibold text-[#101828]">
                      Adicionar à Tela de Início
                    </strong>
                    .
                  </span>
                </li>
              </ol>
            ) : (
              <div className="mt-5 space-y-3 text-sm text-[#344054]">
                {isInIframe && (
                  <p className="rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] px-3.5 py-2.5 text-xs text-[#475467]">
                    Abra o link no Chrome do celular ou Safari do iPhone para instalar o ícone na
                    tela inicial.
                  </p>
                )}
                <ol className="space-y-2.5">
                  <li className="flex items-start gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold text-[#1D4ED8]">
                      1
                    </span>
                    <span>
                      No <strong className="font-semibold text-[#101828]">Android (Chrome)</strong>,
                      abra o menu <strong className="font-semibold text-[#101828]">⋮</strong> e
                      toque em <strong className="font-semibold text-[#101828]">Instalar app</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EFF6FF] text-xs font-semibold text-[#1D4ED8]">
                      2
                    </span>
                    <span>
                      No <strong className="font-semibold text-[#101828]">iPhone (Safari)</strong>,
                      toque em <strong className="font-semibold text-[#101828]">Compartilhar</strong>{' '}
                      e depois em{' '}
                      <strong className="font-semibold text-[#101828]">
                        Adicionar à Tela de Início
                      </strong>
                      .
                    </span>
                  </li>
                </ol>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2.5 text-sm font-medium text-[#101828] transition-colors hover:bg-[#F9FAFB] cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-[#15803D]" aria-hidden="true" />
                      Link copiado
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 text-[#475467]" aria-hidden="true" />
                      Copiar link para abrir no celular
                    </>
                  )}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] cursor-pointer"
            >
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
