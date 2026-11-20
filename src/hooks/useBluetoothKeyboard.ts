import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  BluetoothHid,
  CONSUMER_USAGE,
  HID_KEY,
  HID_MOD,
  type BluetoothDeviceInfo,
  type BluetoothStatusInfo,
} from '../native/bluetoothHidPlugin';
import { useTvSocket } from './useTvSocket';
import type { DiscoveredTvDevice, HidKeyboardLayout } from '../types/tv';
import { detectDefaultDeviceName } from '../utils/media';
import { isNativeApp } from '../utils/serverUrl';

export type ActiveTransport = 'none' | 'bluetooth_hid' | 'wifi_tv_mode';

export interface InputLogItem {
  id: string;
  label: string;
  timestamp: number;
}

const DEFAULT_BT_STATUS: BluetoothStatusInfo = {
  supported: false,
  hidSupported: false,
  androidSdk: 0,
  hasPermissions: false,
  enabled: false,
  profileReady: false,
  appRegistered: false,
  connectionState: 'disconnected',
  connectedDevice: null,
};

const KEY_TO_HID: Record<string, { hidCode: number; shift?: boolean }> = {
  a: { hidCode: HID_KEY.A },
  b: { hidCode: HID_KEY.B },
  c: { hidCode: HID_KEY.C },
  d: { hidCode: HID_KEY.D },
  e: { hidCode: HID_KEY.E },
  f: { hidCode: HID_KEY.F },
  g: { hidCode: HID_KEY.G },
  h: { hidCode: HID_KEY.H },
  i: { hidCode: HID_KEY.I },
  j: { hidCode: HID_KEY.J },
  k: { hidCode: HID_KEY.K },
  l: { hidCode: HID_KEY.L },
  m: { hidCode: HID_KEY.M },
  n: { hidCode: HID_KEY.N },
  o: { hidCode: HID_KEY.O },
  p: { hidCode: HID_KEY.P },
  q: { hidCode: HID_KEY.Q },
  r: { hidCode: HID_KEY.R },
  s: { hidCode: HID_KEY.S },
  t: { hidCode: HID_KEY.T },
  u: { hidCode: HID_KEY.U },
  v: { hidCode: HID_KEY.V },
  w: { hidCode: HID_KEY.W },
  x: { hidCode: HID_KEY.X },
  y: { hidCode: HID_KEY.Y },
  z: { hidCode: HID_KEY.Z },
  '1': { hidCode: HID_KEY.NUM_1 },
  '2': { hidCode: HID_KEY.NUM_2 },
  '3': { hidCode: HID_KEY.NUM_3 },
  '4': { hidCode: HID_KEY.NUM_4 },
  '5': { hidCode: HID_KEY.NUM_5 },
  '6': { hidCode: HID_KEY.NUM_6 },
  '7': { hidCode: HID_KEY.NUM_7 },
  '8': { hidCode: HID_KEY.NUM_8 },
  '9': { hidCode: HID_KEY.NUM_9 },
  '0': { hidCode: HID_KEY.NUM_0 },
  '!': { hidCode: HID_KEY.NUM_1, shift: true },
  '@': { hidCode: HID_KEY.NUM_2, shift: true },
  '#': { hidCode: HID_KEY.NUM_3, shift: true },
  '$': { hidCode: HID_KEY.NUM_4, shift: true },
  '%': { hidCode: HID_KEY.NUM_5, shift: true },
  '^': { hidCode: HID_KEY.NUM_6, shift: true },
  '&': { hidCode: HID_KEY.NUM_7, shift: true },
  '*': { hidCode: HID_KEY.NUM_8, shift: true },
  '(': { hidCode: HID_KEY.NUM_9, shift: true },
  ')': { hidCode: HID_KEY.NUM_0, shift: true },
  '-': { hidCode: HID_KEY.MINUS },
  _: { hidCode: HID_KEY.MINUS, shift: true },
  '=': { hidCode: HID_KEY.EQUAL },
  '+': { hidCode: HID_KEY.EQUAL, shift: true },
  '[': { hidCode: HID_KEY.LEFT_BRACKET },
  '{': { hidCode: HID_KEY.LEFT_BRACKET, shift: true },
  ']': { hidCode: HID_KEY.RIGHT_BRACKET },
  '}': { hidCode: HID_KEY.RIGHT_BRACKET, shift: true },
  '\\': { hidCode: HID_KEY.BACKSLASH },
  '|': { hidCode: HID_KEY.BACKSLASH, shift: true },
  ';': { hidCode: HID_KEY.SEMICOLON },
  ':': { hidCode: HID_KEY.SEMICOLON, shift: true },
  "'": { hidCode: HID_KEY.APOSTROPHE },
  '"': { hidCode: HID_KEY.APOSTROPHE, shift: true },
  '`': { hidCode: HID_KEY.GRAVE },
  '~': { hidCode: HID_KEY.GRAVE, shift: true },
  ',': { hidCode: HID_KEY.COMMA },
  '<': { hidCode: HID_KEY.COMMA, shift: true },
  '.': { hidCode: HID_KEY.PERIOD },
  '>': { hidCode: HID_KEY.PERIOD, shift: true },
  '/': { hidCode: HID_KEY.SLASH },
  '?': { hidCode: HID_KEY.SLASH, shift: true },
  ' ': { hidCode: HID_KEY.SPACE },
  Enter: { hidCode: HID_KEY.ENTER },
  Backspace: { hidCode: HID_KEY.BACKSPACE },
  Tab: { hidCode: HID_KEY.TAB },
  Escape: { hidCode: HID_KEY.ESCAPE },
  Delete: { hidCode: HID_KEY.DELETE },
  Home: { hidCode: HID_KEY.HOME },
  End: { hidCode: HID_KEY.END },
  PageUp: { hidCode: HID_KEY.PAGE_UP },
  PageDown: { hidCode: HID_KEY.PAGE_DOWN },
  ArrowRight: { hidCode: HID_KEY.RIGHT },
  ArrowLeft: { hidCode: HID_KEY.LEFT },
  ArrowDown: { hidCode: HID_KEY.DOWN },
  ArrowUp: { hidCode: HID_KEY.UP },
  F1: { hidCode: HID_KEY.F1 },
  F2: { hidCode: HID_KEY.F2 },
  F3: { hidCode: HID_KEY.F3 },
  F4: { hidCode: HID_KEY.F4 },
  F5: { hidCode: HID_KEY.F5 },
  F6: { hidCode: HID_KEY.F6 },
  F7: { hidCode: HID_KEY.F7 },
  F8: { hidCode: HID_KEY.F8 },
  F9: { hidCode: HID_KEY.F9 },
  F10: { hidCode: HID_KEY.F10 },
  F11: { hidCode: HID_KEY.F11 },
  F12: { hidCode: HID_KEY.F12 },
};

