# S660-PDB rev D review and assembly notes

Review date: 2026-09-18. Scope: the **90 × 90 mm through-hole board** in this directory, despite the directory name `90x90cm board`. The SMT design is outside the requested files and has not been updated by this work. The requirements source is [S660-PDB_Design_Reference.md](../../references/S660-PDB_Design_Reference.md); the corrections below supersede its identified contradictory statements for this board.

## Validation status

- Schematic ERC after the TO-92 footprint update: **0 errors, 0 warnings**.
- Saved PCB DRC after routing and refilling both ground pours: **0 errors, 0 unconnected items, 23 warnings**. Konnect schematic-to-PCB synchronization reports `noop`, with no conflicts, unassigned footprints or pending connectivity/value/footprint changes. The remaining warnings and acceptance holds below prevent a manufacturing-ready verdict.
- The embedded title-block revision may still read **C**. Treat that metadata as a known limitation; identify this change by the circuit, this review record and the final validation results, not the title alone.
- New and corrected package mappings were checked using Konnect library queries, disposable placements, readback and rendered inspection. Design source changes were made through Konnect.

## Circuit changes and corrected reference assumptions

- U1 pin **2 / PB3 / ADC3** is BATT_SENSE; pin **7 / PB2 / SCK** is HALT_IN. R7 connects J3 pin 3 to U1 pin 7. The reference's §6 C R7 row and §10.2 battery-sense table retain obsolete pin numbers. Firmware must sample ADC3.
- Rev D adds R17–R19 (1 kΩ), the ten-pin J3, six-pin ISP J4 and relay-bypass JP1. JP1 connects 12V_IN to 12V_SW across K1's contacts; its power traces require 2.0 mm width.
- **U2 LM2936Z-3.3 TO-92 requires pin 1 = OUT / 3V3, pin 2 = GND, pin 3 = IN / 12V_IN.** The former `Regulator_Linear:LM2936-3.3` symbol described another package and reversed input/output for this purchased part. Use `Regulator_Linear:LM2936-3.3_TO92` with `Package_TO_SOT_THT:TO-92_Inline_Wide`. TI's p. 3 drawing is a bottom view; the physical flat-face-forward, leads-down order is OUT–GND–IN. [TI datasheet, SNOSC48O, p. 3](https://www.ti.com/lit/gpn/LM2936)
- **C7 is now Panasonic EEUFR1E470, 47 µF / 25 V, with R20 = 1 Ω in series.** R20 is Vishay MRS25000C1008FCT00 (1%, 0.6 W). The branch is 3V3 → R20 → C7 positive; C7 negative → GND. U2 OUT, U1 VCC and C4 remain directly on 3V3. The LM2936-3.3 requires at least 22 µF effective capacitance and 0.3–8 Ω branch ESR; the added resistor supplies the ESR floor. Full supply/load/temperature stability remains a bench test. [TI datasheet, pp. 14–15](https://www.ti.com/lit/gpn/LM2936). See [package and qualification record](C7-JP1-QUALIFICATION.md) for exact parts, polarity, fit and limits.
- C3 and C7 use polarized schematic symbols. Pad 1 is positive; pad 2 is GND. The capacitor stripe marks the negative lead.
- **Q2 Diotec BC337-40 is C–B–E**, pins 1–2–3, with the flat face forward and leads down. The existing electrical mapping is correct; the reference's E–B–C assembly instruction is incorrect. [Diotec BC337 datasheet, p. 1](https://diotec.com/tl_files/diotec/files/pdf/datasheets/bc337.pdf)

## J1/J2 purchased connectors

Use the nonflanged **G** versions, not the former **GF** threaded-flange footprints:

| Ref | Phoenix part | Library footprint, in `Connector_Phoenix_MC_HighVoltage` |
|---|---|---|
| J1 | 1836202, MC 1,5/4-G-5,08 | `PhoenixContact_MC_1,5_4-G-5.08_1x04_P5.08mm_Horizontal` |
| J2 | 1836189, MC 1,5/2-G-5,08 | `PhoenixContact_MC_1,5_2-G-5.08_1x02_P5.08mm_Horizontal` |

G and GF electrical pad geometries match: local pad 1 at (0,0), successive pads at 5.08 mm intervals, 1.8 × 3.6 mm pads and 1.2 mm drills. Preserving placement and rotation preserves pad locations. Their bodies and courtyards differ. Manufacturer drawings specify 2.54 mm end margins and 8 mm forward projection from the pad row. These passive connector drawings do not prescribe signal functions; retain the board's pin-1 mark and verify harness polarity before connection. Nominal rating is 8 A, with ambient-temperature derating. [J1 manufacturer drawing](https://www.phoenixcontact.com/us/products/1836202/pdf), [J2 manufacturer specification](https://www.phoenixcontact.com/en-ca/products/pcb-header-mc-15-2-g-508-1836189)

## J3 Pi interface — 2 × 5, 2.54 mm

Viewed from the component/mating side, orient the header by its actual pin-1 marker. The logical arrangement is:

```text
  1   2
  3   4
  5   6
  7   8
  9  10
```

| J3 pin | Signal and board connection | Pi BCM GPIO | Pi physical pin |
|---|---|---|---|
| 1 | GND | — | 6 |
| 2 | IGN_STATE, active LOW when ignition is on | 17 | 11 |
| 3 | HALT_DETECT / ISP SCK, through R7 to U1.7 | 26 | 37 |
| 4 | SHDN_REQ, reserved, through R8 to TP1 | 27 | 13 |
| 5 | FAN_PWM input, through R4 to Q3 gate | 18 | 12 |
| 6 | TACH output, through R9 from FAN1.3 | 23 | 16 |
| 7 | ISP MOSI, through R17 to U1.5 / COIL_DRV | 5 | 29 |
| 8 | ISP MISO, through R18 from U1.6 / LED3_DRV | 6 | 31 |
| 9 | ISP RESET, through R19 to U1.1 / nRESET | 13 | 33 |
| 10 | GND | — | 34 |

All signals are 3.3 V. GPIO5, GPIO6 and GPIO13 remain inputs/high-impedance in normal operation. The programming operation must have exclusive control of GPIO26: deactivate/unbind any conflicting `gpio-poweroff` ownership before using it as SCK. These GPIO choices avoid the CAN adapter's SPI0 signals.

**Pi ISP electrical margin remains unverified.** The specified R17=1 kΩ feeds MOSI into a node also loaded by R3=1 kΩ and Q2's base-emitter junction. While U1 is held in reset, a simple DC estimate gives MOSI ≈(3.3 V + 0.7 V)/2 = 2.0 V. The ATtiny85 guaranteed HIGH threshold is 0.6×VCC, or 1.98 V at nominal 3.3 V; supply, GPIO-drive, resistor and transistor variations can remove that small margin. The reference's assertion that the shared loads cannot disturb programming is therefore not established. Bench-validate the complete Pi ISP path or revise the series resistance/driver isolation before relying on in-car flashing. Any resistor reduction also needs GPIO contention and current-limit validation; it is not automatically a qualified fix. J4 connects directly to the MCU node, avoiding R17's series drop, but its programmer still drives the Q2 base load. The Pi programming software/workflow and MCU firmware have not been implemented or tested by this PCB update. [ATtiny25/45/85 datasheet, 2586Q, p. 161](https://ww1.microchip.com/downloads/en/DeviceDoc/Atmel-2586-AVR-8-bit-Microcontroller-ATtiny25-ATtiny45-ATtiny85_Datasheet.pdf)

## J4 external ISP — 2 × 3, 2.54 mm

Orient by the actual pin-1 marker, viewed from the component/mating side:

```text
  1   2       MISO   3V3
  3   4       SCK    MOSI
  5   6       RESET  GND
```

| J4 pin | Signal | Connection |
|---|---|---|
| 1 | MISO | U1 pin 6 / LED3_DRV |
| 2 | VCC sense | 3V3 |
| 3 | SCK | U1 pin 7 / HALT_IN |
| 4 | MOSI | U1 pin 5 / COIL_DRV |
| 5 | RESET | U1 pin 1 / nRESET |
| 6 | GND | GND |

Power the board normally from 12V_IN. Use a programmer with **3.3 V signal levels** and its **target-power output disabled**; J4.2 is target-voltage sense, not permission to inject a programmer supply. Check cable orientation and pin 1 before connection. Do not program the ATtiny85 RSTDISBL fuse.

## JP1 service bypass — Phoenix fixed terminal

JP1 is **Phoenix Contact MKDS 1/2-3,5, 1751248**, with project-local footprint `S660-PDB:Phoenix_MKDS_1_2_3.5_1751248`. Pin 1 is 12V_IN; pin 2 is 12V_SW. The footprint has 3.5 mm pitch, 1.1 mm drills and 2.4 mm pads. Manufacturer body dimensions are 7.5 × 7.3 × 8.5 mm above the board; no 3D model is assigned. Keep the project footprint library with the design. [Manufacturer specifications/drawing](https://www.farnell.com/datasheets/2322647.pdf)

A short insulated wire loop between the terminals keeps the Pi powered with K1 open or U1 held in reset. Insert/remove it with power disconnected. Remove it after programming: while fitted, it defeats timed shutdown and low-voltage cutoff. Leave room for the loop and screwdriver in the enclosure. The terminal is selected and implemented; load/temperature and 5 A fuse-clearing qualification still remain. See [component qualification record](C7-JP1-QUALIFICATION.md) for wire, torque, package acceptance and test details.

## Standby discrepancy and remaining acceptance work

SW1 now makes LED1 **push-to-test**: 12V_IN → SW1 normally-open contact → LED_TEST → R14 → LED1 → GND. Releasing SW1 disconnects this indicator branch. With a 2 V illustrative LED drop, pressing it draws about 4.55 mA at 12 V; that former continuous drain is removed while released. LED2 and LED3 retain their previous functions. Hold TEST when using LED1 for fault-finding.

The reference's **<100 µA parked current claim remains unsupported**. R1=68 kΩ / R2=15 kΩ alone draws about 145 µA at 12 V (about 0.104 Ah per 30 days), before MCU, regulator and leakage/backfeed paths. The divider is unchanged; reducing its current needs ADC settling/leakage analysis. Actual standby current must be measured both with the Pi harness connected and with the board alone.

### SW1 package acceptance

Selected service button: **Omron B3F-1000**, normally open, 6 mm body and 4.3 mm actuator height. Symbol `Switch:SW_Push`; footprint `Button_Switch_THT:SW_PUSH_6mm_H4.3mm`. Manufacturer top-view drawing and PCB mounting holes were compared with a disposable Konnect placement, pad readback and rendered inspection. Four physical leads implement two electrical contacts; repeated pad numbers are intentional, with no mechanical-only leads. Hole pitch is 6.5 × 4.5 mm, drill 1.1 mm.

| Manufacturer lead, top view | Footprint pad / symbol pin | Net |
|---|---|---|
| 4, upper left | 1 | LED_TEST |
| 3, upper right | 1 | LED_TEST |
| 2, lower left | 2 | 12V_IN |
| 1, lower right | 2 | 12V_IN |

Each horizontal pair is internally connected; pressing bridges the two rows. Contacts are nonpolar, so 180° rotation is equivalent; 90° does not match the hole pattern. The 1–50 mA, 3–24 V DC resistive-load rating covers the nominal indicator branch. This is an IP00 service switch rated −25 to +70°C, **not an automotive-qualified or sealed button**; confirm enclosure temperature and access before assembly. [Omron B3F datasheet, ratings p. 3 and B3F-1000 drawing p. 4](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf)

Before manufacturing/vehicle use: complete final PCB checks below; qualify C7 and JP1; confirm the purchased protection-diode packages/ratings and the reference's unresolved alternator load-dump assumption; validate the actual fan pinout; implement and bench-test the MCU shutdown/ADC3 firmware and Pi services. A passing ERC/DRC does not verify those system behaviors.

## Final PCB verification

All design edits were applied through Konnect. KiCad checked the saved live-board snapshot after zone refill. J3, J4, JP1 and R17–R19 are placed and routed. JP1 is at (94.5,42) mm, rotated 180°. Its input uses a 2.0 mm back-copper route from K1.13; its switched-output pad joins the existing 2.0 mm front-copper trunk. U2 is reoriented so its corrected OUT/GND/IN mapping preserves the existing power-rail positions. C4 is approximately 4.1 mm from U1 VCC; C5 is beside the regulator input. A front GND pour and an ISP ground stitch restore continuous ground connectivity alongside the new back-layer signal routes.

C6 and Z2 remain beside U1 pin 2 (BATT_SENSE); pin 7 is HALT_IN/SCK, not the ADC input. The user rearranged the routing and cosmetic layout after the original review. SW1 is now at (72.35,72.25) mm, with the TEST label and central branding preserved. The D2/D3 correction below preserves the 90 × 90 mm outline, mounting holes and other placements.
The rendered board was inspected. J4 has an explicit pin-1 mark and `ISP 3V3` label; JP1 is marked `BYPASS`. The board carries `S660-PDB REV D`.

Remaining PCB warnings:

- Six silkscreen-edge warnings: five concern J1/J2 library outlines at the board edges, and one concerns the Pi ground-pin text box.
- Five schematic/PCB BOM-exclusion differences concern H1–H4 and TP1.
- Two schematic/PCB field warnings concern the new D2/D3 Farnell order-code field. The schematic and BOM contain 4050109; Konnect's sync reports no pending changes but does not copy this custom field to the PCB.
- One silkscreen warning concerns the new JP1 reference text overlapping pad 1. Move the reference clear before production plotting; the available Konnect field tools could not reposition this instance text. The separate BYPASS label is clear.
- One field warning concerns JP1 MPN: schematic/BOM contain 1751248, but Konnect synchronization does not copy that custom field to the PCB.
- Two additional field warnings concern C7’s selection requirement and R20’s MPN. Both are recorded in the schematic; exact MPNs are exported in the BOM.
- There are no remaining footprint-library mismatches. No warnings were suppressed by this correction.

## D2/D3 purchased-part correction

D2 and D3 are **Multicomp Pro 1N5822, Farnell 4050109**, rated 40 V / 3 A in axial DO-27. The schematic now uses `Diode:1N5822` and the PCB uses project-local `S660-PDB:D_Multicomp_1N5822_DO27_P15.24mm`. Keep `fp-lib-table` and `S660-PDB.pretty` with the project. The former SS34/SMA assignment does not match these purchased parts.

Manufacturer dimensional evidence: [Multicomp Pro datasheet, 27/06/22 V1.0, p. 2](https://www.farnell.com/datasheets/3750001.pdf). The side-view drawing gives body length 8.9 ±0.3 mm, diameter 5.2 ±0.3 mm, and lead diameter 1.3 ±0.15 mm. The resulting maximum lead diameter is **1.45 mm**, larger than the standard KiCad DO-27 footprint's 1.2 mm drill. The custom footprint uses **1.7 mm finished holes, 3.2 mm pads and 15.24 mm lead spacing**, a maximum-body outline and 0.5 mm courtyard allowance. Its cathode end has a silkscreen band and square pad.

| Physical lead (side view) | Symbol pin / footprint pad | D2 net | D3 net |
|---|---|---|---|
| Banded cathode | 1 / 1 | IGN_12V | IGN_12V |
| Unbanded anode | 2 / 2 | ACC_IN | ON_IN |

The manufacturer assigns polarity rather than numeric lead identifiers. Two physical leads map to two symbol pins and two pads; no duplicate or mechanical-only terminals are present. Library geometry, scratch placement/rendering, and final live-board pad readback were checked. A scratch pad-query failed to bind the closed scratch board, so it was not counted as verification; final live-board readback verified both drills, pad positions and net assignments.

D2 is centered at (36,32) mm and D3 at (36,40) mm, both rotated 180°. Their banded ends face right toward IGN_12V. The input and cathode traces were rerouted at 0.5 mm width; old SMA trace ends were removed. ERC, saved/refilled-board DRC, netlist and rendered inspection confirm the intended polarity and connectivity. This custom footprint currently has no 3D model; a future enclosure-fit export must account for the diode bodies separately.

Evidence: [PCB DRC](review-revD/pcb-drc.json), [schematic ERC](review-revD/schematic-erc.json), [schematic netlist](review-revD/schematic.net), [schematic image](review-revD/schematic.png), [top-layer plot](review-revD/pcb-top.svg), and [52-part BOM](S660-PDB-revD-BOM.csv). No existing BOM or pinout workbook was found in the requested project; the exported BOM and connector tables above provide the updated data.

## C7/R20 layout update

C7 is at (43,71.5) mm, rotation 0°, with positive pad 1 left and negative pad 2 right. R20 is at (30,68) mm, rotation 0°, below U1 and left of U2. Both retain existing standard through-hole footprint styles. The capacitor's 5.5 mm maximum body diameter and resistor's 6.5 mm maximum length fit the available space. Reserve C7's maximum 12.5 mm body height plus stand-off; its generic 3D model is only 7 mm tall.

R20.1 joins the existing 3V3 front-layer routing. R20.2 reaches C7.1 on the back layer; C7.2 has a dedicated back-layer ground return to U2.2. New tracks are 0.5 mm wide. ERC, netlist pin membership, direct pad readback, rendered inspection, saved/refilled DRC and a no-op schematic sync verify the implemented branch. Existing Gerbers in the project root are stale and must not be ordered without fresh export/inspection.

## TO-92 annular-ring correction — 2026-09-18

U2, Q2 and Q3 now use `Package_TO_SOT_THT:TO-92_Inline_Wide` in both schematic assignments and PCB instances. All nine pads were read back from the live board: 1.50 mm copper size, 0.80 mm round drill, giving a 0.35 mm nominal minimum annular ring. The previous narrow footprint had 1.05 mm copper width and a 0.75 mm drill (0.15 mm ring). Adjacent holes are now 2.54 mm apart. Form the outer component leads gently to this spacing; do not force the package down against the board. Pin numbers and electrical functions are unchanged.

Final anchors in millimetres: U2 (42.25,66.30), rotation 0 degrees; Q2 (67.14,58.70), rotation 270 degrees; Q3 (65.21,98.20), rotation 0 degrees. C5 moved 0.30 mm right to (50.10,66.025). Associated U2 supply/ground, Q2 collector/base and Q3 drain traces were adjusted. C7 and R20 retain their previous final positions. Board size remains 90 by 90 mm.

Saved/refilled DRC: zero errors, zero unconnected items, 23 warnings. ERC: zero errors and warnings. Schematic-to-PCB dry run reports no pending changes. The warnings comprise six existing edge-silkscreen warnings, thirteen symbol/footprint metadata differences, three new TO-92 library-copy mismatches, and one C7 reference/U2 outline silkscreen overlap. Konnect refused library refresh before mutation because the stock footprint's Datasheet property contains an unsupported `unlocked` clause. It also has no exposed tool for moving an existing PCB reference field. These limitations remain unresolved: refresh only U2/Q2/Q3 through KiCad's native library-update dialog and reposition the C7 reference, then rerun DRC. Do not indiscriminately refresh unrelated symbols or footprints.

Evidence: [final DRC](review-revD/to92-drc.json), [ERC](review-revD/to92-erc.json), [top-layout PDF](review-revD/to92-layout.pdf), and refreshed BOM. The exported top layout was visually inspected. Existing Gerbers remain stale; regenerate and inspect fabrication outputs after final warning cleanup. This correction is not a new full-board qualification or manufacturing release.
