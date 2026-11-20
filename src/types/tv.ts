export type CastMode = 'idle' | 'photo' | 'youtube' | 'message' | 'webrtc';

export type TvManufacturer =
  | 'Samsung'
  | 'LG'
  | 'Sony'
  | 'TCL'
  | 'Philips'
  | 'Roku'
  | 'Outra TV';

export type DiscoverySource =
  | 'telalivre_tv'
  | 'ssdp_dlna'
  | 'mdns_cast'
  | 'ip_probe'
  | 'media_router'
  | 'wifi_direct';

export type MirrorQualityPreset = 'low_latency' | 'balanced' | 'high_detail';

export interface DiscoveredTvDevice {
  id: string;
  name: string;
  manufacturer: TvManufacturer | string;
  model: string;
  source: DiscoverySource;
  protocols: string[];
  ip?: string;
  tvId?: string;
  avTransportUrl?: string;
  locationUrl?: string;
  deviceAddress?: string;
  online: boolean;
  autoAccept?: boolean;
  controllersCount?: number;
  latencyMs?: number;
  lastSeenAt: number;
}

export interface DiscoveryScanSummary {
  scannedAt: number;
  durationMs: number;
  ssdpSupported: boolean;
  mdnsSupported: boolean;
  localSubnets: string[];
  ssdpResponses: number;
  mdnsResponses: number;
  devices: DiscoveredTvDevice[];
  note?: string;
}

export interface MirrorStats {
  rttMs: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  resolution: string | null;
  routeType: string | null;
  packetsLost: number | null;
}

export interface CastPhoto {
  id: string;
  name: string;
  dataUrl: string;
  rotation: number;
  addedAt: number;
}

export interface CastYoutube {
  videoId: string;
  title: string;
  isPlaying: boolean;
  muted: boolean;
  updatedAt: number;
}

export interface CastMessage {
  title: string;
  body: string;
  theme: 'dark' | 'light' | 'cobalt';
  fontSize: 'normal' | 'large';
  updatedAt: number;
}

export interface TvDisplaySettings {
  dimmed: boolean;
  zoom: number;
  fitMode: 'contain' | 'cover';
}

export interface ConnectedController {
  id: string;
  deviceName: string;
  joinedAt: number;
}

export interface PendingConnectionRequest {
  controllerId: string;
  deviceName: string;
  requestedAt: number;
}

export interface TvRoomState {
  tvId: string;
  tvName: string;
  tvBrand: TvManufacturer;
  tvModel: string;
  tvConnected: boolean;
  autoAccept: boolean;
  pendingRequests: PendingConnectionRequest[];
  mode: CastMode;
  photos: CastPhoto[];
  activePhotoIndex: number;
  youtube: CastYoutube | null;
  message: CastMessage | null;
  display: TvDisplaySettings;
  webrtcActive: boolean;
  webrtcSource: 'screen' | 'camera' | null;
  webrtcPreset: MirrorQualityPreset;
  webrtcControllerId: string | null;
  controllers: ConnectedController[];
  updatedAt: number;
}

export type YoutubeCommand = 'play' | 'pause' | 'mute' | 'unmute' | 'restart';

export type ClientToServerEvent =
  | {
      type: 'tv:register';
      preferredTvId?: string;
      tvName?: string;
      tvBrand?: TvManufacturer;
      tvModel?: string;
      autoAccept?: boolean;
    }
  | {
      type: 'tv:update_identity';
      tvName: string;
      tvBrand: TvManufacturer;
      tvModel?: string;
    }
  | { type: 'tv:set_auto_accept'; autoAccept: boolean }
  | { type: 'tv:respond_request'; controllerId: string; accept: boolean }
  | { type: 'discovery:request' }
  | { type: 'controller:connect'; tvId: string; deviceName: string }
  | { type: 'controller:disconnect' }
  | { type: 'cast:add_photo'; photo: { id: string; name: string; dataUrl: string } }
  | { type: 'cast:select_photo'; index: number }
  | { type: 'cast:rotate_photo'; id: string }
  | { type: 'cast:remove_photo'; id: string }
  | { type: 'cast:youtube'; videoId: string; title: string }
  | { type: 'cast:youtube_command'; command: YoutubeCommand }
  | {
      type: 'cast:message';
      title: string;
      body: string;
      theme: 'dark' | 'light' | 'cobalt';
      fontSize: 'normal' | 'large';
    }
  | { type: 'cast:clear' }
  | { type: 'tv:display_control'; dimmed?: boolean; zoom?: number; fitMode?: 'contain' | 'cover' }
  | {
      type: 'webrtc:offer';
      sdp: RTCSessionDescriptionInit;
      source: 'screen' | 'camera';
      preset?: MirrorQualityPreset;
    }
  | { type: 'webrtc:answer'; sdp: RTCSessionDescriptionInit; controllerId: string }
  | {
      type: 'webrtc:ice';
      candidate: RTCIceCandidateInit;
      target: 'tv' | 'controller';
      controllerId?: string;
    }
  | { type: 'webrtc:preset'; preset: MirrorQualityPreset }
  | { type: 'webrtc:stop' }
  | {
      type: 'tv:key_input';
      key: string;
      code?: string;
      hidCode?: number;
      modifiers?: number;
      action: 'press' | 'consumer';
      consumerUsage?: number;
    }
  | { type: 'tv:text_input'; text: string; pressEnter?: boolean }
  | { type: 'tv:mouse_input'; dx: number; dy: number; wheel?: number; click?: 'left' | 'right' };

export type ServerToClientEvent =
  | { type: 'connected'; clientId: string }
  | { type: 'discovery:list'; devices: DiscoveredTvDevice[] }
  | { type: 'tv:registered'; state: TvRoomState }
  | { type: 'controller:pending'; tvId: string; tvName: string }
  | { type: 'controller:rejected'; tvId: string; message: string }
  | { type: 'controller:connected'; state: TvRoomState; clientId: string }
  | { type: 'room:state'; state: TvRoomState }
  | { type: 'room:error'; message: string; code?: string }
  | { type: 'youtube:command'; command: YoutubeCommand }
  | {
      type: 'webrtc:offer';
      sdp: RTCSessionDescriptionInit;
      source: 'screen' | 'camera';
      preset: MirrorQualityPreset;
      controllerId: string;
    }
  | { type: 'webrtc:answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'webrtc:ice'; candidate: RTCIceCandidateInit; fromControllerId?: string }
  | { type: 'webrtc:stop' }
  | {
      type: 'tv:key_input';
      key: string;
      code?: string;
      hidCode?: number;
      modifiers?: number;
      action: 'press' | 'consumer';
      consumerUsage?: number;
    }
  | { type: 'tv:text_input'; text: string; pressEnter?: boolean }
  | { type: 'tv:mouse_input'; dx: number; dy: number; wheel?: number; click?: 'left' | 'right' };

export type AppSection = 'pair' | 'guide' | 'diagnostics' | 'tv';
export type KeyboardWorkspaceTab = 'keyboard' | 'trackpad';
export type HidKeyboardLayout = 'us_intl' | 'abnt2';

