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
# TWO CHANNELS (see BUILD_NOTES §8.5 and §14) — install either or BOTH; toggle at runtime:
#   Path A (STABLE)  = Electron AppImage, software rendering (--disable-gpu). Proven.
#                      Installed as carplay.service, ENABLED (autostarts at boot).
#   Path B (DEV)     = system Chromium + carplay-web-app, GPU-accelerated compositing.
#                      Installed as carplay-dev-chromium.service, DISABLED. Switch to it by
#                      enabling it and rebooting (see PHASE 5) — verified on the CM4 2026-08-24.
#
# Both service files can live on the machine at once, but only ONE may run at a time (both
# own tty1). SWITCH by enabling one + rebooting — NOT by `systemctl start` while the other is
# up: the live cage->cage handoff drops the HDMI output (screen goes blank until reboot;
# confirmed on the CM4, BUILD_NOTES §20). The dev unit's Conflicts=carplay.service is kept
# only as a safety net so both can never run at once. This is the §14 stable/dev channel
# toggle: the stable react-carplay install is never clobbered, even while you experiment
# with the (faster-compositing) Chromium channel.
#
#   Fresh machine (default):   INSTALL_STABLE_A=yes  INSTALL_DEV_CHROMIUM=no
#   Add the dev channel to an  INSTALL_STABLE_A=no   INSTALL_DEV_CHROMIUM=yes
#     already-working box:       (skips re-provisioning + rewriting the stable install)
#
# The COMMON phases (0, 1, 2) run every time. Only PHASE 3 (app stacks) and PHASE 4
# (services) branch on the flags — one file, no duplication.
#
# USAGE:
#   Set the CONFIG flags below, then:
#     chmod +x provision.sh
#     ./provision.sh
#   Then REBOOT (a clean boot is required — see PHASE 5).
#
# Run as your normal user (NOT root, NOT with sudo). The script calls sudo where needed.
# Assumes the user can sudo. Group changes are applied by the reboot at the end — no need
# to log out and re-run mid-way.

set -euo pipefail

# ============================ CONFIG — EDIT THESE ============================
INSTALL_STABLE_A="${INSTALL_STABLE_A:-yes}"          # Path A stable -> carplay.service (ENABLED)
INSTALL_DEV_CHROMIUM="${INSTALL_DEV_CHROMIUM:-no}"   # Path B dev    -> carplay-dev-chromium.service (DISABLED)
# ^ Both honour an environment override, so you can pick channels without editing this file:
#     INSTALL_STABLE_A=no INSTALL_DEV_CHROMIUM=yes ./provision.sh

CARPLAY_USER="${USER}"                        # the user the kiosk runs as             (COMMON)
# --- Path A (stable) only ---
RC_VERSION="4.0.5"                            # react-carplay AppImage version
ARCH_SUFFIX="arm64"                           # AppImage arch (arm64 for 64-bit OS)
# --- Path B (dev) only ---
# node-carplay + carplay-web-app are VENDORED in this repo (hardware/path-b/node-CarPlay,
# MIT, modified from upstream rhysmorgan134/node-CarPlay) as of 2026-09-12 — there is no
# separate clone/pin to configure here any more. See BUILD_NOTES §23 and
# hardware/path-b/node-CarPlay/README.md.
# Single source of truth for the Bluetooth boot-relative delay (BUILD_NOTES §24) — used to
# template BOTH bluetooth-late.timer's OnBootSec= and the ExecStartPre delay math in
# bluetooth.service.d-startup-delay.conf below, so tuning this one number can't desync them.
BLUETOOTH_DELAY_SEC=15
# ============================================================================

DEV_DIR="/home/${CARPLAY_USER}/carplay-dev"   # holds the Path B launch wrapper

# Truthy test for the yes/no flags (accepts y/yes/true/1, any case). Written without the
# bash-4 ${x,,} lowercase so it also runs on older bashes.
is_yes() {
  case "$1" in
    y|Y|yes|Yes|YES|true|True|TRUE|1) return 0 ;;
    *) return 1 ;;
  esac
}

