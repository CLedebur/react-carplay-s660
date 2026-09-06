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

# Cursor (BUILD_NOTES 22.7). The arrow that sat in the middle of the screen was Chromium's
# default cursor: the Pi's vc4 HDMI-CEC receivers look like pointing sticks to libinput, which
# gave the Wayland seat pointer capability and Chromium a wl_pointer that nothing could ever
# move. 71-s660-libinput-ignore-cec.rules hides them from libinput, so there is no pointer, no
# wl_pointer and no cursor at all — cage draws none of its own without a pointer device.
#
# Zero input devices is therefore this unit's normal state. wlroots' libinput backend refuses
# to start with none at all (cage exits, the unit restart-loops, black screen) unless told
# that this is expected:
export WLR_LIBINPUT_NO_DEVICES=1
# Software cursors: if a cursor ever does appear (a real mouse/touchscreen), it is composited
# into the frame instead of placed on the vc4 hardware cursor plane, so `grim` shows what the
# glass shows. A hardware cursor is invisible to screenshots — that is how this bug survived
# a screenshot-"verified" fix once already.
export WLR_NO_HARDWARE_CURSORS=1

# WebUSB requires a localhost origin — which this is. Full-screen kiosk, GPU compositing.
# Kiosk hygiene flags: no background networking (kills GCM/update/translate pings), no
# component updates, sync, crash reporting, first-run, or keyring lookups — none of which
# a locked-down offline kiosk needs. GPU/Wayland/kiosk flags are unchanged.
# --default-background-color=000000: the colour Chromium presents in the ~0.3 s between
# mapping its window and the first page paint. Default is WHITE — a visible flash on a
# black boot sequence (measured with grim, BUILD_NOTES 22.5).
exec cage -- chromium \
  --ozone-platform=wayland --kiosk --no-sandbox \
  --disable-background-networking --disable-component-update --disable-sync \
  --disable-breakpad --no-first-run --password-store=basic \
  --default-background-color=000000 \
  http://localhost:3000
