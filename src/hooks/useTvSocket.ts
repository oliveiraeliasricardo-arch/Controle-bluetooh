import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientToServerEvent,
  DiscoveredTvDevice,
  MirrorQualityPreset,
  ServerToClientEvent,
  TvManufacturer,
  TvRoomState,
  YoutubeCommand,
} from '../types/tv';
import { getWebSocketUrl } from '../utils/serverUrl';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface TvIdentityInput {
  tvName: string;
  tvBrand: TvManufacturer;
  tvModel?: string;
  autoAccept?: boolean;
}

interface SignalListeners {
  onYoutubeCommand?: (command: YoutubeCommand) => void;
  onWebrtcOffer?: (payload: {
    sdp: RTCSessionDescriptionInit;
    source: 'screen' | 'camera';
    preset: MirrorQualityPreset;
    controllerId: string;
  }) => void;
  onWebrtcAnswer?: (sdp: RTCSessionDescriptionInit) => void;
  onWebrtcIce?: (payload: { candidate: RTCIceCandidateInit; fromControllerId?: string }) => void;
  onWebrtcStop?: () => void;
  onTvKeyInput?: (payload: {
    key: string;
    code?: string;
    hidCode?: number;
    modifiers?: number;
    action: 'press' | 'consumer';
    consumerUsage?: number;
  }) => void;
  onTvTextInput?: (payload: { text: string; pressEnter?: boolean }) => void;
  onTvMouseInput?: (payload: {
    dx: number;
    dy: number;
    wheel?: number;
    click?: 'left' | 'right';
  }) => void;
}

interface UseTvSocketOptions {
  role: 'tv' | 'controller';
  autoRegisterTv?: boolean;
  initialTvIdentity?: TvIdentityInput;
  listeners?: SignalListeners;
}

