# OPERA MITM board — schematic specification (rev A, SMT, JLCPCB parts)

The single-board successor to the perfboard interceptor in `../tap-board.md`: an **RP2040 chip-down**
design with **one** DPDT signal relay, 2N7002 drivers, 0603 passives and latching harness connectors,
sized for JLCPCB economic assembly. Every part below was checked against the JLCPCB/LCSC library on
2026-09-27 (stock, basic/extended). The firmware in `../firmware/` runs unchanged apart from the board
target (§8).

This file is the build brief for the KiCad project that will live in this directory
(`opera-mitm.kicad_pro`). The schematic is built with Konnect (§9); nothing here is hand-written into
`.kicad_*` files.

## 1. What changed from the perfboard design

| Perfboard (`tap-board.md`) | This board | Why |
|---|---|---|
| Pico 2 module (RP2350) | RP2040 chip-down, same GPIO numbers | Same SDK, same `picotool` flashing; no E9 leakage erratum so the dividers are unconstrained; 15 × 15 mm instead of 21 × 51 mm |
| Two G5V-2-H1 relays (4 poles) | One G6K-2F-Y (2 poles) | Each pole now does both jobs: COM = panel wire, NC = head-unit wire, NO = 10k pull-up to 5 V. The MCU drivers sit permanently on the head-unit wires as open drains with 100k gate pull-downs, so they no longer need the NO contact |
| 2N7000 (TO-92, S-G-D) | 2N7002 (SOT-23, G-S-D) | Use the KiCad `Transistor_FET:2N7002` symbol so the pin order is right by construction |
| 5.08 mm screw terminals | JST XH 2.5 mm latching headers | Vibration; a crimped pigtail from the Y-harness |
| Nothing | TVS on every harness line, ESD-grade | Free on a fabbed board |
| Nothing | Status LED on GPIO25 | Same pin as the Pico's LED, so `PICO_DEFAULT_LED_PIN` works. Visual feedback for a Deaf owner matters |

Bypass semantics are unchanged: with the board unpowered or booting, the relay is released and the
panel's TX and PWR SW wires pass straight to the head unit with nothing else attached. With the
firmware running, the relay is energised 1.5 s after boot and the board owns both lines.

## 2. Firmware pin map (unchanged from `../firmware/src/config.h`)

