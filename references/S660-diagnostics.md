# S660 diagnostics — what the car's modules answer

What a Honda S660 (JW5, 6MT, S07A turbo) gives back when it is **asked** with diagnostic
requests at the OBD-II port: the modules on the bus, the standard OBD-II data, every Honda
identifier each module answers, the fault memory, and what is not there. Everything here was
measured on this project's car between 2026-11-01 and 2026-11-03, read-only.

- **What the car broadcasts by itself** (no requests) is in `references/S660-CAN-bus.md`.
- **The CTBA unit's background** (laser, wiring, functions) is in `references/S660-CTBA.md`.
- **The tools** are in `hardware/can/`. The adapter, the listen-only service and the drive
  recorder are in BUILD_NOTES §34 and §40.

**Status: complete.** Every module except the SRS (airbags) has had its whole 0x22 identifier
range read. The SRS was read for identification only, by choice. No further probing is planned.

## Contents

1. Summary: what can be read
2. How the car is addressed
3. The modules
4. Standard OBD-II (engine computer)
5. Honda identifiers, module by module
6. Fault memory
7. The 0x731 → 0x736 / 0x737 stream
8. Looked for and not found
9. Safety rules and tools
10. History of the work
11. Sources

Conventions: identifiers (DIDs) are hex. **"Byte n" of an identifier means the n-th data byte
after the `62 hh ll` reply header, counted from 0.** Multi-byte values are big-endian. "r" is the
correlation with the reference signal named.

---

## 1. Summary: what can be read

The useful values that the bus does **not** broadcast, and where to ask for them:

| Value | Request | Decoding | Notes |
|---|---|---|---|
| Ignition timing | OBD 01 0E | standard | −14 to +44° seen |
| Fuel trims, short / long | OBD 01 06 / 07 | standard | |
| Engine load | OBD 01 04, 01 43 | standard | |
| Manifold pressure | OBD 01 0B | standard, kPa absolute | 22–182 kPa seen (about +0.8 bar boost) |
| Lambda, actual / commanded | OBD 01 34 / 01 44 | standard | 2.0 = fuel cut on the overrun |
| Catalyst temperature | OBD 01 3C | standard | to 818 °C seen |
| Barometric pressure | OBD 01 33 | standard | |
| Module voltage | OBD 01 42, or 0x22 **E600** on any module | E600: mV, 16-bit | |
| Odometer | cluster 0x60, **0x7022** bytes 6–8 | km, 24-bit | also broadcast in 0x294 |
| Fuel left | cluster 0x60, **0x702A** bytes 12–13 | L × 10 | |
| Average km/L used for the range | cluster 0x60, **0x702A** bytes 6–7 | km/L × 10 | |
| Range | cluster 0x60, **0x702A** bytes 14–15 | km | = fuel × km/L, as on the dash |
| Engine run time | engine 0x10, **0x2660** bytes 46–47 | seconds since start | |
| Brake (master-cylinder) pressure | VSA 0x28, **0x4005** bytes 7–8 | ≈ 0.1 MPa per count above 25 | also broadcast in 0x1A4 |
| Steering effort (torque / motor current) | EPS 0x30, **0x4808** bytes 0–5 | three signed 16-bit values | **not broadcast** |
| Steering angle | EPS 0x30, **0x48AA** bytes 15–16 | ≈ 10 counts per °, signed | also broadcast in 0x156 |

Not available anywhere: **oil temperature, the selected gear or neutral, trip A / B, and any
live CTBA value** (section 8).

## 2. How the car is addressed

- **29-bit addressing only (ISO 15765-4).** A standard OBD-II request is broadcast on
  **0x18DB33F1**. A Honda module `tt` is asked on **0x18DA`tt`F1** and answers on
  **0x18DAF1`tt`** (F1 = the tester). Long replies are ISO-TP multi-frame.
- **11-bit 0x7DF gets no answer**, and no module answers a diagnostic request on any 11-bit ID
  0x700–0x7FF. One 11-bit ID starts a sensor stream instead (section 7).
- **The modules speak UDS (ISO 14229)** in the default session. KWP2000 0x21 is not supported
  (`7F 21 11` from every module).
