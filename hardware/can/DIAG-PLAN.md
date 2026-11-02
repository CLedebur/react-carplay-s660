# S660 diagnostic requests — research and test plan

Everything so far has been **listening** (BUILD_NOTES §34, `references/S660-CAN-bus.md`). This is the
plan for the first **transmit** work: asking the car's modules for data with diagnostic requests,
the same thing any OBD-II scan tool does. Status: **stages 0–4 done, stage 6 pass A done** (2026-11-01). See "Results" at the end.

## What the research found

**No S660-specific diagnostic documentation was found online.** Not in English, not in Japanese. The
nearest documented car is the Honda **N-Box, 2nd generation**, a Honda kei car of the same era, which
openpilot supports. Its module addresses are the best available starting point.

**Two kinds of request:**

| Kind | What it is | How it is addressed |
|---|---|---|
| **Standard OBD-II** (SAE J1979: services 01, 03, 09…) | Emissions data every car must give: RPM, temperatures, throttle, fuel trims, fault codes, VIN | Broadcast request on **0x7DF** (11-bit) or **0x18DB33F1** (29-bit); the engine computer answers on 0x7E8 / 0x18DAF110 |
| **Honda-specific UDS** (ISO 14229, service 0x22 "read data by identifier") | What the dealer tool (HDS) reads: per-module data, part numbers | 29-bit, physical: **0x18DA`tt`F1** to module `tt`, reply on **0x18DAF1`tt`** (F1 = the tester) |

**Honda module addresses** (from openpilot's `opendbc/car/honda/fingerprints.py`; † = present in the
N-Box 2G entry):

| Module | Request ID | Notes |
|---|---|---|
| VSA (stability / ABS) | 0x18DA28F1 † | |
| EPS (power steering) | 0x18DA30F1 † | |
| SRS (airbags) | 0x18DA53F1 † | Read-only queries only (see the safety rules) |
| Gateway | 0x18DAEFF1 | On many Hondas; unknown on the S660 |
| Transmission | 0x18DA1EF1 | Automatics; probably absent on a manual |
| Radar / camera | 0x18DAB0F1 / 0x18DAB5F1 † | Honda Sensing. The S660 does not have it |
| Engine (PGM-FI) | **0x18DA10F1 (unconfirmed)** | Only a forum report (Acura TSX) says so, along with "Honda answers Mode 01 on 29-bit 0x18DB33F1". openpilot does not query the engine computer |

