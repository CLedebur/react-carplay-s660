// Drive history for the web interface: the drive recorder's logs (hardware/can/s660-drive-log, BUILD_NOTES §40)
// listed newest first, each with a summary and a 1-second trace worked out from its bus recording. Loaded by
// web-admin.js (optional: without it the Drives page says so). No npm deps.
//
// A summary takes a pass over the whole candump log (tens to hundreds of MB), so it runs in its own `nice`
// process (`node s660-drives.js LOG [JSONL]`, which prints the JSON), one at a time, and is kept in
// SUMMARY_DIR so each log is read once. The decoding is s660-can.js's own, so the numbers match the panel.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { execFile } = require('child_process')
const { decode, parseLine, dtcList, IDS } = require('./s660-can')

const DRIVES_DIR = process.env.S660_DRIVES_DIR || '/persist/can/drives'
const SUMMARY_DIR =
  process.env.S660_SUMMARY_DIR || (fs.existsSync('/persist/ui') ? '/persist/ui/drives' : path.join(os.homedir(), '.s660-drive-summaries'))
const VERSION = 1 // bump when the summary changes, so old ones are worked out again
const NAME = /^(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)(\d\d)-[0-9a-f]{4}-(listen|engine)$/
const STEP_MS = 200 // the stats look at the bus this often
const SERIES_MS = 1000 // one trace point a second
const MOVING_KMH = 3
const ACTIVE_MS = 30 * 1000 // a log written to this recently is still being recorded
const G_AVERAGE = 5 // the peak G is of a 1 s average (5 steps), not of one noisy sample
const RUNNING_RPM = 300
const STALL_MOVING_MS = 2000 // an engine that stops within this long of the car moving stalled; a key-off comes later

const WANTED = new Set(IDS)