# Validate: at least one channel must be selected.
if ! is_yes "${INSTALL_STABLE_A}" && ! is_yes "${INSTALL_DEV_CHROMIUM}"; then
  echo "!!! Nothing to do: set INSTALL_STABLE_A and/or INSTALL_DEV_CHROMIUM to 'yes'." >&2
  exit 1
fi

# Report where we died and reassure that a re-run is safe (the script is idempotent).
trap 'echo "!!! provision.sh failed at line ${LINENO} — fix the cause and re-run; the script is re-run safe." >&2' ERR

echo "=== S660 CarPlay provisioning — user: ${CARPLAY_USER} ==="
echo "=== channels: stable A=${INSTALL_STABLE_A}, dev Chromium B=${INSTALL_DEV_CHROMIUM} ==="
echo "=== NOTE: reboot required at the end. See PHASE 5. ==="


# ============================================================================
# PHASE 0 — Boot-time trims  [COMMON]  (see BUILD_NOTES Section 4 and Section 22)
# ============================================================================
# Section 22 measured every one of these on the CM4 (2026-09-05). Net effect: the Path B
# kiosk is on screen ~5.7 s after kernel start instead of ~14.5 s (26 s stopwatch from
# power-on). Nothing network-related is allowed on the boot path — Wi-Fi is never
# guaranteed in the car. Files referenced as path-b/... live next to this script.
echo ">>> PHASE 0: boot-time trims"
PB="$(cd "$(dirname "$0")" && pwd)/path-b"

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

# Services a kiosk does not need. Host Bluetooth is REQUIRED for the trackpad and
# is started separately below. rpi-eeprom-update: with
# RPI_EEPROM_IMMEDIATE_UPDATE=1 it can FLASH THE BOOTLOADER at boot in the car — a power cut
# mid-flash means SD-card recovery; update by hand, on the bench. The rest have nothing to do.
sudo systemctl disable rpi-eeprom-update.service sshswitch.service \
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
sudo install -m 644 "${PB}/network-late.timer" /etc/systemd/system/network-late.timer
sudo mkdir -p /etc/systemd/system/NetworkManager.service.d
sudo install -m 644 "${PB}/NetworkManager.service.d-wants-wpa.conf" /etc/systemd/system/NetworkManager.service.d/wants-wpa.conf
sudo ln -sfn /usr/lib/systemd/system/wpa_supplicant.service /etc/systemd/system/dbus-fi.w1.wpa_supplicant1.service
sudo systemctl enable NetworkManager-dispatcher.service network-late.timer 2>/dev/null || true

# Bluetooth is required for the trackpad, but not during kiosk startup. Remove its
# automatic bluetooth.target start, preserve D-Bus activation, and start from a timer.
# A service pre-start delay also covers Chromium's early D-Bus request for BlueZ.
# Do not disable the radio or erase pairing data. See BUILD_NOTES section 24.
# `apt update` first: every other package install in this script runs after PHASE 1's
# `apt update`, but this one is early enough (PHASE 0) that a stale/pruned index on a
# fresh image could fail it before seatd, the dongle udev rule, or either app stack
# ever gets installed.
sudo apt update
sudo apt-get install -y --no-install-recommends bluez python3

# `systemctl disable` removes ALL of bluetooth.service's declared [Install] aliases,
# including the one D-Bus uses to activate it on demand -- not just the boot-target want.
# Discover the ACTUAL declared alias from the installed unit file instead of hardcoding
# "dbus-org.bluez.service", so a future bluez package that renames or drops it is caught
# here (loudly) instead of silently breaking D-Bus activation with no error from `ln`.
BLUEZ_UNIT_FILE="$(systemctl show bluetooth.service --property=FragmentPath --value 2>/dev/null || true)"
BLUEZ_ALIAS="$(sed -n 's/^Alias=//p' "${BLUEZ_UNIT_FILE}" 2>/dev/null | head -1 || true)"
if [ -z "${BLUEZ_ALIAS}" ]; then
  echo "!!! bluetooth.service declares no [Install] Alias= (checked '${BLUEZ_UNIT_FILE:-<not found>}')." >&2
  echo "!!! Falling back to the historically-known dbus-org.bluez.service. Verify Chromium's" >&2
  echo "!!! early Bluetooth request (~5s after boot) still brings BlueZ up -- BUILD_NOTES §24." >&2
  BLUEZ_ALIAS="dbus-org.bluez.service"
