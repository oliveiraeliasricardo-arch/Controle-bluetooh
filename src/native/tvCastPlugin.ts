import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { DiscoveredTvDevice } from '../types/tv';

export interface NativeScanResult {
  scannedAt: number;
  durationMs: number;
  localIp?: string | null;
  ssdpResponses: number;
  mdnsResponses: number;
  wifiP2pCount: number;
  mediaRouterCount: number;
  devices: DiscoveredTvDevice[];
}

export interface NativeConnectResult {
  connected: boolean;
  mode: 'miracast' | 'dlna' | 'network';
  tvName: string;
  manufacturer: string;
  ip?: string;
  canCastDlna?: boolean;
  message: string;
}

export interface NativeScreenCaptureResult {
  started: boolean;
  width?: number;
  height?: number;
  streamUrl?: string | null;
  dlnaStarted?: boolean;
  tvConnectedStream?: boolean;
  message?: string;
}

export interface NativeScreenFrameEvent {
  dataUrl: string;
  width: number;
  height: number;
}

export interface TvCastPluginInterface {
  scanTvs(): Promise<NativeScanResult>;
  probeTvIp(options: { ip: string }): Promise<{ device: DiscoveredTvDevice }>;
  connectTv(options: {
    id: string;
    source: string;
    name: string;
    manufacturer?: string;
    ip?: string;
    avTransportUrl?: string;
    deviceAddress?: string;
  }): Promise<NativeConnectResult>;
  disconnectTv(): Promise<void>;
  ensureMediaPermissions(): Promise<void>;
  startScreenCapture(options?: { targetMode?: 'auto' | 'tv' | 'webrtc' }): Promise<NativeScreenCaptureResult>;
  stopScreenCapture(): Promise<void>;
  addListener(
    eventName: 'screenFrame',
    listenerFunc: (event: NativeScreenFrameEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'tvStreamConnected',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'screenCaptureStopped',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;
}

export const TvCast = registerPlugin<TvCastPluginInterface>('TvCast');
