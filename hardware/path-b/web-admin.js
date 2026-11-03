// Built-in web interface: plain HTML pages for the settings that are awkward to change with a knob
// (saved Wi-Fi networks, the same settings as on screen, logs, diagnostics, restart), the live vehicle
// data and the drive history. Loaded by s660-api.js; no npm deps.
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
  carplayEnabled: 'CarPlay (off: the phone cannot connect)',
  autoRunCarplay: 'Automatically run CarPlay when the car starts',
  units: 'Temperature units',
  clock: 'Clock',
  handDrive: 'Hand drive (CarPlay sidebar side)',
  fps: 'Video frame rate',
  wifiBand: 'Dongle Wi-Fi band',
  nightMode: 'CarPlay night mode',
  carplayShape: 'CarPlay picture',
  carplayWidth: 'CarPlay width (needs Restart CarPlay)',
  driveLog: 'Drive recording',
  gearPopup: 'Gear pop-up (seconds, 0 = off)',
  vsaPopup: 'AHA / VSA pop-up (seconds, 0 = off)',
  accent: 'Highlight colour',
}
const VALUE_LABELS = { true: 'On', false: 'Off', c: '°C', f: '°F', rhd: 'Right', lhd: 'Left', '5ghz': '5 GHz', '2.4ghz': '2.4 GHz', '24h': '24-hour', '12h': '12-hour', fill: 'Fill screen', exact: 'True shape (bar on the left)', off: 'Off', listen: 'Listen only', engine: 'Listen + engine data (sends requests)',
  admiralGray: 'Admiral Gray Metallic', carnivalYellow2: 'Carnival Yellow 2', flameRed: 'Flame Red', starWhite: 'Premium Star White Pearl',
  mysticNight: 'Premium Mystic Night Pearl', beachBlue: 'Premium Beach Blue Pearl', velvetMaroon: 'Velvet Maroon Metallic',
  hidaIvory: 'Hida Maria Ivory Pearl', nightHawkBlack: 'Night Hawk Black Pearl', britishGreen: 'British Green Pearl',
  frenchBlue: 'French Blue Pearl', alabasterSilver: 'Alabaster Silver Metallic', activeGreen: 'Active Green Pearl', sonicGray: 'Sonic Gray Pearl' }

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
label.inline{display:flex;gap:8px;align-items:center;font-weight:400;margin:8px 0}label.inline input{width:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 24px}td.n{text-align:right;font-variant-numeric:tabular-nums}
main.wide{max-width:1100px}svg.chart{width:100%;height:auto;display:block;margin:2px 0 14px}svg.chart text{fill:var(--dim);font-size:12px}
svg.chart .ax{stroke:var(--line);stroke-width:1}svg.chart .ln{fill:none;stroke:var(--accent);stroke-width:1.6}svg.chart .ln2{fill:none;stroke:var(--fg);stroke-width:1.2;opacity:.6}
.gdot{width:180px;height:180px}.gdot circle.ring{fill:none;stroke:var(--line)}.gdot circle.dot{fill:var(--accent)}`

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

// The live Vehicle page polls /vehicle.json once a second and fills in the cells by key. The groups follow the
// unit's own Vehicle panel (carplay-web-app/src/VehicleTabs.tsx); a value the car is not sending shows "--".
const VEHICLE_JS = `
(function(){
  var F=window.S660_UNITS==='f';
  function n(v,d){return v===null||v===undefined?'--':(+v).toFixed(d)}
  function t(v){return v===null||v===undefined?'--':Math.round(F?v*9/5+32:v)+(F?' °F':' °C')}
  function yn(v,a,b){return v===null||v===undefined?'--':v?a:b}
  var LIGHTS=['Off','Parking','Low beam','High beam'],WIPERS=['Off','Interval','Low','High'];
  var V={
    speed:function(d){return n(d.speedKmh,0)+' km/h'},rpm:function(d){return n(d.rpm,0)+' rpm'},gear:function(d){return d.gear===null?'--':d.gear},
    throttle:function(d){return n(d.throttlePct,0)+' %'},brake:function(d){return n(d.brakeMpa,1)+' MPa'},boost:function(d){return n(d.boostBar,2)+' bar'},
    clutch:function(d){return yn(d.clutchUp,'Up','Pressed')},brakePedal:function(d){return yn(d.brakePedal,'Pressed','Released')},
    coolant:function(d){return t(d.coolantC)},intake:function(d){return t(d.intakeC)},outside:function(d){return t(d.outsideC)},catalyst:function(d){return t(d.catalystC)},
    timing:function(d){return n(d.timingDeg,1)+' °'},trims:function(d){return n(d.stftPct,1)+' % / '+n(d.ltftPct,1)+' %'},
    lambda:function(d){return n(d.lambda,2)+' / '+n(d.lambdaCmd,2)},load:function(d){return n(d.loadPct,0)+' % / '+n(d.absLoadPct,0)+' %'},
    plate:function(d){return n(d.throttlePlatePct,0)+' %'},battery:function(d){return n(d.batteryV,2)+' V'},
    latG:function(d){return n(d.latG,2)+' g'},longG:function(d){return n(d.longG,2)+' g'},yaw:function(d){return n(d.yawDegPerS,1)+' °/s'},
    steer:function(d){return n(d.steeringDeg,0)+' °'},
    wheels:function(d){var w=d.wheelKmh;return w?[w.fl,w.fr,w.rl,w.rr].map(function(x){return n(x,1)}).join(' · '):'--'},
    vsa:function(d){var v=d.vsa;return !v?'--':v.unavailable?'UNAVAILABLE':v.abs?'ABS acting':v.active?'VSA acting':v.agile?'AHA acting':v.lamp?'Lamp on':'Ready'},
    events:function(d){var e=d.vsaEvents;return e?e.agile+' / '+e.active+' / '+e.abs:'--'},
    fuel:function(d){return n(d.fuelPct,0)+' %'+(d.fuelL===null||d.fuelL===undefined?'':' · '+n(d.fuelL,1)+' L')},
    range:function(d){return d.rangeKm===null||d.rangeKm===undefined?'--':d.rangeKm+' km at '+n(d.rangeKmPerL,1)+' km/L'},
    odo:function(d){return d.odometerKm===null?'--':d.odometerKm.toLocaleString()+' km'},
    lights:function(d){return d.headlights===null?'--':LIGHTS[d.headlights]},wipers:function(d){return d.wipers===null?'--':WIPERS[d.wipers]},
    indicators:function(d){var i=d.indicators;return !i?'--':i.left&&i.right?'Hazards':i.left?'Left':i.right?'Right':'Off'},
    handbrake:function(d){return yn(d.handbrake,'On','Off')},reverse:function(d){return yn(d.reverse,'Engaged','No')},
    belts:function(d){var b=d.belts;return !b?'--':'Driver '+(b.driver?'buckled':'UNBUCKLED')+' · passenger '+(b.passenger?'buckled':'unbuckled')},
    lamps:function(d){var l=d.lamps;if(!l)return '--';var on=[];if(l.engine)on.push('engine');if(l.lampA||l.lampB)on.push('oil / charging');if(l.eps)on.push('EPS');return on.length?on.join(', '):'All off'},
    mil:function(d){return !d.mil?'--':d.mil.on?'ON ('+d.mil.count+' codes)':'Off'},
    codes:function(d){var s=d.dtcStored,p=d.dtcPending;if(!s&&!p)return '--';return ((s||[]).join(', ')||'none')+' / '+((p||[]).join(', ')||'none')},
    eps:function(d){return yn(d.epsDisabled,'DISABLED','Working')},hold:function(d){return yn(d.brakeError,'ERROR',yn(d.brakeHold,'Holding','Off'))}
  };
  function draw(d){
    document.getElementById('live').textContent=d.live?'Live':'No data: ignition off, or the CAN adapter is unplugged';
    document.getElementById('live').className=d.live?'ok':'bad';
    document.querySelectorAll('[data-k]').forEach(function(c){c.textContent=V[c.dataset.k](d)});
    var dot=document.getElementById('dot'),x=d.latG===null?0:Math.max(-1,Math.min(1,-d.latG)),y=d.longG===null?0:Math.max(-1,Math.min(1,d.longG));
    dot.setAttribute('cx',90+x*80);dot.setAttribute('cy',90-y*80);
  }
  function poll(){fetch('/vehicle.json',{credentials:'same-origin'}).then(function(r){if(r.redirected||!r.ok)throw 0;return r.json()}).then(draw).catch(function(){document.getElementById('live').textContent='The unit stopped answering';document.getElementById('live').className='bad'}).then(function(){setTimeout(poll,1000)})}
  poll();
})();`

const page = (title, body, { nav = true, wide = false } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · S660</title><style>${CSS}</style></head><body>
<header><b>S660 head unit</b>${nav ? '<a href="/">Status</a><a href="/vehicle">Vehicle</a><a href="/drives">Drives</a><a href="/settings">Settings</a><a href="/wifi">Wi-Fi</a><a href="/logs">Logs</a><a href="/diag">Diagnostics</a><a href="/power">Power</a><a href="/logout">Log out</a>' : ''}</header>
<main${wide ? ' class="wide"' : ''}>${body}</main><script>${CLIENT_JS}</script></body></html>`

