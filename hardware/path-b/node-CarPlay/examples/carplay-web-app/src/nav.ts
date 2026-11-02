import { Control } from './controls'
import { CycleKey } from './settings'

// Navigation of the native head-unit UI. Pure, so the knob behaviour is unit-tested without React.
export type Panel = 'carplay' | 'vehicle' | 'settings'
export type PowerAction = 'restart' | 'shutdown'
// Buttons that need the knob held down, so a stray press cannot do them.
export type HoldAction = PowerAction | 'reload'

export type SettingsTab = 'status' | 'options' | 'carplay' | 'network' | 'display' | 'power'
export type VehicleTab = 'drive' | 'engine' | 'tuning' | 'dynamics' | 'body' | 'battery' | 'diag'
export type TabId = SettingsTab | VehicleTab

// What the knob can land on. rail:* is the left rail, sw:* the hold-Mode switcher, tab:* a tab in the
// bar under the title strip, opt:* a setting. The rest are buttons on the Settings tabs.
export type FocusId =
  | 'rail:carplay'
  | 'rail:vehicle'
  | 'rail:settings'
  | 'sw:carplay'
  | 'sw:vehicle'
  | 'sw:settings'
  | `tab:${TabId}`
  | `opt:${CycleKey}`
  | 'netConnect'
  | 'webAdmin'
  | 'aspect'
  | 'aspectReset'
  | 'pane' // inside a read-only tab: the knob scrolls its page
  | HoldAction

export interface Tab<T extends TabId> {
  id: T
  label: string
  items: FocusId[] // what the knob can reach once it is pushed into the tab; empty = read-only (the knob scrolls it)
}

// The first tab of each list is the one shown when the panel opens.
export const SETTINGS_TABS: Tab<SettingsTab>[] = [
  { id: 'status', label: 'Status', items: [] },
  { id: 'options', label: 'Options', items: ['opt:autoRunCarplay', 'opt:units', 'opt:clock', 'opt:gearPopup', 'opt:driveLog', 'webAdmin'] },
  { id: 'carplay', label: 'CarPlay', items: ['opt:handDrive', 'opt:fps', 'opt:wifiBand', 'opt:nightMode'] },
  { id: 'network', label: 'Network', items: ['netConnect'] },
  { id: 'display', label: 'Display', items: ['aspect', 'aspectReset', 'opt:carplayShape', 'opt:carplayWidth'] },
  { id: 'power', label: 'Power', items: ['reload', 'restart', 'shutdown'] },
]
export const VEHICLE_TABS: Tab<VehicleTab>[] = [
  { id: 'drive', label: 'Drive', items: [] },
  { id: 'engine', label: 'Engine', items: [] },
  { id: 'tuning', label: 'Tuning', items: [] },
  { id: 'dynamics', label: 'Dynamics', items: [] },
  { id: 'body', label: 'Body', items: [] },
  { id: 'battery', label: 'Battery', items: [] },
  { id: 'diag', label: 'Diag', items: [] },
]

export const tabsOf = (panel: Panel): Tab<TabId>[] =>
  panel === 'settings' ? SETTINGS_TABS : panel === 'vehicle' ? VEHICLE_TABS : []

export interface UiState {
  panel: Panel
  switcher: boolean
  focus: FocusId
  tab: { settings: SettingsTab; vehicle: VehicleTab } // the tab each panel shows
  pattern: boolean // the full-screen aspect test pattern is up: the knob adjusts the ratio
  fine: boolean // ...in small steps
}

const firstTabs = { settings: SETTINGS_TABS[0].id, vehicle: VEHICLE_TABS[0].id }
export const initialUi: UiState = { panel: 'carplay', switcher: false, focus: 'rail:carplay', tab: firstTabs, pattern: false, fine: false }

// Opening a panel that has tabs puts the knob on its first tab; CarPlay has none, so it stays on the rail.
export const openPanel = (panel: Panel): UiState => {
  const tabs = tabsOf(panel)
  return { ...initialUi, panel, focus: tabs.length ? `tab:${tabs[0].id}` : `rail:${panel}` }
}
export const openSwitcher = (ui: UiState): UiState => ({ ...ui, switcher: true, focus: `sw:${ui.panel}` })
export const closeSwitcher = (ui: UiState): UiState => ({ ...ui, switcher: false, focus: `rail:${ui.panel}` })

// CarPlay owns the panel only when its video is up, on its panel, with no switcher over it.
// Before the phone connects the CarPlay panel is the native "waiting for your phone" page.
export const isCarplayView = (ui: UiState, streaming: boolean): boolean =>
  ui.panel === 'carplay' && streaming && !ui.switcher

// The tab being shown on a panel without tabs is none.
export const currentTab = (ui: UiState): Tab<TabId> | null =>
  tabsOf(ui.panel).find(t => t.id === (ui.panel === 'settings' ? ui.tab.settings : ui.tab.vehicle)) ?? null

