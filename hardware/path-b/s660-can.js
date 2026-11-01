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
const IDS = [0x091, 0x13c, 0x156, 0x158, 0x17c, 0x18b, 0x1a4, 0x1a6, 0x1d0, 0x1dc, 0x1ea, 0x21e, 0x294, 0x305, 0x309, 0x324]

// Measured rpm per km/h (0x1DC / 0x158) with the clutch up, 2026-11-01 drive. 5th was seen only briefly.
const GEAR_RATIOS = [158.5, 99, 68, 51, 40, 30.5]
const GEAR_TOLERANCE = 0.06
const G = 9.81
const LONG_G_PER_COUNT = 0.00169 / G // 0x1EA bytes 2-3, measured
const LAT_G_PER_COUNT = 0.00169 / G // 0x1EA bytes 0-1: same sensor, scale assumed (reference: "unconfirmed")
const YAW_DEG_PER_COUNT = 0.0037 // 0x091 bytes 0-1, measured against the wheel speeds (±5 %)
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

const estimateGear = (rpm, transKmh, clutchUp) => {
  if (!clutchUp || transKmh < 5 || rpm < 800) return null
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
    // The sheet's guesses ("Engine alert?", "OIL alert?", "EPS alert?"); never seen set on our car.
    alerts: pick(0x324, d => ({ engine: bit(d[6], 1), oil: bit(d[6], 0), eps: bit(d[7], 7) })),
    steeringDeg: pick(0x156, d => s16(be16(d, 0)) / 10),
    yawDegPerS: pick(0x091, d => (be16(d, 0) - 0x8000) * YAW_DEG_PER_COUNT),
    latG: pick(0x1ea, d => s16(be16(d, 0)) * LAT_G_PER_COUNT),
    longG: pick(0x1ea, d => s16(be16(d, 2)) * LONG_G_PER_COUNT),
    wheelKmh: pick(0x1d0, d => {
      const w = d.readBigUInt64BE(0)
      const at = s => Number((w >> BigInt(s)) & 0x7fffn) / 100
      return { fl: at(49), fr: at(34), rl: at(19), rr: at(4) } // measured order FL, FR, RL, RR
    }),
    clutchUp,
    brakePedal: pick(0x17c, d => bit(d[6], 5)),
    handbrake: pick(0x1a6, d => bit(d[0], 2)),
    reverse,
    headlights: pick(0x1a6, d => d[0] & 3),
    indicators: pick(0x294, d => ({ left: bit(d[0], 5), right: bit(d[0], 6) })),
    wipers: pick(0x294, d => (d[0] >> 3) & 3),
    belts: pick(0x305, d => ({ driver: bit(d[1], 5), passenger: bit(d[1], 3) })), // sheet only, unchecked
    vsa: pick(0x1a4, d => ({ lamp: bit(d[3], 5), unavailable: bit(d[3], 4), active: bit(d[2], 0) })),
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

module.exports = { createVehicle, decode, parseLine, estimateGear, IDS }
