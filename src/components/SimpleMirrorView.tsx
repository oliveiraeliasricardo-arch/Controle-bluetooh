import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  Camera,
  Cast,
  Check,
  Expand,
  LogOut,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  RefreshCw,
  Square,
  Tv,
  Wifi,
} from 'lucide-react';
import { useTvSocket } from '../hooks/useTvSocket';
import { TvCast, type NativeConnectResult } from '../native/tvCastPlugin';
import type { DiscoveredTvDevice, DiscoveryScanSummary, MirrorStats } from '../types/tv';
import { detectDefaultDeviceName, ICE_SERVERS } from '../utils/media';
import { getApiUrl, isNativeApp } from '../utils/serverUrl';
import {
  applyMirrorQualityToSender,
  collectRealWebrtcStats,
  createLowLatencyPeerConnection,
  triggerNativeWirelessPicker,
  type StatsCursor,
} from '../utils/webrtcMirror';

interface ActiveNativeConnection {
  device: DiscoveredTvDevice;
  mode: NativeConnectResult['mode'];
  canCastDlna: boolean;
  message: string;
}

export function SimpleMirrorView() {
  const [deviceName] = useState(() => detectDefaultDeviceName());
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scanDevices, setScanDevices] = useState<DiscoveredTvDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [nativeConnection, setNativeConnection] = useState<ActiveNativeConnection | null>(null);

  // Live low-latency mirroring state
  const [streamStatus, setStreamStatus] = useState<'idle' | 'starting' | 'live'>('idle');
  const [streamSource, setStreamSource] = useState<'screen' | 'camera' | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [mirrorStats, setMirrorStats] = useState<MirrorStats | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [nativePreviewFrame, setNativePreviewFrame] = useState<string | null>(null);
  const [nativeDlnaNote, setNativeDlnaNote] = useState<string | null>(null);
  const [tvStreamConfirmed, setTvStreamConfirmed] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localPreviewRef = useRef<HTMLVideoElement | null>(null);
  const nativeVideoRef = useRef<HTMLVideoElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const statsCursorRef = useRef<StatsCursor | null>(null);
  const frameListenerRef = useRef<PluginListenerHandle | null>(null);
  const tvStreamListenerRef = useRef<PluginListenerHandle | null>(null);
  const stopListenerRef = useRef<PluginListenerHandle | null>(null);
  const nativeCaptureActiveRef = useRef(false);

  const nativeApp = useMemo(() => isNativeApp(), []);
  const supportsWebDisplayMedia =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  const cleanupNativeCaptureListeners = useCallback(async () => {
    if (frameListenerRef.current) {
      await frameListenerRef.current.remove().catch(() => {});
      frameListenerRef.current = null;
    }
    if (tvStreamListenerRef.current) {
      await tvStreamListenerRef.current.remove().catch(() => {});
      tvStreamListenerRef.current = null;
    }
    if (stopListenerRef.current) {
      await stopListenerRef.current.remove().catch(() => {});
      stopListenerRef.current = null;
    }
    if (nativeCaptureActiveRef.current) {
      nativeCaptureActiveRef.current = false;
      await TvCast.stopScreenCapture().catch(() => {});
    }
    setNativePreviewFrame(null);
    setNativeDlnaNote(null);
    setTvStreamConfirmed(false);
  }, []);

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
      void cleanupNativeCaptureListeners();
      setStreamStatus('idle');
      setStreamSource(null);
      setAudioEnabled(true);
      setHasAudioTrack(false);
      setMirrorStats(null);
      if (notifyServer && emit) {
        emit({ type: 'webrtc:stop' });
      }
    },
    [cleanupNativeCaptureListeners]
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
        setStreamError('Não foi possível iniciar o espelhamento. Tente novamente.');
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
    return () => {
      stopLocalMirror(false);
      if (nativeApp) {
        void TvCast.disconnectTv().catch(() => {});
      }
    };
  }, [nativeApp, stopLocalMirror]);

  useEffect(() => {
    if (localPreviewRef.current && localStreamRef.current) {
      localPreviewRef.current.srcObject = localStreamRef.current;
    }
  }, [streamStatus]);

  useEffect(() => {
    if (streamStatus !== 'live' || !pcRef.current) return;
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
        // Ignore transient getStats failure
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [streamStatus]);

  const allDevices = useMemo(() => {
    const map = new Map<string, DiscoveredTvDevice>();
    for (const d of discoveredDevices) map.set(d.id, d);
    for (const d of scanDevices) {
      if (!map.has(d.id)) map.set(d.id, d);
    }
    return Array.from(map.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }, [discoveredDevices, scanDevices]);

  useEffect(() => {
    if (allDevices.length === 0) {
      setSelectedDeviceId(null);
      return;
    }
    if (!selectedDeviceId || !allDevices.some((d) => d.id === selectedDeviceId)) {
      setSelectedDeviceId(allDevices[0].id);
    }
  }, [allDevices, selectedDeviceId]);

  const selectedDevice = useMemo(
    () => allDevices.find((d) => d.id === selectedDeviceId) ?? null,
    [allDevices, selectedDeviceId]
  );

  const runDiscoveryScan = useCallback(async (): Promise<DiscoveredTvDevice[]> => {
    setScanning(true);
    setFeedback(null);
    clearError();
    try {
      if (nativeApp) {
        const result = await TvCast.scanTvs();
        const found = result.devices ?? [];
        setScanDevices(found);
        const mergedCount = found.length + discoveredDevices.length;
        if (mergedCount === 0) {
          setFeedback(
            'Nenhuma TV encontrada via Wi-Fi Direct. Ligue o Screen Share / Wi-Fi Direct na Smart TV e toque em Procurar TV.'
          );
        }
        return found;
      }

      const res = await fetch(getApiUrl('/api/discovery/scan'), {
        method: 'POST',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Não foi possível procurar TVs agora.');
      }
      const data = (await res.json()) as DiscoveryScanSummary;
      setScanDevices(data.devices);
      if (data.devices.length === 0) {
        setFeedback(
          'Nenhuma TV encontrada automaticamente nesta rede. Toque em "Conectar" para abrir o seletor sem fio do aparelho ou abra o Modo TV na televisão.'
        );
      }
      return data.devices;
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : 'Erro ao procurar TVs na rede Wi-Fi.'
      );
      return [];
    } finally {
      setScanning(false);
    }
  }, [clearError, discoveredDevices.length, nativeApp]);

  const connectSelectedDevice = useCallback(
    async (device: DiscoveredTvDevice) => {
      setConnecting(true);
      setFeedback(null);
      clearError();

      try {
        // 1. Receptor TelaLivre (Modo TV via WebSocket + WebRTC)
        if (device.source === 'telalivre_tv' && device.tvId) {
          connectToTv(device.tvId, deviceName);
          return;
        }

        // 2. Dentro do APK Android: conecta direto no app (Miracast / Wi-Fi Direct / DLNA / IP)
        if (nativeApp) {
          const result = await TvCast.connectTv({
            id: device.id,
            source: device.source,
            name: device.name,
            manufacturer: String(device.manufacturer || ''),
            ip: device.ip,
            avTransportUrl: device.avTransportUrl,
            deviceAddress: device.deviceAddress,
          });

          setNativeConnection({
            device,
            mode: result.mode,
            canCastDlna: Boolean(result.canCastDlna),
            message: result.message,
          });
          return;
        }

        // 3. Navegador / PWA: abre seletor sem fio dentro da página
        const pickerResult = await triggerNativeWirelessPicker(
          nativeVideoRef.current,
          `${window.location.origin}/?modo=tv`
        );
        setFeedback(pickerResult.message);
      } catch (err) {
        setFeedback(
          err instanceof Error ? err.message : `Não foi possível conectar com ${device.name}.`
        );
      } finally {
        setConnecting(false);
      }
    },
    [clearError, connectToTv, deviceName, nativeApp]
  );

  const handleSearchTvs = async () => {
    await runDiscoveryScan();
  };

  const handleConnect = async () => {
    if (selectedDevice) {
      await connectSelectedDevice(selectedDevice);
      return;
    }

    // Se nenhuma TV foi buscada ainda, procura automaticamente primeiro
    const found = await runDiscoveryScan();
    const firstDevice = found[0] ?? discoveredDevices[0] ?? null;
    if (firstDevice && found.length === 1) {
      setSelectedDeviceId(firstDevice.id);
      await connectSelectedDevice(firstDevice);
      return;
    }

    if (!nativeApp && !firstDevice) {
      const result = await triggerNativeWirelessPicker(
        nativeVideoRef.current,
        `${window.location.origin}/?modo=tv`
      );
      setFeedback(result.message);
    }
  };

  const handleDisconnect = async () => {
    stopLocalMirror(true, sendEvent);
    if (nativeConnection) {
      await TvCast.disconnectTv().catch(() => {});
      setNativeConnection(null);
    }
    disconnectFromTv();
    setStreamError(null);
    setFeedback(null);
  };

  const startNativeAndroidScreenStream = async (targetMode: 'tv' | 'webrtc'): Promise<MediaStream | null> => {
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas de vídeo indisponível neste aparelho.');
    }

    frameListenerRef.current = await TvCast.addListener('screenFrame', (evt) => {
      setNativePreviewFrame(evt.dataUrl);

      if (roomState?.tvConnected) {
        const img = new Image();
        img.onload = () => {
          if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = evt.dataUrl;
      }
    });

    tvStreamListenerRef.current = await TvCast.addListener('tvStreamConnected', () => {
      setTvStreamConfirmed(true);
    });

    stopListenerRef.current = await TvCast.addListener('screenCaptureStopped', () => {
      stopLocalMirror(true, sendEvent);
    });

    const captureRes = await TvCast.startScreenCapture({ targetMode });
    nativeCaptureActiveRef.current = true;
    canvas.width = captureRes.width || 720;
    canvas.height = captureRes.height || 1280;
    ctx.fillStyle = '#0B0E14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (captureRes.tvConnectedStream) {
      setTvStreamConfirmed(true);
    }

    if (captureRes.message) {
      setNativeDlnaNote(captureRes.message);
    }

    if (targetMode === 'webrtc' && roomState?.tvConnected && typeof canvas.captureStream === 'function') {
      return canvas.captureStream(24);
    }
    return null;
  };

  const startLiveMirror = async (source: 'screen' | 'camera') => {
    setStreamError(null);
    setNativeDlnaNote(null);

    if (!roomState && !nativeConnection) {
      setStreamError('Conecte-se a uma Smart TV primeiro.');
      return;
    }

    stopLocalMirror(false);
    setStreamStatus('starting');
    setStreamSource(source);

    try {
      let mediaStream: MediaStream | null = null;

      if (source === 'screen') {
        if (nativeApp) {
          const targetMode = roomState ? 'webrtc' : 'tv';
          mediaStream = await startNativeAndroidScreenStream(targetMode);
          if (!roomState) {
            setStreamStatus('live');
            return;
          }
        } else {
          if (!supportsWebDisplayMedia) {
            throw new Error(
              'Este navegador móvel não permite captura direta da tela. Use "Espelhar câmera" ou instale o aplicativo Android.'
            );
          }
          mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
            audio: true,
          });
        }
      } else {
        if (nativeApp) {
          await TvCast.ensureMediaPermissions().catch(() => {});
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
      }

      if (!mediaStream) {
        setStreamStatus('live');
        return;
      }

      localStreamRef.current = mediaStream;
      setHasAudioTrack(mediaStream.getAudioTracks().length > 0);
      setAudioEnabled(true);

      if (localPreviewRef.current) {
        localPreviewRef.current.srcObject = mediaStream;
      }

      if (!roomState?.tvConnected) {
        setStreamStatus('live');
        return;
      }

      const pc = createLowLatencyPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      mediaStream.getTracks().forEach((track) => {
        pc.addTrack(track, mediaStream);
        track.onended = () => stopLocalMirror(true, sendEvent);
      });

      const videoTrack = mediaStream.getVideoTracks()[0] ?? null;
      await applyMirrorQualityToSender(pc, videoTrack, 'low_latency');

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
          setStreamError('A conexão de vídeo foi interrompida.');
          stopLocalMirror(true, sendEvent);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendEvent({
        type: 'webrtc:offer',
        sdp: offer,
        source,
        preset: 'low_latency',
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permissão cancelada. Autorize o compartilhamento para espelhar na TV.'
          : err instanceof Error
            ? err.message
            : 'Não foi possível iniciar o espelhamento.';
      setStreamError(msg);
      stopLocalMirror(false);
    }
  };

  const toggleAudio = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !audioEnabled;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    setAudioEnabled(next);
  };

  // CONNECTED STATE (works for both Modo TV WebRTC and Native In-App Smart TV Connection)
  if (roomState || nativeConnection) {
    const tvTitle = roomState?.tvName ?? nativeConnection?.device.name ?? 'Smart TV';
    const tvBrand =
      roomState?.tvBrand ?? nativeConnection?.device.manufacturer ?? 'Wi-Fi';
    const isNativeMiracast = nativeConnection?.mode === 'miracast';

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-[#E4E7EC] bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E4E7EC] pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#1D4ED8]">
                <Tv className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold text-[#101828]">
                  {tvTitle}
                </h1>
                <p className="flex items-center gap-1.5 text-xs text-[#15803D]">
                  <span className="h-2 w-2 rounded-full bg-[#16A34A]" aria-hidden="true" />
                  Conectado via Wi-Fi · {tvBrand}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-medium text-[#344054] transition-colors hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Desconectar
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {isNativeMiracast ? (
              <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-5 text-sm text-[#1E3A8A]">
                <p className="font-semibold text-[#101828]">
                  Espelhamento sem fio ativo
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#475467]">
                  {nativeConnection.message}
                </p>
              </div>
            ) : streamStatus === 'idle' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => startLiveMirror('screen')}
                  className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-xl bg-[#1D4ED8] px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-[#1E40AF] active:scale-[0.99] whitespace-nowrap cursor-pointer"
                >
                  <MonitorUp className="h-5 w-5" aria-hidden="true" />
                  Espelhar tela
                </button>

                <button
                  type="button"
                  onClick={() => startLiveMirror('camera')}
                  className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-xl border border-[#D0D5DD] bg-white px-5 py-3 text-base font-semibold text-[#101828] transition-colors hover:bg-[#F9FAFB] active:scale-[0.99] whitespace-nowrap cursor-pointer"
                >
                  <Camera className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
                  Espelhar câmera
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {nativeConnection && streamSource === 'screen' && !nativePreviewFrame ? (
                  <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          tvStreamConfirmed ? 'bg-[#16A34A]' : 'bg-[#D97706] animate-pulse'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-semibold text-[#101828]">
                        {tvStreamConfirmed
                          ? `Espelhamento ativo na TV ${tvTitle}`
                          : streamStatus === 'starting'
                            ? `Iniciando transmissão para ${tvTitle}... Se aparecer pedido na TV, confirme com o controle.`
                            : `Enviando transmissão de vídeo para ${tvTitle}...`}
                      </span>
                    </div>
                    {nativeDlnaNote && (
                      <p className="mt-2 text-xs leading-relaxed text-[#475467]">
                        {nativeDlnaNote}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-[#E4E7EC] bg-[#0B0E14]">
                    {nativePreviewFrame && streamSource === 'screen' ? (
                      <img
                        src={nativePreviewFrame}
                        alt="Prévia da tela espelhada"
                        className="aspect-video w-full object-contain"
                      />
                    ) : (
                      <video
                        ref={localPreviewRef}
                        autoPlay
                        muted
                        playsInline
                        className="aspect-video w-full object-contain"
                      />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-white/80 tabular-nums">
                      <span>
                        {streamStatus === 'live'
                          ? tvStreamConfirmed
                            ? `Espelhando ao vivo na TV ${tvTitle}`
                            : `Transmitindo ${streamSource === 'camera' ? 'câmera' : 'tela'} ao vivo`
                          : 'Conectando vídeo...'}
                      </span>
                      {mirrorStats && (
                        <span className="font-mono text-white/70">
                          {mirrorStats.rttMs != null ? `${mirrorStats.rttMs} ms` : ''}
                          {mirrorStats.fps != null ? ` · ${mirrorStats.fps} fps` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {nativePreviewFrame && !tvStreamConfirmed && nativeDlnaNote && (
                  <p className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-xs leading-relaxed text-[#1E3A8A]">
                    {nativeDlnaNote}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {hasAudioTrack && (
                      <button
                        type="button"
                        onClick={toggleAudio}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                      >
                        {audioEnabled ? (
                          <>
                            <Mic className="h-4 w-4 text-[#15803D]" aria-hidden="true" />
                            Som ligado
                          </>
                        ) : (
                          <>
                            <MicOff className="h-4 w-4 text-[#B91C1C]" aria-hidden="true" />
                            Sem som
                          </>
                        )}
                      </button>
                    )}

                    {roomState && (
                      <button
                        type="button"
                        onClick={() =>
                          sendEvent({
                            type: 'tv:display_control',
                            fitMode:
                              roomState.display.fitMode === 'cover' ? 'contain' : 'cover',
                          })
                        }
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3.5 py-2 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
                      >
                        {roomState.display.fitMode === 'cover' ? (
                          <>
                            <Minimize2 className="h-4 w-4" aria-hidden="true" />
                            Ajustar
                          </>
                        ) : (
                          <>
                            <Expand className="h-4 w-4" aria-hidden="true" />
                            Tela cheia
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => stopLocalMirror(true, sendEvent)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#991B1B] whitespace-nowrap cursor-pointer"
                  >
                    <Square className="h-4 w-4" aria-hidden="true" />
                    Parar
                  </button>
                </div>
              </div>
            )}

            {streamError && (
              <p
                role="alert"
                className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]"
              >
                {streamError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // MAIN ULTRA-SIMPLE HOME VIEW: ONLY "Procurar TV" AND "Conectar"
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8 sm:px-6">
      <video ref={nativeVideoRef} playsInline muted className="hidden" aria-hidden="true" />

      <div className="rounded-2xl border border-[#E4E7EC] bg-white p-6 sm:p-10">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#1D4ED8]">
            <Wifi className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-display text-balance text-3xl font-bold tracking-tight text-[#101828]">
            Conectar celular na TV
          </h1>
          <p className="mt-2 text-sm text-[#475467]">
            Ligue o Wi-Fi do celular e o Screen Share (Wi-Fi Direct) na Smart TV.
          </p>
        </div>

        {/* ONLY TWO BUTTONS: Procurar TV & Conectar */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={scanning || connecting}
            onClick={handleSearchTvs}
            className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-5 py-3 text-base font-semibold text-[#101828] transition-colors duration-150 hover:bg-[#F9FAFB] active:scale-[0.99] disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw
              className={`h-5 w-5 text-[#1D4ED8] ${scanning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {scanning ? 'Procurando...' : 'Procurar TV'}
          </button>

          <button
            type="button"
            disabled={scanning || connecting}
            onClick={handleConnect}
            className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-3 text-base font-semibold text-white transition-colors duration-150 hover:bg-[#1E40AF] active:scale-[0.99] disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            <Cast className="h-5 w-5" aria-hidden="true" />
            {connecting ? 'Conectando...' : 'Conectar'}
          </button>
        </div>

        {connecting && nativeApp && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#1E3A8A]"
          >
            Conectando na TV... Se aparecer uma solicitação na tela da TV, confirme com o controle remoto.
          </div>
        )}

        {pendingTvName && (
          <div
            role="status"
            className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#1E3A8A]"
          >
            <span>Aceite a conexão na tela de {pendingTvName}.</span>
            <button
              type="button"
              onClick={handleDisconnect}
              className="text-xs font-semibold text-[#1D4ED8] underline cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        )}

        {allDevices.length > 0 && (
          <div className="mt-7 border-t border-[#E4E7EC] pt-5">
            <p className="text-xs font-medium text-[#667085] tabular-nums">
              TVs encontradas na rede ({allDevices.length})
            </p>
            <ul className="mt-3 divide-y divide-[#E4E7EC]">
              {allDevices.map((device) => {
                const isSelected = selectedDeviceId === device.id;
                return (
                  <li key={device.id} className="py-2 first:pt-0 last:pb-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDeviceId(device.id);
                        setFeedback(null);
                      }}
                      className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#EFF6FF] text-[#101828]'
                          : 'hover:bg-[#F9FAFB] text-[#344054]'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Tv
                          className={`h-5 w-5 shrink-0 ${
                            isSelected ? 'text-[#1D4ED8]' : 'text-[#667085]'
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#101828]">
                            {device.name}
                          </div>
                          <div className="truncate text-xs text-[#667085]">
                            {device.manufacturer} · {device.protocols[0]}
                            {device.ip ? ` · ${device.ip}` : ''}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {(feedback || errorMessage) && (
          <p
            role="status"
            className={`mt-5 rounded-xl px-4 py-3 text-sm ${
              errorMessage
                ? 'border border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                : 'border border-[#E4E7EC] bg-[#F9FAFB] text-[#475467]'
            }`}
          >
            {errorMessage ?? feedback}
          </p>
        )}
      </div>
    </div>
  );
}
