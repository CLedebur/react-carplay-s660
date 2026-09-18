# S660-PDB — Power Distribution Board: Design Reference

**Project:** S660 CarPlay head unit (Raspberry Pi CM4 on Oratek TOFU carrier)
**Board:** S660-PDB, rev D specification (rev C + in-circuit programming provisions)
**Source of truth:** `S660-PDB.kicad_sch` (KiCad 10, currently **rev C**). Every rev C pin connection in this document was extracted from that file. Items marked **★** are **rev D additions** agreed on 2026-09-18 and are **not yet in the KiCad files**. They apply to **both** the through-hole board and the SMT board.
**Document date:** 2026-09-18

> **Writing style:** short sentences, one fact at a time. This matches `BUILD_NOTES.md`.

> **Scope note:** Two physical versions of this board exist: the **through-hole** board (rev C files, being breadboarded first) and an **SMT redesign** (longer, narrower, mounted upside-down under the TOFU, in progress). Both use the same circuit and the same nets. Only packages and layout differ. **All ★ rev D changes must be applied to both.** Where a part or connector differs between versions, this document says so.

---

## 1. What the board does

The S660 has no "accessory delay" for aftermarket electronics. If you power the CM4 straight from the car, one of two bad things happens:

- Powered from a **switched** wire (ACC or ON): the CM4 loses power the instant the key turns off. The operating system cannot shut down cleanly. The filesystem can be corrupted.
- Powered from the **always-on** wire (CONSTANT): the CM4 runs forever and drains the car battery while parked.

The S660-PDB sits between the car and the TOFU. It solves both problems. It does six jobs:

| # | Job | How |
|---|---|---|
| 1 | **Protect** the TOFU from automotive electrical hazards | Fuse F1 and TVS diode D1 |
| 2 | **Switch** power on when the key turns to ACC or ON | Relay K1, driven by the ATtiny85 (U1) |
| 3 | **Hold** power on for a grace window after the key turns off | U1 keeps K1 closed for up to 5 min 15 s |
| 4 | **Coordinate** a clean OS shutdown with the Pi | Opto U3 tells the Pi the ignition state. The Pi tells U1 when it has halted. |
| 5 | **Cut** power completely after shutdown, so the parked car draws almost nothing | K1 opens. Standby draw is under 100 µA. |
| 6 | **Control the fans** from the Pi | Q3 converts a Pi PWM signal to the PC-fan standard |
| 7 ★ | **Be reprogrammable in place** | ISP header J4, ISP lines to the Pi via J3, and relay-bypass jumper JP1 (§9) |

It also shows its state on three LEDs, and it protects the car battery with a low-voltage cutoff.

### 1.1 What the board does NOT do

- It does **not** convert voltage. Car voltage (nominally 12 V, real range ~9–14.7 V) passes straight through to the TOFU. The TOFU accepts 7.5–28 V and makes its own 5 V.
- It does **not** contain a battery or supercapacitor. There is no backup power.
- It does **not** power the fans from 5 V. The fans run on the switched 12 V rail.

---

## 2. How to read this document

- A **net** is one electrical point. Every pin listed under a net is soldered together, electrically. Order does not matter. (On a breadboard: every one of those legs goes into the same connected row or rail.)
- A pin marked **"(nothing else)"** connects to exactly one other pin. It is a simple two-ended wire.
- **Diodes:** the band marks the **cathode (K)**. The other end is the **anode (A)**.
- **Electrolytic capacitors:** the stripe marks the **negative** leg.
- **LEDs:** the flat spot on the rim marks the **cathode** (ground side).
- **IGN_STATE is active-LOW.** When the ignition is ON, this line is pulled LOW. Software must read it that way.
- **Relay K1 pin names** in the schematic are KiCad names (A1, A2, 13, 14). Section 8 maps them to the physical Omron pins.
- **★** marks a rev D addition. It is part of the design for both boards but is not yet drawn in `S660-PDB.kicad_sch`.

---

## 3. Signal and power flow

```
CAR                                   S660-PDB                                    TOFU / CM4
──────                    ─────────────────────────────────────────              ────────────
CONSTANT ─[F1 5A]──► 12V_IN ─► D1 (TVS, shunt to GND)
                        │
                        ├──► K1 pin 13 (COM) ──► K1 pin 14 (NO) ──► 12V_SW ──► J2 ──► TOFU terminal block
                        │                                              │
                        │                                              ├──► C3 470µF (bulk)
                        │                                              ├──► FAN1/2/3 pin 2 (+12V)
                        │                                              └──► LED2 (via R15)
                        │
                        ├──► K1 pin A1 (coil, +12V side)
                        ├──► U2 LM2936 VI ──► 3V3 ──► U1 ATtiny85 VCC
                        ├──► R1 (divider top) ──► BATT_SENSE ──► U1 pin 2 (ADC3) ★ (pin 7 in rev C)
                        └──► LED1 (via R14)

ACC ─[F2 2A]──► D2 ─┐
                    ├──► IGN_12V ──► R6 ──► U3 opto LED ──► U3 output = IGN_STATE ──► J3 pin 2 ──► Pi GPIO17
ON  ─[F3 2A]──► D3 ─┘                                                            └──► R13 ──► U1 pin 3

U1 pin 5 ──► R3 ──► Q2 base; Q2 collector ──► COIL_LOW ──► K1 pin A2 (coil, driven side)
Pi GPIO26 ──► J3 pin 3 ──► R7 ──► U1 pin 2 (HALT_DETECT)
Pi GPIO18 ──► J3 pin 5 ──► R4 ──► Q3 gate; Q3 drain ──► FAN_PWM_BUS ──► FAN1/2/3 pin 4
FAN1 pin 3 (TACH) ──► R9 ──► J3 pin 6 ──► Pi GPIO23

★ Programming (rev D):
Pi GPIO5  ──► J3 pin 7 ──► R17 ──► U1 pin 5 (MOSI)     ┐
Pi GPIO6  ──► J3 pin 8 ──► R18 ──► U1 pin 6 (MISO)     ├─ same four nodes also on J4 (2×3 standard ISP header, + 3V3 and GND)
Pi GPIO26 ──► J3 pin 3 ──► R7  ──► U1 pin 7 (SCK = HALT_IN line, reused) │
Pi GPIO13 ──► J3 pin 9 ──► R19 ──► U1 pin 1 (RESET)    ┘
JP1 (2-pin jumper) across K1 pin 13 ── pin 14: forces 12V_SW on for programming / recovery
```

