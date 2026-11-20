import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Cast,
  Check,
  ExternalLink,
  Globe,
  Play,
  Radar,
  RefreshCw,
  Search,
  Tv,
  Upload,
  Wifi,
} from 'lucide-react';
import type {
  AppSection,
  DiscoveredTvDevice,
  DiscoveryScanSummary,
} from '../types/tv';
import { optimizePhotoForTv } from '../utils/media';
import {
  detectClientPlatform,
  getAndroidNativeCastIntentUrl,
  supportsBrowserPresentationApi,
  supportsNativeAirPlayPicker,
  triggerNativeWirelessPicker,
} from '../utils/webrtcMirror';

interface TvDiscoveryPanelProps {
  devices: DiscoveredTvDevice[];
  deviceName: string;
  onDeviceNameChange: (name: string) => void;
  pendingTvName: string | null;
  onCancelPending: () => void;
  onConnectTv: (tvId: string) => void;
  onNavigate: (section: AppSection) => void;
}

type ProtocolFilter = 'all' | 'webrtc' | 'dlna' | 'brands';

export function TvDiscoveryPanel({
  devices,
  deviceName,
  onDeviceNameChange,
  pendingTvName,
  onCancelPending,
  onConnectTv,
  onNavigate,
}: TvDiscoveryPanelProps) {
  const [filter, setFilter] = useState<ProtocolFilter>('all');
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState<DiscoveryScanSummary | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Manual LAN IP probe
  const [showIpProbe, setShowIpProbe] = useState(false);
  const [ipInput, setIpInput] = useState('');
  const [probingIp, setProbingIp] = useState(false);
  const [probeMessage, setProbeMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  // Selected DLNA/IP Smart TV inline panel
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null);
  const [dlnaMediaUrl, setDlnaMediaUrl] = useState('');
  const [dlnaCasting, setDlnaCasting] = useState(false);
  const [dlnaFeedback, setDlnaFeedback] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  const [nativeFeedback, setNativeFeedback] = useState<string | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);

  const platform = useMemo(() => detectClientPlatform(), []);
  const hasNativePicker = useMemo(
    () => supportsNativeAirPlayPicker() || supportsBrowserPresentationApi(),
    []
  );

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch('/api/discovery/scan', {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Não foi possível executar a varredura de rede agora.');
      }
      const data = (await res.json()) as DiscoveryScanSummary;
      setScanSummary(data);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : 'Erro ao procurar TVs na rede Wi-Fi.'
      );
    } finally {
      setScanning(false);
    }
  }, []);

  // Automatically scan Wi-Fi network on mount
  useEffect(() => {
    runScan();
  }, [runScan]);

  const mergedDevices = useMemo(() => {
    const map = new Map<string, DiscoveredTvDevice>();
    for (const dev of devices) {
      map.set(dev.id, dev);
    }
    if (scanSummary) {
      for (const dev of scanSummary.devices) {
        if (!map.has(dev.id)) {
          map.set(dev.id, dev);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }, [devices, scanSummary]);

  const filteredDevices = useMemo(() => {
    return mergedDevices.filter((dev) => {
      if (filter === 'all') return true;
      if (filter === 'webrtc') return dev.source === 'telalivre_tv';
      if (filter === 'dlna') {
        return (
          dev.source !== 'telalivre_tv' ||
          dev.protocols.some((p) => /dlna|upnp|miracast|cast|airplay/i.test(p))
        );
      }
      if (filter === 'brands') {
        return ['Samsung', 'LG', 'Sony', 'TCL', 'Philips', 'Roku'].includes(
          String(dev.manufacturer)
        );
      }
      return true;
    });
  }, [mergedDevices, filter]);

  const handleProbeIp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipInput.trim()) return;
    setProbingIp(true);
    setProbeMessage(null);
    try {
      const res = await fetch('/api/discovery/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: ipInput.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        device?: DiscoveredTvDevice;
      };
      if (!res.ok || !data.ok) {
        setProbeMessage({
          tone: 'error',
          text: data.message ?? 'TV não encontrada nesse endereço IP.',
        });
      } else {
        setProbeMessage({
          tone: 'ok',
          text: `Smart TV localizada: ${data.device?.name ?? ipInput.trim()}.`,
        });
        setIpInput('');
      }
    } catch {
      setProbeMessage({
        tone: 'error',
        text: 'Erro de comunicação ao consultar o IP informado.',
      });
    } finally {
      setProbingIp(false);
    }
  };

  const handleDlnaCastUrl = async (device: DiscoveredTvDevice) => {
    if (!dlnaMediaUrl.trim()) return;
    setDlnaCasting(true);
    setDlnaFeedback(null);
    try {
      const res = await fetch('/api/dlna/cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: device.id,
          mediaUrl: dlnaMediaUrl.trim(),
          title: 'Transmissão TelaLivre',
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setDlnaFeedback({
        tone: res.ok && data.ok ? 'ok' : 'error',
        text: data.message ?? 'Resposta recebida da TV.',
      });
    } catch {
      setDlnaFeedback({
        tone: 'error',
        text: 'Falha ao enviar comando DLNA para a televisão.',
      });
    } finally {
      setDlnaCasting(false);
    }
  };

  const handleDlnaCastPhoto = async (
    device: DiscoveredTvDevice,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDlnaCasting(true);
    setDlnaFeedback(null);
    try {
      const dataUrl = await optimizePhotoForTv(file);
      const res = await fetch('/api/dlna/cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: device.id,
          dataUrl,
          title: file.name,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setDlnaFeedback({
        tone: res.ok && data.ok ? 'ok' : 'error',
        text: data.message ?? 'Foto enviada para a TV via DLNA.',
      });
    } catch (err) {
      setDlnaFeedback({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Falha ao enviar foto via DLNA.',
      });
    } finally {
      setDlnaCasting(false);
      e.target.value = '';
    }
  };

  const handleTriggerNativePicker = async () => {
    setNativeFeedback(null);
    const result = await triggerNativeWirelessPicker(
      hiddenVideoRef.current,
      `${window.location.origin}/?modo=tv`
    );
    setNativeFeedback(result.message);
  };

  return (
    <section
      id="lista-tvs"
      aria-labelledby="discovery-heading"
      className="mt-10 rounded-2xl border border-[#E4E7EC] bg-white p-6 sm:p-8"
    >
      {/* Hidden video element to support Safari AirPlay webkitShowPlaybackTargetPicker */}
      <video ref={hiddenVideoRef} playsInline muted className="hidden" aria-hidden="true" />

      {/* Top Row: Heading & Primary Scan Action */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E4E7EC] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-[#1D4ED8]">
            <Radar className="h-4 w-4" aria-hidden="true" />
            <span>Busca automática Wi-Fi · DLNA · mDNS · Miracast · AirPlay</span>
          </div>
          <h2
            id="discovery-heading"
            className="font-display text-2xl font-bold tracking-tight text-[#101828]"
          >
            Smart TVs disponíveis na rede Wi-Fi
          </h2>
          <p className="max-w-2xl text-sm text-[#475467]">
            Toque diretamente na TV desejada para conectar e iniciar o espelhamento sem digitar
            códigos nem escanear QR Code.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={scanning}
            onClick={runScan}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw
              className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {scanning ? 'Buscando TVs...' : 'Atualizar lista'}
          </button>

          {platform.startsWith('android') && (
            <a
              href={getAndroidNativeCastIntentUrl()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2.5 text-sm font-semibold text-[#101828] transition-colors hover:bg-[#F9FAFB] whitespace-nowrap"
            >
              <Cast className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
              Transmitir nativo (Android)
            </a>
          )}

          {hasNativePicker && (
            <button
              type="button"
              onClick={handleTriggerNativePicker}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2.5 text-sm font-medium text-[#344054] transition-colors hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
            >
              <Cast className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
              {platform === 'ios' ? 'Abrir AirPlay nativo' : 'Seletor sem fio do sistema'}
            </button>
          )}
        </div>
      </div>

      {/* Waiting for TV Approval Notice (when TV has confirmation mode enabled) */}
      {pendingTvName && (
        <div
          role="status"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3.5 text-sm text-[#1E3A8A]"
        >
          <span>
            Solicitação enviada para <span className="font-semibold">{pendingTvName}</span>.
            Toque em <span className="font-semibold">Permitir espelhamento</span> na tela da TV.
          </span>
          <button
            type="button"
            onClick={onCancelPending}
            className="text-xs font-semibold text-[#1D4ED8] underline underline-offset-4 cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Filter Bar + Device Name + Manual IP Toggle */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Filtrar dispositivos encontrados"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#E4E7EC] bg-[#F2F4F7] p-1"
        >
          {(
            [
              { id: 'all', label: `Todas (${mergedDevices.length})` },
              { id: 'webrtc', label: 'Wi-Fi Direto' },
              { id: 'dlna', label: 'DLNA · Cast · AirPlay' },
              { id: 'brands', label: 'Samsung · LG · Sony' },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(tab.id)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                  active
                    ? 'bg-white text-[#101828] shadow-xs'
                    : 'text-[#475467] hover:text-[#101828]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="phone-name-discovery" className="text-xs text-[#667085]">
              Este aparelho:
            </label>
            <input
              id="phone-name-discovery"
              type="text"
              value={deviceName}
              onChange={(e) => onDeviceNameChange(e.target.value)}
              maxLength={32}
              className="w-36 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-2.5 py-1.5 text-xs font-medium text-[#344054] focus:border-[#1D4ED8] focus:bg-white"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowIpProbe((prev) => !prev)}
            className="inline-flex min-h-[38px] items-center gap-1.5 text-xs font-semibold text-[#1D4ED8] hover:text-[#1E40AF] whitespace-nowrap cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            {showIpProbe ? 'Ocultar busca por IP' : 'Conectar TV por IP local'}
          </button>
        </div>
      </div>

      {/* Optional Manual LAN IP Prober */}
      {showIpProbe && (
        <form
          onSubmit={handleProbeIp}
          className="mt-4 rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="tv-ip-input"
                className="block text-xs font-semibold text-[#344054]"
              >
                Endereço IP da Smart TV no Wi-Fi (Samsung, LG, Sony, Roku ou DLNA)
              </label>
              <input
                id="tv-ip-input"
                type="text"
                value={ipInput}
                onChange={(e) => setIpInput(e.target.value)}
                placeholder="Ex.: 192.168.1.25"
                className="mt-1.5 min-h-[44px] w-full rounded-lg border border-[#D0D5DD] bg-white px-3.5 font-mono text-sm text-[#101828] placeholder:text-[#98A2B3] focus:border-[#1D4ED8]"
              />
            </div>
            <button
              type="submit"
              disabled={probingIp || !ipInput.trim()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#101828] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D2939] disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {probingIp ? 'Consultando IP...' : 'Detectar TV'}
            </button>
          </div>
          <p className="mt-2 text-xs text-[#667085]">
            Consulte o IP em Configurações &gt; Rede &gt; Status da rede na sua TV. Funciona
            quando este servidor roda na mesma rede local da Smart TV.
          </p>
          {probeMessage && (
            <p
              role="status"
              className={`mt-2.5 text-xs font-medium ${
                probeMessage.tone === 'ok' ? 'text-[#15803D]' : 'text-[#B91C1C]'
              }`}
            >
              {probeMessage.text}
            </p>
          )}
        </form>
      )}

      {nativeFeedback && (
        <p className="mt-4 rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-3 text-sm text-[#344054]">
          {nativeFeedback}
        </p>
      )}

      {scanError && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
        >
          {scanError}
        </p>
      )}

      {scanSummary && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#667085] tabular-nums">
          <span>Varredura SSDP/DLNA e mDNS concluída em {scanSummary.durationMs} ms</span>
          <span aria-hidden="true">·</span>
          <span>
            {scanSummary.ssdpResponses + scanSummary.mdnsResponses} resposta(s) na sub-rede
          </span>
          <span aria-hidden="true">·</span>
          <span>{mergedDevices.length} TV(s) localizada(s)</span>
        </div>
      )}

      {/* Device List or Honest Empty State */}
      {filteredDevices.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[#D0D5DD] bg-[#F9FAFB] px-6 py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#E4E7EC] bg-white text-[#1D4ED8]">
            <Tv className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="mt-4 font-display text-lg font-semibold text-[#101828]">
            Nenhuma TV localizada automaticamente ainda
          </h3>
          <p className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-[#475467]">
            {scanSummary?.note ??
              'Abra o Receptor TV na sua Smart TV (ou em outra aba para testar agora) para que ela apareça nesta lista em tempo real, ou use o espelhamento nativo do seu aparelho (Smart View, AirPlay 2 ou Miracast).'}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/?modo=tv"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap"
            >
              Abrir Receptor TV em nova aba
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={() => onNavigate('guide')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2.5 text-sm font-medium text-[#344054] transition-colors hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
            >
              Ativar Miracast / Smart View / AirPlay
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[#E4E7EC] border-t border-[#E4E7EC]">
          {filteredDevices.map((device) => {
            const isDirectTv = device.source === 'telalivre_tv' && Boolean(device.tvId);
            const isExternalOpen = selectedExternalId === device.id;

            return (
              <li key={device.id} className="py-4">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] text-[#1D4ED8]">
                      <Tv className="h-5 w-5" aria-hidden="true" />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-display text-base font-semibold text-[#101828]">
                          {device.name}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#15803D]">
                          <span
                            className="h-2 w-2 rounded-full bg-[#16A34A]"
                            aria-hidden="true"
                          />
                          Pronta no Wi-Fi
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#475467]">
                        <span className="font-medium text-[#344054]">{device.manufacturer}</span>
                        <span aria-hidden="true">·</span>
                        <span>{device.model}</span>
                        <span aria-hidden="true">·</span>
                        <span>{device.protocols.join(' / ')}</span>
                        {device.ip && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{device.ip}</span>
                          </>
                        )}
                        {typeof device.latencyMs === 'number' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{device.latencyMs} ms</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {isDirectTv && device.tvId ? (
                      <button
                        type="button"
                        onClick={() => onConnectTv(device.tvId!)}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer"
                      >
                        Espelhar nesta TV
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedExternalId(isExternalOpen ? null : device.id);
                          setDlnaFeedback(null);
                        }}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#1D4ED8] bg-white px-4 py-2 text-sm font-semibold text-[#1D4ED8] transition-colors hover:bg-[#EFF6FF] whitespace-nowrap cursor-pointer"
                      >
                        <Wifi className="h-4 w-4" aria-hidden="true" />
                        {isExternalOpen ? 'Fechar opções' : 'Conectar TV'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline DLNA / Smart TV Action Panel for physical LAN devices */}
                {!isDirectTv && isExternalOpen && (
                  <div className="mt-4 rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-4 sm:ml-14">
                    <div className="space-y-4">
                      <p className="text-sm text-[#344054]">
                        Smart TV <span className="font-semibold">{device.manufacturer}</span>{' '}
                        pronta no IP{' '}
                        <span className="font-mono font-medium">{device.ip}</span>.
                      </p>

                      {device.avTransportUrl ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer">
                              <Upload className="h-4 w-4" aria-hidden="true" />
                              {dlnaCasting ? 'Enviando...' : 'Enviar foto direto via DLNA'}
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleDlnaCastPhoto(device, e)}
                                disabled={dlnaCasting}
                                className="sr-only"
                              />
                            </label>
                            <span className="text-xs text-[#667085]">
                              ou envie o link de um vídeo HTTP/MP4 abaixo:
                            </span>
                          </div>

                          <div className="flex flex-col gap-2.5 sm:flex-row">
                            <input
                              id={`dlna-url-${device.id}`}
                              type="url"
                              value={dlnaMediaUrl}
                              onChange={(e) => setDlnaMediaUrl(e.target.value)}
                              placeholder="https://exemplo.com/video.mp4"
                              className="min-h-[42px] flex-1 rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm text-[#101828]"
                            />
                            <button
                              type="button"
                              disabled={dlnaCasting || !dlnaMediaUrl.trim()}
                              onClick={() => handleDlnaCastUrl(device)}
                              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-4 py-2 text-xs font-semibold text-[#101828] hover:bg-[#F2F4F7] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                            >
                              <Play className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                              Reproduzir URL
                            </button>
                          </div>

                          {dlnaFeedback && (
                            <p
                              className={`flex items-center gap-1.5 text-xs font-medium ${
                                dlnaFeedback.tone === 'ok' ? 'text-[#15803D]' : 'text-[#B91C1C]'
                              }`}
                            >
                              {dlnaFeedback.tone === 'ok' && (
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {dlnaFeedback.text}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs leading-relaxed text-[#475467]">
                          Para espelhamento de tela ao vivo nesta {device.manufacturer} sem código,
                          use o seletor sem fio nativo (Miracast / AirPlay / Cast) ou abra o
                          Receptor TV no navegador da televisão.
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-4 border-t border-[#E4E7EC] pt-3 text-xs font-semibold">
                        <a
                          href="/?modo=tv"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[#1D4ED8] hover:text-[#1E40AF]"
                        >
                          Abrir Receptor TV sem código
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                        <button
                          type="button"
                          onClick={() => onNavigate('guide')}
                          className="inline-flex items-center gap-1 text-[#344054] hover:text-[#101828] cursor-pointer"
                        >
                          Ativar espelhamento nativo ({device.manufacturer})
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