fi
sudo systemctl disable bluetooth.service 2>/dev/null || true
sudo ln -sfn /usr/lib/systemd/system/bluetooth.service "/etc/systemd/system/${BLUEZ_ALIAS}"
# bluetooth-late.timer / bluetooth.service.d-startup-delay.conf both reference
# @BLUETOOTH_DELAY_SEC@ -- substitute the one BLUETOOTH_DELAY_SEC value from CONFIG above
# so the timer and the D-Bus-activation delay can never drift out of sync (BUILD_NOTES §24).
sed "s/@BLUETOOTH_DELAY_SEC@/${BLUETOOTH_DELAY_SEC}/g" "${PB}/bluetooth-late.timer" \
  | sudo tee /etc/systemd/system/bluetooth-late.timer >/dev/null
sudo mkdir -p /etc/systemd/system/bluetooth.service.d
sed "s/@BLUETOOTH_DELAY_SEC@/${BLUETOOTH_DELAY_SEC}/g" "${PB}/bluetooth.service.d-startup-delay.conf" \
  | sudo tee /etc/systemd/system/bluetooth.service.d/startup-delay.conf >/dev/null
sudo systemctl enable bluetooth-late.timer 2>/dev/null || true

# No swap: 8 GB RAM, and the default 2 GB swap file + 2 GB zram cost ~0.6 s of boot CPU.
sudo mkdir -p /etc/rpi/swap.conf.d
sudo install -m 644 "${PB}/rpi-swap.conf.d-90-boot-tuning.conf" /etc/rpi/swap.conf.d/90-boot-tuning.conf
# Mechanism=none still leaves both generators and the vendor zram module preload.
# Keep the packages installed, but suppress this unused work on the no-swap kiosk.
sudo mkdir -p /etc/systemd/system-generators
sudo ln -sfn /dev/null /etc/systemd/system-generators/zram-generator
sudo ln -sfn /dev/null /etc/systemd/system-generators/rpi-swap-generator
sudo ln -sfn /dev/null /etc/modules-load.d/20-zram-generator.conf

# GPU modules in sysinit. A fast boot lets cage start before udev has loaded vc4; cage
# then fails with "Found 0 GPUs" and HANGS (Restart=always never fires). See §22.2.
sudo install -m 644 "${PB}/modules-load.d-carplay-gpu.conf" /etc/modules-load.d/carplay-gpu.conf

# /boot/firmware: automount on first access instead of holding up local-fs.target.
sudo sed -i -E 's|^(PARTUUID=\S+\s+/boot/firmware\s+vfat\s+)defaults(\s+)0\s+2$|\1defaults,noauto,x-systemd.automount,nofail\20  0|' /etc/fstab

# Use the same ARM64 kernel without firmware gzip decompression. Refresh atomically
# after the distribution's z50-raspi-firmware hooks, including initramfs-only updates.
# Keep the packaged kernel8.img for rollback and as the source after every update.
sudo install -m 755 "${PB}/update-uncompressed-kernel" /usr/local/sbin/s660-update-uncompressed-kernel
sudo ln -sfn /usr/local/sbin/s660-update-uncompressed-kernel /etc/kernel/postinst.d/zz-s660-uncompressed
sudo ln -sfn /usr/local/sbin/s660-update-uncompressed-kernel /etc/initramfs/post-update.d/zz-s660-uncompressed
sudo /usr/local/sbin/s660-update-uncompressed-kernel

