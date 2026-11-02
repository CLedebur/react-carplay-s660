import { ReactNode, useEffect, useRef, useState } from 'react'
import './native.css'
import { FocusId, HoldAction, Panel, SETTINGS_TABS, tabsOf, UiState } from './nav'
import { CycleKey, logicalWidth, OUTPUT_HEIGHT, OUTPUT_WIDTH, Settings as SettingsValues, toFahrenheit } from './settings'
import { VehicleData } from './vehicle'
import { VehiclePage } from './VehicleTabs'
import { vehicleDemo } from './useVehicle'
import { initialGearPopup, stepGearPopup } from './gearPopup'
import { NetBusy, PowerNotice } from './useHeadUnit'
import { NetworkInfo } from './useNetwork'
import { WebAdminState } from './useWebAdmin'
import { SystemStats } from './useSystemStats'

const STUCK_AFTER_MS = 20000 // dongle found but no phone for this long: show the Bluetooth hint
const THROTTLE_C = 80 // the CM4 starts throttling here
const WARM_C = 70

export interface NativeUiProps {
  ui: UiState
  streaming: boolean // CarPlay's video is what is on the glass
  phone: boolean // the phone is connected (whether or not CarPlay is shown)
  settings: SettingsValues
  reloadPending: boolean // a setting changed that only reaches the dongle when CarPlay reloads
  dongle: boolean | null // null until the first USB check
  linkStatus: string | null // the app's status line, e.g. "Scanning for phone…"
  stats: SystemStats | null
  vehicle: VehicleData | null
  network: NetworkInfo | null
  web: WebAdminState | null
  netBusy: NetBusy | null
  holding: HoldAction | null
  power: PowerNotice | null
  lastKey: string | null
  streamLabel: string
}

const Icon = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <svg className={`ico ${className}`} viewBox="0 0 24 24">
    {children}
  </svg>
)
const CarIcon = () => (
  <Icon>
    <path d="M5 16V9l2-4h10l2 4v7" />
    <path d="M3 16h18v3H3z" />
    <circle cx="7.5" cy="12.5" r=".6" />
    <circle cx="16.5" cy="12.5" r=".6" />
  </Icon>
)
const GaugeIcon = () => (
  <Icon>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 18l4-6" />
  </Icon>
)
const SlidersIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
)
const RestartIcon = () => (
  <Icon>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v5h-5" />
  </Icon>
)
const PowerIcon = () => (
  <Icon>
    <path d="M12 3v9" />
    <path d="M6.4 6.8a8 8 0 1 0 11.2 0" />
  </Icon>
)

const useClock = (format: SettingsValues['clock']) => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(id)
  }, [])
  const h = now.getHours()
  const mm = String(now.getMinutes()).padStart(2, '0')
  if (format === '24h') return `${String(h).padStart(2, '0')}:${mm}`
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

