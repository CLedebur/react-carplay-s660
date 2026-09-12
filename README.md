# React-Carplay for the Honda S660

An open-source CarPlay head unit for the Honda S660, built on a Raspberry Pi Compute Module 4 (CM4) + Oratek TOFU carrier board. This repo is a fork of [react-carplay](https://github.com/rhysmorgan134/react-carplay) (Electron + React), customised for the S660's panel, GPU, and boot environment.

Hardware assembly, wiring, and enclosure instructions are covered separately. This  document is the software-side getting-started guide: how to provision a Pi into a working head unit, and how to develop on this fork.

## Current status

Two software paths exist for running CarPlay on the Pi. Both autostart at boot and
are stable; only one runs at a time.

| | Path A — `react-carplay` (this repo) | Path B — `carplay-web-app` (chosen) |
|---|---|---|
| Runtime | Electron, under `cage`, `--disable-gpu` | Pi's system Chromium, under `cage` |
| Rendering | Software (stable, low framerate) | GPU-composited (smoothest performance) |
| Dongle link | Native USB | WebUSB |
| Service | `carplay.service` | `carplay-dev-chromium.service` |

**Path B is the currently running channel** on the reference build — see [`hardware/BUILD_NOTES.md`](hardware/BUILD_NOTES.md) §8.5 for why. Video **decode** (as opposed to compositing) is still software either way; hardware H.264 decode needs a custom-patched Electron build and is not yet verified. This repo (Path A) is where that work — Electron 33 + Pi GPU flags — is happening; see [`CLAUDE.md`](CLAUDE.md) for the exact state of that effort.

For the full build history, every non-obvious fix, and the reasoning behind each decision, read [`hardware/BUILD_NOTES.md`](hardware/BUILD_NOTES.md) — it is the source of truth for anything hardware-, boot-, or GPU-related.

# Getting started

This is the fastest path to a working unit and is how the reference build is set up.

## Hardware

- A Raspberry Pi Compute Module 4 flashed with **Raspberry Pi OS Lite (64-bit)**, currently Debian 13 "Trixie", with at least 4GB RAM.
- Oratek TOFU Board [(link)](https://store.oratek.com/products/tofu-electronic-board)
- Oratek M.2 Adapter [(link)](https://store.oratek.com/products/tofu-m-2-key-m-adapter)
- CM4 Heatsink/Fan [(link)](https://pt.aliexpress.com/item/1005002541607239.html)
- Carlinkit CPC200-CCPA/CCPM dongle. This performs the Apple MFi handshake, so an iPhone cannot be plugged directly into the Pi. [(link)](https://www.amazon.es/dp/B0H7GRL6YJ)
- HDMI-e to HDMI cable 0.5m [(example)](https://pt.aliexpress.com/item/1005005903047904.html)
- Honda S660 Option Coupler (required for providing power to the CM4 + board). A Pikaichi TR-196 is ideal if you can find one. Otherwise, you will want a branching coupler so that you can accommodate more peripherals in the future. This is what I got, though I wasn't able to find a branching type coupler: [(example)](https://www.amazon.co.jp/-/en/Pikachi-Power-Supply-Optional-Coupler/dp/B0116HSI40)
- Voltage Converter/Stabilizer (8V-40V to 12V 3A 36W) to provide the board with clean power. [(example)](https://www.amazon.es/dp/B0CPSLSH4J)
- **Not required but highly recommended** - NVMe M.2 SSD (as it will greatly improve boot times and hold up better than an eMMC).
- A MicroSD card (at least 16GB) to flash the Pi OS Lite image onto the CM4. 
- 2.1mm barrel jack AC adapter [(link)](https://www.amazon.es/dp/B09K59PGZ5)
- Wi-Fi Antenna (if you want to use Wi-Fi instead of Ethernet). [(example)](https://www.amazon.es/dp/B08RRX9H2Q)
- 3D-Printed case (pending)

### Assembly

1. Using the standoffs provided by the heatsink/fan kit between the CM4 and the TOFU board, mount the CM4 to the TOFU board. This will allow the heatsink/fan to be mounted on top of the CM4 without bending the CM4.
2. Insert the MicroSD card into the CM4 and flash the Raspberry Pi OS Lite (64-bit) image onto it. You can use [Raspberry Pi Imager](https://www.raspberrypi.com/software/) to do this.
3. Insert the NVMe M.2 SSD into the M.2 adapter first, and then insert onto the TOFU board, and then mount.
4. Connect a monitor to the HDMI port, and a keyboard to the TOFU board. Power on the board and complete the initial setup of the Raspberry Pi OS Lite (64-bit) image. Make sure to enable SSH and set a username and password.
5. Connect the Carlinkit dongle to the USB port on the TOFU board.
6. Run the provisioning script (see below) to install the software and configure the system.

## Software

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

# Physical Installation

## Modifying the head unit

Using plastic trim removal tools, remove the S660's interior parts in this order:

1. Glove box
2. AC vent behind glove box
3. Panels on both sides of the center console in the footwells
4. Remove the plastic shroud behind the center screen, and then unscrew the bolts. Unplug the proprietary HDMI-e cable (gray) and remove the screen.
5. The frame around the stick shift. No need to pull it off entirely, just enough to remove the frame around the center console. The frame is held in place by clips, so be careful not to break them.
6. The tray behind the stick shift. It is held in place with clips. Gently pry the tray up and pull it out. Be careful not to break the clips. Disconnect the cables for the buttons and set aside.
7. The center console itself. It is held in place with clips. Gently pry the front of the console up and pull it out. Be careful not to break the clips. Disconnect the cables for the buttons and set aside.
8. Unscrew the two 10mm bolts securing the head unit to the dashboard. Do not remove, only loosen them.
9. Slide the head unit out sideways; it will slide out of the compartment where the glove box was. Disconnect the cables as you go. Try not to disconnect as many cables you can, as it's very difficult to reconnect them.
10. When you're able to reach it, unplug the HDMI-e cable on the far right side of the head unit (it is the black one) and set aside. Plug in the new HDMI-e cable and route it down to the cavity in the center console behind the shifter.
11. Re-insert the head unit, reconnecting the cables along the way, EXCEPT for the 24-pin harness at the far left. Pull out the harness as much as you can, and then strip away some of the electrical tape to expose around 5mm of the wire coming from pin 22. It will be the light green wire on the bottom left.
12. Cut the wire 5mm from the plug, and then solder the wire from the plug to a small length of wire that will reach a screw on the left side of the head unit. If done correctly, this will bypass the handbrake signal and allow the head unit to work while driving. Make sure to insulate the soldered connection with heat shrink or electrical tape.
13. Plug in the harness and test the head unit. If it works, reassemble the glove box and the AC vent behind it. If it doesn't work, check the soldered connection and make sure the wire is connected to the screw on the left side of the head unit.

## Powering the Pi

1. Wire the 8v-40v to 12v converter to the option coupler. You will want about 1.5m of wire to reach the center console. The converter can be kept in the cavity behind the stick shift. Ensure you connect the positive wire to port number five on the coupler (IGN power). The negative wire will be connected to the chassis ground.
2. Follow [these instructions](https://minkara.carview.co.jp/userid/135377/car/3279425/6972067/note.aspx) to install the option coupler behind the driver's side AC vent.
3. Route the wire behind the carpet. Make sure you secure the wire with zip ties to prevent them from getting caught up in the pedals.
4. Route the wire to the cavity under the center console, and connect to the red/black wire pair on the converter.
5. Connect the industrial connector provided by the TOFU board to the yellow/black wire pair on the converter.
6. Plug in the industrial connecetor to the Pi and start the car to test the power. The Pi should boot up.
7. Switch the input to HDMI via the button on the steering wheel if it isn't there already. The Pi should be running the CarPlay app.

# Works in Progress

1. 3D-printed case for the Pi + TOFU board sized to fit the S660's center console with mounting points.
2. Man-in-the-Middle (MITM) proxy for the physical buttons on the center console so that the buttons and knob can be used to control the CarPlay app.
3. (eventually) A replacement screen for the S660 with touchscreen capabilities and a higher resolution than the stock screen.

# Script Details

**What the script does**, in short (see the script's own comments and
`hardware/BUILD_NOTES.md` §4, §22, and §24 for the full reasoning):

- Trims ~10s off boot by disabling cloud-init, unneeded timers/services, swap, and
  the initramfs, and by quieting the kernel console.
- Installs `cage` (Wayland kiosk compositor) + `seatd`, and the udev rule that gives
  the Carlinkit dongle non-root USB/WebUSB access.
- Installs whichever app stack(s) you selected (AppImage for Path A; system Chromium
  + this repo's vendored `node-CarPlay`/`carplay-web-app` source, for Path B).
- Writes the systemd unit(s) that launch the kiosk on boot.
- Preloads the HDMI component drivers and overlaps the web server and compositor startup.
  (An earlier version of this also shipped an auto-refreshed uncompressed kernel image for
  a further ~2s savings; reverted after a field failure — see `BUILD_NOTES.md` §26.)
- Starts host Bluetooth after 15 s for the trackpad, including when Chromium requests
  BlueZ through D-Bus. Pairing data and the Bluetooth radio remain available.

**By design, networking is requested 20 s after Linux starts**, and timer coalescing
can delay it further. Nothing on the boot-critical path depends on the network,
since Wi-Fi is never guaranteed inside the car. Don't "fix" this; it's intentional.
If the Pi seems unreachable right after a reboot, give it a minute.

## Developing this fork (Path B source — the currently running channel)

Path B's app source (the `node-carplay` library + `carplay-web-app`, modified from
upstream [`rhysmorgan134/node-CarPlay`](https://github.com/rhysmorgan134/node-CarPlay),
MIT) is vendored directly into this repo at
[`hardware/path-b/node-CarPlay/`](hardware/path-b/node-CarPlay/) — it is not a separate
clone or npm/git dependency. Edit it in place, rebuild, and redeploy by pulling this
repo onto the Pi and pointing the kiosk at
`~/react-carplay-s660/hardware/path-b/node-CarPlay/examples/carplay-web-app`. See that
directory's own `README.md` and `hardware/BUILD_NOTES.md` §11 and §23 for the exact
build/deploy commands and toolchain gotchas.

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
