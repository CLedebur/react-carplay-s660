import { ReactNode, useEffect, useState } from 'react'
import './native.css'
import { FocusId, HoldAction, Panel, settingsPage, SETTINGS_PAGES, UiState } from './nav'
import { SettingKey, Settings as SettingsValues, toFahrenheit } from './settings'
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

const Rail = ({ panel, focus }: { panel: Panel; focus: FocusId }) => (
  <div className="rail">
    <div className={`item f${panel === 'carplay' ? ' active' : ''}${focusClass(focus, 'rail:carplay')}`}>
      <CarIcon />
      CarPlay
    </div>
    <div className="item disabled">
      <GaugeIcon />
      Vehicle
      <small>OBD-II needed</small>
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

const OPTIONS: { [K in SettingKey]: { label: string; check?: boolean; show?: (v: SettingsValues[K]) => string } } = {
  autoRunCarplay: { label: 'Automatically run CarPlay when the car starts', check: true },
  units: { label: 'Temperature units', show: v => (v === 'c' ? '°C' : '°F') },
  clock: { label: 'Clock', show: v => (v === '24h' ? '24-hour' : '12-hour') },
  handDrive: { label: 'Hand drive (CarPlay sidebar side)', show: v => (v === 'rhd' ? 'Right' : 'Left') },
  fps: { label: 'Video frame rate', show: v => `${v} fps` },
  wifiBand: { label: 'Dongle Wi-Fi band', show: v => (v === '5ghz' ? '5 GHz' : '2.4 GHz') },
  nightMode: { label: 'CarPlay night mode', check: true },
}

const OptionRow = <K extends SettingKey>({ k, settings, focus }: { k: K; settings: SettingsValues; focus: FocusId }) => {
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

const Pager = ({ page }: { page: number }) => (
  <div className="pager">
    Page {page} of {SETTINGS_PAGES.length} · {SETTINGS_PAGES[page - 1].title} ·{' '}
    {page === 1 ? 'turn the knob → for options' : 'turn the knob ← →'}
  </div>
)

const VIA_LABEL = { wifi: 'Wi-Fi', bluetooth: 'your phone (Bluetooth)', ethernet: 'Ethernet' }

const NetworkPage = ({ network, netBusy, focus }: Pick<NativeUiProps, 'network' | 'netBusy'> & { focus: FocusId }) => {
  const wifi = network?.links.find(l => l.type === 'wifi')
  const phone = network?.links.find(l => l.type === 'bluetooth')
  const headline = network === null ? 'No answer from the unit' : network.via === null ? 'Offline' : network.internet ? `Online via ${VIA_LABEL[network.via]}` : `Linked via ${VIA_LABEL[network.via]}, no internet`
  const tone = network === null || network.via === null ? 'bad' : network.internet ? 'ok' : 'warn'
  const pct = (s: number | null) => (s === null ? '' : ` · ${s}%`)
  const label = netBusy?.state === 'connecting' ? 'Connecting…' : 'Connect through phone (Bluetooth)'
  return (
    <div className="content">
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
      <Pager page={4} />
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

const Settings = ({ ui, stats, network, web, netBusy, holding, lastKey, streaming, streamLabel, settings, reloadPending }: Pick<NativeUiProps, 'ui' | 'stats' | 'network' | 'web' | 'netBusy' | 'holding' | 'lastKey' | 'streaming' | 'streamLabel' | 'settings' | 'reloadPending'>) => {
  const focus = ui.focus
  const page = settingsPage(ui)

  if (page === 2 || page === 3) {
    const keys = SETTINGS_PAGES[page - 1].items.filter(id => id.startsWith('opt:')).map(id => id.slice(4) as SettingKey)
    return (
      <div className="content">
        <div className="card opts">
          <h3>{SETTINGS_PAGES[page - 1].title}</h3>
          {keys.map(k => (
            <OptionRow key={k} k={k} settings={settings} focus={focus} />
          ))}
          {page === 2 && <WebRow web={web} focus={focus} />}
        </div>
        {page === 3 && <ReloadNote pending={reloadPending} />}
        <Pager page={page} />
      </div>
    )
  }

  if (page === 4) return <NetworkPage network={network} netBusy={netBusy} focus={focus} />

  if (page === 5) {
    return (
      <div className="content">
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
        <Pager page={5} />
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
    <div className="content">
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
          <Row k="CAN bus" v="○ Not built" tone="off" />
        </div>
        <div className="card">
          <h3>CarPlay &amp; storage</h3>
          <Row k="Video decode" v={decode[0]} tone={decode[1] as 'ok'} />
          <Row k="Stream" v={streamLabel} />
          <Row k="Overlay disk" v={stats ? (stats.overlayRoot ? 'ON · temp' : 'OFF · saved') : '--'} tone={stats?.overlayRoot ? 'warn' : ''} />
          <Row k="/persist free" v={fmt(stats?.persistFreeGb ?? null, ' GB')} />
        </div>
      </div>
      <Pager page={1} />
    </div>
  )
}

const ReloadNote = ({ pending }: { pending: boolean }) =>
  pending ? (
    <div className="hint note">
      <b>Changes waiting.</b> Hand drive, frame rate and Wi-Fi band apply after Reload CarPlay (page 5).
    </div>
  ) : (
    <div className="note dim">Hand drive, frame rate and Wi-Fi band apply after Reload CarPlay (page 5).</div>
  )

const Switcher = ({ focus }: { focus: FocusId }) => (
  <>
    <div className="nui-dim" />
    <div className="nui">
      <div className="cap">Panels · turn knob · press to open · BACK to close</div>
      <div className="bar2">
        <div className={`opt f${focusClass(focus, 'sw:carplay')}`}>
          <CarIcon />
          CarPlay
        </div>
        <div className="opt disabled">
          <GaugeIcon />
          Vehicle
          <small>OBD-II needed</small>
        </div>
        <div className={`opt f${focusClass(focus, 'sw:settings')}`}>
          <SlidersIcon />
          Settings
        </div>
      </div>
    </div>
  </>
)

const PowerScreen = ({ power }: { power: PowerNotice }) => {
  const word = power.action === 'restart' ? 'restart' : 'shut down'
  if (power.state === 'failed') {
    return (
      <div className="nui-bye failed">
        <h2>Could not {word}</h2>
        <p>{power.error}</p>
      </div>
    )
  }
  return (
    <div className="nui-bye">
      <h2>{power.action === 'restart' ? 'Restarting…' : 'Shutting down…'}</h2>
      <p>
        {power.action === 'restart'
          ? 'Back in about 10 seconds. CarPlay reconnects by itself.'
          : 'Wait for the screen to go dark before you switch off the ignition.'}
      </p>
    </div>
  )
}

export const NativeUi = (props: NativeUiProps) => {
  const { ui, streaming, phone, settings, reloadPending, dongle, linkStatus, stats, network, web, netBusy, holding, power, lastKey, streamLabel } = props
  const clock = useClock(settings.clock)
  const pagesUp = !(ui.panel === 'carplay' && streaming) // the switcher alone dims the video instead
  const title = ui.panel === 'settings' ? 'Settings' : 'CarPlay'

  return (
    <div className="nui-root">
      {pagesUp && (
        <div className="nui-page">
          <div className="nui">
            <div className="strip">
              <span className="title">{title}</span>
              <span className={`pill ${dongle ? 'ok' : 'off'}`}>
                <i />
                Dongle
              </span>
              <span className={`pill ${phone ? 'ok' : 'off'}`}>
                <i />
                {phone ? <>Phone <b>connected</b></> : 'Phone'}
              </span>
              <span className={`pill ${stats?.mitmLinked ? 'ok' : 'off'}`}>
                <i />
                Controls
              </span>
              <span className="clock">{clock}</span>
            </div>
            <Rail panel={ui.panel} focus={ui.focus} />
            {ui.panel === 'settings' ? (
              <Settings ui={ui} stats={stats} network={network} web={web} netBusy={netBusy} holding={holding} lastKey={lastKey} streaming={streaming} streamLabel={streamLabel} settings={settings} reloadPending={reloadPending} />
            ) : (
              <Waiting dongle={dongle} linkStatus={linkStatus} phone={phone} />
            )}
          </div>
        </div>
      )}
      {ui.switcher && <Switcher focus={ui.focus} />}
      {power && <PowerScreen power={power} />}
    </div>
  )
}
