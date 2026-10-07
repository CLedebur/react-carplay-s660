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
# ONE STACK: carplay-web-app (hardware/path-b/node-CarPlay) in the Pi's system Chromium, under
# cage. Chromium composites on the GPU and decodes the CarPlay H.264 on the V4L2 hardware decoder
# (BUILD_NOTES §8.5, §27.1). Installed as carplay.service and ENABLED.
# Path A was retired on 2026-10-07 (BUILD_NOTES §32); it is preserved at the git tag path-a-final.
#
# USAGE:
#   Check the CONFIG block below, then:
#     chmod +x provision.sh
#     ./provision.sh
#   Then REBOOT (a clean boot is required — see PHASE 5).
#
# Run as your normal user (NOT root, NOT with sudo). The script calls sudo where needed.
# Assumes the user can sudo. Group changes are applied by the reboot at the end — no need
# to log out and re-run mid-way.

set -euo pipefail

# ============================ CONFIG — EDIT THESE ============================
CARPLAY_USER="${USER}"                        # the user the kiosk runs as
# node-carplay + carplay-web-app are VENDORED in this repo (hardware/path-b/node-CarPlay,
# MIT, modified from upstream rhysmorgan134/node-CarPlay) as of 2026-09-12 — there is no
# separate clone/pin to configure here any more. See BUILD_NOTES §23 and
# hardware/path-b/node-CarPlay/README.md.
# Single source of truth for the Bluetooth boot-relative delay (BUILD_NOTES §24) — used to
# template BOTH bluetooth-late.timer's OnBootSec= and the ExecStartPre delay math in
# bluetooth.service.d-startup-delay.conf below, so tuning this one number can't desync them.
BLUETOOTH_DELAY_SEC=15
# ============================================================================

KIOSK_DIR="/home/${CARPLAY_USER}/carplay-kiosk"   # holds the kiosk launch wrapper + static server

# Report where we died and reassure that a re-run is safe (the script is idempotent).
trap 'echo "!!! provision.sh failed at line ${LINENO} — fix the cause and re-run; the script is re-run safe." >&2' ERR

echo "=== S660 CarPlay provisioning — user: ${CARPLAY_USER} ==="
echo "=== NOTE: reboot required at the end. See PHASE 5. ==="


# ============================================================================
# PHASE 0 — Boot-time trims  (see BUILD_NOTES Section 4 and Section 22)
# ============================================================================
# Section 22 measured every one of these on the CM4 (2026-09-05). Net effect: the Path B
# kiosk is on screen ~5.7 s after kernel start instead of ~14.5 s (26 s stopwatch from
# power-on). Nothing network-related is allowed on the boot path — Wi-Fi is never
# guaranteed in the car. Files referenced as path-b/... live next to this script.
echo ">>> PHASE 0: boot-time trims"
PB="$(cd "$(dirname "$0")" && pwd)/path-b"
PERSIST="$(cd "$(dirname "$0")" && pwd)/persist"

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

# config.txt: no splash/boot pause; no initramfs (kernel has nvme+ext4+pcie built in);
# no camera/DSI probing. hdmi_group/hdmi_mode/hdmi_force_hotplug are IGNORED under
# vc4-kms-v3d + disable_fw_kms_setup=1 — the mode is pinned in cmdline.txt below.
# NOTE (BUILD_NOTES §26): this used to also set kernel=kernel8-uncompressed.img, with a
# postinst/initramfs hook pair plus a late-boot safety-net timer keeping a decompressed
# copy of kernel8.img in sync, to skip the firmware's own gzip decompression (~2s saved).
# Reverted 2026-09-12: a hard power cut (this car's normal shutdown path, via ignition)
# left that copy truncated to 0 bytes, which the bootloader silently refused to boot --
# no display, no network, no serial -- with no way to recover short of pulling the NVMe.
# Not worth ~2s against a failure mode this car will hit on every drive.
for kv in disable_splash=1 boot_delay=0 auto_initramfs=0 camera_auto_detect=0 display_auto_detect=0 force_eeprom_read=0 disable_poe_fan=1; do
  k=${kv%%=*}
  if grep -q "^$k=" /boot/firmware/config.txt; then
    sudo sed -i "s/^$k=.*/$kv/" /boot/firmware/config.txt
  else
    echo "$kv" | sudo tee -a /boot/firmware/config.txt >/dev/null
  fi
done

