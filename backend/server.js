import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const cfg = {
    port: parseInt(process.env.PORT || '8787', 10),
    wsPath: '/ws',
    adminSecret: process.env.ADMIN_SECRET || 'CHANGE_ME',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    defaultStreamer: process.env.DEFAULT_STREAMER || 'dougdoug',
    grid: { w: parseInt(process.env.GRID_W || '64', 10), h: parseInt(process.env.GRID_H || '36', 10) },
    snapshotFps: parseInt(process.env.SNAPSHOT_FPS || '10', 10),
    clientDefaultSampleN: parseInt(process.env.CLIENT_DEFAULT_SAMPLE_N || '32', 10),
    serverSampleN: parseInt(process.env.SERVER_SAMPLE_N || '16', 10),
    recentDotsCapacity: parseInt(process.env.RECENT_DOTS_CAPACITY || '2000', 10),
    rateLimit: {
        enabled: (process.env.RATE_LIMIT_ENABLED || 'true') === 'true',
        maxPerSecondPerIp: parseInt(process.env.RATE_LIMIT_MAX_PER_SEC_PER_IP || '200', 10)
    },
    logIngestStatsEverySec: parseInt(process.env.LOG_INGEST_STATS_EVERY_SEC || '5', 10)
};

const GRID_W = cfg.grid.w;
const GRID_H = cfg.grid.h;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(helmet({
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (cfg.allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Origin not allowed'), false);
    }
}));

// In-memory per-streamer rooms
const rooms = new Map();
// room: { clients:Set<WS>, state:{active,lastReset,clientSampleN}, grid:Uint32Array, recentDots:Float32Array, recentIdx, serverSampleCtr, stats, ipWindow:Map }

function initRoom() {
    return {
        clients: new Set(),
        state: { active: false, lastReset: Date.now(), clientSampleN: cfg.clientDefaultSampleN },
        grid: new Uint32Array(GRID_W * GRID_H),
        recentDots: new Float32Array(cfg.recentDotsCapacity * 2),
        recentIdx: 0,
        serverSampleCtr: 0,
        stats: { ingestCount: 0, dropped: 0 },
        ipWindow: new Map()
    };
}
function getRoom(streamer) {
    if (!rooms.has(streamer)) rooms.set(streamer, initRoom());
    return rooms.get(streamer);
}

function broadcast(streamer, obj) {
    const msg = JSON.stringify(obj);
    const room = getRoom(streamer);
    for (const c of room.clients) {
        if (c.readyState === 1) c.send(msg);
    }
}

function toIndex(x, y) {
    let xi = Math.floor(x * GRID_W);
    let yi = Math.floor(y * GRID_H);
    if (xi < 0) xi = 0; if (xi >= GRID_W) xi = GRID_W - 1;
    if (yi < 0) yi = 0; if (yi >= GRID_H) yi = GRID_H - 1;
    return yi * GRID_W + xi;
}

function trackRecentDot(room, x, y) {
    const j = (room.recentIdx % cfg.recentDotsCapacity) * 2;
    room.recentDots[j] = x;
    room.recentDots[j + 1] = y;
    room.recentIdx++;
}

function now() { return Date.now(); }

// Per-IP 1-second window limiter
function rateLimitOk(room, ip) {
    if (!cfg.rateLimit.enabled) return true;
    const per = cfg.rateLimit.maxPerSecondPerIp;
    const t = Math.floor(now() / 1000);
    let e = room.ipWindow.get(ip);
    if (!e) { e = { count: 0, sec: t }; room.ipWindow.set(ip, e); }
    if (e.sec !== t) { e.sec = t; e.count = 0; }
    if (e.count >= per) return false;
    e.count++;
    return true;
}

