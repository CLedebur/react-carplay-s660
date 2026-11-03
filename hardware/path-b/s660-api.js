// Local JSON API for the native head-unit UI (Settings panel). Loaded by serve-build.js, which
// only listens on 127.0.0.1. No npm deps.
//
//   GET  /api/stats[?full=1]   Pi health numbers. `full` adds the /proc fd scan for the video decoder.
//   GET  /api/settings         the user's saved settings (defaults filled in)
//   POST /api/settings         {"units":"f",...} merged into the saved file -- needs the x-s660-ui header
//   GET  /api/network          which link is up (Wi-Fi, Bluetooth tethering), addresses, internet reachability
//   POST /api/network/connect  {"link":"bluetooth"}  bring up the phone tethering profile -- needs the x-s660-ui header
//   GET  /api/webadmin         whether the web interface is on, its addresses and (when on) the login PIN
//   POST /api/webadmin         {"toggle":true} or {"enabled":bool} -- needs the x-s660-ui header
//   POST /api/power            {"action":"restart"|"shutdown"}  -- needs the x-s660-ui header
//   GET  /api/vehicle          decoded CAN data for the Vehicle panel (s660-can.js; listen-only)
//
// Every reading is null when its source is missing, so the UI shows "--" instead of lying.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { createWebAdmin } = require('./web-admin')

// The CAN service is optional: without s660-can.js the panel just shows "no data", the kiosk keeps running.
let vehicle = null
let engineData = () => ({ engineData: false })
try {
  const can = require('./s660-can')
  vehicle = can.createVehicle()
  engineData = can.engineData
} catch (err) {
  console.error(`s660-api: no CAN service (${err.message})`)
}

const MITM_INPUT_NAME = 'S660 CarPlay OPERA MITM' // hardware/opera-mitm/firmware USB product string
const VIDEO_DECODER = '/dev/video10' // bcm2835-codec-decode: held by Chromium's GPU process while it HW-decodes
const POWER_VERBS = { restart: 'reboot', shutdown: 'poweroff' }

const readText = p => {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
const readInt = p => {
  const n = parseInt(readText(p), 10)
  return Number.isFinite(n) ? n : null
}

const cpuTempC = () => {
  const milli = readInt('/sys/class/thermal/thermal_zone0/temp')
  return milli === null ? null : milli / 1000
}

const nvmeTempC = () => {
  const base = '/sys/class/nvme/nvme0'
  try {
    for (const entry of fs.readdirSync(base)) {
      if (!entry.startsWith('hwmon')) continue
      const milli = readInt(path.join(base, entry, 'temp1_input'))
      if (milli !== null) return milli / 1000
    }
  } catch {}
  return null
}

// Busy share since the previous call, so the first call has nothing to compare and returns null.
let prevCpu = null
const cpuLoadPct = () => {
  const fields = (readText('/proc/stat') || '').split('\n')[0].trim().split(/\s+/).slice(1).map(Number)
  if (fields.length < 5 || fields.some(Number.isNaN)) return null
  const idle = fields[3] + fields[4] // idle + iowait
  const total = fields.reduce((a, b) => a + b, 0)
  const prev = prevCpu
  prevCpu = { idle, total }
  if (!prev || total <= prev.total) return null
  return Math.round(100 * (1 - (idle - prev.idle) / (total - prev.total)))
}

const memory = () => {
  const text = readText('/proc/meminfo') || ''
  const kb = key => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)
    return m ? parseInt(m[1], 10) : null
  }
  const total = kb('MemTotal')
  const avail = kb('MemAvailable')
  if (total === null || avail === null) return { memUsedMb: null, memTotalMb: null }
  return { memUsedMb: Math.round((total - avail) / 1024), memTotalMb: Math.round(total / 1024) }
}

// vcgencmd get_throttled: bit 0 under-voltage now, 2 throttled now, 3 soft temp limit now,
// bit 16 under-voltage has occurred since boot.
const powerFlags = () =>
  new Promise(resolve => {
    execFile('vcgencmd', ['get_throttled'], { timeout: 1500 }, (err, out) => {
      const m = !err && /0x([0-9a-f]+)/i.exec(out)
      if (!m) return resolve(null)
      const v = parseInt(m[1], 16)
      resolve({
        underVoltageNow: !!(v & 0x1),
        throttledNow: !!(v & 0x4),
        softTempLimitNow: !!(v & 0x8),
        underVoltageEver: !!(v & 0x10000),
      })
    })
  })

const uptimeSec = () => {
  const n = parseFloat(readText('/proc/uptime'))
  return Number.isFinite(n) ? Math.round(n) : null
}

