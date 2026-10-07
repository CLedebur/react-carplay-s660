# S660 CarPlay — project context for Claude Code

Open-source CarPlay head unit for the Honda S660. Hardware: Raspberry Pi Compute
Module 4 (CM4) + Oratek TOFU carrier board. CarPlay runs as `carplay-web-app` in the Pi's
system Chromium under `cage`. That stack ("Path B" in the notes) is the **only** supported
one, and new work builds on it. The MITM physical controls and the CAN-bus connection come next.

**Path A (the Electron `react-carplay` fork this repo began as) was RETIRED on 2026-10-07**
(BUILD_NOTES §32). Its source is gone from the tree and lives at the git tag `path-a-final`:
`src/main/Canbus.ts`, `PiMost.ts` and `KeyBindings.tsx` are reference material for the CAN work.
Do not reintroduce Electron, an AppImage, `carplay.service` or root-level npm tooling. "Path A"
and "Path B" survive only as history in BUILD_NOTES.

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

This is why Path A was retired. Stock/upstream Electron on the Pi does **software** H.264
decode, and under `cage` it can crash on the CM4's v3d/vc4 `dma_buf` scanout path. The Pi's
**system Chromium** works because it carries Raspberry Pi's downstream GBM + V4L2 patches,
which upstream Electron lacks (ref: electron/electron#34825). A newer Electron alone does NOT
add them. Never "upgrade" to an Electron or other bundled-Chromium runtime, for this reason.

**Path B already decodes in hardware.** Measured 2026-09-12 with CarPlay streaming: Chromium's
GPU process holds `/dev/video10` (`bcm2835-codec-decode`) — the `+rpt` Raspberry Pi Chromium
build's V4L2 stateful-decoder patches, reached through the web app's WebCodecs `VideoDecoder`
with default `hardwareAcceleration`, no launch flag needed (BUILD_NOTES §27.1). Earlier notes
(§8, §19, §20) saying Path B decode was "software" were a pre-dongle inference that was never
re-tested; they are annotated at source. Do not repeat that claim.

The stack (BUILD_NOTES §8.5; the retired/shelved alternatives are §32 and §27):
- **Path B (the only supported stack)** — `carplay-web-app` in system Chromium (GPU compositing
  confirmed via `chrome://gpu`; hardware H.264 decode confirmed via `fuser /dev/video10`).
  The dongle's WebUSB access comes from the `WebUsbAllowDevicesForUrls` managed policy
  (`hardware/path-b/chromium-policy-webusb-carlinkit.json` → `/etc/chromium/policies/managed/`),
  **not** from a chooser grant in the browser profile — the profile is disposable and no
  on-screen tap is ever needed (BUILD_NOTES §28). Never reintroduce a `requestDevice()` path
  or a gesture-gated authorise button: this dash has no touchscreen.
  This is a **one-stop-shop repo**: the app source (`node-carplay` library +
  `carplay-web-app`, vendored/modified from upstream `rhysmorgan134/node-CarPlay`, MIT)
  lives in `hardware/path-b/node-CarPlay/`, alongside the kiosk script and static server
  in `hardware/path-b/`. It is not an npm/git dependency the Pi fetches separately —
  edit it in place here, rebuild, and redeploy (see `hardware/path-b/node-CarPlay/README.md`
  and BUILD_NOTES §11 for the exact commands). On the Pi it's deployed by pulling this
  repo (`~/react-carplay-s660`) and pointing the kiosk at
  `~/react-carplay-s660/hardware/path-b/node-CarPlay/examples/carplay-web-app`.
  Boot is tuned (BUILD_NOTES §24): measured software reboots reach the kiosk service
  ~2.4 s after kernel start, following ~5.6 s of firmware time; Chromium starts ~3.5 s
  after the kernel. These are internal timestamps, not cold-power-to-first-paint measurements. Display
  forced to the car panel's 720x480@59.94 via an EDID override; the 1.875:1 glass stretches it, so iOS renders 848x480 (16:9, Waze's
  limit) and the web app squeezes it into 720 (§22.8) (`drm.edid_firmware`; cage
  ignores `video=`), and NetworkManager
  deliberately requests startup 20 s after Linux starts (timer coalescing can delay it).
  Host Bluetooth is REQUIRED for the trackpad and starts at 15 s; a service delay also
  covers Chromium's early D-Bus activation. Do not disable the Bluetooth radio.
  The kernel is the stock packaged `kernel8.img`. An uncompressed-kernel optimisation with
  refresh hooks existed briefly and was **reverted** (BUILD_NOTES §26) after a hard power cut
  left the decompressed copy 0 bytes and the unit unbootable — do not reintroduce it.
  **Overlay FS is deliberately ENABLED** (`overlayroot=tmpfs:recurse=0`) — required, since this unit loses
  power via the car's ignition on every drive. It needs `initramfs initramfs8 followkernel` in
  `config.txt` to actually run (`auto_initramfs=0` above means the firmware won't load one on
  its own) and was properly isolated-tested and validated against a real hard power cut
  (BUILD_NOTES §29) after the incident above — that incident's root cause (the kernel image
  mechanism) is gone, and this is a separate, since-fixed concern, not the same risk recurring.
  `/boot/firmware` is confirmed still normally writable (its automount means it isn't mounted
  yet when the overlay's boot-time hook runs) — no maintenance-mode toggle is needed. In
  `provision.sh` PHASE 0 (§29.3) — a fresh install from this repo gets the identical
  `overlayroot`-install/initramfs-regen/config.txt/cmdline.txt steps that were validated live.
  **`/persist` (BUILD_NOTES §31)**: root is 64 GiB, and `nvme0n1p3` (174 GiB, label `persist`)
  is a real writable ext4 at `/persist`. It stays writable because `recurse=0` overlays only
  `/`. The journal (`SyncIntervalSec=5s`) and timesyncd's clock file are bind-mounted onto it,
  so each drive is one `journalctl --list-boots` entry. Anything that must outlive a drive goes
  under `/persist`, never anywhere else on `/`. All of its mounts are `nofail`: never make
  boot depend on it. It was made by a one-shot initramfs repartition (`hardware/persist/`,
  `s660_repart=check|apply`). Do a `check` boot before any `apply`. Inside the initramfs, call
  the tools in `/usr/lib/s660-repart/` by full path, because BusyBox shadows them.
  Graphics component preloads and the concurrent Node/cage launcher are documented in §24 and
  remain in place.
- **Path C — SHELVED, not built.** A browser-free node-carplay + GStreamer design, written up
  and then set aside once §27.1 showed Path B already hardware-decodes. BUILD_NOTES §27 keeps
  the full analysis (including the real costs: input, audio mixing, overlay) if it's ever
  revisited; don't re-derive it.

## Build / dev
- There is **no root `package.json`** any more. All app code and npm tooling lives in
  `hardware/path-b/node-CarPlay/` (library) and its `examples/carplay-web-app/`. Build and
  deploy as described in its `README.md` and BUILD_NOTES §11/§23. On the Pi, turn the
  overlay off first, or the deploy vanishes at the next power-off.
- The kiosk unit is **`carplay.service`**, and its wrapper + static server live in
  `~/carplay-kiosk/` (BUILD_NOTES §33). Before 2026-10-07 it was `carplay-dev-chromium.service`
  in `~/carplay-dev/`. In BUILD_NOTES §5–§20, `carplay.service` means the old **Path A**
  Electron unit, not this one.

## Gotchas worth remembering
- The Carlinkit dongle is **required** — it performs the Apple MFi handshake. You
  cannot plug the phone straight into the Pi (BUILD_NOTES §7).
- Do **not** run `npm audit fix --force` on the web-app deps — it upgrades to breaking
  versions and destroys the working build (BUILD_NOTES §11.4).