// Admin page (ONLY on localhost)
app.get('/admin', (req, res) => {
    const host = (req.headers.host || '').toLowerCase();
    if (!host.startsWith('localhost') && !host.startsWith('127.0.0.1') && !host.startsWith('[::1]')) {
        return res.status(404).send('Not found');
    }
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health
app.get('/healthz', (_, res) => res.send('ok'));

// State polling for viewers
app.get('/state', (req, res) => {
    const streamer = (req.query.streamer || cfg.defaultStreamer) + '';
    const room = getRoom(streamer);
    res.json({
        ok: true,
        active: room.state.active,
        clientSampleN: room.state.clientSampleN,
        lastReset: room.state.lastReset
    });
});

// Batched ingestion from viewers
app.post('/ingest', (req, res) => {
    const body = req.body || {};
    const streamer = (body.streamer || cfg.defaultStreamer) + '';
    const clicks = Array.isArray(body.clicks) ? body.clicks : [];
    const room = getRoom(streamer);

    const ip = req.headers['cf-connecting-ip']
        || req.headers['x-forwarded-for']
        || req.socket.remoteAddress
        || 'unknown';

    let accepted = 0;
    for (let i = 0; i < clicks.length; i++) {
        const c = clicks[i];
        if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') continue;

        if (!rateLimitOk(room, ip)) { room.stats.dropped++; continue; }
        if (!room.state.active) continue;

        const idx = toIndex(c.x, c.y);
        room.grid[idx]++;

        room.serverSampleCtr++;
        if ((room.serverSampleCtr % cfg.serverSampleN) === 0) {
            trackRecentDot(room, c.x, c.y);
        }

        accepted++;
    }
    room.stats.ingestCount += accepted;

    res.json({
        ok: true,
        clientSampleN: room.state.clientSampleN,
        active: room.state.active
    });
});

// Start HTTP server
const server = app.listen(cfg.port, () => {
    console.log(`Local backend on http://localhost:${cfg.port}`);
});

// WebSocket only for OBS and local admin
const wss = new WebSocketServer({ server, path: cfg.wsPath });

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams((req.url.split('?')[1] || ''));
    const streamer = (params.get('streamer') || cfg.defaultStreamer) + '';
    const role = (params.get('role') || 'viewer').toLowerCase();

    const room = getRoom(streamer);
    ws._meta = { id: uuid(), streamer, role };
    room.clients.add(ws);

    // Initial state
    ws.send(JSON.stringify({
        type: 'state',
        state: room.state,
        gridSize: { w: GRID_W, h: GRID_H }
    }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'admin' && msg.secret === cfg.adminSecret) {
                if (msg.action === 'toggle') {
                    room.state.active = !room.state.active;
                    broadcast(streamer, { type: 'state', state: room.state });
                }
                if (msg.action === 'reset') {
                    room.grid.fill(0);
                    room.recentIdx = 0;
                    room.state.lastReset = now();
                    broadcast(streamer, { type: 'reset', ts: room.state.lastReset });
                }
                if (msg.action === 'setSampleN' && Number.isInteger(msg.value) && msg.value >= 1) {
                    room.state.clientSampleN = msg.value;
                    broadcast(streamer, { type: 'state', state: room.state });
                }
            }
        } catch { }
    });

    ws.on('close', () => {
        room.clients.delete(ws);
    });
});

// Periodic snapshots (for OBS)
setInterval(() => {
    for (const [streamer, room] of rooms.entries()) {
        const counts = Array.from(room.grid);
        const dotsToSend = Math.min(room.recentIdx, cfg.recentDotsCapacity);
        const recent = new Array(dotsToSend);
        const base = (room.recentIdx - dotsToSend) % cfg.recentDotsCapacity;
        for (let i = 0; i < dotsToSend; i++) {
            const j = ((base + i) % cfg.recentDotsCapacity) * 2;
            recent[i] = [room.recentDots[j], room.recentDots[j + 1]];
        }
        broadcast(streamer, {
            type: 'snapshot',
            grid: { w: GRID_W, h: GRID_H, counts },
            sampleDots: recent,
            ts: now()
        });
    }
}, 1000 / Math.max(1, cfg.snapshotFps));

// Periodic logging
if (cfg.logIngestStatsEverySec > 0) {
    setInterval(() => {
        for (const [streamer, room] of rooms.entries()) {
            const secs = cfg.logIngestStatsEverySec;
            const acc = (room.stats.ingestCount / secs) | 0;
            const drop = (room.stats.dropped / secs) | 0;
            console.log(`[stats] ${streamer} | accepted=${acc}/s dropped=${drop}/s sampleN_client=${room.state.clientSampleN}`);
            room.stats.ingestCount = 0;
            room.stats.dropped = 0;
        }
    }, cfg.logIngestStatsEverySec * 1000);
}
