import { ReactNode, useEffect, useState } from 'react'
import './native.css'
import { FocusId, Panel, PowerAction, UiState } from './nav'
import { PowerNotice } from './useHeadUnit'
import { SystemStats } from './useSystemStats'

const STUCK_AFTER_MS = 20000 // dongle found but no phone for this long: show the Bluetooth hint
const THROTTLE_C = 80 // the CM4 starts throttling here
const WARM_C = 70

export interface NativeUiProps {
  ui: UiState
  streaming: boolean
  dongle: boolean | null // null until the first USB check
  linkStatus: string | null // the app's status line, e.g. "Scanning for phone…"
  stats: SystemStats | null
  holding: PowerAction | null
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

const useClock = () => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(id)
  }, [])
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
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

const Waiting = ({ dongle, linkStatus, streaming }: Pick<NativeUiProps, 'dongle' | 'linkStatus' | 'streaming'>) => {
  const [stuck, setStuck] = useState(false)
  const armed = dongle === true && !streaming
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
  const phoneStep = dongle === true ? { cls: 'now', mark: '…', state: 'Searching' } : { cls: 'todo', mark: '2', state: 'Waiting' }

  return (
    <div className="content wait">
      <h2>Waiting for your phone</h2>
      <p className="sub">CarPlay will open by itself once it connects.</p>
      <div className="steps">
        {[
          { name: 'Dongle', ...dongleStep },
          { name: 'Phone Bluetooth', ...phoneStep },
          { name: 'CarPlay video', cls: 'todo', mark: '3', state: 'Waiting' },
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

const PowerButton = ({ action, label, holding, focus }: { action: PowerAction; label: string; holding: PowerAction | null; focus: FocusId }) => (
  <div className={`btn f${focusClass(focus, action)}${holding === action ? ' holding' : ''}`}>
    <span className="fill" />
    {action === 'restart' ? <RestartIcon /> : <PowerIcon />}
    <span>{label}</span>
    <small>hold</small>
  </div>
)

const Settings = ({ stats, holding, focus, lastKey, streaming, streamLabel }: Pick<NativeUiProps, 'stats' | 'holding' | 'lastKey' | 'streaming' | 'streamLabel'> & { focus: FocusId }) => {
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

  return (
    <div className="content">
      <div className="set">
        <div className="card cm4">
          <h3>Computer (CM4)</h3>
          <div className="big">
            <span className="n">{fmt(t)}</span>
            <span className="u">°C</span>
            <span className="tag" style={{ color: `var(--${tempTone === 'off' ? 'dim' : tempTone})` }}>
              {tempTag}
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.min(100, t ?? 0)}%` }} />
            <span className="tick" style={{ left: `${THROTTLE_C}%` }} />
          </div>
          <div className="scale">
            <span>0</span>
            <span>throttles at {THROTTLE_C}</span>
            <span>100</span>
          </div>
          <Row k="NVMe drive" v={fmt(stats?.nvmeTempC ?? null, ' °C')} />
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
        <div className="power">
          <PowerButton action="restart" label="Restart" holding={holding} focus={focus} />
          <PowerButton action="shutdown" label="Shut down" holding={holding} focus={focus} />
        </div>
      </div>
    </div>
  )
}

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
  const { ui, streaming, dongle, linkStatus, stats, holding, power, lastKey, streamLabel } = props
  const clock = useClock()
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
              <span className={`pill ${streaming ? 'ok' : 'off'}`}>
                <i />
                {streaming ? <>Phone <b>connected</b></> : 'Phone'}
              </span>
              <span className={`pill ${stats?.mitmLinked ? 'ok' : 'off'}`}>
                <i />
                Controls
              </span>
              <span className="clock">{clock}</span>
            </div>
            <Rail panel={ui.panel} focus={ui.focus} />
            {ui.panel === 'settings' ? (
              <Settings stats={stats} holding={holding} focus={ui.focus} lastKey={lastKey} streaming={streaming} streamLabel={streamLabel} />
            ) : (
              <Waiting dongle={dongle} linkStatus={linkStatus} streaming={streaming} />
            )}
          </div>
        </div>
      )}
      {ui.switcher && <Switcher focus={ui.focus} />}
      {power && <PowerScreen power={power} />}
    </div>
  )
}