const overlayRoot = () =>
  (readText('/proc/mounts') || '').split('\n').some(line => {
    const f = line.split(' ')
    return f[1] === '/' && f[2] === 'overlay'
  })

const persistFreeGb = () => {
  try {
    const s = fs.statfsSync('/persist')
    return Math.round((s.bavail * s.bsize) / 1e9)
  } catch {
    return null
  }
}

const mitmLinked = () => (readText('/proc/bus/input/devices') || '').includes(`Name="${MITM_INPUT_NAME}"`)

// True while any process holds the stateful H.264 decoder open. Walks /proc/*/fd, so only on request.
const videoDecoderBusy = () => {
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      let fds
      try {
        fds = fs.readdirSync(`/proc/${pid}/fd`)
      } catch {
        continue
      }
      for (const fd of fds) {
        try {
          if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === VIDEO_DECODER) return true
        } catch {}
      }
    }
  } catch {}
  return false
}

// The drive recorder's own report (s660-drive-log.service); null when it is not running.
const driveLogState = () => {
  try {
    return JSON.parse(readText('/run/s660-drive-log.json'))
  } catch {
    return null
  }
}

// The battery for the Vehicle panel. No CAN message carries it, so it comes from the drive recorder's
// OBD poll (PID 42, module voltage), which runs only with Drive recording on "Listen + engine data".
const BATTERY_FRESH_S = 5
const BATTERY_TREND_S = 15 * 60
const battery = () => {
  const d = driveLogState()
  const now = Date.now() / 1000
  const samples = (d?.battery || []).filter(([t]) => now - t <= BATTERY_TREND_S)
  const last = samples[samples.length - 1]
  const step = Math.max(1, Math.ceil(samples.length / 180)) // at most 180 points for the trend
  return {
    engineData: !!d?.engine,
    batteryV: last && now - last[0] <= BATTERY_FRESH_S ? last[1] / 1000 : null,
    batteryTrend: samples.filter((_, i) => i % step === 0 || i === samples.length - 1).map(([t, mv]) => [Math.round(now - t), mv / 1000]),
  }
}

const stats = async full => ({
  cpuTempC: cpuTempC(),
  nvmeTempC: nvmeTempC(),
  cpuLoadPct: cpuLoadPct(),
  ...memory(),
  power: await powerFlags(),
  uptimeSec: uptimeSec(),
  overlayRoot: overlayRoot(),
  persistFreeGb: persistFreeGb(),
  mitmLinked: mitmLinked(),
  videoDecoderBusy: full ? videoDecoderBusy() : null,
  driveLog: driveLogState(),
})

// ---- network (NetworkManager). Wi-Fi is preferred; the phone's Bluetooth tethering is the fallback.
const run = (cmd, args, timeout = 3000) =>
  new Promise(resolve => execFile(cmd, args, { timeout }, (err, out) => resolve(err ? null : out)))

// nmcli -t separates fields with ':' and escapes a literal ':' or '\\' with a backslash. Walk the line once so a
// trailing backslash in a network name cannot swallow the separator after it.
const nmFields = line => {
  const fields = ['']
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) fields[fields.length - 1] += line[++i]
    else if (line[i] === ':') fields.push('')
    else fields[fields.length - 1] += line[i]
  }
  return fields
}
const nmRows = out => (out || '').split('\n').filter(Boolean).map(nmFields)

const LINK_TYPES = { wifi: 'wifi', bt: 'bluetooth', ethernet: 'ethernet' }
const LINK_IFACE_PREFIX = { wlan: 'wifi', bnep: 'bluetooth', eth: 'ethernet' }

let internetCache = { at: 0, ok: null }
const internetReachable = async () => {
  if (Date.now() - internetCache.at < 10000) return internetCache.ok
  let ok
  try {
    const res = await fetch('https://cp.cloudflare.com/generate_204', { signal: AbortSignal.timeout(3000) })
    ok = res.status === 204
  } catch {
    ok = false
  }
  internetCache = { at: Date.now(), ok }
  return ok
}

const savedConnections = async () =>
  nmRows(await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'con', 'show'])).map(([name, type]) => ({ name, type }))

