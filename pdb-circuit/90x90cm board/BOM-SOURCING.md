# Revision D assembly BOM and sourcing

Updated 2026-09-18. Exact part selections for 47 populated PCB locations. Procurement and assembly acceptance remain INCOMPLETE; catalogue identifiers do not guarantee stock or JLCPCB assembly eligibility.

## Population instructions

- U1: JLCPCB fits ASSMANN A 08-LC-TT, an 8-pin DIP socket, 2.54 mm pin pitch and 7.62 mm row spacing. Owner inserts their ATtiny85 afterward. Do not order, insert, or solder an ATtiny85 during factory assembly. The schematic retains the MCU's electrical symbol and uses separate Assembly fields for the socket.
- LED1, LED2 and LED3: red Kingbright WP3A8ID.
- JP1: fit Phoenix 1751248 terminal block, with no bypass wire or short installed.
- FAN1–FAN3: fit headers only. Fans and cables are external items.
- J1/J2: fit board headers only. Mating cable plugs are external items.
- H1–H4 and TP1: no purchased or populated component; excluded from assembly BOM.

## Selected parts

| References | Manufacturer | Assembly MPN | LCSC/JLC identifier | Notes |
|---|---|---|---|---|
| C3 | Panasonic | EEUFR1V471 | C178715 | 10 mm diameter; 5 mm lead pitch. Do not substitute EEUFR1V471L. |
| C4, C5, C6 | TDK | FG28X7R1H104KNT00 | C448595 | 100 nF 50 V X7R 10%; radial 5 mm pitch. |
| C7 | Panasonic | EEUFR1E470 | C407893 |  |
| D1 | Diotec Semiconductor | 5KP18A | Manual sourcing |  |
| D2, D3 | Multicomp Pro | 1N5822 | Manual sourcing | Exact Farnell 4050109 DO-27 package; do not substitute DO-201 without footprint review. |
| D4 | Vishay | 1N4007-E3/54 | Manual sourcing |  |
| FAN1, FAN2, FAN3 | Samtec | TSW-104-07-G-S | Manual sourcing | Fit male 1x4 header, not a fan. Verify finished-hole fit with assembler. |
| J1 | Phoenix Contact | 1836202 | C5444352 | PCB header only; mating cable plug not included. |
| J2 | Phoenix Contact | 1836189 | C5355140 | PCB header only; mating cable plug not included. |
| J3 | Samtec | TSW-105-07-G-D | Manual sourcing | Male 2x5 header; verify finished-hole fit with assembler. |
| J4 | Samtec | TSW-103-07-G-D | Manual sourcing | Male 2x3 header; verify finished-hole fit with assembler. |
| JP1 | Phoenix Contact | 1751248 | C89122 | Fit terminal block. Leave OPEN: no bypass wire or short. |
| K1 | Omron | G2RL-1A DC12 | C1524657 |  |
| LED1, LED2, LED3 | Kingbright | WP3A8ID | Manual sourcing | Red 3 mm LED; pad 1 cathode. |
| Q2 | Diotec Semiconductor | BC337-40 | Manual sourcing | Pads 1 C, 2 B, 3 E. 2.54 mm pitch; confirm lead forming. |
| Q3 | Diotec Semiconductor | 2N7000 | Manual sourcing | Pads 1 S, 2 G, 3 D. 2.54 mm pitch. |
| R1 | Yageo | MFR-25FBF52-68K | Manual sourcing | 1%, 0.25 W; form axial leads to 10.16 mm. |
| R2 | Yageo | MFR-25FBF52-15K | C3556390 | 1%, 0.25 W; form axial leads to 10.16 mm. |
| R3, R7, R8, R9, R13, R16, R17, R18, R19 | Yageo | MFR-25FBF52-1K | C1364484 | 1%, 0.25 W; form axial leads to 10.16 mm. |
| R4 | Yageo | MFR-25FBF52-100R | Manual sourcing | 1%, 0.25 W; form axial leads to 10.16 mm. |
| R5, R11, R12 | Yageo | MFR-25FBF52-10K | C1519255 | 1%, 0.25 W; form axial leads to 10.16 mm. |
| R6, R14, R15 | Yageo | MFR-25FBF52-2K2 | Manual sourcing | 1%, 0.25 W; form axial leads to 10.16 mm. |
| R20 | Vishay | MRS25000C1008FCT00 | Manual sourcing |  |
| SW1 | Omron | B3F-1000 | C93157 |  |
| U1 | ASSMANN WSW Components | A 08-LC-TT | C3170386 | ASSEMBLY OVERRIDE: fit socket only; owner inserts ATtiny85. Do not procure or solder MCU. |
| U2 | Texas Instruments | LM2936Z-3.3/NOPB | Manual sourcing | 3.3 V variant only; pads 1 OUT, 2 GND, 3 IN. Form leads to 2.54 mm. |
| U3 | Isocom Components | ISP817X | Manual sourcing | DIP-4 7.62 mm; pads 1 A, 2 K, 3 E, 4 C. |
| Z2 | Vishay | BZX55C3V6-TAP | Manual sourcing |  |

## Sourcing and fit checks still required