const fmt = (n: number | null, unit = '', digits = 0) => (n === null ? '--' : `${n.toFixed(digits)}${unit}`)
const fmtUptime = (s: number | null) =>
  s === null
    ? '--'
    : `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

const focusClass = (focus: FocusId, id: FocusId) => (focus === id ? ' focused' : '')

// The drive recorder, for the Status row. "Sending" whenever the adapter is out of silent mode.
const recLabel = (setting: SettingsValues['driveLog'], stats: SystemStats | null) => {
  const d = stats?.driveLog
  if (setting === 'off') return 'Off'
  if (!d) return '-- (recorder not running)'
  if (!d.recording) return '○ Waiting for the car'
  return `● ${d.engine ? 'Listening + sending' : 'Listening'} · ${(d.bytes / 1e6).toFixed(0)} MB`
}

const Rail = ({ panel, focus }: { panel: Panel; focus: FocusId }) => (
  <div className="rail">
    <div className={`item f${panel === 'carplay' ? ' active' : ''}${focusClass(focus, 'rail:carplay')}`}>
      <CarIcon />
      CarPlay
    </div>
    <div className={`item f${panel === 'vehicle' ? ' active' : ''}${focusClass(focus, 'rail:vehicle')}`}>
      <GaugeIcon />
      Vehicle
    </div>
    <div className={`item f${panel === 'settings' ? ' active' : ''}${focusClass(focus, 'rail:settings')}`}>
      <SlidersIcon />
      Settings
    </div>
  </div>
)

const Waiting = ({ dongle, linkStatus, phone }: Pick<NativeUiProps, 'dongle' | 'linkStatus' | 'phone'>) => {
  const [stuck, setStuck] = useState(false)
  const armed = dongle === true && !phone
  useEffect(() => {
    setStuck(false)
    if (!armed) return
    const id = setTimeout(() => setStuck(true), STUCK_AFTER_MS)
    return () => clearTimeout(id)
  }, [armed])

  const dongleStep =
    dongle === true
      ? { cls: 'done', mark: '✓', state: 'Found' }
      : dongle === false
        ? { cls: 'now', mark: '!', state: 'Not found' }
        : { cls: 'now', mark: '…', state: 'Looking' }
  const phoneStep = phone
    ? { cls: 'done', mark: '✓', state: 'Connected' }
    : dongle === true
      ? { cls: 'now', mark: '…', state: 'Searching' }
      : { cls: 'todo', mark: '2', state: 'Waiting' }
  const videoStep = phone ? { cls: 'now', mark: '…', state: 'Ready' } : { cls: 'todo', mark: '3', state: 'Waiting' }

  return (
    <div className="content wait">
      <h2>{phone ? 'Phone connected' : 'Waiting for your phone'}</h2>
      {phone && <p className="sub">Press the knob on CarPlay to open it.</p>}
      <div className="steps">
        {[
          { name: 'Dongle', ...dongleStep },
          { name: 'Phone Bluetooth', ...phoneStep },
          { name: 'CarPlay video', ...videoStep },
        ].map(s => (
          <div className={`step ${s.cls}`} key={s.name}>
            <span className="mark">{s.mark}</span>
            <span className="name">{s.name}</span>
            <span className="state">{s.state}</span>
          </div>
        ))}
      </div>
      {linkStatus && <div className="linkline">Status: {linkStatus}</div>}
      {stuck && (
        <div className="hint">
          <b>Stuck?</b> Check Bluetooth is ON on the phone, then wait 20 s.
        </div>
      )}
    </div>
  )
}

const Row = ({ k, v, tone = '' }: { k: string; v: string; tone?: '' | 'ok' | 'warn' | 'bad' | 'off' }) => (
  <div className="row">
    <span className="k">{k}</span>
    <span className={`v ${tone}`}>{v}</span>
  </div>
)

const ReloadIcon = () => (
  <Icon>
    <path d="M4 12a8 8 0 0 1 14-5" />
    <path d="M18 3v4h-4" />
    <path d="M20 12a8 8 0 0 1-14 5" />
    <path d="M6 21v-4h4" />
  </Icon>
)

const HOLD_LABEL: Record<HoldAction, string> = { reload: 'Reload CarPlay', restart: 'Restart', shutdown: 'Shut down' }

const PowerButton = ({ action, holding, focus }: { action: HoldAction; holding: HoldAction | null; focus: FocusId }) => (
  <div className={`btn f${focusClass(focus, action)}${holding === action ? ' holding' : ''}`}>
    <span className="fill" />
    {action === 'reload' ? <ReloadIcon /> : action === 'restart' ? <RestartIcon /> : <PowerIcon />}
    <span>{HOLD_LABEL[action]}</span>
    <small>hold</small>
  </div>
)

const OPTIONS: { [K in CycleKey]: { label: string; check?: boolean; show?: (v: SettingsValues[K]) => string } } = {
  carplayEnabled: { label: 'CarPlay (off: the phone cannot connect)', check: true },
  autoRunCarplay: { label: 'Automatically run CarPlay when the car starts', check: true },
  units: { label: 'Temperature units', show: v => (v === 'c' ? '°C' : '°F') },
  clock: { label: 'Clock', show: v => (v === '24h' ? '24-hour' : '12-hour') },
  handDrive: { label: 'Hand drive (CarPlay sidebar side)', show: v => (v === 'rhd' ? 'Right' : 'Left') },
  fps: { label: 'Video frame rate', show: v => `${v} fps` },
  wifiBand: { label: 'Dongle Wi-Fi band', show: v => (v === '5ghz' ? '5 GHz' : '2.4 GHz') },
  nightMode: { label: 'CarPlay night mode', check: true },
  carplayWidth: { label: 'CarPlay width (after Reload)', show: v => `${v} px${v === 896 ? ' · true shape' : ''}` },
  carplayShape: { label: 'CarPlay picture', show: v => (v === 'fill' ? 'Fill screen' : 'True shape') },
  gearPopup: { label: 'Gear pop-up over CarPlay', show: v => (v === 0 ? 'Off' : `${v} s`) },
  driveLog: { label: 'Drive recording', show: v => (v === 'off' ? 'Off' : v === 'listen' ? 'Listen only' : 'Listen + engine data') },
}

const OptionRow = <K extends CycleKey>({ k, settings, focus }: { k: K; settings: SettingsValues; focus: FocusId }) => {
  const meta = OPTIONS[k]
  const value = settings[k]
  return (
    <div className={`optrow f${focusClass(focus, `opt:${k}`)}`}>
      {meta.check && <span className="box">{value ? '✓' : ''}</span>}
      <span className="lbl">{meta.label}</span>
      {meta.check ? <span className="st">{value ? 'ON' : 'OFF'}</span> : <span className="st choice">‹ {meta.show?.(value)} ›</span>}
    </div>
  )
}

const VIA_LABEL = { wifi: 'Wi-Fi', bluetooth: 'your phone (Bluetooth)', ethernet: 'Ethernet' }

const NetworkPage = ({ network, netBusy, focus }: Pick<NativeUiProps, 'network' | 'netBusy'> & { focus: FocusId }) => {
  const wifi = network?.links.find(l => l.type === 'wifi')
  const phone = network?.links.find(l => l.type === 'bluetooth')
  const headline = network === null ? 'No answer from the unit' : network.via === null ? 'Offline' : network.internet ? `Online via ${VIA_LABEL[network.via]}` : `Linked via ${VIA_LABEL[network.via]}, no internet`
  const tone = network === null || network.via === null ? 'bad' : network.internet ? 'ok' : 'warn'
  const pct = (s: number | null) => (s === null ? '' : ` · ${s}%`)
  const label = netBusy?.state === 'connecting' ? 'Connecting…' : 'Connect through phone (Bluetooth)'
  return (
    <div className="content tabbed">
      <div className="card opts">
        <h3>Network</h3>
        <div className={`netline v ${tone}`}>{headline}</div>
        <Row k="Wi-Fi" v={wifi && wifi.state === 'connected' ? `${wifi.name ?? '?'}${pct(wifi.signal)}` : '○ Not connected'} tone={wifi?.state === 'connected' ? 'ok' : 'off'} />
        <Row k="Phone (Bluetooth)" v={phone && phone.state === 'connected' ? `● ${phone.ip ?? 'linked'}` : network?.bluetoothProfile ? '○ Not connected' : '○ Not set up'} tone={phone?.state === 'connected' ? 'ok' : 'off'} />
        <Row k="IP address" v={(network && network.links.find(l => l.type === network.via)?.ip) || '--'} />
        <Row k="Saved Wi-Fi networks" v={network ? String(network.savedWifi) : '--'} />
      </div>
      <div className={`btn f net${focusClass(focus, 'netConnect')}${netBusy?.state === 'connecting' ? ' busy' : ''}`}>
        <span>{label}</span>
      </div>
      {netBusy?.state === 'failed' && <div className="hint note"><b>Could not connect.</b> {netBusy.error}</div>}
    </div>
  )
}

const WebRow = ({ web, focus }: { web: WebAdminState | null; focus: FocusId }) => (
  <div className={`optrow web f${focusClass(focus, 'webAdmin')}`}>
    <span className="box">{web?.enabled ? '✓' : ''}</span>
    <span className="lbl">
      Web interface (phone browser)
      {web?.enabled && (
        <small>
          {web.urls.length ? web.urls.join('  ') : 'no network address yet'} · PIN {web.pin}
        </small>
      )}
      {web === null && <small>not available</small>}
    </span>
    <span className="st">{web?.enabled ? 'ON' : 'OFF'}</span>
  </div>
)

const Settings = ({ ui, stats, vehicle, network, web, netBusy, holding, lastKey, streaming, streamLabel, settings, reloadPending }: Pick<NativeUiProps, 'ui' | 'stats' | 'vehicle' | 'network' | 'web' | 'netBusy' | 'holding' | 'lastKey' | 'streaming' | 'streamLabel' | 'settings' | 'reloadPending'>) => {
  const focus = ui.focus
  const tab = ui.tab.settings

  if (tab === 'options' || tab === 'carplay') {
    const items = SETTINGS_TABS.find(t => t.id === tab)!.items
    const keys = items.filter(id => id.startsWith('opt:')).map(id => id.slice(4) as CycleKey)
    return (
      <div className="content tabbed">
        <div className="card opts">
          <h3>{tab === 'options' ? 'Options' : 'CarPlay'}</h3>
          {keys.map(k => (
            <OptionRow key={k} k={k} settings={settings} focus={focus} />
          ))}
          {tab === 'options' && <WebRow web={web} focus={focus} />}
        </div>
        {tab === 'carplay' && <ReloadNote pending={reloadPending} />}
      </div>
    )
  }

  if (tab === 'network') return <NetworkPage network={network} netBusy={netBusy} focus={focus} />

  if (tab === 'display') return <DisplayPage focus={focus} settings={settings} />

  if (tab === 'power') {
    return (
      <div className="content tabbed">
        <div className="card opts">
          <h3>Maintenance</h3>
          <div className="maint">
            <PowerButton action="reload" holding={holding} focus={focus} />
          </div>
        </div>
        {reloadPending && <ReloadNote pending />}
        <div className="power">
          <PowerButton action="restart" holding={holding} focus={focus} />
          <PowerButton action="shutdown" holding={holding} focus={focus} />
        </div>
      </div>
    )
  }

  const f = settings.units === 'f'
  const conv = (c: number) => (f ? toFahrenheit(c) : c)
  const unit = f ? '°F' : '°C'
  const t = stats?.cpuTempC ?? null
  const tempTone = t === null ? 'off' : t >= THROTTLE_C ? 'bad' : t >= WARM_C ? 'warn' : 'ok'
  const tempTag = t === null ? '--' : t >= THROTTLE_C ? 'HOT' : t >= WARM_C ? 'WARM' : 'NORMAL'
  const p = stats?.power ?? null
  const supply = p === null ? ['--', 'off'] : p.underVoltageNow ? ['LOW VOLTAGE', 'bad'] : p.underVoltageEver ? ['Dipped earlier', 'warn'] : ['OK', 'ok']
  const throttled = p === null ? ['--', 'off'] : p.throttledNow ? ['YES', 'bad'] : p.softTempLimitNow ? ['Soft limit', 'warn'] : ['No', 'ok']
  const decode =
    stats?.videoDecoderBusy == null
      ? ['--', 'off']
      : stats.videoDecoderBusy
        ? ['Hardware', 'ok']
        : streaming
          ? ['SOFTWARE', 'bad'] // streaming but nothing holds /dev/video10
          : ['Idle', 'off']
  const mem = stats?.memUsedMb != null && stats.memTotalMb != null ? `${(stats.memUsedMb / 1024).toFixed(1)} / ${(stats.memTotalMb / 1024).toFixed(1)} GB` : '--'
  const nvme = stats?.nvmeTempC ?? null

  return (
    <div className="content tabbed">
      <div className="set">
        <div className="card cm4">
          <h3>Computer (CM4)</h3>
          <div className="big">
            <span className="n">{fmt(t === null ? null : conv(t))}</span>
            <span className="u">{unit}</span>
            <span className="tag" style={{ color: `var(--${tempTone === 'off' ? 'dim' : tempTone})` }}>
              {tempTag}
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.min(100, t ?? 0)}%` }} />
            <span className="tick" style={{ left: `${THROTTLE_C}%` }} />
          </div>
          <div className="scale">
            <span>{Math.round(conv(0))}</span>
            <span>throttles at {Math.round(conv(THROTTLE_C))}</span>
            <span>{Math.round(conv(100))}</span>
          </div>
          <Row k="NVMe drive" v={fmt(nvme === null ? null : conv(nvme), ` ${unit}`)} />
          <Row k="CPU load" v={fmt(stats?.cpuLoadPct ?? null, ' %')} />
          <Row k="Memory" v={mem} />
          <Row k="Power supply" v={supply[0]} tone={supply[1] as 'ok'} />
          <Row k="Throttled" v={throttled[0]} tone={throttled[1] as 'ok'} />
          <Row k="Up for" v={fmtUptime(stats?.uptimeSec ?? null)} />
        </div>
        <div className="card">
          <h3>Controls (MITM)</h3>
          <Row k="Pico link" v={stats ? (stats.mitmLinked ? '● Connected' : '○ Not found') : '--'} tone={stats ? (stats.mitmLinked ? 'ok' : 'bad') : 'off'} />
          <Row k="Last key" v={lastKey ?? '--'} />
          <Row k="CAN bus" v={vehicle === null ? '--' : vehicle.live ? '● Receiving' : '○ No signal'} tone={vehicle?.live ? 'ok' : 'off'} />
          <Row k="Drive rec" v={recLabel(settings.driveLog, stats)} tone={stats?.driveLog?.recording ? (stats.driveLog.engine ? 'warn' : 'ok') : 'off'} />
        </div>
        <div className="card">
          <h3>CarPlay &amp; storage</h3>
          <Row k="Video decode" v={decode[0]} tone={decode[1] as 'ok'} />
          <Row k="Stream" v={streamLabel} />
          <Row k="Overlay disk" v={stats ? (stats.overlayRoot ? 'ON · temp' : 'OFF · saved') : '--'} tone={stats?.overlayRoot ? 'warn' : ''} />
          <Row k="/persist free" v={fmt(stats?.persistFreeGb ?? null, ' GB')} />
        </div>
      </div>
    </div>
  )
}