---

## 4. Operating sequence

### 4.1 Normal drive cycle

1. Driver turns key to ACC or ON.
2. ACC or ON wire goes to ~12 V. D2 or D3 passes it to the IGN_12V node.
3. IGN_12V lights the LED inside U3. U3's output transistor turns on. **IGN_STATE goes LOW.**
4. U1 reads IGN_STATE LOW on pin 3. U1 drives pin 5 HIGH. Q2 turns on. Current flows from 12V_IN through the K1 coil to ground. **K1 closes.**
5. 12V_SW goes live. J2 feeds the TOFU. The CM4 boots. The fans get power.
6. The Pi also reads IGN_STATE LOW on GPIO17. It knows the ignition is on.
7. Driver turns key OFF. ACC and ON drop. IGN_12V drops. U3 turns off. **IGN_STATE goes HIGH.**
8. **Nothing powers off.** U1 keeps K1 closed. Two timers start in parallel:
   - **Pi (software):** counts down **4 min 30 s**. If IGN_STATE goes LOW again, cancel.
   - **U1 (hardware):** counts down **5 min 15 s**. If IGN_STATE goes LOW again, cancel.
9. **Case A — driver returns within 4:30** (fuel stop): IGN_STATE goes LOW. Both timers cancel. The CM4 never stopped. No reboot.
10. **Case B — driver does not return:** at 4:30 the Pi runs `shutdown -h now`. When the kernel finishes halting, the Pi asserts GPIO26 (via the `gpio-poweroff` overlay). This is **HALT_DETECT**. U1 sees it on pin 7 (★ rev D; pin 2 in rev C — see §9.1).
11. U1 waits **10 s** after HALT_DETECT, then drives pin 5 LOW. Q2 turns off. **K1 opens.** 12V_SW is dead. Standby draw is under 100 µA.
12. If HALT_DETECT never arrives (OS hang), U1 opens K1 at **5:15** regardless. The grace window is the backstop.

### 4.2 Why ACC and ON are both required

On this S660, **ACC is interrupted during cranking.** If the board only watched ACC, every engine start would look like "ignition gone" and would trigger step 8. ON stays live during cranking on this car. D2 and D3 form a diode-OR: either wire keeps IGN_12V high. Do not remove D3 or the ON input.

### 4.3 U1 state machine

| State | Condition | U1 action |
|---|---|---|
| SLEEP | IGN_STATE HIGH, K1 open | Sleep. Wake on pin-change interrupt from pin 3. |
| RUN | IGN_STATE LOW | Hold pin 5 HIGH (K1 closed). Blink LED3. |
| GRACE | IGN_STATE went HIGH | Keep pin 5 HIGH. Start 5:15 timer. |
| GRACE → RUN | IGN_STATE LOW again | Cancel timer. Back to RUN. |
| GRACE → CUT | Any of: 5:15 elapsed; HALT_DETECT HIGH for 10 s; BATT_SENSE below 11.0 V for 10 s | Drive pin 5 LOW. K1 opens. Go to SLEEP. |

**Firmware status:** the ATtiny85 firmware is **not yet written.** This table is the specification for it.

---

## 5. Net directory

Every net on the board, what it is, and every pin on it. This is the complete connectivity of the board.

### 5.1 Power nets

**12V_IN** — the protected always-on rail. Car battery voltage after fuse F1. Live whenever the battery is connected. D1 clamps it.
- J1 pin 1 (CONSTANT in)
- JP1 pin 1 ★ (relay-bypass jumper)
- D1 pin 2 (A2 — cathode/band side for a unidirectional part)
- K1 pin 13 (COM contact)
- K1 pin A1 (coil, +12 V side)
- D4 pin 1 (K, band)
- U2 pin 1 (VI)
- C5 pin 1
- R1 pin 1
- R14 pin 1

**12V_SW** — the switched rail. Exists only while K1 is closed. Everything downstream lives here.
- K1 pin 14 (NO contact)
- JP1 pin 2 ★ (relay-bypass jumper)
- C3 pin 1 (+)
- J2 pin 1 (to TOFU)
- FAN1 pin 2
- FAN2 pin 2
- FAN3 pin 2
- R15 pin 1

**3V3** — the ATtiny85 supply, made by U2. Always on, like 12V_IN.
- U2 pin 3 (VO)
- J4 pin 2 ★ (VCC sense for the programmer — sense only, never supply)
- U1 pin 8 (VCC)
- C4 pin 1
- C7 pin 1 (+)
- R11 pin 1
- R12 pin 1

**GND** — common return. On the PCB this is the solid bottom-layer copper pour.
- J1 pin 4, J2 pin 2, J3 pin 1, J3 pin 10 ★, J4 pin 6 ★
- D1 pin 1 (A1)
- C3 pin 2 (−), C4 pin 2, C5 pin 2, C6 pin 2, C7 pin 2 (−)
- R2 pin 2, R5 pin 2
- Z2 pin 2 (A)
- U1 pin 4, U2 pin 2, U3 pin 2, U3 pin 3
- Q2 pin 3 (E), Q3 pin 1 (S)
- LED1 pin 1 (K), LED2 pin 1 (K), LED3 pin 1 (K)
- FAN1 pin 1, FAN2 pin 1, FAN3 pin 1

### 5.2 Ignition-sense nets

**ACC_IN** — the fused ACC wire from the car.
- J1 pin 2
- D2 pin 2 (A)

**ON_IN** — the fused ON wire from the car.
- J1 pin 3
- D3 pin 2 (A)

**IGN_12V** — the merged "ignition is on" node, still at 12 V. Output of the diode-OR.
- D2 pin 1 (K)
- D3 pin 1 (K)
- R6 pin 1

**U3_ANODE** — R6 to the opto LED. (nothing else)
- R6 pin 2
- U3 pin 1 (LED anode)

**IGN_STATE** — the clean 3.3 V logic version of "ignition is on". **Active-LOW.** Shared by the Pi and U1.
- U3 pin 4 (collector)
- R12 pin 2 (pull-up to 3V3)
- R13 pin 1
- J3 pin 2 (to Pi GPIO17)

**IGN_MCU** — IGN_STATE, through R13, into U1. (nothing else)
- R13 pin 2
- U1 pin 3 (PB4)

### 5.3 Battery-sense net

