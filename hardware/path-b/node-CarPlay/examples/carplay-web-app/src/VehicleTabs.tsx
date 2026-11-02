import { ReactNode, useRef } from 'react'
import { Settings, toFahrenheit } from './settings'
import { batteryState, emptyVehicle, gDot, HEADLIGHTS, RUNNING_RPM, VehicleData, WIPERS } from './vehicle'
import { VehicleTab } from './nav'

// The Vehicle panel's tabs. Read-only: the knob only moves between tabs. Values are null until the
// CAN service has seen their message, and then show "--". Layout is for the 790 x 364 content box.

// Display thresholds, not the car's own: where the readout turns amber / red.
const COOLANT_WARN_C = 105
const COOLANT_HOT_C = 110
const LOW_FUEL_PCT = 10 // the car's low-fuel lamp comes on near 10 % (raw 15)
const RPM_SCALE = 8000
const BOOST_MIN = -0.8
const BOOST_MAX = 1.2
const BRAKE_MAX_MPA = 5
const G_RANGE = 1

type Tone = '' | 'ok' | 'warn' | 'bad'

const num = (n: number | null, digits = 0) => (n === null ? '--' : n.toFixed(digits))
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

const Card = ({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) => (
  <div className={`card vcard ${className}`}>
    {title && <h3>{title}</h3>}
    {children}
  </div>
)

const Big = ({ value, unit, tone = '', size = '' }: { value: string; unit?: string; tone?: Tone; size?: '' | 'huge' | 'mid' }) => (
  <div className={`vbig ${size}`}>
    <span className={`n v ${tone}`}>{value}</span>
    {unit && <span className="u">{unit}</span>}
  </div>
)

// A bar from `min` to `max`, filled from `from` (the zero of a bipolar bar) to the value.
const Bar = ({ value, min = 0, max = 100, from = min, ticks = [], tone = '' }: { value: number | null; min?: number; max?: number; from?: number; ticks?: { at: number; label?: string }[]; tone?: Tone }) => {
  const pos = (v: number) => clamp01((v - min) / (max - min)) * 100
  const a = pos(from)
  const b = value === null ? a : pos(value)
  return (
    <div className="vbarwrap">
      <div className={`vbar ${tone}`}>
        <div style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />
        {ticks.map(t => (
          <span key={t.at} className={`vtick${t.label ? ' scale' : ''}`} style={{ left: `${pos(t.at)}%` }} />
        ))}
      </div>
      <div className="vticklabels">
        {ticks
          .filter(t => t.label)
          .map(t => (
            <span key={t.at} style={{ left: `${pos(t.at)}%` }}>
              {t.label}
            </span>
          ))}
      </div>
    </div>
  )
}

const Line = ({ label, value, unit, bar }: { label: string; value: string; unit: string; bar: ReactNode }) => (
  <div className="vline">
    <span className="k">{label}</span>
    {bar}
    <span className="val">
      {value} <small>{unit}</small>
    </span>
  </div>
)

const rpmTicks = Array.from({ length: 9 }, (_, i) => ({ at: i * 1000, label: String(i) }))

const Drive = ({ d }: { d: VehicleData }) => {
  const gear = d.reverse ? 'R' : d.gear === null ? '–' : String(d.gear)
  return (
    <div className="vgrid drive">
      <Card title="Speed">
        <Big value={num(d.speedKmh)} unit="km/h" size="huge" />
      </Card>
      <Card title="Gear (estimated)">
        <Big value={gear} size="huge" />
      </Card>
      <Card title="Engine speed" className="span2">
        <Big value={num(d.rpm)} unit="rpm" size="mid" />
        <Bar value={d.rpm} max={RPM_SCALE} ticks={rpmTicks} />
      </Card>
      <Card className="span2 lines">
        <Line label="Throttle" value={num(d.throttlePct)} unit="%" bar={<Bar value={d.throttlePct} />} />
        <Line
          label="Boost"
          value={d.boostBar === null ? '--' : (d.boostBar > 0 ? '+' : '') + d.boostBar.toFixed(2)}
          unit="bar"
          bar={<Bar value={d.boostBar} min={BOOST_MIN} max={BOOST_MAX} from={0} ticks={[{ at: 0 }]} />}
        />
        <Line label="Brake" value={num(d.brakeMpa, 1)} unit="MPa" bar={<Bar value={d.brakeMpa} max={BRAKE_MAX_MPA} />} />
      </Card>
    </div>
  )
}

const Engine = ({ d, units }: { d: VehicleData; units: Settings['units'] }) => {
  const f = units === 'f'
  const conv = (c: number | null) => (c === null ? null : f ? toFahrenheit(c) : c)
  const unit = f ? '°F' : '°C'
  const cool = d.coolantC
  const coolTone: Tone = cool === null ? '' : cool >= COOLANT_HOT_C ? 'bad' : cool >= COOLANT_WARN_C ? 'warn' : 'ok'
  const fuel = d.fuelPct
  const fuelTone: Tone = fuel === null ? '' : fuel <= LOW_FUEL_PCT ? 'warn' : ''
  return (
    <div className="vgrid engine">
      <Card title="Coolant">
        <Big value={num(conv(cool))} unit={unit} tone={coolTone} size="mid" />
        <Bar value={cool} min={40} max={120} tone={coolTone} ticks={[{ at: COOLANT_WARN_C }]} />
      </Card>
      <Card title="Fuel">
        <Big value={num(fuel)} unit="%" tone={fuelTone} size="mid" />
        <Bar value={fuel} tone={fuelTone} ticks={[{ at: LOW_FUEL_PCT }]} />
      </Card>
      <Card title="Intake air">
        <Big value={num(conv(d.intakeC))} unit={unit} size="mid" />
        <Bar value={d.intakeC} min={-10} max={80} />
      </Card>
      <Card title="Boost">
        <Big value={d.boostBar === null ? '--' : (d.boostBar > 0 ? '+' : '') + d.boostBar.toFixed(2)} unit="bar" size="mid" />
        <Bar value={d.boostBar} min={BOOST_MIN} max={BOOST_MAX} from={0} ticks={[{ at: 0 }]} />
      </Card>
    </div>
  )
}

const GPlot = ({ lat, long }: { lat: number | null; long: number | null }) => {
  const trail = useRef<{ x: number; y: number }[]>([])
  const R = 124
  const dot = gDot(lat, long, G_RANGE)
  const last = trail.current[trail.current.length - 1]
  if (!last || last.x !== dot.x || last.y !== dot.y) trail.current = [...trail.current.slice(-14), dot]
  const px = (v: number) => 140 + v * R
  return (
    <svg className="gplot" viewBox="0 0 280 280">
      <circle cx={140} cy={140} r={R} className="ring" />
      <circle cx={140} cy={140} r={R / 2} className="ring" />
      <line x1={140 - R} y1={140} x2={140 + R} y2={140} className="axis" />
      <line x1={140} y1={140 - R} x2={140} y2={140 + R} className="axis" />
      <polyline points={trail.current.map(p => `${px(p.x)},${px(p.y)}`).join(' ')} className="trail" />
      <circle cx={px(dot.x)} cy={px(dot.y)} r={11} className="dot" />
      <text x={140} y={13} textAnchor="middle">ACCEL</text>
      <text x={140} y={277} textAnchor="middle">BRAKE</text>
      <text x={2} y={145} textAnchor="start">L</text>
      <text x={278} y={145} textAnchor="end">R</text>
      <text x={140 + R / 2 + 4} y={157} className="sm">0.5g</text>
      <text x={140 + R - 36} y={157} className="sm">1g</text>
    </svg>
  )
}

const WheelBox = ({ label, v }: { label: string; v: number | null }) => (
  <div className="wbox">
    <span className="k">{label}</span>
    <span className="n">{num(v)}</span>
  </div>
)

const Wheel = ({ deg }: { deg: number | null }) => (
  <svg className="swheel" viewBox="0 0 100 100">
    <g style={{ transform: `rotate(${deg ?? 0}deg)`, transformOrigin: '50px 50px' }}>
      <circle cx={50} cy={50} r={42} />
      <line x1={50} y1={8} x2={50} y2={30} className="top" />
      <line x1={14} y1={62} x2={42} y2={54} />
      <line x1={86} y1={62} x2={58} y2={54} />
      <circle cx={50} cy={50} r={9} />
    </g>
  </svg>
)

const side = (v: number | null, neg: string, pos: string) => (v === null || Math.abs(v) < 0.5 ? '' : v < 0 ? neg : pos)

const Dynamics = ({ d }: { d: VehicleData }) => {
  const w = d.wheelKmh
  const lat = d.latG
  const long = d.longG
  return (
    <div className="vgrid dyn">
      <Card title="Forces (g)">
        <GPlot lat={lat} long={long} />
        <div className="gread">
          <span>{lat === null ? '--' : `${Math.abs(lat).toFixed(2)} ${lat > 0.02 ? 'L' : lat < -0.02 ? 'R' : ''}`}</span>
          <span>{long === null ? '--' : `${Math.abs(long).toFixed(2)} ${long > 0.02 ? 'ACCEL' : long < -0.02 ? 'BRAKE' : ''}`}</span>
        </div>
      </Card>
      <Card title="Wheel speed (km/h)">
        <div className="wgrid">
          <WheelBox label="FL" v={w?.fl ?? null} />
          <WheelBox label="FR" v={w?.fr ?? null} />
          <WheelBox label="RL" v={w?.rl ?? null} />
          <WheelBox label="RR" v={w?.rr ?? null} />
        </div>
        <div className="vline one">
          <span className="k">Brake</span>
          <span className="val">
            {num(d.brakeMpa, 1)} <small>MPa</small>
          </span>
        </div>
      </Card>
      <Card title="Steering">
        <Wheel deg={d.steeringDeg} />
        <Big value={d.steeringDeg === null ? '--' : `${Math.abs(d.steeringDeg).toFixed(0)}°`} unit={side(d.steeringDeg, 'LEFT', 'RIGHT')} size="mid" />
        <div className="vline one">
          <span className="k">Yaw rate</span>
          <span className="val">
            {d.yawDegPerS === null ? '--' : Math.abs(d.yawDegPerS).toFixed(0)} <small>°/s {side(d.yawDegPerS, 'L', 'R')}</small>
          </span>
        </div>
      </Card>
    </div>
  )
}

// A status box. `on` = the thing is active (solid white); `warn` = needs attention (amber, with a mark).
// Never colour alone: the state is always spelled out.
const Chip = ({ label, state, on = false, warn = false, wide = false }: { label: string; state: string; on?: boolean; warn?: boolean; wide?: boolean }) => (
  <div className={`chip${on ? ' on' : ''}${warn ? ' warn' : ''}${wide ? ' wide' : ''}`}>
    <span className="k">{label}</span>
    <span className="s">
      {warn && '! '}
      {state}
    </span>
  </div>
)

const yn = (v: boolean | null, yes: string, no: string) => (v === null ? '--' : v ? yes : no)

const Body = ({ d, units }: { d: VehicleData; units: Settings['units'] }) => {
  const f = units === 'f'
  const out = d.outsideC === null ? '--' : `${(f ? toFahrenheit(d.outsideC) : d.outsideC).toFixed(0)} ${f ? '°F' : '°C'}`
  const vsa = d.vsa
  return (
    <div className="vchips">
      <Chip label="Headlights" state={d.headlights === null ? '--' : HEADLIGHTS[d.headlights]} on={!!d.headlights} />
      <div className="chip pair">
        <span className="k">Indicators</span>
        <span className="arrows">
          <b className={d.indicators?.left ? 'on' : ''}>◀</b>
          <b className={d.indicators?.right ? 'on' : ''}>▶</b>
        </span>
      </div>
      <Chip label="Wipers" state={d.wipers === null ? '--' : WIPERS[d.wipers]} on={!!d.wipers} />
      <Chip label="Handbrake" state={yn(d.handbrake, 'ON', 'OFF')} on={!!d.handbrake} warn={!!d.handbrake} />
      <Chip label="Reverse" state={yn(d.reverse, 'ON', 'OFF')} on={!!d.reverse} />
      <Chip label="Clutch" state={yn(d.clutchUp, 'UP', 'PRESSED')} on={d.clutchUp === false} />
      <Chip label="Brake pedal" state={yn(d.brakePedal, 'PRESSED', 'UP')} on={!!d.brakePedal} />
      <Chip
        label="Stability (VSA)"
        state={!vsa ? '--' : vsa.unavailable ? 'UNAVAILABLE' : vsa.active ? 'ACTING' : vsa.lamp ? 'LAMP ON' : 'READY'}
        on={!!vsa?.active}
        warn={!!vsa && (vsa.unavailable || vsa.lamp)}
      />
      <Chip label="Driver belt" state={yn(d.belts?.driver ?? null, 'BUCKLED', 'UNBUCKLED')} warn={d.belts?.driver === false} />
      <Chip label="Passenger belt" state={yn(d.belts?.passenger ?? null, 'BUCKLED', 'UNBUCKLED')} warn={false} />
      <Chip label="Outside" state={out} />
      <Chip label="Odometer" state={d.odometerKm === null ? '--' : `${d.odometerKm.toLocaleString('en')} km`} />
    </div>
  )
}

// Battery voltage from the OBD poll (PID 42). The trend is the last 15 minutes, newest on the right.
const V_MIN = 11
const V_MAX = 15
const TREND_S = 15 * 60

const Trend = ({ points }: { points: [number, number][] }) => {
  const x = (ago: number) => 600 - (Math.min(ago, TREND_S) / TREND_S) * 600
  const y = (v: number) => 200 - clamp01((v - V_MIN) / (V_MAX - V_MIN)) * 200
  const guides = [12, 12.4, 13.2, 14]
  return (
    <svg className="btrend" viewBox="0 0 640 220">
      {guides.map(g => (
        <g key={g}>
          <line x1={0} x2={600} y1={y(g)} y2={y(g)} className="guide" />
          <text x={606} y={y(g) + 6}>{g.toFixed(1)}</text>
        </g>
      ))}
      <polyline points={points.map(([ago, v]) => `${x(ago)},${y(v)}`).join(' ')} className="line" />
    </svg>
  )
}

const Battery = ({ d }: { d: VehicleData }) => {
  const v = d.batteryV
  const st = batteryState(v, d.rpm)
  const running = d.rpm !== null && d.rpm > RUNNING_RPM
  const pts = d.batteryTrend ?? []
  const vs = pts.map(p => p[1])
  const lo = vs.length ? Math.min(...vs) : null
  const hi = vs.length ? Math.max(...vs) : null
  return (
    <div className="vgrid batt">
      <Card title="Battery">
        <Big value={v === null ? '--' : v.toFixed(2)} unit="V" tone={st?.tone ?? ''} size="huge" />
        <Bar value={v} min={V_MIN} max={V_MAX} tone={st?.tone ?? ''} ticks={[{ at: 12, label: '12' }, { at: 12.4 }, { at: 13.2 }, { at: 14, label: '14' }]} />
      </Card>
      <Card title={running ? 'Charging system (engine running)' : 'State of charge (engine stopped)'}>
        <Big value={st ? st.label : '--'} tone={st?.tone ?? ''} size="mid" />
        <div className="note dim">
          {running ? 'Expect 13.2–15 V while the engine runs.' : 'With the ignition on, 12.4 V or more is healthy.'}
        </div>
      </Card>
      <Card title="Last 15 minutes" className="span2">
        {pts.length > 1 ? <Trend points={pts} /> : <div className="note dim">Builds up while engine data is being read.</div>}
        <div className="vline one">
          <span className="k">Lowest · highest</span>
          <span className="val">
            {lo === null ? '--' : `${lo.toFixed(2)} · ${hi!.toFixed(2)}`} <small>V</small>
          </span>
        </div>
      </Card>
      {d.live && !d.engineData && (
        <div className="vnone">
          <b>Battery needs engine data</b>
          <span>No CAN message carries the voltage. Set Settings › Options › Drive recording to “Listen + engine data”.</span>
        </div>
      )}
    </div>
  )
}

// The warning bits the car broadcasts (0x324). The names are the reference sheet's guesses: with the
// ignition on and the engine stopped, ENGINE and STEERING read ON, as the dash's own lamps do then.
const lamp = (v: boolean | undefined) => (v === undefined ? '--' : v ? 'ON' : 'OFF')

const Diag = ({ d }: { d: VehicleData }) => {
  const a = d.alerts
  const on = a ? ([a.engine && 'ENGINE', a.oil && 'OIL', a.eps && 'STEERING'].filter(Boolean) as string[]) : null
  return (
    <div className="vdiag">
      <Card title="Car's own warnings">
        <Big value={on === null ? '--' : on.length ? on.join(' ') : 'NONE'} tone={on?.length ? 'bad' : on ? 'ok' : ''} size="mid" />
      </Card>
      <div className="vchips">
        <Chip label="Engine warning" state={lamp(a?.engine)} warn={!!a?.engine} />
        <Chip label="Oil warning" state={lamp(a?.oil)} warn={!!a?.oil} />
        <Chip label="Steering (EPS)" state={lamp(a?.eps)} warn={!!a?.eps} />
      </div>
      <div className="note dim">
        Warning lamps as the car broadcasts them. ENGINE and STEERING are normally ON with the engine stopped.
      </div>
    </div>
  )
}

export const VehiclePage = ({ tab, data, settings, demo }: { tab: VehicleTab; data: VehicleData | null; settings: Settings; demo: boolean }) => {
  const live = !!data?.live
  const d = live ? data! : emptyVehicle
  return (
    <div className={`content tabbed vehicle${live ? '' : ' nodata'}`}>
      {tab === 'drive' && <Drive d={d} />}
      {tab === 'engine' && <Engine d={d} units={settings.units} />}
      {tab === 'dynamics' && <Dynamics d={d} />}
      {tab === 'body' && <Body d={d} units={settings.units} />}
      {tab === 'battery' && <Battery d={d} />}
      {tab === 'diag' && <Diag d={d} />}
      {!live && (
        <div className="vnone">
          <b>No data from the car</b>
          <span>
            {data === null ? 'The CAN service is not answering.' : 'The bus is silent.'} Is the ignition on and the CAN adapter plugged in?
          </span>
        </div>
      )}
      {demo && <div className="vdemo">DEMO DATA</div>}
    </div>
  )
}
