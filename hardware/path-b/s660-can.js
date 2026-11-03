// The CAN service behind GET /api/vehicle: decodes the S660's broadcast frames into the
// VehicleData shape (carplay-web-app/src/vehicle.ts). Loaded by s660-api.js. No npm deps.
//
// It only listens. `candump` (can-utils) reads can0, the listen-only interface that
// s660-can.service brings up from the CANable's silent firmware (BUILD_NOTES §34). candump starts
// on the first request and stops after IDLE_STOP_MS without one, so the bus costs nothing while
// the Vehicle panel and Settings > Status are closed. Signal layouts, scalings and how each was
// checked on the car: references/S660-CAN-bus.md.
'use strict'
const { spawn } = require('child_process')

const IFACE = process.env.S660_CAN_IFACE || 'can0'
const IDLE_STOP_MS = 10000 // stop candump this long after the last request
const STALE_MS = 1000 // a value older than this is null ("--"), never a stale number
const RESPAWN_MS = 2000 // at most one candump start per this long (no can0 = it exits at once)

// Only the IDs the panel needs, so candump hands Node a fraction of the ~1,450 frames/s.
const IDS = [0x091, 0x13c, 0x156, 0x158, 0x17c, 0x18b, 0x1a4, 0x1a6, 0x1ab, 0x1b0, 0x1d0, 0x1dc, 0x1ea, 0x21e, 0x294, 0x305, 0x309, 0x324]

// Measured rpm per km/h (0x1DC / 0x158) with the clutch up, 2026-11-01 drive. 5th was seen only briefly.
const GEAR_RATIOS = [158.5, 99, 68, 51, 40, 30.5]
// 4 %, and no wait for the clutch switch: on the 2026-11-03 drive the ratio matched the new gear a median 0.6 s
// before the switch said "up" (it sits at the top of the pedal's travel). With the pedal down a ratio only counts
// above CLUTCH_DOWN_MIN_RPM, so coasting in neutral at idle does not read as a gear. Same wrong-gear count as the
// old rule (6 %, clutch up only) on that drive's 30 shifts, about 0.7 s sooner.
const GEAR_TOLERANCE = 0.04
const CLUTCH_DOWN_MIN_RPM = 1100
const G = 9.81
const LONG_G_PER_COUNT = 0.00169 / G // 0x1EA bytes 2-3, measured
// Lateral G is speed x yaw rate: 0x1EA bytes 0-1 read zero inside about ±1.5 m/s² and are not proportional
// outside it (references/S660-diagnostics.md, S660-CAN-bus.md 0x1EA). + = pushed left; + yaw (0x091) is a right turn, per the GPS heading.
const YAW_DEG_PER_COUNT = 0.0037 // 0x091 bytes 0-1, against the wheel speeds (±5 %); the GPS heading gave 0.00406
const YAW_REST = 0x8022 // 0x091 at a standstill
const MMHG_TO_BAR = 0.00133322
// Driver's brake pressure, 0x1A4 bytes 0-1: the sheet's points (raw -> MPa). Zero up to 106: at rest our car
// reads 101-105, which would otherwise show as 0.1-0.2 MPa with no foot on the pedal.
const BRAKE_POINTS = [[106, 0], [123, 1], [165, 2], [207, 3], [249, 4], [290, 5], [496, 10]]

const s16 = v => (v >= 0x8000 ? v - 0x10000 : v)
const be16 = (d, i) => (d[i] << 8) | d[i + 1]
const bit = (byte, n) => ((byte >> n) & 1) === 1

const interp = (points, x) => {
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    if (x <= x1) return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0)
  }
  const [xa, ya] = points[points.length - 2]
  const [xb, yb] = points[points.length - 1]
  return yb + ((x - xb) * (yb - ya)) / (xb - xa)
}

const wheels = d => {
  const w = d.readBigUInt64BE(0)
  const at = s => Number((w >> BigInt(s)) & 0x7fffn) / 100
  return { fl: at(49), fr: at(34), rl: at(19), rr: at(4) } // measured order FL, FR, RL, RR
}

// -(speed x yaw rate) / g from 0x091 and the four wheel speeds; null without either.
const latG = (yawFrame, w) => {
  if (!yawFrame || !w) return null
  const v = (w.fl + w.fr + w.rl + w.rr) / 4 / 3.6
  return -(v * (((be16(yawFrame, 0) - YAW_REST) * YAW_DEG_PER_COUNT * Math.PI) / 180)) / G
}

const estimateGear = (rpm, transKmh, clutchUp) => {
  if (transKmh < 5 || rpm < 800 || (!clutchUp && rpm <= CLUTCH_DOWN_MIN_RPM)) return null
  const r = rpm / transKmh
  let best = null
  GEAR_RATIOS.forEach((g, i) => {
    const err = Math.abs(r - g) / g
    if (err <= GEAR_TOLERANCE && (best === null || err < best.err)) best = { gear: i + 1, err }
  })
  return best && best.gear
}

