import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  getLocalIpv4Subnets,
  getPrimaryLanIpv4,
  probeSmartTvByIp,
  runLanDiscoveryScan,
  sendDlnaAvTransportCast,
} from './server/discovery.ts';
import type {
  CastPhoto,
  ClientToServerEvent,
  ConnectedController,
  DiscoveredTvDevice,
  DiscoveryScanSummary,
  PendingConnectionRequest,
  ServerToClientEvent,
  TvManufacturer,
  TvRoomState,
} from './src/types/tv.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface InternalController {
  id: string;
  deviceName: string;
  joinedAt: number;
  ws: WebSocket;
}

interface InternalPendingRequest extends PendingConnectionRequest {
  ws: WebSocket;
}

interface InternalTvSession {
  tvId: string;
  tvWs: WebSocket | null;
  tvClientId: string | null;
  controllers: Map<string, InternalController>;
  pendingRequests: Map<string, InternalPendingRequest>;
  state: TvRoomState;
  lastActivityAt: number;
}

interface ClientSession {
  id: string;
  role: 'tv' | 'controller' | null;
  tvId: string | null;
}

interface HostedDlnaMedia {
  buffer: Buffer;
  mimeType: string;
  createdAt: number;
}

const tvSessions = new Map<string, InternalTvSession>();
const lanDiscoveredDevices = new Map<string, DiscoveredTvDevice>();
const hostedDlnaMedia = new Map<string, HostedDlnaMedia>();
const allSockets = new Set<WebSocket>();
const sessions = new WeakMap<WebSocket, ClientSession>();

const ALLOWED_BRANDS: TvManufacturer[] = [
  'Samsung',
  'LG',
  'Sony',
  'TCL',
  'Philips',
  'Roku',
  'Outra TV',
];

function sanitizeBrand(raw?: string): TvManufacturer {
  if (raw && ALLOWED_BRANDS.includes(raw as TvManufacturer)) {
    return raw as TvManufacturer;
  }
  return 'Samsung';
}

function serializeControllers(room: InternalTvSession): ConnectedController[] {
  return Array.from(room.controllers.values()).map(({ id, deviceName, joinedAt }) => ({
    id,
    deviceName,
    joinedAt,
  }));
}

function serializePending(room: InternalTvSession): PendingConnectionRequest[] {
  return Array.from(room.pendingRequests.values()).map(
    ({ controllerId, deviceName, requestedAt }) => ({
      controllerId,
      deviceName,
      requestedAt,
    })
  );
}

function syncRoomSnapshot(room: InternalTvSession): TvRoomState {
  room.state.tvConnected = room.tvWs !== null && room.tvWs.readyState === WebSocket.OPEN;
  room.state.controllers = serializeControllers(room);
  room.state.pendingRequests = serializePending(room);
  room.state.updatedAt = Date.now();
  room.lastActivityAt = Date.now();
  return room.state;
}

function sendJson(ws: WebSocket | null | undefined, payload: ServerToClientEvent): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function broadcastRoomState(room: InternalTvSession): void {
  const snapshot = syncRoomSnapshot(room);
  const message: ServerToClientEvent = { type: 'room:state', state: snapshot };
  sendJson(room.tvWs, message);
  for (const controller of room.controllers.values()) {
    sendJson(controller.ws, message);
  }
}

