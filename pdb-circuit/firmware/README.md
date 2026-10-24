# S660-PDB ATtiny85 firmware

The power supervisor for the S660-PDB boards (U1) and the combined Buddy Board (U101).
It switches the head unit's 12 V on with the ignition, keeps it on while the Pi shuts
down, and then cuts it. Specification: `references/S660-PDB_Design_Reference.md` §4.3
(state machine), §9 (programming) and §10.3 (timings).

| File | What it is |
|---|---|
| `src/pdb.c`, `src/pdb.h` | The state machine. Plain C, no AVR code, so it is tested on any computer. |
| `src/main.c` | ATtiny85 glue: pins, 10 ms timer tick, ADC, sleep, watchdog. |
| `tests/test_pdb.c` | One test per drive situation (fuel stop, normal shutdown, Pi hang, low battery, cranking, …). |
| `Makefile` | Build, test, fuses, flash. |

## Behaviour

| State | Relay (12V_SW) | LED3 / LED103 | Leaves when |
|---|---|---|---|
| SLEEP | open | dark | ignition on (≥ 200 ms) → RUN |
| RUN | closed | short blink every 2 s | ignition off (≥ 200 ms) → GRACE; HALT high 10 s → CYCLE |
| GRACE | closed | 4 Hz blink | ignition on → RUN; 5:15 elapsed, HALT high 10 s, or battery < 11.0 V for 10 s → CUT |
| CUT | open | solid 1 s | → SLEEP |
| CYCLE | open | 1 Hz blink | after 5 s → RUN (or SLEEP if the ignition went off) |

CYCLE is an addition to §4.3 (agreed 2026-10-24): if the Pi halts while the ignition is
on, the relay opens for 5 s so the Pi restarts without a key cycle.

Ignition changes shorter than 200 ms are ignored, so cranking (ACC drops, ON stays)
never starts GRACE. Low battery counts only from the start of GRACE, so a cranking dip
cannot cause a cut.

## Build and test

```bash
make test        # host tests, normal and short timers
make             # s660_pdb.hex (needs gcc-avr, avr-libc, binutils-avr)
make FAST=1      # bench build: 30 s grace, 2 s HALT / low battery / cycle
```

## Programming from the Pi (PDB reference §9.3–§9.5)

1. **Fit the JP1 / JP101 bridge.** The Pi is powered through the relay that this chip
   drives; without the bridge it loses power mid-flash.
2. **Turn the overlay off** before installing anything on the Pi (BUILD_NOTES §29).
3. Write the fuses once per chip, then the flash:

```bash
make fuses
make flash
```

4. Remove the bridge.

Fuses: `lfuse 0xE2` (8 MHz internal RC, CKDIV8 off), `hfuse 0xDD` (BOD 2.7 V, ISP
enabled), `efuse 0xFF`. **Never set RSTDISBL** (hfuse bit 7): it disables ISP for good.
`make fuses` refuses an HFUSE value that sets it or clears SPIEN.

The programmer is `pdb_isp`, defined in `pdb_isp.conf` and loaded with `avrdude -C +pdb_isp.conf`.
It uses the Pi's GPIO lines on J3 / J103. No `sudo` is needed: the user must be in the `gpio` group.

| ISP | ATtiny85 pin | J103 pin | Pi GPIO |
|---|---|---|---|
| MOSI (SDO) | 5 | 7 | GPIO5 |
| MISO (SDI) | 6 | 8 | GPIO6 |
| SCK | 7 | 3 | GPIO26 |
| RESET | 1 | 9 | GPIO13 |

`make id` reads only the chip signature (`0x1e 0x93 0x0b` = ATtiny85). Use it as the
first contact check.

**avrdude must be built from source.** Debian Trixie's `avrdude` 7.1 package is built
without the `linuxgpio` programmer (`cannot find programmer id linuxgpio`). `linuxspi` does
not fit either, because these are not the SPI0 pins. `hardware/provision.sh` PHASE 4b builds
avrdude v8.3 with libgpiod into `/usr/local`. It also sets the GPIO pulls in `config.txt`:
GPIO5 is pulled down, so the relay transistor stays off while the ATtiny is blank or in
reset. GPIO6 and GPIO13 have no pull.
