import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  RefreshCw,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { PREFLIGHT_CHECKS, TROUBLESHOOT_ITEMS } from '../data/diagnostics';
import type { AppSection } from '../types/tv';
import { ResilientImage } from './ResilientImage';

interface DiagnosticsViewProps {
  onNavigate: (section: AppSection) => void;
}

interface NetworkDiagnosticReport {
  testedAt: number;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  jitterMs: number | null;
  wsAvailable: boolean;
  webrtcAvailable: boolean;
  secureContext: boolean;
  protocol: string | null;
  connectionType: string | null;
  effectiveType: string | null;
  downlinkMbps: number | null;
  error: string | null;
}

interface NavigatorWithConnection extends Navigator {
  connection?: {
    type?: string;
    effectiveType?: string;
    downlink?: number;
  };
}

export function DiagnosticsView({ onNavigate }: DiagnosticsViewProps) {
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<NetworkDiagnosticReport | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [openSymptomId, setOpenSymptomId] = useState<string>('tv_not_found');

  const runRealNetworkTest = useCallback(async () => {
    setTesting(true);
    const samples: number[] = [];
    let protocol: string | null = null;
    let errorMsg: string | null = null;

    try {
      for (let i = 0; i < 4; i += 1) {
        const start = performance.now();
        const res = await fetch('/api/ping', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Servidor indisponível para o teste de latência.');
        }
        await res.json();
        const elapsed = performance.now() - start;
        samples.push(elapsed);
      }

      const infoRes = await fetch('/api/network-info', { cache: 'no-store' });
      if (infoRes.ok) {
        const info = (await infoRes.json()) as { protocol?: string };
        protocol = info.protocol ?? null;
      }
    } catch (err) {
      errorMsg =
        err instanceof Error ? err.message : 'Falha de comunicação durante o teste de rede.';
    }

    const avgLatencyMs =
      samples.length > 0
        ? Math.round(samples.reduce((sum, v) => sum + v, 0) / samples.length)
        : null;
    const minLatencyMs = samples.length > 0 ? Math.round(Math.min(...samples)) : null;
    const jitterMs =
      samples.length > 1
        ? Math.round(Math.max(...samples) - Math.min(...samples))
        : null;

    const nav = navigator as NavigatorWithConnection;
    const conn = nav.connection;

    setReport({
      testedAt: Date.now(),
      avgLatencyMs,
      minLatencyMs,
      jitterMs,
      wsAvailable: typeof WebSocket !== 'undefined',
      webrtcAvailable: typeof RTCPeerConnection !== 'undefined',
      secureContext: window.isSecureContext,
      protocol,
      connectionType: conn?.type ?? null,
      effectiveType: conn?.effectiveType ?? null,
      downlinkMbps: typeof conn?.downlink === 'number' ? conn.downlink : null,
      error: errorMsg,
    });
    setTesting(false);
  }, []);

  useEffect(() => {
    runRealNetworkTest();
  }, [runRealNetworkTest]);

  const toggleCheck = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const checkedCount = PREFLIGHT_CHECKS.filter((c) => checkedItems[c.id]).length;

  const latencyVerdict =
    report?.avgLatencyMs == null
      ? { label: 'Sem medição', tone: 'text-[#667085]' }
      : report.avgLatencyMs <= 60
        ? { label: 'Ótima para espelhamento', tone: 'text-[#15803D]' }
        : report.avgLatencyMs <= 140
          ? { label: 'Estável para fotos e vídeos', tone: 'text-[#B45309]' }
          : { label: 'Sinal lento ou congestionado', tone: 'text-[#B91C1C]' };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Header Split */}
      <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
        <div className="flex flex-col justify-center space-y-3 lg:col-span-7">
          <p className="text-sm font-medium text-[#1D4ED8]">
            Verificação real de conectividade e solução de falhas
          </p>
          <h1 className="font-display text-balance text-3xl font-bold leading-tight tracking-tight text-[#101828] sm:text-4xl">
            Diagnóstico da sua rede Wi-Fi para TV
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-[#475467]">
            Quando o celular não encontra a TV ou o vídeo trava, a causa quase sempre está na faixa
            do roteador (2.4 GHz vs 5 GHz), VPN ligada ou bloqueio DRM. Teste sua conexão agora e
            veja como corrigir.
          </p>
          <div className="pt-2">
            <button
              type="button"
              disabled={testing}
              onClick={runRealNetworkTest}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {testing ? 'Medindo rede...' : 'Refazer teste de rede'}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white lg:col-span-5">
          <ResilientImage
            src="/src/assets/images/wifi_router_diagnostics_1795194197683.jpg"
            alt="Roteador Wi-Fi moderno dual-band posicionado sobre aparador de madeira clara"
            fallbackTitle="Diagnóstico de roteador e rede Wi-Fi doméstica"
            className="h-48 w-full object-cover sm:h-56 lg:h-full"
          />
        </div>
      </div>

      {/* Real Measured Network Metrics Row */}
      <section className="mt-10 rounded-2xl border border-[#E4E7EC] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E7EC] pb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#101828]">
            <Activity className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
            Medição real deste dispositivo
          </div>
          {report && (
            <span className="text-xs text-[#667085] tabular-nums">
              Último teste às{' '}
              {new Date(report.testedAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          )}
        </div>

        {report?.error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
          >
            {report.error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-[#667085]">Latência média (RTT)</p>
            <p className="font-mono text-2xl font-semibold text-[#101828] tabular-nums">
              {testing && !report
                ? '...'
                : report?.avgLatencyMs != null
                  ? `${report.avgLatencyMs} ms`
                  : '—'}
            </p>
            <p className={`text-xs font-medium ${latencyVerdict.tone}`}>
              {latencyVerdict.label}
              {report?.jitterMs != null ? ` · variação ${report.jitterMs} ms` : ''}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-[#667085]">Ponte WebSocket & WebRTC</p>
            <p className="font-display text-2xl font-semibold text-[#101828]">
              {report?.wsAvailable && report?.webrtcAvailable ? 'Compatível' : 'Parcial'}
            </p>
            <p className="text-xs text-[#475467]">
              {report?.secureContext
                ? 'Contexto seguro ativo (câmera liberada)'
                : 'Acesso HTTP (alguns navegadores limitam câmera)'}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-[#667085]">Velocidade estimada (API)</p>
            <p className="font-mono text-2xl font-semibold text-[#101828] tabular-nums">
              {report?.downlinkMbps != null ? `${report.downlinkMbps} Mbps` : 'Privado'}
            </p>
            <p className="text-xs text-[#475467]">
              {report?.effectiveType
                ? `Perfil informado: ${report.effectiveType.toUpperCase()}`
                : 'Navegador oculta detalhes do Wi-Fi por privacidade'}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-[#667085]">Checklist de mesma rede</p>
            <p className="font-mono text-2xl font-semibold text-[#101828] tabular-nums">
              {checkedCount} / {PREFLIGHT_CHECKS.length}
            </p>
            <p className="text-xs text-[#475467]">
              {checkedCount === PREFLIGHT_CHECKS.length
                ? 'Todos os pontos de Wi-Fi verificados'
                : 'Marque os itens abaixo para conferir'}
            </p>
          </div>
        </div>
      </section>

      {/* Two-Column Main Diagnostics Workspace */}
      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: Interactive Same-Wi-Fi Checklist */}
        <section className="rounded-2xl border border-[#E4E7EC] bg-white p-6 lg:col-span-5">
          <div className="flex items-center gap-2 text-base font-semibold text-[#101828]">
            <Wifi className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
            Conferência rápida antes de parear
          </div>
          <p className="mt-1 text-sm text-[#475467]">
            Marque os quatro itens que garantem que celular e TV consigam conversar na mesma rede.
          </p>

          <ul className="mt-5 divide-y divide-[#E4E7EC]">
            {PREFLIGHT_CHECKS.map((item) => {
              const checked = Boolean(checkedItems[item.id]);
              return (
                <li key={item.id} className="py-3.5 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    onClick={() => toggleCheck(item.id)}
                    className="flex w-full items-start gap-3 text-left cursor-pointer"
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        checked
                          ? 'border-[#15803D] bg-[#15803D] text-white'
                          : 'border-[#D0D5DD] bg-white'
                      }`}
                    >
                      {checked && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    </span>
                    <div className="space-y-1">
                      <span
                        className={`block text-sm font-medium ${
                          checked ? 'text-[#667085] line-through' : 'text-[#101828]'
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="block text-xs leading-relaxed text-[#667085]">
                        {item.hint}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Right: Symptom-Based Troubleshooter */}
        <section className="rounded-2xl border border-[#E4E7EC] bg-white p-6 lg:col-span-7">
          <div className="flex items-center gap-2 text-base font-semibold text-[#101828]">
            <ShieldAlert className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
            Qual problema está acontecendo agora?
          </div>
          <p className="mt-1 text-sm text-[#475467]">
            Toque no sintoma mais parecido com o seu para abrir as correções diretas.
          </p>

          <div className="mt-5 divide-y divide-[#E4E7EC]">
            {TROUBLESHOOT_ITEMS.map((item) => {
              const isOpen = openSymptomId === item.id;
              return (
                <div key={item.id} className="py-4 first:pt-1 last:pb-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSymptomId(isOpen ? '' : item.id)}
                    className="flex w-full items-center justify-between gap-4 text-left cursor-pointer"
                  >
                    <div className="space-y-0.5">
                      <span className="block text-xs font-medium text-[#667085]">
                        {item.category}
                      </span>
                      <span className="block text-sm font-semibold text-[#101828] sm:text-base">
                        {item.symptom}
                      </span>
                    </div>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-[#667085] transition-transform duration-150 ${
                        isOpen ? 'rotate-180 text-[#1D4ED8]' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {isOpen && (
                    <div className="mt-4 space-y-4 border-t border-[#F2F4F7] pt-4">
                      <p className="text-xs leading-relaxed text-[#475467]">
                        <span className="font-semibold text-[#344054]">Causa mais comum: </span>
                        {item.likelyCause}
                      </p>

                      <ol className="space-y-3">
                        {item.fixes.map((fix, idx) => (
                          <li key={fix.title} className="flex items-start gap-3 text-sm">
                            <span className="mt-0.5 font-mono text-xs font-semibold text-[#1D4ED8] tabular-nums">
                              0{idx + 1}.
                            </span>
                            <div>
                              <p className="font-semibold text-[#101828]">{fix.title}</p>
                              <p className="mt-0.5 text-sm leading-relaxed text-[#475467]">
                                {fix.detail}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>

                      {item.canUseBridge && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => onNavigate('pair')}
                            className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF] cursor-pointer"
                          >
                            Buscar e espelhar direto na TV pela rede Wi-Fi
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