# Overlay FS (BUILD_NOTES §29): protects the real ext4 root from corruption on a hard power
# cut -- this car's normal shutdown path, via ignition, on EVERY drive, not the rare case it
# is for most Pi projects. overlayroot's initramfs-tools hook is what actually mounts the
# overlay, and auto_initramfs=0 above means the firmware won't load one on its own -- so it's
# installed, freshly regenerated for whatever kernel is running right now, and loaded
# explicitly. Verified (§29.2) surviving a genuine hard power cut with zero fsck activity:
# nothing had actually written to the real disk to corrupt. /boot/firmware stays writable
# throughout (it's `noauto,x-systemd.automount` -- not yet mounted when the overlay's
# boot-time hook runs, so it's never swept into the read-only overlay); no maintenance-mode
# toggle is needed for kernel updates or config.txt/cmdline.txt changes.
sudo apt install -y overlayroot
# /persist (BUILD_NOTES §31): the overlay throws every write away at ignition-off, so logs
# need a partition of their own. Root fills the whole disk on a fresh install, and ext4
# can't shrink while mounted, so an initramfs script shrinks root to 64 GiB and makes
# partition 3 ("persist") from the rest -- once, on the reboot at the end of this script,
# triggered by s660_repart=apply in cmdline.txt below (s660-repart-clear.service removes the
# flag again). Hook + script must be in place BEFORE the update-initramfs that follows.
sudo install -m 755 "${PERSIST}/initramfs-hook-s660-repart" /etc/initramfs-tools/hooks/s660-repart
sudo install -m 755 "${PERSIST}/initramfs-premount-s660-repart" /etc/initramfs-tools/scripts/local-premount/s660-repart
sudo update-initramfs -u -k "$(uname -r)"
if grep -q "^initramfs " /boot/firmware/config.txt; then
  sudo sed -i "s|^initramfs .*|initramfs initramfs8 followkernel|" /boot/firmware/config.txt
else
  echo "initramfs initramfs8 followkernel" | sudo tee -a /boot/firmware/config.txt >/dev/null
fi

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

# cmdline.txt (ONE line): overlayroot=tmpfs:recurse=0 (see above; recurse=0 overlays only /,
# so /persist stays a normal writable mount), the one-shot s660_repart=apply, drop the 115200-baud serial console
# (~2 s of synchronous kernel output), quiet the kernel, pin the console mode ("D" forces the
# connector on without waiting for hotplug) and point DRM at the EDID override above. For
# serial debugging, temporarily put "console=serial0,115200" back.
ROOT_PARTUUID=$(sed -nE 's/.*root=(PARTUUID=[^ ]+).*/\1/p' /boot/firmware/cmdline.txt)
echo "overlayroot=tmpfs:recurse=0 s660_repart=apply console=tty1 root=${ROOT_PARTUUID} rootfstype=ext4 fsck.repair=yes rootwait cfg80211.ieee80211_regdom=PT quiet loglevel=3 vt.global_cursor_default=0 video=HDMI-A-1:720x480@60D drm.edid_firmware=HDMI-A-1:edid/s660.bin" \
  | sudo tee /boot/firmware/cmdline.txt >/dev/null

# /persist mounts + what lives on it (BUILD_NOTES §31). Every entry is nofail: a missing or
# damaged log partition must never keep the unit from booting to CarPlay.
#   journal   systemd journal, flushed every 5 s (an ignition cut loses seconds, not minutes)
#   timesync  timesyncd's clock file, touched every minute -- no RTC and no network in the
#             car, so this is what keeps each drive's timestamps after the previous one's
sudo mkdir -p /persist
grep -q "^LABEL=persist " /etc/fstab || grep -v "^#" "${PERSIST}/fstab.persist" | sudo tee -a /etc/fstab >/dev/null
sudo install -D -m 644 "${PERSIST}/journald-s660-persist.conf" /etc/systemd/journald.conf.d/s660-persist.conf
for u in s660-repart-clear.service s660-persist-layout.service s660-clock-save.service s660-clock-save.timer; do
  sudo install -m 644 "${PERSIST}/${u}" "/etc/systemd/system/${u}"
done
sudo systemctl daemon-reload
sudo systemctl enable s660-repart-clear.service s660-persist-layout.service s660-clock-save.timer


# ============================================================================
# PHASE 1 — Kiosk display: cage + seatd
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
# PHASE 2 — Dongle udev rule
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
# (BUILD_NOTES 22.7). Hide them from libinput. The kiosk then runs with ZERO input
# devices, which wlroots only tolerates with WLR_LIBINPUT_NO_DEVICES=1 (set in the unit).
sudo install -m 644 "${PB}/71-s660-libinput-ignore-cec.rules" /etc/udev/rules.d/71-s660-libinput-ignore-cec.rules