- **The engine computer pads frames with 0x55.** Modules answer with the ignition on and the
  engine off.
- **No gateway.** The OBD-II port is on the modules' own bus (F-CAN). The broadcast frames heard
  there are the same 41 IDs, and no gateway address answers.

How a 0x22 reply is read:

| Reply | Meaning |
|---|---|
| `62 hh ll …` | The identifier exists; its data follows |
| `7F 22 31` | Request out of range: no such identifier (by far the most common) |
| `7F 22 33` | Security access denied: it exists but is locked (never unlocked: 0x27 is banned) |
| `7F 22 22` | Conditions not correct: exists, not readable now (never seen) |
| `7F xx 78` | Response pending: the real reply follows (the EPS does this for 0x19) |

## 3. The modules

An address scan (0x22 0xF110 to every address 0x00–0xFF) finds **six modules**. TDJ is Honda's
model code for the S660, 5JA the engine's.

| Address | Module | Assembly (0xF110) | Software (0xF181) | 0x22 identifiers |
|---|---|---|---|---|
| **0x10** | Engine computer (PGM-FI) | `37820-5JA-N041` M1 | `37805-5JA-N040` | 52 + 5 identification |
| **0x28** | VSA (stability control and ABS) | `57110-TDJ-9210` M1 | `57114-TDJ-9210` | 20 + identification |
| **0x30** | EPS (electric power steering) | `53200-TDJ-J13` | `39990-TDJ-N010` | 10 + identification |
| **0x53** | SRS (airbags) | `77960-TDJ-J611` M2 | `77959-TDJ-J620` | identification only, by choice |
| **0x60** | Combination meter (instrument cluster; Honda 78100) | `78100-TDJ-N320` M1 | none | 23 + identification |
| **0xB4** | CTBA radar/control unit (City Brake Active System, behind the mirror) | `36130-TDJ-J110` M1 | `36131-TDJ-J110` | 6 + identification |

**ABS is not a separate module:** it is part of the VSA modulator (0x28). No transmission,
gateway, radar, camera, HUD, body / keyless, climate or immobiliser module answers on this bus.

**Identification range 0xF100–0xF1FF** (the same on every module):

| DID | Content |
|---|---|
| 0xF100 | 4 bytes: `FF FF 01 01` on the engine, zeros on the others |
| 0xF110 | Assembly part number + revision (table above) |
| 0xF112 | A serial-like string. On the CTBA it starts `A2C76501301`, Continental's part-number prefix. **Serials are kept out of this repo.** |
| 0xF181 | Software part number (not on the cluster) |
| 0xF190 | The frame number, engine only (kept out of this repo) |

**Two identifiers are common to every module that was swept:**
- **0xE600 = the battery (supply) voltage in mV**, 16-bit. Each module's own measurement.
- **0xE602 = `00 00 00`** on every module.

## 4. Standard OBD-II (engine computer)

Only the engine computer answers OBD-II. It reports **OBD standard JOBD** (PID 1C = 0x0A),
fuel type gasoline, and no MAF: it meters air by manifold pressure.

**Supported service 01 PIDs:** 01 monitor status, 03 fuel system status, 04 load, 05 coolant,
06 / 07 short / long fuel trim, 0B manifold pressure, 0C rpm, 0D speed, 0E timing, 0F intake air,
11 throttle, 13 O2 sensors present, 15 O2 sensor 2, 1C OBD standard, 1F run time, 21 distance with
MIL on, 2E commanded evap purge, 30 warm-ups since codes cleared, 31 distance since codes cleared,
33 barometric pressure, 34 O2 sensor 1 (wide-band: lambda + current), 3C catalyst temperature B1S1,
42 module voltage, 43 absolute load, 44 commanded lambda, 45 relative throttle, 47 throttle B,
49 / 4A accelerator pedal D / E, 4C commanded throttle actuator, 51 fuel type.
**Nothing above 0x51:** no oil temperature (5C) and no ambient temperature (46).

**Other services:**

| Request | Reply |
|---|---|
| 09 02 | Frame number `JW5-…` (11 characters, not a 17-character VIN; kept out of this repo) |
| 09 04 | Calibration ID `37805-5JA-N040` |
| 09 0A | `ECM-EngineControl` |
| 03 / 07 | Stored / pending codes: **none** (every reading, 2026-11-01 to 11-03) |
| 0A | No reply: permanent codes are not supported |

