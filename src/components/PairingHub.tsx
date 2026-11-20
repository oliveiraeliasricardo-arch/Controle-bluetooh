import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Cast,
  Check,
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  Image as ImageIcon,
  LogOut,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Smartphone,
  Square,
  Sun,
  Trash2,
  Tv,
  Type,
  Upload,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Youtube,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTvSocket } from '../hooks/useTvSocket';
import type { AppSection, MirrorQualityPreset, MirrorStats } from '../types/tv';
import {
  detectDefaultDeviceName,
  extractYoutubeId,
  ICE_SERVERS,
  optimizePhotoForTv,
} from '../utils/media';
import {
  applyMirrorQualityToSender,
  collectRealWebrtcStats,
  createLowLatencyPeerConnection,
  detectClientPlatform,
  getAndroidNativeCastIntentUrl,
  MIRROR_PRESETS,
  supportsBrowserPresentationApi,
  supportsNativeAirPlayPicker,
  triggerNativeWirelessPicker,
  type StatsCursor,
} from '../utils/webrtcMirror';
import { ResilientImage } from './ResilientImage';
import { TvDiscoveryPanel } from './TvDiscoveryPanel';

interface PairingHubProps {
  onNavigate: (section: AppSection) => void;
}

type ControllerTab = 'mirror' | 'photos' | 'youtube' | 'message';

const QUICK_YOUTUBE_VIDEOS = [
  {
    id: 'aqz-KE-bpKQ',
    title: 'Teste 4K 60fps — Big Buck Bunny',
    meta: 'Calibração de cor e fluidez',
  },
  {
    id: 'LXb3EKWsInQ',
    title: 'Costa Rica em 4K HDR',
    meta: 'Teste de imagem e contraste',
  },
  {
    id: 'jfKfPfyJRdk',
    title: 'Lofi Radio ao vivo para sala',
    meta: 'Som ambiente contínuo',
  },
];

