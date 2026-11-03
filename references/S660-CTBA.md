# S660 City Brake Active System (CTBA): what is known

Research notes, 2026-11-03. Each fact has a source and a confidence label:
**[official]** Honda's own documents, **[ours]** measured or read on our car or in our wiring PDF,
**[inferred]** our reasoning, not confirmed, **[3rd party]** forums, dealers or listings.

`references/S660-diagnostics.md` (section 5, CTBA) holds our diagnostic reads of the unit (address 0xB4).

## 1. The unit

| Item | Value | Source |
|---|---|---|
| Honda name | シティブレーキアクティブシステム レーダ/コントロールユニット ("radar/control unit"). The sensor and the control logic are **one box**. | [ours] wiring PDF p.53 (diagram 27-C) |
| Assembly part number | `36130-TDJ-J110` M1 (0xF110) | [ours] |
| Software part number | `36131-TDJ-J110` (0xF181) | [ours] |
| Supplier | Probably **Continental**. 0xF112 starts `A2C76501301`, and A2C is Continental's part-number prefix | [inferred] |
| Product family | Probably Continental's **SRL** (Short Range Lidar) family (SRL1 / SRL121), the infrared "city emergency brake" sensor that Continental has supplied since 2008 (Volvo City Safety). No source names Honda as an SRL customer. | [inferred] |
| Location | Top centre of the windscreen, behind the rear-view mirror | [official] owner's manual |
| Diagnostic address | 0xB4, on F-CAN | [ours] |

## 2. The laser (S660 owner's manual)

| Item | Value |
|---|---|
| Type | Infrared laser radar (lidar), pulsed time-of-flight |
| Wavelength | **905 nm** |
| Maximum average output | **45 mW** |
| Pulse width | **33 ns** |
| Beam spread | **28° horizontal × 12° vertical** |
| Eye safety | Do not look into it with optical instruments from closer than 100 mm |