// True while the knob is inside a tab's controls (as opposed to on the rail or the tab bar).
export const inTab = (ui: UiState): boolean => !!currentTab(ui)?.items.includes(ui.focus)

// Knob order, one level at a time: the three rail items; push opens a panel and moves to its tab bar,
// where the knob walks only the tabs (each one shows as the knob lands on it); push on a tab with
// controls loops over just those. Back climbs one level.
export const focusRing = (ui: UiState): FocusId[] => {
  if (ui.switcher) return ['sw:carplay', 'sw:vehicle', 'sw:settings']
  if (ui.focus === 'pane') return ['pane']
  if (inTab(ui)) return currentTab(ui)!.items
  if (ui.focus.startsWith('tab:')) return tabsOf(ui.panel).map((t): FocusId => `tab:${t.id}`)
  return ['rail:carplay', 'rail:vehicle', 'rail:settings']
}

const withTab = (ui: UiState, focus: FocusId): UiState => {
  if (!focus.startsWith('tab:')) return { ...ui, focus }
  const id = focus.slice(4) as TabId
  return { ...ui, focus, tab: ui.panel === 'settings' ? { ...ui.tab, settings: id as SettingsTab } : { ...ui.tab, vehicle: id as VehicleTab } }
}

const step = (ui: UiState, dir: 1 | -1): UiState => {
  const ring = focusRing(ui)
  const at = Math.max(0, ring.indexOf(ui.focus))
  return withTab(ui, ring[(at + dir + ring.length) % ring.length])
}

export interface NativeResult {
  ui: UiState
  // The knob was pressed on a hold-to-confirm button: the caller times the hold.
  hold?: HoldAction
  // The knob was pressed on a setting: the caller steps it to its next value.
  cycle?: CycleKey
  // The knob was pressed on the web interface row: the caller switches it on or off.
  toggleWeb?: boolean
  // The knob was pressed on "connect through the phone": the caller brings that link up.
  connect?: 'bluetooth'
  // The test pattern is up and the knob turned: the caller moves the glass ratio one step.
  aspect?: 1 | -1
  // The knob was pressed on "reset the ratio".
  resetAspect?: boolean
  // The user asked for CarPlay (rail, switcher or Back), which also overrides "don't auto-run".
  opensCarplay?: boolean
  // Inside a read-only tab the knob turned: the caller scrolls the page one step down (1) or up (-1).
  scroll?: 1 | -1
}

// A press (not a release, not a repeat) of a control other than Mode, while a native view is up.
// Mode is timed by the caller because a tap and a hold differ.
export const nativeKey = (ui: UiState, control: Control): NativeResult => {
  if (ui.pattern) {
    switch (control) {
      case 'knobCw':
        return { ui, aspect: 1 }
      case 'knobCcw':
        return { ui, aspect: -1 }
      case 'knobPush':
        return { ui: { ...ui, fine: !ui.fine } }
      case 'back':
        return { ui: { ...ui, pattern: false, fine: false } }
      default:
        return { ui }
    }
  }
  if (ui.focus === 'pane' && !ui.switcher) {
    switch (control) {
      case 'knobCw':
        return { ui, scroll: 1 }
      case 'knobCcw':
        return { ui, scroll: -1 }
      case 'back':
        return { ui: { ...ui, focus: `tab:${currentTab(ui)!.id}` } } // back onto the tab bar
      default:
        return { ui }
    }
  }
  switch (control) {
    case 'knobCw':
      return { ui: step(ui, 1) }
    case 'knobCcw':
      return { ui: step(ui, -1) }
    case 'back':
      if (ui.switcher) return { ui: closeSwitcher(ui) }
      if (inTab(ui)) return { ui: { ...ui, focus: `tab:${currentTab(ui)!.id}` } } // out of the tab, onto its title
      if (ui.focus.startsWith('tab:')) return { ui: { ...ui, focus: `rail:${ui.panel}` } } // off the tab bar, onto the rail
      return { ui: ui.panel === 'carplay' ? ui : openPanel('carplay'), opensCarplay: true }
    case 'knobPush': {
      const f = ui.focus
      if (f === 'reload' || f === 'restart' || f === 'shutdown') return { ui, hold: f }
      if (f === 'netConnect') return { ui, connect: 'bluetooth' }
      if (f === 'webAdmin') return { ui, toggleWeb: true }
      if (f === 'aspect') return { ui: { ...ui, pattern: true, fine: false } }
      if (f === 'aspectReset') return { ui, resetAspect: true }
      if (f.startsWith('opt:')) return { ui, cycle: f.slice(4) as CycleKey }
      if (f.startsWith('tab:')) {
        const items = currentTab(ui)?.items ?? []
        return { ui: { ...ui, focus: items.length ? items[0] : 'pane' } } // a read-only tab: the knob scrolls it
      }
      const panel = f.split(':')[1] as Panel
      return { ui: openPanel(panel), opensCarplay: panel === 'carplay' }
    }
    default:
      return { ui }
  }
}
