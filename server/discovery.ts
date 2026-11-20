import dgram from 'node:dgram';
import os from 'node:os';
import type { DiscoveredTvDevice, TvManufacturer } from '../src/types/tv.ts';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;

const SSDP_SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:dial-multiscreen-org:service:dial:1',
  'urn:samsung.com:device:RemoteControlReceiver:1',
  'ssdp:all',
];

const MDNS_SERVICE_QUERIES = [
  '_googlecast._tcp.local',
  '_airplay._tcp.local',
  '_samsung-tv._tcp.local',
];

function extractXmlTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function inferManufacturer(rawText: string): TvManufacturer {
  const lower = rawText.toLowerCase();
  if (lower.includes('samsung') || lower.includes('tizen')) return 'Samsung';
  if (lower.includes('lg') || lower.includes('webos')) return 'LG';
  if (lower.includes('sony') || lower.includes('bravia')) return 'Sony';
  if (lower.includes('tcl') || lower.includes('semp')) return 'TCL';
  if (lower.includes('philips') || lower.includes('tpvision')) return 'Philips';
  if (lower.includes('roku')) return 'Roku';
  return 'Outra TV';
}

function parseSsdpHeaders(rawMessage: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = rawMessage.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const colon = lines[i].indexOf(':');
    if (colon === -1) continue;
    const key = lines[i].slice(0, colon).trim().toLowerCase();
    const val = lines[i].slice(colon + 1).trim();
    if (key) headers[key] = val;
  }
  return headers;
}

function extractAvTransportControlUrl(xml: string, baseUrl: string): string | undefined {
  const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) ?? [];
  for (const block of serviceBlocks) {
    if (/AVTransport/i.test(block)) {
      const controlUrl = extractXmlTag(block, 'controlURL');
      if (controlUrl) {
        try {
          return new URL(controlUrl, baseUrl).toString();
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function encodeDnsName(domain: string): Buffer {
  const parts = domain.split('.').filter(Boolean);
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const buf = Buffer.from(part, 'utf8');
    chunks.push(Buffer.from([buf.length]), buf);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function buildMdnsPtrQuery(serviceName: string): Buffer {
  // Standard DNS header (12 bytes): ID=0, Flags=0, QDCOUNT=1
  const header = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const qname = encodeDnsName(serviceName);
  // QTYPE = PTR (12), QCLASS = IN (1)
  const footer = Buffer.from([0x00, 0x0c, 0x00, 0x01]);
  return Buffer.concat([header, qname, footer]);
}

function extractPrintableAsciiTokens(buf: Buffer): string {
  return buf
    .toString('latin1')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getLocalIpv4Subnets(): string[] {
  const interfaces = os.networkInterfaces();
  const subnets: string[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        subnets.push(`${info.address} (${name})`);
      }
    }
  }
  return subnets;
}

export function getPrimaryLanIpv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal && isPrivateLanIpv4(info.address)) {
        return info.address;
      }
    }
  }
  return null;
}

