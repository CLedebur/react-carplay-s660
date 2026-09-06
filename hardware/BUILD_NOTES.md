# S660 CarPlay — Build Notes

Open-source CarPlay head unit for the Honda S660, built on a Raspberry Pi Compute
Module 4 (CM4) and an Oratek TOFU carrier board. This document records the build
process, every non-obvious fix, and the reasons behind each one. Read it before you
start, because several steps fail in ways that are hard to diagnose without the notes.

> **Writing style:** short, direct sentences, one instruction at a time. This is on
> purpose. It keeps the build steps easy to follow and easy to translate.

---

## 1. Current status

**What works now:**
- Raspberry Pi OS Lite (64-bit) boots on the CM4 + TOFU.
- Two working software paths exist (see below). Both start on their own at boot,
  full-screen, and are stable.

**Two paths — and a decision made:**
- **Path A (Electron AppImage):** `react-carplay` runs under `cage` with `--disable-gpu`
  (software rendering). Stable and renders correctly, but does NOT use the CM4 GPU. This
  was the working path through most of the build.
- **Path B (system Chromium — CHOSEN):** the browser-based `carplay-web-app` runs in the
  Pi's system Chromium, which **composites on the GPU** (hardware accelerated, confirmed
  via `chrome://gpu`). This is the path forward. See Section 8.5.

As of the latest session, Path B is validated up to the hardware boundary: the web app
builds, serves, loads in GPU-accelerated Chromium on the Pi, and reaches its
"Plug-In Dongle" ready state with zero GPU crashes and zero `dma_buf` errors.

**What is NOT yet tested:**
- A real CarPlay session. The Carlinkit dongle has not arrived yet.
- **Video decode** — hardware (V4L2) vs software. This is the last open question and
  needs the dongle streaming live H.264. Compositing is solved; decode is not yet.
- Boot from the M.2 NVMe SSD. The drive has not arrived yet.

---

## 2. Hardware

| Part | Choice | Note |
|------|--------|------|
| Compute | CM4, 8GB RAM, Lite (no eMMC), with WiFi | 8GB chosen for resale/reuse value; 4GB is enough for this build |
| Carrier | Oratek TOFU | Wide 12V input, onboard M.2, native 40-pin GPIO (standard Pi pinout; NO silkscreen pin numbers — pin 1 is at the corner nearest the USB ports) |
| Storage (now) | microSD (A2-rated) | Temporary, until the NVMe arrives |
| Storage (planned) | 2242 B-M key NVMe, via M.2 Key M adapter | Final boot device |
| CarPlay link | Carlinkit CPC200-CCPA dongle | **Required — see Section 7** |
| Cooling | Heatsink attached; fan not yet wired | Fan connector is a later stage |

**Test environment caveat:** All current testing is on an open desk, directly under
a mini-split AC unit. These thermal and boot-time numbers will NOT match the final
enclosed, in-car install. Re-test thermals after you build the enclosure and wire
the fan.

**Software baseline:**
- Raspberry Pi OS Lite 64-bit, Debian 13 (Trixie)
- Kernel `6.18.39+rpt-rpi-v8`, aarch64

> Package names and versions below are correct for this Trixie build. Other builders
> on a different OS release may see different names (for example, `libfuse2t64` versus
> `libfuse2`). Check before you assume.

---

## 3. Architecture decision — provisioning script, not a container

The goal is a build another S660 owner can reproduce. Two options were considered:

- **A container (Podman/Docker):** Rejected. `react-carplay` needs direct access to
  the GPU (`/dev/dri`), USB devices, and the display. A container hides these by
  default, so you must map each one by hand. A container also does not hold the
  system-level parts this build needs: `systemd` units, `udev` rules, and boot
  settings. Docker also adds a background service that slows boot.
- **A provisioning script:** Chosen. A single shell script sets up a fresh Raspberry
  Pi OS Lite install to the working state. It covers the system-level parts a
  container cannot, and it adds no runtime layer between the app and the hardware.

The script is built up step by step in `~/s660-provision/provision.sh`, capturing
each command only after it is confirmed to work on real hardware.

---

## 4. Boot-time optimization

Do this measurement-first. Change one thing, reboot, measure again.

**Use the right tool.** `systemd-analyze blame` lists slow units, but many run in
parallel and do not delay the finish. Use `systemd-analyze critical-chain` instead,
which shows the real chain of units that block startup.

**Measure the right target.** The default target (`multi-user.target` / `ssh.service`)
is not the goal. The goal is "the CarPlay screen is visible." Once the app service
exists, measure it directly:
```bash
systemd-analyze critical-chain carplay.service
```

**Measured result (microSD, before NVMe):**
- `multi-user.target`: 7.547s — the wrong number. It waits on `ssh.service`, which
  waits on the network stack.
- `carplay.service`: **4.465s** — the number that matters. Its critical chain contains
  NO `network.target` at all, which confirms the `After=local-fs.target` design works:
  the app starts fully independent of `NetworkManager` (which adds 2.478s in parallel,
  off the critical path, costing the screen nothing).

So the honest headline is ~4.5s from power-on to CarPlay service start, on the microSD,
before the NVMe. The `~355ms` `binfmt` pair is the only trimmable item left in the
chain, but it is minor and may matter for multi-arch container builds — leave it.

**Changes that helped (in order of impact):**
```bash
# cloud-init — first-boot setup tool, not needed on every boot. ~3s saved.
sudo systemctl disable cloud-init cloud-init-local cloud-config cloud-final
sudo touch /etc/cloud/cloud-init.disabled

# apt-daily — background update check. Disable the TIMER, not just the service.
# A .timer fires the .service on a schedule; disabling the service alone does nothing.
sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer
sudo systemctl mask apt-daily.service apt-daily-upgrade.service

# Optional, if unused on your build:
sudo systemctl disable man-db.service bluetooth.service avahi-daemon.service
```

**In `/boot/firmware/config.txt`:**
```
disable_splash=1
boot_delay=0
```

**Two lessons worth keeping:**
- `NetworkManager-wait-online.service` looked like the biggest delay in `blame`, but
  `critical-chain` showed it was never on the critical path. Disabling it did not help
  boot time. This is exactly why `critical-chain` matters more than `blame`.
- The correct fix for "the app waits on the network" is not to fight `ssh.service`.
  It is to give the app's own service a narrow `After=local-fs.target` and no network
  line at all. The dongle link is USB, not network, so the app never needs to wait
  on WiFi.

**Reference:** <https://ohyaan.github.io/tips/raspberry_pi_boot_time_optimization__complete_performance_guide/>

**Open item:** An `ssh.service` override to clear its `After=network.target` did not
take effect (the dependency edge stayed, per `systemd-analyze dot ssh.service`). Cause
not found. Deferred, because it does not affect the app's real startup path.

---

## 5. The kiosk display — cage + seatd

`react-carplay` is an Electron app. On Raspberry Pi OS Lite (no desktop), it needs a
minimal way to draw full-screen. We use `cage`, a single-app Wayland kiosk compositor.

### 5.1 cage pulls in an X11 layer — this is expected

Electron renders through X11 by default, so `cage` needs `xwayland` underneath it.
Installing `cage` pulls in ~120MB of packages. An attempt to trim the extras with
`apt-mark auto` + `apt autoremove` removed **nothing** — confirming the packages are
genuinely required by `xwayland` / `xserver-common`, not optional bloat. This X11
footprint is the unavoidable cost of Electron's default X11 rendering path.

> A leaner "native Wayland" path (Path B: Electron's Ozone Wayland backend, no
> XWayland) exists but was not adopted. It carries a higher risk of a hard-to-debug
> rendering bug. Revisit only if the footprint becomes a real problem.

```bash
sudo apt install -y cage
```

### 5.2 seatd — the critical group-name gotcha

`cage` needs to claim the display and input devices with no user logged in. `seatd`
brokers this. Install it and enable it:
```bash
sudo apt install --no-install-recommends -y seatd
sudo systemctl enable --now seatd
```

**The gotcha:** the guides say to add your user to a `seat` group. On this build that
group **does not exist**. Check the service file:
```bash
systemctl cat seatd.service
# ExecStart=seatd -g video   <-- the allowed group is "video", NOT "seat"
```
So add your user to `video`, then **log out and back in** (group changes only apply on
a new login):
```bash
sudo usermod -aG video "$USER"
```
Confirm with `groups` after re-login. This name has varied across Debian releases;
always check `systemctl cat seatd.service` on a new board.

### 5.3 Confirm the display path works