function buildCombinedDiscoveryList(): DiscoveredTvDevice[] {
  const result: DiscoveredTvDevice[] = [];

  for (const room of tvSessions.values()) {
    const isOnline = room.tvWs !== null && room.tvWs.readyState === WebSocket.OPEN;
    if (!isOnline) continue;

    result.push({
      id: `tv:${room.tvId}`,
      name: room.state.tvName,
      manufacturer: room.state.tvBrand,
      model: room.state.tvModel,
      source: 'telalivre_tv',
      protocols: ['Espelhamento Wi-Fi Direto', 'WebRTC Baixa Latência'],
      tvId: room.tvId,
      autoAccept: room.state.autoAccept,
      online: true,
      controllersCount: room.controllers.size,
      lastSeenAt: room.lastActivityAt,
    });
  }

  for (const device of lanDiscoveredDevices.values()) {
    result.push(device);
  }

  return result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function broadcastDiscoveryList(): void {
  const devices = buildCombinedDiscoveryList();
  const payload: ServerToClientEvent = { type: 'discovery:list', devices };
  for (const client of allSockets) {
    sendJson(client, payload);
  }
}

function createInitialState(
  tvId: string,
  tvName?: string,
  tvBrand?: TvManufacturer,
  tvModel?: string,
  autoAccept = true
): TvRoomState {
  const brand = sanitizeBrand(tvBrand);
  return {
    tvId,
    tvName: (tvName || `${brand} Smart TV — Sala`).trim().slice(0, 60),
    tvBrand: brand,
    tvModel: (tvModel || `Smart TV ${brand} Wi-Fi`).trim().slice(0, 60),
    tvConnected: true,
    autoAccept,
    pendingRequests: [],
    mode: 'idle',
    photos: [],
    activePhotoIndex: 0,
    youtube: null,
    message: null,
    display: {
      dimmed: false,
      zoom: 1,
      fitMode: 'contain',
    },
    webrtcActive: false,
    webrtcSource: null,
    webrtcPreset: 'low_latency',
    webrtcControllerId: null,
    controllers: [],
    updatedAt: Date.now(),
  };
}

function cleanupStaleResources(): void {
  const now = Date.now();
  const maxIdleMs = 1000 * 60 * 60;
  let removed = false;

  for (const [tvId, room] of tvSessions.entries()) {
    const hasTv = room.tvWs !== null && room.tvWs.readyState === WebSocket.OPEN;
    const hasControllers = room.controllers.size > 0;
    if (!hasTv && !hasControllers && now - room.lastActivityAt > maxIdleMs) {
      tvSessions.delete(tvId);
      removed = true;
    }
  }

  for (const [mediaId, item] of hostedDlnaMedia.entries()) {
    if (now - item.createdAt > 1000 * 60 * 30) {
      hostedDlnaMedia.delete(mediaId);
    }
  }

  if (removed) {
    broadcastDiscoveryList();
  }
}

setInterval(cleanupStaleResources, 1000 * 60 * 5);

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/ping', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, serverTime: Date.now() });
  });

  app.get('/api/network-info', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const forwardedFor = req.headers['x-forwarded-for'];
    const rawIp =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim()
        : req.socket.remoteAddress ?? null;
    const protoHeader = req.headers['x-forwarded-proto'];
    const protocol =
      typeof protoHeader === 'string' ? protoHeader.split(',')[0]?.trim() : req.protocol;

    res.json({
      ok: true,
      serverTime: Date.now(),
      protocol,
      secureContextHint: protocol === 'https' || req.hostname === 'localhost',
      clientAddress: rawIp,
      activeTvs: tvSessions.size,
      localSubnets: getLocalIpv4Subnets(),
      websocketPath: '/ws',
    });
  });

  app.get('/api/discovery/devices', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      localSubnets: getLocalIpv4Subnets(),
      devices: buildCombinedDiscoveryList(),
    });
  });

  app.post('/api/discovery/scan', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const localSubnets = getLocalIpv4Subnets();
    const scanResult = await runLanDiscoveryScan(1800);

    for (const dev of scanResult.devices) {
      lanDiscoveredDevices.set(dev.id, dev);
    }

    const combined = buildCombinedDiscoveryList();
    broadcastDiscoveryList();

    const summary: DiscoveryScanSummary = {
      scannedAt: Date.now(),
      durationMs: scanResult.durationMs,
      ssdpSupported: scanResult.ssdpSupported,
      mdnsSupported: scanResult.mdnsSupported,
      localSubnets,
      ssdpResponses: scanResult.ssdpResponses,
      mdnsResponses: scanResult.mdnsResponses,
      devices: combined,
      note:
        scanResult.devices.length === 0
          ? 'Nenhuma TV física respondeu a SSDP/DLNA ou mDNS nesta interface de rede. Use o botão de espelhamento nativo do seu dispositivo (Miracast / AirPlay / Cast) acima ou abra o Receptor TV na sua televisão para conexão direta com um toque.'
          : undefined,
    };

    res.json(summary);
  });

  app.post('/api/discovery/probe', async (req, res) => {
    const rawIp = typeof req.body?.ip === 'string' ? req.body.ip : '';
    try {
      const found = await probeSmartTvByIp(rawIp);
      if (!found) {
        res.status(404).json({
          ok: false,
          message:
            'Nenhuma Smart TV Samsung, LG, Sony, Roku ou DLNA respondeu nesse IP. Confirme se a TV está ligada na mesma rede Wi-Fi.',
        });
        return;
      }
      lanDiscoveredDevices.set(found.id, found);
      broadcastDiscoveryList();
      res.json({
        ok: true,
        device: found,
        devices: buildCombinedDiscoveryList(),
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        message: err instanceof Error ? err.message : 'Endereço IP inválido.',
      });
    }
  });

  // Temporary media endpoint so physical DLNA TVs on LAN can pull images sent directly from the phone
  app.get('/api/dlna/media/:id', (req, res) => {
    const item = hostedDlnaMedia.get(req.params.id);
    if (!item) {
      res.status(404).send('Mídia expirada.');
      return;
    }
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('Content-Length', String(item.buffer.length));
    res.send(item.buffer);
  });

  app.post('/api/dlna/cast', async (req, res) => {
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : '';
    const mediaUrl = typeof req.body?.mediaUrl === 'string' ? req.body.mediaUrl.trim() : '';
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : 'Mídia TelaLivre';

    const device = lanDiscoveredDevices.get(deviceId);
    if (!device || !device.avTransportUrl) {
      res.status(400).json({
        ok: false,
        message: 'Esta TV não anunciou um serviço DLNA AVTransport ativo para reprodução direta.',
      });
      return;
    }

    let resolvedMediaUrl = mediaUrl;
    let mimeType = 'video/mp4';

    if (dataUrl.startsWith('data:image/')) {
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ ok: false, message: 'Formato de imagem inválido.' });
        return;
      }
      mimeType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const mediaId = crypto.randomUUID();
      hostedDlnaMedia.set(mediaId, { buffer, mimeType, createdAt: Date.now() });
      const lanIp = getPrimaryLanIpv4();
      if (!lanIp) {
        res.status(400).json({
          ok: false,
          message: 'Servidor sem IP local LAN acessível pela TV DLNA.',
        });
        return;
      }
      resolvedMediaUrl = `http://${lanIp}:${PORT}/api/dlna/media/${mediaId}`;
    } else if (!/^https?:\/\//i.test(resolvedMediaUrl)) {
      res.status(400).json({
        ok: false,
        message: 'Informe uma URL direta HTTP/HTTPS de vídeo ou imagem para enviar via DLNA.',
      });
      return;
    }

    try {
      await sendDlnaAvTransportCast(
        device.avTransportUrl,
        resolvedMediaUrl,
        title || 'Mídia TelaLivre',
        mimeType
      );
      res.json({ ok: true, message: `Transmissão DLNA iniciada em ${device.name}.` });
    } catch (err) {
      res.status(502).json({
        ok: false,
        message: err instanceof Error ? err.message : 'Falha ao enviar mídia via DLNA.',
      });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 8 * 1024 * 1024,
  });

  wss.on('connection', (ws) => {
    allSockets.add(ws);
    const clientId = crypto.randomUUID();
    const session: ClientSession = {
      id: clientId,
      role: null,
      tvId: null,
    };
    sessions.set(ws, session);
    sendJson(ws, { type: 'connected', clientId });
    sendJson(ws, { type: 'discovery:list', devices: buildCombinedDiscoveryList() });

    ws.on('message', (rawData) => {
      let event: ClientToServerEvent;
      try {
        event = JSON.parse(rawData.toString()) as ClientToServerEvent;
      } catch {
        sendJson(ws, { type: 'room:error', message: 'Mensagem inválida recebida pelo servidor.' });
        return;
      }

      handleWsEvent(ws, session, event);
    });

    ws.on('close', () => {
      allSockets.delete(ws);
      detachClient(ws, session);
    });

    ws.on('error', () => {
      allSockets.delete(ws);
      detachClient(ws, session);
    });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          } else if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build não encontrado.');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TelaLivre servidor ativo na porta ${PORT}`);
  });
}