# Safety net (BUILD_NOTES §24/§25): nothing ties kernel8-uncompressed.img's freshness to
# the currently-installed kernel/modules other than the two hooks above firing correctly.
# If either silently fails after a future kernel upgrade (permissions, hook-ordering
# change, a kernel installed via a path that bypasses standard triggers), the Pi would
# otherwise keep booting a stale kernel image indefinitely -- a mismatch against newer
# modules can hang cage on "Found 0 GPUs" with no display to diagnose it (BUILD_NOTES
# §22.2). This timer re-runs the same idempotent refresh well after the kiosk is already
# on screen (no boot-critical cost), bounding any such staleness to at most one bad boot
# instead of forever. The script also now logs success/failure via `logger`, so a failure
# here is findable with `journalctl -t s660-update-uncompressed-kernel` even though this
# runs headless with no display.
sudo install -m 644 "${PB}/kernel-refresh-late.timer" /etc/systemd/system/kernel-refresh-late.timer
sudo install -m 644 "${PB}/kernel-refresh-late.service" /etc/systemd/system/kernel-refresh-late.service
sudo systemctl enable kernel-refresh-late.timer 2>/dev/null || true

# config.txt: no splash/boot pause; no initramfs (kernel has nvme+ext4+pcie built in);
# no camera/DSI probing. hdmi_group/hdmi_mode/hdmi_force_hotplug are IGNORED under
# vc4-kms-v3d + disable_fw_kms_setup=1 — the mode is pinned in cmdline.txt below.
for kv in disable_splash=1 boot_delay=0 auto_initramfs=0 camera_auto_detect=0 display_auto_detect=0 kernel=kernel8-uncompressed.img force_eeprom_read=0 disable_poe_fan=1; do
  k=${kv%%=*}
  if grep -q "^$k=" /boot/firmware/config.txt; then
    sudo sed -i "s/^$k=.*/$kv/" /boot/firmware/config.txt
  else
    echo "$kv" | sudo tee -a /boot/firmware/config.txt >/dev/null
  fi
done

# Display mode. The car panel is an 800x480 glass behind a TV-style scaler whose EDID offers
# only 720x480@59.94 (preferred) and 720x576@50; the bench 4K monitor prefers 3840x2160.
# `video=` on the cmdline only pins the kernel CONSOLE — cage/wlroots picks the connector's
# EDID-preferred mode and ignored it (measured: cage ran 3840x2160 on the bench, §22.2). So
# the kernel is given an EDID override (path-b/s660-edid.bin): the panel's own EDID with NO
# detailed timings (a DTD mode carries no aspect and the kernel merges the 16:9 CEA twin into
# it -> AVI said 4:3) and a video data block of just VIC 3 (720x480 16:9, native) + VGA. The
# kernel's first listed mode is then 720x480 tagged 16:9 and the AVI infoframe says VIC 3 —
# verified on the car panel (§22.6; 576p50 looked horizontally stretched on the glass). Bench
# or car, every consumer sees the same mode. If the panel is ever replaced, regenerate it.
sudo install -D -m 644 "${PB}/s660-edid.bin" /lib/firmware/edid/s660.bin

# cmdline.txt (ONE line): drop the 115200-baud serial console (~2 s of synchronous kernel
# output), quiet the kernel, pin the console mode ("D" forces the connector on without
# waiting for hotplug) and point DRM at the EDID override above. For serial debugging,
# temporarily put "console=serial0,115200" back.
ROOT_PARTUUID=$(sed -nE 's/.*root=(PARTUUID=[^ ]+).*/\1/p' /boot/firmware/cmdline.txt)
echo "console=tty1 root=${ROOT_PARTUUID} rootfstype=ext4 fsck.repair=yes rootwait cfg80211.ieee80211_regdom=PT quiet loglevel=3 vt.global_cursor_default=0 video=HDMI-A-1:720x480@60D drm.edid_firmware=HDMI-A-1:edid/s660.bin" \
  | sudo tee /boot/firmware/cmdline.txt >/dev/null

sudo systemctl daemon-reload


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