// The bus recording, read once: maxima, distance, time in each gear, interventions, and the trace.
const summariseLog = async logPath => {
  const frames = new Map()
  const s = {
    start: null, end: null, distanceKm: 0, movingS: 0,
    max: { speedKmh: 0, rpm: 0, boostBar: null, coolantC: null, intakeC: null, brakeMpa: 0, latG: 0, longG: 0, brakeG: 0 },
    odometer: { start: null, end: null }, fuelPct: { start: null, end: null }, outsideC: null,
    gearS: {}, events: { agile: 0, active: 0, abs: 0 }, stalls: 0,
  }
  const series = []
  let atm = null
  let vsaBits = null
  let nextStep = null
  let nextPoint = null
  let lastStep = null
  let running = false
  let movedAt = -Infinity
  const gWindow = []

  const step = t => {
    const v = decode(frames, t, atm)
    if (!v.live) return
    const dt = lastStep === null ? 0 : (t - lastStep) / 1000
    lastStep = t
    const w = v.wheelKmh
    const kmh = w ? (w.fl + w.fr + w.rl + w.rr) / 4 : v.speedKmh
    if (kmh !== null) {
      s.distanceKm += (kmh * dt) / 3600
      if (kmh > MOVING_KMH) {
        s.movingS += dt
        movedAt = t
      }
    }
    const m = s.max
    if (v.speedKmh !== null) m.speedKmh = Math.max(m.speedKmh, v.speedKmh)
    if (v.rpm !== null) {
      m.rpm = Math.max(m.rpm, v.rpm)
      if (running && v.rpm < RUNNING_RPM && t - movedAt <= STALL_MOVING_MS) s.stalls++
      running = v.rpm >= RUNNING_RPM
    }
    if (v.boostBar !== null) m.boostBar = Math.max(m.boostBar ?? -Infinity, v.boostBar)
    if (v.coolantC !== null) m.coolantC = Math.max(m.coolantC ?? -Infinity, v.coolantC)
    if (v.intakeC !== null) m.intakeC = Math.max(m.intakeC ?? -Infinity, v.intakeC)
    if (v.brakeMpa !== null) m.brakeMpa = Math.max(m.brakeMpa, v.brakeMpa)
    gWindow.push([v.latG, v.longG])
    if (gWindow.length > G_AVERAGE) gWindow.shift()
    const mean = i => (gWindow.every(g => g[i] !== null) ? gWindow.reduce((a, g) => a + g[i], 0) / gWindow.length : null)
    const lat = mean(0)
    const long = mean(1)
    if (gWindow.length === G_AVERAGE && lat !== null) m.latG = Math.max(m.latG, Math.abs(lat))
    if (gWindow.length === G_AVERAGE && long !== null) {
      m.longG = Math.max(m.longG, long)
      m.brakeG = Math.max(m.brakeG, -long)
    }
    if (v.gear !== null) s.gearS[v.gear] = (s.gearS[v.gear] || 0) + dt
    if (v.odometerKm !== null) {
      s.odometer.start ??= v.odometerKm
      s.odometer.end = v.odometerKm
    }
    if (v.fuelPct !== null) {
      s.fuelPct.start ??= v.fuelPct
      s.fuelPct.end = v.fuelPct
    }
    if (v.outsideC !== null) s.outsideC ??= v.outsideC
    if (t >= nextPoint) {
      nextPoint = t + SERIES_MS
      const r = x => (x === null || x === undefined ? null : Math.round(x * 100) / 100)
      series.push([Math.round((t - s.start) / 1000), r(v.speedKmh), v.rpm, r(v.boostBar), r(v.latG), r(v.longG), v.coolantC, r(v.throttlePct), v.gear])
    }
  }

  const lines = readline.createInterface({ input: fs.createReadStream(logPath), crlfDelay: Infinity })
  for await (const line of lines) {
    const close = line.indexOf(')')
    if (line[0] !== '(' || close < 0) continue
    const p = parseLine(line)
    if (!p || !WANTED.has(p[0])) continue
    const t = parseFloat(line.slice(1, close)) * 1000
    if (s.start === null) {
      s.start = t
      nextStep = t
      nextPoint = t
    }
    s.end = t
    frames.set(p[0], { data: p[1], at: t })
    // As s660-can.js: the manifold reads the atmosphere while the engine is stopped (the zero for boost),
    // and each AHA / VSA / ABS intervention counts once, as it starts.
    if (p[0] === 0x18b) {
      const rpm = frames.get(0x1dc)
      if (rpm && t - rpm.at <= 1000 && ((rpm.data[1] << 8) | rpm.data[2]) === 0) atm = ((p[1][0] << 8) | p[1][1]) / 10
    }
    if (p[0] === 0x1a4) {
      const bits = { agile: (p[1][4] & 0x80) !== 0, active: (p[1][2] & 1) !== 0, abs: (p[1][2] & 2) !== 0 }
      if (vsaBits) for (const k in bits) if (bits[k] && !vsaBits[k]) s.events[k]++
      vsaBits = bits
    }
    while (t >= nextStep) {
      step(nextStep)
      nextStep += STEP_MS
    }
  }
  for (const k of ['distanceKm', 'movingS']) s[k] = Math.round(s[k] * 100) / 100
  for (const g in s.gearS) s.gearS[g] = Math.round(s.gearS[g])
  for (const k in s.max) if (typeof s.max[k] === 'number') s.max[k] = Math.round(s.max[k] * 100) / 100
  return { ...s, series }
}