function detachClient(ws: WebSocket, session: ClientSession): void {
  if (!session.tvId) {
    return;
  }
  const room = tvSessions.get(session.tvId);
  if (!room) {
    session.tvId = null;
    session.role = null;
    return;
  }

  const wasTv = session.role === 'tv' && room.tvWs === ws;

  if (wasTv) {
    room.tvWs = null;
    room.tvClientId = null;
    for (const pending of room.pendingRequests.values()) {
      sendJson(pending.ws, {
        type: 'controller:rejected',
        tvId: room.tvId,
        message: `${room.state.tvName} ficou indisponível.`,
      });
    }
    room.pendingRequests.clear();

    if (room.state.webrtcActive) {
      room.state.webrtcActive = false;
      room.state.webrtcSource = null;
      room.state.webrtcControllerId = null;
      if (room.state.mode === 'webrtc') {
        room.state.mode = 'idle';
      }
      for (const controller of room.controllers.values()) {
        sendJson(controller.ws, { type: 'webrtc:stop' });
      }
    }
    broadcastRoomState(room);
    broadcastDiscoveryList();
  } else if (session.role === 'controller') {
    room.controllers.delete(session.id);
    room.pendingRequests.delete(session.id);
    if (room.state.webrtcControllerId === session.id) {
      room.state.webrtcActive = false;
      room.state.webrtcSource = null;
      room.state.webrtcControllerId = null;
      if (room.state.mode === 'webrtc') {
        room.state.mode = 'idle';
      }
      sendJson(room.tvWs, { type: 'webrtc:stop' });
    }
    broadcastRoomState(room);
    broadcastDiscoveryList();
  }

  session.tvId = null;
  session.role = null;
}

