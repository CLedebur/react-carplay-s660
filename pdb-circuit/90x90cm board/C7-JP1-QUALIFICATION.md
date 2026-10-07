# C7 and JP1 component selection — 2026-09-18

Status: JP1, C7 and R20 are implemented through Konnect. C7 is Panasonic EEUFR1E470 (47 uF / 25 V); R20 is 1 ohm in series with C7 only. ERC: 0 errors/warnings. Saved/refilled-board DRC: 0 errors, 0 unconnected, 17 warnings. No hardware measurements were performed; this is prototype implementation evidence, not vehicle qualification or a checked fabrication package.

## Selected parts

| Function | Manufacturer / part | Quantity per board | Required change |
|---|---|---:|---|
| C7 | Panasonic EEUFR1E470, 47 uF, 25 V, FR-A, straight leads | 1 | Implemented; retained 2 mm-pitch footprint, checked maximum 5.5 mm body envelope |
| C7 damping, R20 | Vishay MRS25000C1008FCT00, 1 ohm, 1%, 0.6 W axial metal-film resistor | 1 | Implemented in series with C7 only; 10.16 mm mounting pitch |
| JP1 fixed terminal | Phoenix Contact MKDS 1/2-3,5 — 1751248 | 1 | Implemented: custom 3.5 mm-pitch footprint and revised routing |
| JP1 removable bridge | Short insulated wire loop, provisionally 1 mm² stranded copper | 1 | Fit only for service; qualify with complete load |

## C7 evidence and decision

TI specifies at least 22 uF and 0.3–8 ohms ESR throughout the operating temperature range for LM2936-3.3. A capacitor's temperature rating alone does not prove this. [TI LM2936, sections 8.2.2.1–8.2.2.2](https://www.ti.com/lit/gpn/LM2936)