**BATT_SENSE** — midpoint of the R1/R2 divider. Battery voltage scaled for the ADC. Z2 clamps it. C6 smooths it.
- R1 pin 2
- R2 pin 1
- Z2 pin 1 (K, band)
- C6 pin 1
- U1 pin **2** (PB3 / **ADC3**) ★ — was pin 7 (PB2/ADC1) in rev C. Moved so the ISP clock pin carries no capacitor.

### 5.4 Relay-drive nets

**COIL_DRV** — U1's relay command. Also the ISP **MOSI** line ★.
- U1 pin 5 (PB0 / MOSI)
- R3 pin 1
- R17 pin 2 ★ (from Pi via J3 pin 7)
- J4 pin 4 ★ (MOSI)

**Q2_BASE** — R3 to Q2. (nothing else)
- R3 pin 2
- Q2 pin 2 (B)

**COIL_LOW** — the driven end of the relay coil.
- K1 pin A2 (coil, driven side)
- Q2 pin 1 (C)
- D4 pin 2 (A)

### 5.5 Pi-interface nets

**J3_HALT** — HALT_DETECT from the Pi, before R7. (nothing else)
- J3 pin 3
- R7 pin 1

**HALT_IN** — HALT_DETECT into U1. Also the ISP **SCK** line ★ (the Pi reuses GPIO26 as SCK during programming).
- R7 pin 2
- U1 pin **7** (PB2 / SCK) ★ — was pin 2 (PB3) in rev C
- J4 pin 3 ★ (SCK)

**J3_SHDN** — reserved SHDN_REQ line from the Pi. (nothing else)
- J3 pin 4
- R8 pin 1

**SHDN_TP** — reserved. Ends at a spare pad. Not used by firmware. (nothing else)
- R8 pin 2
- TP1 pin 1

**nRESET** — ATtiny reset, pulled up. Also the ISP **RESET** line ★.
- R11 pin 2
- U1 pin 1 (RESET / PB5)
- R19 pin 2 ★ (from Pi via J3 pin 9)
- J4 pin 5 ★ (RESET)

**J3_MOSI** ★ — Pi MOSI, before R17. (nothing else)
- J3 pin 7
- R17 pin 1

**J3_MISO** ★ — Pi MISO, before R18. (nothing else)
- J3 pin 8
- R18 pin 1

**J3_RST** ★ — Pi RESET, before R19. (nothing else)
- J3 pin 9
- R19 pin 1

### 5.6 Fan nets

**FAN_PWM_PI** — the Pi's PWM output, before R4. (nothing else)
- J3 pin 5
- R4 pin 1

**Q3_GATE** — Q3 gate node.
- R4 pin 2
- R5 pin 1
- Q3 pin 2 (G)

**FAN_PWM_BUS** — the shared open-drain PWM line all fans listen to.
- Q3 pin 3 (D)
- FAN1 pin 4
- FAN2 pin 4
- FAN3 pin 4

**FAN1_TACH** — heatsink-fan tachometer, before R9. (nothing else)
- FAN1 pin 3
- R9 pin 1

**TACH** — tachometer to the Pi. (nothing else)
- R9 pin 2
- J3 pin 6

### 5.7 LED nets

**LED3_DRV** — U1's heartbeat output. Also the ISP **MISO** line ★.
- U1 pin 6 (PB1 / MISO)
- R16 pin 1
- R18 pin 2 ★ (to Pi via J3 pin 8)
- J4 pin 1 ★ (MISO)

**LED1_A, LED2_A, LED3_A** — each LED's anode, fed by its resistor. These three are direct wires with no label. KiCad auto-names them `Net-(LED1-A)` etc. They are correctly connected.
- R14 pin 2 ↔ LED1 pin 2 (A)
- R15 pin 2 ↔ LED2 pin 2 (A)
- R16 pin 2 ↔ LED3 pin 2 (A)

### 5.8 No connection (intentional)

- FAN2 pin 3 — TACH not used on case fans
- FAN3 pin 3 — TACH not used on case fans

---

## 6. Components — purpose and pin-by-pin connections

Grouped by board section. **Bold** in the "Purchased" column means the part bought differs from the schematic value. All substitutes are electrically equivalent for this circuit.

### Section A — Power path

| Ref | Schematic value | Purchased | Purpose |
|---|---|---|---|
| F1 | 5 A ATO blade fuse | 5 A ATO + add-a-circuit tap | Protects the CONSTANT wire run. **Off-board, at the car fuse box.** The TOFU has no input fuse. This is the only one. |
| F2 | 2 A ATO blade fuse | 2 A ATO + tap | Protects the ACC sense wire. Off-board. |
| F3 | 2 A ATO blade fuse | 2 A ATO + tap | Protects the ON sense wire. Off-board. |
| J1 | 4-pos terminal block, 5.08 mm | **Phoenix MC 1,5/4-G-5.08 (pluggable, right-angle)** | Power and sense input. Schematic footprint still shows the fixed MKDS block. The pluggable header has the same pin order. |
| D1 | 5KP18A TVS, 18 V, 5000 W | **1.5KE18A (1500 W)** — 5KP series unavailable | Load-dump clamp. Shunt part: sits across the rail to ground. Clamps spikes near 29 V. The TOFU has no TVS and its input capacitors are 35 V parts, so this is required. |
| K1 | Omron G2RL-1A DC12 | G2RL-1A DC12 | Main power switch. SPST-NO, 12 A contacts, 12 V coil (~33 mA). Open = zero draw downstream. |
| C3 | 470 µF 35 V low-ESR | Panasonic EEUFR1V471L (9000 h @ 105 °C) | Bulk storage on 12V_SW. Absorbs the inrush surge when K1 closes. |
| J2 | 2-pos terminal block, 5.08 mm | **Phoenix MC 1,5/2-G-5.08 (pluggable, right-angle)** | Output to the TOFU terminal block. |

**Pin connections:**

| Ref | Pin | Connects to |
|---|---|---|
| F1 | in | Car CONSTANT circuit (fuse box) |
| F1 | out | J1 pin 1 |
| F2 | in / out | Car ACC circuit / J1 pin 2 |
| F3 | in / out | Car ON circuit / J1 pin 3 |
| J1 | 1 | 12V_IN |
| J1 | 2 | ACC_IN → D2 anode (nothing else) |
| J1 | 3 | ON_IN → D3 anode (nothing else) |
| J1 | 4 | GND (chassis ground wire) |
| D1 | 2 (A2, **band**) | 12V_IN |
| D1 | 1 (A1) | GND |
| K1 | 13 (COM) | 12V_IN |
| K1 | 14 (NO) | 12V_SW |
| K1 | A1 (coil) | 12V_IN — D4 cathode also here |
| K1 | A2 (coil) | COIL_LOW — Q2 collector and D4 anode also here |
| C3 | 1 (+) | 12V_SW |
| C3 | 2 (−, stripe) | GND |
| J2 | 1 | 12V_SW → off-board wire → TOFU terminal block **+** |
| J2 | 2 | GND → off-board wire → TOFU terminal block **−** |