const ratio = (g: number) => (g / 1000).toFixed(3)

const DisplayPage = ({ focus, settings }: { focus: FocusId; settings: SettingsValues }) => {
  const glassAspect = settings.glassAspect
  return (
  <div className="content tabbed">
    <div className="card opts">
      <h3>Screen shape</h3>
      <div className="aspectline">
        <span className="n">{ratio(glassAspect)}</span> : 1<span className="px"> · drawn {logicalWidth(glassAspect)} × {OUTPUT_HEIGHT}</span>
      </div>
      <div className="note dim">
        The glass is 135×72 mm (1.875 : 1); the panel is fed {OUTPUT_WIDTH}×{OUTPUT_HEIGHT}.
      </div>
    </div>
    <div className={`btn f net compact${focusClass(focus, 'aspect')}`}>
      <span>Adjust with test pattern</span>
    </div>
    <div className={`btn f net two${focusClass(focus, 'aspectReset')}`}>
      <span>Reset to 1.875 : 1</span>
    </div>
    <OptionRow k="carplayShape" settings={settings} focus={focus} />
    <OptionRow k="carplayWidth" settings={settings} focus={focus} />
  </div>
  )
}

// Full-screen grid, drawn square on the glass. Cells are 1/10 of the height (7.2 mm on a 72 mm glass).
// If the ratio is right: every cell is square, the circles are round, the diagonals cross the corners
// of the big square, and the frame touches all four edges.
const AspectPattern = ({ glassAspect, fine }: { glassAspect: number; fine: boolean }) => {
  const w = logicalWidth(glassAspect)
  const h = OUTPUT_HEIGHT
  const cell = h / 10
  const cx = w / 2
  const cy = h / 2
  const vx = Array.from({ length: Math.floor(w / cell) + 1 }, (_, i) => i * cell)
  const vy = Array.from({ length: 11 }, (_, i) => i * cell)
  return (
    <div className="pattern">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {vx.map(x => (
          <line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} className={Math.abs(x - cx) < 1 ? 'axis' : 'grid'} />
        ))}
        {vy.map(y => (
          <line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} className={y === h / 2 ? 'axis' : 'grid'} />
        ))}
        <line x1={0} y1={0} x2={w} y2={h} className="diag" />
        <line x1={w} y1={0} x2={0} y2={h} className="diag" />
        <circle cx={cx} cy={cy} r={h / 2 - 4} className="shape" />
        <circle cx={cx} cy={cy} r={h / 4} className="shape" />
        <rect x={cx - h / 4} y={cy - h / 4} width={h / 2} height={h / 2} className="shape solid" />
        <rect x={cx - h / 2 + 4} y={cy - h / 2 + 4} width={h - 8} height={h - 8} className="shape" />
        <circle cx={h / 2 - 12} cy={h / 2} r={h / 6} className="shape" />
        <circle cx={w - h / 2 + 12} cy={h / 2} r={h / 6} className="shape" />
        <rect x={2} y={2} width={w - 4} height={h - 4} className="frame" />
      </svg>
      <div className="pattern-cap">
        <div className="big">
          <span className="n">{ratio(glassAspect)}</span> : 1
        </div>
        <div>
          Knob ← → changes it · PUSH: fine / coarse (now {fine ? 'FINE' : 'COARSE'}) · BACK saves
        </div>
        <div className="dim">Squares square, circles round, frame touching all four edges.</div>
      </div>
    </div>
  )
}

