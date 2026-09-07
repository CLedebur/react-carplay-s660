# React-Carplay for the Honda S660

An open-source CarPlay head unit for the Honda S660, built on a Raspberry Pi Compute Module 4 (CM4) + Oratek TOFU carrier board. This repo is a fork of
[react-carplay](https://github.com/rhysmorgan134/react-carplay) (Electron + React), customised for the S660's panel, GPU, and boot environment.

Hardware assembly, wiring, and enclosure instructions are covered separately. This document is the software-side getting-started guide: how to provision a Pi into a working head unit, and how to develop on this fork.

## Current status

Two software paths exist for running CarPlay on the Pi. Both autostart at boot and
are stable; only one runs at a time.

| | Path A — `react-carplay` (this repo) | Path B — `carplay-web-app` (chosen) |
|---|---|---|
| Runtime | Electron, under `cage`, `--disable-gpu` | Pi's system Chromium, under `cage` |
| Rendering | Software (stable, low framerate) | GPU-composited (confirmed via `chrome://gpu`) |
| Dongle link | Native USB | WebUSB |
| Service | `carplay.service` | `carplay-dev-chromium.service` |

**Path B is the currently running channel** on the reference build — see
[`hardware/BUILD_NOTES.md`](hardware/BUILD_NOTES.md) §8.5 for why. Video **decode**
(as opposed to compositing) is still software either way; hardware H.264 decode
needs a custom-patched Electron build and is not yet verified. This repo (Path A)
is where that work — Electron 33 + Pi GPU flags — is happening; see
[`CLAUDE.md`](CLAUDE.md) for the exact state of that effort.

For the full build history, every non-obvious fix, and the reasoning behind each
decision, read [`hardware/BUILD_NOTES.md`](hardware/BUILD_NOTES.md) — it is the
source of truth for anything hardware-, boot-, or GPU-related.

## Getting started — provision a Pi head unit

This is the fastest path to a working unit and is how the reference build is set up.

**Hardware:**
- A Raspberry Pi Compute Module 4 flashed with **Raspberry Pi OS Lite (64-bit)**, currently Debian 13 "Trixie", with at least 4GB RAM.
- Oratek TOFU Board [(link)](https://store.oratek.com/products/tofu-electronic-board)
- Oratek M.2 Adapter [(link)](https://store.oratek.com/products/tofu-m-2-key-m-adapter)
- A CM4 Heatsink/Fan [(link)](https://pt.aliexpress.com/item/1005002541607239.html)
- A Carlinkit CPC200-CCPA/CCPM dongle. This performs the Apple MFi handshake, so an iPhone cannot be plugged directly into the Pi. [(link)](https://www.amazon.es/dp/B0H7GRL6YJ)
- HDMI-e to HDMI cable 0.5m [(example)](https://pt.aliexpress.com/item/1005005903047904.html)
- Honda S660 Option Coupler (required for providing power to the CM4 + board). A Pikaichi TR-196 is ideal if you can find one. Otherwise, you will want a branching coupler so that you can accommodate more peripherals in the future. This is what I got: [(example)](https://www.amazon.co.jp/-/en/dp/B0886HDJLB?ref=ppx_yo2ov_dt_b_fed_asin_title)
- Voltage Converter/Stabilizer (8V-40V to 12V 3A 36W) to provide the board with clean power. [(example)](https://www.amazon.es/dp/B0CPSLSH4J)
- **Not required but highly recommended** - NVMe M.2 SSD (as it will greatly improve boot times and hold up better than an eMMC).

**Run the provisioning script**, as your normal user (not root, not with `sudo` —
it calls `sudo` itself where needed):

```bash
git clone https://github.com/CLedebur/react-carplay-s660.git
cd react-carplay-s660/hardware
chmod +x provision.sh
./provision.sh
```

By default this installs **Path A only** (`carplay.service`, enabled/autostarting).
To install Path B instead — or in addition, side-by-side, and switch between them —
set the channel flags as environment overrides:

```bash
# Path B only (GPU-accelerated Chromium channel):
INSTALL_STABLE_A=no INSTALL_DEV_CHROMIUM=yes ./provision.sh

# Both, side by side (Path B installed but disabled; switch to it later):
INSTALL_STABLE_A=yes INSTALL_DEV_CHROMIUM=yes ./provision.sh
```

The script is safe to re-run after a failure or to add a channel to an
already-provisioned box. It ends with **a required reboot**; starting a kiosk
service live (`systemctl start`) does not reliably establish the VT/seat session on
first setup.

**Switching channels** (both installed, one enabled at a time — switching live
between them drops the HDMI output, so always reboot):

```bash
# -> Path B (dev Chromium/GPU):
sudo systemctl disable carplay.service && sudo systemctl enable carplay-dev-chromium.service && sudo reboot

# -> Path A (stable Electron):
sudo systemctl disable carplay-dev-chromium.service && sudo systemctl enable carplay.service && sudo reboot
```

**What the script does**, in short (see the script's own comments and
`hardware/BUILD_NOTES.md` §4 and §22 for the full reasoning):
- Trims ~10s off boot by disabling cloud-init, unneeded timers/services, swap, and
  the initramfs, and by quieting the kernel console.
- Installs `cage` (Wayland kiosk compositor) + `seatd`, and the udev rule that gives
  the Carlinkit dongle non-root USB/WebUSB access.
- Installs whichever app stack(s) you selected (AppImage for Path A; system Chromium
  + `node-CarPlay`'s `carplay-web-app`, pinned to a known-good toolchain, for Path B).
- Writes the systemd unit(s) that launch the kiosk on boot.

**By design, Wi-Fi/SSH come up ~20–30s after power-on**, well after the kiosk is on
screen — nothing on the boot-critical path is allowed to depend on the network,
since Wi-Fi is never guaranteed inside the car. Don't "fix" this; it's intentional.
If the Pi seems unreachable right after a reboot, give it a minute.

## Developing this fork (Path A source)

This repo is the Electron/React app itself — useful if you're working on Path A,
on the canbus/MOST bus/keybinding features below, or on the in-progress
Electron-33 GPU-decode work described in `CLAUDE.md`.

**Platform note:** `npm install` only works on Linux (target: the Pi, or another
arm64/x64 Linux box). `socketcan` is Linux-only and native modules (`usb`,
`socketcan`) are rebuilt for Electron via a postinstall step; it will not install on
macOS or Windows.

```bash
npm install         # Linux only — see above
npm run dev         # run in development
npm run build       # electron-vite build (does not run typecheck)
npm run build:armLinux   # build the arm64 AppImage for the Pi
```

`npm run typecheck` is optional and has ~11 pre-existing errors confined to the
vendored `h264-utils.ts`; the rest of the codebase is clean.

Once built, the render backend (WebGL / WebGL2 / WebGPU) is a runtime setting under
Settings → consumed in `Carplay.tsx`; the video decoder preference is set to
`prefer-hardware`. Saving Settings intentionally calls `app.relaunch()` and exits —
under the systemd service (`Restart=always`) it comes straight back.

### Manual installation (generic Pi, no S660-specific tuning)

If you're running plain `react-carplay` on a Pi outside the S660/provisioning-script
setup, the upstream manual steps still apply:

```bash
FILE=/etc/udev/rules.d/52-nodecarplay.rules
echo "SUBSYSTEM==\"usb\", ATTR{idVendor}==\"1314\", ATTR{idProduct}==\"152*\", MODE=\"0660\", GROUP=\"plugdev\"" | sudo tee $FILE
```

Download the latest AppImage from the
[releases page](https://github.com/rhysmorgan134/react-carplay/releases) (arm64 or
armv7l for 32-bit), make it executable, and run it:

```bash
chmod +x react-carplay-4.0.0-arm64.AppImage
./react-carplay-4.0.0-arm64.AppImage
```

## Features

- CarPlay configurable up to 60fps @ 1080p (hardware capability dependent)
- Canbus integration to show a camera feed when a canbus signal is received
- PiMost integration to stream Pi audio over a MOST bus network
- Configurable key bindings
- Choice of microphone and camera device

## Canbus configuration

The application supports canbus messages when a compatible socketcan interface is
present; it defaults to `can0`. You need three values from your car's CAN messages
to wire up a trigger. As an example, in a Freelander 2 the parking sensors set a bit
to true when active and false when inactive — an ideal trigger. Take this message:

`188#13400000FF0000FF`

This is made up of a CAN ID (`0x188`) and 8 data bytes
(`0x13 0x40 0x00 0x00 0xFF 0x00 0x00 0xFF`). Written as binary:

```
binary - 00010011  01000000  00000000  00000000  11111111  00000000  00000000  11111111
hex -      0x13      0x40      0x00      0x00      0xFF      0x00      0x00      0xFF
```

Toggling the parking sensors flips byte 1 between `0x40` and `0x00` — bit 6 of that
byte is the one that toggles (bits start at 0; the byte could show `0x41`/`0x01` in
practice and bit 6 would still be the relevant one).

So the three values to enter into react-carplay are:

- canID = `0x188` hex = 392 decimal
- mask = `0x40` hex = 64 decimal
- byte = 1

In the settings page, click the canbus option, and fill in the values found for
your car (these will differ unless you also have a Freelander 2).

## MOST bus PiMost integration

The MOST bus is a multimedia network — see
[how it works](https://moderndaymods.com/how-most-bus-works/) for background.
React-Carplay can disconnect the car's amplifier from its current source and
connect it to the Pi instead, streaming CarPlay audio directly onto the MOST bus.
To do this, tick the PiMost box on the settings page, then enter the fBlockID
(typically `0x22` for an amplifier), the instance ID, the sink ID, and the address
high/low for the amplifier.

## Keybindings

To configure key bindings, click the Bindings button in settings, choose the
function you need by clicking it, then press the desired key.

## Thanks

React-carplay uses [node-carplay](https://github.com/rhysmorgan134/node-CarPlay)
for interfacing with the dongle; @gozmanyoni and @steelbrain have contributed
significant carplay improvements upstream.

Buy the `react-carplay` developer [gozmanyoni some coffee](https://www.buymeacoffee.com/ygoz), if you'd like to show them appreciation.

<a href="https://www.buymeacoffee.com/rhysm" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>