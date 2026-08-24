#!/usr/bin/env bash
#
# S660 CarPlay — provisioning script
# ==================================
# Sets up a fresh Raspberry Pi OS Lite (64-bit, Trixie) install on a CM4 + Oratek TOFU
# into a working CarPlay head unit.
#
# Read BUILD_NOTES.md alongside this. Every non-obvious line here has a "WHY" comment,
# but the notes carry the full reasoning and the debugging history.
#
# ONE SCRIPT, TWO PATHS (see BUILD_NOTES Section 8.5) — pick ONE via TARGET_PATH in CONFIG:
#   Path A = Electron AppImage, software rendering (--disable-gpu). Stable, no GPU.
#            Autostarts as a systemd service; proven.
#   Path B = system Chromium + carplay-web-app, GPU-accelerated compositing. CHOSEN long
#            term, but its autostart service is still TODO (video-decode test pending —
#            BUILD_NOTES 11.7), so Path B provisions the stack and you launch it by hand.
#
# The COMMON phases (0, 1, 2) run for BOTH paths. Only PHASE 3 (app stack) and PHASE 4
# (service) branch on TARGET_PATH — so there is a single file and nothing to keep in sync.
#
# USAGE:
#   Set TARGET_PATH (and the rest of CONFIG) below, then:
#     chmod +x provision.sh
#     ./provision.sh
#   Then REBOOT (a clean boot is required — see PHASE 5).
#
# Run as your normal user (NOT root, NOT with sudo). The script calls sudo where needed.
# Assumes the user can sudo. Group changes are applied by the reboot at the end — no need
# to log out and re-run mid-way.

set -euo pipefail

# ============================ CONFIG — EDIT THESE ============================
TARGET_PATH="a"                              # which kiosk stack to provision: "a" or "b"
                                             #   a = Electron AppImage  (software; autostarts)
                                             #   b = Chromium + web app (GPU; launch by hand)
CARPLAY_USER="${USER}"                       # the user the kiosk runs as            (COMMON)
# --- Path A only ---
RC_VERSION="4.0.5"                            # react-carplay AppImage version
ARCH_SUFFIX="arm64"                           # AppImage arch (arm64 for 64-bit OS)
# --- Path B only ---
NODE_CARPLAY_REF="v4.3.0"                     # PIN the node-CarPlay checkout. HEAD moves
                                             # upstream, but the @types/node + typescript pins
                                             # in PHASE 3B are matched to THIS ref. Best value
                                             # is the exact SHA from the known-good microSD:
                                             #   git -C ~/node-CarPlay rev-parse HEAD
# ============================================================================

# Normalise + validate the path selector before doing any work.
case "${TARGET_PATH}" in
  a|A) TARGET_PATH="a" ;;
  b|B) TARGET_PATH="b" ;;
  *) echo "!!! TARGET_PATH must be 'a' or 'b' (got: '${TARGET_PATH}')." >&2; exit 1 ;;
esac

# Report where we died and reassure that a re-run is safe (the script is idempotent).
trap 'echo "!!! provision.sh failed at line ${LINENO} — fix the cause and re-run; the script is re-run safe." >&2' ERR

echo "=== S660 CarPlay provisioning — user: ${CARPLAY_USER}, path: ${TARGET_PATH} ==="
echo "=== NOTE: reboot required at the end. See PHASE 5. ==="


# ============================================================================
# PHASE 0 — Boot-time trims  [COMMON]  (see BUILD_NOTES Section 4)
# ============================================================================
echo ">>> PHASE 0: boot-time trims"

# cloud-init: first-boot setup tool, present on RPi OS Lite; not needed every boot (~3s).
sudo systemctl disable cloud-init cloud-init-local cloud-config cloud-final 2>/dev/null || true
sudo touch /etc/cloud/cloud-init.disabled

# apt-daily: background update check. Disable the TIMERS (not just the services) and mask,
# so nothing re-triggers them. A dash unit updates on your schedule, not at boot.
sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
sudo systemctl mask apt-daily.service apt-daily-upgrade.service 2>/dev/null || true

# Optional: disable clearly-unused services. Comment out any you actually use.
sudo systemctl disable man-db.service avahi-daemon.service 2>/dev/null || true
# sudo systemctl disable bluetooth.service   # leave enabled if you use Bluetooth

# config.txt: remove the splash delay and boot pause.
if ! grep -q "^disable_splash=1" /boot/firmware/config.txt; then
  echo "disable_splash=1" | sudo tee -a /boot/firmware/config.txt >/dev/null
fi
if ! grep -q "^boot_delay=0" /boot/firmware/config.txt; then
  echo "boot_delay=0" | sudo tee -a /boot/firmware/config.txt >/dev/null
