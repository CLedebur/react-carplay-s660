import { ACCENT_IDS, AccentId, DEFAULT_ACCENT } from './accent'

// The user's settings. The kiosk server (hardware/path-b/s660-api.js) keeps them on /persist and
// holds the same list of allowed values: keep the two in step.
export interface Settings {
  carplayEnabled: boolean // off = the dongle is never started, so the phone cannot connect (testing in the garage)
  autoRunCarplay: boolean // show CarPlay full screen as soon as the phone connects
  units: 'c' | 'f' // temperatures
  clock: '24h' | '12h'
  handDrive: 'rhd' | 'lhd' // which side the CarPlay sidebar is on
  fps: 30 | 60 // video frame rate
  wifiBand: '5ghz' | '2.4ghz' // the dongle's own Wi-Fi to the phone
  nightMode: boolean // tell CarPlay it is night
  carplayWidth: 848 | 896 // width the dongle renders at (height is always 480); 896 is the glass's own shape
  carplayShape: 'fill' | 'exact' // fill = the picture stretched over the whole frame; exact = true shape, black bar on the left
  glassAspect: number // visible glass width / height, x1000 (1875 = 1.875:1); the native UI is drawn to it
  driveLog: 'off' | 'listen' | 'engine' // drive recorder (hardware/can/s660-drive-log): listen never transmits
  gearPopup: 0 | 1 | 2 | 3 | 4 | 5 // seconds the gear shows after a shift, over any page; 0 = off
  vsaPopup: 0 | 1 | 2 | 3 | 4 | 5 // seconds AHA / VSA / ABS shows after an intervention, over any page; 0 = off
  accent: AccentId // the highlight colour, one of the S660's paints (accent.ts)
}

export type SettingKey = keyof Settings
// The settings that step through a short list when the knob is pressed. glassAspect has its own screen.
export type CycleKey = Exclude<SettingKey, 'glassAspect'>

export const defaultSettings: Settings = {
  carplayEnabled: true,
  autoRunCarplay: true,
  units: 'c',
  clock: '24h',
  handDrive: 'rhd',
  fps: 30,
  wifiBand: '5ghz',
  nightMode: false,
  carplayWidth: 896, // the glass's own shape. 848 is for a Waze that moves its badge off the frame (2026-09; fine again 2026-11, BUILD_NOTES 39.3)
  carplayShape: 'fill',
  glassAspect: 1875, // 135 x 72 mm, measured (BUILD_NOTES 22.8)
  driveLog: 'off',
  gearPopup: 2,
  vsaPopup: 2,
  accent: DEFAULT_ACCENT,
}

// The values a key steps through, in order, when the knob is pressed on its row.
const CYCLES: { [K in CycleKey]: readonly Settings[K][] } = {
  carplayEnabled: [true, false],
  autoRunCarplay: [true, false],
  units: ['c', 'f'],
  clock: ['24h', '12h'],
  handDrive: ['rhd', 'lhd'],
  fps: [30, 60],
  wifiBand: ['5ghz', '2.4ghz'],
  nightMode: [false, true],
  carplayShape: ['fill', 'exact'],
  carplayWidth: [848, 896],
  driveLog: ['off', 'listen', 'engine'],
  gearPopup: [0, 1, 2, 3, 4, 5],
  vsaPopup: [0, 1, 2, 3, 4, 5],
  accent: ACCENT_IDS,
}

export const nextValue = <K extends CycleKey>(settings: Settings, key: K): Settings[K] => {
  const cycle = CYCLES[key]
  return cycle[(cycle.indexOf(settings[key]) + 1) % cycle.length]
}

// These only reach the dongle when CarPlay (re)starts, so changing one leaves a reload pending.
export const RELOAD_KEYS: readonly SettingKey[] = ['handDrive', 'fps', 'wifiBand', 'carplayWidth']
export type StartSettings = Pick<Settings, 'handDrive' | 'fps' | 'wifiBand' | 'carplayWidth'>

export const reloadPending = (now: Settings, started: StartSettings | null): boolean =>
  started !== null && RELOAD_KEYS.some(k => now[k as keyof StartSettings] !== started[k as keyof StartSettings])

export const toFahrenheit = (c: number): number => (c * 9) / 5 + 32

// The native UI's drawing aspect is a range, not a list: keep in step with s660-api.js.
export const GLASS_ASPECT = { min: 1500, max: 2400, coarse: 20, fine: 5 } as const

export const stepAspect = (current: number, dir: 1 | -1, fine: boolean): number =>
  Math.min(GLASS_ASPECT.max, Math.max(GLASS_ASPECT.min, current + dir * (fine ? GLASS_ASPECT.fine : GLASS_ASPECT.coarse)))

// The output is always 720 x 480; the panel stretches it to the glass. Drawing the UI `width` logical
// pixels wide and squeezing it into 720 makes the stretch give square pixels again.
export const OUTPUT_WIDTH = 720
export const OUTPUT_HEIGHT = 480
export const logicalWidth = (glassAspect: number): number => Math.round((OUTPUT_HEIGHT * glassAspect) / 1000)