export function useTvSocket({
  role,
  autoRegisterTv = false,
  initialTvIdentity,
  listeners,
}: UseTvSocketOptions) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [clientId, setClientId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<TvRoomState | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredTvDevice[]>([]);
  const [pendingTvName, setPendingTvName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const activeTvIdRef = useRef<string | null>(null);
  const activeDeviceNameRef = useRef<string>('Celular');
  const tvIdentityRef = useRef<TvIdentityInput | undefined>(initialTvIdentity);
  const listenersRef = useRef<SignalListeners | undefined>(listeners);

  useEffect(() => {
    listenersRef.current = listeners;
  }, [listeners]);

  useEffect(() => {
    if (initialTvIdentity) {
      tvIdentityRef.current = initialTvIdentity;
    }
  }, [initialTvIdentity]);

  const sendEvent = useCallback((event: ClientToServerEvent): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(event));
    return true;
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;

    const connect = () => {
      if (!shouldReconnectRef.current) return;

      const wsUrl = getWebSocketUrl();

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('open');
        setErrorMessage(null);

        if (role === 'tv' && autoRegisterTv) {
          ws.send(
            JSON.stringify({
              type: 'tv:register',
              preferredTvId: activeTvIdRef.current ?? undefined,
              tvName: tvIdentityRef.current?.tvName,
              tvBrand: tvIdentityRef.current?.tvBrand,
              tvModel: tvIdentityRef.current?.tvModel,
              autoAccept: tvIdentityRef.current?.autoAccept ?? true,
            } satisfies ClientToServerEvent)
          );
        } else if (role === 'controller' && activeTvIdRef.current) {
          ws.send(
            JSON.stringify({
              type: 'controller:connect',
              tvId: activeTvIdRef.current,
              deviceName: activeDeviceNameRef.current,
            } satisfies ClientToServerEvent)
          );
        } else {
          ws.send(JSON.stringify({ type: 'discovery:request' } satisfies ClientToServerEvent));
        }
      };

      ws.onmessage = (evt) => {
        let msg: ServerToClientEvent;
        try {
          msg = JSON.parse(String(evt.data)) as ServerToClientEvent;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'connected':
            setClientId(msg.clientId);
            break;
          case 'discovery:list':
            setDiscoveredDevices(msg.devices);
            break;
          case 'tv:registered':
            activeTvIdRef.current = msg.state.tvId;
            setRoomState(msg.state);
            setErrorMessage(null);
            break;
          case 'controller:pending':
            setPendingTvName(msg.tvName);
            setErrorMessage(null);
            break;
          case 'controller:rejected':
            activeTvIdRef.current = null;
            setPendingTvName(null);
            setRoomState(null);
            setErrorMessage(msg.message);
            break;
          case 'controller:connected':
            activeTvIdRef.current = msg.state.tvId;
            setClientId(msg.clientId);
            setPendingTvName(null);
            setRoomState(msg.state);
            setErrorMessage(null);
            break;
          case 'room:state':
            setRoomState(msg.state);
            break;
          case 'room:error':
            setPendingTvName(null);
            setErrorMessage(msg.message);
            if (msg.code === 'TV_OFFLINE') {
              activeTvIdRef.current = null;
              setRoomState(null);
            }
            break;
          case 'youtube:command':
            listenersRef.current?.onYoutubeCommand?.(msg.command);
            break;
          case 'webrtc:offer':
            listenersRef.current?.onWebrtcOffer?.({
              sdp: msg.sdp,
              source: msg.source,
              preset: msg.preset,
              controllerId: msg.controllerId,
            });
            break;
          case 'webrtc:answer':
            listenersRef.current?.onWebrtcAnswer?.(msg.sdp);
            break;
          case 'webrtc:ice':
            listenersRef.current?.onWebrtcIce?.({
              candidate: msg.candidate,
              fromControllerId: msg.fromControllerId,
            });
            break;
          case 'webrtc:stop':
            listenersRef.current?.onWebrtcStop?.();
            break;
          case 'tv:key_input':
            listenersRef.current?.onTvKeyInput?.({
              key: msg.key,
              code: msg.code,
              hidCode: msg.hidCode,
              modifiers: msg.modifiers,
              action: msg.action,
              consumerUsage: msg.consumerUsage,
            });
            break;
          case 'tv:text_input':
            listenersRef.current?.onTvTextInput?.({
              text: msg.text,
              pressEnter: msg.pressEnter,
            });
            break;
          case 'tv:mouse_input':
            listenersRef.current?.onTvMouseInput?.({
              dx: msg.dx,
              dy: msg.dy,
              wheel: msg.wheel,
              click: msg.click,
            });
            break;
        }
      };

      ws.onclose = () => {
        if (!shouldReconnectRef.current) {
          setStatus('closed');
          return;
        }
        setStatus('reconnecting');
        reconnectTimerRef.current = window.setTimeout(connect, 1800);
      };

      ws.onerror = () => {
        // Close triggers auto-reconnect
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [role, autoRegisterTv]);

  const updateTvIdentity = useCallback(
    (identity: { tvName: string; tvBrand: TvManufacturer; tvModel?: string }) => {
      tvIdentityRef.current = { ...tvIdentityRef.current, ...identity };
      return sendEvent({
        type: 'tv:update_identity',
        tvName: identity.tvName,
        tvBrand: identity.tvBrand,
        tvModel: identity.tvModel,
      });
    },
    [sendEvent]
  );

  const setAutoAccept = useCallback(
    (autoAccept: boolean) => {
      if (tvIdentityRef.current) {
        tvIdentityRef.current = { ...tvIdentityRef.current, autoAccept };
      }
      return sendEvent({ type: 'tv:set_auto_accept', autoAccept });
    },
    [sendEvent]
  );

  const respondToRequest = useCallback(
    (controllerId: string, accept: boolean) => {
      return sendEvent({ type: 'tv:respond_request', controllerId, accept });
    },
    [sendEvent]
  );

  const connectToTv = useCallback(
    (tvId: string, deviceName: string) => {
      activeTvIdRef.current = tvId;
      activeDeviceNameRef.current = deviceName;
      setErrorMessage(null);
      setPendingTvName(null);
      return sendEvent({
        type: 'controller:connect',
        tvId,
        deviceName,
      });
    },
    [sendEvent]
  );

  const disconnectFromTv = useCallback(() => {
    activeTvIdRef.current = null;
    setPendingTvName(null);
    sendEvent({ type: 'controller:disconnect' });
    setRoomState(null);
    setErrorMessage(null);
  }, [sendEvent]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  return {
    status,
    clientId,
    roomState,
    discoveredDevices,
    pendingTvName,
    errorMessage,
    clearError,
    sendEvent,
    updateTvIdentity,
    setAutoAccept,
    respondToRequest,
    connectToTv,
    disconnectFromTv,
  };
}
