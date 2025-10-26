#!/usr/bin/env node
/**
 * One-script runner for any streamer.
 * - Ensures .env exists (random ADMIN_SECRET if missing)
 * - Installs deps
 * - Starts backend server
 * - Opens public tunnel via localtunnel
 * - Prints Viewer/OBS URLs with ?api= override
 * - Cleans up on Ctrl+C
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import localtunnel from 'localtunnel';
import readline from 'readline';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_PATH = path.join(ROOT, '.env');
const PORT = 8787;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, ans => res(ans.trim())));

function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function ensureEnv() {
    if (!fileExists(ENV_PATH)) {
        const secret = crypto.randomBytes(24).toString('hex');
        const env = [
            `PORT=${PORT}`,
            `ADMIN_SECRET=${secret}`,
            `ALLOWED_ORIGINS=https://overlay.phummylw.com,http://localhost:${PORT}`,
            `DEFAULT_STREAMER=dougdoug`,
            `GRID_W=64`,
            `GRID_H=36`,
            `SNAPSHOT_FPS=10`,
            `CLIENT_DEFAULT_SAMPLE_N=32`,
            `SERVER_SAMPLE_N=16`,
            `RECENT_DOTS_CAPACITY=2000`,
            `RATE_LIMIT_ENABLED=true`,
            `RATE_LIMIT_MAX_PER_SEC_PER_IP=200`,
            `LOG_INGEST_STATS_EVERY_SEC=5`
        ].join('\n') + '\n';
        fs.writeFileSync(ENV_PATH, env, 'utf8');
        console.log(`[one] Created .env with random ADMIN_SECRET`);
    }
}

async function main() {
    console.log('=== Self-Hosted Overlay — One-Click Runner ===\n');

    const streamer = (await ask('Streamer name (default: dougdoug): ')) || 'dougdoug';
    console.log('');

    ensureEnv();

    console.log('[one] Installing deps (if needed)...');
    const npm = process.platform.startsWith('win') ? 'npm.cmd' : 'npm';
    await new Promise((res, rej) => {
        const p = spawn(npm, ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
        p.on('exit', (code) => code === 0 ? res() : rej(new Error('npm install failed')));
    });

    console.log('[one] Starting backend server...');
    const node = process.execPath;
    const backend = spawn(node, ['server.js'], { cwd: ROOT, stdio: 'inherit' });

    await new Promise(r => setTimeout(r, 800));

    console.log('[one] Opening public tunnel (no login needed)...');
    const tunnel = await localtunnel({ port: PORT });
    const base = tunnel.url.replace(/\/+$/, '');

    const apiParam = encodeURIComponent(base);
    const viewerURL = `https://overlay.phummylw.com/${encodeURIComponent(streamer)}?api=${apiParam}`;
    const obsURL = `https://overlay.phummylw.com/obs/${encodeURIComponent(streamer)}?api=${apiParam}`;
    const adminURL = `http://localhost:${PORT}/admin?streamer=${encodeURIComponent(streamer)}`;

    console.log('\n=== READY ===');
    console.log(`Viewer URL: ${viewerURL}`);
    console.log(`OBS URL:    ${obsURL}`);
    console.log(`Admin URL:  ${adminURL}`);
    console.log('\nOpen Admin, paste your ADMIN_SECRET from backend/.env when prompted.');
    console.log('Press Ctrl+C here to stop everything.\n');

    const cleanup = async () => {
        try { await tunnel.close(); } catch { }
        try { backend.kill('SIGINT'); } catch { }
        rl.close();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

main().catch(err => {
    console.error('[one] Fatal:', err);
    process.exit(1);
});
