(() => {
    const qs = (s) => document.querySelector(s);
    const streamerEl = qs('#streamer');
    const secretEl = qs('#secret');
    const statusEl = qs('#status');
    const sampleNEl = qs('#sampleN');
    const logEl = qs('#log');

    const toggleBtn = qs('#btn-toggle');
    const resetBtn = qs('#btn-reset');
    const sampleDec = qs('#btn-sample-dec');
    const sampleInc = qs('#btn-sample-inc');

    const hkToggleDisplay = qs('#hk-toggle-display');
    const hkResetDisplay = qs('#hk-reset-display');
    const hkToggleRecord = qs('#hk-toggle-record');
    const hkResetRecord = qs('#hk-reset-record');

    const LS_KEY = 'overlay_admin_hotkeys';
    function loadHotkeys() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return {
                toggle: { ctrl: true, alt: false, shift: false, meta: false, code: 'Numpad1' },
                reset: { ctrl: true, alt: false, shift: false, meta: false, code: 'Numpad2' }
            };
            return JSON.parse(raw);
        } catch { return null; }
    }
    function saveHotkeys(hk) { localStorage.setItem(LS_KEY, JSON.stringify(hk)); }
    let hotkeys = loadHotkeys() || {
        toggle: { ctrl: true, alt: false, shift: false, meta: false, code: 'Numpad1' },
        reset: { ctrl: true, alt: false, shift: false, meta: false, code: 'Numpad2' }
    };

    function hkToText(h) {
        const parts = [];
        if (h.ctrl) parts.push('Ctrl');
        if (h.alt) parts.push('Alt');
        if (h.shift) parts.push('Shift');
        if (h.meta) parts.push('Meta');
        parts.push(h.code);
        return parts.join(' + ');
    }
    function renderHotkeys() {
        hkToggleDisplay.textContent = hkToText(hotkeys.toggle);
        hkResetDisplay.textContent = hkToText(hotkeys.reset);
    }
    renderHotkeys();

    let ws = null;
    let wsStreamer = null;

    function connectWS(streamer) {
        if (ws) try { ws.close(); } catch { }
        wsStreamer = streamer;
        ws = new WebSocket(`ws://localhost:8787/ws?streamer=${encodeURIComponent(streamer)}&role=admin`);
        ws.onopen = () => log('WS connected');
        ws.onclose = () => log('WS closed');
        ws.onerror = (e) => log('WS error');
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'state') {
                    updateStateUI(msg.state);
                }
                if (msg.type === 'reset') {
                    log('State reset at ' + new Date(msg.ts).toLocaleTimeString());
                }
            } catch (e) { log('Bad WS message'); }
        };
    }

    function log(m) { logEl.textContent = m + '\n' + logEl.textContent; }

    function updateStateUI(state) {
        const active = !!state.active;
        statusEl.textContent = active ? 'ACTIVE' : 'INACTIVE';
        statusEl.className = 'status ' + (active ? 'on' : 'off');
        if (state.clientSampleN) sampleNEl.value = state.clientSampleN;
    }

    function sendAdmin(action, value) {
        const secret = secretEl.value.trim();
        if (!secret) { alert('Enter Admin Secret first'); return; }
        try {
            ws.send(JSON.stringify({ type: 'admin', action, value, secret }));
        } catch {
            alert('WebSocket not connected. Ensure backend is running on localhost:8787.');
        }
    }

    toggleBtn.addEventListener('click', () => sendAdmin('toggle'));
    resetBtn.addEventListener('click', () => sendAdmin('reset'));
    sampleInc.addEventListener('click', () => {
        const v = Math.max(1, parseInt(sampleNEl.value || '32', 10)) + 1;
        sampleNEl.value = v;
        sendAdmin('setSampleN', v);
    });
    sampleDec.addEventListener('click', () => {
        const v = Math.max(1, parseInt(sampleNEl.value || '32', 10) - 1);
        sampleNEl.value = v;
        sendAdmin('setSampleN', v);
    });
    qs('#btn-sample-apply').addEventListener('click', () => {
        const v = Math.max(1, parseInt(sampleNEl.value || '32', 10));
        sendAdmin('setSampleN', v);
    });
    qs('#btn-streamer-apply').addEventListener('click', () => {
        const s = streamerEl.value.trim() || 'dougdoug';
        connectWS(s);
    });

    function recordHotkey(which) {
        alert(`Recording ${which} hotkey. Press your combo here (ESC to cancel).`);
        function handler(e) {
            e.preventDefault();
            if (e.key === 'Escape') {
                window.removeEventListener('keydown', handler, true);
                return;
            }
            const hk = {
                ctrl: e.ctrlKey,
                alt: e.altKey,
                shift: e.shiftKey,
                meta: e.metaKey,
                code: e.code
            };
            hotkeys[which] = hk;
            saveHotkeys(hotkeys);
            renderHotkeys();
            window.removeEventListener('keydown', handler, true);
            alert(`${which} mapped to ${hkToText(hk)}`);
        }
        window.addEventListener('keydown', handler, true);
    }

    hkToggleRecord.addEventListener('click', () => recordHotkey('toggle'));
    hkResetRecord.addEventListener('click', () => recordHotkey('reset'));

    document.addEventListener('keydown', (e) => {
        const match = (hk) =>
            !!hk &&
            (!!hk.ctrl === e.ctrlKey) &&
            (!!hk.alt === e.altKey) &&
            (!!hk.shift === e.shiftKey) &&
            (!!hk.meta === e.metaKey) &&
            (hk.code === e.code);
        if (match(hotkeys.toggle)) { e.preventDefault(); sendAdmin('toggle'); }
        if (match(hotkeys.reset)) { e.preventDefault(); sendAdmin('reset'); }
    });

    const urlParams = new URLSearchParams(location.search);
    streamerEl.value = urlParams.get('streamer') || 'dougdoug';
    updateStateUI({ active: false, clientSampleN: 32 });
    connectWS(streamerEl.value);
})();
