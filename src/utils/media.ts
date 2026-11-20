export function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const candidate = url.pathname.split('/').filter(Boolean)[0];
      return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }

    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const markerIndex = segments.findIndex((seg) =>
        ['embed', 'shorts', 'live', 'v'].includes(seg)
      );
      if (markerIndex !== -1) {
        const candidate = segments[markerIndex + 1];
        return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function detectDefaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Celular';
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/SM-|Samsung/i.test(ua)) return 'Samsung Galaxy';
  if (/Moto|Motorola/i.test(ua)) return 'Motorola';
  if (/Xiaomi|Redmi|POCO|Mi /i.test(ua)) return 'Xiaomi';
  if (/Android/i.test(ua)) return 'Celular Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Computador';
  return 'Meu dispositivo';
}

export function optimizePhotoForTv(file: File, maxDimension = 1920): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem.'));
    reader.onload = () => {
      const sourceUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida ou corrompida.'));
      img.onload = () => {
        const { width, height } = img;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(sourceUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const compressed = canvas.toDataURL('image/jpeg', 0.86);
        resolve(compressed);
      };
      img.src = sourceUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
