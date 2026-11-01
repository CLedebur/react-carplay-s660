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
form.inline{display:inline}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
ul.nets{list-style:none;margin:0;padding:0}li.net{border:2px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0}
li.net .top{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}li.net .top b{font-size:20px;margin-right:auto;word-break:break-all}
.tag{border:1px solid var(--line);border-radius:12px;padding:0 8px;font-size:14px;color:var(--dim)}.tag.ok{color:var(--ok);border-color:var(--ok)}
.bars{letter-spacing:1px;font-size:16px}.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.acts form{display:inline-flex;gap:6px;align-items:center;margin:0}.acts button,.acts summary{padding:6px 12px;font-size:16px}
summary{cursor:pointer;border:2px solid var(--line);border-radius:6px;font-weight:700;list-style:none}details[open]>summary{border-color:var(--accent)}
details form{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}details input{width:auto;flex:1;min-width:10em}
.card{border:2px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0}.card.focus{border-color:var(--accent)}
.toast{position:fixed;left:12px;right:12px;bottom:12px;background:var(--accent);color:#000;padding:10px 14px;border-radius:8px;font-weight:700;max-width:736px;margin:0 auto}
label.inline{display:flex;gap:8px;align-items:center;font-weight:400;margin:8px 0}label.inline input{width:auto}`

const CLIENT_JS = `
(function(){
  function toast(msg){var t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove()},5000)}
  function swap(html){var d=new DOMParser().parseFromString(html,'text/html');var m=d.querySelector('main');if(m){document.querySelector('main').replaceWith(m);var f=m.querySelector('.msg');if(f){toast(f.textContent);f.remove()}bind()}}
  function bind(){
    document.querySelectorAll('form[data-ajax]').forEach(function(f){
      f.addEventListener('submit',function(e){
        e.preventDefault();
        if(f.dataset.confirm&&!confirm(f.dataset.confirm))return;
        var body=new URLSearchParams(new FormData(f));
        if(e.submitter&&e.submitter.name)body.set(e.submitter.name,e.submitter.value);
        var wait=parseInt(f.dataset.wait||'0',10)*1000;
        fetch(f.action,{method:'POST',body:body,credentials:'same-origin'}).then(function(r){return r.text()}).then(function(h){
          if(wait){toast('Scanning…');setTimeout(function(){fetch(location.pathname,{credentials:'same-origin'}).then(function(r){return r.text()}).then(swap)},wait)}else swap(h)
        }).catch(function(){toast('The unit stopped answering. If you changed network, reconnect and reload.')})
      })
    });
    document.querySelectorAll('[data-add]').forEach(function(b){
      b.addEventListener('click',function(){var s=document.getElementById('ssid');s.value=b.dataset.add;document.getElementById('addform').scrollIntoView({behavior:'smooth'});document.getElementById(b.dataset.open==='1'?'ssid':'psk').focus()})
    })
  }
  bind()
})();`

const page = (title, body, { nav = true } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · S660</title><style>${CSS}</style></head><body>
<header><b>S660 head unit</b>${nav ? '<a href="/">Status</a><a href="/settings">Settings</a><a href="/wifi">Wi-Fi</a><a href="/logs">Logs</a><a href="/diag">Diagnostics</a><a href="/power">Power</a><a href="/logout">Log out</a>' : ''}</header>
<main>${body}</main><script>${CLIENT_JS}</script></body></html>`