export function PairingHub({ onNavigate }: PairingHubProps) {
  const [deviceName, setDeviceName] = useState(() => detectDefaultDeviceName());
  const [activeTab, setActiveTab] = useState<ControllerTab>('mirror');
  const [nativeLaunchMsg, setNativeLaunchMsg] = useState<string | null>(null);

  // Photos state
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<string | null>(null);

  // YouTube state
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  // Big-screen Message state
  const [msgTitle, setMsgTitle] = useState('Bem-vindos à nossa casa');
  const [msgBody, setMsgBody] = useState(
    'Rede Wi-Fi: Casa_5G\nSenha: informe aqui para seus convidados'
  );
  const [msgTheme, setMsgTheme] = useState<'dark' | 'light' | 'cobalt'>('dark');
  const [msgFontSize, setMsgFontSize] = useState<'normal' | 'large'>('large');

  // Low-Latency Live WebRTC Mirroring state
  const [qualityPreset, setQualityPreset] = useState<MirrorQualityPreset>('low_latency');
  const [streamStatus, setStreamStatus] = useState<'idle' | 'starting' | 'live'>('idle');
  const [streamSource, setStreamSource] = useState<'screen' | 'camera' | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoPaused, setVideoPaused] = useState(false);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [mirrorStats, setMirrorStats] = useState<MirrorStats | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localPreviewRef = useRef<HTMLVideoElement | null>(null);
  const heroNativeVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const statsCursorRef = useRef<StatsCursor | null>(null);

  const platform = useMemo(() => detectClientPlatform(), []);
  const hasNativePicker = useMemo(
    () => supportsNativeAirPlayPicker() || supportsBrowserPresentationApi(),
    []
  );
  const supportsScreenCapture =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  const stopLocalMirror = useCallback(
    (notifyServer: boolean, emit?: (e: { type: 'webrtc:stop' }) => void) => {
      if (pcRef.current) {
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
        pcRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (localPreviewRef.current) {
        localPreviewRef.current.srcObject = null;
      }
      pendingIceRef.current = [];
      statsCursorRef.current = null;
      setStreamStatus('idle');
      setStreamSource(null);
      setAudioEnabled(true);
      setVideoPaused(false);
      setHasAudioTrack(false);
      setMirrorStats(null);
      if (notifyServer && emit) {
        emit({ type: 'webrtc:stop' });
      }
    },
    []
  );

  const handleWebrtcAnswer = useCallback(
    async (sdp: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        for (const candidate of pendingIceRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        pendingIceRef.current = [];
        setStreamStatus('live');
      } catch {
        setStreamError('Falha ao negociar vídeo com a TV. Tente iniciar novamente.');
        stopLocalMirror(false);
      }
    },
    [stopLocalMirror]
  );

  const handleWebrtcIce = useCallback(async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
    const pc = pcRef.current;
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      pendingIceRef.current.push(candidate);
    }
  }, []);

  const {
    roomState,
    discoveredDevices,
    pendingTvName,
    errorMessage,
    clearError,
    sendEvent,
    connectToTv,
    disconnectFromTv,
  } = useTvSocket({
    role: 'controller',
    listeners: {
      onWebrtcAnswer: handleWebrtcAnswer,
      onWebrtcIce: handleWebrtcIce,
      onWebrtcStop: () => stopLocalMirror(false),
    },
  });

  useEffect(() => {
    return () => stopLocalMirror(false);
  }, [stopLocalMirror]);

  useEffect(() => {
    if (localPreviewRef.current && localStreamRef.current) {
      localPreviewRef.current.srcObject = localStreamRef.current;
    }
  }, [streamStatus, activeTab]);

  useEffect(() => {
    if (streamStatus !== 'live') return;
    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const { stats, nextCursor } = await collectRealWebrtcStats(
          pc,
          'outbound',
          statsCursorRef.current
        );
        statsCursorRef.current = nextCursor;
        setMirrorStats(stats);
      } catch {
        // Ignore transient getStats error
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [streamStatus]);

  const handleConnectDiscoveredTv = (tvId: string) => {
    clearError();
    connectToTv(tvId, deviceName);
  };

  const handleDisconnect = () => {
    stopLocalMirror(true, sendEvent);
    disconnectFromTv();
  };

  const handleHeroNativeLaunch = async () => {
    setNativeLaunchMsg(null);
    const result = await triggerNativeWirelessPicker(
      heroNativeVideoRef.current,
      `${window.location.origin}/?modo=tv`
    );
    setNativeLaunchMsg(result.message);
  };

  const handleChangeQualityPreset = async (nextPreset: MirrorQualityPreset) => {
    setQualityPreset(nextPreset);
    if (pcRef.current && localStreamRef.current && streamStatus === 'live') {
      const videoTrack = localStreamRef.current.getVideoTracks()[0] ?? null;
      await applyMirrorQualityToSender(pcRef.current, videoTrack, nextPreset);
      sendEvent({ type: 'webrtc:preset', preset: nextPreset });
    }
  };

  const handleToggleAudio = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !audioEnabled;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setAudioEnabled(next);
  };

  const handleToggleVideoPause = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextPaused = !videoPaused;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !nextPaused;
    });
    setVideoPaused(nextPaused);
  };

  const startLiveMirror = async (source: 'screen' | 'camera') => {
    setStreamError(null);

    if (!roomState?.tvConnected) {
      setStreamError('A tela da TV precisa estar ativa na rede para receber o espelhamento.');
      return;
    }

    stopLocalMirror(false);
    setStreamStatus('starting');
    setStreamSource(source);

    const presetCfg = MIRROR_PRESETS[qualityPreset];

    try {
      let mediaStream: MediaStream;
      if (source === 'screen') {
        if (!supportsScreenCapture) {
          throw new Error(
            'Este navegador móvel bloqueia a captura direta de tela pela web. Use o atalho nativo do aparelho (Smart View / AirPlay / Miracast) ou "Espelhar câmera ao vivo" abaixo.'
          );
        }
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: presetCfg.width },
            height: { ideal: presetCfg.height },
            frameRate: { ideal: presetCfg.frameRate, max: presetCfg.frameRate },
          },
          audio: true,
        });
      } else {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          throw new Error('Câmera não disponível neste navegador.');
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraFacing,
            width: { ideal: presetCfg.width },
            height: { ideal: presetCfg.height },
            frameRate: { ideal: Math.min(presetCfg.frameRate, 30) },
          },
          audio: true,
        });
      }

      localStreamRef.current = mediaStream;
      setHasAudioTrack(mediaStream.getAudioTracks().length > 0);
      setAudioEnabled(true);
      setVideoPaused(false);

      if (localPreviewRef.current) {
        localPreviewRef.current.srcObject = mediaStream;
      }

      const pc = createLowLatencyPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      mediaStream.getTracks().forEach((track) => {
        pc.addTrack(track, mediaStream);
        track.onended = () => {
          stopLocalMirror(true, sendEvent);
        };
      });

      const videoTrack = mediaStream.getVideoTracks()[0] ?? null;
      await applyMirrorQualityToSender(pc, videoTrack, qualityPreset);

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          sendEvent({
            type: 'webrtc:ice',
            candidate: evt.candidate.toJSON(),
            target: 'tv',
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStreamStatus('live');
        } else if (pc.connectionState === 'failed') {
          setStreamError('Não foi possível manter a conexão de vídeo com a TV.');
          stopLocalMirror(true, sendEvent);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendEvent({
        type: 'webrtc:offer',
        sdp: offer,
        source,
        preset: qualityPreset,
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permissão negada ou cancelada. Autorize o compartilhamento da tela ou câmera para iniciar.'
          : err instanceof Error
            ? err.message
            : 'Não foi possível iniciar o espelhamento.';
      setStreamError(msg);
      stopLocalMirror(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingPhotos(true);
    setPhotoFeedback(null);

    try {
      const list = Array.from(files).slice(0, 6);
      for (const file of list) {
        const dataUrl = await optimizePhotoForTv(file);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sendEvent({
          type: 'cast:add_photo',
          photo: {
            id,
            name: file.name.replace(/\.[^.]+$/, '') || 'Foto do celular',
            dataUrl,
          },
        });
      }
      setPhotoFeedback(
        list.length === 1
          ? 'Foto enviada para a TV.'
          : `${list.length} fotos enviadas para a galeria da TV.`
      );
    } catch (err) {
      setPhotoFeedback(
        err instanceof Error ? err.message : 'Não foi possível processar a imagem.'
      );
    } finally {
      setUploadingPhotos(false);
      e.target.value = '';
    }
  };

  const handleSendYoutube = (e: React.FormEvent) => {
    e.preventDefault();
    setYoutubeError(null);
    const videoId = extractYoutubeId(youtubeInput);
    if (!videoId) {
      setYoutubeError(
        'Cole um link válido do YouTube (ex.: youtu.be/... ou youtube.com/watch?v=...).'
      );
      return;
    }
    sendEvent({
      type: 'cast:youtube',
      videoId,
      title: 'Vídeo enviado pelo celular',
    });
    setYoutubeInput('');
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgTitle.trim() && !msgBody.trim()) return;
    sendEvent({
      type: 'cast:message',
      title: msgTitle,
      body: msgBody,
      theme: msgTheme,
      fontSize: msgFontSize,
    });
  };

  // UNCONNECTED VIEW: Direct Native Mirroring Hero + Auto Wi-Fi Smart TV Discovery (ZERO codes, ZERO QR!)
  if (!roomState) {
    const platformLabel =
      platform === 'ios'
        ? 'iPhone / iPad detectado · AirPlay 2 nativo'
        : platform === 'android_samsung'
          ? 'Samsung Galaxy detectado · Smart View / Miracast'
          : platform === 'android_other'
            ? 'Android detectado · Google Cast / Tela sem fio'
            : 'Espelhamento Wi-Fi direto · DLNA · Miracast · WebRTC';

    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <video ref={heroNativeVideoRef} playsInline muted className="hidden" aria-hidden="true" />

        {/* Balanced 2-Column Split Hero */}
        <section className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col justify-between gap-7 lg:col-span-6">
            <div className="space-y-4">
              <p className="text-sm font-medium text-[#1D4ED8]">{platformLabel}</p>
              <h1 className="font-display text-balance text-3xl font-bold leading-[1.12] tracking-tight text-[#101828] sm:text-5xl">
                Espelhamento nativo na sua TV pelo Wi-Fi, sem código ou QR Code
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-[#475467]">
                Selecione a sua Smart TV (Samsung, LG, Sony, TCL, Philips ou Roku) direto na lista
                da rede Wi-Fi abaixo ou acione o espelhamento nativo do seu dispositivo em um
                toque.
              </p>
            </div>

            {/* Direct Native Mirroring Launcher Card (Zero Code / Zero QR) */}
            <div className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-[#101828]">
                <Smartphone className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                Conexão imediata neste dispositivo
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-[#475467]">
                {platform === 'ios'
                  ? 'Acione o seletor AirPlay 2 do iOS para transmitir direto para TVs Samsung, LG, Roku ou Apple TV na mesma rede Wi-Fi.'
                  : platform.startsWith('android')
                    ? 'Abra o seletor nativo de Tela sem fio / Cast do Android ou selecione uma Smart TV descoberta na lista abaixo.'
                    : 'Escolha uma TV na lista Wi-Fi abaixo para espelhar sua tela em tempo real com baixa latência, ou abra o seletor sem fio do navegador.'}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {platform.startsWith('android') ? (
                  <a
                    href={getAndroidNativeCastIntentUrl()}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap"
                  >
                    <Cast className="h-4 w-4" aria-hidden="true" />
                    Abrir espelhamento nativo (Android)
                  </a>
                ) : hasNativePicker ? (
                  <button
                    type="button"
                    onClick={handleHeroNativeLaunch}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer"
                  >
                    <Cast className="h-4 w-4" aria-hidden="true" />
                    {platform === 'ios'
                      ? 'Selecionar TV via AirPlay'
                      : 'Espelhar via seletor sem fio'}
                  </button>
                ) : (
                  <a
                    href="#lista-tvs"
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap"
                  >
                    Escolher TV na rede Wi-Fi
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                )}

                <a
                  href="/?modo=tv"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-3 text-sm font-semibold text-[#344054] transition-colors hover:bg-[#F9FAFB] whitespace-nowrap"
                >
                  Abrir tela Receptor TV
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>

              {nativeLaunchMsg && (
                <p className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-3.5 py-2.5 text-xs text-[#344054]">
                  {nativeLaunchMsg}
                </p>
              )}

              {errorMessage && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#B91C1C]"
                >
                  {errorMessage}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E7EC] pt-4 text-xs text-[#667085]">
                <span>Smart View · AirPlay 2 · Google Cast · DLNA · Miracast</span>
                <button
                  type="button"
                  onClick={() => onNavigate('guide')}
                  className="font-semibold text-[#1D4ED8] hover:text-[#1E40AF] whitespace-nowrap cursor-pointer"
                >
                  Ver atalhos por marca →
                </button>
              </div>
            </div>
          </div>

          {/* Editorial Focal Media Anchor */}
          <div className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white lg:col-span-6">
            <ResilientImage
              src="/src/assets/images/hero_living_room_cast_1795194197590.jpg"
              alt="Sala moderna com Smart TV recebendo espelhamento nativo do celular via Wi-Fi"
              fallbackTitle="Espelhamento direto entre celular e Smart TV pela rede Wi-Fi"
              className="h-64 w-full object-cover sm:h-80 lg:h-full"
            />
          </div>
        </section>

        {/* Full-Width Live Wi-Fi Smart TV Discovery Panel (Zero Code / Zero QR) */}
        <TvDiscoveryPanel
          devices={discoveredDevices}
          deviceName={deviceName}
          onDeviceNameChange={setDeviceName}
          pendingTvName={pendingTvName}
          onCancelPending={handleDisconnect}
          onConnectTv={handleConnectDiscoveredTv}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  // CONNECTED REMOTE & LOW-LATENCY SCREEN MIRRORING CONSOLE (ZERO CODES)
  const activePhoto = roomState.photos[roomState.activePhotoIndex] ?? null;
  const activeModeLabel: Record<typeof roomState.mode, string> = {
    idle: 'Pronta para espelhar',
    photo: 'Galeria de fotos',
    youtube: 'Vídeo do YouTube',
    message: 'Texto em tela cheia',
    webrtc: roomState.webrtcSource === 'camera' ? 'Câmera ao vivo' : 'Tela ao vivo',
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Live Connected Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4E7EC] pb-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                roomState.tvConnected ? 'bg-[#16A34A]' : 'bg-[#D97706]'
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-[#101828]">{roomState.tvName}</span>
            <span className="text-[#98A2B3]" aria-hidden="true">
              ·
            </span>
            <span className="text-[#475467]">{roomState.tvBrand}</span>
            <span className="text-[#98A2B3]" aria-hidden="true">
              ·
            </span>
            <span className="text-[#475467]">{activeModeLabel[roomState.mode]}</span>
          </div>
          <p className="text-xs text-[#667085]">
            {roomState.tvConnected
              ? `Conectado diretamente via Wi-Fi com ${deviceName} · Sem código`
              : 'Aguardando tela da TV reconectar na rede...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              sendEvent({
                type: 'tv:display_control',
                dimmed: !roomState.display.dimmed,
              })
            }
            className={`inline-flex min-h-[42px] items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
              roomState.display.dimmed
                ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                : 'border-[#D0D5DD] bg-white text-[#344054] hover:bg-[#F9FAFB]'
            }`}
          >
            {roomState.display.dimmed ? (
              <>
                <Sun className="h-4 w-4" aria-hidden="true" />
                Brilho normal
              </>
            ) : (
              <>
                <Moon className="h-4 w-4" aria-hidden="true" />
                Escurecer TV
              </>
            )}
          </button>

          {roomState.mode !== 'idle' && (
            <button
              type="button"
              onClick={() => {
                stopLocalMirror(true, sendEvent);
                sendEvent({ type: 'cast:clear' });
              }}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-medium text-[#344054] transition-colors hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Limpar tela
            </button>
          )}

          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#FECACA] bg-white px-3.5 py-2 text-sm font-medium text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] whitespace-nowrap cursor-pointer"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Trocar TV
          </button>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
        >
          {errorMessage}
        </div>
      )}

      {/* Segmented Cast Mode Tabs */}
      <div
        role="tablist"
        aria-label="Opções de espelhamento para a TV"
        className="mt-6 grid grid-cols-2 gap-1.5 rounded-xl border border-[#E4E7EC] bg-[#F2F4F7] p-1.5 sm:grid-cols-4"
      >
        {(
          [
            { id: 'mirror', label: 'Espelhar tela', icon: MonitorUp },
            { id: 'photos', label: 'Fotos na TV', icon: ImageIcon },
            { id: 'youtube', label: 'YouTube', icon: Youtube },
            { id: 'message', label: 'Texto & Aviso', icon: Type },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-white text-[#101828] shadow-xs'
                  : 'text-[#475467] hover:text-[#101828]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Controller Workspace */}
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {/* TAB 1: REAL-TIME LOW-LATENCY SCREEN MIRRORING */}
          {activeTab === 'mirror' && (
            <section className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold text-[#101828]">
                    Espelhamento de tela em tempo real via Wi-Fi
                  </h2>
                  <p className="mt-1 text-sm text-[#475467]">
                    Captura a tela ou a câmera e transmite ponto a ponto em baixa latência para{' '}
                    {roomState.tvName}.
                  </p>
                </div>

                {streamStatus !== 'idle' && (
                  <button
                    type="button"
                    onClick={() => stopLocalMirror(true, sendEvent)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#991B1B] whitespace-nowrap cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    Parar espelhamento
                  </button>
                )}
              </div>

              {/* Latency & Quality Preset Selector */}
              <div className="mt-6">
                <span className="block text-xs font-semibold text-[#344054]">
                  Perfil de latência e fluidez (pode trocar durante o espelhamento)
                </span>
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {(['low_latency', 'balanced', 'high_detail'] as const).map((presetKey) => {
                    const preset = MIRROR_PRESETS[presetKey];
                    const active = qualityPreset === presetKey;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() => handleChangeQualityPreset(presetKey)}
                        className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-[#1D4ED8] bg-[#EFF6FF]/60'
                            : 'border-[#E4E7EC] bg-[#F9FAFB] hover:border-[#D0D5DD]'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#101828]">
                            {preset.label}
                          </span>
                          {active && (
                            <Check className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                          )}
                        </div>
                        <span className="mt-0.5 font-mono text-xs text-[#1D4ED8] tabular-nums">
                          {preset.shortSpec}
                        </span>
                        <span className="mt-1.5 text-xs leading-relaxed text-[#475467]">
                          {preset.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Start Capture Actions */}
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={streamStatus === 'starting'}
                  onClick={() => startLiveMirror('screen')}
                  className="flex min-h-[96px] flex-col items-start justify-between rounded-xl border border-[#1D4ED8] bg-[#1D4ED8] p-4 text-left text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60 cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 text-sm font-semibold">
                    <MonitorUp className="h-5 w-5" aria-hidden="true" />
                    {streamStatus === 'live' && streamSource === 'screen'
                      ? 'Trocar tela / janela capturada'
                      : 'Iniciar espelhamento de tela'}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-white/85">
                    {supportsScreenCapture
                      ? 'Captura tela inteira, janela ou aba com áudio em tempo real direto na TV.'
                      : 'Navegador móvel restringe captura web — use o atalho nativo do aparelho ou câmera abaixo.'}
                  </p>
                </button>

                <button
                  type="button"
                  disabled={streamStatus === 'starting'}
                  onClick={() => startLiveMirror('camera')}
                  className="flex min-h-[96px] flex-col items-start justify-between rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4 text-left transition-colors hover:border-[#1D4ED8] hover:bg-[#EFF6FF]/40 disabled:opacity-60 cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 text-sm font-semibold text-[#101828]">
                    <Camera className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
                    Espelhar câmera ao vivo na TV
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#475467]">
                    Compatível com qualquer celular Android ou iPhone diretamente pelo Wi-Fi.
                  </p>
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#667085]">Lente da câmera:</span>
                  <div className="inline-flex rounded-lg border border-[#E4E7EC] bg-[#F2F4F7] p-0.5">
                    <button
                      type="button"
                      onClick={() => setCameraFacing('environment')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                        cameraFacing === 'environment'
                          ? 'bg-white text-[#101828] shadow-xs'
                          : 'text-[#475467]'
                      }`}
                    >
                      Traseira
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraFacing('user')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                        cameraFacing === 'user'
                          ? 'bg-white text-[#101828] shadow-xs'
                          : 'text-[#475467]'
                      }`}
                    >
                      Frontal
                    </button>
                  </div>
                </div>

                {platform.startsWith('android') && (
                  <a
                    href={getAndroidNativeCastIntentUrl()}
                    className="text-xs font-semibold text-[#1D4ED8] hover:text-[#1E40AF]"
                  >
                    Abrir tela sem fio nativa do Android →
                  </a>
                )}
              </div>

              {streamError && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]"
                >
                  {streamError}
                </div>
              )}

              {/* Live Preview + Real-Time Controls + Real WebRTC Telemetry */}
              {streamStatus !== 'idle' && (
                <div className="mt-6 space-y-4 border-t border-[#E4E7EC] pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleVideoPause}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                    >
                      {videoPaused ? (
                        <>
                          <Video className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                          Retomar vídeo
                        </>
                      ) : (
                        <>
                          <VideoOff className="h-4 w-4" aria-hidden="true" />
                          Pausar vídeo
                        </>
                      )}
                    </button>

                    {hasAudioTrack && (
                      <button
                        type="button"
                        onClick={handleToggleAudio}
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                      >
                        {audioEnabled ? (
                          <>
                            <Mic className="h-4 w-4 text-[#15803D]" aria-hidden="true" />
                            Áudio ligado
                          </>
                        ) : (
                          <>
                            <MicOff className="h-4 w-4 text-[#B91C1C]" aria-hidden="true" />
                            Áudio mutado
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        sendEvent({
                          type: 'tv:display_control',
                          fitMode:
                            roomState.display.fitMode === 'cover' ? 'contain' : 'cover',
                        })
                      }
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                    >
                      {roomState.display.fitMode === 'cover' ? (
                        <>
                          <Minimize2 className="h-4 w-4" aria-hidden="true" />
                          Ajustar quadro inteiro
                        </>
                      ) : (
                        <>
                          <Expand className="h-4 w-4" aria-hidden="true" />
                          Preencher tela da TV
                        </>
                      )}
                    </button>

                    {hasNativePicker && (
                      <button
                        type="button"
                        onClick={() =>
                          triggerNativeWirelessPicker(
                            localPreviewRef.current,
                            `${window.location.origin}/?modo=tv`
                          )
                        }
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                      >
                        <Cast className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                        AirPlay / Cast nativo
                      </button>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-[#E4E7EC] bg-[#0B0E14]">
                    <video
                      ref={localPreviewRef}
                      autoPlay
                      muted
                      playsInline
                      className="aspect-video w-full object-contain"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-white/80 tabular-nums">
                      <span>
                        {streamStatus === 'live'
                          ? videoPaused
                            ? 'Transmissão pausada temporariamente'
                            : `Espelhando ${streamSource === 'camera' ? 'câmera' : 'tela'} ao vivo na TV`
                          : 'Negociando rota direta de baixa latência...'}
                      </span>
                      <span className="font-mono text-white/70">
                        {MIRROR_PRESETS[qualityPreset].shortSpec}
                      </span>
                    </div>
                  </div>

                  {streamStatus === 'live' && mirrorStats && (
                    <dl className="grid grid-cols-2 gap-4 rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-4 sm:grid-cols-4">
                      <div>
                        <dt className="text-[11px] font-medium text-[#667085]">Latência (RTT)</dt>
                        <dd className="mt-0.5 font-mono text-base font-semibold text-[#101828] tabular-nums">
                          {mirrorStats.rttMs != null ? `${mirrorStats.rttMs} ms` : 'Medindo...'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-medium text-[#667085]">Fluidez</dt>
                        <dd className="mt-0.5 font-mono text-base font-semibold text-[#101828] tabular-nums">
                          {mirrorStats.fps != null ? `${mirrorStats.fps} fps` : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-medium text-[#667085]">Resolução</dt>
                        <dd className="mt-0.5 font-mono text-base font-semibold text-[#101828] tabular-nums">
                          {mirrorStats.resolution ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-medium text-[#667085]">Taxa de envio</dt>
                        <dd className="mt-0.5 font-mono text-base font-semibold text-[#101828] tabular-nums">
                          {mirrorStats.bitrateKbps != null
                            ? mirrorStats.bitrateKbps >= 1000
                              ? `${(mirrorStats.bitrateKbps / 1000).toFixed(1)} Mbps`
                              : `${mirrorStats.bitrateKbps} kbps`
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}
            </section>
          )}

          {/* TAB 2: PHOTOS */}
          {activeTab === 'photos' && (
            <section className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold text-[#101828]">
                    Enviar fotos da galeria para a TV
                  </h2>
                  <p className="mt-1 text-sm text-[#475467]">
                    Selecione uma ou várias imagens do celular para exibição em tela cheia na TV
                    pela rede Wi-Fi.
                  </p>
                </div>

                <label className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer">
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  {uploadingPhotos ? 'Enviando...' : 'Escolher fotos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    disabled={uploadingPhotos}
                    className="sr-only"
                  />
                </label>
              </div>

              {photoFeedback && (
                <p className="mt-4 text-sm font-medium text-[#15803D]">{photoFeedback}</p>
              )}

              {roomState.photos.length === 0 ? (
                <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D0D5DD] bg-[#F9FAFB] px-6 py-12 text-center">
                  <ImageIcon className="h-8 w-8 text-[#98A2B3]" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-[#344054]">
                    Nenhuma foto enviada nesta sessão
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-[#667085]">
                    Toque em "Escolher fotos" para mostrar álbuns de viagem, receitas ou documentos
                    direto na TV da sala.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  {activePhoto && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#E4E7EC] py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={roomState.activePhotoIndex <= 0}
                          onClick={() =>
                            sendEvent({
                              type: 'cast:select_photo',
                              index: roomState.activePhotoIndex - 1,
                            })
                          }
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#D0D5DD] bg-white text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-40 cursor-pointer"
                          aria-label="Foto anterior"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="px-2 font-mono text-sm text-[#344054] tabular-nums">
                          {roomState.activePhotoIndex + 1} / {roomState.photos.length}
                        </span>
                        <button
                          type="button"
                          disabled={roomState.activePhotoIndex >= roomState.photos.length - 1}
                          onClick={() =>
                            sendEvent({
                              type: 'cast:select_photo',
                              index: roomState.activePhotoIndex + 1,
                            })
                          }
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#D0D5DD] bg-white text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-40 cursor-pointer"
                          aria-label="Próxima foto"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            sendEvent({ type: 'cast:rotate_photo', id: activePhoto.id })
                          }
                          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-xs font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                        >
                          <RotateCw className="h-4 w-4" aria-hidden="true" />
                          Girar 90°
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            sendEvent({
                              type: 'tv:display_control',
                              zoom:
                                roomState.display.zoom >= 1.5
                                  ? 1
                                  : Number((roomState.display.zoom + 0.25).toFixed(2)),
                            })
                          }
                          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-xs font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap tabular-nums cursor-pointer"
                        >
                          {roomState.display.zoom >= 1.5 ? (
                            <ZoomOut className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ZoomIn className="h-4 w-4" aria-hidden="true" />
                          )}
                          Zoom {Math.round(roomState.display.zoom * 100)}%
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            sendEvent({ type: 'cast:remove_photo', id: activePhoto.id })
                          }
                          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#FECACA] bg-white px-3 py-2 text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2] whitespace-nowrap cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Remover
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                    {roomState.photos.map((photo, idx) => {
                      const isSelected =
                        roomState.mode === 'photo' && roomState.activePhotoIndex === idx;
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => sendEvent({ type: 'cast:select_photo', index: idx })}
                          className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all cursor-pointer ${
                            isSelected
                              ? 'border-[#1D4ED8] ring-2 ring-[#1D4ED8]/20'
                              : 'border-transparent hover:border-[#D0D5DD]'
                          }`}
                        >
                          <img
                            src={photo.dataUrl}
                            alt={photo.name}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* TAB 3: YOUTUBE */}
          {activeTab === 'youtube' && (
            <section className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
              <h2 className="font-display text-xl font-semibold text-[#101828]">
                Abrir vídeo do YouTube na TV
              </h2>
              <p className="mt-1 text-sm text-[#475467]">
                Cole qualquer link do YouTube (vídeo normal, Shorts ou live) e controle a reprodução
                direto pelo celular.
              </p>

              <form onSubmit={handleSendYoutube} className="mt-5 flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={youtubeInput}
                  onChange={(e) => {
                    setYoutubeError(null);
                    setYoutubeInput(e.target.value);
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="min-h-[46px] flex-1 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] px-4 text-sm text-[#101828] placeholder:text-[#98A2B3] focus:border-[#1D4ED8] focus:bg-white"
                />
                <button
                  type="submit"
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Enviar para TV
                </button>
              </form>

              {youtubeError && (
                <p role="alert" className="mt-3 text-sm text-[#B91C1C]">
                  {youtubeError}
                </p>
              )}

              {roomState.mode === 'youtube' && roomState.youtube && (
                <div className="mt-6 border-t border-[#E4E7EC] pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-[#667085]">Em reprodução na TV</p>
                      <p className="text-sm font-semibold text-[#101828]">
                        {roomState.youtube.title}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          sendEvent({
                            type: 'cast:youtube_command',
                            command: roomState.youtube?.isPlaying ? 'pause' : 'play',
                          })
                        }
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#101828] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D2939] whitespace-nowrap cursor-pointer"
                      >
                        {roomState.youtube.isPlaying ? (
                          <>
                            <Pause className="h-4 w-4" aria-hidden="true" />
                            Pausar
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" aria-hidden="true" />
                            Reproduzir
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          sendEvent({
                            type: 'cast:youtube_command',
                            command: roomState.youtube?.muted ? 'unmute' : 'mute',
                          })
                        }
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                      >
                        {roomState.youtube.muted ? (
                          <>
                            <Volume2 className="h-4 w-4" aria-hidden="true" />
                            Ativar som
                          </>
                        ) : (
                          <>
                            <VolumeX className="h-4 w-4" aria-hidden="true" />
                            Silenciar
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          sendEvent({ type: 'cast:youtube_command', command: 'restart' })
                        }
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Reiniciar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 border-t border-[#E4E7EC] pt-5">
                <p className="text-xs font-semibold text-[#475467]">
                  Sugestões rápidas para testar a TV agora
                </p>
                <div className="mt-3 divide-y divide-[#E4E7EC]">
                  {QUICK_YOUTUBE_VIDEOS.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 py-3 first:pt-1 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#101828]">{item.title}</p>
                        <p className="text-xs text-[#667085]">{item.meta}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          sendEvent({
                            type: 'cast:youtube',
                            videoId: item.id,
                            title: item.title,
                          })
                        }
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:border-[#1D4ED8] hover:text-[#1D4ED8] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        Abrir na TV
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* TAB 4: BIG SCREEN TEXT / NOTICE */}
          {activeTab === 'message' && (
            <section className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
              <h2 className="font-display text-xl font-semibold text-[#101828]">
                Exibir texto, senha do Wi-Fi ou aviso na TV
              </h2>
              <p className="mt-1 text-sm text-[#475467]">
                Ideal para mostrar a senha do Wi-Fi para visitas, placares ou recados em letras
                grandes na televisão.
              </p>

              <form onSubmit={handleSendMessage} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="msg-title" className="block text-xs font-semibold text-[#344054]">
                    Título principal
                  </label>
                  <input
                    id="msg-title"
                    type="text"
                    value={msgTitle}
                    onChange={(e) => setMsgTitle(e.target.value)}
                    maxLength={120}
                    className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] px-3.5 text-sm text-[#101828] focus:border-[#1D4ED8] focus:bg-white"
                  />
                </div>

                <div>
                  <label htmlFor="msg-body" className="block text-xs font-semibold text-[#344054]">
                    Mensagem / detalhes
                  </label>
                  <textarea
                    id="msg-body"
                    rows={3}
                    value={msgBody}
                    onChange={(e) => setMsgBody(e.target.value)}
                    maxLength={500}
                    className="mt-1.5 w-full rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-3.5 text-sm text-[#101828] focus:border-[#1D4ED8] focus:bg-white"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#475467]">Fundo:</span>
                      <div className="inline-flex rounded-lg border border-[#E4E7EC] bg-[#F2F4F7] p-0.5">
                        {(
                          [
                            { id: 'dark', label: 'Escuro' },
                            { id: 'cobalt', label: 'Azul' },
                            { id: 'light', label: 'Claro' },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setMsgTheme(t.id)}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                              msgTheme === t.id
                                ? 'bg-white text-[#101828] shadow-xs'
                                : 'text-[#475467]'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#475467]">Tamanho:</span>
                      <div className="inline-flex rounded-lg border border-[#E4E7EC] bg-[#F2F4F7] p-0.5">
                        <button
                          type="button"
                          onClick={() => setMsgFontSize('normal')}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                            msgFontSize === 'normal'
                              ? 'bg-white text-[#101828] shadow-xs'
                              : 'text-[#475467]'
                          }`}
                        >
                          Médio
                        </button>
                        <button
                          type="button"
                          onClick={() => setMsgFontSize('large')}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                            msgFontSize === 'large'
                              ? 'bg-white text-[#101828] shadow-xs'
                              : 'text-[#475467]'
                          }`}
                        >
                          Grande
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Mostrar na TV
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>

        {/* Side Column: Connected TV Summary */}
        <aside className="space-y-6 lg:col-span-4">
          <div className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-[#101828]">
              <Tv className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
              TV conectada na rede Wi-Fi
            </div>

            <dl className="mt-4 divide-y divide-[#E4E7EC] text-sm">
              <div className="flex items-center justify-between gap-2 py-2.5">
                <dt className="text-[#667085]">Dispositivo</dt>
                <dd className="truncate font-medium text-[#101828]">{roomState.tvName}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#667085]">Fabricante</dt>
                <dd className="font-medium text-[#101828]">{roomState.tvBrand}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#667085]">Modo de conexão</dt>
                <dd className="font-medium text-[#15803D]">Direta sem código</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#667085]">Rota WebRTC</dt>
                <dd className="font-medium text-[#101828]">
                  {mirrorStats?.routeType ?? 'Pronto para P2P'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#667085]">Aparelhos conectados</dt>
                <dd className="font-mono font-medium text-[#101828] tabular-nums">
                  {roomState.controllers.length}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-[#E4E7EC] bg-white p-6">
            <h3 className="font-display text-base font-semibold text-[#101828]">
              Protocolo nativo da fabricante
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#475467]">
              Quer usar Smart View, LG Screen Share, Miracast ou AirPlay 2 direto do sistema do
              celular? Veja o atalho exato para o seu modelo.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('guide')}
              className="mt-4 inline-flex min-h-[42px] items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF] cursor-pointer"
            >
              Abrir guia nativo
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