const network = async () => {
  const devices = nmRows(await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'dev']))
    .filter(([, type]) => LINK_TYPES[type])
    .map(([device, type, state, connection]) => ({ device, type: LINK_TYPES[type], state, connection }))

  const links = await Promise.all(
    devices.map(async d => {
      const link = { type: d.type, state: d.state, name: d.connection || null, ip: null, signal: null }
      if (d.state !== 'connected') return link
      const info = nmRows(await run('nmcli', ['-t', '-f', 'IP4.ADDRESS', 'dev', 'show', d.device]))
      link.ip = (info[0] && info[0][1] ? info[0][1] : '').split('/')[0] || null
      if (d.type === 'wifi') {
        const aps = nmRows(await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL', 'dev', 'wifi', 'list', '--rescan', 'no']))
        const mine = aps.find(([inUse]) => inUse === '*')
        if (mine) {
          link.name = mine[1] || link.name
          link.signal = parseInt(mine[2], 10)
        }
      }
      return link
    }),
  )

  let via = null
  try {
    const routes = JSON.parse((await run('ip', ['-j', 'route', 'show', 'default'])) || '[]')
    routes.sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0))
    const prefix = routes[0] && Object.keys(LINK_IFACE_PREFIX).find(p => routes[0].dev.startsWith(p))
    via = prefix ? LINK_IFACE_PREFIX[prefix] : null
  } catch {}

  const saved = await savedConnections()
  const btProfile = saved.find(c => c.type === 'bluetooth')
  return {
    links,
    via,
    internet: via ? await internetReachable() : false,
    savedWifi: saved.filter(c => c.type === '802-11-wireless').length,
    bluetoothProfile: btProfile ? btProfile.name : null,
  }
}

const connectBluetooth = async () => {
  const profile = (await savedConnections()).find(c => c.type === 'bluetooth')
  if (!profile) throw new Error('no phone is set up for Bluetooth tethering yet')
  await new Promise((resolve, reject) =>
    execFile('sudo', ['-n', 'nmcli', 'con', 'up', 'id', profile.name], { timeout: 30000 }, err =>
      err ? reject(new Error('could not connect through the phone (is Personal Hotspot on?)')) : resolve(),
    ),
  )
  internetCache.at = 0
}

const sendJson = (res, code, body) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(code)
  res.end(JSON.stringify(body))
}