# The Pi's vc4 HDMI-CEC receivers ("vc4-hdmi-0/1" — one per HDMI port, registered by the
# driver whether or not the panel does CEC; it doesn't) advertise REL_X/REL_Y +
# INPUT_PROP_POINTING_STICK, so libinput treats them as pointers, the Wayland seat gets
# pointer capability and Chromium puts a cursor on screen that nothing can ever move
# (BUILD_NOTES 22.7). Hide them from libinput. Both kiosk units then run with ZERO input
# devices, which wlroots only tolerates with WLR_LIBINPUT_NO_DEVICES=1 (set in each unit).
sudo install -m 644 "${PB}/71-s660-libinput-ignore-cec.rules" /etc/udev/rules.d/71-s660-libinput-ignore-cec.rules

sudo udevadm control --reload-rules
sudo udevadm trigger


# ============================================================================
# PHASE 3 — App stacks  [branches on the flags]
# ============================================================================
if is_yes "${INSTALL_STABLE_A}"; then

  # -------- PHASE 3A: Path A — react-carplay Electron AppImage (software) --------
  echo ">>> PHASE 3A: Path A stable (Electron AppImage)"

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

fi

if is_yes "${INSTALL_DEV_CHROMIUM}"; then

  # -------- PHASE 3B: Path B — system Chromium + carplay-web-app (GPU) --------
  echo ">>> PHASE 3B: Path B dev (system Chromium + web app)"

  # System Chromium HAS the Raspberry Pi GBM/V4L2 patches upstream Electron lacks, so it
  # composites on the GPU where Electron crashed. Package is "chromium" on Trixie.
  sudo apt install -y chromium

  # Node.js from NodeSource (NOT apt's nodejs — too old). Node 20 LTS.
  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
  fi

  # node-carplay + carplay-web-app are VENDORED in this repo (hardware/path-b/node-CarPlay) —
  # not a separate clone. All S660-specific changes (RHD/geometry/logo, on-screen connection
  # status, USB reset/reconnect fixes — BUILD_NOTES §21, §22, §23) are already applied directly
  # in that source, so building it IS applying them: there is nothing to reconstruct or keep in
  # sync separately. See hardware/path-b/node-CarPlay/README.md.
  NODE_CARPLAY_DIR="${PB}/node-CarPlay"
  cd "${NODE_CARPLAY_DIR}"

  # GOTCHA, for context (BUILD_NOTES §11.3, §23): the library was originally written against
  # older type definitions than a fresh Node 20 provides, and its package.json's caret ranges
  # on @types/node/typescript can drift to versions that reintroduce Timer/SharedArrayBuffer
  # type errors. The vendored package-lock.json here already pins the working versions, so a
  # plain `npm install` (which honours the lockfile) should just work. If the lockfile is ever
  # deleted/regenerated and this resurfaces, re-pin with:
  #   npm install --save-dev --save-exact @types/node@18.11.9 typescript@5.2.2
  npm install

  # Build the library: modules (shared) first, then the web target the browser app imports.
  # The Node target (src/node) has pre-existing type errors we don't need — the web app never
  # uses the Node USB path — so it is deliberately not built here.
  npx tsc --build ./tsconfig.build.json
  npx tsc --build ./src/web/tsconfig.json     # should complete silently, 0 errors

  # Install the web app's deps. --ignore-scripts avoids re-triggering the parent's
  # "prepare": "npm run build", which runs the FULL (failing) build. See BUILD_NOTES 11.3.
  # DO NOT run `npm audit fix --force` afterwards — it breaks the build. See BUILD_NOTES 11.4.
  cd "${NODE_CARPLAY_DIR}/examples/carplay-web-app"
  npm install --ignore-scripts

  # Production build. The kiosk wrapper serves build/ through serve-build.js (which sends the
  # COOP/COEP headers SharedArrayBuffer needs) instead of the CRA dev server, which recompiled
  # the app at EVERY boot (~12 s on the CM4). Re-run this after any App.tsx change.
  CI=false npm run build

fi


# ============================================================================
# PHASE 4 — Services  [branches on the flags]
# ============================================================================
echo ">>> PHASE 4: services"

# The kiosk owns tty1; you SSH in for a shell. Free tty1 if we install ANY kiosk service.
if is_yes "${INSTALL_STABLE_A}" || is_yes "${INSTALL_DEV_CHROMIUM}"; then
  sudo systemctl disable getty@tty1.service 2>/dev/null || true