const TabBar = ({ ui }: { ui: UiState }) => {
  const tabs = tabsOf(ui.panel)
  const current = ui.panel === 'settings' ? ui.tab.settings : ui.tab.vehicle
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    const on = el?.querySelector<HTMLElement>('.tab.on')
    if (!el || !on) return
    el.scrollLeft = Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2) // keep the shown tab in view
  }, [current, ui.panel])
  return (
    <div className="tabs" ref={box}>
      {tabs.map(t => (
        <div key={t.id} className={`tab f${t.id === current ? ' on' : ''}${focusClass(ui.focus, `tab:${t.id}`)}`}>
          {t.label}
        </div>
      ))}
    </div>
  )
}

// Everything is drawn on a canvas as wide as the glass is (aspect x 480) and squeezed into the 720 pixels
// the panel is fed, so the panel's own stretch gives square pixels back.
const Fit = ({ glassAspect, className = '', children }: { glassAspect: number; className?: string; children: ReactNode }) => {
  const w = logicalWidth(glassAspect)
  return (
    <div className={`fit ${className}`} style={{ width: w, transform: `scaleX(${OUTPUT_WIDTH / w})` }}>
      {children}
    </div>
  )
}

const ReloadNote = ({ pending }: { pending: boolean }) =>
  pending ? (
    <div className="hint note">
      <b>Changes waiting.</b> Hand drive, frame rate, Wi-Fi band and CarPlay width apply after Reload CarPlay (Power tab).
    </div>
  ) : (
    <div className="note dim">Hand drive, frame rate, Wi-Fi band and CarPlay width apply after Reload CarPlay (Power tab).</div>
  )