sudo udevadm control --reload-rules
sudo udevadm trigger


# ============================================================================
# PHASE 3 — App stack: system Chromium + carplay-web-app (GPU)
# ============================================================================
echo ">>> PHASE 3: system Chromium + carplay-web-app"

# System Chromium HAS the Raspberry Pi GBM/V4L2 patches upstream Electron lacks, so it
# composites on the GPU where Electron crashed — and decodes H.264 on the hardware
# V4L2 decoder too (measured, BUILD_NOTES §27.1). Package is "chromium" on Trixie.
sudo apt install -y chromium

# Pre-grant the Carlinkit dongle (1314:1520 / 1314:1521) to the kiosk origin via Chromium's
# WebUsbAllowDevicesForUrls managed policy (BUILD_NOTES §28). Without it, WebUSB only exposes
# devices the user once picked in a requestDevice() chooser, and that grant lives in the
# browser PROFILE — so any profile reset put the unit back to needing an on-screen tap on a
# dash with no touchscreen. A managed policy lives outside the profile, needs no user
# gesture, and makes navigator.usb.getDevices() return the dongle on first page load.
sudo install -d -m 755 /etc/chromium/policies/managed
sudo install -m 644 "${PB}/chromium-policy-webusb-carlinkit.json" \
  /etc/chromium/policies/managed/s660-webusb-carlinkit.json

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

# Build the library: tsconfig.build.json covers src/modules (shared) AND src/node (compiles
# clean — an older note here claimed it had type errors; it doesn't, BUILD_NOTES §27.4), then
# the web target the browser app imports.
npx tsc --build ./tsconfig.build.json
npx tsc --build ./src/web/tsconfig.json     # should complete silently, 0 errors

# Install the web app's deps. --ignore-scripts skips re-triggering the parent's
# "prepare": "npm run build", which would just redo the two tsc builds above.
# DO NOT run `npm audit fix --force` afterwards — it breaks the build. See BUILD_NOTES 11.4.
cd "${NODE_CARPLAY_DIR}/examples/carplay-web-app"
npm install --ignore-scripts

# Production build. The kiosk wrapper serves build/ through serve-build.js (which sends the
# COOP/COEP headers SharedArrayBuffer needs) instead of the CRA dev server, which recompiled
# the app at EVERY boot (~12 s on the CM4). Re-run this after any App.tsx change.
CI=false npm run build


# ============================================================================
# PHASE 4 — Service: carplay.service (ENABLED)
# ============================================================================
echo ">>> PHASE 4: kiosk service"

# The kiosk owns tty1; you SSH in for a shell.
sudo systemctl disable getty@tty1.service 2>/dev/null || true

# Launch wrapper + static server + unit are VERSIONED in path-b/ (BUILD_NOTES §22/24).
# Node and cage start together once the KMS connector exists. Cage's child invokes the
# wrapper's --browser branch, which waits for HTTP before execing Chromium. All processes
# live in this unit's cgroup, so a `systemctl stop` tears the web server down too.
mkdir -p "${KIOSK_DIR}"
install -m 775 "${PB}/run-chromium-kiosk.sh" "${KIOSK_DIR}/run-chromium-kiosk.sh"
install -m 664 "${PB}/serve-build.js" "${KIOSK_DIR}/serve-build.js"

# The unit. No PAMName=login: cage talks to seatd directly, RuntimeDirectory= provides
# XDG_RUNTIME_DIR, and skipping the logind session saves user@1000 + a session bus at boot
# (Chromium logs harmless "Failed to connect to the bus" lines as a result).
sed -e "s/^User=s660$/User=${CARPLAY_USER}/" \
    -e "s|^ExecStart=.*|ExecStart=${KIOSK_DIR}/run-chromium-kiosk.sh|" \
    "${PB}/carplay.service" | sudo tee /etc/systemd/system/carplay.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable carplay.service


# ============================================================================
# PHASE 5 — DONE
# ============================================================================
echo ""
echo "=== Provisioning complete ==="
echo ""
echo "CRITICAL: REBOOT now. Starting the kiosk service live does NOT reliably set up the"
echo "VT session on first setup; a clean boot fixes it. The reboot also runs the one-shot"
echo "/persist repartition (BUILD_NOTES §31) -- keep the unit on stable power for it:"
echo ""
echo "    sudo reboot"
echo ""
echo "After reboot, the kiosk autostarts via carplay.service."
