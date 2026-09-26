# Honda OPERA — audio switch panel ↔ audio unit (S660, 2015+)

Everything known about the serial link between the centre-console audio switch panel and the
audio unit, as reverse-engineered on this car on 2026-09-26. No public documentation of
"OPERA" was found (English or Japanese); all of this comes from captures, which are in
`captures/`. The narrative of how it was worked out is in `hardware/BUILD_NOTES.md` §30.

## Physical layer

| | |
|---|---|
| Wires | panel pin 1 **OPERA TX** (panel → unit), pin 2 **OPERA RX** (unit → panel), pin 12 **OPERA CONT**, pin 9 GND. Schematics p.41/47. |
| Levels | 5 V logic. TX and RX are held at 5 V by the **audio unit**; the panel only pulls low (open-drain style). |
| UART | **19200 baud, 8 data bits, no parity, 1 stop bit**, idle high. |
| CONT | ~10.2–11 V (battery level), on with the car on *and* off. Not yet seen to change. Purpose unknown. |
| PWR SW | pin 3: **not part of OPERA**. Plain switch to ground, 5 V pull-up (~9 kΩ) in the audio unit, 0 V with the car off. The unit senses *load* on it — a 25 kΩ divider reads as "pressed". |
| RX | Has **never** carried a byte in ~5 min of captures, including at ACC-on and during every control. |
| Car on | RX (and PWR SW) rise to 5 V at ACC-on — usable as an "audio unit is powered" signal. |

## Framing

```
10 02   LEN   PAYLOAD[LEN]   10 03   CK
DLE STX                       DLE ETX
```

- `LEN` = number of payload bytes.
- `PAYLOAD[0]` = message type.
- `CK` = XOR of every byte from `LEN` up to and including `ETX` (`LEN ^ PAYLOAD… ^ 0x10 ^ 0x03`).
- **DLE stuffing unknown**: no payload byte of `0x10` has occurred yet. If a `0x10` inside a
  payload is ever seen, check whether it arrives doubled.
- Bytes within a frame are sent back-to-back; ~0.5 ms gaps between bytes are normal.

## Messages (panel → audio unit)

### 0x42 — knob rotation (LEN = 2)

| Frame | Meaning |
|---|---|
| `10 02 02 42 0A 10 03 59` | one click **clockwise** |
| `10 02 02 42 0B 10 03 58` | one click **anticlockwise** |

One frame per click, no release, no repeat.

### 0x41 — key state report (LEN = 7)

`41` followed by **three big-endian 16-bit key slots**. Lists every key currently held
(`0000` = empty slot). Behaviour:

- sent on any change (press or release);
- **repeated every 192 ms** while at least one key is held;
- an all-zero report is sent when the last key is released.

| Frame | Meaning |
|---|---|
| `10 02 07 41 00 6E 00 00 00 00 10 03 3B` | **knob push** held (`0x006E`) |
| `10 02 07 41 00 6C 00 00 00 00 10 03 39` | **Back** held (`0x006C`) |
| `10 02 07 41 00 6B 00 00 00 00 10 03 3E` | **Mode** held (`0x006B`) |
| `10 02 07 41 00 AA 00 00 00 00 10 03 FF` | **Phone** held (`0x00AA`) |
| `10 02 07 41 00 6C 00 6E 00 00 10 03 57` | Back **and** knob push held |
| `10 02 07 41 00 00 00 00 00 00 10 03 55` | nothing held (release) |

Key codes seen so far:

| Code | Control |
|---|---|
| `0x006B` | Mode |
| `0x006C` | Back |
| `0x006E` | Knob push |
| `0x00AA` | Phone |

Power is **not** a key code — it's the separate PWR SW wire. Steering-wheel buttons (Input,
Mode, volume) are a resistor ladder into the audio unit and never appear on OPERA.

## Other observations

- A lone `55` byte appeared on TX once, 10 s after ACC-on, outside any frame. Possibly a sync
  or heartbeat. Seen once in 120 s; harmless to a resync-capable parser.
- Typical timings: press → release ≈ 150–250 ms for a tap; repeat period 192 ms; a two-key
  chord arrives as separate reports ~200 ms apart (first key, both keys, first key, none).

## Not yet known

1. Whether the audio unit ever sends anything on RX (power-up, illumination, mode changes).
2. What OPERA CONT does.
3. DLE stuffing.
4. Whether the unit needs the periodic key report to keep treating a key as held (i.e. what
   happens if repeats stop without a release — the interceptor sends an explicit release when
   it takes over, to be safe).
5. Whether a long press of Power on the audio unit's side does anything (matters for the
   3-second reboot hold, which currently also reaches the unit).
