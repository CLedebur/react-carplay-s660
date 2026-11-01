import { Control } from './controls'

// Navigation of the native head-unit UI. Pure, so the knob behaviour is unit-tested without React.
// Vehicle Dynamics is deliberately not a Panel yet: it joins when the OBD-II work lands.
export type Panel = 'carplay' | 'settings'
export type PowerAction = 'restart' | 'shutdown'

// What the knob can land on. rail:* is the left rail, sw:* the hold-Mode switcher.
export type FocusId =
  | 'rail:carplay'
  | 'rail:settings'
  | 'sw:carplay'
  | 'sw:settings'
  | 'autoRun'
  | PowerAction

// Settings page 2 (options and power): the knob reaches it by turning past the rail.
const PAGE_2: FocusId[] = ['autoRun', 'restart', 'shutdown']

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

// Knob order, rail first, then the panel's own controls.
export const focusRing = (ui: UiState): FocusId[] => {
  if (ui.switcher) return ['sw:carplay', 'sw:settings']
  const rail: FocusId[] = ['rail:carplay', 'rail:settings']
  return ui.panel === 'settings' ? [...rail, ...PAGE_2] : rail
}

// Settings page 1 is purely informational and has nothing to focus, so the page follows the knob:
// focus on a page 2 control shows page 2, focus back on the rail shows page 1.
export const settingsPage = (ui: UiState): 1 | 2 => (PAGE_2.includes(ui.focus) ? 2 : 1)

const step = (ui: UiState, dir: 1 | -1): FocusId => {
  const ring = focusRing(ui)
  const at = Math.max(0, ring.indexOf(ui.focus))
  return ring[(at + dir + ring.length) % ring.length]
}

export interface NativeResult {
  ui: UiState
  // The knob was pressed on a hold-to-confirm button: the caller times the hold.
  hold?: PowerAction
  // The knob was pressed on a checkbox: the caller flips that setting.
  toggle?: 'autoRun'
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
      if (ui.focus === 'restart' || ui.focus === 'shutdown') return { ui, hold: ui.focus }
      if (ui.focus === 'autoRun') return { ui, toggle: 'autoRun' }
      const settings = ui.focus.endsWith('settings')
      return { ui: openPanel(settings ? 'settings' : 'carplay'), opensCarplay: !settings }
    }
    default:
      return { ui }
  }
}
