// Built-in web interface: plain HTML pages for the settings that are awkward to change with a knob
// (saved Wi-Fi networks, the same settings as on screen, logs, diagnostics, restart). Loaded by
// s660-api.js; no npm deps.
//
// It is OFF until the Settings page turns it on, and off again after a reboot, 30 minutes without use,
// or too many wrong PINs. Turning it on makes a fresh 6-digit PIN that only the head unit's screen
// shows, so being in the car is the proof of presence and no password is stored. It speaks plain HTTP
// on the local network (home Wi-Fi or the phone's tethering): do not forward it to the Internet.
'use strict'
const http = require('http')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')

const PORT = 8080
const IDLE_MS = 30 * 60 * 1000 // a session, and the whole server, expire after this long unused
const MAX_BAD_PINS = 5 // in a row, then a lockout
const LOCKOUT_MS = 60 * 1000
const MAX_LOCKOUTS = 3 // then the server turns itself off and must be re-enabled on the unit
const COOKIE = 's660s'

const LABELS = {
  autoRunCarplay: 'Automatically run CarPlay when the car starts',
  units: 'Temperature units',
  clock: 'Clock',
  handDrive: 'Hand drive (CarPlay sidebar side)',
  fps: 'Video frame rate',
  wifiBand: 'Dongle Wi-Fi band',
  nightMode: 'CarPlay night mode',
}
const VALUE_LABELS = { true: 'On', false: 'Off', c: '°C', f: '°F', rhd: 'Right', lhd: 'Left', '5ghz': '5 GHz', '2.4ghz': '2.4 GHz', '24h': '24-hour', '12h': '12-hour' }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const run = (cmd, args, timeout = 8000) =>
  new Promise(resolve =>
    execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, (err, out, errOut) =>
      resolve({ ok: !err, out: out || '', err: (errOut || (err && err.message) || '').trim() }),
    ),
  )

// nmcli -t separates fields with ':' and escapes literal ones as '\:'.
const nmRows = out =>
  (out || '')
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(/(?<!\\):/).map(f => f.replace(/\\:/g, ':').replace(/\\\\/g, '\\')))

const CSS = `
:root{color-scheme:dark light;--bg:#000;--fg:#fff;--dim:#b4b4b4;--line:#6e6e6e;--accent:#ffd400;--ok:#4dff88;--bad:#ff5252}
@media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#000;--dim:#444;--line:#888;--accent:#7a5c00;--ok:#087a2f;--bad:#b00020}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.4 -apple-system,Segoe UI,Roboto,sans-serif}
header{border-bottom:2px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
header b{font-size:20px;margin-right:auto}a{color:var(--accent);font-weight:700}main{padding:16px;max-width:760px;margin:0 auto}
h1{font-size:24px;margin:8px 0 12px}h2{font-size:16px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:22px 0 6px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
td:first-child{color:var(--dim);width:45%}label{display:block;margin:12px 0 4px;font-weight:700}
input,select,button{font:inherit;padding:10px 12px;border:2px solid var(--line);background:var(--bg);color:var(--fg);border-radius:6px;max-width:100%}
input[type=text],input[type=password],input[type=number],select{width:100%}
button{cursor:pointer;font-weight:700;border-color:var(--fg)}button.danger{border-color:var(--bad);color:var(--bad)}
.msg{border:2px solid var(--accent);padding:8px 12px;margin:10px 0}.ok{color:var(--ok)}.bad{color:var(--bad)}.dim{color:var(--dim)}
pre{background:#111;color:#ddd;padding:10px;overflow:auto;font-size:13px;line-height:1.35;border:1px solid var(--line)}
form.inline{display:inline}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}`