function handleWsEvent(ws: WebSocket, session: ClientSession, event: ClientToServerEvent): void {
  if (event.type === 'discovery:request') {
    sendJson(ws, { type: 'discovery:list', devices: buildCombinedDiscoveryList() });
    return;
  }

  if (event.type === 'tv:register') {
    detachClient(ws, session);

    const preferredId =
      event.preferredTvId && /^[a-zA-Z0-9_-]{6,64}$/.test(event.preferredTvId)
        ? event.preferredTvId
        : null;

    let room: InternalTvSession | undefined;
    if (preferredId) {
      const existing = tvSessions.get(preferredId);
      if (existing && (!existing.tvWs || existing.tvWs.readyState !== WebSocket.OPEN)) {
        room = existing;
        room.tvWs = ws;
        room.tvClientId = session.id;
        if (event.tvName) room.state.tvName = event.tvName.trim().slice(0, 60);
        if (event.tvBrand) room.state.tvBrand = sanitizeBrand(event.tvBrand);
        if (event.tvModel) room.state.tvModel = event.tvModel.trim().slice(0, 60);
        if (typeof event.autoAccept === 'boolean') room.state.autoAccept = event.autoAccept;
      } else if (!existing) {
        room = {
          tvId: preferredId,
          tvWs: ws,
          tvClientId: session.id,
          controllers: new Map(),
          pendingRequests: new Map(),
          state: createInitialState(
            preferredId,
            event.tvName,
            event.tvBrand,
            event.tvModel,
            event.autoAccept ?? true
          ),
          lastActivityAt: Date.now(),
        };
        tvSessions.set(preferredId, room);
      }
    }

    if (!room) {
      const tvId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      room = {
        tvId,
        tvWs: ws,
        tvClientId: session.id,
        controllers: new Map(),
        pendingRequests: new Map(),
        state: createInitialState(
          tvId,
          event.tvName,
          event.tvBrand,
          event.tvModel,
          event.autoAccept ?? true
        ),
        lastActivityAt: Date.now(),
      };
      tvSessions.set(tvId, room);
    }

    session.role = 'tv';
    session.tvId = room.tvId;

    const snapshot = syncRoomSnapshot(room);
    sendJson(ws, { type: 'tv:registered', state: snapshot });
    broadcastRoomState(room);
    broadcastDiscoveryList();
    return;
  }

  if (event.type === 'tv:update_identity') {
    if (session.role !== 'tv' || !session.tvId) return;
    const room = tvSessions.get(session.tvId);
    if (!room) return;
    room.state.tvBrand = sanitizeBrand(event.tvBrand);
    room.state.tvName = event.tvName.trim().slice(0, 60) || `${room.state.tvBrand} Smart TV`;
    if (event.tvModel) {
      room.state.tvModel = event.tvModel.trim().slice(0, 60);
    }
    broadcastRoomState(room);
    broadcastDiscoveryList();
    return;
  }

  if (event.type === 'tv:set_auto_accept') {
    if (session.role !== 'tv' || !session.tvId) return;
    const room = tvSessions.get(session.tvId);
    if (!room) return;
    room.state.autoAccept = Boolean(event.autoAccept);
    broadcastRoomState(room);
    broadcastDiscoveryList();
    return;
  }

  if (event.type === 'tv:respond_request') {
    if (session.role !== 'tv' || !session.tvId) return;
    const room = tvSessions.get(session.tvId);
    if (!room) return;
    const pending = room.pendingRequests.get(event.controllerId);
    if (!pending) return;

    room.pendingRequests.delete(event.controllerId);

    if (!event.accept) {
      sendJson(pending.ws, {
        type: 'controller:rejected',
        tvId: room.tvId,
        message: `A conexão foi recusada na tela de ${room.state.tvName}.`,
      });
      broadcastRoomState(room);
      return;
    }

    room.controllers.set(pending.controllerId, {
      id: pending.controllerId,
      deviceName: pending.deviceName,
      joinedAt: Date.now(),
      ws: pending.ws,
    });
    const pendingSession = sessions.get(pending.ws);
    if (pendingSession) {
      pendingSession.role = 'controller';
      pendingSession.tvId = room.tvId;
    }

    const snapshot = syncRoomSnapshot(room);
    sendJson(pending.ws, {
      type: 'controller:connected',
      state: snapshot,
      clientId: pending.controllerId,
    });
    broadcastRoomState(room);
    broadcastDiscoveryList();
    return;
  }

  if (event.type === 'controller:connect') {
    const room = tvSessions.get(event.tvId);
    if (!room || !room.tvWs || room.tvWs.readyState !== WebSocket.OPEN) {
      sendJson(ws, {
        type: 'room:error',
        code: 'TV_OFFLINE',
        message: 'Esta Smart TV não está mais disponível na rede Wi-Fi.',
      });
      broadcastDiscoveryList();
      return;
    }

    detachClient(ws, session);
    const safeName = (event.deviceName || 'Celular').trim().slice(0, 40) || 'Celular';

    if (room.state.autoAccept) {
      room.controllers.set(session.id, {
        id: session.id,
        deviceName: safeName,
        joinedAt: Date.now(),
        ws,
      });
      session.role = 'controller';
      session.tvId = room.tvId;

      const snapshot = syncRoomSnapshot(room);
      sendJson(ws, {
        type: 'controller:connected',
        state: snapshot,
        clientId: session.id,
      });
      broadcastRoomState(room);
      broadcastDiscoveryList();
    } else {
      room.pendingRequests.set(session.id, {
        controllerId: session.id,
        deviceName: safeName,
        requestedAt: Date.now(),
        ws,
      });
      session.role = 'controller';
      session.tvId = room.tvId;

      sendJson(ws, {
        type: 'controller:pending',
        tvId: room.tvId,
        tvName: room.state.tvName,
      });
      broadcastRoomState(room);
    }
    return;
  }

  if (event.type === 'controller:disconnect') {
    detachClient(ws, session);
    return;
  }

  if (!session.tvId) {
    sendJson(ws, {
      type: 'room:error',
      code: 'NOT_CONNECTED',
      message: 'Selecione uma Smart TV antes de iniciar a transmissão.',
    });
    return;
  }

  const room = tvSessions.get(session.tvId);
  if (!room) {
    sendJson(ws, {
      type: 'room:error',
      code: 'TV_OFFLINE',
      message: 'A conexão com a Smart TV foi encerrada.',
    });
    return;
  }

  if (session.role === 'controller' && !room.controllers.has(session.id)) {
    sendJson(ws, {
      type: 'room:error',
      code: 'WAITING_APPROVAL',
      message: 'Aguardando permissão na tela da Smart TV.',
    });
    return;
  }

  switch (event.type) {
    case 'cast:add_photo': {
      const { id, name, dataUrl } = event.photo;
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        sendJson(ws, { type: 'room:error', message: 'Formato de imagem não suportado.' });
        return;
      }
      const existingIndex = room.state.photos.findIndex((p) => p.id === id);
      if (existingIndex !== -1) {
        room.state.activePhotoIndex = existingIndex;
        room.state.mode = 'photo';
        broadcastRoomState(room);
        return;
      }

      const nextPhoto: CastPhoto = {
        id,
        name: name.slice(0, 80) || 'Foto',
        dataUrl,
        rotation: 0,
        addedAt: Date.now(),
      };
      if (room.state.photos.length >= 15) {
        room.state.photos.shift();
      }
      room.state.photos.push(nextPhoto);
      room.state.activePhotoIndex = room.state.photos.length - 1;
      room.state.mode = 'photo';
      room.state.display.zoom = 1;
      if (room.state.webrtcActive) {
        stopRoomWebrtc(room);
      }
      broadcastRoomState(room);
      break;
    }

    case 'cast:select_photo': {
      if (room.state.photos.length === 0) return;
      const clamped = Math.max(0, Math.min(event.index, room.state.photos.length - 1));
      room.state.activePhotoIndex = clamped;
      room.state.mode = 'photo';
      room.state.display.zoom = 1;
      broadcastRoomState(room);
      break;
    }

    case 'cast:rotate_photo': {
      const photo = room.state.photos.find((p) => p.id === event.id);
      if (!photo) return;
      photo.rotation = (photo.rotation + 90) % 360;
      broadcastRoomState(room);
      break;
    }

    case 'cast:remove_photo': {
      const idx = room.state.photos.findIndex((p) => p.id === event.id);
      if (idx === -1) return;
      room.state.photos.splice(idx, 1);
      if (room.state.photos.length === 0) {
        room.state.activePhotoIndex = 0;
        if (room.state.mode === 'photo') {
          room.state.mode = 'idle';
        }
      } else {
        room.state.activePhotoIndex = Math.min(
          room.state.activePhotoIndex,
          room.state.photos.length - 1
        );
      }
      broadcastRoomState(room);
      break;
    }

    case 'cast:youtube': {
      const cleanId = event.videoId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
      if (!cleanId) {
        sendJson(ws, { type: 'room:error', message: 'Link do YouTube inválido.' });
        return;
      }
      if (room.state.webrtcActive) {
        stopRoomWebrtc(room);
      }
      room.state.youtube = {
        videoId: cleanId,
        title: (event.title || 'Vídeo do YouTube').slice(0, 100),
        isPlaying: true,
        muted: false,
        updatedAt: Date.now(),
      };
      room.state.mode = 'youtube';
      broadcastRoomState(room);
      break;
    }

    case 'cast:youtube_command': {
      if (!room.state.youtube) return;
      if (event.command === 'play') room.state.youtube.isPlaying = true;
      if (event.command === 'pause') room.state.youtube.isPlaying = false;
      if (event.command === 'mute') room.state.youtube.muted = true;
      if (event.command === 'unmute') room.state.youtube.muted = false;
      if (event.command === 'restart') room.state.youtube.isPlaying = true;
      room.state.youtube.updatedAt = Date.now();
      sendJson(room.tvWs, { type: 'youtube:command', command: event.command });
      broadcastRoomState(room);
      break;
    }

    case 'cast:message': {
      if (room.state.webrtcActive) {
        stopRoomWebrtc(room);
      }
      room.state.message = {
        title: event.title.trim().slice(0, 120),
        body: event.body.trim().slice(0, 500),
        theme: event.theme,
        fontSize: event.fontSize,
        updatedAt: Date.now(),
      };
      room.state.mode = 'message';
      broadcastRoomState(room);
      break;
    }

    case 'cast:clear': {
      if (room.state.webrtcActive) {
        stopRoomWebrtc(room);
      }
      room.state.mode = 'idle';
      room.state.display.dimmed = false;
      room.state.display.zoom = 1;
      broadcastRoomState(room);
      break;
    }

    case 'tv:display_control': {
      if (typeof event.dimmed === 'boolean') {
        room.state.display.dimmed = event.dimmed;
      }
      if (typeof event.zoom === 'number') {
        room.state.display.zoom = Math.max(1, Math.min(2, Number(event.zoom.toFixed(2))));
      }
      if (event.fitMode === 'contain' || event.fitMode === 'cover') {
        room.state.display.fitMode = event.fitMode;
      }
      broadcastRoomState(room);
      break;
    }

    case 'webrtc:offer': {
      if (session.role !== 'controller') return;
      if (!room.tvWs || room.tvWs.readyState !== WebSocket.OPEN) {
        sendJson(ws, {
          type: 'room:error',
          message: 'A tela da TV não está aberta neste momento para receber o espelhamento.',
        });
        return;
      }
      const preset = event.preset ?? 'low_latency';
      room.state.webrtcActive = true;
      room.state.webrtcSource = event.source;
      room.state.webrtcPreset = preset;
      room.state.webrtcControllerId = session.id;
      room.state.mode = 'webrtc';
      sendJson(room.tvWs, {
        type: 'webrtc:offer',
        sdp: event.sdp,
        source: event.source,
        preset,
        controllerId: session.id,
      });
      broadcastRoomState(room);
      break;
    }

    case 'webrtc:preset': {
      room.state.webrtcPreset = event.preset;
      broadcastRoomState(room);
      break;
    }

    case 'webrtc:answer': {
      if (session.role !== 'tv') return;
      const targetController = room.controllers.get(event.controllerId);
      sendJson(targetController?.ws, {
        type: 'webrtc:answer',
        sdp: event.sdp,
      });
      break;
    }

    case 'webrtc:ice': {
      if (event.target === 'tv') {
        sendJson(room.tvWs, {
          type: 'webrtc:ice',
          candidate: event.candidate,
          fromControllerId: session.id,
        });
      } else if (event.controllerId) {
        const targetController = room.controllers.get(event.controllerId);
        sendJson(targetController?.ws, {
          type: 'webrtc:ice',
          candidate: event.candidate,
        });
      }
      break;
    }

    case 'webrtc:stop': {
      stopRoomWebrtc(room);
      if (room.state.mode === 'webrtc') {
        room.state.mode = 'idle';
      }
      broadcastRoomState(room);
      break;
    }

    case 'tv:key_input': {
      if (session.role !== 'controller') return;
      sendJson(room.tvWs, {
        type: 'tv:key_input',
        key: String(event.key ?? '').slice(0, 32),
        code: event.code,
        hidCode: event.hidCode,
        modifiers: event.modifiers,
        action: event.action,
        consumerUsage: event.consumerUsage,
      });
      break;
    }

    case 'tv:text_input': {
      if (session.role !== 'controller') return;
      sendJson(room.tvWs, {
        type: 'tv:text_input',
        text: String(event.text ?? '').slice(0, 500),
        pressEnter: Boolean(event.pressEnter),
      });
      break;
    }

    case 'tv:mouse_input': {
      if (session.role !== 'controller') return;
      sendJson(room.tvWs, {
        type: 'tv:mouse_input',
        dx: Number(event.dx) || 0,
        dy: Number(event.dy) || 0,
        wheel: event.wheel ? Number(event.wheel) : 0,
        click: event.click,
      });
      break;
    }
  }
}

function stopRoomWebrtc(room: InternalTvSession): void {
  room.state.webrtcActive = false;
  room.state.webrtcSource = null;
  room.state.webrtcControllerId = null;
  sendJson(room.tvWs, { type: 'webrtc:stop' });
  for (const controller of room.controllers.values()) {
    sendJson(controller.ws, { type: 'webrtc:stop' });
  }
}

startServer().catch((error) => {
  console.error('Erro ao iniciar servidor TelaLivre:', error);
  process.exit(1);
});
