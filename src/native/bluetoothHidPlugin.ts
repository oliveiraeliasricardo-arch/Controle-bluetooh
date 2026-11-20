import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface BluetoothDeviceInfo {
  address: string;
  name: string;
  bondState: 'none' | 'bonding' | 'bonded';
  isTv: boolean;
  majorClass?: number;
  deviceClass?: number;
  connected?: boolean;
}

export interface BluetoothStatusInfo {
  supported: boolean;
  hidSupported: boolean;
  androidSdk: number;
  hasPermissions: boolean;
  enabled: boolean;
  profileReady: boolean;
  appRegistered: boolean;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
  adapterName?: string;
  connectedDevice?: BluetoothDeviceInfo | null;
  discoverableGranted?: boolean;
  discoverableSeconds?: number;
}

export interface BluetoothHidPluginInterface {
  getBluetoothStatus(): Promise<BluetoothStatusInfo>;
  requestPermissions(): Promise<BluetoothStatusInfo>;
  enableBluetooth(): Promise<BluetoothStatusInfo>;
  makeDiscoverable(options?: { duration?: number }): Promise<BluetoothStatusInfo>;
  openBluetoothSettings(): Promise<void>;
  getPairedDevices(): Promise<{ devices: BluetoothDeviceInfo[] }>;
  startDiscovery(): Promise<{ started: boolean }>;
  stopDiscovery(): Promise<void>;
  pairDevice(options: { address: string }): Promise<{ initiated: boolean; alreadyBonded: boolean }>;
  connectHidHost(options: { address: string }): Promise<{ requested: boolean; address: string }>;
  disconnectHidHost(options?: { address?: string }): Promise<void>;
  sendHidKey(options: { keyCode: number; modifiers?: number }): Promise<void>;
  sendText(options: {
    text: string;
    layout?: 'us_intl' | 'abnt2';
    pressEnter?: boolean;
  }): Promise<void>;
  sendConsumerKey(options: { usage: number }): Promise<void>;
  sendMouseMove(options: {
    dx: number;
    dy: number;
    wheel?: number;
    buttons?: number;
  }): Promise<void>;
  sendMouseClick(options: { button?: 'left' | 'right' | 'middle' }): Promise<void>;

  addListener(
    eventName: 'btDeviceFound',
    listenerFunc: (device: BluetoothDeviceInfo) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'btDiscoveryFinished',
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'btBondStateChanged',
    listenerFunc: (device: BluetoothDeviceInfo) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'btAdapterStateChanged',
    listenerFunc: (state: { enabled: boolean; state: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'btConnectionStateChanged',
    listenerFunc: (event: {
      state: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
      device?: BluetoothDeviceInfo;
    }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'btProfileStatusChanged',
    listenerFunc: (status: BluetoothStatusInfo) => void
  ): Promise<PluginListenerHandle>;
}

export const BluetoothHid = registerPlugin<BluetoothHidPluginInterface>('BluetoothHid');

// Standard USB/Bluetooth HID Modifier Bitmasks
export const HID_MOD = {
  NONE: 0x00,
  LCTRL: 0x01,
  LSHIFT: 0x02,
  LALT: 0x04,
  LGUI: 0x08,
  RCTRL: 0x10,
  RSHIFT: 0x20,
  RALT: 0x40,
  RGUI: 0x80,
} as const;

// Standard USB/Bluetooth HID Keyboard Usage IDs (Usage Page 0x07)
export const HID_KEY = {
  A: 0x04,
  B: 0x05,
  C: 0x06,
  D: 0x07,
  E: 0x08,
  F: 0x09,
  G: 0x0a,
  H: 0x0b,
  I: 0x0c,
  J: 0x0d,
  K: 0x0e,
  L: 0x0f,
  M: 0x10,
  N: 0x11,
  O: 0x12,
  P: 0x13,
  Q: 0x14,
  R: 0x15,
  S: 0x16,
  T: 0x17,
  U: 0x18,
  V: 0x19,
  W: 0x1a,
  X: 0x1b,
  Y: 0x1c,
  Z: 0x1d,
  NUM_1: 0x1e,
  NUM_2: 0x1f,
  NUM_3: 0x20,
  NUM_4: 0x21,
  NUM_5: 0x22,
  NUM_6: 0x23,
  NUM_7: 0x24,
  NUM_8: 0x25,
  NUM_9: 0x26,
  NUM_0: 0x27,
  ENTER: 0x28,
  ESCAPE: 0x29,
  BACKSPACE: 0x2a,
  TAB: 0x2b,
  SPACE: 0x2c,
  MINUS: 0x2d,
  EQUAL: 0x2e,
  LEFT_BRACKET: 0x2f,
  RIGHT_BRACKET: 0x30,
  BACKSLASH: 0x31,
  SEMICOLON: 0x33,
  APOSTROPHE: 0x34,
  GRAVE: 0x35,
  COMMA: 0x36,
  PERIOD: 0x37,
  SLASH: 0x38,
  CAPS_LOCK: 0x39,
  F1: 0x3a,
  F2: 0x3b,
  F3: 0x3c,
  F4: 0x3d,
  F5: 0x3e,
  F6: 0x3f,
  F7: 0x40,
  F8: 0x41,
  F9: 0x42,
  F10: 0x43,
  F11: 0x44,
  F12: 0x45,
  HOME: 0x4a,
  PAGE_UP: 0x4b,
  DELETE: 0x4c,
  END: 0x4d,
  PAGE_DOWN: 0x4e,
  RIGHT: 0x4f,
  LEFT: 0x50,
  DOWN: 0x51,
  UP: 0x52,
} as const;

// Standard USB/Bluetooth Consumer Page (0x0C) Usage IDs for Smart TVs
export const CONSUMER_USAGE = {
  POWER: 0x0030,
  MENU: 0x0040,
  CHANNEL_UP: 0x009c,
  CHANNEL_DOWN: 0x009d,
  FAST_FORWARD: 0x00b3,
  REWIND: 0x00b4,
  NEXT_TRACK: 0x00b5,
  PREV_TRACK: 0x00b6,
  STOP: 0x00b7,
  PLAY_PAUSE: 0x00cd,
  MUTE: 0x00e2,
  VOLUME_UP: 0x00e9,
  VOLUME_DOWN: 0x00ea,
  SEARCH: 0x0221,
  HOME: 0x0223,
  BACK: 0x0224,
} as const;