```bash
sudo apt install -y --no-install-recommends xterm
cage -- xterm        # a full-screen terminal should appear on the HDMI monitor
```
Run this over SSH is fine, but the output appears on the Pi's physical monitor, not
in the SSH session. `cage` draws directly to the display hardware (DRM); it does not
travel back over SSH. Keep a monitor plugged in.

The `eglQueryDeviceStringEXT ... EGL_BAD_PARAMETER` messages are harmless noise on
the Pi's wlroots stack. Ignore them.

---

## 6. Installing react-carplay

### 6.1 udev rule for the dongle
```bash
FILE=/etc/udev/rules.d/52-nodecarplay.rules
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="152*", MODE="0660", GROUP="plugdev"' | sudo tee $FILE
sudo udevadm control --reload-rules
sudo udevadm trigger
# Confirm your user is in plugdev (log out/in if you must add it):
sudo usermod -aG plugdev "$USER"
```

### 6.2 Download and extract the AppImage

Download the 64-bit ARM build:
```bash
mkdir -p ~/react-carplay
curl -L https://github.com/rhysmorgan134/react-carplay/releases/download/v4.0.5/react-carplay-4.0.5-arm64.AppImage \
  --output ~/react-carplay/carplay.AppImage
chmod +x ~/react-carplay/carplay.AppImage
```

**Gotcha 1 — FUSE library.** AppImages mount through FUSE. Trixie ships a newer FUSE;
install the compatibility library:
```bash
sudo apt install -y libfuse2t64 || sudo apt install -y libfuse2
```

**Gotcha 2 — missing `libz.so`.** The AppImage launcher fails with
`libz.so: cannot open shared object file`. Note the name: `libz.so`, not `libz.so.1`.
The unversioned name normally ships only in the `-dev` package. Rather than install a
compiler package, create the one symlink it needs:
```bash
sudo ln -s /usr/lib/aarch64-linux-gnu/libz.so.1 /usr/lib/aarch64-linux-gnu/libz.so
sudo ldconfig
```
> This is an unusual line to bake into a script. A future Debian release could ship
> `libz.so` directly, or change the path. Keep the comment next to it in the script.

**Extract, do not mount.** Extract the AppImage once and run the real binary directly.
This removes the FUSE mount step from every launch (a small boot win) and sidesteps
the launcher entirely:
```bash
cd ~/react-carplay
./carplay.AppImage --appimage-extract    # creates squashfs-root/
```
The real executable is then at `~/react-carplay/squashfs-root/react-carplay`.

**Run flag — `--no-sandbox`.** The extracted `chrome-sandbox` does not have the
elevated permissions Electron expects, so the app needs `--no-sandbox`. This is
acceptable here: one trusted app, no untrusted web content ever loads in it.

---

## 7. IMPORTANT CORRECTION — the dongle is required

An earlier design idea was to drop the Carlinkit dongle and plug the iPhone straight
into a CM4 USB port ("wired CarPlay"). **This does not work with this software stack.**

- `react-carplay` (via `node-carplay`) only ever talks to a Carlinkit-class dongle.
  It never talks to the iPhone directly.
- The dongle performs the CarPlay handshake with the phone. That handshake needs
  Apple MFi authentication, which requires a licensed chip. A bare Pi USB port cannot
  do it.
- node-carplay's own README states plainly that wired-to-wireless adapters will not
  work; you need a dongle that converts a factory/Android system into CarPlay
  (CPC200-CCPA or similar).

**What "wired mode" actually means:** it is only about how the *phone* connects to the
*dongle* — by cable instead of over WiFi. The dongle is always in the chain either
way. Wired-to-dongle still gives the reliability win (instant, no wireless handshake),
so it is a good choice — you just keep the dongle.

**Action:** the BOM must keep the Carlinkit CPC200-CCPA. You also need a data-capable
Lightning/USB-C cable (a charge-only cable will not carry CarPlay).

---

## 7b. react-carplay vs node-carplay — the relationship (and a corrected assumption)

These two repos by the same maintainer are **layers, not competitors**:

- **`node-carplay`** = the **library** (npm package). Talks to the Carlinkit dongle over
  USB, handles the CarPlay protocol, forwards H.264 video + PCM audio. No UI. Runs in
  Node.js (native USB) OR the browser (WebUSB). Ships an example, `carplay-web-app`.
- **`react-carplay`** = a **full application** (Electron + React) built ON TOP of
  node-carplay: settings page, CAN bus integration, key bindings, MOST bus audio, camera
  support. node-carplay is a *dependency* of react-carplay.

Stack: dongle → **node-carplay** (protocol/USB) → **react-carplay** (UI/features) → screen.

**CORRECTED ASSUMPTION (important):** it looks like react-carplay is "untouched for four
years / abandoned in favour of node-carplay." That is **wrong**, and it nearly sent us
down a needless rewrite. What is stale is only the **published AppImage binary**
(v4.0.5, Nov 2024). The **source repo is current**:
- `package.json` pulls `"node-carplay": "github:rhysmorgan134/node-CarPlay"` — i.e. it
  already tracks node-carplay's **main branch**, not a pinned old version.
- Built with Vite + `@electron-toolkit`, `zustand`, MUI 5, react-router 6, and Web
  Workers for the CarPlay/video/audio pipeline — a modern 2023-era architecture.
- Structured source was last indexed (DeepWiki) as recently as Sept 2025.

**Consequence for this build:** "fork react-carplay and update it to the latest
node-carplay" is a much SMALLER job than feared, because the source already tracks
current node-carplay. The real work is: fork → build **from source** (not the stale
AppImage) → bump the bundled Electron to a version with working Pi GPU support → layer
S660-specific changes on top.