const createWebAdmin = deps => {
  const { stats, network, readSettings, writeSettings, SETTINGS, nmRows } = deps
  let server = null
  let pin = null
  let lastActivity = 0
  let idleTimer = null
  const sessions = new Map() // token -> { seen, ip }: a session only works from the address that logged in
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

  const newPin = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0')

  const enable = () => {
    if (server) return
    pin = newPin()
    lastActivity = Date.now()
    server = http.createServer((req, res) => {
      route(req, res).catch(err => send(res, 500, page('Error', `<h1>Something broke</h1><p class="bad">Please try again.</p>`)))
    })
    server.on('error', () => disable()) // e.g. the port is taken: stay off rather than half on
    // One person on a phone needs a handful of connections; this stops a flood from starving the kiosk's own server.
    server.maxConnections = 20
    server.headersTimeout = 10 * 1000
    server.requestTimeout = 15 * 1000
    server.keepAliveTimeout = 2 * 1000
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
  const clientIp = req => req.socket.remoteAddress
  const loggedIn = req => {
    const t = cookieToken(req)
    const session = t && sessions.get(t)
    if (!session || Date.now() - session.seen > IDLE_MS || session.ip !== clientIp(req)) return false
    session.seen = Date.now()
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
      .map(([name, , priority]) => ({ name, priority: parseInt(priority, 10) || 0 }))
      .sort((x, y) => y.priority - x.priority || x.name.localeCompare(y.name))
  }
  const activeNames = async () => nmRows((await run('nmcli', ['-t', '-f', 'NAME', 'con', 'show', '--active'])).out).map(r => r[0])

  // Give the profiles priorities 10, 20, 30... in the given order (first = most preferred), so the page can talk
  // about "1st choice" and "2nd choice" and never show raw numbers.
  const applyOrder = async names => {
    for (const [i, name] of names.entries()) {
      await run('sudo', ['-n', 'nmcli', 'con', 'mod', 'id', name, 'connection.autoconnect-priority', String((names.length - i) * 10)])
    }
  }

  const bars = pct => (pct >= 75 ? '▂▄▆█' : pct >= 50 ? '▂▄▆' : pct >= 25 ? '▂▄' : '▂')
  const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`

  const scanResults = async () => {
    const scan = await run('nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'no'])
    const seen = new Map()
    for (const [ssid, signal, sec] of nmRows(scan.out)) {
      if (ssid && (!seen.has(ssid) || +signal > seen.get(ssid).signal)) seen.set(ssid, { signal: +signal, sec: sec || '' })
    }
    return seen
  }

  const wifiPage = async url => {
    const [saved, active, nearby, net] = await Promise.all([savedWifi(), activeNames(), scanResults(), network()])
    // NetworkManager stops scanning while connected, so the cache can be empty: ask for a scan and look again once.
    const rescanning = nearby.size === 0 && !url.searchParams.has('r')
    if (rescanning) run('sudo', ['-n', 'nmcli', 'dev', 'wifi', 'rescan'])
    const wifi = net.links.find(l => l.type === 'wifi' && l.state === 'connected')
    const phone = net.links.find(l => l.type === 'bluetooth')
    const hidden = (name, v) => `<input type="hidden" name="${name}" value="${esc(v)}">`

    const savedRows = saved
      .map(({ name }, i) => {
        const isActive = active.includes(name)
        const near = nearby.get(name)
        const tag = isActive ? '<span class="tag ok">● connected</span>' : near ? `<span class="tag">in range <span class="bars">${bars(near.signal)}</span> ${near.signal}%</span>` : '<span class="tag">not in range</span>'
        return `<li class="net"><div class="top"><b>${esc(name)}</b>${tag}<span class="tag">${ordinal(i + 1)} choice</span></div><div class="acts">
<form data-ajax method="post" action="/wifi/move">${hidden('name', name)}<button name="dir" value="up" title="Prefer this network more"${i === 0 ? ' disabled' : ''}>▲ Prefer</button><button name="dir" value="down" title="Prefer this network less"${i === saved.length - 1 ? ' disabled' : ''}>▼ Less</button></form>
${isActive ? '' : `<form data-ajax method="post" action="/wifi/connect">${hidden('name', name)}<button${near ? '' : ' disabled'}>Connect now</button></form>`}
<details><summary>Change password</summary><form data-ajax method="post" action="/wifi/password">${hidden('name', name)}<input name="psk" type="password" minlength="8" maxlength="63" placeholder="New password" required autocomplete="off"><button>Save</button></form></details>
${isActive ? '' : `<form data-ajax data-confirm="Delete ${esc(name)}?" method="post" action="/wifi/delete">${hidden('name', name)}<button class="danger">Delete</button></form>`}
</div></li>`
      })
      .join('')

    const nearbyRows = [...nearby.entries()]
      .filter(([ssid]) => !saved.some(c => c.name === ssid))
      .sort((x, y) => y[1].signal - x[1].signal)
      .map(([ssid, v]) => {
        const dongle = ssid.startsWith('AutoKit-') // the Carlinkit dongle's own network: never join it
        return `<li class="net"><div class="top"><b>${esc(ssid)}</b><span class="tag"><span class="bars">${bars(v.signal)}</span> ${v.signal}%</span><span class="tag">${dongle ? 'your CarPlay dongle' : v.sec ? '🔒 ' + esc(v.sec) : 'open'}</span></div>${
          dongle ? '' : `<div class="acts"><button type="button" data-add="${esc(ssid)}" data-open="${v.sec ? '0' : '1'}">Add…</button></div>`
        }</li>`
      })
      .join('')

    const headline = wifi ? `Connected to <b>${esc(wifi.name)}</b> · ${bars(wifi.signal ?? 0)} ${wifi.signal ?? '?'}% · ${esc(wifi.ip || '')}` : phone && phone.state === 'connected' ? `On your phone's Bluetooth tethering · ${esc(phone.ip || '')}` : 'Not connected'
    return page(
      'Wi-Fi',
      `${rescanning ? '<meta http-equiv="refresh" content="7;url=/wifi?r=1">' : ''}${flash(url)}<h1>Wi-Fi networks</h1>
<div class="card focus">${headline}<br><span class="dim">Internet: ${net.internet ? 'yes' : 'no'} · Phone tethering: ${net.bluetoothProfile ? (phone && phone.state === 'connected' ? 'connected' : 'ready, used when no Wi-Fi is in range') : 'not set up'}</span></div>
<h2>Your networks, in order of preference</h2>
<p class="dim">The unit joins the first one in range. If none is, it uses your phone's Bluetooth tethering. Connecting to another network from here ends this page's connection if you are on Wi-Fi: reconnect to the same network afterwards.</p>
<ul class="nets">${savedRows || '<li class="net">None saved yet. Add one below.</li>'}</ul>
<h2>Nearby <form class="inline" data-ajax data-wait="4" method="post" action="/wifi/rescan"><button>Rescan</button></form></h2>
<ul class="nets">${nearbyRows || '<li class="net dim">Nothing new in range. Try Rescan.</li>'}</ul>
<h2 id="add">Add a network</h2>
<form data-ajax method="post" action="/wifi/add" id="addform" class="card">
<label for="ssid">Network name (SSID)</label><input id="ssid" name="ssid" type="text" maxlength="32" required autocomplete="off" autocapitalize="off">
<label for="psk">Password <span class="dim">(leave empty for an open network)</span></label><input id="psk" name="psk" type="password" maxlength="63" autocomplete="off">
<label class="inline"><input type="checkbox" onchange="document.getElementById('psk').type=this.checked?'text':'password'"> Show password</label>
<label class="inline"><input type="checkbox" name="hidden" value="1"> This network is hidden (does not broadcast its name)</label>
<label for="place">Preference</label><select id="place" name="place"><option value="last">Last choice</option><option value="first">First choice</option></select>
<p><button>Save network</button> <span class="dim">Saving does not connect to it.</span></p></form>`,
    )
  }

  const LOG_UNITS = { carplay: 'carplay.service', network: 'NetworkManager.service', bluetooth: 'bluetooth.service' }
  const logsPage = async url => {
    const which = LOG_UNITS[url.searchParams.get('unit')] ? url.searchParams.get('unit') : 'carplay'
    const out = await run('journalctl', ['-u', LOG_UNITS[which], '-n', '300', '--no-pager', '-o', 'short-iso'])
    // sudo used to log whole nmcli command lines, Wi-Fi passwords included (sudoers-s660-nmcli stops that). Never show one.
    if (out.ok) out.out = out.out.replace(/(wifi-sec\.psk\s+)\S+/g, '$1********').replace(/(psk[=:]\s*)\S+/gi, '$1********')
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
        if (!server) return // switched off while this request was in flight
        const token = crypto.randomBytes(24).toString('hex')
        sessions.set(token, { seen: Date.now(), ip: clientIp(req) })
        pin = newPin() // single use: a PIN seen on the network is worthless once it has been used
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
        return redirect(res, '/settings', 'Not saved: that value is not allowed.')
      }
      return redirect(res, '/settings', 'Saved.')
    }
    if (path === '/wifi' && !post) return send(res, 200, await wifiPage(url))
    if (path === '/wifi/rescan' && post) {
      await run('sudo', ['-n', 'nmcli', 'dev', 'wifi', 'rescan'])
      return redirect(res, '/wifi')
    }
    if (path === '/wifi/add' && post) {
      const f = await readForm(req)
      const ssid = f.get('ssid') || ''
      const psk = f.get('psk') || ''
      if (!ssid || Buffer.byteLength(ssid) > 32 || ssid.startsWith('-') || /[\r\n\0]/.test(ssid)) return redirect(res, '/wifi', 'That network name is not valid.')
      if (psk && (psk.length < 8 || psk.length > 63 || /[\r\n\0]/.test(psk))) return redirect(res, '/wifi', 'A WPA password is 8 to 63 characters.')
      const saved = await savedWifi()
      const allNames = nmRows((await run('nmcli', ['-t', '-f', 'NAME', 'con', 'show'])).out).map(r => r[0])
      if (allNames.includes(ssid)) return redirect(res, '/wifi', 'A saved connection already has that name. Use Change password on it, or delete it first.')
      const args = ['-n', 'nmcli', 'con', 'add', 'type', 'wifi', 'con-name', ssid, 'ifname', 'wlan0', 'ssid', ssid, 'connection.autoconnect', 'yes', 'connection.autoconnect-priority', '1']
      if (f.get('hidden') === '1') args.push('802-11-wireless.hidden', 'yes')
      if (psk) args.push('wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', psk)
      const r = await run('sudo', args)
      if (!r.ok) return redirect(res, '/wifi', 'Could not save that network.')
      const names = saved.map(c => c.name)
      await applyOrder(f.get('place') === 'first' ? [ssid, ...names] : [...names, ssid])
      return redirect(res, '/wifi', `Saved "${ssid}" as your ${f.get('place') === 'first' ? 'first' : 'last'} choice.`)
    }
    if (path === '/wifi/move' && post) {
      const f = await readForm(req)
      const names = (await savedWifi()).map(c => c.name)
      const i = names.indexOf(f.get('name') || '')
      const j = f.get('dir') === 'up' ? i - 1 : f.get('dir') === 'down' ? i + 1 : -1
      if (i < 0 || j < 0 || j >= names.length) return redirect(res, '/wifi', 'Nothing changed.')
      ;[names[i], names[j]] = [names[j], names[i]]
      await applyOrder(names)
      return redirect(res, '/wifi', `"${names[j]}" is now your ${ordinal(j + 1)} choice.`)
    }
    if (path === '/wifi/password' && post) {
      const f = await readForm(req)
      const name = f.get('name') || ''
      const psk = f.get('psk') || ''
      if (!(await savedWifi()).some(c => c.name === name)) return redirect(res, '/wifi', 'No such saved network.')
      if (psk.length < 8 || psk.length > 63 || /[\r\n\0]/.test(psk)) return redirect(res, '/wifi', 'A WPA password is 8 to 63 characters.')
      const r = await run('sudo', ['-n', 'nmcli', 'con', 'mod', 'id', name, 'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', psk])
      return redirect(res, '/wifi', r.ok ? `Password saved for "${name}".` : 'Could not save that password.')
    }
    if (path === '/wifi/connect' && post) {
      const name = (await readForm(req)).get('name') || ''
      if (!(await savedWifi()).some(c => c.name === name)) return redirect(res, '/wifi', 'No such saved network.')
      // Switching networks cuts this very connection when it runs over Wi-Fi, so do it just after replying.
      setTimeout(() => execFile('sudo', ['-n', 'nmcli', 'con', 'up', 'id', name], { timeout: 45000 }, () => {}), 600)
      return redirect(res, '/wifi', `Connecting to "${name}"… if this page stops answering, reconnect to that network and reload.`)
    }
    if (path === '/wifi/delete' && post) {
      const name = (await readForm(req)).get('name') || ''
      if (!(await savedWifi()).some(c => c.name === name)) return redirect(res, '/wifi', 'No such saved network.')
      if ((await activeNames()).includes(name)) return redirect(res, '/wifi', 'You are connected through that network, so it is not deleted.')
      const r = await run('sudo', ['-n', 'nmcli', 'con', 'delete', 'id', name])
      if (r.ok) await applyOrder((await savedWifi()).map(c => c.name))
      return redirect(res, '/wifi', r.ok ? `Deleted "${name}".` : 'Could not delete that network.')
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