const readBody = (req, limit = 1024) =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > limit) {
        req.destroy()
        reject(new Error('body too large'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

// User settings, kept on /persist so they outlive the overlay (BUILD_NOTES §31). /persist/ui is made
// and chowned by s660-persist-layout.service. Off the Pi (npm start, a Mac) it falls back to the home dir.
const SETTINGS_FILE =
  process.env.S660_SETTINGS_FILE ||
  (fs.existsSync('/persist/ui') ? '/persist/ui/settings.json' : path.join(os.homedir(), '.s660-ui-settings.json'))
// Each setting's default and its allowed values (keep in step with carplay-web-app/src/settings.ts).
const SETTINGS = {
  carplayEnabled: { default: true, allowed: [true, false] },
  autoRunCarplay: { default: true, allowed: [true, false] },
  units: { default: 'c', allowed: ['c', 'f'] },
  clock: { default: '24h', allowed: ['24h', '12h'] },
  handDrive: { default: 'rhd', allowed: ['rhd', 'lhd'] },
  fps: { default: 30, allowed: [30, 60] },
  wifiBand: { default: '5ghz', allowed: ['5ghz', '2.4ghz'] },
  nightMode: { default: false, allowed: [true, false] },
  carplayWidth: { default: 896, allowed: [848, 896] },
  carplayShape: { default: 'fill', allowed: ['fill', 'exact'] },
  // Visible glass width / height x 1000: a range, not a list (carplay-web-app/src/settings.ts GLASS_ASPECT).
  glassAspect: { default: 1875, min: 1500, max: 2400 },
  // The drive recorder (hardware/can/s660-drive-log) reads this from the same file every 2 s.
  driveLog: { default: 'off', allowed: ['off', 'listen', 'engine'] },
  gearPopup: { default: 2, allowed: [0, 1, 2, 3, 4, 5] }, // seconds; 0 = off
  vsaPopup: { default: 2, allowed: [0, 1, 2, 3, 4, 5] }, // seconds; 0 = off
  // The highlight colour: carplay-web-app/src/accent.ts ACCENTS, same order.
  accent: {
    default: 'carnivalYellow2',
    allowed: ['admiralGray', 'carnivalYellow2', 'flameRed', 'starWhite', 'mysticNight', 'beachBlue', 'velvetMaroon',
      'hidaIvory', 'nightHawkBlack', 'britishGreen', 'frenchBlue', 'alabasterSilver', 'activeGreen', 'sonicGray'],
  },
}

const isAllowed = (spec, v) =>
  spec.allowed ? spec.allowed.includes(v) : Number.isInteger(v) && v >= spec.min && v <= spec.max

// Saved values that are no longer allowed fall back to their default instead of breaking the UI.
const readSettings = () => {
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {}
  return Object.fromEntries(
    Object.entries(SETTINGS).map(([k, spec]) => [k, isAllowed(spec, saved[k]) ? saved[k] : spec.default]),
  )
}

// Only known keys with an allowed value are accepted; anything else is a 400, not a silent drop.
const writeSettings = patch => {
  for (const [k, v] of Object.entries(patch)) {
    if (!SETTINGS[k] || !isAllowed(SETTINGS[k], v)) throw new Error(`bad setting: ${k}`)
  }
  const next = { ...readSettings(), ...patch }
  const tmp = `${SETTINGS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, SETTINGS_FILE)
  return next
}

// The built-in web interface (web-admin.js): off until the unit's own screen turns it on.
const webAdmin = createWebAdmin({ stats, network, readSettings, writeSettings, SETTINGS, nmRows })

// Returns true when it handled the request.
const handle = (req, res) => {
  const [url, query = ''] = (req.url || '').split('?')
  if (!url.startsWith('/api/')) return false

  // Defence against DNS rebinding: only ever answer to the loopback names.
  const host = (req.headers.host || '').split(':')[0]
  if (host !== 'localhost' && host !== '127.0.0.1') {
    sendJson(res, 403, { error: 'forbidden' })
    return true
  }

  if (url === '/api/stats' && req.method === 'GET') {
    stats(query.split('&').includes('full=1')).then(
      body => sendJson(res, 200, body),
      err => sendJson(res, 500, { error: String(err.message || err) }),
    )
    return true
  }

  if (url === '/api/vehicle' && req.method === 'GET') {
    sendJson(res, 200, { ...(vehicle ? vehicle.snapshot() : { live: false }), ...engineData(driveLogState(), Date.now() / 1000), ...battery() })
    return true
  }

  if (url === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, readSettings())
    return true
  }

  if (url === '/api/settings' && req.method === 'POST') {
    if (req.headers['x-s660-ui'] !== '1') {
      sendJson(res, 403, { error: 'missing x-s660-ui header' })
      return true
    }
    readBody(req)
      .then(body => {
        let patch
        try {
          patch = JSON.parse(body || '{}')
          sendJson(res, 200, writeSettings(patch))
        } catch (err) {
          sendJson(res, err instanceof SyntaxError || String(err.message).startsWith('bad setting') ? 400 : 500, {
            error: String(err.message || err),
          })
        }
      })
      .catch(err => sendJson(res, 400, { error: String(err.message || err) }))
    return true
  }

  if (url === '/api/network' && req.method === 'GET') {
    network().then(
      body => sendJson(res, 200, body),
      err => sendJson(res, 500, { error: String(err.message || err) }),
    )
    return true
  }

  if (url === '/api/network/connect' && req.method === 'POST') {
    if (req.headers['x-s660-ui'] !== '1') {
      sendJson(res, 403, { error: 'missing x-s660-ui header' })
      return true
    }
    connectBluetooth().then(
      () => sendJson(res, 200, { ok: true }),
      err => sendJson(res, 500, { error: String(err.message || err) }),
    )
    return true
  }

  if (url === '/api/webadmin' && req.method === 'GET') {
    sendJson(res, 200, webAdmin.status())
    return true
  }

  if (url === '/api/webadmin' && req.method === 'POST') {
    if (req.headers['x-s660-ui'] !== '1') {
      sendJson(res, 403, { error: 'missing x-s660-ui header' })
      return true
    }
    readBody(req)
      .then(body => {
        const { toggle, enabled } = JSON.parse(body || '{}')
        if (toggle) webAdmin.toggle()
        else if (enabled === true) webAdmin.enable()
        else if (enabled === false) webAdmin.disable()
        else return sendJson(res, 400, { error: 'send {"toggle":true} or {"enabled":bool}' })
        sendJson(res, 200, webAdmin.status())
      })
      .catch(err => sendJson(res, 400, { error: String(err.message || err) }))
    return true
  }

  if (url === '/api/power' && req.method === 'POST') {
    // A custom header makes a cross-origin page need a CORS preflight, which this server never grants.
    if (req.headers['x-s660-ui'] !== '1') {
      sendJson(res, 403, { error: 'missing x-s660-ui header' })
      return true
    }
    readBody(req)
      .then(body => {
        const verb = POWER_VERBS[JSON.parse(body || '{}').action]
        if (!verb) return sendJson(res, 400, { error: 'action must be restart or shutdown' })
        // s660 has no logind session (carplay.service), so polkit would refuse; sudo -n does not.
        execFile('sudo', ['-n', 'systemctl', verb], { timeout: 5000 }, err => {
          if (err) return sendJson(res, 500, { error: `systemctl ${verb} failed: ${err.message}` })
          sendJson(res, 200, { ok: true })
        })
      })
      .catch(err => sendJson(res, 400, { error: String(err.message || err) }))
    return true
  }

  sendJson(res, 404, { error: 'not found' })
  return true
}

module.exports = { handle, stats, network }
