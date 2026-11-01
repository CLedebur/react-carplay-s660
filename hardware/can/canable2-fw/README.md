# CANable 2.0 firmware — S660 silent-mode patch

The discovery adapter is a generic **"CANable 2.0 Pro"** (STM32G431CBU6, BOOT button, USB-A;
BUILD_NOTES §34). Like most CANable 2.0 clones, including Makerbase's, it ships with the
upstream [`canable2-fw`](https://github.com/normaldotcom/canable2-fw) slcan firmware: the USB
product string says `b158aa7`, and the `V` reply says `16e7497-dirty`. This folder patches that firmware so it **really listens without transmitting**,
and so it is **silent from power-up**.

## Why

Upstream accepts `M1` ("silent mode"), but `O` (open channel) then hard-codes
`FDCAN_MODE_NORMAL` and throws the setting away. So the adapter is **always in normal mode**
on the bus. It ACKs every frame, and at a wrong bit rate it sends error frames onto the car's
bus. Nothing on the board can make up for that. The schematic ties the transceiver's silent pin
(TJA1051T/3 pin 8, S) to GND on Makerbase's published V2.0 schematic, and our board has no
silent switch either. The fix has to be in firmware.

## What the patch changes

| Change | Effect |
|---|---|
| `can_enable()` uses the stored mode instead of `FDCAN_MODE_NORMAL` | `M1` actually works |
| The stored mode **defaults to silent** (`FDCAN_MODE_BUS_MONITORING`) | Plug in, open, listen: no ACKs, no error frames, nothing sent. Transmitting needs an explicit `M0` before `O`. This is the gate for any future TX work. |
| `M` only accepts exactly `M0` / `M1` | Some slcan tools send the LAWICEL acceptance-code command `M00000000` when they connect. Upstream read that as "normal mode". It is now ignored. |
| New `m` command → replies `M1` or `M0` | Reports the mode. While the channel is open, it reads the FDCAN's own `CCCR.MON` bit, so the answer is what the hardware is doing, not what was requested. `mxxxxxxxx` (acceptance mask) is ignored. |
| `can_tx()` refuses frames while silent | A `t…`/`T…` command can never queue a frame in silent mode |
| `slcan.c` includes `printf.h` | Build fix only. Upstream calls `snprintf_` without declaring it, which GCC 14 (Debian Trixie's `gcc-arm-none-eabi`) rejects. |

The kernel's slcan driver and `slcand` never send `M`, so with this firmware the normal
SocketCAN bring-up is listen-only with no extra flags. Do **not** pass `slcand -l`: it sends
LAWICEL `L`, which this firmware does not implement.

## Build

On any Debian / Raspberry Pi OS host with `git make gcc-arm-none-eabi libnewlib-arm-none-eabi`
installed:

```bash
./build.sh
```

The script clones upstream at `b158aa7`, applies `s660-silent-mode.patch`, and writes
`build/canable2-b158aa7-s660.1.bin`. The version shows up in `V` and in the USB product
string, so you can tell the firmware on the stick from upstream.

## Flash

1. Put the board in DFU mode. Disconnect the screw terminal. Hold the **BOOT button** while
   you plug the adapter into USB, then release it after about 2 s. (Makerbase's V2.0 has no
   button: fit a cap on its BOOT pin pair instead.) `lsusb` shows
   `0483:df11 STMicroelectronics STM Device in DFU Mode`, and `dfu-util -l` shows
   `@Internal Flash /0x08000000/64*02Kg` (128 KiB).
2. **Back up the current firmware first:**
   `sudo dfu-util -d 0483:df11 -a 0 -s 0x08000000:131072 -U canable2-original-full.bin`
3. Flash:
   `sudo dfu-util -d 0483:df11 -a 0 -s 0x08000000:leave -D build/canable2-b158aa7-s660.1.bin`
4. Unplug and re-plug (without the button, or with Makerbase's cap removed).

Our unit's stock image is backed up as `build/canable2-original-full.bin` (not in git;
sha256 `9a15689ef944aca69f13ea970af84faab184d368a127b09ee4ff420760ba72d7`). To go back
to stock, flash it the same way, or Makerbase's
`Firmware/CANable V2.0/slcan.zip` from
[makerbase-mks/CANable-MKS](https://github.com/makerbase-mks/CANable-MKS).

## Verify

The adapter is a USB serial port. **Use its `/dev/serial/by-id/` name, not `ttyACMn`.** On the
S660 Pi, the OPERA MITM Pico is also a `ttyACM` device, and the numbers can swap at boot.
Opening the Pico's port by mistake is the console-echo hazard.

```
V   → b158aa7-s660.1 github.com/CLedebur/react-carplay-s660
m   → M1                 (power-up default)
S6  O   m   → M1         (open at 500k: hardware reports bus monitoring)
C   M0  m   → M0         (only after an explicit M0)
C   M1                   (back to silent before closing out)
```

## License

Upstream `canable2-fw` is MIT-licensed. This folder holds only our patch and build script.