// frames: Map<id, { data: Buffer, at: ms }>. atmMmHg: manifold pressure seen with the engine
// stopped (the atmosphere), or null for the 760 mmHg standard. Every field is null when its frame
// is missing or stale.
const decode = (frames, now, atmMmHg = null) => {
  const get = id => {
    const f = frames.get(id)
    return f && now - f.at <= STALE_MS ? f.data : null
  }
  const f = Object.fromEntries(IDS.map(id => [id, get(id)]))
  const live = IDS.some(id => f[id] !== null)
  const pick = (id, fn) => (f[id] ? fn(f[id]) : null)

  const speedKmh = pick(0x309, d => be16(d, 0) / 100)
  const rpm = pick(0x1dc, d => be16(d, 1))
  const transKmh = pick(0x158, d => be16(d, 0) / 100)
  const clutchUp = pick(0x13c, d => bit(d[6], 2)) // byte 6 bit 2 on our car (the sheet says bit 5)
  const reverse = pick(0x1a6, d => bit(d[2], 2))
  let gear = null
  if (reverse) gear = 'R'
  else if (rpm !== null && transKmh !== null && clutchUp !== null) gear = estimateGear(rpm, transKmh, clutchUp)

  return {
    live,
    speedKmh,
    rpm,
    gear,
    throttlePct: pick(0x13c, d => (d[4] * 100) / 255), // accelerator pedal
    brakeMpa: pick(0x1a4, d => Math.max(0, interp(BRAKE_POINTS, be16(d, 0)))),
    boostBar: pick(0x18b, d => (be16(d, 0) / 10 - (atmMmHg ?? 760)) * MMHG_TO_BAR),
    coolantC: pick(0x324, d => d[0] - 40),
    intakeC: pick(0x324, d => d[1] - 40),
    outsideC: pick(0x21e, d => d[3] - 40),
    fuelPct: pick(0x1a6, d => Math.max(0, Math.min(100, d[3] - 5))), // raw 5 = empty, 105 = full
    odometerKm: pick(0x294, d => (d[3] << 16) | (d[4] << 8) | d[5]),
    // Warning lamps as broadcast (references/S660-CAN-bus.md 0x324, checked 2026-11-02). All are lit with the
    // engine stopped (the dash's bulb check) and clear at engine start. lampA / lampB are oil pressure and
    // charging, in an order not yet known; the sheet's "oil" bit (byte 6 bit 0) was never set, so it is not used.
    lamps: pick(0x324, d => ({ engine: bit(d[6], 1), lampA: bit(d[6], 2), lampB: bit(d[6], 3), eps: bit(d[7], 7) })),
    coolantLamp: pick(0x294, d => bit(d[0], 1)), // "Coolant temperature warning lamp?" in the sheet
    blowOff: pick(0x324, d => bit(d[6], 7)),
    torqueEst: pick(0x13c, d => s16(be16(d, 0))), // raw, unit unknown; -1 for 2-3 s after lifting off
    torqueReq: pick(0x13c, d => s16(be16(d, 2))),
    steeringDeg: pick(0x156, d => s16(be16(d, 0)) / 10),
    yawDegPerS: pick(0x091, d => (be16(d, 0) - YAW_REST) * YAW_DEG_PER_COUNT),
    latG: latG(f[0x091], f[0x1d0] ? wheels(f[0x1d0]) : null),
    longG: pick(0x1ea, d => s16(be16(d, 2)) * LONG_G_PER_COUNT),
    wheelKmh: pick(0x1d0, wheels),
    clutchUp,
    brakePedal: pick(0x17c, d => bit(d[6], 5)),
    handbrake: pick(0x1a6, d => bit(d[0], 2)),
    reverse,
    headlights: pick(0x1a6, d => d[0] & 3),
    indicators: pick(0x294, d => ({ left: bit(d[0], 5), right: bit(d[0], 6) })),
    wipers: pick(0x294, d => (d[0] >> 3) & 3),
    belts: pick(0x305, d => ({ driver: bit(d[1], 5), passenger: bit(d[1], 3) })), // sheet only, unchecked
    vsa: pick(0x1a4, d => ({
      lamp: bit(d[3], 5),
      unavailable: bit(d[3], 4),
      active: bit(d[2], 0), // VSA braking (AHA or TCS)
      abs: bit(d[2], 1), // ABS-style intervention (inferred in the sheet)
      agile: bit(d[4], 7), // torque-vectoring-style braking, pedal released (Agile Handling Assist)
    })),
    vsaOffButton: pick(0x1a6, d => bit(d[0], 5)), // only while the VSA OFF button is held
    brakeHold: pick(0x1b0, d => bit(d[0], 0)), // hill start / brake hold (not verified)
    brakeError: pick(0x1b0, d => bit(d[1], 3) || bit(d[1], 1)),
    epsDisabled: pick(0x1ab, d => bit(d[2], 6)),
  }
}

