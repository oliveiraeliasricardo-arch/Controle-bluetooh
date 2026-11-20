import type { MirrorQualityPreset, MirrorStats } from '../types/tv';

export interface QualityPresetConfig {
  id: MirrorQualityPreset;
  label: string;
  shortSpec: string;
  description: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrateBps: number;
  contentHint: 'motion' | 'detail';
  degradationPreference: RTCDegradationPreference;
}

export const MIRROR_PRESETS: Record<MirrorQualityPreset, QualityPresetConfig> = {
  low_latency: {
    id: 'low_latency',
    label: 'Baixa latência',
    shortSpec: '720p · 60 fps',
    description: 'Prioriza fluidez e resposta imediata para navegação, vídeos e jogos.',
    width: 1280,
    height: 720,
    frameRate: 60,
    maxBitrateBps: 2_800_000,
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate',
  },
  balanced: {
    id: 'balanced',
    label: 'Equilibrado',
    shortSpec: '1080p · 30 fps',
    description: 'Boa definição em Full HD com consumo moderado da rede Wi-Fi.',
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrateBps: 4_000_000,
    contentHint: 'motion',
    degradationPreference: 'balanced',
  },
  high_detail: {
    id: 'high_detail',
    label: 'Alta nitidez',
    shortSpec: '1080p · Texto',
    description: 'Máxima legibilidade para apresentações, documentos e planilhas na TV.',
    width: 1920,
    height: 1080,
    frameRate: 24,
    maxBitrateBps: 5_200_000,
    contentHint: 'detail',
    degradationPreference: 'maintain-resolution',
  },
};

export type ClientPlatform = 'ios' | 'android_samsung' | 'android_other' | 'desktop';

export function detectClientPlatform(): ClientPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) {
    if (/SM-|Samsung/i.test(ua)) return 'android_samsung';
    return 'android_other';
  }
  return 'desktop';
}

export function getAndroidNativeCastIntentUrl(): string {
  return 'intent:#Intent;action=android.settings.CAST_SETTINGS;end';
}

export function createLowLatencyPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 4,
  });
}

export async function applyMirrorQualityToSender(
  pc: RTCPeerConnection,
  videoTrack: MediaStreamTrack | null,
  presetId: MirrorQualityPreset
): Promise<void> {
  const cfg = MIRROR_PRESETS[presetId];

  if (videoTrack) {
    if ('contentHint' in videoTrack) {
      try {
        videoTrack.contentHint = cfg.contentHint;
      } catch {
        // Ignore if unsupported
      }
    }
    try {
      await videoTrack.applyConstraints({
        width: { ideal: cfg.width },
        height: { ideal: cfg.height },
        frameRate: { ideal: cfg.frameRate, max: cfg.frameRate },
      });
    } catch {
      // Ignore constraint rejection
    }
  }

  const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!videoSender) return;

  try {
    const params = videoSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = cfg.maxBitrateBps;
    params.encodings[0].maxFramerate = cfg.frameRate;
    params.degradationPreference = cfg.degradationPreference;
    await videoSender.setParameters(params);
  } catch {
    // Soft fallback
  }
}

export function applyLowLatencyReceiverPlayout(pc: RTCPeerConnection): void {
  for (const receiver of pc.getReceivers()) {
    const extended = receiver as RTCRtpReceiver & { playoutDelayHint?: number };
    if (typeof extended.playoutDelayHint !== 'undefined') {
      try {
        extended.playoutDelayHint = 0;
      } catch {
        // Ignore if unsupported
      }
    }
  }
}

export interface StatsCursor {
  bytes: number;
  timestamp: number;
}

