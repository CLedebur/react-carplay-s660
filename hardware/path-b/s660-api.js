// Local JSON API for the native head-unit UI (Settings panel). Loaded by serve-build.js, which
// only listens on 127.0.0.1. No npm deps.
//
//   GET  /api/stats[?full=1]   Pi health numbers. `full` adds the /proc fd scan for the video decoder.
//   POST /api/power            {"action":"restart"|"shutdown"}  -- needs the x-s660-ui header
//
// Every reading is null when its source is missing, so the UI shows "--" instead of lying.
'use strict'
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

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
})

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

module.exports = { handle, stats }
