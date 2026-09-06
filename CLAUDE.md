# S660 CarPlay — project context for Claude Code

Open-source CarPlay head unit for the Honda S660. Hardware: Raspberry Pi Compute
Module 4 (CM4) + Oratek TOFU carrier board. This repo is a fork of `react-carplay`
(Electron + React), customised for the S660 and the CM4.

## Source of truth for the build
- **`hardware/BUILD_NOTES.md`** — the full build/provisioning story: hardware, boot
  tuning, kiosk stack (cage + seatd), the GPU investigation, power safety, and the
  next-session plan. Read it before touching anything hardware-, boot-, or GPU-related.
- **`hardware/provision.sh`** — reproducible setup of a fresh Raspberry Pi OS Lite
  (64-bit, Trixie) install into a working head unit.

## The central technical constraint (GPU / video)
Two independent problems — do not conflate them:
1. **Compositing / GL** — GPU-accelerated rendering (WebGL, canvas, page).
2. **H.264 video decode** — the CarPlay stream from the Carlinkit dongle.

Stock/upstream Electron on the Pi does **software** H.264 decode, and under `cage` it
can crash on the CM4's v3d/vc4 `dma_buf` scanout path. The Pi's **system Chromium**
works because it carries Raspberry Pi's downstream GBM + V4L2 patches that upstream
Electron lacks (ref: electron/electron#34825). **A newer Electron alone does NOT add
those patches.** Real hardware decode needs a custom-patched Electron build (RPi
`debian/patches` + GN args `use_v4l2_codec=true` / `use_v4l2_codec_rpi=true`).

Two paths exist (see BUILD_NOTES §8.5):
- **Path A** — the Electron app under `cage --disable-gpu` (software, stable).
- **Path B (currently chosen)** — `carplay-web-app` in system Chromium (GPU compositing,
  confirmed via `chrome://gpu`).
  The running unit, kiosk script and static server are versioned in `hardware/path-b/`.
  Boot is tuned (BUILD_NOTES §22): kiosk on screen ~5.7 s after kernel start, display
  forced to the car panel's 720x480@59.94 via an EDID override; the 1.875:1 glass stretches it, so iOS renders 896x480 and
  the web app squeezes it into 720 (§22.8) (`drm.edid_firmware`; cage
  ignores `video=`), and NetworkManager
  deliberately starts 20 s after boot — SSH to the Pi takes ~30 s after power-on.

## State of THIS fork's code
- Electron bumped **27 → 33** (Chromium 130 / Node 20). Pi GPU flags added in
  `src/main/index.ts` (they MUST be appended before `app.whenReady()` — switches set
  after that are ignored). Render backend is a runtime Setting (webgl / webgl2 /
  webgpu) in Settings → consumed in `Carplay.tsx`. Decoder set to `prefer-hardware`.
- **NOT YET VERIFIED ON HARDWARE:** whether Electron 33 + GPU flags survive the
  `dma_buf` scanout bug under `cage`, or still fall back to / crash into software. The
  GPU flags may re-trigger the crashes that `--disable-gpu` was added to avoid. The
  on-device test (BUILD_NOTES §15) decides whether this fork can replace Path B.

## Build / dev commands
- `npm install` — **Linux/Pi only.** `socketcan` is `os: linux`; native modules
  (`usb`, `socketcan`) rebuild via the `install-app-deps` postinstall; `node-carplay`
  is a git dependency built by its own `prepare` script. It will not install on macOS.
- `npm run dev` — run in development.
- `npm run build` — runs `electron-vite build` (does **not** run typecheck).
- `npm run build:armLinux` — build the arm64 AppImage for the Pi.
- `npm run typecheck` — optional; has ~11 pre-existing errors in the vendored
  `src/renderer/src/components/worker/render/lib/h264-utils.ts`. The rest is clean.

## Gotchas worth remembering
- Settings "Save" calls `app.relaunch()` then exits — this is intentional. The kiosk
  runs under a systemd service with `Restart=always` so it comes straight back
  (BUILD_NOTES §9). Don't "fix" the exit.
- The Carlinkit dongle is **required** — it performs the Apple MFi handshake. You
  cannot plug the phone straight into the Pi (BUILD_NOTES §7).
- Do **not** run `npm audit fix --force` on the web-app deps — it upgrades to breaking
  versions and destroys the working build (BUILD_NOTES §11.4).