> **Open item:** confirm TOFU terminal block polarity on its silkscreen before the first power-up. The TOFU has reverse-polarity protection, but do not rely on it.

### Section B — Control logic

| Ref | Schematic value | Purchased | Purpose |
|---|---|---|---|
| D2 | SS34 Schottky, DO-41 axial | **1N5822 (DO-27)** — SS34 only in SMD | ACC half of the diode-OR. Blocks back-feed into the ACC circuit. |
| D3 | SS34 Schottky, DO-41 axial | **1N5822 (DO-27)** | ON half of the diode-OR. |
| U2 | LM2936Z-3.3, TO-92 | LM2936Z-3.3 | Always-on 3.3 V for U1. 15 µA quiescent. 40 V input rating (survives spikes D1 lets through). |
| C5 | 100 nF ceramic X7R | KEMET C412C104K5R5TA7200 (axial) | U2 input decoupling. |
| C7 | 10 µF 25 V | Panasonic ECA1EAK100X (85 °C) | U2 output stability. A 105 °C part is preferred for the car cabin. Not critical. |
| U1 | ATtiny85-20PU, DIP-8, socketed (through-hole) / ATtiny85-20SU SOIC-8 (SMT) | ATTINY85-20PU | The brain. Runs the state machine in §4.3. Internal watchdog enabled in firmware. ★ Programmable in place via J4 or the Pi (§9). |
| C4 | 100 nF ceramic X7R | KEMET (same as C5) | U1 decoupling. Place within a few mm of pins 4 and 8. |
| R11 | 10 kΩ | Yageo MFR-25 1 % | RESET pull-up. Prevents noise-triggered resets. |
| R1 | 68 kΩ | Yageo MFR-25 1 % | Battery divider, top. |
| R2 | 15 kΩ | Yageo MFR-25 1 % | Battery divider, bottom. Ratio 15/83 = 0.181. |
| Z2 | BZX55C3V6 zener, DO-35 | **1N5227B (3.6 V, 500 mW, DO-35)** | Clamps BATT_SENSE at 3.6 V. Protects U1 pin 7. |
| C6 | 100 nF ceramic X7R | KEMET (same as C5) | Smooths noise on BATT_SENSE. |
| R3 | 1 kΩ | Yageo MFR-25 1 % | Q2 base resistor. |
| Q2 | BC337-40 NPN, TO-92 | BC337-40 (Diotec) | Relay coil driver. Low-side switch. |
| D4 | 1N4007 | 1N4007 | Coil flyback clamp. Absorbs the coil's kickback when Q2 turns off. |

**Pin connections:**

| Ref | Pin | Connects to |
|---|---|---|
| D2 | 2 (A) | J1 pin 2 (ACC_IN) — nothing else |
| D2 | 1 (K, **band**) | IGN_12V (joins D3 cathode, R6 pin 1) |
| D3 | 2 (A) | J1 pin 3 (ON_IN) — nothing else |
| D3 | 1 (K, **band**) | IGN_12V |
| U2 | 1 (VI) | 12V_IN — C5 pin 1 here too |
| U2 | 2 (GND) | GND |
| U2 | 3 (VO) | 3V3 (joins U1 pin 8, C4, C7, R11, R12) |
| C5 | 1 / 2 | 12V_IN at U2 VI / GND |
| C7 | 1 (+) / 2 (−) | 3V3 at U2 VO / GND |
| U1 | 1 (RESET/PB5) | nRESET ← R11 pin 2; ★ also R19 pin 2 (Pi RESET) and J4 pin 5 |
| U1 | 2 (PB3 / ADC3) | ★ **BATT_SENSE** (R1, R2, Z2, C6). Rev C had HALT_IN here. |
| U1 | 3 (PB4) | IGN_MCU ← R13 pin 2 (nothing else) |
| U1 | 4 (GND) | GND — C4 pin 2 here |
| U1 | 5 (PB0 / MOSI) | COIL_DRV → R3 pin 1; ★ also R17 pin 2 (Pi MOSI) and J4 pin 4 |
| U1 | 6 (PB1 / MISO) | LED3_DRV → R16 pin 1; ★ also R18 pin 2 (Pi MISO) and J4 pin 1 |
| U1 | 7 (PB2 / SCK) | ★ **HALT_IN** ← R7 pin 2; also J4 pin 3 (SCK). Rev C had BATT_SENSE here. |
| U1 | 8 (VCC) | 3V3 — C4 pin 1 within a few mm |
| C4 | 1 / 2 | U1 pin 8 / U1 pin 4 |
| R11 | 1 / 2 | 3V3 / U1 pin 1 |
| R1 | 1 / 2 | 12V_IN / BATT_SENSE |
| R2 | 1 / 2 | BATT_SENSE / GND |
| Z2 | 1 (K, **band**) / 2 (A) | BATT_SENSE / GND |
| C6 | 1 / 2 | BATT_SENSE / GND |
| R3 | 1 / 2 | U1 pin 5 / Q2 base |
| Q2 | 2 (B) | R3 pin 2 (nothing else) |
| Q2 | 1 (C) | COIL_LOW = K1 pin A2 = D4 anode |
| Q2 | 3 (E) | GND |
| D4 | 1 (K, **band**) | K1 pin A1 (12V_IN side of coil) |
| D4 | 2 (A) | K1 pin A2 (Q2 side of coil) |

### Section C — Pi interface

