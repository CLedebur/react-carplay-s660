# s660-pdb-mitm rev B — fabrication package (JLCPCB)

Generated 2026-10-13 from `../../s660-pdb-mitm.kicad_pcb` (saved 20:54) with KiCad 10.0.6 /
Konnect. Board: 90 × 90 mm, 2 layers, 1.6 mm, 1 oz copper. Finish not specified (HASL is fine).

Rev B replaces rev A (never ordered): the car-harness connector J1 is now a Phoenix MC 1,5/7-G-5.08
pluggable header on the top edge instead of a JST XH mid-board, the 3.3 V regulator U102 and its
capacitors moved beside K1, the Pico is "do not populate" (the owner supplies it; the board gets
sockets), and the silkscreen carries wire-by-wire labels on the back.

## What to upload

| JLCPCB step | Files |
|---|---|
| PCB order | everything in `gerbers/` as one zip: F/B copper, F/B mask, F/B silkscreen, Edge.Cuts, `PTH.drl`, `NPTH.drl`, `job.gbrjob` |
| SMT assembly (economic, top side) | `BOM-s660-pdb-mitm-SMT.csv` + `CPL-s660-pdb-mitm-SMT.csv` (71 parts, 26 line items, every one with an LCSC number) |

Not for upload: `BOM-s660-pdb-mitm.csv` (full list, reference only), `BOM-s660-pdb-mitm-handfit.csv`
(parts you solder yourself), `CPL-s660-pdb-mitm.csv` (all 87 placed parts).

## Hand-fitted after delivery (not in the SMT files)

Two 1×20 2.54 mm single-row **female** headers in U1's pad rows (the Pico 2 W plugs into them;
the Pico itself is DNP), **K1 Omron G6K-2F-Y DC5 signal relay** (SMD, but JLCPCB lists it as
"Standard Only" assembly, so it is left out of the economic SMT files and hand-soldered; buy it
from DigiKey/Mouser or LCSC C2982926), K101 G2RL-1A relay, J101/J102 Phoenix MC terminals, J1 Phoenix
MC 1,5/7-G-5.08 header (order its MC 1,5/7-ST-5.08 plug for the harness pigtail, and use
ferrules on the 16–18 AWG wires), JP101 MKDS terminal, J2 JST XH, J103 2×5 header, FAN101–103
headers. J104 (ISP header) is DNP: pads only.

## Checks this package passed

- KiCad DRC: 0 errors, 0 warnings, 0 unconnected, 0 schematic-parity mismatches, with the Power12V
  (0.3 mm clearance, 2.0 mm track) and Supply net classes in force.
- ERC: one error waived: the Pico library symbol marks pins 3 (GND) and 33 (AGND) both as power
  outputs on the same GND net.
- Schematic-to-board netlist: all 262 pads on the same nets in both.
- Drill files vs board: 186 PTH = 90 through-hole pads + 96 vias; 4 NPTH = the four 3.2 mm M3 holes.
- Every GND pad/via/pour is one net; no via lands on or within 0.15 mm of an SMD pad.

## Still to do on the JLCPCB site (cannot be automated)

1. **Component Placements preview.** KiCad's rotation convention differs from JLCPCB's for several
   packages (SOT-23, SOIC, SOT-223, polarised caps/diodes). Check every part's orientation in the
   preview and rotate as needed. Pay particular attention to U101, U102, U103, K1, C103, C107,
   D101–D104, D1–D8, Z102 and the LEDs.
2. Confirm the order quantity and that "economic" assembly accepts all 27 line items (extended
   parts incur a per-type fee).