| Signal | Net name on the schematic | RP2040 GPIO | RP2040 pin |
|---|---|---|---|
| PW_IN (buffer output, high = pressed) | `PW_IN` | GPIO2 | 4 |
| PW_OUT (drives Q2, fake Power press) | `PW_OUT` | GPIO3 | 5 |
| TX_OUT (UART1 TX, drives Q1, inverted in firmware) | `TX_OUT` | GPIO4 | 6 |
| TX_IN (panel's OPERA TX, UART1 RX) | `TX_IN` | GPIO5 | 7 |
| RLY (drives Q3, relay coil) | `RLY` | GPIO6 | 8 |
| RST (drives Q4, CM4 RUN_PG) | `RST` | GPIO7 | 9 |
| RX_IN (head unit's OPERA RX, UART0 RX, "car on" sense) | `RX_IN` | GPIO13 | 16 |
| LED (new) | `LED` | GPIO25 | 37 |
| CONT (ADC0) | `CONT_ADC` | GPIO26 | 38 |

All other GPIOs are left unconnected.

## 3. Connectors

**J1 — car harness, JST B7B-XH-A (7-pin, vertical, THT), LCSC C144398.** Pigtail from the Y-harness
terminal block. The Y-harness keeps panel pin 1 (TX) and pin 3 (PWR SW) split into a panel side and a
head-unit side, as the breadboard appendix of `tap-board.md` describes.

| J1 pin | Net | Harness |
|---|---|---|
| 1 | `TXp` | panel pin 1, panel-side wire (OPERA TX) |
| 2 | `TXh` | panel pin 1, head-unit-side wire |
| 3 | `PWp` | panel pin 3, panel-side wire (PWR SW) |
| 4 | `PWh` | panel pin 3, head-unit-side wire |
| 5 | `RX` | panel pin 2 (OPERA RX, both sides joined) |
| 6 | `CONT` | panel pin 12 (OPERA CONT, ~11 V) |
| 7 | `GND` | panel pin 9 |

**J2 — TOFU J1 reset, JST B3B-XH-A (3-pin, vertical, THT), LCSC C144394.** Wired 1:1 to the TOFU
carrier's unpopulated J1 (BUILD_NOTES §30.6).

| J2 pin | Net | TOFU J1 |
|---|---|---|
| 1 | no connect | GLOBAL_EN (never driven) |
| 2 | `GND` | GND |
| 3 | `RUN_PG` | RUN_PG |

**J3 — USB-C receptacle, HRO TYPE-C-31-M-12, LCSC C165948**, symbol
`Connector:USB_C_Receptacle_USB2.0_16P`, footprint `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12`
(pad names match the symbol: A1/A12/B1/B12 GND, A4/A9/B4/B9 VBUS, A5 CC1, B5 CC2, A6/B6 D+, A7/B7 D−,
SH shield). Cable to the CM4's USB.

| Symbol pin | Net |
|---|---|
| VBUS (A4, A9, B4, B9) | `+5V` |
| GND (A1, A12, B1, B12), SHIELD | `GND` |
| CC1 (A5) | `CC1` → R22 5.1k → `GND` |
| CC2 (B5) | `CC2` → R23 5.1k → `GND` |
| D+ (A6, B6) | `USB_DP_C` → R20 27 Ω → `USB_DP` (RP2040 pin 47) |
| D− (A7, B7) | `USB_DM_C` → R21 27 Ω → `USB_DM` (RP2040 pin 46) |
| SBU1, SBU2 | no connect |

**J4 — SWD debug, `Connector_Generic:Conn_01x03`, `PinHeader_1x03_P2.54mm_Vertical`, DNP.**
Pin 1 `SWCLK` (RP2040 pin 24), pin 2 `GND`, pin 3 `SWDIO` (RP2040 pin 25).

## 4. Power (values from Raspberry Pi's "Hardware design with RP2040", minimal design example)

- **U2 ME6211C33M5G-N** (SOT-23-5, LCSC C82942), symbol `Regulator_Linear:ME6211C33M5`: pin 1 VIN =
  `+5V`, pin 2 VSS = `GND`, pin 3 CE = `+5V`, pin 4 NC, pin 5 VOUT = `+3V3`. C16 10 µF on VIN, C17 10 µF
  on VOUT, both to GND. 500 mA, ceramic-stable, 6.5 V max input.
- **RP2040 supply pins (U1):**
  - IOVDD pins **1, 10, 22, 33, 42, 49** → `+3V3`, one 100 nF each to GND (C1–C6), placed at the pin.
  - USB_VDD pin **48** → `+3V3`, 100 nF (C7).
  - ADC_AVDD pin **43** → `+3V3`, 100 nF (C8).
  - VREG_VIN pin **44** → `+3V3`, 1 µF (C9) at the pin.
  - VREG_VOUT pin **45** → net `+1V1`, 1 µF (C10) at the pin.
  - DVDD pins **23, 50** → `+1V1`, 100 nF each (C11, C12).
  - TESTEN pin **19** → `GND`. GND pad **57** → `GND`.
- **RUN pin 26**: R27 10k → `+3V3`; SW2 (reset) from `RUN` to `GND`.
- Load: RP2040 plus flash ≈ 40 mA at 3.3 V, relay coil 21 mA at 5 V, LED ≈ 1 mA. Well inside the
  100 mA the USB descriptor requests.

## 5. RP2040 core

- **U1 RP2040** (QFN-56, LCSC C2040), symbol `MCU_RaspberryPi:RP2040`, footprint
  `Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm_ThermalVias`.
- **Crystal Y1 ABM8-272-T3** 12 MHz, CL 10 pF (3225, LCSC C20625731), symbol `Device:Crystal_GND24`,
  footprint `Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm`. Y1 pin 1 → `XIN` (U1 pin 20). Y1 pin 3 → R24 1k →
  `XOUT` (U1 pin 21); the 1k is the series damping resistor the reference design requires. Y1 pins 2 and
  4 → `GND`. C14 15 pF from Y1 pin 1 to GND, C15 15 pF from Y1 pin 3 to GND (C0G). Keep the whole cluster
  tight; the 3 pF of trace capacitance the design assumes is part of the load.
- **Flash U3 W25Q16JVUXIQ** 16 Mbit (USON-8 2 × 3 mm, LCSC C2843335), symbol `Memory_Flash:W25Q16JVSS`
  (same pin order as the SOIC-8 part, to be confirmed against the Winbond datasheet at build time, §9),
  footprint `Package_SON:Winbond_USON-8-1EP_3x2mm_P0.5mm_EP0.2x1.6mm`.

  | U3 pin | Name | Net | U1 pin |
  |---|---|---|---|
  | 1 | ~CS | `QSPI_SS` | 56 |
  | 2 | DO / IO1 | `QSPI_SD1` | 55 |
  | 3 | ~WP / IO2 | `QSPI_SD2` | 54 |
  | 4 | GND | `GND` | |
  | 5 | DI / IO0 | `QSPI_SD0` | 53 |
  | 6 | CLK | `QSPI_SCLK` | 52 |
  | 7 | ~HOLD / IO3 | `QSPI_SD3` | 51 |
  | 8 | VCC | `+3V3`, C13 100 nF | |

- **BOOTSEL**: `QSPI_SS` → R25 1k → SW1 → `GND`. R26 10k from `QSPI_SS` to `+3V3`, **DNP** (the reference
  design finds it unnecessary with Winbond flash; the pads stay for other flash parts).
- **USB**: R20, R21 27 Ω in series on D+ and D−, placed next to U1 (§3). No pull-ups: they are internal.
- **LED1** KT-0603R red (LCSC C2286): `LED` (U1 pin 37) → R19 1k → LED1 anode; cathode → `GND`.
  Roughly 1.3 mA, enough to see in a footwell.

## 6. Interceptor stages

All FETs are **2N7002, SOT-23, LCSC C8545 (basic)**, symbol `Transistor_FET:2N7002` (pin 1 G, 2 S, 3 D).

**Relay K1 — Omron G6K-2F-Y 5 V DC** (LCSC C2982926), symbol `Relay:G6K-2` (pins numbered 1–8, no
names), footprint `Relay_SMD:Relay_DPDT_Omron_G6K-2F-Y`. Pin functions from the Omron G6K datasheet,
"Terminal Arrangement / Internal Connections (TOP VIEW)" for G6K-2F-Y, cross-checked against the KiCad
footprint's pad positions (pads 1–4 in one column, 8–5 opposite them, 3.2 mm coil-to-contact gap):

| K1 pin | Function | Net |
|---|---|---|
| 1 | coil (+) | `+5V` |
| 8 | coil (−) | `RLY_COIL` (Q3 drain) |
| 6 | pole A COM | `TXp` |
| 7 | pole A NC | `TXh` |
| 5 | pole A NO | `TXp_PU` → R9 10k → `+5V` |
| 3 | pole B COM | `PWp` |
| 2 | pole B NC | `PWh` |
| 4 | pole B NO | `PWp_PU` → R10 10k → `+5V` |

The relay is single-side stable with no built-in diode, so coil polarity is not functionally critical;
wire it as above anyway. **D1 1N4148W** (SOD-123, LCSC C81598) flyback across the coil: cathode to
`+5V` (K1 pin 1), anode to `RLY_COIL` (K1 pin 8). Coil: 237 Ω, 21 mA.

**Input stages** (identical to phase 1, `tap-board.md`):

| Stage | Parts | Nets |
|---|---|---|
| TX divider | R1 10k, R2 15k | `TXp` → R1 → `TX_IN` → R2 → `GND`; `TX_IN` → U1 pin 7. 5 V → 3.0 V |
| RX divider | R3 10k, R4 15k | `RX` → R3 → `RX_IN` → R4 → `GND`; `RX_IN` → U1 pin 16 |
| PWR SW buffer | Q5, R5 10k, R6 10k | `PWp` → R5 → Q5 gate; Q5 source → `GND`; Q5 drain = `PW_IN` → R6 → `+3V3`; `PW_IN` → U1 pin 4. Inverted: low idle, high pressed. Zero load on the car's line, which the head unit senses (BUILD_NOTES §30.2) |
| CONT divider | R7 68k, R8 15k, D8 BZT52C3V6 | `CONT` → R7 → `CONT_ADC` → R8 → `GND`; D8 cathode on `CONT_ADC`, anode `GND`; `CONT_ADC` → U1 pin 38. 11 V → ~2.0 V, clamped at 3.6 V |

**Output drivers** — open-drain, each with a 1k gate resistor and a 100k gate pull-down so the FET is
off while the RP2040 is unpowered or its pins are still inputs:

| Driver | FET | Gate | Drain | Source |
|---|---|---|---|---|
| TX to head unit | Q1 | `TX_OUT` (U1 pin 6) → R15 1k; R11 100k to GND | `TXh` | `GND` |
| PWR SW to head unit | Q2 | `PW_OUT` (U1 pin 5) → R16 1k; R12 100k to GND | `PWh` | `GND` |
| Relay coil | Q3 | `RLY` (U1 pin 8) → R17 1k; R13 100k to GND | `RLY_COIL` | `GND` |
| CM4 reset | Q4 | `RST` (U1 pin 9) → R18 1k; R14 100k to GND | `RUN_PG` (J2 pin 3) | `GND` |

`TXh` and `PWh` are on both K1's NC contacts and the drivers' drains: in bypass the panel drives them
through the relay, in control the firmware drives them through Q1/Q2 against the head unit's own
pull-ups. One common ground: harness pin 9, USB ground and TOFU J1 pin 2 all land on `GND`.

**Protection at J1** (all to `GND`):

| Ref | Part | LCSC | On net |
|---|---|---|---|
| D2 | SMF5.0CA bidirectional TVS, SOD-123FL | C19077498 (preferred) | `TXp` |
| D3 | SMF5.0CA | C19077498 | `TXh` |
| D4 | SMF5.0CA | C19077498 | `PWp` |
| D5 | SMF5.0CA | C19077498 | `PWh` |
| D6 | SMF5.0CA | C19077498 | `RX` |
| D7 | SMF15A unidirectional TVS (cathode to the line) | C19077509 (preferred) | `CONT` (11 V nominal, 14.4 V charging, 15 V standoff) |

## 7. Parts list

Basic = no JLCPCB loading fee. Preferred = extended part with the fee waived. Extended = about $3
setup per part type. Nine extended types ≈ $27 on top of the economic assembly price.

| Ref | Value / part | Package | LCSC | Class | KiCad symbol / footprint |
|---|---|---|---|---|---|
| U1 | RP2040 | QFN-56 7×7 | C2040 | extended | `MCU_RaspberryPi:RP2040` / `Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP3.2x3.2mm_ThermalVias` |
| U2 | ME6211C33M5G-N 3.3 V LDO | SOT-23-5 | C82942 | extended | `Regulator_Linear:ME6211C33M5` / `Package_TO_SOT_SMD:SOT-23-5` |
| U3 | W25Q16JVUXIQ 16 Mbit QSPI | USON-8 2×3 | C2843335 | extended | `Memory_Flash:W25Q16JVSS` / `Package_SON:Winbond_USON-8-1EP_3x2mm_P0.5mm_EP0.2x1.6mm` |
| Y1 | ABM8-272-T3 12 MHz 10 pF | 3225 | C20625731 | extended | `Device:Crystal_GND24` / `Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm` |
| K1 | G6K-2F-Y 5 VDC DPDT | SMD 10×6.5 | C2982926 | extended | `Relay:G6K-2` / `Relay_SMD:Relay_DPDT_Omron_G6K-2F-Y` |
| J1 | JST B7B-XH-A | THT 2.5 mm | C144398 | extended | `Connector_Generic:Conn_01x07` / `Connector_JST:JST_XH_B7B-XH-A_1x07_P2.50mm_Vertical` |
| J2 | JST B3B-XH-A | THT 2.5 mm | C144394 | extended | `Connector_Generic:Conn_01x03` / `Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical` |
| J3 | HRO TYPE-C-31-M-12 | USB-C 16P | C165948 | extended | `Connector:USB_C_Receptacle_USB2.0_16P` / `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12` |
| J4 | SWD header, DNP | 1×3 2.54 mm | — | — | `Connector_Generic:Conn_01x03` / `Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical` |
| Q1–Q5 | 2N7002 | SOT-23 | C8545 | basic | `Transistor_FET:2N7002` / `Package_TO_SOT_SMD:SOT-23` |
| D1 | 1N4148W | SOD-123 | C81598 | basic | `Diode:1N4148W` / `Diode_SMD:D_SOD-123` |
| D2–D6 | SMF5.0CA | SOD-123FL | C19077498 | preferred | `Device:D_TVS` / `Diode_SMD:D_SOD-123F` |
| D7 | SMF15A | SOD-123FL | C19077509 | preferred | `Diode:SMF15A` / `Diode_SMD:D_SOD-123F` |
| D8 | BZT52C3V6 zener | SOD-123 | C2113 | extended | `Device:D_Zener` / `Diode_SMD:D_SOD-123` |
| LED1 | KT-0603R red | 0603 | C2286 | basic | `Device:LED` / `LED_SMD:LED_0603_1608Metric` |
| SW1, SW2 | TS-1187A-B-A-B tactile | SMD 5.1 mm | C318884 | basic | `Switch:SW_Push` / `Button_Switch_SMD:SW_Push_1P1T_XKB_TS-1187A` |
| R1, R3, R5, R6, R9, R10, R26 (DNP), R27 | 10k 1% | 0603 | C25804 (confirm at order) | basic | `Device:R` / `Resistor_SMD:R_0603_1608Metric` |
| R2, R4, R8 | 15k 1% | 0603 | C22809 | basic | same |
| R7 | 68k 1% | 0603 | C23231 | basic | same |
| R11–R14 | 100k 1% | 0603 | C25803 | basic | same |
| R15–R19, R24, R25 | 1k 1% | 0603 | C21190 | basic | same |
| R20, R21 | 27 Ω 1% | 0603 | C25190 | preferred | same |
| R22, R23 | 5.1k 1% | 0603 | C23186 | basic | same |
| C1–C8, C11–C13 | 100 nF 50 V X7R | 0603 | C14663 | basic | `Device:C` / `Capacitor_SMD:C_0603_1608Metric` |
| C9, C10 | 1 µF 50 V X5R | 0603 | C15849 | basic | same |
| C14, C15 | 15 pF 50 V C0G | 0603 | C1644 | basic | same |
| C16, C17 | 10 µF 10 V X5R | 0603 | C19702 | basic | same |
| H1, H2 | M2.5 mounting holes | — | — | — | `Mechanical:MountingHole` / `MountingHole:MountingHole_2.7mm_M2.5` |

Every symbol carries `Manufacturer`, `MPN` and `LCSC` fields so the same project exports the JLCPCB
BOM/CPL and a PCBWay MPN BOM, as the PDB project does.

Temperature note: the LCSC listing for C2982926 shows −40 to +70 °C; Hongfa HFD4/5-SR (C64399,
−40 to +85 °C) is the same footprint and a drop-in **only if** its terminal arrangement is verified
against the Hongfa datasheet first. Not done yet.

## 8. Firmware delta

In `../firmware/CMakeLists.txt`: `PICO_BOARD pico`, `PICO_PLATFORM rp2040`. Nothing in `main.c` is
RP2350-specific; the UART, ADC, watchdog and the TX output-invert exist on RP2040. `tusb_config.h`
already names `OPT_MCU_RP2040`. Optional: drive GPIO25 as a mode/relay indicator (`PICO_DEFAULT_LED_PIN`
resolves to 25 with the `pico` board). The BOOTSEL switch plus `picotool load -f` keep the existing
`build.sh flash` workflow from the Pi.

## 9. Building the KiCad project with Konnect

Konnect is installed (`~/Documents/KiCad/10.0/3rdparty/plugins/com_github_mixelpixx_konnect/bin/konnect`,
v0.12.0) and registered for Claude Code through the git-ignored `.mcp.json` at the repo root
(`.mcp.example.json` is the shareable template). A Claude Code session must be started **after** that
file exists for the `konnect` tools to be present.

Build order for the schematic agent, with the checks the `kicad-schematic` skill requires:

1. Create `hardware/opera-mitm/board/opera-mitm.kicad_pro` and one sheet.
2. Confirm the physical pin maps before placing package-sensitive parts:
   - U3: Winbond W25Q16JV datasheet, USON-8 pin configuration, against `Memory_Flash:W25Q16JVSS`.
   - U2: ME6211 datasheet SOT-23-5 (VIN, VSS, CE, NC, VOUT) against `Regulator_Linear:ME6211C33M5`.
   - K1: table in §6 against `Relay:G6K-2` and the footprint pads.
   - Q1–Q5: `Transistor_FET:2N7002` pin 1 G, 2 S, 3 D.
3. Place and wire block by block: §4 power, §5 core, §3 connectors, §6 interceptor and protection.
   Power symbols for `+5V`, `+3V3`, `+1V1` and `GND`; net labels for everything named above.
4. Fill `Manufacturer`, `MPN`, `LCSC` and `Footprint` on every symbol from §7; mark J4 and R26 DNP.
5. `annotate_schematic`, save, `validate_wire_connections`, `validate_component_connections`,
   `find_shorted_nets`, `find_orphan_items`, `run_erc`, `render_schematic_png` and look at it.
6. Export the BOM and check the LCSC numbers still show stock.

Layout notes for the PCB step (not part of this file's scope): 2-layer, solid ground on the bottom;
USB D+/D− as a 90 Ω pair over unbroken ground, 27 Ω resistors at U1; crystal and its caps within a
few millimetres of pins 20/21; every 100 nF at its pin; C9 at pin 44, C10 at pin 45; the relay, J1 and
the TVS diodes along one edge with the 5 V and 11 V car lines kept away from the crystal and USB.
Target outline about 35 × 45 mm. 1.0 mm board thickness matches the reference design's USB geometry;
1.6 mm also works for full-speed USB in practice.
