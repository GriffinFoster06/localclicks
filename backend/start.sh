#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is required. Install from https://nodejs.org/"
  exit 1
fi
npm install --no-audit --no-fund
node scripts/run-overlay.mjs
