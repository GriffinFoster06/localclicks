# Self-Hosted Overlay (Twitch-like Extension Without Twitch)

Viewer page:
- `https://overlay.phummylw.com/<streamer>`

OBS overlay:
- `https://overlay.phummylw.com/obs/<streamer>`

Local backend (your machine), public via a tunnel:
- Use `?api=` override in the URL (the runner prints it)

## File Layout

self-hosted-overlay/
├─ backend/
│ ├─ admin-static/
│ │ ├─ admin.css
│ │ └─ admin.js
│ ├─ admin.html
│ ├─ package.json
│ ├─ server.js
│ ├─ .env.example
│ ├─ .env # created on first run; DO NOT COMMIT
│ ├─ scripts/
│ │ └─ run-overlay.mjs
│ ├─ start.sh
│ └─ start.bat
└─ frontend/
└─ public/
├─ config.js
├─ index.html
├─ obs.html
├─ overlay.css
└─ overlay.js


## One-Script Run (for any streamer)

1) Install Node.js LTS (https://nodejs.org).
2) Open a terminal in `self-hosted-overlay/backend`.
3) Run:
   - Windows: `start.bat`
   - macOS/Linux: `./start.sh`

The script:
- Installs deps
- Starts the backend on `http://localhost:8787`
- Opens a public tunnel (no account)
- Prints:
  - Viewer: `https://overlay.phummylw.com/<streamer>?api=<tunnelUrl>`
  - OBS:    `https://overlay.phummylw.com/obs/<streamer>?api=<tunnelUrl>`
  - Admin:  `http://localhost:8787/admin?streamer=<streamer>`

Open **Admin**, paste ADMIN_SECRET from `backend/.env`, toggle **Active**, share the Viewer link, and add the OBS link as a Browser Source.

## “sampleN” Meaning

- Viewers send **~1 out of N** clicks.
- `1` = every click; `32` ≈ 3.125%; raise to 64/128/256 if traffic spikes.

## Notes

- Frontend pulls API/WS endpoints from `?api=`. Without it, defaults to `https://api.overlay.phummylw.com` (for your own deployment).
- Admin page is **localhost-only** and requires your secret.
- No per-click broadcast; only periodic snapshots to OBS.