export async function collectRealWebrtcStats(
  pc: RTCPeerConnection,
  direction: 'outbound' | 'inbound',
  cursor: StatsCursor | null
): Promise<{ stats: MirrorStats; nextCursor: StatsCursor | null }> {
  const report = await pc.getStats();

  let rttMs: number | null = null;
  let fps: number | null = null;
  let resolution: string | null = null;
  let packetsLost: number | null = null;
  let routeType: string | null = null;
  let bitrateKbps: number | null = null;
  let nextCursor: StatsCursor | null = cursor;

  const candidateTypes = new Map<string, string>();
  let selectedLocalCandidateId: string | null = null;

  report.forEach((stat) => {
    if (stat.type === 'local-candidate' && stat.id && stat.candidateType) {
      candidateTypes.set(stat.id, String(stat.candidateType));
    }
  });

  report.forEach((stat) => {
    if (
      stat.type === 'candidate-pair' &&
      (stat.state === 'succeeded' || stat.nominated)
    ) {
      if (typeof stat.currentRoundTripTime === 'number') {
        rttMs = Math.round(stat.currentRoundTripTime * 1000);
      }
      if (stat.localCandidateId) {
        selectedLocalCandidateId = String(stat.localCandidateId);
      }
    }

    if (direction === 'outbound' && stat.type === 'outbound-rtp' && stat.kind === 'video') {
      if (typeof stat.framesPerSecond === 'number') {
        fps = Math.round(stat.framesPerSecond);
      }
      if (stat.frameWidth && stat.frameHeight) {
        resolution = `${stat.frameWidth}×${stat.frameHeight}`;
      }
      if (typeof stat.bytesSent === 'number' && typeof stat.timestamp === 'number') {
        if (cursor && stat.timestamp > cursor.timestamp) {
          const deltaBytes = Math.max(0, stat.bytesSent - cursor.bytes);
          const deltaSec = (stat.timestamp - cursor.timestamp) / 1000;
          if (deltaSec > 0) {
            bitrateKbps = Math.round((deltaBytes * 8) / deltaSec / 1000);
          }
        }
        nextCursor = { bytes: stat.bytesSent, timestamp: stat.timestamp };
      }
    }

    if (direction === 'inbound' && stat.type === 'inbound-rtp' && stat.kind === 'video') {
      if (typeof stat.framesPerSecond === 'number') {
        fps = Math.round(stat.framesPerSecond);
      }
      if (stat.frameWidth && stat.frameHeight) {
        resolution = `${stat.frameWidth}×${stat.frameHeight}`;
      }
      if (typeof stat.packetsLost === 'number') {
        packetsLost = stat.packetsLost;
      }
      if (typeof stat.bytesReceived === 'number' && typeof stat.timestamp === 'number') {
        if (cursor && stat.timestamp > cursor.timestamp) {
          const deltaBytes = Math.max(0, stat.bytesReceived - cursor.bytes);
          const deltaSec = (stat.timestamp - cursor.timestamp) / 1000;
          if (deltaSec > 0) {
            bitrateKbps = Math.round((deltaBytes * 8) / deltaSec / 1000);
          }
        }
        nextCursor = { bytes: stat.bytesReceived, timestamp: stat.timestamp };
      }
    }
  });

  if (selectedLocalCandidateId) {
    const rawType = candidateTypes.get(selectedLocalCandidateId);
    if (rawType === 'host') routeType = 'Wi-Fi local direta';
    else if (rawType === 'srflx' || rawType === 'prflx') routeType = 'P2P direto (NAT)';
    else if (rawType === 'relay') routeType = 'Retransmissão';
  }

  return {
    stats: {
      rttMs,
      fps,
      bitrateKbps,
      resolution,
      routeType,
      packetsLost,
    },
    nextCursor,
  };
}

export function supportsBrowserPresentationApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    'PresentationRequest' in window &&
    typeof (window as unknown as { PresentationRequest?: unknown }).PresentationRequest ===
      'function'
  );
}

export function supportsNativeAirPlayPicker(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video') as HTMLVideoElement & {
    webkitShowPlaybackTargetPicker?: () => void;
  };
  return typeof video.webkitShowPlaybackTargetPicker === 'function';
}

export function supportsRemotePlaybackApi(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video') as HTMLVideoElement & {
    remote?: { prompt?: () => Promise<void> };
  };
  return typeof video.remote?.prompt === 'function';
}

export async function triggerNativeWirelessPicker(
  videoEl: HTMLVideoElement | null,
  fallbackPresentationUrl: string
): Promise<{ ok: boolean; message: string }> {
  // 1. Native Apple AirPlay 2 TV Picker (iOS / iPadOS / macOS Safari)
  const webkitVideo = videoEl as (HTMLVideoElement & {
    webkitShowPlaybackTargetPicker?: () => void;
  }) | null;
  if (webkitVideo && typeof webkitVideo.webkitShowPlaybackTargetPicker === 'function') {
    try {
      webkitVideo.webkitShowPlaybackTargetPicker();
      return {
        ok: true,
        message: 'Seletor nativo AirPlay aberto. Escolha sua Smart TV na lista do sistema.',
      };
    } catch {
      // Fallback below
    }
  }

  // 2. W3C Remote Playback API (Chrome / Android Cast & Miracast video output)
  const remoteVideo = videoEl as (HTMLVideoElement & {
    remote?: { prompt?: () => Promise<void> };
  }) | null;
  if (remoteVideo && typeof remoteVideo.remote?.prompt === 'function') {
    try {
      await remoteVideo.remote.prompt();
      return {
        ok: true,
        message: 'Dispositivo sem fio selecionado via Remote Playback nativo.',
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return { ok: false, message: 'Seleção de TV cancelada.' };
      }
      // Fall through to PresentationRequest
    }
  }

  // 3. W3C Presentation API (Chrome / Edge Cast & Miracast external displays)
  const PresentationRequestCtor = (
    window as unknown as {
      PresentationRequest?: new (urls: string[]) => {
        start: () => Promise<{ id: string }>;
      };
    }
  ).PresentationRequest;

  if (PresentationRequestCtor) {
    try {
      const request = new PresentationRequestCtor([fallbackPresentationUrl]);
      await request.start();
      return {
        ok: true,
        message: 'Tela sem fio conectada pelo seletor nativo do navegador.',
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return { ok: false, message: 'Seleção cancelada antes de escolher uma TV.' };
      }
      return {
        ok: false,
        message:
          'Nenhuma TV Cast/AirPlay respondeu diretamente ao seletor do navegador nesta rede. Selecione uma TV na lista abaixo ou abra o Receptor TV na televisão.',
      };
    }
  }

  return {
    ok: false,
    message:
      'Este navegador não permite abrir o seletor nativo do sistema automaticamente. Selecione uma TV encontrada na lista Wi-Fi abaixo ou use o atalho do seu aparelho.',
  };
}