const page = (title, body, { nav = true } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · S660</title><style>${CSS}</style></head><body>
<header><b>S660 head unit</b>${nav ? '<a href="/">Status</a><a href="/settings">Settings</a><a href="/wifi">Wi-Fi</a><a href="/logs">Logs</a><a href="/diag">Diagnostics</a><a href="/power">Power</a><a href="/logout">Log out</a>' : ''}</header>
<main>${body}</main></body></html>`

const createWebAdmin = deps => {
  const { stats, network, readSettings, writeSettings, SETTINGS } = deps
  let server = null
  let pin = null
  let lastActivity = 0
  let idleTimer = null
  const sessions = new Map() // token -> last seen
  let badPins = 0
  let lockedUntil = 0
  let lockouts = 0

  const addresses = () =>
    Object.entries(os.networkInterfaces())
      .filter(([name]) => /^(wlan|eth|bnep)/.test(name))
      .flatMap(([, list]) => list.filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address))

  const status = () => ({
    enabled: !!server,
    port: PORT,
    pin: server ? pin : null,
    urls: server ? addresses().map(ip => `http://${ip}:${PORT}`) : [],
  })

  const disable = () => {
    if (idleTimer) clearInterval(idleTimer)
    idleTimer = null
    if (server) {
      server.close()
      server.closeAllConnections()
    }
    server = null
    pin = null
    sessions.clear()
    badPins = 0
    lockedUntil = 0
    lockouts = 0
  }

  const enable = () => {
    if (server) return
    pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
    lastActivity = Date.now()
    server = http.createServer((req, res) => {
      route(req, res).catch(err => send(res, 500, page('Error', `<h1>Something broke</h1><p class="bad">${esc(err.message)}</p>`)))
    })
    server.on('error', () => disable()) // e.g. the port is taken: stay off rather than half on
    server.listen(PORT, '0.0.0.0')
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_MS) disable()
    }, 30 * 1000)
  }

  const toggle = () => (server ? disable() : enable())

  // ---- helpers
  const send = (res, code, html, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
    res.end(html)
  }
  const redirect = (res, to, msg, headers = {}) => {
    res.writeHead(303, { Location: msg ? `${to}?msg=${encodeURIComponent(msg)}` : to, ...headers })
    res.end()
  }
  const readForm = req =>
    new Promise((resolve, reject) => {
      let body = ''
      req.on('data', c => {
        body += c
        if (body.length > 4096) {
          req.destroy()
          reject(new Error('form too large'))
        }
      })
      req.on('end', () => resolve(new URLSearchParams(body)))
      req.on('error', reject)
    })
  const cookieToken = req => (/(?:^|;\s*)s660s=([0-9a-f]+)/.exec(req.headers.cookie || '') || [])[1]
  const loggedIn = req => {
    const t = cookieToken(req)
    const seen = t && sessions.get(t)
    if (!seen || Date.now() - seen > IDLE_MS) return false
    sessions.set(t, Date.now())
    lastActivity = Date.now()
    return true
  }
  const flash = url => (url.searchParams.get('msg') ? `<div class="msg">${esc(url.searchParams.get('msg'))}</div>` : '')
  const pinMatches = given => {
    const a = Buffer.from(String(given))
    const b = Buffer.from(pin || '')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  // ---- pages
  const loginPage = (note = '') =>
    page(
      'Log in',
      `<h1>Log in</h1><p>Enter the 6-digit PIN shown on the head unit (Settings → Options).</p>${note}
<form method="post" action="/login"><label for="pin">PIN</label>
<input id="pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" autofocus required>
<p><button>Log in</button></p></form>`,
      { nav: false },
    )

  const statusPage = async url => {
    const [s, n] = await Promise.all([stats(true), network()])
    const row = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`
    const num = (v, unit = '') => (v === null || v === undefined ? '--' : `${v}${unit}`)
    const flags = s.power
    return page(
      'Status',
      `${flash(url)}<h1>Status</h1>
<h2>Computer</h2><table>
${row('CPU temperature', num(s.cpuTempC, ' °C'))}${row('NVMe temperature', num(s.nvmeTempC, ' °C'))}${row('CPU load', num(s.cpuLoadPct, ' %'))}
${row('Memory', s.memUsedMb === null ? '--' : `${s.memUsedMb} / ${s.memTotalMb} MB`)}
${row('Power supply', !flags ? '--' : flags.underVoltageNow ? 'LOW VOLTAGE' : flags.underVoltageEver ? 'Dipped earlier' : 'OK')}
${row('Throttled', !flags ? '--' : flags.throttledNow ? 'Yes' : flags.softTempLimitNow ? 'Soft limit' : 'No')}
${row('Up for', s.uptimeSec === null ? '--' : `${Math.floor(s.uptimeSec / 3600)} h ${Math.floor(s.uptimeSec / 60) % 60} min`)}
${row('Overlay disk', s.overlayRoot ? 'ON (changes are lost at power-off)' : 'OFF (changes are saved)')}
${row('/persist free', num(s.persistFreeGb, ' GB'))}</table>
<h2>CarPlay and controls</h2><table>
${row('Video decoder', s.videoDecoderBusy === null ? '--' : s.videoDecoderBusy ? 'Hardware (in use)' : 'Idle')}
${row('OPERA MITM (Pico)', s.mitmLinked ? 'Connected' : 'Not found')}</table>
<h2>Network</h2><table>
${row('Online via', n.via || 'nothing')}${row('Internet', n.internet ? 'Yes' : 'No')}${row('Saved Wi-Fi networks', n.savedWifi)}
${n.links.map(l => row(`${l.type}`, [l.state, l.name, l.ip, l.signal === null ? '' : `${l.signal}%`].filter(Boolean).join(' · '))).join('')}</table>`,
    )
  }

  const settingsPage = url => {
    const cur = readSettings()
    const fields = Object.keys(SETTINGS)
      .map(k => {
        const opts = SETTINGS[k].allowed
          .map(v => `<option value="${esc(JSON.stringify(v))}"${v === cur[k] ? ' selected' : ''}>${esc(VALUE_LABELS[v] ?? v)}${k === 'fps' ? ' fps' : ''}</option>`)
          .join('')
        return `<label for="${k}">${esc(LABELS[k] || k)}</label><select id="${k}" name="${k}">${opts}</select>`
      })
      .join('')
    return page(
      'Settings',
      `${flash(url)}<h1>Settings</h1><form method="post" action="/settings">${fields}<p><button>Save</button></p></form>
<p class="dim">Hand drive, frame rate and Wi-Fi band only reach the dongle when CarPlay restarts: use <a href="/power">Power → Restart CarPlay</a>.</p>`,
    )
  }

  const savedWifi = async () => {
    const out = await run('nmcli', ['-t', '-f', 'NAME,TYPE,AUTOCONNECT-PRIORITY', 'con', 'show'])
    return nmRows(out.out)
      .filter(([, type]) => type === '802-11-wireless')
      .map(([name, , priority]) => ({ name, priority }))
  }
  const activeNames = async () => nmRows((await run('nmcli', ['-t', '-f', 'NAME', 'con', 'show', '--active'])).out).map(r => r[0])

  const wifiPage = async url => {
    const [saved, active, scan] = await Promise.all([
      savedWifi(),
      activeNames(),
      run('nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'no']),
    ])
    const seen = new Map()
    for (const [ssid, signal, sec] of nmRows(scan.out)) if (ssid && (!seen.has(ssid) || +signal > seen.get(ssid).signal)) seen.set(ssid, { signal: +signal, sec })
    const nearby = [...seen.entries()].sort((a, b) => b[1].signal - a[1].signal)
    const savedRows = saved
      .map(({ name, priority }) => {
        const isActive = active.includes(name)
        return `<tr><td>${esc(name)}${isActive ? ' <span class="ok">● connected</span>' : ''}</td><td>
<form class="inline" method="post" action="/wifi/priority"><input type="hidden" name="name" value="${esc(name)}">
<input name="priority" type="number" min="-999" max="999" value="${esc(priority)}" style="width:6em" aria-label="priority"> <button>Set priority</button></form>
${isActive ? '' : `<form class="inline" method="post" action="/wifi/delete" onsubmit="return confirm('Delete this network?')"><input type="hidden" name="name" value="${esc(name)}"><button class="danger">Delete</button></form>`}
</td></tr>`
      })
      .join('')
    return page(
      'Wi-Fi',
      `${flash(url)}<h1>Wi-Fi networks</h1>
<p class="dim">The unit joins the saved network with the highest priority that is in range. If none is, it can use your phone's Bluetooth tethering (Settings → Network on the unit).</p>
<h2>Saved</h2><table>${savedRows || '<tr><td colspan="2">None saved</td></tr>'}</table>
<h2>Add a network</h2>
<form method="post" action="/wifi/add"><label for="ssid">Network name (SSID)</label>
<input id="ssid" name="ssid" type="text" list="nearby" maxlength="32" required autocomplete="off">
<datalist id="nearby">${nearby.map(([ssid]) => `<option value="${esc(ssid)}">`).join('')}</datalist>
<label for="psk">Password (leave empty for an open network)</label><input id="psk" name="psk" type="password" maxlength="63" autocomplete="off">
<label for="prio">Priority (higher is preferred; your home network is usually 100)</label><input id="prio" name="priority" type="number" min="-999" max="999" value="50">
<p><button>Save network</button></p></form>
<p class="dim">Saving does not connect to it, so this page keeps working. Delete is not offered for the network you are on.</p>
<h2>Nearby</h2><table>${nearby.map(([ssid, v]) => `<tr><td>${esc(ssid)}</td><td>${v.signal}% · ${esc(v.sec || 'open')}</td></tr>`).join('') || '<tr><td colspan="2">Nothing found</td></tr>'}</table>`,
    )
  }

  const LOG_UNITS = { carplay: 'carplay.service', network: 'NetworkManager.service', bluetooth: 'bluetooth.service' }
  const logsPage = async url => {
    const which = LOG_UNITS[url.searchParams.get('unit')] ? url.searchParams.get('unit') : 'carplay'
    const out = await run('journalctl', ['-u', LOG_UNITS[which], '-n', '300', '--no-pager', '-o', 'short-iso'])
    const tabs = Object.keys(LOG_UNITS).map(k => (k === which ? `<b>${k}</b>` : `<a href="/logs?unit=${k}">${k}</a>`)).join(' · ')
    return page('Logs', `<h1>Logs</h1><p>${tabs}</p><pre>${esc(out.ok ? out.out : out.err || 'no output')}</pre>`)
  }

  const DIAG = [
    ['Kernel', 'uname', ['-r']],
    ['Uptime', 'uptime', ['-p']],
    ['Throttling (vcgencmd)', 'vcgencmd', ['get_throttled']],
    ['SoC temperature', 'vcgencmd', ['measure_temp']],
    ['USB devices', 'lsusb', []],
    ['Network devices', 'nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'dev']],
    ['Bluetooth: paired devices', 'bluetoothctl', ['devices', 'Paired']],
    ['Disk', 'df', ['-h', '/', '/persist']],
    ['Mounts', 'sh', ['-c', 'mount | grep -E " / | /persist "']],
  ]
  const diagPage = async () => {
    const results = await Promise.all(DIAG.map(([, cmd, args]) => run(cmd, args)))
    return page('Diagnostics', `<h1>Diagnostics</h1>${DIAG.map(([label], i) => `<h2>${esc(label)}</h2><pre>${esc(results[i].out || results[i].err || '(no output)')}</pre>`).join('')}`)
  }

  const powerPage = url =>
    page(
      'Power',
      `${flash(url)}<h1>Power</h1>
<form method="post" action="/power" onsubmit="return confirm('Restart CarPlay now? The screen goes blank for about 10 seconds.')"><input type="hidden" name="action" value="restart-kiosk"><p><button>Restart CarPlay</button></p></form>
<form method="post" action="/power" onsubmit="return confirm('Reboot the whole unit?')"><input type="hidden" name="action" value="reboot"><p><button class="danger">Reboot</button></p></form>
<form method="post" action="/power" onsubmit="return confirm('Shut the unit down? You will have to switch the ignition off and on to start it again.')"><input type="hidden" name="action" value="shutdown"><p><button class="danger">Shut down</button></p></form>
<p class="dim">Restarting ends this web session.</p>`,
    )

  const POWER = {
    'restart-kiosk': ['systemctl', 'restart', 'carplay.service'],
    reboot: ['systemctl', 'reboot'],
    shutdown: ['systemctl', 'poweroff'],
  }

  // ---- routing
  const route = async (req, res) => {
    const url = new URL(req.url || '/', 'http://x')
    const path = url.pathname
    const post = req.method === 'POST'
    if (post) {
      // SameSite=Strict already keeps other sites from posting with the cookie; this also refuses a cross-origin POST outright.
      const origin = req.headers.origin
      if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, page('Refused', '<h1>Refused</h1>', { nav: false }))
    }

    if (path === '/login') {
      if (!post) return send(res, 200, loginPage())
      const form = await readForm(req)
      if (Date.now() < lockedUntil) return send(res, 429, loginPage('<p class="bad">Too many wrong PINs. Wait a minute.</p>'))
      if (pinMatches(form.get('pin') || '')) {
        badPins = 0
        lockouts = 0
        const token = crypto.randomBytes(24).toString('hex')
        sessions.set(token, Date.now())
        lastActivity = Date.now()
        return redirect(res, '/', null, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${IDLE_MS / 1000}` })
      }
      if (++badPins >= MAX_BAD_PINS) {
        badPins = 0
        lockedUntil = Date.now() + LOCKOUT_MS
        if (++lockouts >= MAX_LOCKOUTS) disable() // too many guesses: off until someone at the unit turns it on again
      }
      return send(res, 401, loginPage('<p class="bad">Wrong PIN.</p>'))
    }

    if (!loggedIn(req)) return redirect(res, '/login')

    if (path === '/logout') {
      sessions.delete(cookieToken(req))
      return redirect(res, '/login', null, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` })
    }
    if (path === '/' && !post) return send(res, 200, await statusPage(url))
    if (path === '/settings') {
      if (!post) return send(res, 200, settingsPage(url))
      const form = await readForm(req)
      const patch = {}
      for (const k of Object.keys(SETTINGS)) if (form.has(k)) patch[k] = JSON.parse(form.get(k))
      try {
        writeSettings(patch)
      } catch (err) {
        return redirect(res, '/settings', `Not saved: ${err.message}`)
      }
      return redirect(res, '/settings', 'Saved.')
    }
    if (path === '/wifi' && !post) return send(res, 200, await wifiPage(url))
    if (path === '/wifi/add' && post) {
      const f = await readForm(req)
      const ssid = f.get('ssid') || ''
      const psk = f.get('psk') || ''
      const priority = parseInt(f.get('priority'), 10)
      if (!ssid || Buffer.byteLength(ssid) > 32 || ssid.startsWith('-') || /[\r\n\0]/.test(ssid)) return redirect(res, '/wifi', 'That network name is not valid.')
      if (psk && (psk.length < 8 || psk.length > 63 || /[\r\n\0]/.test(psk))) return redirect(res, '/wifi', 'A WPA password is 8 to 63 characters.')
      if (!Number.isInteger(priority) || priority < -999 || priority > 999) return redirect(res, '/wifi', 'Priority must be between -999 and 999.')
      if ((await savedWifi()).some(c => c.name === ssid)) return redirect(res, '/wifi', 'That network is already saved. Delete it first to change its password.')
      const args = ['-n', 'nmcli', 'con', 'add', 'type', 'wifi', 'con-name', ssid, 'ifname', 'wlan0', 'ssid', ssid, 'connection.autoconnect', 'yes', 'connection.autoconnect-priority', String(priority)]
      if (psk) args.push('wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', psk)
      const r = await run('sudo', args)
      return redirect(res, '/wifi', r.ok ? `Saved "${ssid}".` : `Could not save: ${r.err}`)
    }
    if (path === '/wifi/priority' && post) {
      const f = await readForm(req)
      const priority = parseInt(f.get('priority'), 10)
      const name = f.get('name') || ''
      if (!(await savedWifi()).some(c => c.name === name) || !Number.isInteger(priority) || priority < -999 || priority > 999) return redirect(res, '/wifi', 'Nothing changed.')
      const r = await run('sudo', ['-n', 'nmcli', 'con', 'mod', 'id', name, 'connection.autoconnect-priority', String(priority)])
      return redirect(res, '/wifi', r.ok ? 'Priority saved.' : `Could not save: ${r.err}`)
    }
    if (path === '/wifi/delete' && post) {
      const name = (await readForm(req)).get('name') || ''
      if (!(await savedWifi()).some(c => c.name === name)) return redirect(res, '/wifi', 'No such saved network.')
      if ((await activeNames()).includes(name)) return redirect(res, '/wifi', 'You are connected through that network, so it is not deleted.')
      const r = await run('sudo', ['-n', 'nmcli', 'con', 'delete', 'id', name])
      return redirect(res, '/wifi', r.ok ? `Deleted "${name}".` : `Could not delete: ${r.err}`)
    }
    if (path === '/logs' && !post) return send(res, 200, await logsPage(url))
    if (path === '/diag' && !post) return send(res, 200, await diagPage())
    if (path === '/power') {
      if (!post) return send(res, 200, powerPage(url))
      const cmd = POWER[(await readForm(req)).get('action')]
      if (!cmd) return redirect(res, '/power', 'Unknown action.')
      send(res, 200, page('Working', '<h1>Done</h1><p>The unit is carrying that out now. This page will stop answering.</p>'))
      setTimeout(() => execFile('sudo', ['-n', ...cmd], { timeout: 10000 }, () => {}), 500)
      return
    }
    send(res, 404, page('Not found', '<h1>Not found</h1>'))
  }

  return { status, enable, disable, toggle }
}

module.exports = { createWebAdmin, PORT }
