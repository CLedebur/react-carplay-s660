# S660 CAN bus — message reference

What is known about the CAN traffic on a Honda S660 (JW5). It was reverse-engineered by the
Japanese owner **ACTY typeR** in 2022–2023, by listening at the **OBD-II port** with a Raspberry
Pi Zero, a CAN HAT and `candump`/`cansniffer`. This page restates their findings in English, in
a form this project can code against. Rows marked **✓ our car** were checked on this
project's S660 on 2026-11-01 (see "Checked on our car" below and BUILD_NOTES §34). Treat every
other row as "reported", not "verified".

Sources and attribution are at the end. Where the sources disagree, the conflict is called out
in place. It is not silently resolved.

## What this project needs first

| Use | ID | Where | Meaning |
|---|---|---|---|
| Reverse camera trigger | **0x1A6** | byte 2, bit 2 | Reverse light on **✓ our car** |
| Night / day UI dimming | **0x1A6** | byte 0, bits 1–0 | Headlights: 0 off, 1 parking lights, 2 low beam, 3 high beam **✓ our car** (1, 2, 3 seen) |
| Vehicle speed | **0x309** | bytes 0–1 | Speed, 0.01 km/h, as the speedometer shows it **✓ our car** (reads 4.95% above the wheel speeds: the meter's built-in over-read). For true speed, average the 0x1D0 wheels. |
| Gear | — | — | Not on the bus. Calculate it from 0x1DC RPM ÷ 0x158 speed (see "Gear position") |
| Yaw rate | **0x091** | bytes 0–1 | raw − 32768, ≈0.0037 °/s per count, + = turning right **✓ our car** |
| Turn signals | **0x294** | byte 0, bit 6 / bit 5 | Right / left indicator **✓ our car** |
| Handbrake | **0x1A6** | byte 0, bit 2 | Handbrake on / brake warning light **✓ our car** |

The OBD-II port is where the author tapped, and all of the IDs below were seen there. Our
capture at the same port saw **exactly the same 41 IDs**, no more and no fewer, at 500 kbit/s.

## Checked on our car (2026-11-01)

Parked, ignition on, engine off. A 3 min 36 s `candump` at the OBD-II port while the steps below
were done (`2026-11-01-first.log` + `.markers`, with timestamped step markers; kept out of git, on the Pi under `/persist/can/` and locally in `hardware/can/captures/`).

| Step | What changed | Matches the cheat sheet? |
|---|---|---|
| Headlights: parking → low → high (pulled twice) | 0x1A6 byte 0 bits 1–0: 0 → 1 → 2 → 3 → 2 → 3 → 2 | Yes. It ended at 2 because the switch was left on AUTO; see note 1. |
| Left indicator | 0x294 byte 0 bit 5 on for 3.8 s | Yes |
| Right indicator | 0x294 byte 0 bit 6 on for 5.7 s | Yes. Both bits stay steady while the lamp flashes, so they are the switch state. |
| Clutch down, reverse, neutral, clutch up | 0x1A6 byte 2 bit 2 on for 8.2 s (reverse); **0x13C byte 6 bit 2** went 0 while the clutch was down | Reverse: yes. **Clutch: the bit differs.** The sheet says byte 6 bit **5**; our car uses bit **2** (same meaning: 1 = pedal up). |
| Brake pedal, handbrake off, on | 0x1A6 byte 0 bit 2 went 0 for 6.3 s (handbrake off); 0x17C byte 4 bit 0 and byte 6 bit 5 (brake); 0x1A4 bytes 0–1 and 0x1AA bytes 5–6 (pressure, raw 102 at rest, up to 272) | Yes |
| Wipers intermittent, off | 0x294 byte 0 bits 4–3 = 01 for 1.7 s (and an accidental 10 = low earlier, note 3) | Yes |

Values at rest that agree with the cheat sheet: 0x18B boost 756.6 mmHg absolute (atmospheric,
engine off), 0x1DC RPM 0, 0x309 speed 0. Checked against the dash, and they match exactly:
odometer (0x294 bytes 3–5) **44,677 km ✓**, outside temperature (0x21E) **23 °C ✓**, fuel
(0x1A6 byte 3) **105 = full ✓**. Coolant (0x324) read 46 °C (no dash gauge to compare).

Notes:
1. After the headlight step, 0x1A6 bits 1–0 stayed at **2** (low beam) to the end of the capture.
   The switch had been left on **AUTO**, not OFF. So the value follows what the lamps are doing,
   not the switch position: AUTO with the lamps lit reads the same as low beam. For night dimming
   that is the signal we want.
2. **0x1A6 byte 4 is not the inverse of byte 3 on our car.** Byte 3 = 105 (0x69) all along,
   byte 4 = 0x15–0x17.
3. During the left-indicator step, 0x294 byte 0 bits 4–3 read 10 for 0.7 s and then 01 for
   0.1 s, before the indicator came on. The wiper stalk was touched by accident (confirmed), so
   10 = low is confirmed too.
4. Brake pressure at rest read raw **102**, close to the "103 = 0 MPa" point in the sheet. So
   the (raw − 81) / 42 line is off near zero, as the 0x1A4 entry warns.

### Drive (2026-11-01, 13 min 28 s)

Driveway, local roads, roundabouts, a dual carriageway, and slow full-lock circles. 1,168,457
frames, nothing lost. The capture shows a 51.7 s gap at 19 s, which is the Pi's clock stepping
at its first NTP sync, not missing frames. Use monotonic time or wait for the sync in any
logger. Peaks: 128.4 km/h (0x309), 6,626 rpm (0x1DC), boost 1,478 mmHg absolute (0x18B, about
0.95 bar above atmospheric), steering −483° / +464°, brake raw up to 245.

- **Wheel order is FL, FR, RL, RR** for 0x1D0 and 0x255 (details under "Wheel order").
- **0x091 bytes 0–1 are the yaw rate**, new; "unknown" in the sheet.
- **Longitudinal G (0x1EA bytes 2–3): 0.00169 m/s² per count**, measured.
- **Gear position is not on the bus**, and neither is neutral. A parked lever-by-lever test confirmed it at bit level. It is calculated from RPM ÷ speed (table under "Gear position").
- 0x17C byte 0 (pedal) and bytes 2–3 (RPM) equal 0x13C byte 4 and 0x1DC (r = 1.00).
- Speed above 40 km/h: 0x309 = 1.0495 × the 0x1D0 wheel average, and 0x158 = 1.0187 × it (medians).
- 0x1AB (EPS), 0x21A, 0x221, 0x324 bytes 2–3/5 and 0x38C did not follow any known signal.
  They stay unknown.

## Conventions

- **Byte and bit numbering.** Bytes are 0–7 in the order they appear in the frame (`candump`
  order). Bits are 7 (most significant) to 0 within a byte. "Byte 0, bit 2" = `data[0] & 0x04`.
  The source spreadsheet also numbers bits 0–63 as `byte × 8 + bit`. Reverse light is bit 18
  there.
- **Multi-byte values are big-endian** (most significant byte first). This is Honda's
  convention, and the author's capture of 0x1D0 shows it (see that entry). It has not been
  checked for every ID.
- **Counter and checksum.** Most IDs end with a 2-bit rolling **counter** in bits 5–4 and a 4-bit
  **checksum** in bits 3–0 of their last byte. This is the usual Honda layout. The tables say "C/S"
  for it. We only listen, so we never need to compute these. They are useful as a check that a
  frame was decoded on the right boundaries.
- **Temperatures** use raw − 40 = °C (raw 40 = 0 °C).
- **Bit rate: not stated in any source.** Start at 500 kbit/s (BUILD_NOTES §34).

## Message table

Scaling and ranges are as the author reported them. `?` marks the author's own uncertainty.

### 0x039 (57) — SRS airbag related
| Byte/bit | Meaning |
|---|---|
| byte 2 | Cycles through 0x0C, 0x1B, 0x2A, 0x39. Purpose unknown. Bytes 3–7 not used. |

### 0x091 (145) — yaw rate (found on our car; "unknown" in the sheet)
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | **Yaw rate ✓ our car.** Offset binary: rate = raw − 32768. About **0.0037 °/s per count**, positive = turning **right** (clockwise seen from above). It tracks the yaw rate worked out from the rear wheel speeds with r = −0.98. The scale is ±5%, limited by the assumed rear track (1.275 m). |
| bytes 2–3 | Unknown |

### 0x13C (316) — accelerator pedal / torque
On the drive, bytes 0–1 and bytes 2–3 both tracked the pedal and boost (r = 0.95), range
−85 to 491, which fits the sheet's torque guess.
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Estimated torque?, signed. Follows throttle/accelerator. Goes to −1 for 2–3 s after lifting off. Goes positive when the A/C compressor starts (idle control?). |
| bytes 2–3 | Requested torque?. Tracks bytes 0–1, the same or slightly earlier. Slower than the pedal. |
| byte 4 | Accelerator pedal position, unsigned 0–255 |
| byte 6, bit **2** | Clutch: 1 = pedal up (engaged), 0 = pedal pressed. **✓ our car, on bit 2.** The sheet says bit 5. |
| byte 7 | C/S |

### 0x156 (342) — steering
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Steering angle, signed, 0.1° per count (±500 °). Right +, left −. **✓ our car:** lock to lock read −483.2° to +464.4°, and the first right turn out of the driveway read +211°. |
| bytes 2–3 | Steering rate, signed, 1 °/s per count (±3000) |
| byte 4, bits 2 / 1 / 0 | Steering sensor 1 / 2 / 3 status |
| byte 5 | C/S |

### 0x158 (344) — transmission speed, trip distance
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Transmission speed, unsigned, 0.01 km/h (0–250 km/h) |
| bytes 2–3 | Always 0 (other Hondas put engine speed here) |
| bytes 4–5 | Same value as bytes 0–1 |
| byte 6 | Trip(?) distance, unsigned, 10 m per count (0–2550 m) |
| byte 7 | C/S |

### 0x17C (380) — powertrain
| Byte/bit | Meaning |
|---|---|
| byte 0 | Accelerator opening (powertrain side), 0–255 |
| bytes 2–3 | **Engine RPM**, unsigned, 1 rpm (0–15000) |
| byte 4, bit 7 | Accelerator pressed |
| byte 4, bit 6 | Cruise control on (not tested) |
| byte 4, bit 5 | Unknown ("BOH1", unconfirmed) |
| byte 4, bit 0 | Brake switch |
| byte 5, bit 7 | Unknown ("BOH2", unconfirmed) |
| byte 6, bit 5 | Brake pressed |
| byte 6, bit 4 | Unknown ("BOH3", unconfirmed) |
| byte 7 | C/S |

### 0x18B (395) — turbo boost (absolute manifold pressure)
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Pressure, 0.1 mmHg per count, absolute: 0 = vacuum, 7600 = atmospheric (760 mmHg). About 4000 at idle, up to about 15000 on boost. 1 mmHg = 0.133322 kPa. |
| byte 7 | C/S |

### 0x19B (411) — wheel-speed sensor pulse counters
| Byte/bit | Meaning |
|---|---|
| bytes 0–3 | One free-running counter per wheel, unsigned 0–255, wrapping. Its rate of change is the wheel speed in 0x1D0. The order is in the wheel-order note below. |
| byte 4 | C/S |

### 0x1A4 (420) — brake pressure, VSA
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Driver's brake pressure, unsigned. MPa ≈ raw / 42 − 1.9286, i.e. (raw − 81) / 42. Reported points: 123 = 1 MPa, 165 = 2, 207 = 3, 249 = 4, 290 = 5, 496 = 10. The author also lists 103 as 0 MPa, which does not fit that line, so treat values near zero as approximate. |
| byte 2, bit 1 | ABS-style brake intervention (inferred from situations) |
| byte 2, bit 0 | VSA braking active (AHA or TCS) |
| byte 3, bit 5 | VSA lamp on. When AHA intervenes, the skid indicator in the meter flashes at 2 Hz. |
| byte 3, bit 4 | VSA unavailable |
| byte 4, bit 7 | Torque-vectoring-style intervention, only with the brake pedal released. Comes on up to 1.1 s before an AHA intervention and stays on about 0.5 s after it. |
| byte 4, bit 3 | Goes to 1 for a moment when a switch is turned on. **Placement uncertain:** in the original sheet this note floats in the header row and is not tied to an ID. The English copy put it here. |
| byte 5, bit 6 | Brake hold active (not verified) |
| byte 5, bit 5 | Slope threshold? / brake hold enabled (not verified) |
| byte 6, bit 4 | Brake hold lamp (not verified) |
| byte 7 | C/S |

### 0x1A6 (422) — handbrake, lights, fuel, reverse
| Byte/bit | Meaning |
|---|---|
| byte 0, bit 5 | 1 only while the VSA OFF button is held |
| byte 0, bit 2 | Handbrake on / brake warning light |
| **byte 0, bits 1–0** | **Headlights: 0 off, 1 parking lights, 2 low beam, 3 high beam** |
| **byte 2, bit 2** | **Reverse light on** |
| byte 3 | Fuel level: about 5 (empty) to 105 (full). The low-fuel lamp comes on near 15. Sloshes noticeably while driving. |
| byte 4 | The sheet says this is the bitwise inverse of byte 3. **Not on our car:** byte 3 = 0x69, byte 4 = 0x15–0x17. |
| byte 7 | C/S |

### 0x1AA (426) — VSA / AHA / ABS related?
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Nearly constant. Drops sharply when AHA or VSA acts. |
| byte 2, bits 1–0 | 01 when byte 0 is 0xFF, 10 when byte 1 is not 0xFF. VSA intervention mode? |
| bytes 5–6 | Driver's brake pressure, same value as 0x1A4 bytes 0–1 |
| byte 7 | C/S |

### 0x1AB (427) — electric power steering
| Byte/bit | Meaning |
|---|---|
| byte 0 bits 1–0 + byte 1 | EPS motor torque, **10-bit** unsigned. Unit and maximum unknown. |
| byte 0, bit 4 | Config valid |
| byte 2, bit 6 | EPS output disabled |
| byte 2 | C/S (bits 5–0) |

### 0x1B0 (432) — brake hold / hill start?
| Byte/bit | Meaning |
|---|---|
| byte 0, bit 7 | Unknown |
| byte 0, bit 0 | Brake hold on |
| byte 1, bit 4 | Wheels are moving |
| byte 1, bit 3 | Brake error 1 |
| byte 1, bit 1 | Brake error 2 |
| byte 6 | C/S |

### 0x1D0 (464) — wheel speeds for VSA (fine)
Sent every 20 ms. Four **15-bit** unsigned speeds, 0.01 km/h per count, packed back to back,
then a 4-bit checksum. Read the 8 bytes as one big-endian 64-bit number `w`:

| Bits of `w` | Meaning |
|---|---|
| 63–49 | Wheel 1 = `(w >> 49) & 0x7FFF` |
| 48–34 | Wheel 2 = `(w >> 34) & 0x7FFF` |
| 33–19 | Wheel 3 = `(w >> 19) & 0x7FFF` |
| 18–4 | Wheel 4 = `(w >> 4) & 0x7FFF` |
| 3–0 | Checksum (no counter in this ID) |

Worked check from the author's capture: frame `05 D6 0F 40 13 38 35 48` → wheel 1 =
0x05D6 >> 1 = 747 → **7.47 km/h**. This matches the speed in the capture, which confirms the
big-endian, MSB-first packing. The order is in the wheel-order note below.

### 0x1D8 (472) — unknown
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Always 0 in the author's capture. On the Civic and Fit, this ID carries total distance in km. |
| byte 2 | C/S |

### 0x1DC (476) — engine RPM
| Byte/bit | Meaning |
|---|---|
| byte 0, bit 1 | Unknown |
| bytes 1–2 | **Engine RPM**, unsigned, 1 rpm (0–15000) |
| byte 3 | C/S |

### 0x1EA (490) — acceleration (G sensor)
| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Lateral acceleration, signed. **On our car the raw value is positive while turning left.** The sheet's "left −, right +" probably means the force you feel. The scale is not confirmed (see below). |
| bytes 2–3 | Longitudinal acceleration, signed. Accelerating +, braking −. **✓ our car: 0.00169 m/s² per count** (1 g ≈ 5,800 counts). |
| byte 7 | C/S |

The author gives the scale as "0.0015 m/s²" per count. On the 2026-11-01 drive, a fit of
bytes 2–3 against the rate of change of the wheel speeds gave **0.00169 m/s² per count**,
r = 0.97 over 1,171 half-second windows. That is about 13% more than the sheet. A fit of bytes
0–1 against speed × yaw rate (0x091) was weak (r ≈ 0.5), so the lateral scale is unconfirmed.
The same sensor most likely uses the same 0.00169 for both axes. The drive's lateral peaks
(−2910 / +1412 counts) would then be −0.50 g / +0.24 g, which is plausible.

### 0x1FB (507) — unknown
Byte 0 holds only the counter and checksum.

### 0x21A (538) — unknown
| Byte/bit | Meaning |
|---|---|
| byte 0 + byte 1 bits 7–6 | Looks like a 10-bit signed value. Does not follow brake pressure, steering torque or RPM. |
| byte 3 + byte 4 bits 7–6 | Looks like a second 10-bit signed value |
| byte 4 | C/S |

### 0x21E (542) — outside temperature
| Byte/bit | Meaning |
|---|---|
| byte 3 | Outside air temperature, °C = raw − 40 |
| byte 5 | C/S |

**Source conflict:** the 2022-08-18 note on the blog says outside temperature is at
"0x12E byte 3". 0x12E is not in the spreadsheet, and 0x21E byte 3 is. The blog's ID is almost
certainly a transposition of 0x21E. Confirm with a capture.

### 0x221 (545) — "ECON status"?
| Byte/bit | Meaning |
|---|---|
| byte 0 | Changes steadily between 0b00011111 and 0b00100111. Does not follow the throttle. Purpose unknown. |
| byte 3 | C/S |

### 0x255 (597) — wheel speeds (coarse)
Sent every 40 ms, about half as often as 0x1D0. Easier to use: one byte per wheel.

| Byte/bit | Meaning |
|---|---|
| bytes 0–3 | Speed per wheel, unsigned, 1 km/h per count (0–255). The order is in the wheel-order note below. |
| bytes 4–5 | Always the alternating pattern 0x55 0x55. Purpose unknown. |
| byte 6, byte 7 | Two counters that just increase |

### 0x294 (660) — turn signals, wipers, odometer
| Byte/bit | Meaning |
|---|---|
| byte 0, bit 6 | Right turn signal |
| byte 0, bit 5 | Left turn signal |
| byte 0, bits 4–3 | Wipers: 00 off, 01 intermittent, 10 low, 11 high |
| byte 0, bit 1 | Coolant temperature warning lamp? |
| bytes 3–5 | **Odometer**, 24-bit unsigned, km |
| byte 7 | C/S |

### 0x305 (773) — seat belts
| Byte/bit | Meaning |
|---|---|
| byte 0, bit 7 | Seat-belt warning lamp on |
| byte 1, bit 7 / bit 6 | Passenger airbag ON / OFF indicator (unconfirmed, probably unused) |
| byte 1, bit 5 / bit 4 | Driver belt buckled / unbuckled |
| byte 1, bit 3 / bit 2 | Passenger belt buckled / unbuckled |
| byte 6 | C/S |

### 0x309 (777) — speedometer speed
The meter's speed. It is averaged and rounded so the needle does not jitter.

| Byte/bit | Meaning |
|---|---|
| bytes 0–1 | Average over the last ~0.2 s, unsigned, 0.01 km/h |
| byte 2 | Bytes 0–1 rounded, 1 km/h |
| byte 3 | Bytes 0–1 rounded, 1 km/h (same as byte 2) |
| bytes 4–5 | Average over the last ~0.7 s, unsigned, 0.01 km/h |
| byte 7 | C/S |

### 0x320 (800) — unused
Only the counter and checksum change.

### 0x324 (804) — engine temperatures, alerts
| Byte/bit | Meaning |
|---|---|
| byte 0 | Coolant temperature, °C = raw − 40 (raw 140 = 100 °C) |
| byte 1 | Intake air temperature, °C = raw − 40 |
| bytes 2–3 | Fuel used? Only ever increases, even when stopped. Sometimes holds steady for ~7 s while driving. |
| byte 5 | Looks like boost, but is sometimes constant and sometimes random |
| byte 6, bit 7 | Blow-off valve |
| byte 6, bit 1 | Engine alert? |
| byte 6, bit 0 | Oil alert? |
| byte 7, bit 7 | EPS alert? |
| byte 7 | C/S (bits 5–0) |

### 0x328 (808) — unknown
Byte 5, bit 7 is always 1. Byte 7 is C/S.

### 0x372 (882) — unused
Only the counter and checksum (byte 3) change.

### 0x38C (908) — unknown, VSA related?
| Byte/bit | Meaning |
|---|---|
| bytes 2–3 | Changed randomly about twice during a drive |
| byte 4, bit 7 | Comes on when driving starts? |
| byte 5 | C/S |

### 0x3D7 (983) — unknown
Byte 0 never changes (setting data?). The last byte cycles through only four values in a fixed
pattern, unlike a normal checksum.

### 0x400 (1024) — unused
Only the counter and checksum (byte 4) change.

### 0x40C (1036) — unknown
Sends unexplained values from time to time. They do not seem to follow anything else.

### Fixed-value IDs
0x454, 0x45B, 0x465, 0x510, 0x551, 0x555, 0x590 and 0x597 were seen with values that never
changed. Purpose unknown.

## Wheel order: the sources disagree

0x19B, 0x1D0 and 0x255 each carry four per-wheel values. The sources disagree on the order:

| Source | Wheel 1 | Wheel 2 | Wheel 3 | Wheel 4 |
|---|---|---|---|---|
| Blog note, 2023-03-12 correction (latest) | front left | **rear left** | **front right** | rear right |
| Original sheet, 0x19B | front left | rear left | front right | rear right |
| Original sheet, 0x1D0 and 0x255 (2022) | front left | front right | rear left | rear right |
| English sheet copy, all three | front left | front right | rear left | rear right |

| **Our car, 2026-11-01 drive (measured)** | **front left** | **front right** | **rear left** | **rear right** |

**Measured on our car: FL, FR, RL, RR for 0x1D0 and 0x255.** That matches the 2022 sheet
labels and the English copy, not the 2023 correction. Method: at full lock and walking speed,
the front wheels travel farther than the rears, and the outside farther than the inside. Mean
speed relative to all four, over 43 s at left lock:

| | Wheel 1 | Wheel 2 | Wheel 3 | Wheel 4 |
|---|---|---|---|---|
| 0x1D0, left lock | 0.938 | 1.211 | 0.775 | 1.076 |
| 0x1D0, right lock (22 s) | 1.209 | 0.940 | 1.080 | 0.771 |
| Geometry, S660 at full lock (expected) | FL 0.94 | FR 1.19 | RL 0.79 | RR 1.08 |

Front versus rear does not depend on any sign convention: wheels 1 and 2 beat 3 and 4 on the
same side in every tight turn. Left versus right uses the steering sign (right +, checked
against the driveway's right turn). The car has staggered tyres (15-inch front, 16-inch rear),
but on straights above 30 km/h front and rear agree within 0.03%, so the ABS already corrects
for them. 0x19B (pulse counters) was not tested; its sheet row says FL, RL, FR, RR.

## Gear position: not broadcast, calculate it

No byte or nibble of the 41 IDs follows the selected gear (searched on the 2026-11-01 drive;
the best candidates only track speed). **A parked bit-level test confirmed it** the same evening:
ignition on, engine off, the lever moved neutral → each gear 1–6 → neutral, then reverse, about 5 s
each, with a time marker per stage (`2026-11-01-gears.log`/`.markers`). Every one of the 41 IDs'
bits was compared before and after each move. **Only reverse produced a signal** (0x1A6 byte 2
bit 2). No bit followed 1st to 6th, and **no neutral bit** exists either. The other bits that
changed were sensor noise from the car rocking (0x091), cooling temperatures (0x324), and
counters. The engine computer may still know neutral (many have a neutral switch), but it does
not broadcast it here; asking for it would need diagnostic requests. Work it out from RPM ÷ speed with the clutch pedal up
(0x13C byte 6 bit 2 = 1). Measured ratios, 0x1DC RPM per km/h of 0x158:

| Gear | 1st | 2nd | 3rd | 4th | 5th | 6th |
|---|---|---|---|---|---|---|
| rpm per km/h | 158.5 | 99 | 68 | 51 | ≈40 (4 samples only) | 30.5 |

## Signals the author looked for and did not find

VSA/AHA intervention **amounts** are not on the bus, only flags that intervention is happening.
No exhaust temperature was identified.

## Sources

- ACTY typeR, *S660 CAN ID / CAN bus data analysis* (Minkara, 2022-08). The summary note
  that published the spreadsheet, with 2022-08-18 additions (0x18B boost, 0x324
  temperatures, outside temperature):
  <https://minkara.carview.co.jp/userid/2541861/car/2089827/6995172/note.aspx>
- ACTY typeR, *CAN ID / CAN bus analysis: wheel speed ID464 (0x1D0), 597 (0x255)* (Minkara,
  2022, with a 2023-03-12 update). 0x1D0's 15-bit packing, sample rates, and the wheel-order
  correction:
  <https://minkara.carview.co.jp/userid/2541861/car/2089827/6986318/note.aspx>
- ACTY typeR, *S660 CAN bus monitoring* (Minkara, 2022-08). Setup: OBD-II port, Raspberry Pi
  Zero + CAN HAT, `candump`/`cansniffer`. Civic data used as a starting point.
  <https://minkara.carview.co.jp/userid/2541861/car/2089827/6930725/note.aspx>
- Original spreadsheet, *S660 CANID解析メモ20220809*, ACTY typeR. Shared publicly by the
  author for others to use and add to:
  <https://docs.google.com/spreadsheets/d/1XK60fd8oDmBJlzLblgTqwI2s4agym3Dym8eJ0XaSV68/edit>
- English translation of that spreadsheet, *S660 CANID Analysis Memo 20220809*, by Jane
  Nisperos (2026-05-20):
  <https://docs.google.com/spreadsheets/d/19-ibWpNw19P7Z4-c8aX8wioLWtGmdwdhX0h8NrLIgdw/edit?gid=511715743>

This page is our own restatement of the facts in those sources, checked against both the
Japanese original and the English copy (2026-10-26). It is not a copy of either. Go to the
sources for the author's own words and screenshots.

A related note by the same author, on picking up an engine-speed pulse from the PGM-FI ECU
wiring (pins 47/30/31 ignition, 38/37 crank/TDC sensor), advises against tapping sensor lines
and recommends taking the data from the OBD-II port instead. That supports listening on
CAN, as this project does:
<https://minkara.carview.co.jp/userid/2541861/car/2089827/6987212/note.aspx>