Version identifiers openpilot reads with service 0x22: **0xF181** (application software ID, which
returns a Honda part number such as `39990-TTA-J040`) and **0xF112** (Honda's alternative ID).

**Japanese OBD law (J-OBD II):** required for new models from October 2008, with ISO 15765-4 (CAN) as
the scan-tool link. The Ministry document lists ordinary and small cars; **whether it covers kei cars
was not confirmed**. So the S660 answering standard OBD-II requests is likely, but has to be tested.
Japanese OBD gauges (BLITZ, Comtec, Cellstar) sell S660-specific adapters, and Yupiteru says its
adapters cannot do Honda maker-specific settings. Both suggest that Honda data beyond the standard
needs Honda-specific requests.

## Safety rules for every transmit test

1. **The adapter only transmits on purpose.** The s660 firmware boots silent (`M1`). Transmitting
   needs `C`, `M0`, `O` sent by hand. `s660-can.service` refuses to start while the adapter is in `M0`
   (s660-can-check wants `M1`), so a test cannot leave the car's bus in normal mode by accident. End
   every session with `C` + `M1`, or unplug the adapter or switch the car off: power-up is silent.
2. **A whitelist of read-only services, enforced by the test tool, not by memory:**
   - Allowed: OBD-II **01** (current data), **02** (freeze frame), **03** / **07** / **0A** (read
     fault codes), **09** (vehicle info), and UDS **0x22** (read data by identifier) in the default
     session.
   - **Never:** 0x04 (clear fault codes, which also resets readiness monitors), 0x10 (session
     control), 0x11 (ECU reset), 0x14 (clear DTCs), 0x27 (security access), 0x2E (write data),
     0x2F (I/O control), 0x31 (routines), 0x34–0x37 (download/upload), 0x85 (DTC setting).
3. **Slow:** at most 10 requests per second, one outstanding request at a time.
4. **Parked first.** Ignition on, engine off, then idling. No transmit while driving until the
   parked stages have passed and you have agreed to it separately.
5. **Record everything:** a `candump -L` runs alongside every test, with step markers, as for the
   listening captures.
6. **Ask before each stage.** Announce what will be sent, and get your okay (the capture rule).

## Stages

| Stage | What | Car state | Done when |
|---|---|---|---|
| 0 | **Software.** Check the Pi kernel's `can-isotp` module and `isotpsend`/`isotprecv` (can-utils). Write `s660-diag`: a small Python tool with the whitelist built in, 11- and 29-bit, multi-frame (ISO-TP), logs every request and reply. Test it bench-only against a second interface (vcan) before the car. | Desk | The whitelist rejects every banned service in a unit test |
| 1 | **Does the engine computer answer?** One request, service 01 PID 00 (supported PIDs), first on 0x7DF, then on 0x18DB33F1. | Ignition on, engine off | We know which addressing the S660 uses |
| 2 | **What standard data exists.** PID bitmaps 0x00, 0x20, 0x40, 0x60…; service 09: VIN (02), calibration ID (04), ECU name (0A); service 03 / 07 / 0A: stored and pending fault codes. Read-only. | Ignition on, engine off | A table of supported PIDs and the car's identity in the reference |
| 3 | **Which Honda modules are fitted.** Service 0x22 0xF181 and 0xF112 to each address in the table above, plus 0x10 (engine) and the rest of 0x18DA00F1–0x18DAFFF1 at 2 requests per second. | Ignition on, engine off | A module list with part numbers |
| 4 | **Live standard data, idling.** Poll the supported PIDs, e.g. 0x04 load, 0x05 coolant, 0x06/07 fuel trims, 0x0B MAP, 0x0C RPM, 0x0E timing, 0x0F intake temp, 0x11 throttle, 0x14 O2, 0x42 module voltage, 0x46 ambient, and 0x5C oil temp if supported. Compare against the broadcast signals: this calibrates or explains unknowns such as 0x324 byte 5 and 0x221. | Engine idling, parked | Each PID read and cross-checked |
| 5 | **Drive logging (separate okay).** The same polling during a normal drive, slowly, beside the listen-only log. | Driving | Oil temperature, timing, trims etc. over a drive |
| 6 | **Honda-specific data (research).** A slow, read-only 0x22 identifier sweep on the engine computer and VSA, to find live values HDS can read but the bus does not broadcast. | Parked | A list of readable identifiers, decoded where possible |

## Stage 6 in detail — Honda identifier sweep

**Goal:** find which 2-byte data identifiers (DIDs) each module answers with service 0x22. Those
are the values the dealer tool (HDS) reads. Then decode the useful ones (stage 6c).

**How a reply is read:**

| Reply | Meaning | Kept |
|---|---|---|
| `62 hh ll …` | Positive: the DID exists, followed by its data | Yes, with the data |
| `7F 22 31` | Request out of range: no such DID (by far the most common) | Counted only |
| `7F 22 33` | Security access denied: the DID exists but is locked | Yes (never unlocked: 0x27 is banned) |
| `7F 22 22` | Conditions not correct: exists, but not readable now | Yes |
| `7F 22 78` | Response pending: wait for the real reply | Handled by the tool |
| Any other `7F 22 xx`, or no reply | Unexpected | Yes, and counted for the stop rules |

**Passes:**

| Pass | Modules | DIDs | Requests | Time at 10/s |
|---|---|---|---|---|
| **A — identification** | 0x10 engine, 0x28 VSA, 0x30 EPS, 0x60 cluster, 0x53 SRS | 0xF100–0xF1FF (the standard identification range: part numbers, dates, software versions) | 1,280 | ≈ 2.5 min |
| **B — engine, full range** | 0x10 | 0x0000–0xFFFF, minus 0xF1xx | 65,280 | ≈ 1 h 50 min |
| **C — cluster and VSA, full range** | 0x60, then 0x28 | the same | 65,280 each | ≈ 1 h 50 min each (another day) |

The SRS (airbags) gets pass A only. Its identification is harmless to read, but there is nothing in
it this project needs, so it gets no full sweep.

**Safety, on top of the general rules:**
- Service 0x22 only, default session, physical addressing, one request at a time, **≤ 10 per
  second**. The sweep refuses any other service (the same whitelist).
- **It runs as a systemd unit on the Pi**, so it continues if SSH drops. Its `ExecStopPost`
  always runs `session-stop`, so however the unit ends (finished, stopped, crashed), the adapter
  goes back to `M1`. If the Pi loses power, the adapter is silent at power-up anyway.
- **Resumable:** progress is saved after every DID. A pass can be stopped at any time and resumed.
- **Stop rules:** pause on 5 replies in a row that are neither positive nor `7F 22 31` (the module
  may be unhappy), or on 3 timeouts in a row from a module that was answering (it may have reset).
- **Before and after every pass:** read the fault codes (OBD 03 / 07) and check the broadcast
  frame rate, to show that nothing changed.
- Car state: ignition on, engine off, battery tender connected. If the ignition goes off, the Pi
  shuts down 4.5 min later and the adapter returns to silent.

**Then (stage 6c, another day):** poll the found DIDs while idling and revving, and correlate them
with the OBD PIDs and broadcast signals, as was done for 0x091 (yaw), to name them. First
targets: oil temperature (no OBD PID), knock retard, boost target, the cluster's average km/L
(0x221?), and the fuel used.

## Open questions

- Does the S660 answer 11-bit or 29-bit OBD requests? (Stage 1)
- Is the engine computer at 0x18DA10F1? (Stage 3)
- Is there a gateway between the OBD-II port and the modules? The listening captures saw every
  broadcast ID, so probably not, but diagnostic replies may differ.
- Do responses still come with the engine off? Most do with the ignition on.

## Sources

- [OBD-II PIDs (Wikipedia)](https://en.wikipedia.org/wiki/OBD-II_PIDs) and the [CSS Electronics
  OBD2 PID table](https://www.csselectronics.com/pages/obd2-pid-table-on-board-diagnostics-j1979):
  standard services, PIDs, 0x7DF / 0x7E8.
- [python-OBD command tables](https://python-obd.readthedocs.io/en/latest/Command%20Tables/): PID
  decoding formulas.
- [AutosportLabs forum, Honda Mode 01 on 29-bit](https://forum.autosportlabs.com/viewtopic.php?p=23633):
  0x18DB33F1 broadcast and 0x18DA10F1 engine computer (single user report, Acura TSX).
- [PEAK forum, 29-bit diagnostic IDs](https://forum.peak-system.com/viewtopic.php?p=4947) and
  [uds.readthedocs, diagnostics over CAN](https://uds.readthedocs.io/en/latest/pages/user_guide/can.html):
  the 0x18DA`TA``SA` scheme (ISO 15765).
- [commaai/opendbc, Honda fingerprints and values](https://github.com/commaai/opendbc/tree/master/opendbc/car/honda):
  module addresses, the N-Box 2G entry, the 0xF181 / 0xF112 queries.
- [comma panda UDS support](https://deepwiki.com/commaai/panda/7.1-uds-protocol-support) and a
  [UDS EPS query example](https://gist.github.com/gregjhogan/94598e642202824d6b47340adb9c581a):
  0x18DA30F1 is the EPS.
- [MLIT document on J-OBD II](https://www.mlit.go.jp/common/000134815.pdf): new models from 2008-10.
- [Yupiteru OBD2 adapter notes](https://www.yupiteru.co.jp/harness/obd2.pdf),
  [BLITZ adapter notice](https://www.blitz.co.jp/wp-content/uploads/2020/04/2020-0091.pdf): Japanese
  OBD gauges and Honda support.

## Results

### Stage 0 — tool (2026-11-01)
`s660-diag` (this folder). Bench test on a `vcan0` interface against a fake engine computer:
an 11-bit request padded to 8 bytes; a 29-bit request with a multi-frame reply (the kernel's
`can-isotp` sent the flow control); banned services (0x04, 0x2E) refused before anything reached
the bus. The Pi kernel has `can-isotp` and `vcan`, and can-utils has `isotpsend`/`isotprecv`.

### Stage 1 — first request (2026-11-01, ignition on, engine off, battery tender)
Exactly 2 frames sent (`2026-11-01-diag-stage1.log`/`.markers` on the Pi under `/persist/can/`):

| Sent | Reply |
|---|---|
| `7DF  02 01 00` (11-bit) | **none** |
| `18DB33F1  02 01 00` (29-bit) | `18DAF110  06 41 00 BE 3E A8 13 55`, from the engine computer only |

- **The S660 uses 29-bit OBD addressing.** Broadcast to 0x18DB33F1; the engine computer is
  **0x10** (it replies from 0x18DAF110), which confirms the forum's 0x18DA10F1. It answers with
  the engine off. It pads frames with 0x55.
- **Supported PIDs 01–20** (bitmap BE 3E A8 13): 01 monitor status, 03 fuel system status,
  04 engine load, 05 coolant temperature, 06/07 short/long-term fuel trim, 0B intake manifold
  pressure, 0C RPM, 0D speed, 0E timing advance, 0F intake air temperature, 11 throttle,
  13 O2 sensors present, 15 O2 sensor 2, 1C OBD standard, 1F run time since start,
  **20 = more PIDs (21–40) supported.** No MAF (PID 10): the engine meters air by manifold pressure.
- **A tool bug, found and fixed:** `session-stop` killed `slcand`, which left the channel open, so
  the mode check read streamed frames instead of `M1` and refused to restart the listen-only
  service (fail-safe). The adapter was then closed and set to `M1` by hand, and verified.
  Fix: `slcand -c` (it closes the channel on exit) plus a drain of the tty before the mode query.
  Verified with a request-free session start/stop.

### Stage 2 — identity and stored data (2026-11-01, ignition on, engine off)
All requests on 0x18DB33F1; every reply came from the engine computer (0x18DAF110).
Recordings `2026-11-01-diag-stage2*.log`/`.markers` on the Pi.

| Request | Reply |
|---|---|
| 01 20 | `80 05 B0 11`: 21 distance with MIL on, 2E commanded evap purge, 30 warm-ups since codes cleared, 31 distance since codes cleared, 33 barometric pressure, 34 O2 sensor 1 (wide-range, lambda + current), 3C catalyst temperature B1S1, 40 = more |
| 01 40 | `7A D0 80 00`: 42 control module voltage, 43 absolute load, 44 commanded lambda, 45 relative throttle, 47 throttle B, 49 / 4A accelerator pedal D / E, 4C commanded throttle actuator, 51 fuel type. **Nothing above 0x60**, so no oil temperature (5C) and no ambient (46) |
| 09 00 | `54 40 00 00`: service 09 PIDs 02 (VIN), 04 (calibration ID), 06 (CVN), 0A (ECU name) |
| 09 02 | Japanese frame number `JW5-…` (11 characters, not a 17-character VIN; kept out of the repo) |
| 09 04 | Calibration ID **`37805-5JA-N040`** (the PGM-FI software part number) |
| 09 0A | **`ECM-EngineControl`** |
| 03 / 07 | `43 00` / `47 00`: **no stored and no pending fault codes** |
| 0A | No reply: permanent fault codes are not supported |

A script slip stopped the PID chain after 01 20; 01 40 was sent in a second short session
(`stage2b`). The adapter was verified back in `M1` after both sessions.

**For the app:** live data the bus does not broadcast includes ignition timing (0E), fuel trims
(06/07), engine load (04/43), commanded lambda (44), the wide-band O2 sensor (34), catalyst
temperature (3C), barometric pressure (33) and module voltage (42).

### Stage 3 — which Honda modules are fitted (2026-11-01, ignition on, engine off)
UDS 0x22 0xF181 and 0xF112, default session, to 10 addresses (20 requests). Recording
`2026-11-01-diag-stage3.log`/`.markers` on the Pi. **TDJ** is Honda's model code for the S660.

| Address | Module | 0xF181 (software part number) | 0xF112 |
|---|---|---|---|
| **0x10** | Engine (PGM-FI) | `37805-5JA-N040` | serial-like string |
| **0x28** | VSA | `57114-TDJ-9210` | serial-like string |
| **0x30** | EPS | `39990-TDJ-N010` | serial-like string |
| **0x53** | SRS | `77959-TDJ-J620` | serial-like string |
| **0x60** | Probably the instrument cluster | `7F 22 31` (request out of range) | serial-like string |
| 0x1E, 0x61, 0xEF, 0xB0, 0xB5 | Transmission, HUD, gateway, radar, camera | no reply | no reply |

The 0xF112 values look like unit serial numbers, so they stay out of the repo (they are in the
Pi's `/persist/can/diag.jsonl`). No gateway answered, which agrees with the listening captures:
the OBD-II port is on the modules' own bus. The rest of 0x00–0xFF has not been swept yet.

### Stage 4 — live data at idle (2026-11-01, cold start, garage open)
24 PIDs polled for 90 s plus 8 read once: **848 requests, every one answered**, about 9 per
second (`2026-11-01-diag-stage4.log`/`.markers` on the Pi). Engine started about 26 s before the poll.

| PID | Value over the 90 s | Note |
|---|---|---|
| 01 status | `00 07 E1 00` | Check-engine light off, 0 codes, readiness monitors complete |
| 03 fuel system | `02` | Closed loop |
| 1C OBD standard | `0A` | **JOBD** (Japanese OBD) |
| 51 fuel type | `01` | Gasoline |
| 21 / 30 / 31 | 0 km / 28 / 1,287 km | Distance with MIL on / warm-ups / distance since codes were last cleared |
| 0C RPM | 1,307 → 1,151 | Fast idle settling |
| 05 coolant | 48 → 59 °C | Warming |
| 0F intake air | 40–41 °C | |
| 3C catalyst (B1S1) | 80 → 143 °C | Warming |
| 0E timing | −5 → +15.5° | Retarded at first (catalyst heating), then advancing |
| 06 / 07 fuel trim | −5.5 → −3.9 % / +2.3 % | |
| 34 / 44 lambda (actual / commanded) | 0.98–1.01 / 0.98–1.00 | Stoichiometric |
| 15 O2 sensor 2 | 0.10–0.77 V | Post-catalyst |
| 0B MAP / 33 baro | 33–46 kPa / 100 kPa | |
| 04 / 43 load | 25–33 % / 32–44 % | |
| 11 / 45 / 47 / 4C throttle | 15–16 / 4–6 / 32–33 / 5–7 % | |
| 49 / 4A pedal D / E | 18.8 / 9.4 % | Constant: sensor offsets with the pedal released |
| 42 module voltage | 14.34–14.47 V | Alternator charging |
| 2E evap purge | 0 % | |

### Stage 6 pass A — identification range (2026-11-01, ignition on, engine off)
0x22 for 0xF100–0xF1FF on modules 0x10, 0x28, 0x30, 0x60 and 0x53: 1,280 requests, run as
`s660-diag-passA` (a systemd unit whose `ExecStopPost` is `session-stop`). No timeouts and no
unexpected replies. Fault codes (03 / 07) were none before and none after. The broadcast rate was
1,447 frames/s before and 1,448 after. The adapter was verified back in `M1`.

Each module answers 3–5 identifiers: **0xF100** (4 bytes; `FF FF 01 01` on the engine, zeros on
the others), **0xF110** (hardware assembly part number + revision), **0xF112** (serial-like, kept
out of the repo), **0xF181** (software part number; not on 0x60), and **0xF190** (frame number,
engine only, kept out of the repo).

| Module | 0xF110 (assembly) | 0xF181 (software) |
|---|---|---|
| 0x10 engine | `37820-5JA-N041` M1 | `37805-5JA-N040` |
| 0x28 VSA | `57110-TDJ-9210` M1 | `57114-TDJ-9210` |
| 0x30 EPS | `53200-TDJ-J13` | `39990-TDJ-N010` |
| **0x60** | **`78100-TDJ-N320` M1: Honda 78100 is the combination meter**, so 0x60 is confirmed as the instrument cluster | — |
| 0x53 SRS | `77960-TDJ-J611` M2 | `77959-TDJ-J620` |

### Stage 6 pass C — instrument cluster 0x60, 0x0000–0xFFFF (2026-11-01, finished 2026-11-02)
Fault codes none before. **Paused at 0xE9EF** by stopping the unit (`ExecStopPost` put the adapter back
in `M1`, verified): the battery fell from 12.41 V to 11.87 V over 1 h 40 min with the ignition on and a
maintenance-mode tender, which **did not keep up** with the ignition-on load. 0xE9F0–0xFFFF are still to do
(about 10 min). Resume with `s660-diag sweep 60 0000 FFFF --skip-f1` (state in
`/persist/can/sweep-60-0000-FFFF.state`). Dash at the start (`2026-11-01-dash.json`): odometer 44,697 km,
trip A 3,556.6 km at 15.2 km/L, trip B 1,213.6 km at 15.7 km/L, range 329 km.

23 identifiers answered, 1 locked (0x7090, `7F 22 33`). All but two are in **0x7000–0x70FF**. First matches:

| DID | What was found |
|---|---|
| **0x7022** | Bytes 6–8 = **44,697**, the odometer (km) exactly as on the dash |
| **0x702A** | Bytes 14–15 = **329**, the range (km) exactly as on the dash. Before it: 141, 141, 137, 233 (unknown; 14.1 / 13.7 km/L?) |
| **0xE600** | `2E D6` = 11,990: the battery voltage in mV (11.99 V when it was read; the PID 0x42 watch read 11.96–12.00 V then) |
| 0x7000 | Contains `155TDJ` (ASCII) |
| others | Mostly constant bytes; still to decode |

Trip A / B distances and averages were not found as plain 16-bit values: they may use another unit or
encoding; they are not in the part swept on 2026-11-02 either.

**Finished 2026-11-02** (`2026-11-02-diag-passC60b.log`): resumed at 0xE9F0 and ran to 0xFFFF (minus 0xF1xx)
in about 10 min. **No more identifiers answered**: all 5,392 were "out of range". Battery 12.66 V → 12.56 V
(rested overnight; the watch would have stopped the sweep at 12.1 V). No fault codes before or after; the
adapter was back in `M1` at the end. **Pass C is complete: 23 identifiers, all listed in the sweep's
`.jsonl`.**

### Set-up for stage 5 and pass B (2026-11-02)
On the Pi under `/persist/can/bin/` (repo copies in `hardware/can/`), units in `/etc/systemd/system/`:
- **`s660-diag`** gained `sweep … --min-mv MV --max-minutes N` (every 256 DIDs it reads OBD 01 42; it pauses
  below MV or after N minutes, resumable) and `poll RATE PID…` (stage 5). **Bug found on the bench before use:**
  the engine answers the voltage check and the sweep from the same address (0x18DAF110), so the sweep's
  socket also got the voltage reply and would have read every later DID one late. The socket is now drained
  after each check. Bench test on vcan with a stand-in responder: pauses at 12.03 V, resumes, time limit,
  DID 0x0123 found with nothing misread.
- **`s660-drive-poll.service`** (enabled): runs only if `/persist/can/arm-drive-poll` exists, and removes it,
  so it covers **one drive per arming**. Waits for can0, opens a session, reads fault codes, then polls 15
  PIDs (04 05 06 07 0B 0C 0D 0E 0F 11 34 3C 42 43 44) at 5 per second beside a `candump -L any` recording,
  `/persist/can/DATE-drive-poll.{jsonl,log}`. Ignition off → shutdown → `ExecStopPost` session-stop.
- **`s660-diag-passB.service`**: one 45-minute piece of pass B (engine 0x10, 0x0000–0xFFFF minus 0xF1xx),
  stopping below 12.1 V; `systemctl start` it again for the next piece.
- **`s660-cluster-read LABEL`**: re-reads the cluster's 23 identifiers into `/persist/can/cluster-LABEL.jsonl`,
  for before / after comparisons (trip and range values change with a drive).

### Errand, 2026-11-02 — stage 5 drive poll and the cluster before / after
**Drive poll:** two of three legs recorded (`2026-11-02-1101-drive-poll`, out, up to 139 km/h; `-1115`, a short
hop). **The third leg, home with the two roundabout loops, was not:** the arming covered one more boot, and the
errand had three ignition cycles. Fix before the next drive: arm for a time window, not a number of boots.
3,559 of 4,446 requests answered (the rest with the engine computer off around ignition cycles). Fault codes
none before each leg. Ranges: load 0–100 %, coolant 45–95 °C, STFT −10 to +17 %, LTFT +1.6 to +3.1 %,
**MAP 22–182 kPa (about +0.8 bar boost)**, rpm to 5,181, timing −14 to +44°, intake 25–47 °C, lambda 0.7–2.0
(2.0 = fuel cut on the overrun), catalyst to 818 °C, 10.0–14.5 V (10.0 while cranking). Every leg's
`session-stop` confirmed `M1` before shutdown refused its "start s660-can" (harmless; to tidy).

**Cluster 0x702A decoded** (dash before → after: range 328 → 343 km, odometer 44,697 → 44,713, trip A 3,556.6 → 3,572.3, trip B 1,213.6 → 1,229.2):

| Data bytes | Before | After | Meaning |
|---|---|---|---|
| 7–8, 9–10 | 141, 141 | 152, 152 | **km/L × 10 used for the range** |
| 11–12 | 135 | 141 | Another km/L × 10 (the previous value of the above?) |
| 13–14 | 233 | 225 | **Fuel left, L × 10** (−0.8 L for 16 km of mostly dual carriageway) |
| 15–16 | 329 | 343 | **Range, km = fuel × km/L**: 22.5 × 15.2 = 342; 23.3 × 14.1 = 329 |

0x7022 bytes 6–8 followed the odometer (44,697 → 44,713). **Trip A / B are not in any readable identifier**
(trip B +15.6 km changed nothing that matches; maybe the locked 0x7090). 0x7028 data bytes 15 and 17
went 23 → 26 and 23 → 24 (counters?); 0x7020 changed four flag bits.

**Lateral G (0x1EA bytes 0–1), provisional:** steady turns in the first leg give about **0.012 m/s² per count**
(0.008–0.025 between turns; road camber and the sensor's dead band), **positive raw = turning left**. That is
about 7 × the scale assumed so far (0.00169), so the panel's lateral G currently reads far too low. Needs the
roundabout loops to confirm.