// Engine data from the drive recorder's OBD poll (hardware/can/s660-drive-log, its status file), only
// while Drive recording is on "Listen + engine data". Keys are the requests as s660-diag prints them.
const OBD_FRESH_S = 10
const SLOW_FRESH_S = 30 // fault codes and the cluster, asked once a cycle
const u16 = (b, i) => b[i] * 256 + b[i + 1]

// OBD fault codes from a 43/47 reply: [43, count, A, B, A, B...] -> ['P0301', ...]
const dtcList = b =>
  Array.from({ length: Math.floor((b.length - 2) / 2) }, (_, i) => [b[2 + i * 2], b[3 + i * 2]])
    .filter(([a, c]) => a || c)
    .map(([a, c]) => 'PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + c.toString(16).toUpperCase().padStart(2, '0'))

const engineData = (st, now) => {
  const obd = st && st.engine ? st.obd || {} : {}
  const get = (key, age = OBD_FRESH_S) => {
    const o = obd[key]
    return o && now - o.t <= age ? o.hex.split(' ').map(h => parseInt(h, 16)) : null
  }
  const pid = (p, fn) => {
    const b = get(`01 ${p}`)
    return b ? fn(b.slice(2)) : null
  }
  const codes = svc => {
    const b = get(svc, SLOW_FRESH_S)
    return b ? dtcList(b) : null
  }
  const cl = get('22 70 2a', SLOW_FRESH_S) // cluster 0x60 DID 0x702A: data starts at byte 3
  return {
    engineData: !!(st && st.engine),
    mil: pid('01', b => ({ on: (b[0] & 0x80) !== 0, count: b[0] & 0x7f })),
    dtcStored: codes('03'),
    dtcPending: codes('07'),
    timingDeg: pid('0e', b => b[0] / 2 - 64),
    lambda: pid('34', b => (u16(b, 0) * 2) / 65536),
    lambdaCmd: pid('44', b => (u16(b, 0) * 2) / 65536),
    stftPct: pid('06', b => ((b[0] - 128) * 100) / 128),
    ltftPct: pid('07', b => ((b[0] - 128) * 100) / 128),
    loadPct: pid('04', b => (b[0] * 100) / 255),
    absLoadPct: pid('43', b => (u16(b, 0) * 100) / 255),
    throttlePlatePct: pid('11', b => (b[0] * 100) / 255),
    catalystC: pid('3c', b => u16(b, 0) / 10 - 40),
    rangeKm: cl && cl.length >= 19 ? u16(cl, 17) : null,
    fuelL: cl && cl.length >= 17 ? u16(cl, 15) / 10 : null,
    rangeKmPerL: cl && cl.length >= 11 ? u16(cl, 9) / 10 : null,
  }
}

// "(1793556369.079898) can0 13C#FFFDFFFD0000043D" -> [0x13C, Buffer]
const parseLine = line => {
  const m = /\) \S+ ([0-9A-F]{3})#([0-9A-F]*)$/.exec(line)
  return m ? [parseInt(m[1], 16), Buffer.from(m[2], 'hex')] : null
}

const createVehicle = ({ iface = IFACE, spawnFn = spawn, clock = Date.now } = {}) => {
  const frames = new Map()
  let child = null
  let lastRequest = 0
  let lastSpawn = -Infinity
  let atmMmHg = null
  let idleTimer = null

  const stop = () => {
    if (child) child.kill('SIGTERM')
    child = null
    frames.clear()
  }

  const start = () => {
    if (child || clock() - lastSpawn < RESPAWN_MS) return
    lastSpawn = clock()
    const filters = IDS.map(id => `${id.toString(16).toUpperCase()}:7FF`).join(',')
    const c = spawnFn('candump', ['-L', `${iface},${filters}`], { stdio: ['ignore', 'pipe', 'ignore'] })
    child = c
    let buf = ''
    c.stdout.on('data', chunk => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop()
      const now = clock()
      for (const line of lines) {
        const p = parseLine(line)
        if (!p) continue
        frames.set(p[0], { data: p[1], at: now })
        // Engine stopped: the manifold sees the atmosphere, the zero for boost.
        if (p[0] === 0x18b) {
          const rpmFrame = frames.get(0x1dc)
          if (rpmFrame && now - rpmFrame.at <= STALE_MS && be16(rpmFrame.data, 1) === 0) atmMmHg = be16(p[1], 0) / 10
        }
      }
    })
    c.on('exit', () => {
      if (child === c) child = null
    })
    c.on('error', () => {
      if (child === c) child = null
    })
  }

  const snapshot = () => {
    lastRequest = clock()
    start()
    if (!idleTimer) {
      idleTimer = setInterval(() => {
        if (clock() - lastRequest > IDLE_STOP_MS) {
          stop()
          clearInterval(idleTimer)
          idleTimer = null
        }
      }, 1000)
      idleTimer.unref()
    }
    return decode(frames, clock(), atmMmHg)
  }

  return { snapshot, stop, running: () => child !== null }
}

module.exports = { createVehicle, decode, parseLine, estimateGear, engineData, dtcList, IDS }
