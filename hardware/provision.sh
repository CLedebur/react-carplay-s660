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
# TWO PATHS (see BUILD_NOTES Section 8.5):
#   Path A = Electron AppImage, software rendering (--disable-gpu). Stable, no GPU.
#   Path B = system Chromium + carplay-web-app, GPU-accelerated compositing. CHOSEN.
# This script sets up BOTH so you can compare, and marks which is which. Pick one
# service to enable at the end (see PHASE 6).
#
# USAGE:
#   Edit the CONFIG block below, then:
#     chmod +x provision.sh
#     ./provision.sh
#   Then REBOOT (the systemd service needs a clean boot — see PHASE 6).
#
# Run as your normal user (NOT root, NOT with sudo). The script calls sudo where needed.
# Assumes the user can sudo. Log out and back in once after the group changes if you
# hit permission errors, then re-run.

set -euo pipefail

# ============================ CONFIG — EDIT THESE ============================
CARPLAY_USER="${USER}"                       # the user the kiosk runs as
RC_VERSION="4.0.5"                            # react-carplay AppImage version (Path A)
ARCH_SUFFIX="arm64"                           # AppImage arch (arm64 for 64-bit OS)
# ============================================================================

echo "=== S660 CarPlay provisioning — user: ${CARPLAY_USER} ==="
echo "=== NOTE: reboot required at the end. See PHASE 6. ==="


# ============================================================================
# PHASE 0 — Boot-time trims (optional but recommended; see BUILD_NOTES Section 4)
# ============================================================================
echo ">>> PHASE 0: boot-time trims"

# cloud-init: first-boot setup tool, not needed every boot (~3s saved).
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
# PHASE 1 — Kiosk display: cage + seatd (needed by BOTH paths)
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

echo ">>> If this is the first run, LOG OUT and back in now for the group changes to"
echo ">>> take effect, then re-run this script. (Skip if groups already applied.)"


# ============================================================================
# PHASE 2 — Dongle udev rule (needed by BOTH paths)
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
# PHASE 3A — Path A: react-carplay Electron AppImage (software render fallback)
# ============================================================================
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
  curl -L "https://github.com/rhysmorgan134/react-carplay/releases/download/v${RC_VERSION}/react-carplay-${RC_VERSION}-${ARCH_SUFFIX}.AppImage" \
    --output carplay.AppImage
  chmod +x carplay.AppImage
fi
# Extract instead of FUSE-mounting: removes the mount step from every launch, and
# sidesteps the launcher. Real binary ends up at squashfs-root/react-carplay.
if [ ! -d squashfs-root ]; then
  ./carplay.AppImage --appimage-extract
fi


# ============================================================================
# PHASE 3B — Path B: system Chromium + carplay-web-app (GPU-accelerated, CHOSEN)
# ============================================================================
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
fi
cd node-CarPlay

# GOTCHA (the big one): repo v4.3.0 was written against OLDER type defs than a fresh
# Node 20 provides. package.json declares @types/node@^18.11.9 + typescript@^5.2.2, but
# the caret lets npm pull too-new patches that reintroduce Timer/SharedArrayBuffer type
# errors. Pin EXACTLY. See BUILD_NOTES 11.3.
npm install --save-dev @types/node@18.11.9 typescript@5.2.2

# Build ONLY the web target. The Node target has type errors we do not need (the web
# app never uses the Node USB path — it uses WebUSB in the browser).
npx tsc --build ./src/web/tsconfig.json

# Install the web app's deps. --ignore-scripts avoids re-triggering the parent's
# "prepare": "npm run build", which runs the FULL (failing) build. See BUILD_NOTES 11.3.
# DO NOT run `npm audit fix --force` afterwards — it breaks the build. See BUILD_NOTES 11.4.
cd "/home/${CARPLAY_USER}/node-CarPlay/examples/carplay-web-app"
npm install --ignore-scripts

echo ">>> Path B ready. To test by hand (with the service stopped):"
echo ">>>   Terminal 1:  cd ~/node-CarPlay/examples/carplay-web-app && npm start"
echo ">>>   Terminal 2:  cage -- chromium --ozone-platform=wayland --kiosk --no-sandbox http://localhost:3000"
echo ">>> WebUSB only works on localhost/HTTPS ON THE PI — a remote browser shows blank."


# ============================================================================
# PHASE 4 — systemd service (Path A shown; Path B is TODO after the video test)
# ============================================================================
echo ">>> PHASE 4: systemd service"

# Frees tty1 so our service can claim it.
sudo systemctl disable getty@tty1.service 2>/dev/null || true

# ----- Path A service (Electron, software render) -----
# This is the currently-shipping, proven-stable unit. Path B will replace the ExecStart
# once the dongle/video test passes (see BUILD_NOTES 11.7).
#
# --disable-gpu is INTENTIONAL for Path A: real GPU accel crashes on this board's
# v3d/vc4 dma_buf scanout bug, then falls back to software anyway. This flag gets the
# same stable end state without the crashes, so Settings saves (app.relaunch) don't crash.
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

# ----- Path B service (Chromium, GPU) — TEMPLATE, commented out -----
# Enable this INSTEAD of the above once video decode is confirmed. It needs the web app
# served locally first (dev server, or better a static production build + a tiny static
# server). Left here as a reference; do not enable blind. See BUILD_NOTES 11.7.
#
# ExecStart=/usr/bin/cage -- /usr/bin/chromium --ozone-platform=wayland --kiosk \
#   --no-sandbox http://localhost:3000

sudo systemctl daemon-reload
sudo systemctl enable carplay.service


# ============================================================================
# PHASE 5 — DONE
# ============================================================================
echo ""
echo "=== Provisioning complete ==="
echo ""
echo "CRITICAL: you must REBOOT now. Starting/stopping the service live does NOT reliably"
echo "set up the VT/PAM session (it loops every ~2s). A clean boot fixes it:"
echo ""
echo "    sudo reboot"
echo ""
echo "After reboot, Path A (Electron/software) autostarts. To try Path B (Chromium/GPU),"
echo "stop the service and follow the by-hand commands printed in PHASE 3B."