- J1's exact Phoenix 1836202 catalogue listing showed unavailable for purchase. Arrange JLCPCB sourcing/consignment; do not accept a different pitch or flange variant automatically.
- Blank LCSC entries mean no exact catalogue match was verified. Give JLCPCB the manufacturer and complete MPN for quotation; do not approve automatic substitutes.
- C4–C6's exact TDK listing showed no stock when checked. Confirm procurement before committing the assembly order.
- Socket C3170386 was identified in LCSC; JLCPCB assembly acceptance and stock have not been confirmed.
- Confirm the Samtec headers fit the finished plated holes, including hole and pin tolerances. Current generic footprint drill is 1.0 mm; nominal 0.64 mm square header pins alone do not establish worst-case fit.
- Confirm factory lead forming for all axial parts and the 2.54 mm TO-92 footprints (Q2, Q3, U2). Confirm socket body clearance and added assembled height in the enclosure. Socket pin grid matches the existing U1 DIP-8 land pattern, but no updated 3D/enclosure fit inspection was performed here.
- C3 is EEUFR1V471 (10 mm body, 5 mm pitch), not EEUFR1V471L (different body and pitch). C4–C6 are radial TDK parts, not the previously mentioned axial KEMET parts.
- Q3 remains a 2N7000, selected from Diotec. Its datasheet does not guarantee RDS(on) at 3.3 V. Preserve the existing functional validation requirement for the fan-control circuit; this metadata/BOM task is not a fresh electrical qualification.
- Review the final JLCPCB component-placement preview, polarity, top-side orientation and through-hole assembly quote. A complete MPN list is not a fabrication or assembly release.

## Manufacturer sources

- C3: [EEUFR1V471](https://industrial.panasonic.com/content/data/CP/PDF/S_Alm_A_cap_catalog_am.pdf)
- C4, C5, C6: [FG28X7R1H104KNT00](https://product.tdk.com/en/search/capacitor/ceramic/lead-mlcc/info?part_no=FG28X7R1H104KNT00)
- D1: [5KP18A](https://diotec.com/tl_files/diotec/files/pdf/datasheets/5kp65.pdf)
- D4: [1N4007-E3/54](https://www.vishay.com/docs/88503/1n4001.pdf)
- FAN1, FAN2, FAN3: [TSW-104-07-G-S](https://suddendocs.samtec.com/prints/tsw-xxx-xx-xxx-x-xx-xxx-mkt.pdf)
- J3: [TSW-105-07-G-D](https://suddendocs.samtec.com/prints/tsw-xxx-xx-xxx-x-xx-xxx-mkt.pdf)
- J4: [TSW-103-07-G-D](https://suddendocs.samtec.com/prints/tsw-xxx-xx-xxx-x-xx-xxx-mkt.pdf)
- K1: [G2RL-1A DC12](https://components.omron.com/sites/default/files/datasheet_pdf/CDPA-001.pdf)
- LED1, LED2, LED3: [WP3A8ID](https://www.kingbrightusa.com/images/catalog/SPEC/WP3A8ID.pdf)
- Q2: [BC337-40](https://diotec.com/tl_files/diotec/files/pdf/datasheets/bc337.pdf)
- Q3: [2N7000](https://diotec.com/tl_files/diotec/files/pdf/datasheets/2n7000.pdf)
- R1: [MFR-25FBF52-68K](https://yageogroup.com/content/datasheet/asset/file/YAGEO-MFR_DATASHEET)
- R2: [MFR-25FBF52-15K](https://yageogroup.com/content/datasheet/asset/file/YAGEO-MFR_DATASHEET)
- R3, R7, R8, R9, R13, R16, R17, R18, R19: [MFR-25FBF52-1K](https://yageogroup.com/content/datasheet/asset/file/YAGEO-MFR_DATASHEET)
- R4: [MFR-25FBF52-100R](https://yageogroup.com/content/datasheet/asset/file/YAGEO-MFR_DATASHEET)
- R5, R11, R12: [MFR-25FBF52-10K](https://yageogroup.com/content/datasheet/asset/file/YAGEO-MFR_DATASHEET)
- R6, R14, R15: [MFR-25FBF52-2K2](https://yageogroup.com/content/datasheet/asset/file/YAGEO-MFR_DATASHEET)
- U2: [LM2936Z-3.3/NOPB](https://www.ti.com/lit/ds/symlink/lm2936.pdf)
- U3: [ISP817X](https://isocom.com/wp-content/uploads/2026/04/DE93307-ISP817_827_847-220523.pdf)
- Z2: [BZX55C3V6-TAP](https://www.vishay.com/docs/85604/bzx55.pdf)

- U1 socket: [ASSMANN product and pin grid](https://www.assmann-wsw.com/us/product/a-08-lc-tt/), [mechanical drawing](https://www.assmann-wsw.com/uploads/datasheets/ASS_0810_CO.pdf), [LCSC catalogue entry](https://www.lcsc.com/product-detail/C3170386.html).

## Evidence scope

The saved schematic was updated through Konnect and read back using a fresh BOM export. All 47 populated references match the intended manufacturer/MPN and assembly fields. The design BOM has 52 rows; the separate S660-PDB-revD-JLCPCB-BOM.csv has 47 rows and excludes H1–H4 and TP1. Use the separate assembly BOM for quoting: the design BOM retains the MCU MPN for electrical documentation, while the assembly BOM contains only the socket at U1.

Fresh ERC: 0 errors, 0 warnings. Exported netlists before and after the metadata update have identical net-to-pin connections, component values and footprint assignments. PCB geometry was not modified. No new PCB DRC or enclosure check is claimed.

The assembly CSV has 23 component locations without a verified catalogue identifier. Those entries have exact manufacturer MPNs and require manual matching/sourcing. The socket's LCSC identifier also needs JLCPCB eligibility confirmation. Thus the BOM content is complete, but procurement and manufacturing release remain INCOMPLETE.

CSV column convention checked against [JLCPCB BOM guidance](https://jlcpcb.com/help/article/bill-of-materials-for-pcb-assembly) on 2026-09-18. Each populated reference is listed individually; Quantity is per board.

Part-number selection and saved-schematic metadata verification are separate from procurement, physical placement approval, firmware programming and functional testing. No purchase or assembly order has been placed. Gerber/CPL regeneration and a new full-board release review are outside this BOM update.
