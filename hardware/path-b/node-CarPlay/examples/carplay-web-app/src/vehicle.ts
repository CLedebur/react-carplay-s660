// What the Vehicle panel shows, as GET /api/vehicle must answer it (the CAN service decodes it:
// references/S660-CAN-bus.md). Everything is in physical units, and a value is null when its CAN
// message has not been seen lately (ignition off, no adapter), so the panel shows "--" and never a
// stale number. The panel only reads: nothing here is ever sent to the car.
export type Gear = 'R' | 1 | 2 | 3 | 4 | 5 | 6

export interface VehicleData {
  live: boolean // frames are arriving; false while the bus is silent
  // drive
  speedKmh: number | null // the speedometer's value (0x309), the one the dash shows
  rpm: number | null
  gear: Gear | null // estimated from rpm / speed with the clutch up; null = neutral, clutch in, or unknown
  throttlePct: number | null // 0-100
  brakeMpa: number | null // driver's brake pressure
  boostBar: number | null // manifold pressure relative to the atmosphere; negative = vacuum
  // engine
  coolantC: number | null
  intakeC: number | null
  outsideC: number | null
  fuelPct: number | null // 0-100
  odometerKm: number | null
  alerts: { engine: boolean; oil: boolean; eps: boolean } | null // the car's own warning bits
  // dynamics
  steeringDeg: number | null // + = right
  yawDegPerS: number | null // + = turning right
  latG: number | null // + = the car is being pushed LEFT (a left turn)
  longG: number | null // + = accelerating, - = braking
  wheelKmh: { fl: number; fr: number; rl: number; rr: number } | null
  // body
  clutchUp: boolean | null // true = pedal released
  brakePedal: boolean | null
  handbrake: boolean | null
  reverse: boolean | null
  headlights: 0 | 1 | 2 | 3 | null // off, parking, low beam, high beam
  indicators: { left: boolean; right: boolean } | null
  wipers: 0 | 1 | 2 | 3 | null // off, intermittent, low, high
  belts: { driver: boolean; passenger: boolean } | null // true = buckled
  vsa: { lamp: boolean; unavailable: boolean; active: boolean } | null
}

export const HEADLIGHTS = ['OFF', 'PARKING', 'LOW BEAM', 'HIGH BEAM'] as const
export const WIPERS = ['OFF', 'INTERVAL', 'LOW', 'HIGH'] as const

export const emptyVehicle: VehicleData = {
  live: false,
  speedKmh: null, rpm: null, gear: null, throttlePct: null, brakeMpa: null, boostBar: null,
  coolantC: null, intakeC: null, outsideC: null, fuelPct: null, odometerKm: null, alerts: null,
  steeringDeg: null, yawDegPerS: null, latG: null, longG: null, wheelKmh: null,
  clutchUp: null, brakePedal: null, handbrake: null, reverse: null, headlights: null,
  indicators: null, wipers: null, belts: null, vsa: null,
}

// The G-plot dot: where the car is being pushed, as seen from above (left turn = left, accelerating = up).
export const gDot = (latG: number | null, longG: number | null, range = 1): { x: number; y: number } => {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / range))
  return { x: latG === null ? 0 : -clamp(latG), y: longG === null ? 0 : -clamp(longG) } // screen y grows downward
}

// Rough drive for the screens when there is no CAN data (open the app with ?demo=1). Not real physics.
export const demoVehicle = (t: number): VehicleData => {
  const speed = Math.max(0, 55 + 50 * Math.sin(t / 7))
  const ratios = [158.5, 99, 68, 51, 40, 30.5]
  const gear = Math.min(6, Math.max(1, Math.ceil(speed / 22))) as 1 | 2 | 3 | 4 | 5 | 6
  const accel = Math.cos(t / 7) * 0.35
  const steer = 220 * Math.sin(t / 3.1)
  const lat = (steer / 500) * 0.6 * Math.min(1, speed / 60)
  const wheels = (k: number) => Math.max(0, (speed / 1.0495) * k)
  return {
    live: true,
    speedKmh: speed,
    rpm: Math.min(7200, 900 + speed * ratios[gear - 1]),
    gear: speed < 4 ? null : gear,
    throttlePct: Math.max(0, Math.min(100, 30 + accel * 160)),
    brakeMpa: accel < -0.2 ? -accel * 8 : 0,
    boostBar: accel > 0 ? accel * 2.2 : -0.5 + accel * 0.6,
    coolantC: 88 + 4 * Math.sin(t / 30),
    intakeC: 34 + 3 * Math.sin(t / 20),
    outsideC: 23,
    fuelPct: 71,
    odometerKm: 44677,
    alerts: { engine: false, oil: false, eps: false },
    steeringDeg: steer,
    yawDegPerS: lat * 22,
    latG: lat,
    longG: accel,
    wheelKmh: { fl: wheels(1 - lat * 0.08), fr: wheels(1 + lat * 0.08), rl: wheels(1 - lat * 0.05), rr: wheels(1 + lat * 0.05) },
    clutchUp: true,
    brakePedal: accel < -0.2,
    handbrake: false,
    reverse: false,
    headlights: Math.floor(t / 10) % 4 as 0 | 1 | 2 | 3,
    indicators: { left: steer < -150, right: steer > 150 },
    wipers: (Math.floor(t / 14) % 4) as 0 | 1 | 2 | 3,
    belts: { driver: true, passenger: Math.floor(t / 20) % 2 === 0 },
    vsa: { lamp: false, unavailable: false, active: false },
  }
}
