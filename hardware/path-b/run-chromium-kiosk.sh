#!/usr/bin/env bash
set -euo pipefail

# Cage runs this branch once its Wayland display is ready. Starting the compositor
# alongside Node overlaps their cold startup, while Chromium still waits for HTTP.
if [ "${1:-}" = "--browser" ]; then
  ready=false
  deadline=$((SECONDS + 60))
  while [ "$SECONDS" -lt "$deadline" ]; do
    # NODE_PID is exported below (in the top-level invocation, before cage starts) so this
    # re-invocation can detect a dead server immediately instead of waiting out the full
    # readiness deadline on a process that already crashed.
    if [ -n "${NODE_PID:-}" ] && ! kill -0 "$NODE_PID" 2>/dev/null; then
      echo "CarPlay web server (pid $NODE_PID) exited before it became ready" >&2
      break
    fi
    if curl -sf --max-time 1 -o /dev/null "${KIOSK_URL:-http://localhost:3000}"; then
      ready=true
      break
    fi
    sleep 0.1
  done
  if [ "$ready" != true ]; then
    # Load Chromium anyway rather than exiting: an exit here kills cage's only client,
    # which makes cage exit too, which restarts the WHOLE unit (DRM/HDMI wait + Node
    # startup, ~62s) via Restart=always. A persistently broken build then crash-loops
    # forever instead of showing a static (if broken) page -- strictly worse for a kiosk
    # with no physical display access to diagnose it. Chromium's own error page carries
    # the same diagnostic value with none of the cycling.
    echo 'CarPlay HTTP server did not become ready -- loading Chromium anyway' >&2
  fi

  # Preserve the system Chromium wrapper and its Raspberry Pi graphics settings.
  # Black background avoids the white flash before the first page paint.
  # KIOSK_URL may select the aspect calibration page using a systemd drop-in.
  exec chromium \
    --ozone-platform=wayland --kiosk --no-sandbox \
    --disable-background-networking --disable-component-update --disable-sync \
    --disable-breakpad --no-first-run --password-store=basic \
    --default-background-color=000000 \
    "${KIOSK_URL:-http://localhost:3000}"
fi

# Absolute path to this script regardless of how it was invoked (absolute, relative, or
# resolved via $PATH) -- more reliable than a $0-based guess, and needs no fallback branch
# for the case where ExecStart= ever stops using an absolute path.
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

APP_DIR="$HOME/react-carplay-s660/hardware/path-b/node-CarPlay/examples/carplay-web-app"
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
# Exported so the --browser re-invocation (a separate process launched via cage) can check
# whether this server is still alive instead of only finding out via an HTTP timeout.
export NODE_PID=$!

# boot-tuning 2026-09-05: vc4 is loaded via /etc/modules-load.d/carplay-gpu.conf, but never let
# cage race the KMS device — it fails with "Found 0 GPUs" and hangs. Wait for the HDMI
# connector to exist (15 s ceiling). Bash's own glob expansion avoids forking `ls` on every tick.
shopt -s nullglob
for _ in $(seq 1 300); do
  status_files=(/sys/class/drm/card*-HDMI-A-1/status)
  [ "${#status_files[@]}" -gt 0 ] && break
  sleep 0.05
done
shopt -u nullglob

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

exec cage -- "$SCRIPT_PATH" --browser
