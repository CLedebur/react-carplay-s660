# OPERA MITM — wiring checklist (26 × 31 board)

Coordinates are column letter + row number, as printed on `main-board.svg`. Tick each wire after
soldering **both** ends and tug-testing it. Wire numbers match the tags on the drawing.

## Bus wires (bare, solder side)

- [ ] GND bus: bare wire along row **13**, A13 → Z13, soldered at every pad that a GND wire or lead lands on
- [ ] VBUS bus: bare wire along row **21**, A21 → Z21, soldered at C21, D21, J21, L21, O21, V21

## GND wires

- [ ] **7** · `N3` → `N13` — GND terminal → GND bus
- [ ] **8** · `R3` → `R13` — Pi GND terminal → GND bus
- [ ] **10** · `G9` → `G13` — Q5 source → GND bus
- [ ] **11** · `Q5` → `Q13` — Q1 source → GND bus
- [ ] **12** · `V5` → `W13` — Q2 source → GND bus
- [ ] **13** · `Q11` → `P13` — Q3 source → GND bus
- [ ] **14** · `V11` → `V13` — Q4 source → GND bus
- [ ] **15** · `Z10` → `Z13` — Q4 gate pull-down → GND bus
- [ ] **23** · `F23` → `E13` — Pico pin 3 GND → GND bus
- [ ] **24** · `F30` → `O13` — Pico pin 38 GND → GND bus

## VBUS wires

- [ ] **21** · `C15` → `C21` — K1 coil → VBUS bus
- [ ] **22** · `O15` → `O21` — K2 coil → VBUS bus
- [ ] **25** · `D30` → `D21` — Pico pin 40 VBUS → VBUS bus

## 3V3 wire

- [ ] **26** · `I12` → `H30` — buffer pull-up → Pico pin 36 3V3

## Car-side wires (terminal → relay pads)

- [ ] **1** · `A3` → `G15` — TXp → K1 NC-A
- [ ] **2** · `A4` → `E18` — TXp → K1 COM-B
- [ ] **3** · `D3` → `E15` — TXh → K1 COM-A
- [ ] **4** · `G3` → `S15` — PWp → K2 NC-A
- [ ] **5** · `G4` → `Q18` — PWp → K2 COM-B
- [ ] **6** · `J3` → `Q15` — PWh → K2 COM-A

## Signal wires

- [ ] **9** · `P3` → `X11` — RUN terminal → Q4 drain
- [ ] **16** · `S5` → `I15` — Q1 drain → K1 NO-A
- [ ] **17** · `X5` → `U15` — Q2 drain → K2 NO-A
- [ ] **18** · `S11` → `O18` — Q3 drain → relay coil drive
- [ ] **19** · `C18` → `O18` — K1 coil drive = K2 coil drive
- [ ] **20** · `C18` → `L19` — coil drive → D1 anode
- [ ] **27** · `J9` → `G23` — buffer out → Pico pin 4 GP2
- [ ] **28** · `W9` → `H23` — Pico pin 5 GP3 → Q2 gate resistor
- [ ] **29** · `R9` → `I23` — Pico pin 6 GP4 → Q1 gate resistor
- [ ] **30** · `C8` → `J23` — TX junction → Pico pin 7 GP5
- [ ] **31** · `O12` → `L23` — Pico pin 9 GP6 → Q3 gate resistor
- [ ] **32** · `Z12` → `M23` — Pico pin 10 GP7 → Q4 gate resistor
- [ ] **33** · `E8` → `T23` — RX junction → Pico pin 17 GP13
- [ ] **34** · `N8` → `M30` — CONT junction → Pico pin 31 GP26

## Temporary links (purple) — remove when the relays are fitted

- [ ] **35** · `E15` → `I15` — TEMP: K1 COM-A → NO-A (remove when the relay is fitted)
- [ ] **36** · `E18` → `I18` — TEMP: K1 COM-B → NO-B (remove when the relay is fitted)
- [ ] **37** · `Q15` → `U15` — TEMP: K2 COM-A → NO-A (remove when the relay is fitted)
- [ ] **38** · `Q18` → `U18` — TEMP: K2 COM-B → NO-B (remove when the relay is fitted)

## Solder bridges (flow solder across two neighbouring pads)

- [ ] `B2`–`B3`
- [ ] `B7`–`B8`
- [ ] `B8`–`C8`
- [ ] `B12`–`B13`
- [ ] `F2`–`F3`
- [ ] `F7`–`F8`
- [ ] `F8`–`E8`
- [ ] `F12`–`F13`
- [ ] `H2`–`H3`
- [ ] `H8`–`H9`
- [ ] `I9`–`I10`
- [ ] `I9`–`J9`
- [ ] `L2`–`L3`
- [ ] `L7`–`L8`
- [ ] `L8`–`M8`
- [ ] `L12`–`M12`
- [ ] `M8`–`N8`
- [ ] `L12`–`L13`
- [ ] `R5`–`R6`
- [ ] `W5`–`W6`
- [ ] `R11`–`R12`
- [ ] `W11`–`W12`
- [ ] `W11`–`W10`
- [ ] `B15`–`C15`
- [ ] `N15`–`O15`
- [ ] `B18`–`C18`
- [ ] `N18`–`O18`
- [ ] `I18`–`J18`
- [ ] `J18`–`J19`
- [ ] `U18`–`V18`
- [ ] `V18`–`V19`
- [ ] `B3`–`A3`
- [ ] `A3`–`A4`
- [ ] `D2`–`D3`
- [ ] `H3`–`G3`
- [ ] `G3`–`G4`
- [ ] `J2`–`J3`
- [ ] `N2`–`N3`
- [ ] `R2`–`R3`
- [ ] `P2`–`P3`

## Off-board wires

- [ ] Harness pin 1, **panel-side** wire → terminal **TXp** (B2)
- [ ] Harness pin 1, **head-unit-side** wire → terminal **TXh** (D2)
- [ ] Harness pin 2 (both wires still joined) → terminal **RX** (F2)
- [ ] Harness pin 3, **panel-side** wire → terminal **PWp** (H2)
- [ ] Harness pin 3, **head-unit-side** wire → terminal **PWh** (J2)
- [ ] Harness pin 12 (both wires joined) → terminal **CONT** (L2)
- [ ] Harness pin 9 → terminal **GND** (N2)
- [ ] TOFU **J1 pin 3 (RUN_PG)** → terminal **RUN** (P2) — optional until the headers are in
- [ ] TOFU **J1 pin 2 (GND)** → terminal **GND** (R2) — optional, goes with RUN
- [ ] Pico USB → TOFU USB