| Ref | Schematic value | Purchased | Purpose |
|---|---|---|---|
| R6 | 2.2 kΩ | Yageo MFR-25 1 % | Opto LED current limit (~5 mA at 12 V). |
| U3 | PC817 opto-coupler, DIP-4 | **ISP817X** (PC817 equivalent) | Isolated ignition sense. Galvanic barrier between car 12 V and the 3.3 V logic. |
| R12 | 10 kΩ | Yageo MFR-25 1 % | IGN_STATE pull-up. Makes the clean 3.3 V logic level. |
| R13 | 1 kΩ | Yageo MFR-25 1 % | Series protection, IGN_STATE fork into U1. |
| R7 | 1 kΩ | Yageo MFR-25 1 % | Series protection on HALT_DETECT. |
| R8 | 1 kΩ | Yageo MFR-25 1 % | Series resistor on reserved SHDN_REQ. |
| TP1 | Test pad | — | Where SHDN_REQ terminates. U1 has no free pin for it. Reserved for future use. |
| R17 ★ | 1 kΩ | — | Series protection, Pi MOSI → U1 pin 5. |
| R18 ★ | 1 kΩ | — | Series protection, U1 pin 6 → Pi MISO. |
| R19 ★ | 1 kΩ | — | Series protection, Pi RESET → U1 pin 1. |
| J3 | ★ **10-pin, 2×5, 2.54 mm** (was JST-XH 6-pin) | Not yet bought. Right-angle for the inverted SMT board. | Link to the Pi GPIO header, now including the four ISP lines. |

**Pin connections:**

| Ref | Pin | Connects to |
|---|---|---|
| R6 | 1 / 2 | IGN_12V / U3 pin 1 |
| U3 | 1 (LED anode) | R6 pin 2 (nothing else) |
| U3 | 2 (LED cathode) | GND |
| U3 | 3 (emitter) | GND |
| U3 | 4 (collector) | IGN_STATE |
| R12 | 1 / 2 | 3V3 / IGN_STATE |
| R13 | 1 / 2 | IGN_STATE / U1 pin 3 |
| R7 | 1 / 2 | J3 pin 3 / U1 pin 2 |
| R8 | 1 / 2 | J3 pin 4 / TP1 |
| R17 ★ | 1 / 2 | J3 pin 7 / U1 pin 5 (COIL_DRV node) |
| R18 ★ | 1 / 2 | J3 pin 8 / U1 pin 6 (LED3_DRV node) |
| R19 ★ | 1 / 2 | J3 pin 9 / U1 pin 1 (nRESET node) |
| J3 | 1 | GND |
| J3 | 2 | IGN_STATE |
| J3 | 3 | R7 pin 1 (HALT_DETECT in; ★ doubles as ISP SCK) |
| J3 | 4 | R8 pin 1 (SHDN_REQ, reserved) |
| J3 | 5 | R4 pin 1 (FAN_PWM in) |
| J3 | 6 | R9 pin 2 (TACH out) |
| J3 | 7 ★ | R17 pin 1 (ISP MOSI in) |
| J3 | 8 ★ | R18 pin 1 (ISP MISO out) |
| J3 | 9 ★ | R19 pin 1 (ISP RESET in) |
| J3 | 10 ★ | GND |

**J3 to Raspberry Pi GPIO header:**

| J3 pin | Signal | Direction | Pi GPIO (BCM) | Pi physical pin | Note |
|---|---|---|---|---|---|
| 1 | GND | — | — | 6 | Any GND pin works |
| 2 | IGN_STATE | board → Pi | GPIO17 | 11 | **Active-LOW.** LOW = ignition on. Pi runs the 4:30 countdown from this. |
| 3 | HALT_DETECT / ★ ISP SCK | Pi → board | GPIO26 | 37 | `dtoverlay=gpio-poweroff` default pin. Goes HIGH when the kernel has halted. During programming the same GPIO bit-bangs SCK. |
| 4 | SHDN_REQ | (reserved) | GPIO27 | 13 | Not read by current firmware. |
| 5 | FAN_PWM | Pi → board | GPIO18 | 12 | Hardware PWM0. Must use this pin for clean PWM. |
| 6 | TACH | board → Pi | GPIO23 | 16 | Heatsink-fan RPM. Optional. |
| 7 ★ | ISP MOSI | Pi → board | GPIO5 | 29 | Input (high-Z) in normal operation. Output only while programming. |
| 8 ★ | ISP MISO | board → Pi | GPIO6 | 31 | Input in normal operation. |
| 9 ★ | ISP RESET | Pi → board | GPIO13 | 33 | Input (high-Z) in normal operation. Drives LOW only while programming. |
| 10 ★ | GND | — | — | 34 | Second ground, next to the ISP lines. |

> GPIO5, 6, 13 were chosen because the CAN adapter (MCP2515) uses the Pi's hardware SPI0 pins (GPIO7–11) and commonly GPIO25 for its interrupt. Do not use those for ISP.

All J3 signals are 3.3 V logic. U1 runs at 3.3 V. No level shifting is needed.

### Section D — Fan control

| Ref | Schematic value | Purchased | Purpose |
|---|---|---|---|
| R4 | 100 Ω | Yageo MFR-25 1 % | Q3 gate series resistor. |
| R5 | 10 kΩ | Yageo MFR-25 1 % | Q3 gate pull-down. **If the Pi is silent, Q3 stays off, the PWM line floats high, and the fans run at full speed.** Safe default. |
| Q3 | 2N7000 N-MOSFET, TO-92 | 2N7000 (Diotec) | Open-drain PWM driver. Converts the Pi's 3.3 V PWM to the PC-fan open-drain standard. |
| R9 | 1 kΩ | Yageo MFR-25 1 % | TACH series protection. |
| FAN1 | 4-pin PC fan header | Not yet bought. Planned right-angle. | Heatsink 3007 fan on the CM4. Only this fan reports TACH. |
| FAN2 | 4-pin PC fan header | Not yet bought. Planned right-angle. | Case fan. |
| FAN3 | 4-pin PC fan header | Not yet bought. Planned right-angle. | Case fan. |

**Pin connections (standard PC 4-pin fan pinout: 1 GND, 2 +12 V, 3 TACH, 4 PWM):**

| Ref | Pin | Connects to |
|---|---|---|
| R4 | 1 / 2 | J3 pin 5 / Q3 gate |
| R5 | 1 / 2 | Q3 gate / GND |
| Q3 | 2 (G) | R4 pin 2 and R5 pin 1 (one junction) |
| Q3 | 3 (D) | FAN_PWM_BUS |
| Q3 | 1 (S) | GND |
| R9 | 1 / 2 | FAN1 pin 3 / J3 pin 6 |
| FAN1 | 1 / 2 / 3 / 4 | GND / 12V_SW / R9 pin 1 / FAN_PWM_BUS |
| FAN2 | 1 / 2 / 3 / 4 | GND / 12V_SW / **not connected** / FAN_PWM_BUS |
| FAN3 | 1 / 2 / 3 / 4 | GND / 12V_SW / **not connected** / FAN_PWM_BUS |