const Switcher = ({ focus, glassAspect }: { focus: FocusId; glassAspect: number }) => (
  <>
    <div className="nui-dim" />
    <div className="nui">
     <Fit glassAspect={glassAspect}>
      <div className="cap">Panels · turn knob · press to open · BACK to close</div>
      <div className="bar2">
        <div className={`opt f${focusClass(focus, 'sw:carplay')}`}>
          <CarIcon />
          CarPlay
        </div>
        <div className={`opt f${focusClass(focus, 'sw:vehicle')}`}>
          <GaugeIcon />
          Vehicle
        </div>
        <div className={`opt f${focusClass(focus, 'sw:settings')}`}>
          <SlidersIcon />
          Settings
        </div>
      </div>
     </Fit>
    </div>
  </>
)

const PowerScreen = ({ power, glassAspect }: { power: PowerNotice; glassAspect: number }) => {
  const word = power.action === 'restart' ? 'restart' : 'shut down'
  return (
    <div className={`nui-bye${power.state === 'failed' ? ' failed' : ''}`}>
      <div className="nui">
        <Fit glassAspect={glassAspect} className="bye">
          {power.state === 'failed' ? (
            <>
              <h2>Could not {word}</h2>
              <p>{power.error}</p>
            </>
          ) : (
            <>
              <h2>{power.action === 'restart' ? 'Restarting…' : 'Shutting down…'}</h2>
              <p>
                {power.action === 'restart'
                  ? 'Back in about 10 seconds. CarPlay reconnects by itself.'
                  : 'Wait for the screen to go dark before you switch off the ignition.'}
              </p>
            </>
          )}
        </Fit>
      </div>
    </div>
  )
}

