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
# PHASE 0 — Boot-time trims (see BUILD_NOTES Section 4 and Section 18)
# ============================================================================
# Section 18 measured every one of these on the CM4 (2026-09-05). Net effect: the Path B
# kiosk is on screen ~5.7 s after kernel start instead of ~14.5 s. Nothing network-related
# is allowed on the boot path — Wi-Fi is never guaranteed in the car.
echo ">>> PHASE 0: boot-time trims"

# cloud-init: first-boot tool. Even when "disabled" its generator + units load every boot,
# so purge it outright. (netplan.io must STAY — RPi's network-manager depends on it.)
sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y cloud-init rpi-cloud-init-mods 2>/dev/null || true
sudo apt-get -y autoremove --purge 2>/dev/null || true

# apt-daily: background update check. Disable the TIMERS (not just the services) and mask,
# so nothing re-triggers them. A dash unit updates on your schedule, not at boot.
sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
sudo systemctl mask apt-daily.service apt-daily-upgrade.service 2>/dev/null || true

# Persistent timers all fire in the first minute after the car sat overnight. Drop the
# ones we never want; keep logrotate/fstrim but stop them catching up at boot.
sudo systemctl disable man-db.timer dpkg-db-backup.timer e2scrub_all.timer 2>/dev/null || true
for t in logrotate fstrim; do
  sudo mkdir -p /etc/systemd/system/$t.timer.d
  printf '[Timer]\nPersistent=false\n' | sudo tee /etc/systemd/system/$t.timer.d/no-persistent.conf >/dev/null
done

# Services a kiosk does not need. bluetooth: the Carlinkit dongle does its own BT.
# rpi-eeprom-update: with RPI_EEPROM_IMMEDIATE_UPDATE=1 it can FLASH THE BOOTLOADER at
# boot in the car — a power cut mid-flash means SD-card recovery. Update by hand, on the
# bench. sshswitch/e2scrub_reap/keyboard-setup/console-setup: nothing for us to do.
sudo systemctl disable bluetooth.service rpi-eeprom-update.service sshswitch.service \
  e2scrub_reap.service keyboard-setup.service console-setup.service avahi-daemon.service 2>/dev/null || true
sudo systemctl --global disable mpris-proxy.service 2>/dev/null || true
# binfmt sits ON the kiosk's critical chain and only registers python3. upower is only
# ever D-Bus-activated by Chromium.
sudo systemctl mask systemd-binfmt.service proc-sys-fs-binfmt_misc.automount \
  proc-sys-fs-binfmt_misc.mount upower.service 2>/dev/null || true

# Networking OFF the boot path: NetworkManager starts from a timer 20 s after boot
# (Chromium is long up). Disabling NM removes two D-Bus aliases we still want, so they
# are re-created, and a drop-in makes NM pull wpa_supplicant with it.
# CONSEQUENCE: SSH is reachable ~30 s after power-on. Do not "fix" this.
sudo systemctl disable NetworkManager.service wpa_supplicant.service 2>/dev/null || true
sudo install -m 644 "$(dirname "$0")/path-b/network-late.timer" /etc/systemd/system/network-late.timer
sudo mkdir -p /etc/systemd/system/NetworkManager.service.d
sudo install -m 644 "$(dirname "$0")/path-b/NetworkManager.service.d-wants-wpa.conf" \
  /etc/systemd/system/NetworkManager.service.d/wants-wpa.conf
sudo ln -sfn /usr/lib/systemd/system/wpa_supplicant.service /etc/systemd/system/dbus-fi.w1.wpa_supplicant1.service
sudo systemctl enable NetworkManager-dispatcher.service network-late.timer 2>/dev/null || true

# No swap: 8 GB RAM, and the default 2 GB swap file + 2 GB zram cost ~0.6 s of boot CPU.
sudo mkdir -p /etc/rpi/swap.conf.d
sudo install -m 644 "$(dirname "$0")/path-b/rpi-swap.conf.d-90-boot-tuning.conf" /etc/rpi/swap.conf.d/90-boot-tuning.conf

