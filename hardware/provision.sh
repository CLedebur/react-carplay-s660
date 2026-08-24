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
#                      Installed as carplay-dev-chromium.service, DISABLED (start by hand).
#
# Both service files can live on the machine at once; only ONE may run at a time (both own
# tty1). The dev unit declares Conflicts=carplay.service, so starting one stops the other.
# This is the §14 stable/dev channel toggle: the stable react-carplay install is never
# clobbered, even while you experiment with the (faster-compositing) Chromium channel.
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
# PIN node-CarPlay (= package.json 4.3.0). The repo has NO git tags, so pin the COMMIT SHA —
# "v4.3.0" is only the package.json version and is NOT checkout-able. This SHA is master HEAD
# as of 2026-08-24 (committed 2025-06-08); it is the exact code the @types/node + typescript
# pins in PHASE 3B (§11.3) are matched to. Re-pin only if you deliberately move node-CarPlay.
NODE_CARPLAY_REF="670f19eda2a0b0047a5a538b9602b263f442433a"
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

  # Launch wrapper: the dev service needs the web app served on localhost first, THEN the
  # Chromium kiosk. Both live in this unit's cgroup, so a `systemctl stop` (or the Conflicts=
  # switch back to carplay.service) tears the web server down too. Quoted heredoc: $HOME and
  # the loop vars are resolved at RUNTIME (systemd sets $HOME from User=), not now.
  mkdir -p "${DEV_DIR}"
  cat > "${DEV_DIR}/run-chromium-kiosk.sh" << 'WRAP'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/node-CarPlay/examples/carplay-web-app"

# Serve the web app locally (dev server; proven in BUILD_NOTES 11.4). BROWSER=none stops
# react-scripts trying to open a browser.
cd "$APP_DIR"
BROWSER=none npm start &

# Wait for the dev server to answer before handing the display to Chromium (the first CRA
# start on the Pi is slow; allow up to ~90s). If it never comes up, launch anyway and let
# Restart=always retry.
for _ in $(seq 1 90); do
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then break; fi
  sleep 1
done

# WebUSB requires a localhost origin — which this is. Full-screen kiosk, GPU compositing.
exec cage -- chromium --ozone-platform=wayland --kiosk --no-sandbox http://localhost:3000
WRAP
  chmod +x "${DEV_DIR}/run-chromium-kiosk.sh"

  # The unit. Conflicts=carplay.service makes the two mutually exclusive (systemd Conflicts=
  # is symmetric: starting EITHER stops the other), so they never fight over tty1. It is
  # deliberately NOT enabled — you start it by hand to toggle channels (see PHASE 5).
  sudo tee /etc/systemd/system/carplay-dev-chromium.service > /dev/null << EOF
[Unit]
Description=S660 CarPlay DEV kiosk (cage + system Chromium, Path B / GPU) — toggles vs carplay.service
After=local-fs.target seatd.service
Wants=seatd.service
Conflicts=carplay.service

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
ExecStart=${DEV_DIR}/run-chromium-kiosk.sh
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
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
  echo "Toggle channels — only ONE owns the display at a time (Conflicts= enforces it):"
  echo "    sudo systemctl start carplay-dev-chromium.service   # -> Chromium/GPU (stops carplay.service)"
  echo "    sudo systemctl start carplay.service                # -> Electron/stable (stops the dev one)"
  echo "If a live switch misbehaves (VT/PAM handoff between two tty1 kiosks is unverified),"
  echo "use the reliable way — enable the one you want and reboot:"
  echo "    sudo systemctl disable carplay.service && sudo systemctl enable carplay-dev-chromium.service && sudo reboot"
  echo "    sudo systemctl disable carplay-dev-chromium.service && sudo systemctl enable carplay.service && sudo reboot"
  echo "First switch to dev is slow: it runs 'npm start' (CRA dev server) before Chromium opens."
fi