fi


# ============================================================================
# PHASE 1 — Kiosk display: cage + seatd  [COMMON]
# ============================================================================
echo ">>> PHASE 1: cage + seatd"

sudo apt update
sudo apt install -y cage

# seatd lets cage claim the display/input with NO login session present.
# GOTCHA: this build's seatd.service runs `seatd -g video` — the allowed group is
# "video", NOT "seat". (The `seat` group does not exist here.) Confirm on a new board:
#   systemctl cat seatd.service
sudo apt install --no-install-recommends -y seatd
sudo systemctl enable --now seatd
sudo usermod -aG video "${CARPLAY_USER}"

# The dongle also needs plugdev (udev rule below grants access to that group).
sudo usermod -aG plugdev "${CARPLAY_USER}"

echo ">>> Group changes (video, plugdev) take effect at next login. Nothing later in this"
echo ">>> script needs them, and the mandatory reboot at the end applies them — so just let"
echo ">>> it run through; no need to log out and re-run."


# ============================================================================
# PHASE 2 — Dongle udev rule  [COMMON]
# ============================================================================
echo ">>> PHASE 2: Carlinkit udev rule"

# Grants normal-user access to the Carlinkit dongle over USB.
# Vendor 1314, product 152* = Carlinkit CPC200-CCPA / CCPM.
# NOTE: the dongle is REQUIRED (it does the Apple MFi handshake). You cannot plug the
# phone straight into the Pi. "Wired mode" = phone-to-dongle by cable. See BUILD_NOTES 7.
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="152*", MODE="0660", GROUP="plugdev"' \
  | sudo tee /etc/udev/rules.d/52-nodecarplay.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger


# ============================================================================
# PHASE 3 — App stack  [branches on TARGET_PATH]
# ============================================================================
if [ "${TARGET_PATH}" = "a" ]; then

  # -------- PHASE 3A: Path A — react-carplay Electron AppImage (software) --------
  echo ">>> PHASE 3A: Path A (Electron AppImage)"

  # FUSE compat library for AppImages on Trixie.
  sudo apt install -y libfuse2t64 || sudo apt install -y libfuse2

  # GOTCHA: the AppImage launcher needs the UNVERSIONED libz.so, which normally ships only
  # in the -dev package. Rather than install a compiler, symlink it. A future Debian may
  # ship libz.so directly or move the path — revisit if this errors. See BUILD_NOTES 6.2.
  if [ ! -e /usr/lib/aarch64-linux-gnu/libz.so ]; then
    sudo ln -s /usr/lib/aarch64-linux-gnu/libz.so.1 /usr/lib/aarch64-linux-gnu/libz.so
    sudo ldconfig
  fi

  mkdir -p "/home/${CARPLAY_USER}/react-carplay"
  cd "/home/${CARPLAY_USER}/react-carplay"
  if [ ! -f carplay.AppImage ]; then
    # -f: fail on HTTP errors. Without it a 404 (e.g. wrong RC_VERSION) writes an HTML error
    # page INTO the file, which then fails confusingly at --appimage-extract. --retry: ride
    # out transient network blips.
    curl -fL --retry 3 "https://github.com/rhysmorgan134/react-carplay/releases/download/v${RC_VERSION}/react-carplay-${RC_VERSION}-${ARCH_SUFFIX}.AppImage" \
      --output carplay.AppImage
    chmod +x carplay.AppImage
  fi
  # Extract instead of FUSE-mounting: removes the mount step from every launch, and
  # sidesteps the launcher. Real binary ends up at squashfs-root/react-carplay.
  if [ ! -d squashfs-root ]; then
    ./carplay.AppImage --appimage-extract
  fi

