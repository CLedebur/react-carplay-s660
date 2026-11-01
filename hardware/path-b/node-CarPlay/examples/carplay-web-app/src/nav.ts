import { Control } from './controls'
import { SettingKey } from './settings'

// Navigation of the native head-unit UI. Pure, so the knob behaviour is unit-tested without React.
// Vehicle Dynamics is deliberately not a Panel yet: it joins when the OBD-II work lands.
export type Panel = 'carplay' | 'settings'
export type PowerAction = 'restart' | 'shutdown'
// Buttons that need the knob held down, so a stray press cannot do them.
export type HoldAction = PowerAction | 'reload'

// What the knob can land on. rail:* is the left rail, sw:* the hold-Mode switcher, opt:* a setting.
export type FocusId =
  | 'rail:carplay'
  | 'rail:settings'
  | 'sw:carplay'
  | 'sw:settings'
  | `opt:${SettingKey}`
  | 'netConnect'
  | HoldAction

// Settings pages. Page 1 is status only and has nothing to focus; the page follows the knob.
export const SETTINGS_PAGES: { title: string; items: FocusId[] }[] = [
  { title: 'Status', items: [] },
  { title: 'Options', items: ['opt:autoRunCarplay', 'opt:units', 'opt:clock'] },
  { title: 'CarPlay', items: ['opt:handDrive', 'opt:fps', 'opt:wifiBand', 'opt:nightMode'] },
  { title: 'Network', items: ['netConnect'] },
  { title: 'Maintenance & power', items: ['reload', 'restart', 'shutdown'] },
]

export interface UiState {
  panel: Panel
  switcher: boolean
  focus: FocusId
}

export const initialUi: UiState = { panel: 'carplay', switcher: false, focus: 'rail:carplay' }

export const openPanel = (panel: Panel): UiState => ({
  panel,
  switcher: false,
  focus: `rail:${panel}`,
})
export const openSwitcher = (ui: UiState): UiState => ({ ...ui, switcher: true, focus: `sw:${ui.panel}` })
export const closeSwitcher = (ui: UiState): UiState => ({ ...ui, switcher: false, focus: `rail:${ui.panel}` })

// CarPlay owns the panel only when its video is up, on its panel, with no switcher over it.
// Before the phone connects the CarPlay panel is the native "waiting for your phone" page.
export const isCarplayView = (ui: UiState, streaming: boolean): boolean =>
  ui.panel === 'carplay' && streaming && !ui.switcher

// Knob order, rail first, then each Settings page's controls in page order.
export const focusRing = (ui: UiState): FocusId[] => {
  if (ui.switcher) return ['sw:carplay', 'sw:settings']
  const rail: FocusId[] = ['rail:carplay', 'rail:settings']
  return ui.panel === 'settings' ? [...rail, ...SETTINGS_PAGES.flatMap(p => p.items)] : rail
}

// 1-based page of the control the knob is on; the rail shows page 1.
export const settingsPage = (ui: UiState): number => {
  const i = SETTINGS_PAGES.findIndex(p => p.items.includes(ui.focus))
  return i < 0 ? 1 : i + 1
}

const step = (ui: UiState, dir: 1 | -1): FocusId => {
  const ring = focusRing(ui)
  const at = Math.max(0, ring.indexOf(ui.focus))
  return ring[(at + dir + ring.length) % ring.length]
}

export interface NativeResult {
  ui: UiState
  // The knob was pressed on a hold-to-confirm button: the caller times the hold.
  hold?: HoldAction
  // The knob was pressed on a setting: the caller steps it to its next value.
  cycle?: SettingKey
  // The knob was pressed on "connect through the phone": the caller brings that link up.
  connect?: 'bluetooth'
  // The user asked for CarPlay (rail, switcher or Back), which also overrides "don't auto-run".
  opensCarplay?: boolean
}

// A press (not a release, not a repeat) of a control other than Mode, while a native view is up.
// Mode is timed by the caller because a tap and a hold differ.
export const nativeKey = (ui: UiState, control: Control): NativeResult => {
  switch (control) {
    case 'knobCw':
      return { ui: { ...ui, focus: step(ui, 1) } }
    case 'knobCcw':
      return { ui: { ...ui, focus: step(ui, -1) } }
    case 'back':
      if (ui.switcher) return { ui: closeSwitcher(ui) }
      return { ui: ui.panel === 'carplay' ? ui : openPanel('carplay'), opensCarplay: true }
    case 'knobPush': {
      const f = ui.focus
      if (f === 'reload' || f === 'restart' || f === 'shutdown') return { ui, hold: f }
      if (f === 'netConnect') return { ui, connect: 'bluetooth' }
      if (f.startsWith('opt:')) return { ui, cycle: f.slice(4) as SettingKey }
      const settings = f.endsWith('settings')
      return { ui: openPanel(settings ? 'settings' : 'carplay'), opensCarplay: !settings }
    }
    default:
      return { ui }
  }
}
