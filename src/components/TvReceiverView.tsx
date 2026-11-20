import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Maximize2,
  Minimize2,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useTvSocket } from '../hooks/useTvSocket';
import type { MirrorQualityPreset, MirrorStats, TvManufacturer } from '../types/tv';
import { ICE_SERVERS } from '../utils/media';
import {
  applyLowLatencyReceiverPlayout,
  collectRealWebrtcStats,
  createLowLatencyPeerConnection,
  type StatsCursor,
} from '../utils/webrtcMirror';

interface TvReceiverViewProps {
  onExitTvMode: () => void;
}

const TV_BRANDS: TvManufacturer[] = [
  'Samsung',
  'LG',
  'Sony',
  'TCL',
  'Philips',
  'Roku',
  'Outra TV',
];

export function TvReceiverView({ onExitTvMode }: TvReceiverViewProps) {
  const [brand, setBrand] = useState<TvManufacturer>('Samsung');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamMuted, setStreamMuted] = useState(true);
  const [webrtcStatus, setWebrtcStatus] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [liveStats, setLiveStats] = useState<MirrorStats | null>(null);
  const [typedText, setTypedText] = useState('');
  const [lastRemoteAction, setLastRemoteAction] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({
    x: 50,
    y: 50,
    visible: false,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const activeControllerIdRef = useRef<string | null>(null);
  const statsCursorRef = useRef<StatsCursor | null>(null);
  const sendEventRef = useRef<ReturnType<typeof useTvSocket>['sendEvent'] | null>(null);

  const cleanupWebrtc = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    pendingIceRef.current = [];
    activeControllerIdRef.current = null;
    statsCursorRef.current = null;
    setWebrtcStatus('idle');
    setLiveStats(null);
  }, []);

  const handleWebrtcOffer = useCallback(
    async ({
      sdp,
      controllerId,
    }: {
      sdp: RTCSessionDescriptionInit;
      source: 'screen' | 'camera';
      preset: MirrorQualityPreset;
      controllerId: string;
    }) => {
      cleanupWebrtc();
      setWebrtcStatus('connecting');
      activeControllerIdRef.current = controllerId;

      const pc = createLowLatencyPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      pc.onicecandidate = (evt) => {
        if (evt.candidate && activeControllerIdRef.current) {
          sendEventRef.current?.({
            type: 'webrtc:ice',
            candidate: evt.candidate.toJSON(),
            target: 'controller',
            controllerId: activeControllerIdRef.current,
          });
        }
      };

      pc.ontrack = (evt) => {
        applyLowLatencyReceiverPlayout(pc);
        const stream = evt.streams[0] ?? new MediaStream([evt.track]);
        remoteStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setWebrtcStatus('live');
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          applyLowLatencyReceiverPlayout(pc);
          setWebrtcStatus('live');
        } else if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'closed'
        ) {
          cleanupWebrtc();
        }
      };

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        for (const candidate of pendingIceRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        pendingIceRef.current = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendEventRef.current?.({
          type: 'webrtc:answer',
          sdp: answer,
          controllerId,
        });
      } catch {
        cleanupWebrtc();
      }
    },
    [cleanupWebrtc]
  );

  const handleWebrtcIce = useCallback(
    async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        pendingIceRef.current.push(candidate);
      }
    },
    []
  );

  const handleTvKeyInput = useCallback(
    ({ key, action }: { key: string; action: 'press' | 'consumer' }) => {
      if (action === 'consumer') {
        setLastRemoteAction(`Comando remoto: ${key}`);
        return;
      }
      setLastRemoteAction(`Tecla: ${key === ' ' ? 'Espaço' : key}`);
      if (key === 'Backspace') {
        setTypedText((prev) => prev.slice(0, -1));
      } else if (key === 'Enter') {
        setTypedText((prev) => `${prev}\n`);
      } else if (key === 'Tab') {
        setTypedText((prev) => `${prev}  `);
      } else if (key.length === 1) {
        setTypedText((prev) => `${prev}${key}`.slice(-500));
      }
    },
    []
  );

  const handleTvTextInput = useCallback(
    ({ text, pressEnter }: { text: string; pressEnter?: boolean }) => {
      setTypedText((prev) => `${prev}${text}${pressEnter ? '\n' : ''}`.slice(-500));
      setLastRemoteAction(`Texto recebido (${text.length} caracteres)`);
    },
    []
  );

  const handleTvMouseInput = useCallback(
    ({ dx, dy, click }: { dx: number; dy: number; click?: 'left' | 'right' }) => {
      setCursorPos((prev) => ({
        x: Math.max(4, Math.min(96, prev.x + dx * 0.14)),
        y: Math.max(6, Math.min(94, prev.y + dy * 0.18)),
        visible: true,
      }));
      if (click) {
        setLastRemoteAction(click === 'left' ? 'Clique esquerdo' : 'Clique direito');
      }
    },
    []
  );

  const { roomState, updateTvIdentity, respondToRequest, sendEvent } = useTvSocket({
    role: 'tv',
    autoRegisterTv: true,
    initialTvIdentity: {
      tvName: `${brand} Smart TV`,
      tvBrand: brand,
      tvModel: `${brand} Wi-Fi`,
      autoAccept: true,
    },
    listeners: {
      onWebrtcOffer: handleWebrtcOffer,
      onWebrtcIce: handleWebrtcIce,
      onWebrtcStop: cleanupWebrtc,
      onTvKeyInput: handleTvKeyInput,
      onTvTextInput: handleTvTextInput,
      onTvMouseInput: handleTvMouseInput,
    },
  });

  useEffect(() => {
    sendEventRef.current = sendEvent;
  }, [sendEvent]);

  useEffect(() => {
    return () => cleanupWebrtc();
  }, [cleanupWebrtc]);

  useEffect(() => {
    if (webrtcStatus !== 'live') return;
    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const { stats, nextCursor } = await collectRealWebrtcStats(
          pc,
          'inbound',
          statsCursorRef.current
        );
        statsCursorRef.current = nextCursor;
        setLiveStats(stats);
      } catch {
        // Ignore transient stats error
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [webrtcStatus]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (videoRef.current && remoteStreamRef.current && roomState?.mode === 'webrtc') {
      if (videoRef.current.srcObject !== remoteStreamRef.current) {
        videoRef.current.srcObject = remoteStreamRef.current;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [roomState?.mode, webrtcStatus]);

  const handleSelectBrand = (nextBrand: TvManufacturer) => {
    setBrand(nextBrand);
    updateTvIdentity({
      tvName: `${nextBrand} Smart TV`,
      tvBrand: nextBrand,
      tvModel: `${nextBrand} Wi-Fi`,
    });
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement && containerRef.current) {
      await containerRef.current.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      await document.exitFullscreen?.().catch(() => {});
    }
  };

  const pendingRequests = roomState?.pendingRequests ?? [];

  return (
    <div
      ref={containerRef}
      className="flex min-h-screen flex-col bg-[#0B0E14] text-[#F8FAFC] tracking-[0.01em]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5 sm:px-8">
        <button
          type="button"
          onClick={onExitTvMode}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/90 hover:bg-white/10 whitespace-nowrap cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </button>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#2563EB] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8] whitespace-nowrap cursor-pointer"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
              Reduzir
            </>
          ) : (
            <>
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
              Tela cheia
            </>
          )}
        </button>
      </div>

      {pendingRequests.length > 0 && (
        <div className="border-b border-white/15 bg-[#141923] px-6 py-4">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4">
            {pendingRequests.map((req) => (
              <div
                key={req.controllerId}
                className="flex w-full flex-wrap items-center justify-between gap-3"
              >
                <span className="text-sm font-medium text-white">
                  {req.deviceName} quer conectar nesta TV
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => respondToRequest(req.controllerId, false)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3.5 text-sm text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    Recusar
                  </button>
                  <button
                    type="button"
                    onClick={() => respondToRequest(req.controllerId, true)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#22C55E] px-4 text-sm font-semibold text-[#052E16] hover:bg-[#4ADE80] cursor-pointer"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Permitir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <main className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
        {roomState?.mode === 'webrtc' ? (
          <div className="flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-3">
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={streamMuted}
                className={`h-full w-full ${
                  roomState.display.fitMode === 'cover' ? 'object-cover' : 'object-contain'
                }`}
              />

              {webrtcStatus !== 'live' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 text-sm text-white/80">
                  Conectando espelhamento...
                </div>
              )}

              <button
                type="button"
                onClick={() => setStreamMuted((prev) => !prev)}
                className="absolute bottom-4 right-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/20 bg-black/75 px-4 py-2 text-sm font-medium text-white backdrop-blur-md hover:bg-black cursor-pointer"
              >
                {streamMuted ? (
                  <>
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                    Ativar som
                  </>
                ) : (
                  <>
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                    Silenciar
                  </>
                )}
              </button>
            </div>

            {liveStats && (
              <p className="font-mono text-xs text-white/60 tabular-nums">
                {liveStats.resolution ?? ''}
                {liveStats.fps != null ? ` · ${liveStats.fps} fps` : ''}
                {liveStats.rttMs != null ? ` · ${liveStats.rttMs} ms` : ''}
              </p>
            )}
          </div>
        ) : (
          <div className="relative mx-auto w-full max-w-2xl space-y-6 text-center">
            {cursorPos.visible && (
              <div
                aria-hidden="true"
                style={{
                  left: `${cursorPos.x}%`,
                  top: `${cursorPos.y}%`,
                }}
                className="pointer-events-none fixed z-50 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#2563EB] shadow-lg"
              />
            )}

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/12 bg-[#141923] text-[#93C5FD]">
              <Tv className="h-7 w-7" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">
                {roomState?.tvName ?? `${brand} Smart TV`}
              </h1>
              <p className="text-sm text-white/70">
                {roomState && roomState.controllers.length > 0
                  ? `Teclado conectado: ${roomState.controllers[0].deviceName}`
                  : 'Pronta para receber teclado e controle. Na outra aba ou no celular, conecte nesta TV.'}
              </p>
            </div>

            {/* Live TV Text Box */}
            <div className="rounded-2xl border border-white/15 bg-[#141923] p-5 text-left">
              <div className="flex items-center justify-between gap-2 pb-2 text-xs text-white/60">
                <span>Campo de texto na TV</span>
                {lastRemoteAction && (
                  <span className="font-mono text-[#93C5FD]">{lastRemoteAction}</span>
                )}
              </div>
              <div className="min-h-[112px] whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-[#0B0E14] p-4 font-mono text-base text-white">
                {typedText || (
                  <span className="text-white/35">
                    O que você digitar no teclado aparecerá aqui em tempo real...
                  </span>
                )}
              </div>
              {typedText && (
                <div className="mt-2.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setTypedText('')}
                    className="min-h-[34px] rounded-lg border border-white/15 px-3 text-xs font-medium text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    Limpar tela
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              {TV_BRANDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleSelectBrand(item)}
                  className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    brand === item
                      ? 'border-[#60A5FA] bg-[#2563EB] text-white'
                      : 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