export function isPrivateLanIpv4(ip: string): boolean {
  const parts = ip.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 1400
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function enrichSsdpLocation(
  ip: string,
  locationUrl: string,
  serverHeader: string,
  stHeader: string
): Promise<DiscoveredTvDevice | null> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(locationUrl, {}, 1400);
    if (!res.ok) return null;
    const xml = await res.text();
    const friendlyName = extractXmlTag(xml, 'friendlyName');
    const manufacturerRaw = extractXmlTag(xml, 'manufacturer') ?? serverHeader;
    const modelName =
      extractXmlTag(xml, 'modelName') ?? extractXmlTag(xml, 'modelDescription') ?? 'Smart TV';
    const deviceType = extractXmlTag(xml, 'deviceType') ?? stHeader;
    const avTransportUrl = extractAvTransportControlUrl(xml, locationUrl);

    const combinedText = `${friendlyName ?? ''} ${manufacturerRaw} ${modelName} ${serverHeader} ${deviceType}`;
    const isMediaOrTv =
      Boolean(avTransportUrl) ||
      /mediarenderer|tv|bravia|samsung|lg|webos|roku|dial|chromecast|philips|tcl|hisense/i.test(
        combinedText
      );

    if (!isMediaOrTv) {
      return null;
    }

    const protocols: string[] = [];
    if (avTransportUrl || /mediarenderer/i.test(deviceType)) {
      protocols.push('DLNA / UPnP');
    }
    if (/dial/i.test(stHeader) || /dial/i.test(xml)) {
      protocols.push('DIAL Cast');
    }
    if (/samsung/i.test(combinedText)) {
      protocols.push('Miracast / Smart View');
    } else if (/lg|webos/i.test(combinedText)) {
      protocols.push('Miracast / Screen Share');
    } else if (/sony|bravia/i.test(combinedText)) {
      protocols.push('Google Cast / Miracast');
    }
    if (protocols.length === 0) {
      protocols.push('UPnP Wi-Fi');
    }

    return {
      id: `ssdp:${ip}:${new URL(locationUrl).port || '80'}`,
      name: friendlyName || `${inferManufacturer(combinedText)} ${modelName}`,
      manufacturer: inferManufacturer(combinedText),
      model: modelName,
      source: 'ssdp_dlna',
      protocols,
      ip,
      avTransportUrl,
      locationUrl,
      online: true,
      latencyMs: Date.now() - started,
      lastSeenAt: Date.now(),
    };
  } catch {
    if (/mediarenderer|dial|samsung|bravia|roku/i.test(`${stHeader} ${serverHeader}`)) {
      const mfg = inferManufacturer(`${serverHeader} ${stHeader}`);
      return {
        id: `ssdp:${ip}`,
        name: `${mfg} Smart TV (${ip})`,
        manufacturer: mfg,
        model: serverHeader.slice(0, 48) || 'Smart TV DLNA',
        source: 'ssdp_dlna',
        protocols: ['DLNA / UPnP'],
        ip,
        locationUrl,
        online: true,
        lastSeenAt: Date.now(),
      };
    }
    return null;
  }
}

async function runMdnsLanScan(timeoutMs = 1500): Promise<{
  devices: DiscoveredTvDevice[];
  mdnsSupported: boolean;
  mdnsResponses: number;
}> {
  let mdnsSupported = true;
  let mdnsResponses = 0;
  const byIp = new Map<string, DiscoveredTvDevice>();

  await new Promise<void>((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        socket.close();
      } catch {
        // Ignore already closed
      }
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on('error', () => {
      mdnsSupported = false;
      clearTimeout(timer);
      finish();
    });

    socket.on('message', (msg, rinfo) => {
      // Ignore query packets (QR bit = 0)
      if (msg.length < 12 || (msg[2] & 0x80) === 0) return;
      mdnsResponses += 1;

      const text = extractPrintableAsciiTokens(msg);
      const isCast = /_googlecast/i.test(text);
      const isAirplay = /_airplay/i.test(text);
      const isSamsung = /samsung/i.test(text);

      if (!isCast && !isAirplay && !isSamsung) return;

      const fnMatch = text.match(/fn=([^=]{2,40})/);
      const mdMatch = text.match(/md=([^=]{2,40})/);
      const mfg = inferManufacturer(text);
      const protocols: string[] = [];
      if (isCast) protocols.push('Google Cast');
      if (isAirplay) protocols.push('AirPlay 2');
      if (isSamsung) protocols.push('Samsung Wi-Fi');

      byIp.set(rinfo.address, {
        id: `mdns:${rinfo.address}`,
        name: fnMatch?.[1]?.trim() || `${mfg} Smart TV (${rinfo.address})`,
        manufacturer: mfg,
        model: mdMatch?.[1]?.trim() || (isCast ? 'Google Cast TV' : 'AirPlay 2 TV'),
        source: 'mdns_cast',
        protocols,
        ip: rinfo.address,
        online: true,
        lastSeenAt: Date.now(),
      });
    });

    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(2);
      } catch {
        // Container restriction
      }
      for (const query of MDNS_SERVICE_QUERIES) {
        const packet = buildMdnsPtrQuery(query);
        socket.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS, () => {});
      }
    });
  });

  return {
    devices: Array.from(byIp.values()),
    mdnsSupported,
    mdnsResponses,
  };
}