One PWM signal drives all three fans. Any 4-pin PWM PC fan works.

### Section E — Indicators and mechanical

| Ref | Value | Purpose | Pin connections |
|---|---|---|---|
| LED1 + R14 (2.2 kΩ) | 3 mm LED | **Input power present.** Lit whenever the battery is connected. | R14 pin 1 → 12V_IN. R14 pin 2 → LED1 anode. LED1 cathode (flat) → GND. |
| LED2 + R15 (2.2 kΩ) | 3 mm LED | **Switched rail live.** Lit only while K1 is closed. | R15 pin 1 → 12V_SW. R15 pin 2 → LED2 anode. LED2 cathode → GND. |
| LED3 + R16 (1 kΩ) | 3 mm LED | **MCU heartbeat.** Firmware blinks it (~1 Hz). Solid or dark = fault. Means nothing until firmware exists. | R16 pin 1 → U1 pin 6. R16 pin 2 → LED3 anode. LED3 cathode → GND. |
| H1–H4 | M3 mounting holes | Mechanical only. Not in the electrical BOM. | No electrical connection. |

**Fault-finding with the LEDs:**

| LED1 | LED2 | LED3 | Meaning |
|---|---|---|---|
| off | — | — | No input power. Check F1, CONSTANT wiring, battery. |
| on | off (ignition on) | — | Relay path fault. Check K1 coil, Q2, U1 pin 5. |
| on | — | off / solid | U1 not running. Check U2 output (3.3 V), R11, U1 seating. |
| on | on | blinking | Board is healthy. Fault is downstream of J2. |

### Section F — Programming and service ★ (rev D, both boards)

| Ref | Value | Purpose | Pin connections |
|---|---|---|---|
| J4 ★ | 2×3 pin header, 2.54 mm, 6 pins, **standard AVR 6-way ISP pinout** | **ISP header** for an external AVR programmer. A standard USBasp 6-way cable plugs straight in. | Pin 1 → LED3_DRV node = U1 pin 6 (**MISO**). Pin 2 → **3V3** (**VCC**). Pin 3 → HALT_IN node = U1 pin 7 (**SCK**). Pin 4 → COIL_DRV node = U1 pin 5 (**MOSI**). Pin 5 → nRESET node = U1 pin 1 (**RESET**). Pin 6 → **GND**. |
| JP1 ★ | 2-pin header + shorting jumper, 2.54 mm | **Relay-bypass / service jumper.** Fitted: 12V_SW is live regardless of K1 and U1. Use for programming a blank chip and for recovery if firmware is broken. **Remove for normal operation** — fitted, it defeats the shutdown and the low-voltage cutoff and will drain the battery. | Pin 1 → 12V_IN (K1 pin 13 side). Pin 2 → 12V_SW (K1 pin 14 side). Trace width 2.0 mm, same as the power path. |

**J4 follows the standard Atmel/Microchip 6-pin ISP layout**, so any AVR programmer cable mates directly, with the correct orientation, and carries its own ground. **Pin 1 must be marked on the silkscreen** (a dot or a square pad) so the cable's key goes on the right way.

**J4 pinout, looking at the header, pin 1 marked:**

```
  ┌───┬───┐
  │ 1 │ 2 │   1 = MISO    2 = VCC (3V3)
  ├───┼───┤
  │ 3 │ 4 │   3 = SCK     4 = MOSI
  ├───┼───┤
  │ 5 │ 6 │   5 = RESET   6 = GND
  └───┴───┘
```

**About the VCC pin (J4 pin 2).** It is wired to the board's 3V3 rail. Its purpose is to let the programmer **sense** the target voltage. Do **not** let the programmer **supply** power through it:

- Power the board normally from 12V_IN, with **JP1 fitted**, so U1 is running from U2 at 3.3 V.
- Set the programmer's "target power" jumper to **OFF**. A USBasp that pushes 5 V into pin 2 would force the 3V3 rail to 5 V and drive U2's output above its input.
- Use a programmer whose signal lines are **3.3 V**, or a USBasp with a 3.3 V setting. 5 V signals into a chip running at 3.3 V exceed its ratings.

---

## 7. Off-board wiring

| Wire | From | To | Fuse | Gauge |
|---|---|---|---|---|
| CONSTANT | Car fuse box, always-on circuit | J1 pin 1 | F1, 5 A | 1 mm² (~18 AWG) |
| ACC | Car fuse box, ACC circuit | J1 pin 2 | F2, 2 A | 0.35 mm² (~22 AWG) |
| ON | Car fuse box, ON/IGN circuit | J1 pin 3 | F3, 2 A | 0.35 mm² |
| GND | Chassis ground point | J1 pin 4 | — | 1 mm² |
| 12 V out | J2 pin 1 | TOFU terminal block + | (F1 upstream) | 1 mm² |
| GND out | J2 pin 2 | TOFU terminal block − | — | 1 mm² |
| Pi link | J3 | Pi 40-pin header (table in §6 C) | — | ribbon / jumper |

Fuse taps: Littelfuse FHA200BP "Add-A-Circuit" or equivalent, ATO/ATC size.

---

## 8. Part-identification notes

### 8.1 Relay K1 — schematic names vs. physical pins

The KiCad symbol names the pins **A1, A2, 13, 14**. The physical Omron part numbers them **1, 5, 3, 4**. The KiCad footprint maps between them. When wiring the physical relay (breadboard or verifying a board):

| KiCad name | Function | Omron physical pin | Net |
|---|---|---|---|
| A1 | Coil | 1 | 12V_IN |
| A2 | Coil | 5 | COIL_LOW |
| 13 | Contact (COM) | 3 | 12V_IN |
| 14 | Contact (NO) | 4 | 12V_SW |

The coil has **no polarity**. The datasheet's pin diagram is a **bottom view**. Seen from the top, left and right are mirrored.

**Bench test to confirm any relay's pins:** measure ~360 Ω between two pins — that pair is the coil. Apply 9 V across them; the relay clicks. While held, exactly one other pin pair shows continuity — those are COM and NO. Release; continuity must disappear (normally open confirmed).

### 8.2 TO-92 leg order — verify on each datasheet

TO-92 leg order **differs between part types** in the same package. Do not assume. Hold the part flat face toward you, legs down, and read left to right:

