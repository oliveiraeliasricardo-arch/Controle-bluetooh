import { Capacitor } from '@capacitor/core';

const DEFAULT_REMOTE_SERVER =
  'https://ais-pre-bsenbaddie3wmm2cegwg2h-685645412545.us-east1.run.app';

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getBackendHttpOrigin(): string {
  const envOrigin = (import.meta.env?.VITE_SERVER_URL as string | undefined)?.trim();
  if (envOrigin) {
    return envOrigin.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined') {
    return '';
  }

  if (isNativeApp()) {
    const saved = window.localStorage.getItem('telalivre_server_url')?.trim();
    if (saved) {
      return saved.replace(/\/+$/, '');
    }
    return DEFAULT_REMOTE_SERVER;
  }

  return '';
}

export function getApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = getBackendHttpOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}

export function getWebSocketUrl(): string {
  const origin = getBackendHttpOrigin();
  if (origin) {
    try {
      const parsed = new URL(origin);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}/ws`;
    } catch {
      // Fallback below
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