# GPU modules in sysinit. A fast boot lets cage start before udev has loaded vc4; cage
# then fails with "Found 0 GPUs" and HANGS (Restart=always never fires). See 18.2.
sudo install -m 644 "$(dirname "$0")/path-b/modules-load.d-carplay-gpu.conf" /etc/modules-load.d/carplay-gpu.conf

# /boot/firmware: automount on first access instead of holding up local-fs.target.
sudo sed -i -E 's|^(PARTUUID=\S+\s+/boot/firmware\s+vfat\s+)defaults(\s+)0\s+2$|\1defaults,noauto,x-systemd.automount,nofail\20  0|' /etc/fstab

# config.txt: no splash/boot pause; no initramfs (kernel has nvme+ext4+pcie built in);
# no camera/DSI probing. hdmi_group/hdmi_mode/hdmi_force_hotplug are IGNORED under
# vc4-kms-v3d + disable_fw_kms_setup=1 — the mode is pinned in cmdline.txt below.
for kv in disable_splash=1 boot_delay=0 auto_initramfs=0 camera_auto_detect=0 display_auto_detect=0; do
  k=${kv%%=*}
  if grep -q "^$k=" /boot/firmware/config.txt; then
    sudo sed -i "s/^$k=.*/$kv/" /boot/firmware/config.txt
  else
    echo "$kv" | sudo tee -a /boot/firmware/config.txt >/dev/null
  fi
done

# cmdline.txt (ONE line): drop the 115200-baud serial console (~2 s of synchronous kernel
# output), quiet the kernel, pin the car panel's native mode (EDID VIC 18: 720x576@50,
# 16:9; "D" forces the connector on without waiting for hotplug). For serial debugging,
# temporarily put "console=serial0,115200" back.
ROOT_PARTUUID=$(sed -nE 's/.*root=(PARTUUID=[^ ]+).*/\1/p' /boot/firmware/cmdline.txt)
echo "console=tty1 root=${ROOT_PARTUUID} rootfstype=ext4 fsck.repair=yes rootwait cfg80211.ieee80211_regdom=PT quiet loglevel=3 vt.global_cursor_default=0 video=HDMI-A-1:720x576@50D" \
  | sudo tee /boot/firmware/cmdline.txt >/dev/null

sudo systemctl daemon-reload


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

# S660-specific App.tsx changes (BUILD_NOTES 18.5): 720x576 (the panel's EDID mode, not
# window.innerWidth which the bench 4K monitor would inflate), fps 30, and
# hand: HandDriveType.RHD so iOS puts the CarPlay sidebar on the right (right-hand drive).
# Patch is against node-CarPlay 670f19e; if it fails to apply, redo the three edits by hand.
git -C "/home/${CARPLAY_USER}/node-CarPlay" apply "$(dirname "$0")/path-b/carplay-web-app-App.tsx.patch"

# Production build. The kiosk script serves build/ via serve-build.js (COOP/COEP headers for
# SharedArrayBuffer) instead of the dev server, which recompiled at every boot (~12 s).
CI=false npm run build

# Install the kiosk pieces the Path B unit expects.
mkdir -p "/home/${CARPLAY_USER}/carplay-dev"
install -m 775 "$(dirname "$0")/path-b/run-chromium-kiosk.sh" "/home/${CARPLAY_USER}/carplay-dev/"
install -m 664 "$(dirname "$0")/path-b/serve-build.js" "/home/${CARPLAY_USER}/carplay-dev/"
sudo install -m 644 "$(dirname "$0")/path-b/carplay-dev-chromium.service" /etc/systemd/system/

echo ">>> Path B ready. Enable with: sudo systemctl enable carplay-dev-chromium (instead of carplay.service)"
echo ">>> To test by hand (with the service stopped):"
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

# ----- Path B service (Chromium, GPU) — the RUNNING unit lives in hardware/path-b/ -----
# hardware/path-b/carplay-dev-chromium.service + run-chromium-kiosk.sh + serve-build.js are
# the versioned copies of what is on the Pi (BUILD_NOTES Section 18). Install them to
# /etc/systemd/system/ and ~/carplay-dev/ and `systemctl enable carplay-dev-chromium`
# INSTEAD of carplay.service. The unit below is the Path A fallback.
#
# Old template kept for reference:
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