**Why this reopens Path A vs Path B (Section 8.5):** Path A's GPU failure may have been
purely the *stale bundled Electron 27 in the v4.0.5 binary*, not Electron itself.
Building react-carplay from source with a current Electron could give BOTH the GPU win
(Path B's advantage) AND react-carplay's full feature set (CAN, settings, camera —
which the minimal `carplay-web-app` lacks). That would be the true "do it right"
outcome: not choosing between them, but getting both. **To verify:** check what Electron
version react-carplay's current `main` targets, and whether that Electron reaches the
GPU on this board. See Section 15 (next session).

---

## 8. The GPU / rendering investigation

This is the biggest open technical item. Read it before changing any render flags.

### 8.1 There are TWO separate problems
1. **Compositing** — Chromium cannot hand its rendered buffers to `cage` cleanly.
   The error is `Failed to export buffer to dma_buf: No such file or directory (2)`.
2. **Video decode** — the H.264 stream from the dongle. This is the one that matters
   most for CarPlay, and it is a known Electron issue (electron/electron #34825): the
   bundled Electron uses software video decode, while the Pi's *system* Chromium uses
   V4L2 hardware decode.

### 8.2 Root cause of the dma_buf failure
The CM4 splits graphics across two DRM devices: `v3d` (the 3D render node,
`renderD128`) and `vc4` (the display/HDMI node). Chromium tries to allocate a scanout
buffer (GBM flag `GBM_BO_USE_SCANOUT`) on the render node, which cannot allocate
scanout buffers. This is a known, unresolved upstream Chromium bug that many other
projects hit on wlroots-based compositors.

### 8.3 The bundled browser
`react-carplay` bundles its own Electron 27 / Chrome 118.0.5993.129. Upstream Electron
does **not** carry the Raspberry Pi Foundation's downstream patches for hardware video
decode or correct GBM handling. So no flag can reach hardware paths that are not
compiled in.

> To read the bundled version (the app ignores `--version` and just prints `true`):
> ```bash
> strings ~/react-carplay/squashfs-root/react-carplay | grep -m1 "Chrome/[0-9]"
> ```

### 8.4 Flag combinations tested (all measured, not guessed)

| Flags | GPU crashes | dma_buf errors | Result |
|-------|:-----------:|:--------------:|--------|
| *(default, no GL flags)* | 0 | many, per-frame | Renders, but continuous per-frame fallback → poor framerate |
| `--ozone-platform=wayland --enable-features=UseOzonePlatform` | 3 | 6 | Crashes 3×, then full software fallback |
| `... --use-gl=angle --use-angle=gl --ignore-gpu-blocklist` | 3 | 6 | Still crashes 3× |
| `... --disable-gpu-compositing` | 0 | 0 | **Black screen** — stopped crashing by stopping rendering |
| `--disable-gpu` | 0 | 0 | **Software, stable, renders correctly ← CURRENT CONFIG** |

**Correct flag names for Chrome 118** (they changed across versions):
- `--use-gl=angle --use-angle=gl` (NOT `--use-gl=egl`; the `--use-gl=` → `--gl=`
  rename happened in Chrome 123, after 118).
- `--ignore-gpu-blocklist` (NOT the older `--ignore-gpu-blacklist`).

### 8.5 Conclusion — Option 2 chosen and validated
> **Update 2026-08-23:** a from-source **Electron 33** build was tested on the CM4 and
> hits this exact `dma_buf` failure too — and `--ozone-platform=drm` isn't compiled into
> stock Electron. So a newer Electron does NOT clear this wall. Full retest in §17.

Option 1 (finding the right flags for the bundled Electron) is exhausted. No flag
combination gives working, stable GPU acceleration with the bundled Electron 27 /
Chrome 118. Path A's shipped config is `--disable-gpu` — software rendering, stable,
renders correctly, but no GPU.

**Option 2 was tested and it works.** Running the browser-based `carplay-web-app` in the
Pi's **system Chromium** (installed as the `chromium` package on Trixie; binary at
`/usr/bin/chromium`) composites on the GPU. Confirmed via `chrome://gpu`:

| Feature | Status |
|---------|--------|
| Compositing | **Hardware accelerated** ✓ (the exact thing that crashed Electron) |
| OpenGL | Hardware accelerated ✓ |
| Rasterization | Hardware accelerated ✓ |
| WebGL / WebGL2 | Hardware accelerated ✓ |
| Canvas | Hardware accelerated ✓ |
| **Video Decode** | **Software only** — the last open item, needs the dongle to fix/test |

The system Chromium carries the Raspberry Pi Foundation's downstream GBM and V4L2
patches that upstream Electron lacks. Under `cage`, it renders with **zero `dma_buf`
export failures and zero GPU-process crashes** — the wall that stopped Path A is gone.
See Section 11 for the full Option 2 build steps.

**Status of the two problems from 8.1:**
- **Compositing (Problem 1): SOLVED** on Path B. Hardware accelerated. ✓
- **Video decode (Problem 2): open.** `chrome://gpu` shows "Software only." Fixing this
  likely needs an explicit V4L2 decode feature flag on Chromium's launch line, and can
  only be *tested* with the dongle streaming real H.264. This is the top task for the
  next session.

**Do not decide video performance from a static screen.** The web app currently reaches
its "Plug-In Dongle" state — proof the stack runs, but it tells us nothing about live
video. The real acceptance test is: *does live CarPlay video play smoothly, and is
decode hardware or software?* That needs the dongle.

---

## 9. The Settings crash — and the service that fixes it

**Symptom:** clicking "Save" in Settings dropped the app back to the terminal.

**Two wrong theories (recorded so nobody re-chases them):**
- Not the `askForMediaAccess` TypeError. That warning fires at startup too, without
  crashing, and the camera/mic fields were empty.
- Not the Chromium GPU crash limit. The crash happened even with `--disable-gpu`, so
  no GPU process existed to crash.

**Actual cause:** the app calls `app.relaunch()` after Save — it deliberately exits,
expecting something to start it again. Run by hand, nothing does, so it just exits.
Confirmed with:
```bash
grep -a -o "relaunch" ~/react-carplay/squashfs-root/resources/app.asar   # prints: relaunch
```

**Fix:** run it under a `systemd` service with `Restart=always`. When the app exits to
relaunch, `systemd` starts it right back. Note: it must be `Restart=always`, not
`on-failure` — a relaunch is a *clean* exit, which `on-failure` would ignore.

### 9.1 The service file: `/etc/systemd/system/carplay.service`
```ini
[Unit]
Description=S660 CarPlay kiosk (cage + react-carplay)
After=local-fs.target seatd.service
Wants=seatd.service

[Service]
User=s660
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal
# --disable-gpu is INTENTIONAL, not a placeholder. See Section 8: real GPU accel
# crashes on this board's v3d/vc4 split (dma_buf scanout export failure), then
# Chromium falls back to software anyway. This flag gets the same stable end state
# without the crashes, so Settings saves and other reloads never crash.
ExecStart=/usr/bin/cage -- /home/s660/react-carplay/squashfs-root/react-carplay --no-sandbox --disable-gpu
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

### 9.2 Enable it
```bash
sudo systemctl disable getty@tty1.service   # frees tty1; the service claims it
sudo systemctl daemon-reload
sudo systemctl enable carplay.service
```

**CRITICAL — you must reboot.** Starting/stopping the service live, inside an existing
boot session, does NOT reliably set up the VT/PAM session, and the service will loop
(start → exit → restart every ~2s). A clean reboot sets it up correctly.
```bash
sudo reboot
```

**Why `PAMName=login` and the `TTY*` lines:** a service with nobody logged in has no
VT and no `XDG_RUNTIME_DIR`. `PAMName=login` runs it through the same login machinery
a real console login uses, which sets up the pieces `cage`/`seatd` expect. The `TTY*`
lines give it a clean terminal to claim and release properly.

---

## 10. Measurement lessons (how not to fool yourself)

Testing render performance is full of traps. Every one of these bit us:

- **"Feels smoother" lied once.** After 3 GPU crashes, Chromium fell back to software
  and *felt* smoother — but that was the fallback, not acceleration. Always cross-check
  the log (`GPU process exited unexpectedly`, `dma_buf` counts) against what your eyes
  see.
- **0% CPU means the app did not launch, OR the screen is static.** A rendering app is
  never at 0%. Twice, "all zeros" looked like success but was really a non-launch.
- **Do not run the test script with `sudo`.** As root, `cage` fails
  (`XDG_RUNTIME_DIR is not set`) because root has no seat session. Pre-authenticate
  once and run as your user: `sudo -v && ~/gpu-test.sh ...`
- **`pgrep -x name` misses child processes.** Chromium spawns render/GPU children with
  different names. Match by path instead: `pgrep -f "squashfs-root/react-carplay"`.
- **A static screen is a useless render benchmark.** With no dongle, react-carplay
  shows a still image, which is near-idle no matter how it renders. Real video is the
  only valid test.

---

## 11. Option 2 build — system Chromium + carplay-web-app (the chosen path)

This is the GPU-accelerated path (see Section 8.5). It replaces the Electron AppImage
with the Pi's system Chromium running the browser-based `carplay-web-app`, which talks
to the dongle over **WebUSB**. Validated up to the hardware boundary; video decode is
the one remaining open item.

### 11.1 Install system Chromium
```bash
sudo apt install -y chromium      # on Trixie the package is "chromium", NOT "chromium-browser"
which chromium                    # confirm: /usr/bin/chromium
```
The udev rule from Section 6.1 (`52-nodecarplay.rules`) is what grants WebUSB access to
the dongle — that work carries straight over. No native USB bindings, no `libudev`
compile: the browser owns the USB device via WebUSB.

### 11.2 Node.js
A fresh Lite install has neither Node nor npm. Do NOT use `apt install nodejs` (too
old). Use NodeSource for a current LTS:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # want v20.x
npm --version
```

### 11.3 Clone and build node-CarPlay — WITH THE TOOLCHAIN GOTCHA

`carplay-web-app` lives inside the `node-CarPlay` repo and references the parent by
relative path (`file:../../`), so clone the whole repo:
```bash
cd ~
git clone https://github.com/rhysmorgan134/node-CarPlay.git
cd node-CarPlay
```

**THE GOTCHA — read this before installing anything.** The repo (v4.3.0) was written
against older type definitions than a fresh Node 20 provides. A plain build throws
TypeScript errors (`Timer` vs `Timeout`, `Buffer`/`SharedArrayBuffer` mismatches). The
`package.json` declares `@types/node@^18.11.9` + `typescript@^5.2.2`, but the caret (`^`)
lets npm pull too-new patches that reintroduce the errors. **Pin them exactly:**
```bash
npm install --save-dev @types/node@18.11.9 typescript@5.2.2
```

Then build ONLY the web target (the Node target has errors we do not need — the web app
never uses the Node USB path):
```bash
npx tsc --build ./src/web/tsconfig.json     # should complete silently, 0 errors
```
> Note: the parent `package.json` has `"prepare": "npm run build"`, which npm runs
> automatically after any install and triggers the FULL (failing) build. That is why the
> web app install below uses `--ignore-scripts`.

### 11.4 Install and run the web app
```bash
cd ~/node-CarPlay/examples/carplay-web-app
npm install --ignore-scripts          # --ignore-scripts avoids re-triggering the parent's failing "prepare"
```
> The install reports many "vulnerabilities" and deprecation warnings. These are in
> build-time dev dependencies of an old create-react-app, not in code that runs on the
> dash. **DO NOT run `npm audit fix --force`** — it upgrades to breaking versions and
> destroys the working build. For a locked-down offline kiosk loading one local page,
> these dev-dependency CVEs are not a real attack surface. Leave them.

Run the dev server (faster than a production build for testing; leave it running):
```bash
npm start                             # serves http://localhost:3000
```

### 11.5 WebUSB rules — why it must run ON the Pi
WebUSB is only available on **`localhost` or HTTPS**, and needs a **user gesture** (a
click) plus a device present. Consequences:
- Viewing `http://<pi-ip>:3000` from another computer shows a **blank/non-working page** —
  remote HTTP disables WebUSB. This is correct behavior, not a bug.
- The app MUST run in Chromium **on the Pi**, pointed at the Pi's own `localhost:3000`,
  because only there is it (a) a localhost origin and (b) physically attached to the
  dongle.

### 11.6 Launch it in GPU-accelerated Chromium
Stop the Path-A service first so it is not holding the display (remember `Restart=always`
may have revived it):
```bash
sudo systemctl stop carplay.service
systemctl is-active carplay.service   # want: inactive
pgrep -x cage                         # want: empty
```
Then, with `npm start` still running in another session:
```bash
cage -- chromium --ozone-platform=wayland --kiosk --no-sandbox http://localhost:3000
```
Success = the "Plug-In Dongle" button appears on the Pi's monitor, with zero `dma_buf`
errors and zero GPU crashes in the log. That is the full stack proven, minus the dongle.

### 11.7 What changes when this becomes the shipped service
Once the dongle/video test passes, `carplay.service` (Section 9.1) changes: its
`ExecStart` swaps the Electron AppImage for Chromium, and the service also needs the
dev server (or a static production build served locally) running first. There is still
only ONE `cage`, one service, owning the display — Path B replaces the body of the
service, it does not run alongside Path A. (Exact unit file: TODO after the video test.)

---

## 12. Power safety — surviving an automotive power environment

A car is a hostile power environment: the engine can be switched off mid-write, the
battery can die, a fuse can blow, or a wiring fault can cut power with no warning. The
build must not corrupt its own filesystem when this happens. Two mechanisms cover this,
from two directions. They are complementary, not redundant.

### 12.1 Graceful shutdown — handles the EXPECTED power-off

This is the normal case: the driver turns the car off. Tap three wires:

- **ACC** — the *signal*. When it drops, the car just turned off → trigger a graceful
  shutdown. Sensed via an opto-isolator (PC817-class) into a GPIO pin (see BOM Phase 3).
- **CONSTANT** (12V always-on) — the *hold-up power*. This keeps the Pi alive for the
  few seconds it needs to finish shutting down AFTER ACC drops. This wire is the key
  one: if the Pi were powered only from ACC, it would lose power mid-shutdown — the
  exact ungraceful cut we are trying to avoid.
- **ON** — confirm what this actually switches on the S660 before relying on it; it may
  be redundant with ACC.

Shape of it: **ACC says when to shut down; CONSTANT keeps it alive long enough to do
so.** On ACC return, applied power boots the Pi automatically (the TOFU's wide input
handles this — no power-button logic needed).

> **Bench test:** drop ACC, confirm the shutdown script fires, and time that CONSTANT
> holds power until shutdown completes.

### 12.2 OverlayFS read-only root — handles the UNEXPECTED power-off

No shutdown sequence can run if power simply vanishes (battery disconnect, blown fuse,
wiring fault). OverlayFS makes that case harmless:

- The root filesystem becomes **read-only**. Nothing can ever write to it.
- A second layer, held **in RAM**, catches all writes. Apps behave normally; the writes
  land in memory, layered on the read-only base.
- On power loss, the RAM layer vanishes. Next boot is byte-for-byte identical. No
  corruption is possible, because the disk was never mid-write.

Raspberry Pi OS has first-class support: `raspi-config` → Performance → Overlay File
System. **Bonus:** with a read-only root there are no writes to the boot device during
normal running, which greatly reduces SD-card / NVMe wear.

**The design is NOT "read-only everything."** It is **read-only root + a deliberate
writable carve-out** for the few things that must survive a power cycle:
- **Dashcam footage** (BOM Phase 8) — writes to a real writable partition on the NVMe
  (dashcam writes ride PCIe, off the boot device).
- **Telemetry/CAN logs** (BOM Phase 7), if kept.
- **Settings changes** — decide per case: should an in-car config tweak survive the next
  shutdown, or be thrown away? (For a locked-down daily-driver image, throwing them away
  is often the safer default.)

### 12.3 Why no UPS / supercapacitor

A UPS buffer (BOM Phase 3.5) is **pinned/dropped**: automotive-grade modules that fit a
12V-native, wide-temperature use case are hard to source and oversized for the need. It
would only have added a third, marginal layer (keeping the unit *running* briefly through
a glitch) — the least important of the three for a dashboard that boots in ~4.5s anyway.
Graceful shutdown + OverlayFS cover both the expected and the catastrophic case without
it.

### 12.4 When to actually turn OverlayFS on

**Do this LAST**, on the NVMe, after the build is otherwise finished and proven. Two
reasons:
- Read-only root makes development painful — every change needs the overlay turned off,
  changed, then back on. Keep a normal writable system while still actively building.
- OverlayFS setup is tied to the specific boot device and partition layout. Setting it
  up on the microSD now, then re-imaging to NVMe, means doing it twice. Do it once, on
  the NVMe, as the final lock-down step.

---

## 13. Developer mode / contributor setup (provisioning-script flags)

For an open-source project, others need an easy way to get a working build environment.
This is handled by optional flags on `provision.sh`. **Design, to build after the fork
(needs the Pi to test the native-module compile).**

**VOCABULARY (keep these distinct — three "dev" concepts exist):**
- **dev toolchain** = the `--dev` / `--dev-claude` provisioning flags below.
- **dev channel** = the runtime A/B environment (Section 14) — a different thing.

### 13.1 The two-target rule (critical)
There are really two different machines, and dev tooling must NOT leak into the shipped
image:
1. **Production dashboard** — minimal, locked-down, OverlayFS read-only. NO compiler, NO
   Claude Code, NO dev tooling. Every extra package is attack surface, boot time, and wear.
2. **Developer/contributor box** — full toolchain, writable, for building and iterating.

**Rules baked into the script's help text:** never enable OverlayFS on a `--dev` machine;
never run a `--dev` install on the production unit. Mixing them defeats both goals.

### 13.2 The flag design (three tiers, additive)
```
./provision.sh              # production: builds the shippable dashboard only
./provision.sh --dev        # production baseline + assistant-agnostic dev toolchain
./provision.sh --dev-claude # everything --dev does, plus Claude Code optimizations
```
- **`--dev`** (assistant-agnostic — any contributor, any AI or none): Node/build toolchain,
  `build-essential`, the `electron-rebuild` deps for the native modules (`usb`,
  `socketcan`), git, clone the fork.
- **`--dev-claude`** (adds Claude Code, approach "(a)" — install + basic context only):
  - Install Claude Code via the **signed apt repo** (fits the controlled-update philosophy
    better than the background auto-updater; more auditable via signed-key verification).
  - Drop a `CLAUDE.md` in the repo root: project context (Electron CarPlay app for a CM4,
    build commands, the known gotchas — toolchain pins, Electron/GPU situation).
  - Keep it minimal. Do NOT pre-configure heavy permissions/agents/hooks (approach "(b)")
    — that imposes your workflow on contributors and rots as Claude Code's config evolves.

### 13.3 Caveats (decided, for when this is built)
- **Do not embed the Claude Code signing key/repo URL as an eternal copy.** Fetch the
  current key at run time from the official location (as the docs' commands do), or the
  flag breaks for everyone after Anthropic rotates the key. Pull the exact apt steps
  from `code.claude.com/docs/en/setup` at build time — they change.
- **The flag installs Claude Code; it cannot log you in.** Each contributor still needs
  their own paid account + `claude login`. Word the help text as "installs the tooling,"
  not "gives you a working assistant."
- **A committed `.claude/settings.json` with pre-approved permissions is a mild security
  consideration** for a public repo — you'd ship "these commands are auto-approved" to
  anyone who clones. If ever added, keep it conservative and documented. (Approach (a)
  omits it.)

---

## 14. Dual-environment / A/B deployment (stable + dev channels)

Safety architecture so a broken dev build never leaves a non-working dashboard in the
car. Two complete react-carplay installs side by side; the CM4 always boots **stable**
by default, and you deliberately switch to **dev** to test. This is the software-layer
equivalent of keeping the microSD as a backup after moving to NVMe.

**Design, to build AFTER the fork exists** (there is no second build to hold yet, and it
wants NVMe space — two full installs each with their own `node_modules` + Electron).

### 14.1 Mechanism — two systemd services (chosen: Option 2)
- `carplay-stable.service` and `carplay-dev.service`, each launching `cage` at its own
  install. Enable exactly ONE at a time.
- Rationale: anyone deliberately switching to a dev channel is already comfortable with
  `systemctl`, and the toggle can be wrapped in a script for ergonomics anyway.
- **Mutual exclusion is mandatory** — both services want `cage`, the display, tty1, and
  the seat; two active at once collide (the same conflict as running a manual `cage`
  against the live service). Enforce it two ways:
  1. A toggle script that stops one before starting the other, never both:
     `carplay-channel dev` → `systemctl disable --now carplay-stable; systemctl enable --now carplay-dev`
  2. `Conflicts=` in each unit file naming the other, so systemd itself refuses to run
     both — belt and suspenders.
- **Reboot to switch** (same VT/PAM-session caveat as Section 9.2 — live hand-off is
  unreliable).

### 14.2 The switching mechanism must be independent of the switched thing
Do NOT bake the channel switch into the dev build itself — if the thing that switches you
back is inside the thing that's broken, you can get stuck. The services and toggle script
are stable infrastructure; only the app they launch varies.

### 14.3 Interaction with OverlayFS
On a read-only-root production unit, the channel choice (which service is enabled) is
persistent state. Ensure the enabled-service state lives in (or is re-applied from) the
**writable carve-out**, alongside the dashcam-footage carve-out (Section 12.2). This is a
point *for* the design — the channel is one of the few things you'd deliberately make
persistent-writable on a locked image.

---

## 15. Open questions / next session

> **Update 2026-08-24 (§18):** the **Carlinkit dongle** and the **M.2 NVMe SSD** have both
> arrived and are installed — the Pi now boots from NVMe and runs live CarPlay. Items 1 and
> 2 below are done or partly done (see §18); the rest of this plan still stands.

**PRIMARY TRACK — fork react-carplay and build from source (see Section 7b):**

0. **Fork react-carplay, build from source on the Pi.** The source already tracks
   current node-carplay, so this is modernize-not-rewrite. Steps:
   - Fork the repo; clone your fork on the Pi.
   - `npm install` and build from source (watch for the same toolchain-pin class of
     issue we hit with node-carplay — Section 11.3).
   - Check what Electron version `main` targets: `grep electron package.json`.
   - Run the built app under `cage` and open its GPU status — does a current Electron
     reach the GPU on this board? If YES, we get features + GPU together (the ideal).
   - If it's still on an old Electron, bump the Electron devDependency to a current
     version with Pi GPU support and rebuild.

1. **Video-decode test (with the dongle).** ⏳ PARTLY DONE 2026-08-24 (§18) — live CarPlay
   runs on **Path A** (Electron, `--disable-gpu`) at poor framerate (software compositing +
   decode, by design); a `chrome://gpu` reading awaits a Path B boot (no address bar under
   the kiosk Electron). Whichever app path, plug in the dongle,
   connect the phone by cable, watch live CarPlay, and check `chrome://gpu` (or the
   Electron equivalent) for **Video Decode**: hardware (V4L2) or software. If software,
   try a V4L2 decode feature flag on the launch line. This is the last piece of the GPU
   story. (Path B / `carplay-web-app` in system Chromium remains the proven fallback.)
2. **Re-image to NVMe.** ✅ DONE 2026-08-24 (§18) — done as a **fresh Pi OS Lite reinstall
   onto the NVMe** rather than an `rpi-clone`; boot order set to the NVMe and the microSD
   removed. (Original plan kept for reference: clone the working microSD to the NVMe with
   `rpi-clone`, set `rpi-eeprom-config` to prefer the NVMe, keep the microSD as a backup.)
   - Confirm the NVMe fits the TOFU: 2242 size, B-M key. (M.2 Key M adapter is on hand.)
   - A fresh NVMe install is also the right moment to test `provision.sh` end-to-end.
3. **Finalize the shipped service** for whichever app path wins (Section 9.1 / 11.7):
   the `ExecStart` and any local-server needs depend on the choice above.
4. **Re-test thermals** once the fan is wired and the enclosure exists. Current numbers
   are open-air under AC and will not carry over. Check `vcgencmd get_throttled` (`0x0`).
5. **Boot time** — already good: `carplay.service` ready at 4.465s on microSD (Section 4).
   Re-measure against the real service target on the NVMe.
6. **Power safety (see Section 12), sequenced correctly:**
   - Wire ACC/CONSTANT and the opto-isolator; bench-test graceful shutdown on ACC drop.
   - Turn on OverlayFS read-only root **last**, on the NVMe, after the build is stable.
   - Plan the writable carve-out (dashcam → NVMe partition; decide settings persistence).
7. **GPIO breakout** — cable-connected T-Cobbler chosen (standard Pi pinout, pin 1 at
   the USB-port corner). When it arrives: power up and measure the T-Cobbler's labeled
   3.3V / 5V / GND terminals BEFORE wiring components, to confirm the ribbon is not
   mirrored (the TOFU header has no silkscreen pin numbers).
8. **Minor/deferred:** the `ssh.service` `After=` override that did not take effect.

---

## 16. Quick reference — the working path, start to finish

Assuming a fresh Raspberry Pi OS Lite (64-bit) install, user `s660`:

```bash
# 1. Kiosk compositor + seat broker
sudo apt install -y cage
sudo apt install --no-install-recommends -y seatd
sudo systemctl enable --now seatd
sudo usermod -aG video "$USER"      # NOT "seat" — check: systemctl cat seatd.service
sudo usermod -aG plugdev "$USER"
# --- log out and back in here ---

# 2. Dongle udev rule
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="152*", MODE="0660", GROUP="plugdev"' \
  | sudo tee /etc/udev/rules.d/52-nodecarplay.rules
sudo udevadm control --reload-rules && sudo udevadm trigger

# 3. App: download, fix libs, extract
mkdir -p ~/react-carplay && cd ~/react-carplay
curl -L https://github.com/rhysmorgan134/react-carplay/releases/download/v4.0.5/react-carplay-4.0.5-arm64.AppImage \
  --output carplay.AppImage && chmod +x carplay.AppImage
sudo apt install -y libfuse2t64 || sudo apt install -y libfuse2
sudo ln -s /usr/lib/aarch64-linux-gnu/libz.so.1 /usr/lib/aarch64-linux-gnu/libz.so && sudo ldconfig
./carplay.AppImage --appimage-extract

# 4. Service (write /etc/systemd/system/carplay.service from Section 9.1)
sudo systemctl disable getty@tty1.service
sudo systemctl daemon-reload
sudo systemctl enable carplay.service

# 5. REBOOT (required)
sudo reboot
```

---

## 17. 2026-08-23 — Electron-33 fork built from source + GPU retest on the CM4

Forked react-carplay (CLedebur/react-carplay-s660), bumped Electron 27→33, and built it
**from source on the CM4** (the §15 primary track). Then retested GPU under `cage`.

**Build-from-source gotchas (Trixie / Node 20 / Python 3.13):**
- The `github:` git-dependencies (`node-carplay`, `pcm-ringbuf-player`) fail their `tsc`
  `prepare` build on modern TypeScript (5.7 typed-array generics — the §11.3 class of
  bug, for real). **Fix: switched both to the prebuilt npm releases** —
  `node-carplay@^4.1.0` (same repo, ≥ the main branch's 4.0.0) and
  `pcm-ringbuf-player@^0.1.0` (gozmanyoni's canonical package, which rhys's was forked
  from). *This is committed, and supersedes §7b's "track main via github" choice: npm
  4.1.0 is newer than main's 4.0.0, so no regression, and the build stops depending on a
  fragile source build.*
- Native modules need node-gyp ≥10 (Python 3.13 removed `distutils`; the ancient bundled
  `node-gyp@9.4.1` dies with `No module named 'distutils'`). node-gyp 13 needs Node 22;
  **node-gyp 11 is the match for Node 20** (`overrides: {"node-gyp":"^11"}`).
- `electron-builder install-app-deps` / `@electron/rebuild` **HANGS** on this Pi
  (deadlocks in its own orchestration — node-gyp itself is fine). Workaround: rebuild each
  native module directly: `cd node_modules/<m> && node-gyp rebuild --runtime=electron
  --target=33.4.11 --arch=arm64 --dist-url=https://www.electronjs.org/headers`
  (`usb` is N-API and needs no rebuild).
- Bug: `src/main/index.ts` calls `systemPreferences.askForMediaAccess` unconditionally —
  it's a macOS-only API and throws an UnhandledPromiseRejection on Linux. Needs a
  `process.platform === 'darwin'` guard.

**GPU retest result — the version bump does NOT help.** The built app under `cage` throws
**16× the same `dma_buf` scanout failure** as Electron 27 (`gbm_wrapper.cc: Failed to
export buffer to dma_buf` / `Failed to get fd for plane`). No GPU-process crash, no
SwiftShader — but per-frame `dma_buf` fallback (the "renders, poor framerate" state).
Also tried `--ozone-platform=drm` (direct-KMS, no cage, to skip the compositor handoff) →
`FATAL: Invalid ozone platform: drm`: stock Electron ships only x11/wayland/headless
Ozone backends (`drm` needs `ozone_platform_drm=true` at build time).

**Conclusion (confirms §8.5, now for a modern Electron too):** stock Electron cannot
cleanly GPU-composite on the CM4 at **any** version — the missing pieces (GBM scanout
patch, `ozone_platform_drm`, V4L2 decode) live only in a **custom build** or in **system
Chromium / Path B**. A bare Electron bump gives react-carplay's features on a modern stack
but the same software-ish compositing as before.

**Committed for now:** the git-deps→npm switch + this section. **Deferred** (pending an
architecture decision — a move to Path B would run react-carplay's *renderer* in system
Chromium behind a headless Node backend, which retires the Electron shell and its native-
ABI machinery): the node-gyp override, the direct-rebuild script, and the
`askForMediaAccess` guard.

---

## 18. 2026-08-24 — NVMe SSD in service; first live CarPlay on the CM4

**Storage.** The M.2 NVMe SSD is installed on the TOFU. Raspberry Pi OS Lite was
reinstalled **fresh onto the NVMe**; the build now boots from NVMe and the microSD has
been removed. The system is stable and in normal working order. (This diverges from the
§15.2 `rpi-clone` plan — a clean reinstall instead — which also sets up the first real
end-to-end `provision.sh` run, still to be done with the reworked script.)

**First live CarPlay — on Path A (Electron).** With the Carlinkit dongle + phone (wired),
CarPlay comes up and renders on the dash — the first full end-to-end run of the stack. The
running app is **Path A**: the Electron AppImage launched with `--disable-gpu`, so **both
compositing and H.264 decode are in software by design**. **Framerate is poor**, which is
the EXPECTED Path A trade (§8.5) — the stable "software everything" state, *not* the
per-frame `dma_buf` fallback of §17 (the `--disable-gpu` flag exists precisely to avoid
those GPU errors) and *not* the Path B GPU-composite path. Hardware (V4L2) decode is still
unwired — that remains THE open item.

**`provision.sh` reworked this session** (same PR; not yet run against the fresh NVMe
install): a single script selected by `TARGET_PATH` (a = Electron/software, b = system
Chromium/GPU), common phases run once, `node-CarPlay` pinned to a fixed ref, a hardened
AppImage download, and an `ERR` trap. See the script header.

**Still open (focus unchanged):**
- Decode-mode measurement is **moot on Path A** (GPU is disabled, so it is software by
  construction), and `chrome://gpu` is not reachable under the kiosk Electron (no address
  bar). The meaningful readout comes when Path B is tried — `TARGET_PATH="b"` boots system
  Chromium, where `chrome://gpu` → Video Decode and GPU compositing are both visible.
- The HW-decode route (a V4L2 decode feature flag on the launch line, or the
  custom-patched Electron of §8.5) is what turns "renders, poor framerate" into smooth video.
- Then: finalize the shipped service (§11.7); re-test thermals in the enclosure; enable
  OverlayFS read-only root LAST (§12 / §14).

---

## 19. 2026-08-24 — Stable/dev channel toggle: `carplay.service` + `carplay-dev-chromium.service`

Realises the §14 dual-environment idea and the §11.7 "Path B service" TODO **without ever
clobbering the working Electron install.** `provision.sh` now provisions two independent
channels; both can coexist and you toggle at runtime:

- **`carplay.service`** — Path A, Electron `--disable-gpu` (software). ENABLED, autostarts.
  The stable channel; unchanged.
- **`carplay-dev-chromium.service`** — Path B, system Chromium + carplay-web-app (GPU
  compositing). Installed **DISABLED** — start it by hand to experiment. A launch wrapper
  (`~/carplay-dev/run-chromium-kiosk.sh`) serves the web app (`npm start`, §11.4), waits for
  `localhost:3000`, then execs `cage -- chromium … --kiosk`.
- **`carplay-dev-electron.service`** — reserved name for a future custom-patched-Electron
  channel (§8.5), if that route is taken. Not built yet.

**Mutual exclusion.** Only one may own tty1 at a time. The dev unit declares
`Conflicts=carplay.service` (systemd `Conflicts=` is symmetric), so starting either stops
the other. `getty@tty1` stays disabled — SSH in for a shell.

**Toggling — enable ONE + reboot.** The live `systemctl start` hot-switch is **CONFIRMED
BROKEN** on the CM4 (the cage→cage handoff drops HDMI; screen blank until reboot — see §20):
```bash
# -> dev Chromium/GPU:
sudo systemctl disable carplay.service && sudo systemctl enable carplay-dev-chromium.service && sudo reboot
# -> stable Electron:
sudo systemctl disable carplay-dev-chromium.service && sudo systemctl enable carplay.service && sudo reboot
```

**`provision.sh` shape change.** The one-shot `TARGET_PATH="a|b"` selector is replaced by two
independent flags — `INSTALL_STABLE_A` and `INSTALL_DEV_CHROMIUM` (yes/no) — because a single
selector cannot express "both present, toggle between them." Common phases still run once. To
add the dev channel to the existing NVMe box **without touching the stable install**, set
`INSTALL_STABLE_A=no` + `INSTALL_DEV_CHROMIUM=yes`. Pin fix: node-CarPlay has **no git tags**,
so `NODE_CARPLAY_REF` now targets the commit SHA `670f19e` (= package.json 4.3.0, master HEAD
2025-06-08) — the earlier `"v4.3.0"` was only the package version and was not checkout-able.

**Verified on hardware 2026-08-24 (§20)** — provisioned and booted the dev channel on the CM4;
`cage` + system Chromium come up and load the web app. The live hot-switch does NOT work
(§20); switch via enable+reboot as above.

**Expectations (important).** Path B fixes *compositing* (GPU), not *decode* — the CarPlay
H.264 stream stays software-decoded until the V4L2 / custom-Electron work (§8.5). So the dev
channel should smooth the UI and give a real `chrome://gpu` readout, but may not by itself fix
the CarPlay video framerate.

---

## 20. 2026-08-24 — Dev Chromium channel VERIFIED on hardware; live hot-switch is not viable

Provisioned the dev channel on the CM4 (`INSTALL_STABLE_A=no INSTALL_DEV_CHROMIUM=yes`, over
SSH — note the Pi's sudo needs a password, so the run is done by hand and the log read back).
Result: **the Path B dev channel works.** After enabling `carplay-dev-chromium.service` and
rebooting, `cage` + system Chromium come up and load the web app. **Performance is still
limited** — GPU compositing is active but H.264 decode stays software (exactly the §19
expectation); smoothing the CarPlay video is deferred to the V4L2 / custom-Electron work.

**Live hot-switch is BROKEN — use enable+reboot.** Starting the dev service while the stable
Electron kiosk was up (`systemctl start carplay-dev-chromium.service`) left a blank screen: the
service and Chromium ran fine (`Result=success`, web server 200, `cage`+`chromium` up), but the
**HDMI output went `disconnected`**. The journal showed the outgoing cage die with `failed to
read Wayland events: Broken pipe` at the switch, then `HDMI: Unknown ELD version 0`. The
cage→cage / DRM handoff does not re-modeset the display. The reliable switch is enable-one +
reboot (clean modeset), now the only documented method (§19); `Conflicts=` is retained purely
as a safety net. (WebUSB still needs a click to authorise the dongle — a USB keyboard/mouse on
the Pi is enough.)

**Deploy finding — the on-disk stable unit is stale.** The `carplay.service` currently on the
NVMe predates this fork's fixes: its first line is corrupted (`4[Unit]`, so the entire `[Unit]`
section — `After=`/`Wants=seatd`, `Description=` — is silently ignored), and its `ExecStart`
lacks `--disable-gpu` (so stable Electron does GPU work and throws the §17 `dma_buf` errors at
boot — the poor framerate seen in §18). `provision.sh` emits the correct unit; regenerate it
with `INSTALL_STABLE_A=yes` to fix both. **TODO on the box.**

---

## 21. 2026-08-24 — Dev-channel perf fix: DongleConfig was requesting bench-monitor resolution

**Root cause found.** `carplay-web-app`'s `App.tsx` builds its `DongleConfig` — the
resolution + framerate it asks the **dongle** to encode, which the CM4 then has to
software-decode (§17) — from `window.innerWidth` / `window.innerHeight`, at `fps: 60`. That
is the *attached display's* size, not the S660's. The bench monitor used for testing
negotiates up to **3840x2160** (§20), so the dev channel was silently asking for, and
software-decoding, **5-10x more pixels/sec** than the car's real 800x480 screen will ever
need. This — not just "decode is software" — was the dominant cause of the poor framerate
in §20's first test.

**Fix.** Hardcoded the `DongleConfig` to the S660's real screen: `width: 800, height: 480,
fps: 30` (30fps is standard for a dash and halves the decode load again on top of the
resolution cut). The `videoContainer` div's CSS box is resized to the same fixed 800x480
(centered) **in the same edit** — `useCarplayTouch` normalizes touch coordinates by dividing
the container's rendered pixel size by these same `width`/`height` constants, so the two
must change together or touch mapping breaks. In the car this whole patch is a no-op: the
kiosk window IS 800x480, so `innerWidth`/`innerHeight` already equal these values — it only
matters on an oversized bench display.

**Confirmed on hardware 2026-08-24:** visibly smoother at 800x480. 30fps "makes a lot of
sense because of the screen itself" (the user's words) — not a compromise, a match to what
the target hardware actually needs. Touch alignment was not meaningfully verifiable on this
bench rig (mouse pointer on a non-touch monitor, no ground truth to compare against) —
deferred to the real 800x480 touchscreen.

**Persisted into `provision.sh`, not a fork.** `node-CarPlay` is upstream, pinned by exact
commit SHA (§19) — no fork exists for it (unlike `react-carplay`, §7b/§17). Forking the whole
repo for a 3-block patch was judged disproportionate, so PHASE 3B applies the fix as an
**idempotent, assertion-guarded source patch** immediately after `npm install --ignore-scripts`
(a `grep` marker skips already-patched sources; each replacement asserts exactly one match, so
if `node-CarPlay` is ever re-pinned to a different SHA where this code has changed, the script
fails loudly via the `ERR` trap instead of silently no-op'ing or corrupting the file).
**Verified reproducible:** ran the exact embedded patch logic against a scratch copy of the
pinned pre-patch source and diffed the result against the tested-on-hardware live file — byte
identical.

**Still open, unaffected by this fix:** hardware video decode (V4L2 / custom Electron, §17)
remains the way to smooth CarPlay video further — this patch only removes a self-inflicted
bench-monitor resolution tax, it does not add hardware decode.

## 22. 2026-09-05 — Boot-time tuning for Path B (kiosk up in ~5.7 s instead of ~14.5 s)

Goal: get `carplay-dev-chromium.service` (cage + system Chromium) on screen as early as
possible after ACC-on, with **no network daemon anywhere on the boot path** (Wi-Fi is
never guaranteed in the car). All work was done on the CM4 over SSH; every original file
is backed up on the Pi in `/root/boot-tuning-backup-2026-09-05/`. The resulting files are
versioned in **`hardware/path-b/`** (unit, kiosk script, static server, drop-ins).

### 22.1 Where the time went (single-boot profile, times from kernel start)

| Milestone | Before | After |
|---|---|---|
| Kernel done, `/init` runs | 2.82 s | 1.03 s |
| initramfs | 1.1 s | none |
| systemd queues first job | 5.04 s | 2.08 s |
| `sysinit.target` | 7.31 s | 2.50 s |
| kiosk service started | 7.44 s | 2.53 s |
| cage launched (kiosk script done) | 11.20 s | 3.47 s |
| Chromium browser process alive | ~14.5 s | ~5.7 s |
| Web app claims + resets the Carlinkit dongle | 18.1 s | 11.5 s |
| Dongle re-enumerated, CarPlay possible | 21.3 s | ~14.7 s (est.) |
| `systemd-analyze` total | 4.09 + 5.95 = 10.05 s | 1.09 + 1.72 = 2.81 s |
| SSH reachable (Wi-Fi) | ~10 s | ~30 s — **deliberate**, see 22.3 |

Firmware time (before the kernel) is not visible from Linux and was not measured.

**The dongle sets the floor.** The Carlinkit enumerates ~11.3 s after kernel start
regardless of what the Pi does (it boots its own firmware), and `node-carplay` USB-resets
it on open (+3 s). Before, the web app was not ready until 18 s, so the reset happened
late. Now the app is waiting when the dongle appears and resets it at 11.5 s. Getting
Chromium up any earlier than ~11 s buys nothing more for CarPlay itself.

### 22.2 What changed on the Pi (and why)

Critical path:
- **Kiosk script polled once a second** for the local static server; Node is up in
  ~0.2 s, so the loop wasted most of a second plus cold-exec time. Now polls every 100 ms
  (`hardware/path-b/run-chromium-kiosk.sh`).
- **initramfs dropped** (`auto_initramfs=0` in config.txt). The RPi kernel has ext4,
  nvme, pcie-brcmstb and xhci built in (checked `modules.builtin`), so the 11.8 MB
  initramfs only added load + unpack time. Root fsck now runs via `systemd-fsck-root`.
- **Console quieted.** cmdline.txt had `console=serial0,115200` and no `quiet`; ~21 KB of
  kernel text went out a 115200-baud UART before systemd even started (~1.9 s of
  serial time, largely synchronous). Now `console=tty1 quiet loglevel=3
  vt.global_cursor_default=0`. Kernel phase went 2.82 s → 1.03 s (this plus the
  initramfs removal account for it; the 1.3 s "gap" seen before was the serial console).
  To debug over serial again, put `console=serial0,115200` back temporarily.
- **`systemd-binfmt` + `binfmt_misc` mount masked** — they sat on the kiosk's critical
  chain and only registered python3.13.
- **`/boot/firmware` is an automount** (`noauto,x-systemd.automount,nofail`, fsck pass 0)
  so `local-fs.target` no longer waits for udev to enumerate the vfat partition and fsck
  it. It mounts on first access (apt, `rpi-eeprom-update`, editing config.txt all work).
- **Swap removed** (`/etc/rpi/swap.conf.d/90-boot-tuning.conf` → `Mechanism=none`):
  8 GB RAM, a 2 GB loop-device swap file and a 2 GB zram both pointless for a kiosk.
- **`keyboard-setup`, `console-setup` disabled**; **cloud-init purged** (its generator and
  units still loaded every boot despite `cloud-init.disabled`). `apt autoremove` then
  dropped ~30 dependency packages (gdisk, netcat-openbsd, eatmydata, python babel…).
- **GPU modules loaded from `/etc/modules-load.d/carplay-gpu.conf`** (`vc4`, `v3d`).
  With the boot this fast, cage started before udev had loaded vc4, failed with
  `Found 0 GPUs` and — worse — **hung instead of exiting**, so `Restart=always` never
  fired. modules-load runs inside sysinit, before the kiosk. The script also waits for
  `/sys/class/drm/card*-HDMI-A-1` as a belt-and-braces guard.

Contention (not on the chain, but the four cores were saturated during early boot):
- **NetworkManager + wpa_supplicant no longer start at boot.** `network-late.timer`
  starts NetworkManager 20 s after boot (Chromium is long up by then); a drop-in makes NM
  `Wants=wpa_supplicant.service`. The D-Bus alias for wpa_supplicant and the
  NetworkManager-dispatcher alias were re-created (disabling NM removes them). Nothing on
  the boot path can wait for Wi-Fi.
- **bluetooth.service + user `mpris-proxy` disabled** — the Carlinkit does its own BT.
- **`rpi-eeprom-update.service` disabled.** It ran `rpi-eeprom-update -s -a` with
  `RPI_EEPROM_IMMEDIATE_UPDATE=1`, i.e. it could flash the bootloader at boot **in the
  car**; a power cut mid-flash means SD-card recovery. Update the EEPROM by hand on the
  bench.
- **Persistent timers** (`man-db`, `dpkg-db-backup`, `e2scrub_all`) disabled; `logrotate`
  and `fstrim` kept but `Persistent=false`, so a car that sat overnight no longer runs
  all of them in the first minute. `sshswitch`, `e2scrub_reap` disabled (the former also
  touched `/boot/firmware` every boot).
- **`upower.service` masked** (Chromium D-Bus-activated it); `NO_AT_BRIDGE=1` set.
- **Kiosk unit runs without `PAMName=login`** — no logind session, no `user@1000`, no
  session D-Bus. cage talks to seatd directly; `RuntimeDirectory=carplay-kiosk` provides
  `XDG_RUNTIME_DIR`. Chromium logs a burst of harmless `Failed to connect to the bus`
  errors at start (no session bus) — expected. **`carplay.service` (Path A) was left
  untouched** and still uses PAM.

Display:
- The car panel (EDID: "Car Audio", mfr FTL) advertises **720x480@59.94 as its preferred
  timing** and **CTA VIC 18 = 720x576@50 16:9** only as an alternative. `hdmi_group/hdmi_mode/
  hdmi_force_hotplug` are **ignored** under `vc4-kms-v3d` with `disable_fw_kms_setup=1`.
  `video=HDMI-A-1:720x576@50D` in cmdline.txt pins the **console** (fbcon) to 576p50 and
  forces the connector on — but **cage/wlroots ignores it** and takes the connector's
  EDID-preferred mode (measured 2026-09-06 with `grim`: cage was running the bench monitor at
  3840x2160 while `fb0` said 720x576; in the car it would have picked 720x480). Fix: an
  **EDID override** — the panel's own 256-byte EDID with the 576p50 DTD moved into the
  preferred slot (`hardware/path-b/s660-edid.bin`, checksum recomputed, built from
  `references/edid-hdmi.txt`), installed as `/lib/firmware/edid/s660.bin` and selected with
  `drm.edid_firmware=HDMI-A-1:edid/s660.bin`. Now every consumer, bench or car, sees one
  preferred mode: confirmed `mode: "720x576": 50` in the DRM state with cage running. VIC 17
  (4:3) has identical timings; this class of panel stretches to its glass anyway. If the panel
  is ever replaced, regenerate the override from the new EDID.
- `camera_auto_detect=0`, `display_auto_detect=0` (no CSI camera, no DSI panel).

### 22.3 Deliberately NOT done / gotchas
- **SSH now comes up ~30 s after power-on**, because NetworkManager waits 20 s. Do not
  "fix" this. If the Pi ever seems unreachable, wait a minute first.
- `netplan.io` cannot be purged: Raspberry Pi's `network-manager` package depends on it.
- The cpufreq governor is forced to `ondemand` by
  `/usr/lib/udev/rules.d/60-ondemand-governor.rules`; a kernel-parameter governor would
  be overridden, and `performance` at idle costs heat in a dashboard. Left alone.
- The Chromium profile (180 MB) was **not** wiped: there is no policy file granting the
  WebUSB device, so the grant lives in the profile.
- `BOOT_UART=0` in the EEPROM config would save a few hundred ms of bootloader time but
  requires an EEPROM flash (`rpi-eeprom-config --apply`) — do it on the bench, on purpose.
- A one-off `initcall_debug` boot showed the two remaining kernel hogs:
  `init_kprobe_trace` (0.46 s, kernel-config, not tunable) and `bcmgenet_driver_init`
  (0.19 s — the Ethernet MAC). `initcall_blacklist=bcmgenet_driver_init` would save it
  at the cost of the TOFU's RJ45 port. Not applied.
- The `hdmi_enable_4kp60` warning from earlier boots was the 4K bench monitor; gone now.

### 22.4 Right-hand drive + panel resolution in the web app (2026-09-05, same day)
CarPlay supports RHD natively: the head unit sends a hand-drive value to the dongle at
init and iOS moves the sidebar to the right. node-carplay exposes it as
`DongleConfig.hand` (`HandDriveType.LHD = 0 | RHD = 1`, sent as `/tmp/hand_drive_mode`).
`carplay-web-app/src/App.tsx` on the Pi now sets `hand: HandDriveType.RHD`, and its
hardcoded canvas went **800x480 → 720x576** — the 800x480 "native S660 screen" was a
pre-EDID guess and would have been cropped on the pinned 720x576 mode. Both are applied by the idempotent embedded source patch in provision.sh PHASE 3B (the §21
mechanism, updated); **this supersedes §21's 800x480** — that figure was a pre-EDID guess.
The setting is read at dongle init, so a reboot/service restart plus one phone
reconnect is needed for it to show. **Not yet confirmed with a phone.**

### 22.5 Boot logo and a seamless start (2026-09-06)
Goal: S660 logo on screen while the unit boots, black page with the same logo as the web
app's background, no visible "Plug-In Carplay Dongle and Press" button, no flashes.

**What the screen actually does was measured with `grim` inside the cage session** (100 ms
captures across a kiosk restart; `sudo -u s660 XDG_RUNTIME_DIR=/run/carplay-kiosk
WAYLAND_DISPLAY=wayland-0 grim out.png`). Findings:
- Chromium presents a **pure white frame (~0.3 s)** when its window maps, then a black frame,
  then the page. On a black boot sequence that white flash is the single most visible defect.
  Fix: `--default-background-color=000000` (present in Debian's Chromium 151 — checked with
  `strings`), plus the logo inlined as a **data: URI** in `public/index.html` so the first page
  paint already contains it (a separate image request painted one black frame first).
  Result: black → logo, nothing in between (3.65 s after cage starts, ≈ 7 s after kernel start).
- `html, body { overflow: hidden }`: the 720x576 CarPlay canvas produced scrollbars otherwise.
- **A splash before/under cage cannot be seamless with this stack, so none was added.** Two
  variants were built and measured, both rejected: (a) a framebuffer logo when `/dev/fb0`
  appears — the kiosk unit's `TTYVTDisallocate` and cage's first (black) frame wipe it within
  ~0.1 s of it appearing (fb0 registers at ~3.45 s, cage starts at ~3.5 s); (b) `swayimg`
  showing the logo inside cage from 0.8 s, with Chromium started alongside — cage stacks the
  newest toplevel on top, so Chromium's blank frame *covers* the logo when it maps (logo →
  white/black blink → logo), and cage 0.2 has no layer-shell, so the splash cannot be kept
  above Chromium. The logo therefore appears when Chromium's page does, ~2.5 s later than a
  splash could show it, in exchange for zero flicker.
- Web app: the WebUSB button is now an invisible full-screen tap target (`opacity: 0`, kept
  because the first-time WebUSB authorisation needs a user gesture — tap anywhere on the logo);
  the 96 px grey spinner is a 28 px dim one at the bottom edge while waiting for the phone.
- All of it is in provision.sh PHASE 3B (App.tsx + index.html patches) and the kiosk script.
  `grim` is left installed as a diagnostic; `swayimg` was removed again.

### 22.6 Rollback
Originals of config.txt, cmdline.txt, fstab, the unit and the kiosk script are in
`/root/boot-tuning-backup-2026-09-05/` on the Pi, alongside the baseline
`systemd-analyze` output. `systemctl unmask` / `enable` reverses the unit changes;
`apt install cloud-init` if it is ever wanted again (it is not).


---

*Last updated: 2026-09-06. Status: Path B dev Chromium channel is the running kiosk, boot-tuned
(§22): kiosk service at 2.5 s, cage at 3.5 s, S660 logo page at ≈7 s after kernel start (26 s
stopwatch from power-on to picture before the logo work), display forced to the car panel's
720x576@50 via an EDID override (cage ignores `video=`), right-hand-drive layout requested
from the dongle, black page + inline logo + black Chromium blank colour = no flashes. No
network daemon on the boot path — Wi-Fi/SSH start 20 s after boot by design. The Carlinkit
dongle's own ~11 s boot is the floor for CarPlay availability. Path A (Electron,
`--disable-gpu`) remains a fallback and still uses the PAM-based unit. Open: confirm RHD
layout, logo geometry and touch calibration on the real panel; wireless pairing re-check with
`bluetooth.service` disabled; hardware video decode (V4L2 / custom Electron); regenerate the
stale on-disk `carplay.service` (§20).*