const createWebAdmin = deps => {
  const { stats, network, readSettings, writeSettings, SETTINGS, nmRows, vehicleData, drives } = deps
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
      .filter(k => SETTINGS[k].allowed) // glassAspect is a range, set on the unit's own Display tab
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
<p class="dim">Hand drive, frame rate, Wi-Fi band and CarPlay width only reach the dongle when CarPlay restarts: use <a href="/power">Power → Restart CarPlay</a>.</p>`,
    )
  }

  // ---- vehicle, live
  const VEHICLE_GROUPS = [
    ['Drive', [['Speed', 'speed'], ['Engine', 'rpm'], ['Gear (estimated)', 'gear'], ['Accelerator', 'throttle'], ['Brake pressure', 'brake'], ['Boost', 'boost'], ['Clutch', 'clutch'], ['Brake pedal', 'brakePedal']]],
    ['Dynamics', [['Lateral G', 'latG'], ['Longitudinal G', 'longG'], ['Yaw rate', 'yaw'], ['Steering', 'steer'], ['Wheels FL · FR · RL · RR (km/h)', 'wheels'], ['VSA', 'vsa'], ['Since start: AHA / VSA / ABS', 'events']]],
    ['Engine', [['Coolant', 'coolant'], ['Intake air', 'intake'], ['Catalyst', 'catalyst'], ['Battery', 'battery'], ['Timing', 'timing'], ['Fuel trim short / long', 'trims'], ['Lambda actual / commanded', 'lambda'], ['Load / absolute load', 'load'], ['Throttle plate', 'plate']]],
    ['Body', [['Fuel', 'fuel'], ['Range', 'range'], ['Odometer', 'odo'], ['Outside', 'outside'], ['Lights', 'lights'], ['Indicators', 'indicators'], ['Wipers', 'wipers'], ['Handbrake', 'handbrake'], ['Reverse', 'reverse'], ['Seat belts', 'belts']]],
    ['Warnings', [['Warning lamps', 'lamps'], ['Check-engine lamp', 'mil'], ['Fault codes stored / pending', 'codes'], ['Power steering', 'eps'], ['Brake hold', 'hold']]],
  ]
  const vehiclePage = () => {
    const units = readSettings().units === 'f' ? 'f' : 'c'
    const groups = VEHICLE_GROUPS.map(([title, rows]) => `<div><h2>${esc(title)}</h2><table>${rows.map(([label, k]) => `<tr><td>${esc(label)}</td><td class="n" data-k="${k}">--</td></tr>`).join('')}</table></div>`).join('')
    return page(
      'Vehicle',
      `<h1>Vehicle <small id="live" class="dim">Waiting…</small></h1>
<div class="grid">${groups}<div><h2>G</h2><svg class="gdot" viewBox="0 0 180 180"><circle class="ring" cx="90" cy="90" r="80"/><circle class="ring" cx="90" cy="90" r="40"/><line class="ax" x1="10" y1="90" x2="170" y2="90" stroke="currentColor" opacity=".3"/><line x1="90" y1="10" x2="90" y2="170" stroke="currentColor" opacity=".3"/><circle id="dot" class="dot" cx="90" cy="90" r="7"/></svg><p class="dim">Rings at 0.5 g and 1 g. Up is accelerating, right is a right-hand turn.</p></div></div>
<p class="dim">Updated every second, read-only. Engine values (timing, trims, lambda, load, battery, fault codes) need Drive recording on "Listen + engine data".</p>
<script>window.S660_UNITS=${JSON.stringify(units)}</script><script>${VEHICLE_JS}</script>`,
      { wide: true },
    )
  }

  // ---- drive history
  const fmtDuration = s => (s === null || s === undefined ? '--' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`)
  const short = s => (s === null || s === undefined ? '--' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`)
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  const fmtMb = b => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`
  const temp = (c, units) => (c === null || c === undefined ? '--' : units === 'f' ? `${Math.round((c * 9) / 5 + 32)} °F` : `${c} °C`)
  const parked = sm => sm && sm.distanceKm < 0.1

  const drivesPage = url => {
    if (!drives) return page('Drives', '<h1>Drives</h1><p class="bad">The drive history is not installed on this unit (s660-drives.js).</p>')
    const list = drives.list()
    if (list === null) return page('Drives', '<h1>Drives</h1><p>No recordings yet. Switch on Settings → Options → Drive recording.</p>')
    drives.prune(new Set(list.map(d => d.name)))
    const showParked = url.searchParams.get('all') === '1'
    const missing = list.filter(d => !d.recording && !d.summary).map(d => d.name)
    drives.want(missing)
    const rows = list
      .filter(d => showParked || !parked(d.summary))
      .map(d => {
        const sm = d.summary
        const cells = d.recording
          ? `<td colspan="6" class="dim">Recording now</td>`
          : !sm
            ? `<td colspan="6" class="dim">Working it out…</td>`
            : `<td class="n">${short((sm.end - sm.start) / 1000)}</td><td class="n">${parked(sm) ? 'parked' : `${sm.distanceKm.toFixed(1)} km`}</td><td class="n">${Math.round(sm.max.speedKmh)}</td><td class="n">${sm.max.rpm}</td><td class="n">${sm.events.agile}/${sm.events.active}/${sm.events.abs}</td><td>${sm.requests && sm.requests.codes.length ? `<span class="bad">${esc(sm.requests.codes.join(', '))}</span>` : sm.requests ? 'none' : '<span class="dim">not read</span>'}</td>`
        return `<tr><td><a href="/drives/${esc(d.name)}">${esc(d.when)}</a><br><span class="dim">${d.mode === 'engine' ? 'with engine data' : 'listen only'} · ${fmtMb(d.bytes)}</span></td>${cells}</tr>`
      })
      .join('')
    const hidden = list.filter(d => parked(d.summary)).length
    return page(
      'Drives',
      `${missing.length ? '<meta http-equiv="refresh" content="10">' : ''}<h1>Drives</h1>
<p class="dim">Every recording the drive recorder made, newest first. ${missing.length ? `Working out ${missing.length} summar${missing.length === 1 ? 'y' : 'ies'} (each log is read once); this page refreshes.` : ''}</p>
<table><tr><th>Started</th><th>Length</th><th>Distance</th><th>Top km/h</th><th>Top rpm</th><th>AHA/VSA/ABS</th><th>Fault codes</th></tr>${rows || '<tr><td colspan="7">None.</td></tr>'}</table>
<p>${showParked ? '<a href="/drives">Hide the parked recordings</a>' : hidden ? `<a href="/drives?all=1">Show ${hidden} parked recording${hidden === 1 ? '' : 's'}</a> (ignition on, car not moving)` : ''}</p>`,
      { wide: true },
    )
  }

  // A line chart of one trace column, drawn on the server as SVG (no scripts or libraries needed).
  const chart = (series, col, label, unit, { col2 = null, label2 = '', zero = false } = {}) => {
    const W = 1000, H = 170, L = 52, R = 8, T = 18, B = 22
    const pts = series.filter(r => r[col] !== null)
    if (pts.length < 2) return ''
    const vals = series.flatMap(r => [r[col], col2 === null ? null : r[col2]]).filter(v => v !== null)
    let lo = Math.min(...vals), hi = Math.max(...vals)
    if (zero) lo = Math.min(lo, 0)
    if (hi === lo) hi = lo + 1
    const tMax = series[series.length - 1][0] || 1
    const x = t => L + ((W - L - R) * t) / tMax
    const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo))
    const path = c => series.filter(r => r[c] !== null).map((r, i) => `${i ? 'L' : 'M'}${x(r[0]).toFixed(1)} ${y(r[c]).toFixed(1)}`).join('')
    const ticks = [lo, (lo + hi) / 2, hi].map(v => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.abs(hi - lo) < 5 ? v.toFixed(2) : Math.round(v)}</text><line class="ax" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" opacity=".35"/>`).join('')
    const minutes = Array.from({ length: Math.floor(tMax / 300) + 1 }, (_, i) => i * 300).map(t => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${t / 60} min</text>`).join('')
    return `<h2>${esc(label)} <span class="dim">(${esc(unit)})</span>${col2 !== null ? ` <span class="dim">· white: ${esc(label2)}</span>` : ''}</h2>
<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${ticks}${minutes}${col2 !== null ? `<path class="ln2" d="${path(col2)}"/>` : ''}<path class="ln" d="${path(col)}"/></svg>`
  }

  const drivePage = name => {
    const d = drives && drives.get(name)
    if (!d) return null
    const units = readSettings().units
    const sm = d.summary
    if (!sm) {
      if (!d.recording) drives.want([name])
      return page('Drive', `<meta http-equiv="refresh" content="10"><h1>${esc(d.when)}</h1><p>${d.recording ? 'Still recording. The summary is worked out once it ends.' : 'Working out the summary (the whole log is read once). This page refreshes.'}</p>`)
    }
    const row = (k, v) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`
    const n = (v, dp, unit) => (v === null || v === undefined ? '--' : `${(+v).toFixed(dp)} ${unit}`)
    const m = sm.max
    const gears = Object.entries(sm.gearS).sort().map(([g, s]) => `${esc(g)} ${mmss(s)}`).join(' · ') || '--'
    const rq = sm.requests
    const S = sm.series
    // series columns: t, speed, rpm, boost, latG, longG, coolant, throttle, gear
    return page(
      'Drive',
      `<h1>${esc(d.when)} <small class="dim">${d.mode === 'engine' ? 'with engine data' : 'listen only'}</small></h1>
<p><a href="/drives">← All drives</a></p>
<div class="grid"><div><h2>Trip</h2><table>
${row('Length', fmtDuration((sm.end - sm.start) / 1000))}${row('Moving', fmtDuration(sm.movingS))}
${row('Distance', parked(sm) ? 'parked' : `${sm.distanceKm.toFixed(1)} km`)}${row('Odometer', sm.odometer.start === null ? '--' : `${sm.odometer.start.toLocaleString()} → ${sm.odometer.end.toLocaleString()} km`)}
${row('Fuel', sm.fuelPct.start === null ? '--' : `${sm.fuelPct.start} → ${sm.fuelPct.end} %`)}${row('Outside', temp(sm.outsideC, units))}
${row('Time in each gear (m:ss)', gears)}${row('Stalls', sm.stalls)}</table></div>
<div><h2>Peaks</h2><table>
${row('Speed', n(m.speedKmh, 0, 'km/h'))}${row('Engine', `${m.rpm} rpm`)}${row('Boost', n(m.boostBar, 2, 'bar'))}
${row('Lateral G (1 s average)', n(m.latG, 2, 'g'))}${row('Accelerating', n(m.longG, 2, 'g'))}${row('Braking', `${n(m.brakeG, 2, 'g')} · ${n(m.brakeMpa, 1, 'MPa')}`)}
${row('Coolant', temp(m.coolantC, units))}${row('Intake air', temp(m.intakeC, units))}</table></div>
<div><h2>Safety systems and faults</h2><table>
${row('AHA (Agile Handling Assist)', sm.events.agile)}${row('VSA interventions', sm.events.active)}${row('ABS', sm.events.abs)}
${row('Fault codes', !rq ? '<span class="dim">not read (listen-only recording)</span>' : rq.codes.length ? `<span class="bad">${esc(rq.codes.join(', '))}</span>` : 'none')}
${row('Battery', !rq || rq.batteryV.min === null ? '--' : `${rq.batteryV.min.toFixed(2)} – ${rq.batteryV.max.toFixed(2)} V`)}</table></div></div>
${chart(S, 1, 'Speed', 'km/h', { zero: true })}${chart(S, 2, 'Engine', 'rpm', { zero: true })}${chart(S, 3, 'Boost', 'bar')}
${chart(S, 4, 'Lateral G', 'g, + = turning left', { col2: 5, label2: 'longitudinal G' })}${chart(S, 7, 'Accelerator', '%', { zero: true })}${chart(S, 6, 'Coolant', '°C')}
<p class="dim">One point a second from the bus recording. Peaks are worked out five times a second.</p>`,
      { wide: true },
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
    if (path === '/vehicle' && !post) return send(res, 200, vehiclePage())
    if (path === '/vehicle.json' && !post) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify(vehicleData ? vehicleData() : { live: false }))
    }
    if (path === '/drives' && !post) return send(res, 200, drivesPage(url))
    if (path.startsWith('/drives/') && !post) {
      const html = drivePage(path.slice('/drives/'.length))
      return html ? send(res, 200, html) : send(res, 404, page('Not found', '<h1>No such drive</h1><p><a href="/drives">All drives</a></p>'))
    }
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