fi

# ----- Path A: carplay.service (Electron, software) — ENABLED (autostarts) -----
if is_yes "${INSTALL_STABLE_A}"; then
  echo ">>> PHASE 4A: carplay.service (stable, enabled)"

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
# Zero input devices is normal here (BUILD_NOTES 22.7); wlroots refuses to start otherwise.
Environment=WLR_LIBINPUT_NO_DEVICES=1
ExecStart=/usr/bin/cage -- /home/${CARPLAY_USER}/react-carplay/squashfs-root/react-carplay --no-sandbox --disable-gpu
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl enable carplay.service
fi

# ----- Path B: carplay-dev-chromium.service (Chromium, GPU) — INSTALLED, DISABLED -----
if is_yes "${INSTALL_DEV_CHROMIUM}"; then
  echo ">>> PHASE 4B: carplay-dev-chromium.service (dev, installed but DISABLED)"

  # Launch wrapper + static server + unit are VERSIONED in path-b/ (BUILD_NOTES §22/24).
  # Node and cage start together once the KMS connector exists. Cage's child invokes the
  # wrapper's --browser branch, which waits for HTTP before execing Chromium. All processes
  # live in this unit's cgroup, so a `systemctl stop`
  # (or the Conflicts= switch back to carplay.service) tears the web server down too.
  mkdir -p "${DEV_DIR}"
  install -m 775 "${PB}/run-chromium-kiosk.sh" "${DEV_DIR}/run-chromium-kiosk.sh"
  install -m 664 "${PB}/serve-build.js" "${DEV_DIR}/serve-build.js"

  # The unit. No PAMName=login: cage talks to seatd directly, RuntimeDirectory= provides
  # XDG_RUNTIME_DIR, and skipping the logind session saves user@1000 + a session bus at boot
  # (Chromium logs harmless "Failed to connect to the bus" lines as a result). Conflicts=
  # keeps the two kiosks mutually exclusive. Deliberately NOT enabled here (see PHASE 5).
  sed -e "s/^User=s660$/User=${CARPLAY_USER}/" \
      -e "s|^ExecStart=.*|ExecStart=${DEV_DIR}/run-chromium-kiosk.sh|" \
      "${PB}/carplay-dev-chromium.service" | sudo tee /etc/systemd/system/carplay-dev-chromium.service > /dev/null
fi

sudo systemctl daemon-reload


# ============================================================================
# PHASE 5 — DONE
# ============================================================================
echo ""
echo "=== Provisioning complete (stable A=${INSTALL_STABLE_A}, dev Chromium B=${INSTALL_DEV_CHROMIUM}) ==="
echo ""
echo "CRITICAL: REBOOT now. Starting a kiosk service live does NOT reliably set up the"
echo "VT/PAM session on first setup (it loops every ~2s); a clean boot fixes it:"
echo ""
echo "    sudo reboot"
echo ""

if is_yes "${INSTALL_STABLE_A}"; then
  echo "After reboot, Path A (Electron/software) autostarts via carplay.service."
fi

if is_yes "${INSTALL_DEV_CHROMIUM}"; then
  echo ""
  echo "Path B is installed as carplay-dev-chromium.service but DISABLED (no autostart)."
  echo "Switch channels by enabling ONE and rebooting (verified on the CM4 2026-08-24):"
  echo "    # -> dev Chromium/GPU:"
  echo "    sudo systemctl disable carplay.service && sudo systemctl enable carplay-dev-chromium.service && sudo reboot"
  echo "    # -> stable Electron:"
  echo "    sudo systemctl disable carplay-dev-chromium.service && sudo systemctl enable carplay.service && sudo reboot"
  echo "Do NOT hot-switch with 'systemctl start' while the other kiosk is up: the live"
  echo "cage->cage handoff drops the HDMI output (screen blank until reboot). Conflicts= is"
  echo "kept only as a safety net so both can never run at once."
  echo "Wi-Fi/SSH come up ~30 s after power-on by design (network-late.timer, BUILD_NOTES 22)."
fi
