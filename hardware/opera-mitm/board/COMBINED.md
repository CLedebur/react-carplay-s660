# S660 PDB + OPERA MITM — combined board, schematic specification (rev A)

One SMT board that does the jobs of two: the power-distribution board
(`references/S660-PDB_Design_Reference.md`, rev D) and the OPERA MITM board (`DESIGN.md` in this
folder). This file only records **what changes when the two are merged**. Every circuit detail not
listed here comes unchanged from those two documents.

KiCad project: `s660-pdb-mitm.kicad_pro` in this folder. One schematic sheet. Built with Konnect.
Schematic only: no PCB yet.

## 1. Merge decisions

| Decision | Choice | Why |
|---|---|---|
| Microcontrollers | **Keep both.** ATtiny85 (power supervisor) and a Pico 2 W module (MITM, §5) | The ATtiny runs from the always-on rail while the car is parked. A Pico asleep draws more than the whole <100 µA standby budget. The Pico only needs to run while the Pi runs. |
| 3.3 V rails | **Two separate rails.** PDB rail renamed `+3V3_AON`; MITM rail stays `+3V3` | `+3V3_AON` (LM2936) is always on. `+3V3` (the Pico's 3V3 output, from USB 5 V) exists only while the Pi is up. Joining them would back-feed the Pico from the car battery. |
| Ground | **One `GND`** | Already true: harness pin 9, the Pi's USB ground, the TOFU and chassis ground all meet anyway. |
| Signals between the halves | **None** in rev A | Each half keeps its own firmware spec. Possible later: RP2040 reads `IGN_STATE` on a spare GPIO. |
| PDB variant | **SMT** parts (`pdb-circuit/smt board/S660-PCB-long.kicad_sch`) **plus all rev D ★ items** | Matches the MITM's JLCPCB SMT assembly. |
| LED1 | **Push-to-test** (the 90 × 90 board's 2026-09-18 change) | Removes ~4.5 mA of continuous parked drain. |
| C7 | 22 µF 25 V tantalum, **no R20** | Its ESR of 1.4 Ω is already inside the LM2936's 0.3–8 Ω window. R20 was only needed for the aluminium part. |
| Mounting holes | PDB's four M3 (H101–H104); MITM's H1/H2 dropped | One board, one set of holes. |

## 2. Reference designators

- **MITM parts keep their `DESIGN.md` references** (U1–U3, Q1–Q5, K1, J1–J4, D1–D8, R1–R27, C1–C17, Y1,
  SW1, SW2, LED1).
- **PDB parts get their reference + 100** (PDB U1 → U101, K1 → K101, R17 → R117, FAN1 → FAN101, …).
  Rule of thumb: drop the leading 1 to find the part in the PDB reference.
- New PDB parts: SW101 (LED test button).

## 3. Net names on the PDB half

Unchanged: `12V_IN`, `12V_SW`, `ACC_IN`, `ON_IN`, `IGN_12V`, `IGN_STATE`, `IGN_MCU`, `BATT_SENSE`,
`COIL_DRV`, `COIL_LOW`, `HALT_IN`, `nRESET`, `LED3_DRV`, `FAN_PWM_BUS`, `FAN1_TACH`, `SHDN_TP`, `GND`.

Renamed so they cannot be confused with the MITM's J3 (the USB-C):

| PDB reference name | Combined board name |
|---|---|
| `3V3` | `+3V3_AON` |
| `J3_HALT` | `PI_HALT` |
| `J3_SHDN` | `PI_SHDN` |
| `FAN_PWM_PI` | `PI_FAN_PWM` |
| `TACH` | `PI_TACH` |
| `J3_MOSI` | `PI_MOSI` |
| `J3_MISO` | `PI_MISO` |
| `J3_RST` | `PI_ISP_RST` |
| (new) | `LED_TEST` (SW101 → R114) |

## 4. PDB half — parts and connections

| Ref | Part | LCSC | Symbol / footprint | Connections |
|---|---|---|---|---|
| J101 | Phoenix MC 1,5/4-G-5.08 | — | `Connector:Screw_Terminal_01x04` / `Connector_Phoenix_MC_HighVoltage:PhoenixContact_MC_1,5_4-G-5.08_1x04_P5.08mm_Horizontal` | 1 `GND`, 2 `ON_IN`, 3 `ACC_IN`, 4 `12V_IN` (reversed from the PDB reference on 2026-10-12 to line up with the TOFU-side wiring) |
| J102 | Phoenix MC 1,5/2-G-5.08 | — | `Connector:Screw_Terminal_01x02` / `…MC_1,5_2-G-5.08_1x02_P5.08mm_Horizontal` | 1 `12V_SW`, 2 `GND` (to TOFU) |
| D101 | 5.0SMDJ18A TVS | C2842368 | `Diode:5KPxxA` / `Diode_SMD:D_SMC` | K `12V_IN`, A `GND` |
| K101 | Omron G2RL-1A DC12 | — | `Relay:G2RL-1A` / `Relay_THT:Relay_SPST_Omron_G2RL-1A` | A1 `12V_IN`, A2 `COIL_LOW`, 13 (COM) `12V_IN`, 14 (NO) `12V_SW` |
| D104 | M7 (1N4007) | C7420350 | `Diode:1N4007` / `Diode_SMD:D_SMA` | K `12V_IN`, A `COIL_LOW` |
| Q102 | MMBT2222A | C8512 | `Transistor_BJT:MMBT2222A` / `SOT-23` | B ← R103, C `COIL_LOW`, E `GND` |
| R103 | 1k | C21190 | 0603 | `COIL_DRV` → Q102 B |
| C103 | 470 µF 35 V | C48935389 | `Device:C_Polarized` / `Capacitor_SMD:CP_Elec_8x10.5` | + `12V_SW`, − `GND` |
| JP101 | Phoenix MKDS 1/2-3,5 (1751248) + removable wire bridge | — | `Connector:Screw_Terminal_01x02` / `s660-pdb-mitm:Phoenix_MKDS_1_2_3.5_1751248` (project library, copied unchanged from the 90 × 90 PDB; KiCad's stock library has no MKDS 3.5 mm part) | 1 `12V_IN`, 2 `12V_SW`. Fitted = relay bypass (programming/recovery only) |
| D102, D103 | SS34 | C8678 | `Diode:SS34` / `Diode_SMD:D_SMA` | A `ACC_IN` / `ON_IN`, K `IGN_12V` |
| R106 | 2.2k | C4190 | 0603 | `IGN_12V` → U103 pin 1 |
| U103 | EL817S opto | C63268 | `Isolator:PC817` / `Package_SO:SOP-4_3.8x4.1mm_P2.54mm` | 1 anode ← R106, 2 cathode `GND`, 3 emitter `GND`, 4 collector `IGN_STATE` |
| R112 | 10k | C25804 | 0603 | `+3V3_AON` → `IGN_STATE` |
| R113 | 1k | C21190 | 0603 | `IGN_STATE` → `IGN_MCU` |
| U102 | LM2936MPX-3.3 | C2872050 | `Regulator_Linear:LM2936-3.3` / `Package_TO_SOT_SMD:SOT-223-3_TabPin2` | IN `12V_IN`, GND, OUT `+3V3_AON` |
| C105 | 100 nF | C14663 | 0603 | `12V_IN` – `GND` at U102 IN |
| C107 | 22 µF 25 V tantalum TAJC226K025RNJ | C7214 | `Device:C_Polarized` / `Capacitor_Tantalum_SMD:CP_EIA-6032-28_Kemet-C` | + `+3V3_AON`, − `GND` |
| U101 | ATtiny85-20SU | C31540447 | `MCU_Microchip_ATtiny:ATtiny85-20S` / `Package_SO:SOIC-8_5.3x5.3mm_P1.27mm` | 1 `nRESET`, 2 `BATT_SENSE` (ADC3), 3 `IGN_MCU`, 4 `GND`, 5 `COIL_DRV` (MOSI), 6 `LED3_DRV` (MISO), 7 `HALT_IN` (SCK), 8 `+3V3_AON` |
| C104 | 100 nF | C14663 | 0603 | U101 pin 8 – GND |
| R111 | 10k | C25804 | 0603 | `+3V3_AON` → `nRESET` |
| R101, R102 | 68k, 15k | C23231, C22809 | 0603 | `12V_IN` → R101 → `BATT_SENSE` → R102 → `GND` |
| Z102 | BZT52C3V6 | C19077397 | `Device:D_Zener` / `Diode_SMD:D_SOD-123` | K `BATT_SENSE`, A `GND` |
| C106 | 100 nF | C14663 | 0603 | `BATT_SENSE` – `GND` (pin 2 only; never on the SCK pin) |
| J103 | 2×5 header 2.54 mm, right-angle | — | `Connector_Generic:Conn_02x05_Odd_Even` / `Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Horizontal` | 1 `GND`, 2 `IGN_STATE`, 3 `PI_HALT`, 4 `PI_SHDN`, 5 `PI_FAN_PWM`, 6 `PI_TACH`, 7 `PI_MOSI`, 8 `PI_MISO`, 9 `PI_ISP_RST`, 10 `GND` |
| R107 | 1k | C21190 | 0603 | `PI_HALT` → `HALT_IN` |
| R108 | 1k | C21190 | 0603 | `PI_SHDN` → `SHDN_TP` |
| TP101 | test pad | — | `Connector:TestPoint` / `TestPoint:TestPoint_Pad_D1.5mm` | `SHDN_TP` |
| R117 | 1k | C21190 | 0603 | `PI_MOSI` → `COIL_DRV` |
| R118 | 1k | C21190 | 0603 | `PI_MISO` → `LED3_DRV` |
| R119 | 1k | C21190 | 0603 | `PI_ISP_RST` → `nRESET` |
| J104 | 2×3 ISP header, **DNP** | — | `Connector_Generic:Conn_02x03_Odd_Even` / `Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical` | 1 `LED3_DRV` (MISO), 2 `+3V3_AON` (sense only), 3 `HALT_IN` (SCK), 4 `COIL_DRV` (MOSI), 5 `nRESET`, 6 `GND` |
| R104, R105 | 100 Ω, 10k | C22775, C25804 | 0603 | `PI_FAN_PWM` → R104 → Q103 G; R105 G → `GND` |
| Q103 | 2N7002 | C8545 | `Transistor_FET:2N7002` / SOT-23 | G as above, D `FAN_PWM_BUS`, S `GND` |
| R109 | 1k | C21190 | 0603 | `FAN1_TACH` → `PI_TACH` |
| FAN101 | 1×4 header, right-angle | — | `Connector_Generic:Conn_01x04` / `PinHeader_1x04_P2.54mm_Horizontal` | 1 `GND`, 2 `12V_SW`, 3 `FAN1_TACH`, 4 `FAN_PWM_BUS` |
| FAN102, FAN103 | same | — | same | 1 `GND`, 2 `12V_SW`, 3 **no connect**, 4 `FAN_PWM_BUS` |
| SW101 | TS-1187A-B-A-B (same as SW1/SW2) | C318884 | `Switch:SW_Push` / `Button_Switch_SMD:SW_Push_1P1T_XKB_TS-1187A` | `12V_IN` → `LED_TEST` |
| R114, LED101 | 2.2k, red 0805 | C4190, C84256 | 0603 / `LED_0805_2012Metric` | `LED_TEST` → R114 → LED101 → `GND` (input power present, while TEST held) |
| R115, LED102 | 2.2k, green 0805 | C4190, C2297 | same | `12V_SW` → R115 → LED102 → `GND` (switched rail live) |
| R116, LED103 | 1k, red 0805 | C21190, C84256 | same | `LED3_DRV` → R116 → LED103 → `GND` (ATtiny heartbeat) |
| H101–H104 | M3 holes | — | `Mechanical:MountingHole` / `MountingHole_3.2mm_M3` | none |

Trace note for the PCB step: `12V_IN` and `12V_SW` are 2.0 mm power paths.

Board: 90 × 90 mm to match the TOFU it mounts behind. Mounting holes H101–H104 are 3.2 mm
(M3), centres 4.0 mm in from the left/right edges and 6.1 mm in from the top/bottom edges
(set 2026-10-13 to line up with the TOFU's holes).

## 5. MITM half

**MCU: Raspberry Pi Pico 2 W module (SC1634, the version with headers), socketed. This replaces
`DESIGN.md`'s chip-down RP2040** (decided 2026-10-12). It matches the perfboard build and the
firmware, which already targets `PICO_BOARD pico2_w` / `rp2350-arm-s`, so the firmware is
unchanged. U1 is `MCU_Module:RaspberryPi_Pico_W` on `Module:RaspberryPi_Pico_Common_THT`, plugged
into two 1×20 female 2.54 mm headers fitted by hand. JLCPCB does not assemble it.

| U1 pin | Net | Note |
|---|---|---|
| 4 GP2 | `PW_IN` | |
| 5 GP3 | `PW_OUT` | |
| 6 GP4 | `TX_OUT` | |
| 7 GP5 | `TX_IN` | |
| 9 GP6 | `RLY` | |
| 10 GP7 | `RST` | |
| 17 GP13 | `RX_IN` | |
| 29 GP22 | `LED` | **Moved from GPIO25.** On the W, GPIO25 is used inside the module by the wireless chip. The firmware needs `LED_PIN 22` when the LED is added. |
| 31 GP26 | `CONT_ADC` | |
| 30 RUN | `RUN` → SW2 → GND | Reset button. The module has its own pull-up. |
| 36 3V3 | `+3V3` | R6 pull-up. Still separate from `+3V3_AON`. |
| 40 VBUS | `+5V` | USB 5 V from the CM4 through the Pico's micro-USB: relay coil and the R9/R10 pull-ups, as on the perfboard. |
| GND pins, 33 AGND | `GND` | |

**J1 (car harness) is a Phoenix MC 1,5/7-G-5.08 pluggable header (1836312), not the JST XH in
`DESIGN.md`** (changed 2026-10-13, rev B). Same pin order, 1 TXp … 7 GND. It sits on the top
board edge between J102 and J101, pin 1 at the J101 end, so the harness plugs in beside the power
wires. Mating plug: MC 1,5/7-ST-5.08; use ferrules on the 16–18 AWG pigtail from the Y-harness
block. The LDO U102 with C105/C107 moved to the pocket the JST left, beside K1.
J2 (TOFU reset) stays JST XH: it is a short internal cable to a pin header.

Removed from `DESIGN.md`: U2 ME6211, U3 flash, Y1, J3 USB-C, J4 SWD (the module has its own debug
pads), SW1 BOOTSEL (on the module), R20–R27, C1–C17. Kept unchanged: J1, J2, K1, Q1–Q5, D1–D8,
R1–R19, LED1, SW2. H1/H2 dropped.

**RP2350 erratum E9 applies again** (it did not on the RP2040). The input dividers are the
perfboard's proven values: TX and RX 10k/15k give a 6 kΩ source, under the ~8.2 kΩ limit
(BUILD_NOTES §30.2).

Layout note for the PCB step: the Pico's micro-USB end must reach a board edge.

Changes to `DESIGN.md` values made on this board:

- **D8 is LCSC C19077397**, the same part as Z102. `DESIGN.md`'s C2113 does not exist in the JLCPCB
  catalogue (checked 2026-10-12). C19077397 is BZT52C3V6, SOD-123, a "preferred" part, so it adds no
  setup fee.
- **K1 pinout verified 2026-10-12** against Omron's G6K datasheet, page 6 ("G6K-2F-Y, Terminal
  Arrangement/Internal Connections, TOP VIEW"). Coil + is 1 and − is 8. Pole A: 6 COM, 7 NC, 5 NO.
  Pole B: 3 COM, 2 NC, 4 NO. The KiCad footprint matches: pads 1–4 in one row, 8–5 opposite, and a
  3.2 mm gap between pads 1 and 2. Mind the coil polarity: the datasheet notes it.

## 6. ERC helpers

`PWR_FLAG` on `12V_IN` (at J101 pin 1) and on `12V_SW` (it is driven through relay contacts,
which ERC cannot see as a source). `+5V` and `+3V3` need none: the Pico symbol's VBUS and 3V3 pins
are power outputs. The `GND` flag stays only if ERC still needs it.
