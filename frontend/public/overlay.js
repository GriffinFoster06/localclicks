(function () {
    const cfg = window.OVERLAY_CFG || {};
    const url = new URL(location.href);
    const isObs = location.pathname.startsWith('/obs/');
    const segs = location.pathname.split('/').filter(Boolean);
    const streamer = isObs ? (segs[1] || 'dougdoug') : (segs[0] || 'dougdoug');

    // Defaults (your own deployment)
    let API_URL = cfg.API_URL || 'https://api.overlay.phummylw.com';
    let WS_URL = cfg.WS_URL || 'wss://api.overlay.phummylw.com/ws';

    // Per-streamer override via ?api= (used by the one-script runner)
    const apiOverride = url.searchParams.get('api');
    if (apiOverride) {
        API_URL = apiOverride.replace(/\/+$/, '');
        const proto = API_URL.startsWith('https:') ? 'wss:' : 'ws:';
        const host = API_URL.replace(/^https?:/, '');
        WS_URL = `${proto}${host}/ws`;
    }

    // Enforce /obs/<streamer>
    if (isObs && segs.length < 2) {
        location.replace('/obs/' + streamer);
    }

    // Set Twitch player src on viewer page (no inline script)
    if (!isObs) {
        const parent = location.hostname;
        const src = `https://player.twitch.tv/?channel=${encodeURIComponent(streamer)}&parent=${encodeURIComponent(parent)}&muted=true`;
        const iframe = document.getElementById('player');
        if (iframe) iframe.src = src;
    }

    const state = { active: false, lastReset: Date.now(), clientSampleN: 32 };

    const canvas = document.getElementById('overlay');
    const ctx = canvas.getContext('2d');
    let cw = 0, ch = 0;

    function resize() {
        const r = canvas.getBoundingClientRect();
        canvas.width = r.width * devicePixelRatio;
        canvas.height = r.height * devicePixelRatio;
        cw = canvas.width; ch = canvas.height;
        draw();
    }

    function draw() { ctx.clearRect(0, 0, cw, ch); }

    function drawDot(xNorm, yNorm) {
        const x = xNorm * cw;
        const y = yNorm * ch;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(6, cw * 0.01), 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, cw * 0.003);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();
    }

    function drawHeatmap(grid) {
        const w = grid.w, h = grid.h, counts = grid.counts;
        const cellW = cw / w, cellH = ch / h;
        let max = 0;
        for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
        if (max <= 0) return;
        for (let yi = 0; yi < h; yi++) {
            for (let xi = 0; xi < w; xi++) {
                const v = counts[yi * w + xi];
                if (!v) continue;
                const a = Math.min(0.6, v / max);
                ctx.globalAlpha = a * 0.5;
                ctx.fillStyle = 'black';
                ctx.fillRect(xi * cellW, yi * cellH, cellW, cellH);
            }
        }
        ctx.globalAlpha = 1;
    }

    function setHint() {
        const el = document.getElementById('hint');
        if (el) el.textContent = state.active ? 'Overlay: ACTIVE (clicks enabled)' : 'Overlay: INACTIVE';
    }

    // OBS keeps a WS to get snapshots. Viewers do not.
    if (isObs) {
        const ws = new WebSocket(`${WS_URL}?streamer=${encodeURIComponent(streamer)}&role=obs`);
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'state') {
                    state.active = !!msg.state.active;
                    state.lastReset = msg.state.lastReset || state.lastReset;
                    state.clientSampleN = msg.state.clientSampleN || state.clientSampleN;
                    setHint();
                }
                if (msg.type === 'reset') {
                    state.lastReset = msg.ts;
                    draw();
                }
                if (msg.type === 'snapshot') {
                    draw();
                    if (msg.grid) drawHeatmap(msg.grid);
                    if (Array.isArray(msg.sampleDots)) {
                        for (let i = 0; i < msg.sampleDots.length; i++) {
                            const [x, y] = msg.sampleDots[i];
                            drawDot(x, y);
                        }
                    }
                }
            } catch { }
        };
    } else {
        // Viewers: poll state periodically (no WS)
        async function pollState() {
            try {
                const r = await fetch(`${API_URL}/state?streamer=${encodeURIComponent(streamer)}`, { cache: 'no-store' });
                if (!r.ok) throw new Error('state not ok');
                const j = await r.json();
                if (j && j.ok) {
                    state.active = !!j.active;
                    state.clientSampleN = j.clientSampleN || state.clientSampleN;
                    state.lastReset = j.lastReset || state.lastReset;
                    setHint();
                }
            } catch { }
            setTimeout(pollState, 5000);
        }
        pollState();
    }

    // Viewer ingestion batching
    const batch = [];
    let lastSend = performance.now();
    const SEND_EVERY_MS = 50;

    function maybeSendBatch() {
        const n = performance.now();
        if (n - lastSend >= SEND_EVERY_MS && batch.length) {
            const payload = { streamer, clicks: batch.splice(0, batch.length) };
            fetch(`${API_URL}/ingest`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).then(async (r) => {
                if (!r.ok) return;
                const j = await r.json().catch(() => null);
                if (j && j.clientSampleN) state.clientSampleN = j.clientSampleN;
                if (j && typeof j.active === 'boolean') state.active = j.active;
                setHint();
            }).catch(() => { });
            lastSend = n;
        }
        requestAnimationFrame(maybeSendBatch);
    }

    function setupClicks() {
        if (isObs) return;
        canvas.addEventListener('click', (e) => {
            if (!state.active) return;
            const r = canvas.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            const y = (e.clientY - r.top) / r.height;
            if (x < 0 || x > 1 || y < 0 || y > 1) return;
            // client-side sampling
            if ((Math.random() * state.clientSampleN | 0) !== 0) return;
            batch.push({ x, y, ts: Date.now() });
            drawDot(x, y); // local preview
        });
        requestAnimationFrame(maybeSendBatch);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('load', () => { resize(); setupClicks(); });
})();