// The recorder's request log (engine-data drives only): fault codes and the battery.
const summariseRequests = async jsonlPath => {
  const out = { codes: [], batteryV: { min: null, max: null }, requests: 0 }
  if (!jsonlPath || !fs.existsSync(jsonlPath)) return null
  const codes = new Set()
  const lines = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity })
  for await (const line of lines) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (r.kind !== 'obd' || !r.reply) continue
    out.requests++
    const b = r.reply.split(' ').map(h => parseInt(h, 16))
    if (r.req === '03' || r.req === '07') for (const c of dtcList(b)) codes.add(`${c}${r.req === '07' ? ' (pending)' : ''}`)
    if (r.req === '01 42' && b.length >= 4) {
      const v = ((b[2] << 8) | b[3]) / 1000
      if (v > 5) {
        out.batteryV.min = Math.min(out.batteryV.min ?? Infinity, v)
        out.batteryV.max = Math.max(out.batteryV.max ?? -Infinity, v)
      }
    }
  }
  out.codes = [...codes]
  return out
}

const summarise = async (logPath, jsonlPath) => ({
  v: VERSION,
  ...(await summariseLog(logPath)),
  requests: await summariseRequests(jsonlPath),
})

// ---- the list and the cache, for web-admin.js
const createDrives = ({ recordingFile = () => null } = {}) => {
  let busy = null // the name being summarised
  const queue = []

  const cachePath = name => path.join(SUMMARY_DIR, `${name}.json`)
  const readCache = name => {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath(name), 'utf8'))
      return c.v === VERSION ? c : null
    } catch {
      return null
    }
  }

  const list = () => {
    let files = []
    try {
      files = fs.readdirSync(DRIVES_DIR)
    } catch {
      return null
    }
    const rec = recordingFile()
    return files
      .filter(f => f.endsWith('.log') && NAME.test(f.slice(0, -4)))
      .map(f => {
        const name = f.slice(0, -4)
        const [, y, mo, d, h, mi, se, mode] = NAME.exec(name)
        let st = null
        try {
          st = fs.statSync(path.join(DRIVES_DIR, f))
        } catch {}
        const recording = (rec && path.basename(rec) === f) || (st && Date.now() - st.mtimeMs < ACTIVE_MS)
        return { name, mode, when: `${y}-${mo}-${d} ${h}:${mi}:${se}`, bytes: st ? st.size : 0, recording: !!recording, summary: recording ? null : readCache(name) }
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1))
  }

  const pump = () => {
    if (busy || !queue.length) return
    const name = queue.shift()
    if (readCache(name)) return pump()
    busy = name
    const log = path.join(DRIVES_DIR, `${name}.log`)
    const jsonl = path.join(DRIVES_DIR, `${name}.jsonl`)
    execFile('nice', ['-n', '19', process.execPath, __filename, log, jsonl], { timeout: 15 * 60 * 1000, maxBuffer: 64 << 20 }, (err, out) => {
      if (!err) {
        try {
          fs.mkdirSync(SUMMARY_DIR, { recursive: true })
          JSON.parse(out) // only a complete summary is kept
          fs.writeFileSync(`${cachePath(name)}.tmp`, out)
          fs.renameSync(`${cachePath(name)}.tmp`, cachePath(name))
        } catch {}
      }
      busy = null
      pump()
    })
  }

  // Ask for the summaries a page needs; they arrive in the cache, and the page refreshes until they are there.
  const want = names => {
    for (const n of names) if (NAME.test(n) && n !== busy && !queue.includes(n)) queue.push(n)
    pump()
  }

  // Drop the summaries of logs the recorder has since deleted (it keeps the newest 20 GB).
  const prune = present => {
    try {
      for (const f of fs.readdirSync(SUMMARY_DIR)) if (f.endsWith('.json') && !present.has(f.slice(0, -5))) fs.unlinkSync(path.join(SUMMARY_DIR, f))
    } catch {}
  }

  const get = name => (NAME.test(name) ? (list() || []).find(d => d.name === name) || null : null)

  return { list, want, prune, get, working: () => busy, waiting: () => queue.length }
}

module.exports = { createDrives, summarise, NAME }

if (require.main === module) {
  summarise(process.argv[2], process.argv[3]).then(
    s => process.stdout.write(JSON.stringify(s)),
    err => {
      console.error(err.message)
      process.exit(1)
    },
  )
}