EEUFR1E470 is 47 uF ±20%, 25 V, -40 to +105 C, with a nominal 5 mm diameter / 11 mm body and 2 mm lead pitch. Manufacturer maximum impedance is 0.300 ohm at 100 kHz / +20 C, not a guaranteed minimum ESR. It therefore must not be accepted as a bare drop-in replacement. [Panasonic part](https://industrial.panasonic.com/ww/products/pt/aluminum-cap-lead/models/EEUFR1E470), [FR-A datasheet](https://industrial.panasonic.com/cdbs/www-data/pdf/RDF0000/ABA0000C1259.pdf)

Implemented branch: `3V3 -> R20 (1 ohm) -> C7 positive; C7 negative -> GND`. U2 OUT, U1 VCC and C4 remain directly on 3V3. The resistor carries capacitor charging/ripple current, not the MCU's continuous supply current. R20 sits below U1 and beside U2; C7 is below U2, with a dedicated 0.5 mm back-layer return to U2 GND in addition to the ground pour. TI explicitly uses added series resistance to meet the ESR floor for very-low-ESR capacitors; applying that approach to this low-impedance electrolytic is an engineering selection that still needs circuit testing.

Initial tolerance gives 47 × 0.8 = 37.6 uF. Applying the datasheet's 25% post-endurance capacitance decrease gives 28.2 uF at the specified room-temperature measurement condition. This does not establish minimum capacitance at every operating temperature. A 1% 1-ohm resistor establishes a nominal-temperature floor of 0.99 ohm before capacitor ESR; resistor temperature drift must also be included in final acceptance. At +20 C / 100 kHz the branch's resistive component is bounded approximately by 0.99–1.31 ohms. The FR table gives 1.0 ohm maximum impedance at -10 C for this case size/voltage group; neither data point establishes full-temperature loop stability.

Mechanical cautions: use the exact unsuffixed EEUFR1E470 with straight leads. The B taped variant uses formed 5 mm spacing, and is not the selected 2 mm-pitch part. The manufacturer allows body diameter up to 5.5 mm and body length up to 12.5 mm; check that envelope and lead stand-off against adjacent parts and the enclosure.

## JP1 evidence and decision

The reference design ceiling is 30 W at the 12 V input: 2.5 A at 12 V, 3.33 A at 9 V and 4 A at 7.5 V if the load maintains that input power. These are design assumptions, not measured load/inrush results. Do not apply a second converter-efficiency penalty to a budget already specified at the input.

The selected fixed terminal is **Phoenix Contact MKDS 1/2-3,5, 1751248**. Manufacturer documentation lists UL current of 10 A; the higher nominal IEC figures depend on conductor/test conditions and are not used as a blanket system rating. [Phoenix product](https://www.phoenixcontact.com/en-us/products/printed-circuit-board-terminal-mkds-1-2-35-1751248), [manufacturer drawing and specifications](https://www.farnell.com/datasheets/2322647.pdf)

The implemented project-local footprint `S660-PDB:Phoenix_MKDS_1_2_3.5_1751248` uses 3.5 mm pin pitch, 1.1 mm drills and 2.4 mm pads. Body envelope is 7.5 × 7.3 mm, with 8.5 mm installed height and 3.5 mm solder pins. There is no 3D model. Allow room for wire entry, the loop and screwdriver access in the case.

Pad 1 (square) connects to 12V_IN; pad 2 connects to 12V_SW. Each independent terminal has one lead; there are no duplicate or mechanical-only pads. Symbol/library queries, scratch placement/rendering and final live-board pad/net/drill readback were checked. JP1 is at (94.5,42) mm, rotated 180°, with pad 2 at (91,42) mm. Wire entry faces the top edge. A 2 mm back-layer trace connects pad 1 to K1.13; pad 2 joins the existing 2 mm front-layer switched-power trunk.

Bridge the two screw terminals with a short insulated wire loop for service. A provisional 1 mm² plain stranded copper wire fits the specified 0.14–1.5 mm² conductor range; the ferruled range is only 0.25–0.5 mm², so do not assume a 1 mm² ferrule fits. Strip 5 mm and tighten to 0.22–0.25 Nm. Fit/remove the loop with input power disconnected. Leave it removed during normal operation: bridging JP1 defeats timed shutdown and low-voltage cutoff.

A 5 A blade fuse is not a 5 A current limiter. These continuous ratings do not establish survival of a short circuit until the fuse opens. Final protection review needs the exact F1 manufacturer/MPN, time-current curve, prospective fault current and wiring resistance; coordinate with the trace and connector thermal limits. No destructive battery short-circuit test is proposed.

## Remaining qualification and implementation

1. C7/R20 implementation, netlist readback, rendered inspection, ERC and saved/refilled DRC are complete. One cosmetic warning remains for JP1 reference text overlapping its pad. The 17 warnings comprise seven silkscreen items and ten schematic/PCB metadata differences; no library mismatch or electrical/clearance error remains. Regenerate and inspect Gerbers/drills before ordering: the old root-directory Gerbers predate this change.
2. Establish the actual enclosure operating-temperature range. The selected components' ratings do not establish system suitability over that range.
3. On a current-limited bench supply, inspect the 3V3 waveform during startup, shutdown and actual MCU/LED/relay-drive load transitions. Test supply corners relevant to the design and cold/hot conditions. Verify capacitance/branch impedance and absence of sustained oscillation; record transients against MCU voltage/reset requirements. Do not operate the regulator above its thermal/current limits while applying artificial loads.
4. Test JP1 with K1 open so the link carries the whole load. Measure startup inrush, steady current, voltage drop and temperature rise with the complete TOFU/peripheral/fan load. At the hot corner, remain within manufacturer derating limits for the terminal, wire, solder joints and PCB. Inspect screw/wire retention after repeated service operations.
5. Complete F1 fault-protection coordination from component data or qualified laboratory evidence. This remains separate from a successful normal-load bench test.

C7/R20 and JP1 are implemented. Regulator stability over actual supply/load/temperature conditions and JP1 load/temperature/fuse coordination remain bench-qualification items.

## C7 / R20 package and connectivity acceptance

C7 evidence: Panasonic FR-A datasheet, 01-Sep-25, dimensional side view on page 1 and EEUFR1E470 ratings. The long positive lead maps to symbol pin 1 / footprint pad 1; the negative stripe/short lead maps to pin 2 / pad 2. Manufacturer polarity is not numeric pin numbering. Two leads, two passive symbol pins and two plated pads; no duplicates or mechanical pads. Pad 1 is the square/rounded-square pad; the shaded footprint half is negative. Lead diameter is 0.5 ±0.05 mm; 0.8 mm drills accommodate it. Pad pitch is 2 mm and pad size 1.6 mm.

R20 evidence: [Vishay MRS16/MRS25 datasheet, document 28724, 07-Mar-16, pages 1–3](https://www.vishay.com/docs/28724/mrs16m25.pdf). MRS25000C1008FCT00 specifies 1 ohm, 1%, 50 ppm/K, 0.6 W at 70 C subject to derating; this exceeds the proposed 0.25 W rating. Two interchangeable axial leads map to Device:R pins 1/2 and footprint pads 1/2. Body maximum 6.5 × 2.5 mm, nominal lead diameter 0.6 mm, minimum mounting pitch 10 mm. The selected DIN0207 footprint uses 10.16 mm pitch and 0.8 mm drills; its nominal 6.3 mm fab body is 0.2 mm shorter than this part, but its courtyard and available placement contain the 6.5 mm maximum body.

Library queries, disposable schematic/PCB placements and renders were inspected. The scratch-board live query refused the different open document, so scratch saved geometry was inspected read-only; no other board was read or altered by that failed query. Final real-board pad readback confirms C7.1 at (43,71.5) mm and C7.2 at (45,71.5) mm, R20.1 at (30,68) mm and R20.2 at (40.16,68) mm. C7 maximum body extends x=41.25..46.75, y=68.75..74.25 mm, clear of neighboring bodies. C7's generic footprint model depicts a shorter 7 mm part: reserve **12.5 mm body height plus lead stand-off** in the enclosure; do not rely on that generic model for height clearance.

Exported KiCad netlist confirms `/3V3` contains U2.1, U1.8, C4.1, R11.1, R12.1, J4.2 and R20.1; `Net-(C7-Pad1)` contains only R20.2 and C7.1; C7.2 and U2.2 connect to GND. Thus R20 is not in the MCU DC supply path. New traces use the existing 0.5 mm logic-rail width. Schematic-to-PCB sync reports no pending connectivity/value/footprint changes. Schematic custom fields are not all copied by Konnect to the PCB; the BOM contains both exact MPNs.