const TITLES = { carplay: 'CarPlay', vehicle: 'Vehicle', settings: 'Settings' }

// The gear after a shift, over CarPlay's top-right corner, for settings.gearPopup seconds (gearPopup.ts).
const useGearPopup = (vehicle: VehicleData | null, seconds: number) => {
  const [state, setState] = useState(initialGearPopup)
  const gear = vehicle?.live ? vehicle.gear : null
  useEffect(() => setState(s => stepGearPopup(s, gear, Date.now(), seconds * 1000)), [gear, vehicle, seconds])
  useEffect(() => {
    if (state.shown === null) return
    const id = setTimeout(() => setState(s => stepGearPopup(s, gear, Date.now(), seconds * 1000)), Math.max(0, state.until - Date.now()))
    return () => clearTimeout(id)
  }, [state, gear, seconds])
  return state.shown
}

export const NativeUi = (props: NativeUiProps) => {
  const { ui, streaming, phone, settings, reloadPending, dongle, linkStatus, stats, vehicle, network, web, netBusy, holding, power, lastKey, streamLabel } = props
  const clock = useClock(settings.clock)
  const popGear = useGearPopup(vehicle, settings.gearPopup)
  // A tab with more rows than fit scrolls to keep the knob's row in view.
  useEffect(() => {
    document.querySelector('.nui .content.tabbed .f.focused')?.scrollIntoView({ block: 'nearest' })
  }, [ui.focus])
  // Outside air (0x21E), beside the clock; hidden when the car is not sending it.
  const outC = vehicle?.live ? vehicle.outsideC : null
  const outside = outC === null ? null : `${Math.round(settings.units === 'f' ? toFahrenheit(outC) : outC)}°${settings.units === 'f' ? 'F' : 'C'}`
  const pagesUp = !(ui.panel === 'carplay' && streaming) // the switcher alone dims the video instead
  const g = settings.glassAspect

  return (
    <div className="nui-root">
      {pagesUp && (
        <div className={`nui-page${ui.focus === 'pane' ? ' paning' : ''}`}>
          <div className="nui">
            <Fit glassAspect={g}>
              {ui.pattern ? (
                <AspectPattern glassAspect={g} fine={ui.fine} />
              ) : (
                <>
                  <div className="strip">
                    <span className="title">{TITLES[ui.panel]}</span>
                    <span className={`pill ${dongle ? 'ok' : 'off'}`}>
                      <i />
                      Dongle
                    </span>
                    <span className={`pill ${phone ? 'ok' : 'off'}`}>
                      <i />
                      {phone ? <>Phone <b>connected</b></> : 'Phone'}
                    </span>
                    {settings.driveLog !== 'off' && (
                      <span className={`pill ${stats?.driveLog?.recording ? (stats.driveLog.engine ? 'warn' : 'ok') : 'off'}`}>
                        <i />
                        Rec
                      </span>
                    )}
                    <span className={`pill ${stats?.mitmLinked ? 'ok' : 'off'}`}>
                      <i />
                      Controls
                    </span>
                    {outside !== null && <span className="otemp">{outside}</span>}
                    <span className="clock">{clock}</span>
                  </div>
                  <Rail panel={ui.panel} focus={ui.focus} />
                  {ui.panel !== 'carplay' && <TabBar ui={ui} />}
                  {ui.panel === 'settings' ? (
                    <Settings ui={ui} stats={stats} vehicle={vehicle} network={network} web={web} netBusy={netBusy} holding={holding} lastKey={lastKey} streaming={streaming} streamLabel={streamLabel} settings={settings} reloadPending={reloadPending} />
                  ) : ui.panel === 'vehicle' ? (
                    <VehiclePage tab={ui.tab.vehicle} data={vehicle} settings={settings} demo={vehicleDemo} />
                  ) : (
                    <Waiting dongle={dongle} linkStatus={linkStatus} phone={phone} />
                  )}
                </>
              )}
            </Fit>
          </div>
        </div>
      )}
      {popGear !== null && ui.panel === 'carplay' && streaming && !ui.switcher && (
        <div className="nui">
          <Fit glassAspect={g}>
            <div className="gearpop">{popGear}</div>
          </Fit>
        </div>
      )}
      {ui.switcher && <Switcher focus={ui.focus} glassAspect={g} />}
      {power && <PowerScreen power={power} glassAspect={g} />}
    </div>
  )
}