Source: [S660 owner's manual, City Brake Active System](https://www.honda.co.jp/ownersmanual/webom/jpn/s660/2015/details/13697090-42194.html) [official].

The manual does not give a detection range. A third-party listing for the Continental SRL121 gives
905 nm, 70 W peak, laser class 1M, a 100 Hz update rate and HS-CAN output (relative distance,
relative speed, lateral offset) ([IndiaMART](https://www.indiamart.com/proddetail/continental-srl121-short-range-lidar-22118341733.html), [3rd party]). Those figures fit our unit
but are not confirmed for it. Continental describes its SRL as 3 infrared beams that look about
10 m ahead ([Electronic Specifier, SRL-CAM400](https://www.electronicspecifier.com/products/sensors/continental-integrates-the-camera-and-infrared-functions-into-a-single-compact-unit/), [3rd party]).

## 3. Functions

### 3.1 Low-speed collision mitigation brake (低速域衝突軽減ブレーキ)
- Works from about **5 km/h to about 30 km/h**, against **vehicles only**. It does not detect
  motorcycles, bicycles or pedestrians. [official] [S660 catalogue](https://www.honda.co.jp/auto-archive/s660/2022/webcatalog/performance/active-safety/)
- Sequence: a buzzer sounds and the CTBA indicator flashes, then the car brakes hard. After the
  car stops, the brake releases, and the indicator stays on for 10-odd seconds. [official] owner's manual
- It does not work in R. [official]
- The driver cancels it by pressing the brake pedal, lifting the accelerator, holding the accelerator
  down for about 4 s, or steering. [3rd party] [Yasith Mayabandara's PDF](https://gershon.ucoz.com/HONDA/ctba.pdf)
- The brake force comes from the **VSA modulator**. The CTBA has no actuator of its own. [inferred] (it
  has only power, ground and F-CAN, see §4)

### 3.2 False-start suppression (誤発進抑制機能), **CVT only**
- Stopped or below about **10 km/h**, an obstacle about **4 m** or less ahead, and the accelerator
  pressed hard: the system limits engine output and sounds a warning. [official] [Honda press release, 2013](https://global.honda/jp/news/2013/4130329c.html)
- **6MT cars do not have it.** [official] catalogue. **Our car is a 6MT, so on our car only the
  brake function (3.1) exists.**
- When CTBA is switched off, this function is off too. It also does not work on steep slopes, or in P, R or N. [official]

### 3.3 Indicators and switch
- CTBA indicator **on steady** means CTBA is off. **Flashing** means it is braking or warning. It also flashes when the system has stopped itself (see §5).
- **CTBA OFF switch:** hold it until the buzzer sounds. CTBA comes back **on at every engine start**.
- Switch it off on a dynamometer or free rollers. [official]

## 4. Wiring (our wiring PDF, `references/S660 Electrical schematics .pdf`) [ours]

**Radar/control unit, diagram 27-C (PDF page 53).** A 7-pin connector. Four pins are drawn:

| Unit pin | Signal | Wire colour | Goes to |
|---|---|---|---|
| **4** | **F-CAN_H** | white (白) | F-CAN, junction 143 at the meter |
| **3** | **F-CAN_L** | red (赤) | F-CAN, junction 144 at the meter |
| **5** | **IG1 VSA/ABS** (ignition-switched supply) | white (白) | Idle-stop cars: IG1 relay 2 (wire 126, light blue). Other cars: wire 71 (green), fuse box diagram 3-C |
| **7** | **GND** | black (黒) | Ground **G501** |

The drawing also lists the bracket, cover, cover base and front windscreen beside the ground run.
The drawing does not show pins 1, 2 and 6.

**CTBA OFF switch, diagram 27-D.** The switch does **not** connect to the CTBA unit.

| Switch pin | Signal | Wire | Goes to |
|---|---|---|---|
| 5 | switch output | purple (紫), wire 147 | **Combination meter pin 9, "CTBA OFF SW"** (diagram 13-B, PDF page 25) |
| 6 | switch ground | black | G501 |
| 2 | LED, illumination + | pink (桃), wire 79 | illumination, 3-C |
| 1 | LED − | black | G501 |

So the **meter reads the switch and sends it over F-CAN**. The CTBA unit receives the on/off state
as a CAN message. [inferred from the wiring]

**F-CAN members** (from the meter page, junctions 143/144): PGM-FI ECU, DLC, EPS, VSA modulator,
steering angle sensor, smart ECU, SRS unit, CTBA radar/control unit, and the combination meter
(F-CAN pins 19/20; its B-CAN is on pins 30/31). This matches the modules that answered our scan.

## 5. Faults and messages

- **Self-stop conditions.** The system stops itself, and the indicator flashes, when the sensor area
  is too **hot**, is blocked by **dirt, ice or frost**, or when **snow** is on the bonnet. It resets itself
  when the condition clears. [official]
- **Meter DTC U12A7:** the combination meter does not receive messages from the CTBA radar/control unit. [3rd party] [seibisi.net Honda DTC list](https://seibisi.net/honda_dtc/)
- **Codes stored in our unit:** U0100-00 (lost communication with the engine ECU), U3006-16 (supply
  voltage low), U0416-68 (invalid data from the VSA). These are the same low-voltage pattern as in the
  EPS and VSA. Honda bulletins note that U0416 sets after a battery disconnect or jump start
  ([NHTSA TSB MC-10115759](https://static.nhtsa.gov/odi/tsbs/2017/MC-10115759-9999.pdf), another model). [ours] + [3rd party]
- **"Inspect CTBA" message that stayed on:** on a Fit 3 Hybrid, a new 12 V battery cleared it. [3rd party, anecdotal] [Minkara](https://minkara.carview.co.jp/userid/3693346/car/3683600/8454464/note.aspx)
- **Amber brake lamp from a CTBA fault:** a dealer traced one case to a reading outside tolerance, not
  a failed sensor, and a software update fixed it. [3rd party] [Kakaku.com](https://bbs.kakaku.com/bbs/K0000569254/SortID=19517337/)
- **Aiming:** G-scan's support table lists the S660 (JW5) as needing no aiming target. No source gives an aiming
  procedure for the laser unit. [3rd party] [G-scan table](https://g-scan.jp/wp-content/themes/g-scan/images/after_support/2025-02-21.pdf)
  Honda's US aiming job aids cover millimetre-wave radar and cameras, not this unit.

## 6. What is still unknown

1. **Which F-CAN broadcast IDs the CTBA sends** (target distance, warning, brake request) and which
   ID carries the meter's CTBA OFF state. No public DBC has them (opendbc does not). Candidates come from
   a capture: an ID that changes only when a car is in front at 5–30 km/h, or when CTBA OFF is held.
2. The detection range and update rate of our unit (the SRL121 figures are not confirmed).
3. Pins 1, 2 and 6 of the unit connector.
4. Honda's DTC list for the unit itself (the HDS service manual, not public).

## 7. Sources

Official (Honda):
- [S660 owner's manual, City Brake Active System](https://www.honda.co.jp/ownersmanual/webom/jpn/s660/2015/details/13697090-42194.html)
- [S660 catalogue, active safety (2022 archive)](https://www.honda.co.jp/auto-archive/s660/2022/webcatalog/performance/active-safety/)
- [Honda press release, 2013-03-29 (introduction on the Fit)](https://global.honda/jp/news/2013/4130329c.html)
- `references/S660 Electrical schematics .pdf`, PDF pages 25 and 53

Third party:
- [Yasith Mayabandara, "Honda City Brake Active System (CTBA)"](https://gershon.ucoz.com/HONDA/ctba.pdf)
- [seibisi.net, Honda DTC list (U12A7)](https://seibisi.net/honda_dtc/)
- [G-scan ADAS support table, 2025-02-21](https://g-scan.jp/wp-content/themes/g-scan/images/after_support/2025-02-21.pdf)
- [Continental SRL121 listing (IndiaMART)](https://www.indiamart.com/proddetail/continental-srl121-short-range-lidar-22118341733.html)
- [System Plus, Continental SRL1 teardown (paid report)](https://www.systemplus.fr/reverse-costing-reports/continental-srl1-lidar-for-advanced-driver-assistance-systems/)
- [Electronic Specifier, Continental SRL-CAM400](https://www.electronicspecifier.com/products/sensors/continental-integrates-the-camera-and-infrared-functions-into-a-single-compact-unit/)
- [Volvo City Safety (Wikipedia)](https://en.wikipedia.org/wiki/Volvo_City_Safety)
- [NHTSA TSB MC-10115759 (U0416 after a battery disconnect)](https://static.nhtsa.gov/odi/tsbs/2017/MC-10115759-9999.pdf)
- [Minkara, Fit 3 CTBA message and battery](https://minkara.carview.co.jp/userid/3693346/car/3683600/8454464/note.aspx)
- [Kakaku.com, CTBA inspection lamp](https://bbs.kakaku.com/bbs/K0000569254/SortID=19517337/)
- [BE FORWARD listing for 36130-TDJ-J110](https://autoparts.beforward.jp/detail/Car-Electronics/Backup-Cameras/PA54896743/)
