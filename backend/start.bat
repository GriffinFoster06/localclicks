@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
call npm install --no-audit --no-fund
node scripts\run-overlay.mjs
pause
