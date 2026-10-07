# S660 CarPlay

An open-source CarPlay head unit for the Honda S660, built on a Raspberry Pi Compute Module 4 (CM4) + Oratek TOFU carrier board. CarPlay runs as a web app ([`carplay-web-app`](hardware/path-b/node-CarPlay/), built on [node-CarPlay](https://github.com/rhysmorgan134/node-CarPlay)) in the Pi's own Chromium, full-screen under the `cage` kiosk compositor, customised for the S660's panel, controls, and boot environment.

Hardware assembly, wiring, and enclosure instructions are covered separately. This document is the software-side getting-started guide: how to provision a Pi into a working head unit, and how to develop on it.

## Current status

The Pi's system Chromium **composites on the GPU and decodes the CarPlay H.264 stream in hardware**. Measured 2026-09-12 with CarPlay streaming, Chromium's GPU process holds `/dev/video10`, the CM4's `bcm2835-codec` decoder. Raspberry Pi's Chromium build carries the V4L2 patches, and the web app's WebCodecs decoder picks them up with no extra flags (BUILD_NOTES §8.5, §27.1). The kiosk is on screen about 2.5 s after the kernel starts. Logs from every drive are kept on a dedicated `/persist` partition (§31).

> **Path A retired (2026-10-07).** This repo started as a fork of [react-carplay](https://github.com/rhysmorgan134/react-carplay), an Electron app. Upstream Electron lacks the Pi's GPU/V4L2 patches, so it could only render and decode in software. It has been removed in favour of the web app, which is much faster. The last commit containing it is tagged [`path-a-final`](https://github.com/CLedebur/react-carplay-s660/tree/path-a-final), including its CAN-bus, MOST and key-binding code (BUILD_NOTES §32). You will still see "Path A" and "Path B" in the build notes. That history is kept on purpose.

For the full build history, every non-obvious fix, and the reasoning behind each decision, read [`hardware/BUILD_NOTES.md`](hardware/BUILD_NOTES.md) — it is the source of truth for anything hardware-, boot-, or GPU-related.

For PCB design work with the KiCad MCP server in VS Code/Copilot, see
[`pdb-circuit/README.md`](pdb-circuit/README.md).

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

This installs the web app as `carplay-dev-chromium.service`, enabled to start at boot. The name is historical: it was the "dev" channel when the Electron app was the stable one. The script is safe to re-run after a failure. It ends with **a required reboot**. Starting the kiosk service live (`systemctl start`) does not reliably set up the VT/seat session on first setup. That reboot also runs the one-shot `/persist` repartition (BUILD_NOTES §31), so keep the Pi on stable power for it.

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
2. Man-in-the-Middle (MITM) proxy for the physical buttons on the center console so that the buttons and knob can be used to control the CarPlay app ([`hardware/opera-mitm/`](hardware/opera-mitm/), BUILD_NOTES §30).
3. CAN-bus connection, to build vehicle data and the car's own views into the web app.
4. (eventually) A replacement screen for the S660 with touchscreen capabilities and a higher resolution than the stock screen.

# Script Details

**What the script does**, in short (see the script's own comments and
`hardware/BUILD_NOTES.md` §4, §22, §24, and §29 for the full reasoning):

- Trims ~10s off boot by disabling cloud-init, unneeded timers/services, swap, and the
  firmware's own initramfs auto-detection, and by quieting the kernel console.
- Enables Overlay FS: the real root filesystem is mounted read-only underneath a writable
  tmpfs layer, so a hard power cut — this car's normal shutdown path, via ignition, on every
  drive — can't corrupt it. Needs an initramfs to actually run (that's what the auto-detection
  above skips; this one is loaded explicitly instead), which is installed and built during
  provisioning. `/boot/firmware` stays normally writable throughout — verified against a real
  hard power cut (`BUILD_NOTES.md` §29).
- Shrinks root to 64 GiB once and gives the rest of the disk to a `/persist` partition,
  which the overlay does not cover. The systemd journal and the last-known clock live there,
  so every drive's logs survive the ignition cutting power (`BUILD_NOTES.md` §31).
- Installs `cage` (Wayland kiosk compositor) + `seatd`, the udev rule that gives the
  Carlinkit dongle non-root USB/WebUSB access, and a Chromium managed policy that
  pre-grants the dongle to the kiosk page — no on-screen authorisation, ever, even after a
  browser-profile reset (BUILD_NOTES §28).
- Installs system Chromium and builds this repo's vendored `node-CarPlay`/`carplay-web-app`
  source.
- Writes and enables the systemd unit that launches the kiosk on boot.
- Preloads the HDMI component drivers and overlaps the web server and compositor startup.
  (An earlier version of this also shipped an auto-refreshed uncompressed kernel image for
  a further ~2s savings; reverted after a field failure — see `BUILD_NOTES.md` §26.)
- Starts host Bluetooth after 15 s for the trackpad, including when Chromium requests
  BlueZ through D-Bus. Pairing data and the Bluetooth radio remain available.

**By design, networking is requested 20 s after Linux starts**, and timer coalescing
can delay it further. Nothing on the boot-critical path depends on the network,
since Wi-Fi is never guaranteed inside the car. Don't "fix" this; it's intentional.
If the Pi seems unreachable right after a reboot, give it a minute.

## Developing the app

The app source is the `node-carplay` library plus `carplay-web-app`, modified from upstream
[`rhysmorgan134/node-CarPlay`](https://github.com/rhysmorgan134/node-CarPlay) (MIT). It is
vendored directly into this repo at
[`hardware/path-b/node-CarPlay/`](hardware/path-b/node-CarPlay/). It is not a separate
clone or an npm/git dependency. Edit it in place, rebuild, and redeploy by pulling this
repo onto the Pi; the kiosk serves
`~/react-carplay-s660/hardware/path-b/node-CarPlay/examples/carplay-web-app`. See that
directory's own `README.md` and `hardware/BUILD_NOTES.md` §11 and §23 for the exact
build/deploy commands and toolchain gotchas.

**Overlay FS is on in normal use**, so changes made on the Pi vanish at the next power-off.
Turn it off before you deploy (BUILD_NOTES §29), and turn it back on afterwards.

## Thanks

This project builds on [node-carplay](https://github.com/rhysmorgan134/node-CarPlay) and
began as a fork of [react-carplay](https://github.com/rhysmorgan134/react-carplay), both by
Rhys Morgan, with significant CarPlay improvements contributed upstream by @gozmanyoni and
@steelbrain.

If you'd like to show them appreciation, you can [buy gozmanyoni a coffee](https://www.buymeacoffee.com/ygoz) or [buy Rhys a coffee](https://www.buymeacoffee.com/rhysm).