export function useBluetoothKeyboard() {
  const nativeApp = useMemo(() => isNativeApp(), []);
  const [deviceName] = useState(() => detectDefaultDeviceName());

  const [btStatus, setBtStatus] = useState<BluetoothStatusInfo>(DEFAULT_BT_STATUS);
  const [pairedDevices, setPairedDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [discoveredBtDevices, setDiscoveredBtDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [webBtDevices, setWebBtDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [scanningBt, setScanningBt] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<HidKeyboardLayout>(() => {
    if (typeof window === 'undefined') return 'us_intl';
    const saved = window.localStorage.getItem('teclatv_layout');
    return saved === 'abnt2' ? 'abnt2' : 'us_intl';
  });
  const [hapticEnabled, setHapticEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('teclatv_haptic') !== '0';
  });
  const [liveBuffer, setLiveBuffer] = useState<string>('');
  const [recentInputs, setRecentInputs] = useState<InputLogItem[]>([]);

  const {
    roomState,
    discoveredDevices: wsDiscoveredTvs,
    pendingTvName,
    errorMessage: wsError,
    clearError: clearWsError,
    sendEvent,
    connectToTv,
    disconnectFromTv,
  } = useTvSocket({
    role: 'controller',
  });

  const listenersRef = useRef<PluginListenerHandle[]>([]);

  const setLayout = useCallback((next: HidKeyboardLayout) => {
    setLayoutState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('teclatv_layout', next);
    }
  }, []);

  const setHapticEnabled = useCallback((next: boolean) => {
    setHapticEnabledState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('teclatv_haptic', next ? '1' : '0');
    }
  }, []);

  const triggerHaptic = useCallback(() => {
    if (!hapticEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(8);
    }
  }, [hapticEnabled]);

  const appendLog = useCallback((label: string) => {
    setRecentInputs((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label, timestamp: Date.now() },
      ...prev.slice(0, 7),
    ]);
  }, []);

  const refreshNativeState = useCallback(async () => {
    if (!nativeApp) return;
    try {
      const status = await BluetoothHid.getBluetoothStatus();
      setBtStatus(status);
      if (status.hasPermissions && status.enabled) {
        const paired = await BluetoothHid.getPairedDevices();
        setPairedDevices(paired.devices ?? []);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao ler estado do Bluetooth.');
    }
  }, [nativeApp]);

  useEffect(() => {
    if (!nativeApp) return;

    void refreshNativeState();

    const setupListeners = async () => {
      const handles: PluginListenerHandle[] = [];

      handles.push(
        await BluetoothHid.addListener('btDeviceFound', (device) => {
          setDiscoveredBtDevices((prev) => {
            const idx = prev.findIndex((d) => d.address === device.address);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = device;
              return copy;
            }
            return [device, ...prev];
          });
        })
      );

      handles.push(
        await BluetoothHid.addListener('btDiscoveryFinished', () => {
          setScanningBt(false);
        })
      );

      handles.push(
        await BluetoothHid.addListener('btBondStateChanged', (device) => {
          setDiscoveredBtDevices((prev) =>
            prev.map((d) => (d.address === device.address ? device : d))
          );
          if (device.bondState === 'bonded') {
            setFeedback(`TV pareada com sucesso: ${device.name}. Toque em Conectar.`);
            void refreshNativeState();
          }
        })
      );

      handles.push(
        await BluetoothHid.addListener('btAdapterStateChanged', () => {
          void refreshNativeState();
        })
      );

      handles.push(
        await BluetoothHid.addListener('btProfileStatusChanged', (status) => {
          setBtStatus(status);
        })
      );

      handles.push(
        await BluetoothHid.addListener('btConnectionStateChanged', ({ state, device }) => {
          setConnectingAddress(null);
          setBtStatus((prev) => ({
            ...prev,
            connectionState: state,
            connectedDevice: state === 'connected' ? (device ?? prev.connectedDevice ?? null) : null,
          }));
          if (state === 'connected' && device) {
            setFeedback(`Teclado Bluetooth conectado em ${device.name}.`);
          } else if (state === 'disconnected') {
            setFeedback(null);
          }
          void refreshNativeState();
        })
      );

      listenersRef.current = handles;
    };

    void setupListeners();

    return () => {
      for (const handle of listenersRef.current) {
        void handle.remove().catch(() => {});
      }
      listenersRef.current = [];
    };
  }, [nativeApp, refreshNativeState]);

  const requestBluetoothReady = useCallback(async () => {
    setFeedback(null);
    if (!nativeApp) return;
    try {
      let status = await BluetoothHid.requestPermissions();
      setBtStatus(status);
      if (status.hasPermissions && !status.enabled) {
        status = await BluetoothHid.enableBluetooth();
        setBtStatus(status);
      }
      await refreshNativeState();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Não foi possível ativar o Bluetooth.');
    }
  }, [nativeApp, refreshNativeState]);

  const makePhoneDiscoverable = useCallback(async () => {
    setFeedback(null);
    if (!nativeApp) {
      setFeedback(
        'A visibilidade Bluetooth HID só funciona no aplicativo Android (APK). Use a aba "APK GitHub" para gerar seu APK.'
      );
      return;
    }
    try {
      const res = await BluetoothHid.makeDiscoverable({ duration: 120 });
      setBtStatus(res);
      if (res.discoverableGranted) {
        setFeedback(
          'Celular visível por 2 minutos. Abra as configurações de Bluetooth da Smart TV e selecione este celular como teclado.'
        );
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erro ao ativar visibilidade Bluetooth.');
    }
  }, [nativeApp]);

  const scanBluetoothTvs = useCallback(async () => {
    setFeedback(null);
    clearWsError();

    if (nativeApp) {
      setScanningBt(true);
      setDiscoveredBtDevices([]);
      try {
        const status = await BluetoothHid.requestPermissions();
        setBtStatus(status);
        if (!status.hasPermissions) {
          setScanningBt(false);
          setFeedback('Conceda as permissões de Bluetooth para procurar TVs.');
          return;
        }
        if (!status.enabled) {
          await BluetoothHid.enableBluetooth();
        }
        await refreshNativeState();
        const res = await BluetoothHid.startDiscovery();
        if (!res.started) {
          setScanningBt(false);
          setFeedback('Não foi possível iniciar a busca Bluetooth. Verifique se o Bluetooth está ligado.');
        }
      } catch (err) {
        setScanningBt(false);
        setFeedback(err instanceof Error ? err.message : 'Falha na busca Bluetooth.');
      }
      return;
    }

    // Web Bluetooth fallback scan (works in Chrome on supported devices)
    const navBt = (navigator as Navigator & {
      bluetooth?: {
        requestDevice: (options: { acceptAllDevices?: boolean }) => Promise<{ id: string; name?: string }>;
      };
    }).bluetooth;

    if (navBt && typeof navBt.requestDevice === 'function') {
      setScanningBt(true);
      try {
        const device = await navBt.requestDevice({ acceptAllDevices: true });
        setWebBtDevices((prev) => {
          if (prev.some((d) => d.id === device.id)) return prev;
          return [{ id: device.id, name: device.name || 'Dispositivo Bluetooth' }, ...prev];
        });
        setFeedback(
          `Dispositivo "${device.name || 'Bluetooth'}" detectado. Para digitar como teclado Bluetooth HID real na TV, instale o APK Android gerado pelo GitHub.`
        );
      } catch (err) {
        if (err instanceof Error && err.name !== 'NotFoundError') {
          setFeedback(err.message);
        }
      } finally {
        setScanningBt(false);
      }
    } else {
      setFeedback(
        'Navegadores web não permitem emular teclado Bluetooth HID diretamente. Use o APK Android (via GitHub) para parear na TV ou conecte via Modo TV para testar agora.'
      );
    }
  }, [clearWsError, nativeApp, refreshNativeState]);

  const stopBluetoothScan = useCallback(async () => {
    if (nativeApp) {
      await BluetoothHid.stopDiscovery().catch(() => {});
    }
    setScanningBt(false);
  }, [nativeApp]);

  const pairAndConnectDevice = useCallback(
    async (device: BluetoothDeviceInfo) => {
      setFeedback(null);
      if (!nativeApp) return;
      try {
        setConnectingAddress(device.address);
        if (device.bondState !== 'bonded') {
          const pairRes = await BluetoothHid.pairDevice({ address: device.address });
          if (!pairRes.alreadyBonded) {
            setFeedback(
              `Pareando com ${device.name}... Confirme o código na TV e no celular se aparecer.`
            );
            setConnectingAddress(null);
            return;
          }
        }
        await BluetoothHid.connectHidHost({ address: device.address });
      } catch (err) {
        setConnectingAddress(null);
        setFeedback(
          err instanceof Error ? err.message : `Não foi possível conectar em ${device.name}.`
        );
      }
    },
    [nativeApp]
  );

  const disconnectCurrent = useCallback(async () => {
    setFeedback(null);
    if (nativeApp && btStatus.connectionState === 'connected') {
      await BluetoothHid.disconnectHidHost({
        address: btStatus.connectedDevice?.address,
      }).catch(() => {});
    }
    if (roomState) {
      disconnectFromTv();
    }
  }, [btStatus.connectedDevice?.address, btStatus.connectionState, disconnectFromTv, nativeApp, roomState]);

  const connectWsTv = useCallback(
    (tv: DiscoveredTvDevice) => {
      if (!tv.tvId) return;
      clearWsError();
      connectToTv(tv.tvId, deviceName);
    },
    [clearWsError, connectToTv, deviceName]
  );

  const openNativeBtSettings = useCallback(async () => {
    if (!nativeApp) return;
    await BluetoothHid.openBluetoothSettings().catch(() => {});
  }, [nativeApp]);

  const activeTransport: ActiveTransport = useMemo(() => {
    if (nativeApp && btStatus.connectionState === 'connected') {
      return 'bluetooth_hid';
    }
    if (roomState?.tvConnected) {
      return 'wifi_tv_mode';
    }
    return 'none';
  }, [btStatus.connectionState, nativeApp, roomState?.tvConnected]);

  const connectedTargetName = useMemo(() => {
    if (activeTransport === 'bluetooth_hid') {
      return btStatus.connectedDevice?.name ?? 'Smart TV Bluetooth';
    }
    if (activeTransport === 'wifi_tv_mode') {
      return roomState?.tvName ?? 'Modo TV';
    }
    return null;
  }, [activeTransport, btStatus.connectedDevice?.name, roomState?.tvName]);

  const updateLocalPreview = useCallback((key: string) => {
    if (key === 'Backspace') {
      setLiveBuffer((prev) => prev.slice(0, -1));
    } else if (key === 'Enter') {
      setLiveBuffer((prev) => (prev ? `${prev}\n` : ''));
    } else if (key === 'Space' || key === ' ') {
      setLiveBuffer((prev) => `${prev} `);
    } else if (key === 'Tab') {
      setLiveBuffer((prev) => `${prev}  `);
    } else if (key.length === 1) {
      setLiveBuffer((prev) => `${prev}${key}`.slice(-220));
    }
  }, []);

  const sendKey = useCallback(
    async (key: string, modifiers = 0, explicitHidCode?: number) => {
      triggerHaptic();
      updateLocalPreview(key);

      const mapped = KEY_TO_HID[key] ?? KEY_TO_HID[key.toLowerCase()];
      const hidCode = explicitHidCode ?? mapped?.hidCode ?? 0;
      const finalMods =
        modifiers | (mapped?.shift && key === key.toUpperCase() && key.length === 1 ? HID_MOD.LSHIFT : 0) |
        (mapped?.shift && key.length === 1 && !/[a-zA-Z]/.test(key) ? HID_MOD.LSHIFT : 0) |
        (key.length === 1 && /[A-Z]/.test(key) ? HID_MOD.LSHIFT : 0);

      appendLog(key === ' ' ? 'Espaço' : key);

      if (activeTransport === 'bluetooth_hid') {
        if (hidCode > 0) {
          await BluetoothHid.sendHidKey({ keyCode: hidCode, modifiers: finalMods }).catch((err) => {
            setFeedback(err instanceof Error ? err.message : 'Erro ao enviar tecla Bluetooth.');
          });
        } else if (key.length === 1) {
          await BluetoothHid.sendText({ text: key, layout, pressEnter: false }).catch((err) => {
            setFeedback(err instanceof Error ? err.message : 'Erro ao enviar caractere.');
          });
        }
        return;
      }

      if (activeTransport === 'wifi_tv_mode') {
        sendEvent({
          type: 'tv:key_input',
          key,
          hidCode,
          modifiers: finalMods,
          action: 'press',
        });
      }
    },
    [activeTransport, appendLog, layout, sendEvent, triggerHaptic, updateLocalPreview]
  );

  const sendText = useCallback(
    async (text: string, pressEnter = false) => {
      if (!text) return;
      triggerHaptic();
      setLiveBuffer((prev) => `${prev}${text}${pressEnter ? '\n' : ''}`.slice(-220));
      appendLog(text.length > 22 ? `"${text.slice(0, 22)}..."` : `"${text}"`);

      if (activeTransport === 'bluetooth_hid') {
        await BluetoothHid.sendText({ text, layout, pressEnter }).catch((err) => {
          setFeedback(err instanceof Error ? err.message : 'Falha ao enviar texto Bluetooth.');
        });
        return;
      }

      if (activeTransport === 'wifi_tv_mode') {
        sendEvent({ type: 'tv:text_input', text, pressEnter });
      }
    },
    [activeTransport, appendLog, layout, sendEvent, triggerHaptic]
  );

  const sendConsumer = useCallback(
    async (usage: number, label: string) => {
      triggerHaptic();
      appendLog(label);

      if (activeTransport === 'bluetooth_hid') {
        await BluetoothHid.sendConsumerKey({ usage }).catch((err) => {
          setFeedback(err instanceof Error ? err.message : 'Erro ao enviar comando remoto.');
        });
        return;
      }

      if (activeTransport === 'wifi_tv_mode') {
        sendEvent({
          type: 'tv:key_input',
          key: label,
          action: 'consumer',
          consumerUsage: usage,
        });
      }
    },
    [activeTransport, appendLog, sendEvent, triggerHaptic]
  );

  const sendMouseMove = useCallback(
    (dx: number, dy: number, wheel = 0) => {
      const clampedDx = Math.max(-127, Math.min(127, Math.round(dx)));
      const clampedDy = Math.max(-127, Math.min(127, Math.round(dy)));
      const clampedWheel = Math.max(-127, Math.min(127, Math.round(wheel)));
      if (clampedDx === 0 && clampedDy === 0 && clampedWheel === 0) return;

      if (activeTransport === 'bluetooth_hid') {
        void BluetoothHid.sendMouseMove({
          dx: clampedDx,
          dy: clampedDy,
          wheel: clampedWheel,
          buttons: 0,
        }).catch(() => {});
        return;
      }

      if (activeTransport === 'wifi_tv_mode') {
        sendEvent({
          type: 'tv:mouse_input',
          dx: clampedDx,
          dy: clampedDy,
          wheel: clampedWheel,
        });
      }
    },
    [activeTransport, sendEvent]
  );

  const sendMouseClick = useCallback(
    async (button: 'left' | 'right') => {
      triggerHaptic();
      appendLog(button === 'left' ? 'Clique esquerdo' : 'Clique direito');

      if (activeTransport === 'bluetooth_hid') {
        await BluetoothHid.sendMouseClick({ button }).catch((err) => {
          setFeedback(err instanceof Error ? err.message : 'Erro ao enviar clique.');
        });
        return;
      }

      if (activeTransport === 'wifi_tv_mode') {
        sendEvent({ type: 'tv:mouse_input', dx: 0, dy: 0, click: button });
      }
    },
    [activeTransport, appendLog, sendEvent, triggerHaptic]
  );

  const clearPreviewBuffer = useCallback(() => {
    setLiveBuffer('');
    setRecentInputs([]);
  }, []);

  const allNativeBtDevices = useMemo(() => {
    const map = new Map<string, BluetoothDeviceInfo>();
    for (const d of pairedDevices) map.set(d.address, d);
    for (const d of discoveredBtDevices) {
      if (!map.has(d.address)) map.set(d.address, d);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.isTv !== b.isTv) return a.isTv ? -1 : 1;
      if (a.bondState !== b.bondState) return a.bondState === 'bonded' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [discoveredBtDevices, pairedDevices]);

  const companionTvs = useMemo(
    () => wsDiscoveredTvs.filter((d) => d.source === 'telalivre_tv' && d.tvId),
    [wsDiscoveredTvs]
  );

  return {
    nativeApp,
    btStatus,
    allNativeBtDevices,
    webBtDevices,
    companionTvs,
    scanningBt,
    connectingAddress,
    activeTransport,
    connectedTargetName,
    pendingTvName,
    feedback: wsError ?? feedback,
    clearFeedback: () => {
      setFeedback(null);
      clearWsError();
    },
    layout,
    setLayout,
    hapticEnabled,
    setHapticEnabled,
    liveBuffer,
    recentInputs,
    clearPreviewBuffer,
    requestBluetoothReady,
    makePhoneDiscoverable,
    scanBluetoothTvs,
    stopBluetoothScan,
    pairAndConnectDevice,
    disconnectCurrent,
    connectWsTv,
    openNativeBtSettings,
    sendKey,
    sendText,
    sendConsumer,
    sendMouseMove,
    sendMouseClick,
    CONSUMER_USAGE,
    HID_KEY,
    HID_MOD,
  };
}