**Values seen** (cold idle on 2026-11-01, and drives on 2026-11-02 / 03):

| PID | Cold idle | On a drive |
|---|---|---|
| 0C rpm | 1,307 → 1,151 (fast idle settling) | to 5,181 |
| 05 coolant | 48 → 59 °C | 45–95 °C |
| 0F intake air | 40–41 °C | 25–47 °C |
| 3C catalyst | 80 → 143 °C | to 818 °C |
| 0E timing | −5 → +15.5° (retarded to heat the catalyst) | −14 to +44° |
| 06 / 07 fuel trim | −5.5 → −3.9 % / +2.3 % | −10 to +17 % / +1.6 to +3.1 % |
| 34 / 44 lambda | 0.98–1.01 / 0.98–1.00 | 0.7–2.0 |
| 0B MAP / 33 baro | 33–46 / 100 kPa | MAP 22–182 kPa |
| 04 / 43 load | 25–33 / 32–44 % | 0–100 % |
| 11 / 45 / 47 / 4C throttle | 15–16 / 4–6 / 32–33 / 5–7 % | |
| 49 / 4A pedal D / E | 18.8 / 9.4 % (sensor offsets, pedal released) | |
| 42 module voltage | 14.34–14.47 V (charging) | 10.0 (cranking) – 14.5 V |
| 01 / 03 | MIL off, 0 codes, readiness complete / closed loop | |

## 5. Honda identifiers, module by module

Every module was asked for 0x0000–0xFFFF with 0x22. Only one identifier in the whole car is
locked: cluster 0x7090. "Static" below means it did not change parked or on a drive.

### Engine computer 0x10 — 52 identifiers

| DIDs | What is known |
|---|---|
| 0x2600, 0x2601 | Short records (10 and 3 bytes) |
| **0x2610** (54 bytes) | **Live engine data:** bytes 6–7 rpm; byte 10 coolant sensor raw (falls as it warms); **byte 11 coolant, °C = value − 40** (= OBD 05); byte 12 intake sensor raw; **byte 13 intake air, °C = value − 40** (= OBD 0F); bytes 18–19 speed; **byte 38, °C = value − 40**, a third temperature (below) |
| 0x2611–0x2615, 0x2620–0x2625, 0x2630 | 54-byte records, mostly flag-like bytes |
| **0x2660** (54 bytes) | **Bytes 46–47 = engine run time, seconds** (13 → 1,329 over a 22 min drive) |
| 0x2661–0x2686 (19 more) | 54-byte (some 34- or 36-byte) records, mostly flag-like; not decoded |
| 0x3000, 0x3001, 0x3004, 0x3008, 0x300C | 0x3004 contains ASCII (`dsea.`) |
| 0xE411–0xE415, 0xE41F | 64-byte records, mostly `FF`, with 4-byte entries such as `02 C1 09 CC`: event or freeze records? |
| 0xE5FF, 0xE80E | Zeros |
| 0xE600, 0xE602 | Battery mV / zeros (common to all modules) |
| 0xE800 | 12 bytes of ASCII: an identification string |
| 0xF806 | 4 bytes |

**0x2610 byte 38** reads ambient while moving, climbs only at a standstill (39 → 91 °C over
8 min idling) and falls as soon as the car moves or the radiator fan runs. It follows airflow:
most likely the manifold air after the intercooler, or the engine bay. **It is not oil.**

### Instrument cluster 0x60 — 23 identifiers (1 locked)

All but two are in 0x7000–0x70FF: 0x7000, 0x7010, 0x7012, 0x7020, 0x7021, 0x7022, 0x7028,
0x7029, 0x702A, 0x702B, 0x7060, 0x7061, 0x7068, **0x7090 (locked, `7F 22 33`)**, 0x70A0, 0x70A1,
0x70A4, 0x70A8, 0x70C0, 0x70C1, 0x70FE, 0x70FF, plus 0xE600 and 0xE602.

