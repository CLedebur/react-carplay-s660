# s660-pdb-mitm rev A — fabrication package (JLCPCB)

Generated 2026-10-13 from `../../s660-pdb-mitm.kicad_pcb` (saved 16:54) with KiCad 10.0.6 /
Konnect. Board: 90 × 90 mm, 2 layers, 1.6 mm, 1 oz copper. Finish not specified (HASL is fine).

## What to upload

| JLCPCB step | Files |
|---|---|
| PCB order | everything in `gerbers/` as one zip: F/B copper, F/B mask, F/B silkscreen, Edge.Cuts, `PTH.drl`, `NPTH.drl`, `job.gbrjob` |
| SMT assembly (economic, top side) | `BOM-s660-pdb-mitm-SMT.csv` + `CPL-s660-pdb-mitm-SMT.csv` (72 parts, 27 line items, every one with an LCSC number) |

Not for upload: `BOM-s660-pdb-mitm.csv` (full list, reference only), `BOM-s660-pdb-mitm-handfit.csv`
(parts you solder yourself), `CPL-s660-pdb-mitm.csv` (all 88 placed parts).

## Hand-fitted after delivery (not in the SMT files)

U1 Raspberry Pi Pico 2 W (on two 1×20 female headers), K101 G2RL-1A relay, J101/J102 Phoenix MC
terminals, JP101 MKDS terminal, J1/J2 JST XH, J103 2×5 header, FAN101–103 headers.
J104 (ISP header) is DNP: pads only. Fit it by hand if the Pi-side programming route fails.

## Checks this package passed

- KiCad DRC: 0 errors, 0 unconnected, 0 schematic-parity mismatches, with the Power12V (0.3 mm
  clearance, 2.0 mm track) and Supply net classes in force. One cosmetic warning waived: KiCad's
  own Pico footprint carries an un-mirrored "Keep Out" text on the back layer.
- ERC: one error waived: the Pico library symbol marks pins 3 (GND) and 33 (AGND) both as power
  outputs on the same GND net.
- Drill files vs board: 173 PTH = 90 through-hole pads + 83 vias; 4 NPTH = the four 3.2 mm M3 holes.
- Every GND pad/via/pour is one net; no via lands on or within 0.15 mm of an SMD pad.

## Still to do on the JLCPCB site (cannot be automated)

1. **Component Placements preview.** KiCad's rotation convention differs from JLCPCB's for several
   packages (SOT-23, SOIC, SOT-223, polarised caps/diodes). Check every part's orientation in the
   preview and rotate as needed. Pay particular attention to U101, U102, U103, K1, C103, C107,
   D101–D104, D1–D8, Z102 and the LEDs.
2. Confirm the order quantity and that "economic" assembly accepts all 27 line items (extended
   parts incur a per-type fee).
