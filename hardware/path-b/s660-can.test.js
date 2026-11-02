// node --test hardware/path-b/s660-can.test.js
// Frames are real, from the 2026-11-01 captures (hardware/can/captures, not in git).
'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { decode, parseLine, estimateGear, createVehicle, engineData, dtcList } = require('./s660-can')

const NOW = 100000
const frames = (...lines) =>
  new Map(lines.map(l => parseLine(`(0) can0 ${l}`)).map(([id, data]) => [id, { data, at: NOW }]))

test('parseLine reads candump -L lines', () => {
  const [id, data] = parseLine('(1793556369.079898) can0 13C#FFFDFFFD0000043D')
  assert.strictEqual(id, 0x13c)
  assert.strictEqual(data.toString('hex'), 'fffdfffd0000043d')
  assert.strictEqual(parseLine('garbage'), null)
})

test('parked car, ignition on (first capture)', () => {
  const v = decode(
    frames('294#00000000AE850004', '1A6#04008069150000AC', '309#000000000000000C', '1DC#42000017',
      '13C#0046001300400420', '324#564F000000000EB8', '21E#00000040000003', '18B#1D8E00000000002E',
      '305#80140000000003', '1A4#006A000000000027', '156#FFF700000701', '091#802347E602000000'),
    NOW,
  )
  assert.strictEqual(v.live, true)
  assert.strictEqual(v.odometerKm, 44677) // matched the dash
  assert.strictEqual(v.fuelPct, 100) // raw 105 = full
  assert.strictEqual(v.handbrake, true)
  assert.strictEqual(v.headlights, 0)
  assert.strictEqual(v.reverse, false)
  assert.strictEqual(v.speedKmh, 0)
  assert.strictEqual(v.rpm, 0)
  assert.strictEqual(v.gear, null)
  assert.strictEqual(v.clutchUp, true)
  assert.strictEqual(v.throttlePct, 0)
  assert.strictEqual(v.coolantC, 46)
  assert.strictEqual(v.intakeC, 39)
  assert.strictEqual(v.outsideC, 24)
  assert.strictEqual(v.brakeMpa, 0) // raw 106 at rest
  assert.ok(Math.abs(v.boostBar - (756.6 - 760) * 0.00133322) < 1e-9) // engine off: atmosphere
  assert.ok(Math.abs(v.steeringDeg - -0.9) < 1e-9)
  assert.deepStrictEqual(v.belts, { driver: false, passenger: false })
  assert.deepStrictEqual(v.indicators, { left: false, right: false })
  assert.strictEqual(v.wheelKmh, null) // 0x1D0 not supplied
})

test('reverse, low beam, left indicator', () => {
  const v = decode(frames('1A6#06008469160000B4', '294#20000000AE850020'), NOW)
  assert.strictEqual(v.reverse, true)
  assert.strictEqual(v.gear, 'R')
  assert.strictEqual(v.headlights, 2)
  assert.deepStrictEqual(v.indicators, { left: true, right: false })
})

test('0x1D0 wheel speeds: 15-bit, order FL FR RL RR', () => {
  const v = decode(frames('1D0#05D60F4013383548'), NOW)
  assert.strictEqual(v.wheelKmh.fl, 7.47) // the reference's worked example
})

test('stale frames read as null, and live goes false', () => {
  const f = frames('309#0FA000000000000C')
  assert.strictEqual(decode(f, NOW).speedKmh, 40)
  const later = decode(f, NOW + 1500)
  assert.strictEqual(later.speedKmh, null)
  assert.strictEqual(later.live, false)
})

test('gear from rpm / speed, clutch up only', () => {
  assert.strictEqual(estimateGear(3060, 45, true), 3) // 68 rpm per km/h
  assert.strictEqual(estimateGear(3050, 100, true), 6) // 30.5
  assert.strictEqual(estimateGear(3060, 45, false), null) // clutch down
  assert.strictEqual(estimateGear(900, 3, true), null) // creeping
  assert.strictEqual(estimateGear(4000, 45, true), null) // between gears / slipping
})

test('candump starts on demand and stops when idle', () => {
  let spawned = 0
  let killed = 0
  const { EventEmitter } = require('node:events')
  const fake = () => {
    spawned++
    const c = new EventEmitter()
    c.stdout = new EventEmitter()
    c.kill = () => killed++
    setImmediate(() => c.stdout.emit('data', '(1) can0 309#0FA000000000000C\n'))
    return c
  }
  let now = NOW
  const v = createVehicle({ spawnFn: fake, clock: () => now })
  assert.strictEqual(v.snapshot().live, false) // just started, nothing read yet
  assert.strictEqual(spawned, 1)
  v.snapshot()
  assert.strictEqual(spawned, 1) // one candump, not one per request
  v.stop()
  assert.strictEqual(killed, 1)
})

test('engine data from the recorder status: PIDs, fault codes and the cluster, only while fresh', () => {
  const now = 1000
  const st = {
    engine: true,
    obd: {
      '01 0e': { hex: '41 0e 98', t: 999 }, // (152 / 2) - 64 = 12 degrees
      '01 34': { hex: '41 34 80 00 80 00', t: 999 }, // lambda 1.0
      '01 01': { hex: '41 01 82 07 e1 00', t: 999 }, // MIL on, 2 codes
      '01 06': { hex: '41 06 80', t: 980 }, // 20 s old: stale
      '03': { hex: '43 02 03 01 c1 23', t: 990 },
      '07': { hex: '47 00', t: 990 },
      // the cluster read of 2026-11-02, before the errand: 14.1 km/L, 23.3 L, 329 km
      '22 70 2a': { hex: '62 70 2a ff c0 00 00 00 00 00 8d 00 8d 00 87 00 e9 01 49 00', t: 995 },
    },
  }
  const e = engineData(st, now)
  assert.strictEqual(e.engineData, true)
  assert.strictEqual(e.timingDeg, 12)
  assert.strictEqual(e.lambda, 1)
  assert.deepStrictEqual(e.mil, { on: true, count: 2 })
  assert.strictEqual(e.stftPct, null)
  assert.deepStrictEqual(e.dtcStored, ['P0301', 'U0123'])
  assert.deepStrictEqual(e.dtcPending, [])
  assert.deepStrictEqual([e.rangeKm, e.fuelL, e.rangeKmPerL], [329, 23.3, 14.1])
  assert.strictEqual(engineData({ ...st, engine: false }, now).timingDeg, null)
  assert.deepStrictEqual(dtcList([0x43, 0x01, 0x04, 0x20]), ['P0420'])
})