| Part | Typical order (left → right) | Verify against |
|---|---|---|
| Q2 BC337 | E – B – C | Diotec BC337 datasheet |
| Q3 2N7000 | S – G – D | Diotec 2N7000 datasheet |
| U2 LM2936Z | VI – GND – VO (check!) | TI LM2936 datasheet, Z package drawing |

### 8.3 Orientation checklist (five ways to install a part backwards)

1. **D1, D2, D3, D4, Z2** — band = cathode. Direction given per part in §6.
2. **C3, C7** — stripe = negative leg.
3. **LED1–3** — flat spot = cathode = ground side.
4. **U1, U3** — notch/dot = pin 1. Check before inserting into the socket.
5. **U2, Q2, Q3** — see §8.2.

### 8.4 Package notes for the purchased parts

- The KEMET 100 nF caps are **axial** (leads out both ends). The rev C PCB footprint is **radial disc**. Fine on a breadboard. For a PCB, bend the leads or change the footprint.
- The 1N5822 (D2/D3) is **DO-27**, larger than the SS34's DO-41 footprint. Fine on a breadboard. Check fit on a PCB.
- The 1.5KE18A (D1) is **DO-201** axial. For the space-constrained SMT board, `Diode_THT:D_DO-201AE_P5.08mm_Vertical_KathodeUp` stands it upright. Band toward 12V_IN.

---

## 9. Programming the ATtiny85 ★ (rev D, both boards)

### 9.1 Why the pin swap

The ATtiny85 is programmed over four fixed pins: **MOSI = pin 5 (PB0)**, **MISO = pin 6 (PB1)**, **SCK = pin 7 (PB2)**, **RESET = pin 1 (PB5)**. Rev C put BATT_SENSE — with C6 (100 nF) and the R1/R2 divider — on pin 7. A 100 nF capacitor on the programming clock line makes in-circuit programming fail. Rev D swaps two pins:

| U1 pin | Rev C | Rev D ★ |
|---|---|---|
| 2 (PB3 / ADC3) | HALT_IN | **BATT_SENSE** — R1, R2, Z2, C6 move here |
| 7 (PB2 / ADC1 / SCK) | BATT_SENSE | **HALT_IN** — only R7 (1 kΩ) on this node |

PB3 is also an ADC input (channel **ADC3**). Firmware reads ADC3 instead of ADC1. Nothing else changes.

After the swap, the three shared ISP pins carry only light loads: R3 to Q2 (pin 5), R16 to LED3 (pin 6), R7 to J3 (pin 7). None disturb programming.

### 9.2 Three ways to program

| Method | Boards | Voltage | When |
|---|---|---|---|
| **A. Pull the chip** and program it in the USBasp / breadboard | Through-hole only (DIP socket) | Any | Firmware development. Simplest. |
| **B. Pi as programmer** over J3, `avrdude -c linuxgpio` | Both | 3.3 V — matches U1 exactly | In-car reflash over SSH. No case opening. **Preferred for the installed board.** |
| **C. External programmer on J4** | Both | Programmer signals must be **3.3 V**; programmer target-power **OFF** | Bench recovery. J4 is the standard 6-way ISP layout, so the cable plugs straight in. Most USBasp clones output 5 V logic; use one with a 3.3 V setting. See the VCC note in §6 F. |

### 9.3 The chicken-and-egg, and JP1

The Pi is powered by 12V_SW. 12V_SW exists only when K1 is closed. K1 closes only when U1 runs valid firmware. A blank U1 keeps K1 open, so the Pi can never boot to program it. And during any reflash, U1 is held in reset: pin 5 floats, Q2 turns off, K1 opens, and the Pi loses power mid-flash.

**JP1 fixes both.** Fit the jumper across K1's contacts before programming. 12V_SW is then live regardless of K1. Program. Remove the jumper. JP1 is also the recovery mode: if firmware is ever broken, jumper it and the head unit works as an always-on device until you fix it.

MOSI toggling pin 5 makes Q2 and K1 chatter for a few seconds during programming. With JP1 fitted this is harmless.

### 9.4 Pi programming — wiring and avrdude

| ISP signal | U1 pin | Board node | J3 pin | Series R | Pi GPIO (BCM) | Pi physical |
|---|---|---|---|---|---|---|
| MOSI | 5 | COIL_DRV | 7 | R17 1 kΩ | GPIO5 | 29 |
| MISO | 6 | LED3_DRV | 8 | R18 1 kΩ | GPIO6 | 31 |
| SCK | 7 | HALT_IN | 3 | R7 1 kΩ (existing) | GPIO26 | 37 |
| RESET | 1 | nRESET | 9 | R19 1 kΩ | GPIO13 | 33 |
| GND | 4 | GND | 1, 10 (also J4 pin 6) | — | GND | 6, 34 |

In normal operation the Pi must leave GPIO5, GPIO6 and GPIO13 as **inputs**. Only the programming script drives them.

`avrdude` programmer definition (add to `~/.avrduderc` on the Pi):

```
programmer
  id    = "pdb_isp";
  desc  = "S660-PDB via Pi GPIO";
  type  = "linuxgpio";
  reset = 13;
  sck   = 26;
  mosi  = 5;
  miso  = 6;
;
```

Flash:

```bash
# JP1 fitted. GPIO26 must not be driven by the gpio-poweroff overlay during this;
# either program from a system without that overlay active, or unbind it first.
sudo avrdude -c pdb_isp -p t85 -U flash:w:s660_pdb.hex:i
```

### 9.5 Fuse bits — two rules

1. **Never program the RSTDISBL fuse.** It turns RESET (pin 1) into a sixth I/O pin and permanently disables ISP. Only a high-voltage programmer can undo it. This design uses five I/O pins and does not need a sixth.
2. Set the clock fuses to the **8 MHz internal RC oscillator** (CKDIV8 off) and enable brown-out detection at 2.7 V. Do this on the breadboard first, where a mistake is cheap.

### 9.6 Changes this adds to the KiCad files (to do)

1. Swap U1 pin 2 ↔ pin 7 nets: BATT_SENSE to pin 2, HALT_IN to pin 7.
2. Add R17, R18, R19 (1 kΩ) from J3 pins 7, 8, 9 to U1 pins 5, 6, 1.
3. Replace J3 with a 10-pin 2×5 header; pins 1–6 unchanged, 7–10 as in §6 C.
4. Add J4, 2×3 header, standard AVR ISP pinout: 1 MISO (U1.6 node), 2 VCC (3V3), 3 SCK (U1.7 node), 4 MOSI (U1.5 node), 5 RESET (U1.1 node), 6 GND. Mark pin 1 on silkscreen.
5. Add JP1, 2-pin header, across K1 pins 13–14, on 2.0 mm traces.
6. Update the BOM and pin-out spreadsheets.