else

  # -------- PHASE 3B: Path B — system Chromium + carplay-web-app (GPU) --------
  echo ">>> PHASE 3B: Path B (system Chromium + web app)"

  # System Chromium HAS the Raspberry Pi GBM/V4L2 patches upstream Electron lacks, so it
  # composites on the GPU where Electron crashed. Package is "chromium" on Trixie.
  sudo apt install -y chromium

  # Node.js from NodeSource (NOT apt's nodejs — too old). Node 20 LTS.
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
  fi

  # Clone node-CarPlay (the web app lives inside it and references the parent by relative
  # path, so we need the whole repo).
  cd "/home/${CARPLAY_USER}"
  if [ ! -d node-CarPlay ]; then
    git clone https://github.com/rhysmorgan134/node-CarPlay.git
    # Pin to the known-good ref INSIDE the clone guard: npm (below) dirties package.json, so
    # a checkout on a later re-run would conflict. Fresh clone only. See NODE_CARPLAY_REF.
    git -C node-CarPlay checkout "${NODE_CARPLAY_REF}"
  fi
  cd node-CarPlay

  # GOTCHA (the big one): the pinned node-CarPlay ref was written against OLDER type defs
  # than a fresh Node 20 provides. package.json declares @types/node@^18.11.9 +
  # typescript@^5.2.2, but the caret lets npm pull too-new patches that reintroduce
  # Timer/SharedArrayBuffer type errors. Pin EXACTLY. See BUILD_NOTES 11.3.
  npm install --save-dev @types/node@18.11.9 typescript@5.2.2

  # Build ONLY the web target. The Node target has type errors we do not need (the web
  # app never uses the Node USB path — it uses WebUSB in the browser).
  npx tsc --build ./src/web/tsconfig.json

  # Install the web app's deps. --ignore-scripts avoids re-triggering the parent's
  # "prepare": "npm run build", which runs the FULL (failing) build. See BUILD_NOTES 11.3.
  # DO NOT run `npm audit fix --force` afterwards — it breaks the build. See BUILD_NOTES 11.4.
  cd "/home/${CARPLAY_USER}/node-CarPlay/examples/carplay-web-app"
  npm install --ignore-scripts

  echo ">>> Path B stack ready. Launch by hand ON THE PI:"
  echo ">>>   Terminal 1:  cd ~/node-CarPlay/examples/carplay-web-app && npm start"
  echo ">>>   Terminal 2:  cage -- chromium --ozone-platform=wayland --kiosk --no-sandbox http://localhost:3000"
  echo ">>> WebUSB only works on localhost/HTTPS ON THE PI — a remote browser shows blank."

fi


# ============================================================================
# PHASE 4 — Autostart service  [branches on TARGET_PATH]
# ============================================================================
if [ "${TARGET_PATH}" = "a" ]; then

  echo ">>> PHASE 4: systemd service (Path A)"

  # Frees tty1 so our service can claim it.
  sudo systemctl disable getty@tty1.service 2>/dev/null || true

  # --disable-gpu is INTENTIONAL for Path A: real GPU accel crashes on this board's v3d/vc4
  # dma_buf scanout bug, then falls back to software anyway. This flag gets the same stable
  # end state without the crashes, so Settings saves (app.relaunch) don't crash.
  #
  # Restart=always (NOT on-failure): react-carplay calls app.relaunch() on Settings save,
  # which is a CLEAN exit; on-failure would ignore it and the app would not come back.
  sudo tee /etc/systemd/system/carplay.service > /dev/null << EOF
[Unit]
Description=S660 CarPlay kiosk (cage + react-carplay, Path A / software)
After=local-fs.target seatd.service
Wants=seatd.service

[Service]
User=${CARPLAY_USER}
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal
ExecStart=/usr/bin/cage -- /home/${CARPLAY_USER}/react-carplay/squashfs-root/react-carplay --no-sandbox --disable-gpu
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable carplay.service

else

  echo ">>> PHASE 4: Path B has NO autostart service yet (video-decode test pending; BUILD_NOTES 11.7)."
  echo ">>> tty1 login is left ENABLED so you can log in after boot and launch Path B by hand,"
  echo ">>> using the two commands printed in PHASE 3B above."
  # ----- Path B service (Chromium, GPU) — TEMPLATE, do NOT enable blind -----
  # Enable a unit like this ONLY once video decode is confirmed. It needs the web app served
  # locally first (dev server, or better a static production build + a tiny static server).
  # See BUILD_NOTES 11.7. It reuses Path A's tty/PAM block verbatim; only ExecStart changes:
  #
  #   ExecStart=/usr/bin/cage -- /usr/bin/chromium --ozone-platform=wayland --kiosk \
  #     --no-sandbox http://localhost:3000
  #
  # When you build it, also disable getty@tty1 (as Path A does) so the service can claim tty1.

fi


# ============================================================================
# PHASE 5 — DONE
# ============================================================================
echo ""
echo "=== Provisioning complete (path ${TARGET_PATH}) ==="
echo ""
if [ "${TARGET_PATH}" = "a" ]; then
  echo "CRITICAL: you must REBOOT now. Starting/stopping the service live does NOT reliably"
  echo "set up the VT/PAM session (it loops every ~2s). A clean boot fixes it:"
  echo ""
  echo "    sudo reboot"
  echo ""
  echo "After reboot, Path A (Electron/software) autostarts."
else
  echo "REBOOT to apply the group changes and boot trims:"
  echo ""
  echo "    sudo reboot"
  echo ""
  echo "Path B does NOT autostart yet. After reboot, log in on the Pi and run the two"
  echo "by-hand commands from PHASE 3B to bring up Chromium + the web app."
fi
