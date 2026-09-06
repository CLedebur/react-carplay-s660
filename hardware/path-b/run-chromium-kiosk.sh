#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/node-CarPlay/examples/carplay-web-app"
BUILD_DIR="$APP_DIR/build"

if [ -f "$BUILD_DIR/index.html" ]; then
  # Fast path: serve the pre-built static bundle (no dev-server compile at boot).
  # serve-build.js sends the COOP/COEP headers SharedArrayBuffer needs.
  node "$HOME/carplay-dev/serve-build.js" "$BUILD_DIR" &
else
  # Fallback: dev server (slow — recompiles the app at every boot, ~12s on the CM4).
  # Run `CI=false npm run build` in the web app to produce build/ and use the fast path.
  cd "$APP_DIR"
  BROWSER=none npm start &
fi

# Wait for the local server to answer before handing the display to Chromium.
# boot-tuning 2026-09-05: poll every 100 ms (was 1 s) — the server is up in ~0.2 s,
# so the old loop wasted most of a second on every boot. 60 s ceiling.
for _ in $(seq 1 600); do
  if curl -sf -o /dev/null http://localhost:3000; then break; fi
  sleep 0.1
done

# boot-tuning 2026-09-05: vc4 is loaded via /etc/modules-load.d/carplay-gpu.conf, but never let
# cage race the KMS device — it fails with "Found 0 GPUs" and hangs. Wait for the HDMI
# connector to exist (15 s ceiling).
for _ in $(seq 1 300); do
  if ls /sys/class/drm/card*-HDMI-A-1/status >/dev/null 2>&1; then break; fi
  sleep 0.05
done

# WebUSB requires a localhost origin — which this is. Full-screen kiosk, GPU compositing.
# Kiosk hygiene flags: no background networking (kills GCM/update/translate pings), no
# component updates, sync, crash reporting, first-run, or keyring lookups — none of which
# a locked-down offline kiosk needs. GPU/Wayland/kiosk flags are unchanged.
exec cage -- chromium \
  --ozone-platform=wayland --kiosk --no-sandbox \
  --disable-background-networking --disable-component-update --disable-sync \
  --disable-breakpad --no-first-run --password-store=basic \
  http://localhost:3000