---

## 10. Design numbers

### 10.1 Power budget

| Item | Value |
|---|---|
| Design ceiling at the 12 V input | **30 W** (2.5 A at 12 V) |
| Realistic system draw at 12 V input | ~11–13 W typical, ~24 W worst case |
| True bottleneck | **TOFU's onboard 5 V rail: 3 A (15 W)**. All CM4/NVMe/dongle/CAN load is on that rail. Its output fuse is 3.5 A. |
| TOFU input range | 7.5–28 V |
| Cranking sag | Board drops ~0.15 V (relay contacts + wiring). TOFU still sees ~8.85 V at a 9 V crank. OK. |
| F1 rating | 5 A. Fuses should run at ≤ 75 % of rating; worst case at 9 V is ~3.3 A. |
| Power-path trace width | **2.0 mm** on 12V_IN and 12V_SW (IPC-2221, 1 oz Cu, 5 A fault current, 20 °C rise ≈ 1.8 mm minimum). All other nets: default width. |
| Standby draw when parked | < 100 µA (U2 15 µA + U1 asleep ~1 µA + leakage) |

### 10.2 Battery-sense divider (R1 68 k / R2 15 k)

Ratio = 15 / 83 = 0.181.

| Battery voltage | BATT_SENSE at U1 pin 7 |
|---|---|
| 9.0 V (cranking) | 1.63 V |
| 11.0 V (low-voltage cutoff threshold) | 1.99 V |
| 12.0 V (engine off) | 2.17 V |
| 14.4 V (alternator charging) | 2.60 V |
| 18.3 V | 3.30 V — ADC full scale |
| > ~19.9 V | Z2 conducts, clamps pin at 3.6 V |

### 10.3 Timing constants

| Event | Value | Where |
|---|---|---|
| Pi software shutdown countdown | 4 min 30 s | Pi `ignition-watch` service (to be written) |
| U1 hardware cutoff | 5 min 15 s | U1 firmware (to be written) |
| Cut after HALT_DETECT | 10 s | U1 firmware |
| Low-voltage cutoff | battery < 11.0 V for 10 s | U1 firmware |
| Gap between software and hardware cutoffs | 45 s | Safety margin for a slow unmount |

### 10.4 What the TOFU already provides (why the board is small)

The TOFU schematic (rev 1.3, sheet "PSU") shows:
- **Reverse-polarity protection, twice:** series Schottky (D7/D8, RB050LAM-30) and a P-FET ideal diode (Q1, DMP3013SFV-7). → The S660-PDB has **no** reverse-polarity parts.
- **Input filtering:** 7 × 10 µF ceramic on the 12 V rail. → The S660-PDB has **no** π filter.
- **5 V regulation:** AP64501 buck, 3 A. Output fuse 3.5 A NANO2.
- **Not present on the TOFU:** any input fuse, any TVS. → **F1 and D1 on the S660-PDB are required.**

---

## 11. ERC and KiCad notes

- **ERC "Input Power pin not driven"** on U2 VI and #PWR01: add a **PWR_FLAG** symbol on 12V_IN (at J1 pin 1) and one on GND. This tells ERC that power enters through a connector. Standard practice.
- **ERC "Symbol doesn't match copy in library"** on D_Zener, TestPoint, LED, Conn_01x04: harmless. These symbols were embedded from a known-good library copy. Ignore, or "Update Symbol from Library".
- **PCB net names `Net-(LED1-A)` etc.:** cosmetic. Those wires have no label. Add labels `LED1_A`, `LED2_A`, `LED3_A` in the schematic if you want clean names.
- **Symbol/footprint UUIDs** are deterministic (derived from the reference designator). Regenerating the schematic does not create duplicate footprints on PCB update.

---

## 12. Open items

| # | Item | Status |
|---|---|---|
| 1 | ATtiny85 firmware | **Not written.** §4.3 is the spec. Develop on the breadboard. Read the battery on **ADC3** (pin 2), not ADC1. |
| 2 | Pi `ignition-watch` systemd service (4:30 countdown) | Not written. |
| 3 | Pi `gpio-poweroff` overlay on GPIO26 | Not configured. |
| 4 | Pi fan-PWM daemon on GPIO18 | Not written. |
| 5 | TOFU terminal block polarity | Verify on silkscreen before first power-up. |
| 6 | 3007 heatsink fan pinout | Verify with a multimeter. Cheap fans do not always follow the standard colour code. |
| 7 | D1 substitution | 1.5KE18A (1500 W) fitted instead of 5KP18A (5000 W). Adequate if the S660 alternator is load-dump suppressed. Not yet confirmed. |
| 8 | C7 temperature rating | 85 °C part bought. 105 °C preferred. Low priority. |
| 9 | J1/J2 footprints in the schematic | Still show fixed MKDS blocks. Update to MC 1,5/x-G-5.08 pluggable headers. |
| 10 | SMT redesign | In progress. Same nets. New layout, inverted mount, right-angle J3 and fan headers. Must include all ★ rev D items. |
| 11 ★ | Rev D programming provisions in the KiCad files | **Not yet drawn.** See §9.6 for the exact list. Applies to both the through-hole and SMT files. |
| 12 ★ | Pi ISP GPIO reservation | GPIO5, 6, 13 must stay as inputs in normal operation. Confirm nothing else in the provisioning script claims them. |
| 13 ★ | J4 programmer power | Programmer target-power jumper must be OFF. Power the board from 12V_IN with JP1 fitted. Programmer signals must be 3.3 V. |

---

## 13. File index

| File | Content |
|---|---|
| `S660-PDB.kicad_sch` | The schematic, **rev C**. Authoritative for all non-★ connections in this document. ★ items pending. |
| `S660-PDB.kicad_pcb` | Rev C through-hole layout. 90 × 90 mm. DRC clean. ★ items pending. |
| `S660_PDB_BOM_and_Pinout.xlsx` | BOM, pin-by-pin connections, net junctions, Pi GPIO map, orientation checklist. |
| `S660-PDB_Farnell_Order_List.xlsx` | Prototype parts order (through-hole). |
| `BUILD_NOTES.md` | The wider CarPlay project: OS, boot, display, react-carplay, power-supply history. |
| `provision.sh` | OS provisioning script. |