| DID | Bytes | Meaning |
|---|---|---|
| **0x7022** | 6–8 | **Odometer, km** (44,697 → 44,713 over a 16 km errand, as on the dash) |
| **0x702A** | 6–7 and 8–9 | **km/L × 10 used for the range** (the dash's average; 141 → 152) |
| 0x702A | 10–11 | Another km/L × 10 (the previous value of the above?) |
| **0x702A** | 12–13 | **Fuel left, L × 10** (re-read by the cluster at ignition-on) |
| **0x702A** | 14–15 | **Range, km** = fuel × km/L (22.5 L × 15.2 = 342 ≈ 343 on the dash) |
| 0x7000 | | Contains `155TDJ` (ASCII) |
| 0x7028 | 15, 17 | Counters? (23 → 26 and 23 → 24 over the errand) |
| 0x7020 | | Four flag bits changed over the errand |

`s660-cluster-read LABEL` reads all 23 for a before / after comparison.

### VSA 0x28 — 20 identifiers

0x4000–0x4007, 0x4030–0x4035, 0x4070–0x4073, 0xE600, 0xE602. **A coarse diagnostic data
list:** mostly 1 byte per value, with a rest value of about 125. It matches the bus signals one
for one, at lower resolution.

| DID | Bytes | Meaning | Fit |
|---|---|---|---|
| 0x4001 | 20–21 | Steering angle, 0x8000 + ° (±380°) | r = 0.999 |
| 0x4001 | 13 | Brake switch bit | |
| 0x4004 | 7–10 | Wheel speeds, ≈ 1.5 km/h per count | r = 1.000 |
| 0x4004 | 15 | Brake switch bit | |
| 0x4004 | 24, 25 | Counters | |
| 0x4004 | 37–38 | Throttle | r = 0.93 |
| 0x4004 | 39–40 | Engine rpm (parked, byte 40 alone looked like a slowly falling temperature, 20 → 17) | r = 1.000 |
| **0x4005** | 7–8 | **Brake (master-cylinder) pressure**, ≈ 0.1 MPa per count above 25 | r = 0.99–1.000 |
| 0x4005 | 11 | Yaw rate, 0.99 °/s per count, rest 125 | r = 0.998 vs 0x091 |
| 0x4005 | 14 | Lateral acceleration from the VSA's own sensor, 0.177 m/s² per count, rest ≈ 123, no dead band | r = 0.955 vs speed × yaw |
| 0x4005 | 18–19 | Steering angle (not linear left vs right) | r = 0.998 |
| 0x4005 | 23 | Longitudinal acceleration, 0.167 m/s² per count, rest 125 | r = 0.91 |
| 0x4007 | 9 | Brake switch bit | |
| **0x4070–0x4073** | | **Intervention records**, not live values: 0x4072 / 0x4073 update at Agile Handling Assist events (0x1A4 byte 4 bit 7) and VSA interventions; 0x4070 / 0x4071 mostly at ABS events (0x1A4 byte 2 bit 1) | |
| 0x4030 | | Changed once, at switch-off | |
| 0x4000, 0x4002, 0x4003, 0x4006, 0x4031–0x4035 | | Static (configuration). 0x403x come in repeating 3-identifier patterns (0x4032 = 0x4035, 0x4030 ≈ 0x4033) | |

### EPS 0x30 — 10 identifiers

0x4800, 0x4801, 0x4808, 0x4809, 0x48AA, 0x48AB, 0x48AF, 0x48FA, 0xE600, 0xE602.

| DID | Bytes | Meaning |
|---|---|---|
| **0x4808** | 0–1, 2–3, 4–5, signed | **Steering effort:** opposite signs at left and right lock (about −1040 / −1202 / −485 left, +1162 / +1616 / +648 right, ≈ 0 at rest). Torque and motor-current candidates. **Not broadcast on the bus.** |
| 0x4808 | 8–9, 10–11 | Engine rpm, vehicle speed (r = 1.000) |
| **0x48AA** | 15–16, signed | **Steering angle**, about 10 counts per ° (r = 1.000) |
| 0x48AA | 84–85, signed | Another angle (motor or column?), r = 0.93 |
| 0x48AA | 5–6, 13–14 | Follow the yaw rate (r = 0.995): steering rate? |
| 0x48AA | 32 | Rises while held at lock (to about 100), 0 at rest: assist current or load |
| 0x48AA | 45 | Dips at lock (254 → 225): supply voltage under the motor's load? |
| 0x48AA | 86–87 | Speed |
| 0x48AF | | ASCII, a part-number-like string |
| 0x4800, 0x4801, 0x4809, 0x48AB, 0x48FA | | Static (configuration or identification) |

### CTBA 0xB4 — 6 identifiers

| DID | Reply | Meaning |
|---|---|---|
| 0xAC00 | `1B 41 30 C0 16 00 00 00` | Static, probably configuration (coding) |
| 0xAC01 | `00 00 3E 4C 4E 4E` | Not known |
| 0xAC02 | 16 × `FF` | An empty (never-written) block |
| 0xD100 | `01` | A mode or state flag? |
| 0xE600 | `31 A6` = 12,710 | Battery voltage, mV |
| 0xE602 | `00 00 00` | As on every module |

**No laser distance, target or brake-request value.** The CTBA either does not give live values by
0x22, or gives them only while it is active (5–30 km/h), which a parked read cannot test. Its
identifiers were not read on a drive.

### SRS 0x53 — identification only

Read for 0xF100–0xF1FF (part numbers above) and nothing else, **by choice**: there is nothing
in it this project needs, and no risk is worth taking with the airbags. Its fault memory was not
read either.

## 6. Fault memory

UDS **0x19 02 FF** (list every stored code), read 2026-11-03. A code is 3 bytes (SAE letter +
4 digits + failure type), then a status byte: **0x08 = confirmed**, 0x40 = test not completed
this cycle, 0x01 = failing now.

| Module | Stored codes | Status |
|---|---|---|
| Engine 0x10 | 58 entries, all status 0x40 only. No confirmed, no pending codes | none |
| VSA 0x28 | **U3006-16** (supply voltage below threshold), **C0034-62**, **C0031-62** (wheel-speed-sensor circuits, failure 62 = signal compare) | 0x08 each |
| EPS 0x30 | **U0100-00** (lost communication with the engine computer), **U3003-1C** (battery voltage out of range), **U0416-68** (invalid data from the VSA) | 0x08 each |
| Cluster 0x60 | none | – |
| CTBA 0xB4 | **U0100-00**, **U3006-16**, **U0416-68** | 0x08, 0x48, 0x08 |
| SRS 0x53 | not read | – |

**Nothing is failing now** (mask 01: every module empty), and the VSA lamp is off. The lists did
not change during the testing. The pattern (supply voltage plus lost or invalid communication in
three modules at once) is what a low-voltage event leaves: a battery change or disconnection, a weak
crank, a jump start. When they were set is unknown. The snapshot and extended data (0x19 04 / 06)
would say, and were deliberately not read.

## 7. The 0x731 → 0x736 / 0x737 stream

Any single frame on 11-bit **0x731** (the content does not matter) starts a burst 9 ms later:
**0x736 at 100 per second and 0x737 at 50 per second, for exactly 2.0 s**, then it stops by
itself. A frame every 1.5 s keeps it running (`s660-731-probe`). The car never sends 0x736
otherwise. It changes nothing else on the bus and leaves no fault code.

**0x736** (`C0 8B 02 5D 08 77 60 03` at rest) holds three channels: A = bytes 0–1 & 0xFFF
(≈ 139), B = bytes 2–3 (≈ 605), C = bytes 4–5 (≈ 2167), then `60 03` constant. **0x737**
(`C1 00 00 00 60 28 00 00`) is constant with the engine off and changes with it running: status.

| Action | A | B | C |
|---|---|---|---|
| Still; steering; brake pedal; camera covered | ±2 (noise) | ±1 | ±2 |
| Rocking the car sideways | 120–178 | unchanged | 1935–2263 |
| Rocking it front to back | 54–185 | unchanged | 1935–2280 |
| Engine idling | 80–166 | **337–693** (vibration) | 2071–2206 |

**A motion sensor**, not the steering, brakes or camera. Its sensitivity (about ±170 counts for a
few tenths of a g) suits a vehicle-dynamics sensor (±2 g over 12 bits ≈ 1,000 counts per g), not
an airbag crash sensor (±50 g or more). **Most likely the VSA's yaw-rate / G sensor in a
diagnostic output mode**, but not certain: the SRS also contains accelerometers. Do not poll it
while driving. The bus already carries yaw and G, and this is an unknown module's diagnostic mode.

## 8. Looked for and not found

| What | Result |
|---|---|
| **Oil temperature** | No OBD PID (5C unsupported), and no identifier starts at ambient and lags the coolant the way sump oil does. The S07A probably has no oil-temperature sensor (the dash has no oil gauge). |
| **Gear, neutral** | Not broadcast (S660-CAN-bus.md, "Gear position") and not in any identifier. Calculate it from rpm ÷ speed. |
| **Trip A / B** | Not in any readable cluster identifier. Perhaps in the locked 0x7090. |
| **CTBA live data** | None readable parked (section 5). |
| **Other modules** | No 11-bit diagnostic module; no KWP2000; nothing at any other UDS address. |

## 9. Safety rules and tools

**Rules, enforced by the tool and not by memory:**

1. **The adapter only transmits on purpose.** The s660 CANable firmware powers up silent (`M1`).
   `s660-diag session-start` sets `M0` and verifies it; `session-stop` sets `M1`, verifies it and
   restarts the listen-only `s660-can.service`, which refuses to start while the adapter is in
   `M0`. Every run is a systemd unit whose `ExecStopPost` is `session-stop`, so however a run ends,
   the adapter goes back to silent. Power-up is silent anyway.
2. **An allow-list of read-only requests** (`ALLOWED` in `s660-diag`):
   - OBD-II **01, 02, 03, 07, 09, 0A**.
   - UDS **0x22** with a 2-byte DID; **0x19** sub-functions **01 / 02 only**; **0x21** with a
     1-byte local identifier. Each with an exact length.
   - **Never:** 0x04 / 0x14 (clear codes), 0x10 (session), 0x11 (reset), 0x27 (security access),
     0x2E (write), 0x2F (I/O control), 0x31 (routines), 0x34–0x37 (download), 0x85 (DTC setting).
3. **Slow:** at most 10 requests per second, one outstanding at a time.
4. **Never the SRS** beyond identification.
5. **Battery:** a sweep checks OBD 01 42 every 256 requests and pauses below **12.1 V**
   (resumable). With the ignition on, the modules draw more than a maintenance charger gives.
   **Before a long run, confirm that the charger is actually charging:** the bus should read about
   13 V or more with the engine off. On 2026-11-03 a charger that had silently stopped let the
   battery fall to the cut-off.
6. **Record everything:** every request and reply goes to `/persist/can/diag.jsonl` (or the run's
   own `.jsonl`), with a `candump -L` alongside.
7. **Fault codes before and after** every run, to show that nothing changed.

**Tools** (`hardware/can/`, installed under `/usr/local/sbin` or `/persist/can/bin`):

| Tool | Does |
|---|---|
| `s660-diag` | The request tool, with the allow-list built in: `session-start` / `session-stop`, `obd`, `uds MODULE 22 DID`, `sweep MODULE 0000 FFFF --skip-f1 [--min-mv 12100] [--max-minutes N]` (resumable, `.state` file), `poll RATE ITEMS…` |
| `s660-sweep-piece`, `s660-diag-sweep@.service` | One piece of a module's full sweep, `systemctl start s660-diag-sweep@30`: runs until 12.1 V or the end of the range |
| `s660-module-scan` | 0x22 0xF110 to every UDS address |
| `s660-cluster-read LABEL` | The cluster's 23 identifiers, for before / after comparisons |
| `s660-stage7`, `stage7-items` | Polls the changing VSA / EPS identifiers parked |
| `s660-stage8` | Fault memory, the 11-bit scan, KWP 0x21 |
| `s660-731-probe` | Keeps the 0x731 stream running, with `candump` |
| `s660-drive-log` | The drive recorder (BUILD_NOTES §40). It also reads `/persist/can/drive-extra-items` if present: extra `s660-diag poll` items, spread between the normal requests (`drive-extra-items.6c`, `.7`). Delete the file to stop them. |

Before any manual session, put the recorder on listen-only (Settings, or
`POST /api/settings {"driveLog":"listen"}`), since in engine mode it holds the session itself.
Raw data (`captures/`, `/persist/can/`) stays out of git.

## 10. History of the work

The stage numbers are the ones the scripts' comments use.

| Stage | Date | What was done | Result |
|---|---|---|---|
| 0 | 11-01 | `s660-diag` written and bench-tested on `vcan` | Allow-list refuses banned services; ISO-TP works |
| 1 | 11-01 | One OBD request on 11-bit, then 29-bit | 29-bit only; engine at 0x10 |
| 2 | 11-01 | PID bitmaps, service 09, codes | Section 4 |
| 3 | 11-01 | 0xF181 / 0xF112 to the expected addresses | Five modules |
| 4 | 11-01 | 24 PIDs polled at a cold idle | Section 4 |
| 5 | 11-02 | 15 PIDs polled on a drive (2 of 3 legs recorded) | Ranges in section 4; led to the drive recorder |
| 6 A | 11-01 | 0xF100–0xF1FF on every module | Identification, section 3 |
| 6 B | 11-02 | Engine 0x0000–0xFFFF | 52 identifiers |
| 6 C | 11-01/02 | Cluster 0x0000–0xFFFF | 23 identifiers |
| scan | 11-02 | Every UDS address | Sixth module: the CTBA, 0xB4 |
| 6 | 11-02/03 | EPS, then VSA, 0x0000–0xFFFF | 10 and 20 identifiers |
| 6c | 11-03 | Engine identifiers on a cold-start drive | 0x2610 and 0x2660 decoded; no oil temperature |
| 7 | 11-03 | VSA / EPS identifiers, parked (steering, brake) then on a drive | Section 5 |
| 8 | 11-03 | Fault memory, 11-bit scan, KWP 0x21 | Section 6; the 0x731 stream; KWP not supported |
| 731 | 11-03 | The 0x731 stream, probed with the car rocked and idling | Section 7 |
| 9 | 11-03 | CTBA identification and full range (two pieces) | Section 5 |

**What went wrong, and the fixes:**
- `session-stop` once left the adapter's channel open, so the mode check read streaming frames
  and refused to restart the listen-only service. It failed safe, as designed. Fixed with
  `slcand -c` and a tty drain before the mode query.
- The engine answers the battery check and a sweep from the same address, so a sweep would have
  read every DID one late. Caught on the bench; the socket is drained after each check.
- The one-off drive poll covered only one ignition cycle and missed a leg; the drive recorder
  replaced it.
- Twice the battery ran down during a sweep: a maintenance charger did not keep up (11-01), and a
  charger stopped charging without warning (11-03). Hence rule 5.

## 11. Sources

The data above is our own measurement. The starting points:
- [commaai/opendbc, Honda fingerprints](https://github.com/commaai/opendbc/tree/master/opendbc/car/honda):
  Honda module addresses (the N-Box 2G entry), the 0xF181 / 0xF112 queries.
- [AutosportLabs forum, Honda Mode 01 on 29-bit](https://forum.autosportlabs.com/viewtopic.php?p=23633):
  0x18DB33F1 and the engine at 0x18DA10F1 (one report, Acura TSX; confirmed here).
- [PEAK forum, 29-bit diagnostic IDs](https://forum.peak-system.com/viewtopic.php?p=4947),
  [uds.readthedocs, diagnostics over CAN](https://uds.readthedocs.io/en/latest/pages/user_guide/can.html):
  the 0x18DA`TA``SA` scheme.
- [OBD-II PIDs (Wikipedia)](https://en.wikipedia.org/wiki/OBD-II_PIDs),
  [python-OBD command tables](https://python-obd.readthedocs.io/en/latest/Command%20Tables/): PID decoding.
- [MLIT document on J-OBD II](https://www.mlit.go.jp/common/000134815.pdf): Japanese OBD from 2008-10.
- [BE FORWARD listing for 36130-TDJ-J110](https://autoparts.beforward.jp/detail/Car-Electronics/Backup-Cameras/PA54896743/):
  identified 0xB4 as the CTBA.

No S660-specific diagnostic documentation was found online, in English or Japanese.
