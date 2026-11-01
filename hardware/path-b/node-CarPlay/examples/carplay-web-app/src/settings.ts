// The user's settings. The kiosk server (hardware/path-b/s660-api.js) keeps them on /persist and
// holds the same list of allowed values: keep the two in step.
export interface Settings {
  autoRunCarplay: boolean // show CarPlay full screen as soon as the phone connects
  units: 'c' | 'f' // temperatures
  clock: '24h' | '12h'
  handDrive: 'rhd' | 'lhd' // which side the CarPlay sidebar is on
  fps: 30 | 60 // video frame rate
  wifiBand: '5ghz' | '2.4ghz' // the dongle's own Wi-Fi to the phone
  nightMode: boolean // tell CarPlay it is night
}

export type SettingKey = keyof Settings

export const defaultSettings: Settings = {
  autoRunCarplay: true,
  units: 'c',
  clock: '24h',
  handDrive: 'rhd',
  fps: 30,
  wifiBand: '5ghz',
  nightMode: false,
}

// The values a key steps through, in order, when the knob is pressed on its row.
const CYCLES: { [K in SettingKey]: readonly Settings[K][] } = {
  autoRunCarplay: [true, false],
  units: ['c', 'f'],
  clock: ['24h', '12h'],
  handDrive: ['rhd', 'lhd'],
  fps: [30, 60],
  wifiBand: ['5ghz', '2.4ghz'],
  nightMode: [false, true],
}

export const nextValue = <K extends SettingKey>(settings: Settings, key: K): Settings[K] => {
  const cycle = CYCLES[key]
  return cycle[(cycle.indexOf(settings[key]) + 1) % cycle.length]
}

// These only reach the dongle when CarPlay (re)starts, so changing one leaves a reload pending.
export const RELOAD_KEYS: readonly SettingKey[] = ['handDrive', 'fps', 'wifiBand']
export type StartSettings = Pick<Settings, 'handDrive' | 'fps' | 'wifiBand'>

export const reloadPending = (now: Settings, started: StartSettings | null): boolean =>
  started !== null && RELOAD_KEYS.some(k => now[k as keyof StartSettings] !== started[k as keyof StartSettings])

export const toFahrenheit = (c: number): number => (c * 9) / 5 + 32