export async function runLanDiscoveryScan(timeoutMs = 1800): Promise<{
  devices: DiscoveredTvDevice[];
  ssdpSupported: boolean;
  mdnsSupported: boolean;
  ssdpResponses: number;
  mdnsResponses: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  const discoveredByLocation = new Map<
    string,
    { ip: string; location: string; server: string; st: string }
  >();
  let ssdpResponses = 0;
  let ssdpSupported = true;

  const ssdpPromise = new Promise<void>((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        socket.close();
      } catch {
        // Ignore already closed socket
      }
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);

    socket.on('error', () => {
      ssdpSupported = false;
      clearTimeout(timer);
      finish();
    });

    socket.on('message', (msg, rinfo) => {
      ssdpResponses += 1;
      const headers = parseSsdpHeaders(msg.toString('utf8'));
      const location = headers['location'];
      if (!location) return;
      if (!discoveredByLocation.has(location)) {
        discoveredByLocation.set(location, {
          ip: rinfo.address,
          location,
          server: headers['server'] ?? '',
          st: headers['st'] ?? '',
        });
      }
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch {
        // Multicast options may be restricted in sandboxed containers
      }

      for (const st of SSDP_SEARCH_TARGETS) {
        const payload = Buffer.from(
          [
            'M-SEARCH * HTTP/1.1',
            `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
            'MAN: "ssdp:discover"',
            'MX: 2',
            `ST: ${st}`,
            'USER-AGENT: TelaLivre/1.0 UPnP/1.1',
            '',
            '',
          ].join('\r\n')
        );
        socket.send(payload, 0, payload.length, SSDP_PORT, SSDP_ADDRESS, () => {});
      }
    });
  });

  const [, mdnsResult] = await Promise.all([ssdpPromise, runMdnsLanScan(timeoutMs - 200)]);

  const enrichedResults = await Promise.all(
    Array.from(discoveredByLocation.values()).map((entry) =>
      enrichSsdpLocation(entry.ip, entry.location, entry.server, entry.st)
    )
  );

  const uniqueByIp = new Map<string, DiscoveredTvDevice>();
  for (const dev of [...enrichedResults, ...mdnsResult.devices]) {
    if (!dev) continue;
    const key = dev.ip ?? dev.id;
    const existing = uniqueByIp.get(key);
    if (!existing) {
      uniqueByIp.set(key, dev);
    } else {
      const mergedProtocols = Array.from(new Set([...existing.protocols, ...dev.protocols]));
      uniqueByIp.set(key, {
        ...existing,
        protocols: mergedProtocols,
        avTransportUrl: existing.avTransportUrl ?? dev.avTransportUrl,
      });
    }
  }

  return {
    devices: Array.from(uniqueByIp.values()),
    ssdpSupported,
    mdnsSupported: mdnsResult.mdnsSupported,
    ssdpResponses,
    mdnsResponses: mdnsResult.mdnsResponses,
    durationMs: Date.now() - startedAt,
  };
}

export async function probeSmartTvByIp(rawIp: string): Promise<DiscoveredTvDevice | null> {
  const ip = rawIp.trim();
  if (!isPrivateLanIpv4(ip)) {
    throw new Error(
      'Informe um endereço IP privado válido da sua rede Wi-Fi (ex.: 192.168.1.25 ou 10.0.0.15).'
    );
  }

  const started = Date.now();

  // 1. Samsung Smart TV REST API (Tizen :8001/api/v2/)
  try {
    const res = await fetchWithTimeout(`http://${ip}:8001/api/v2/`, {}, 1300);
    if (res.ok) {
      const data = (await res.json()) as {
        name?: string;
        device?: { name?: string; modelName?: string; os?: string };
      };
      const tvName = data.device?.name || data.name || `Samsung Smart TV (${ip})`;
      const model = data.device?.modelName || data.device?.os || 'Tizen Smart TV';
      return {
        id: `probe:samsung:${ip}`,
        name: tvName,
        manufacturer: 'Samsung',
        model,
        source: 'ip_probe',
        protocols: ['Samsung SmartView', 'DLNA / UPnP', 'Miracast'],
        ip,
        online: true,
        latencyMs: Date.now() - started,
        lastSeenAt: Date.now(),
      };
    }
  } catch {
    // Next protocol
  }

  // 2. Roku TV / Roku Express ECP (:8060/query/device-info)
  try {
    const res = await fetchWithTimeout(`http://${ip}:8060/query/device-info`, {}, 1300);
    if (res.ok) {
      const xml = await res.text();
      const friendlyName =
        extractXmlTag(xml, 'friendly-device-name') ||
        extractXmlTag(xml, 'user-device-name') ||
        `Roku TV (${ip})`;
      const model = extractXmlTag(xml, 'model-name') || 'Roku OS';
      return {
        id: `probe:roku:${ip}`,
        name: friendlyName,
        manufacturer: 'Roku',
        model,
        source: 'ip_probe',
        protocols: ['Roku ECP', 'Miracast', 'AirPlay 2'],
        ip,
        online: true,
        latencyMs: Date.now() - started,
        lastSeenAt: Date.now(),
      };
    }
  } catch {
    // Next protocol
  }

  // 3. Sony Bravia JSON-RPC (/sony/system)
  try {
    const res = await fetchWithTimeout(
      `http://${ip}/sony/system`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'getInterfaceInformation',
          id: 1,
          params: [],
          version: '1.0',
        }),
      },
      1300
    );
    if (res.ok) {
      const data = (await res.json()) as {
        result?: { modelName?: string; productName?: string }[];
      };
      const info = data.result?.[0];
      return {
        id: `probe:sony:${ip}`,
        name: info?.productName || `Sony Bravia (${ip})`,
        manufacturer: 'Sony',
        model: info?.modelName || 'BRAVIA Android TV',
        source: 'ip_probe',
        protocols: ['Sony Bravia', 'DLNA / UPnP', 'Google Cast'],
        ip,
        online: true,
        latencyMs: Date.now() - started,
        lastSeenAt: Date.now(),
      };
    }
  } catch {
    // Next protocol
  }

  // 4. Common DLNA MediaRenderer XML endpoints
  const dlnaCandidates = [
    `http://${ip}:9197/dmr`,
    `http://${ip}:7676/smp_2_`,
    `http://${ip}:52323/dmr.xml`,
    `http://${ip}:1990/desc.xml`,
  ];

  for (const candidateUrl of dlnaCandidates) {
    const dev = await enrichSsdpLocation(
      ip,
      candidateUrl,
      '',
      'urn:schemas-upnp-org:device:MediaRenderer:1'
    );
    if (dev) {
      dev.source = 'ip_probe';
      return dev;
    }
  }

  // 5. LG webOS port check (:3000)
  try {
    const res = await fetchWithTimeout(`http://${ip}:3000/`, {}, 1200);
    if (res.status > 0) {
      return {
        id: `probe:lg:${ip}`,
        name: `LG Smart TV (${ip})`,
        manufacturer: 'LG',
        model: 'webOS Smart TV',
        source: 'ip_probe',
        protocols: ['LG webOS', 'DLNA / UPnP', 'Miracast'],
        ip,
        online: true,
        latencyMs: Date.now() - started,
        lastSeenAt: Date.now(),
      };
    }
  } catch {
    // Not reachable
  }

  return null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function sendDlnaAvTransportCast(
  avTransportUrl: string,
  mediaUrl: string,
  title: string,
  mimeType = 'video/mp4'
): Promise<void> {
  const parsed = new URL(avTransportUrl);
  if (!isPrivateLanIpv4(parsed.hostname)) {
    throw new Error('URL DLNA precisa apontar para um dispositivo na rede Wi-Fi local.');
  }

  const isImage = mimeType.startsWith('image/');
  const upnpClass = isImage ? 'object.item.imageItem.photo' : 'object.item.videoItem';

  const didlMetadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>${upnpClass}</upnp:class><res protocolInfo="http-get:*:${escapeXml(mimeType)}:*">${escapeXml(mediaUrl)}</res></item></DIDL-Lite>`;

  const setUriBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <CurrentURI>${escapeXml(mediaUrl)}</CurrentURI>
      <CurrentURIMetaData>${escapeXml(didlMetadata)}</CurrentURIMetaData>
    </u:SetAVTransportURI>
  </s:Body>
</s:Envelope>`;

  const setRes = await fetchWithTimeout(
    avTransportUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
      },
      body: setUriBody,
    },
    3000
  );

  if (!setRes.ok) {
    throw new Error(`A TV DLNA recusou a mídia (HTTP ${setRes.status}).`);
  }

  const playBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>
    </u:Play>
  </s:Body>
</s:Envelope>`;

  const playRes = await fetchWithTimeout(
    avTransportUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#Play"',
      },
      body: playBody,
    },
    3000
  );

  if (!playRes.ok) {
    throw new Error(`Falha ao iniciar reprodução DLNA (HTTP ${playRes.status}).`);
  }
}
