import {
  closeSwitcher,
  focusRing,
  initialUi,
  isCarplayView,
  nativeKey,
  openPanel,
  openSwitcher,
  UiState,
} from './nav'

// The Settings panel with the knob pushed into a tab, on one of its controls.
const inside = (tab: UiState['tab']['settings'], focus: UiState['focus']): UiState => {
  const ui = openPanel('settings')
  return { ...ui, tab: { ...ui.tab, settings: tab }, focus }
}

test('boots on the CarPlay panel', () => {
  expect(initialUi.panel).toBe('carplay')
  expect(isCarplayView(initialUi, false)).toBe(false) // waiting page until the phone connects
  expect(isCarplayView(initialUi, true)).toBe(true)
})

test('the switcher takes the controls back from CarPlay', () => {
  expect(isCarplayView(openSwitcher(initialUi), true)).toBe(false)
  expect(isCarplayView(openPanel('settings'), true)).toBe(false)
})

test('knob walks the rail, then the panel\'s tabs, and wraps', () => {
  const ring = focusRing(openPanel('settings'))
  expect(ring).toEqual([
    'rail:carplay', 'rail:vehicle', 'rail:settings',
    'tab:status', 'tab:options', 'tab:carplay', 'tab:network', 'tab:display', 'tab:power',
  ])
  expect(focusRing(openPanel('vehicle')).slice(3)).toEqual(['tab:drive', 'tab:engine', 'tab:dynamics', 'tab:body'])
  expect(focusRing(openPanel('carplay'))).toEqual(['rail:carplay', 'rail:vehicle', 'rail:settings'])
  let ui = openPanel('settings') // focus starts on its own rail item
  for (let i = 0; i < ring.length - 3; i++) ui = nativeKey(ui, 'knobCw').ui
  expect(ui.focus).toBe('tab:power')
  expect(nativeKey(ui, 'knobCw').ui.focus).toBe('rail:carplay') // wraps
  expect(nativeKey(openPanel('settings'), 'knobCcw').ui.focus).toBe('rail:vehicle')
})

test('the tab follows the knob, Status first', () => {
  let ui = openPanel('settings')
  expect(ui.tab.settings).toBe('status')
  const seen: string[] = []
  for (let i = 0; i < 7; i++) {
    ui = nativeKey(ui, 'knobCw').ui
    seen.push(ui.tab.settings)
  }
  expect(seen).toEqual(['status', 'options', 'carplay', 'network', 'display', 'power', 'power'])
  expect(nativeKey(openPanel('vehicle'), 'knobCw').ui.tab.vehicle).toBe('drive')
})

test('push on a tab enters it, a loop of its own controls; Back steps out onto the tab, then leaves', () => {
  let ui = openPanel('settings')
  ui = nativeKey(ui, 'knobCw').ui // tab:status
  ui = nativeKey(ui, 'knobCw').ui // tab:options
  expect(ui.focus).toBe('tab:options')
  ui = nativeKey(ui, 'knobPush').ui
  expect(ui.focus).toBe('opt:autoRunCarplay')
  expect(focusRing(ui)).toEqual(['opt:autoRunCarplay', 'opt:units', 'opt:clock', 'webAdmin'])
  for (let i = 0; i < 4; i++) ui = nativeKey(ui, 'knobCw').ui
  expect(ui.focus).toBe('opt:autoRunCarplay') // wraps inside the tab
  ui = nativeKey(ui, 'back').ui
  expect(ui.focus).toBe('tab:options')
  expect(ui.panel).toBe('settings')
  expect(nativeKey(ui, 'back').opensCarplay).toBe(true) // the next Back leaves
})

test('read-only tabs have nothing to enter', () => {
  const ui = { ...openPanel('vehicle'), focus: 'tab:drive' as const }
  expect(nativeKey(ui, 'knobPush').ui).toBe(ui)
  const status = { ...openPanel('settings'), focus: 'tab:status' as const }
  expect(nativeKey(status, 'knobPush').ui).toBe(status)
})

test('push on a setting asks the caller to step it, and stays put', () => {
  const ui = inside('carplay', 'opt:fps')
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, cycle: 'fps' })
})

test('the Network page button asks the caller to bring the phone link up', () => {
  const ui = inside('network', 'netConnect')
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, connect: 'bluetooth' })
})

test('the web interface row asks the caller to switch it, with no hold', () => {
  const ui = inside('options', 'webAdmin')
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, toggleWeb: true })
})

test('Reload CarPlay needs a hold like Restart', () => {
  const ui = inside('power', 'reload')
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, hold: 'reload' })
})

test('asking for CarPlay (rail, switcher, Back) is flagged; Settings and options are not', () => {
  const rail = { ...openPanel('settings'), focus: 'rail:carplay' as const }
  expect(nativeKey(rail, 'knobPush').opensCarplay).toBe(true)
  expect(nativeKey(openPanel('settings'), 'back').opensCarplay).toBe(true)
  expect(nativeKey(openPanel('settings'), 'knobPush').opensCarplay).toBe(false)
  expect(nativeKey(rail, 'knobCw').opensCarplay).toBeUndefined()
})

test('the rail and the switcher both reach the Vehicle panel', () => {
  const rail = { ...openPanel('carplay'), focus: 'rail:vehicle' as const }
  expect(nativeKey(rail, 'knobPush')).toEqual({ ui: openPanel('vehicle'), opensCarplay: false })
  expect(focusRing(openSwitcher(initialUi))).toEqual(['sw:carplay', 'sw:vehicle', 'sw:settings'])
})

test('push on the rail opens that panel', () => {
  const ui = { ...openPanel('carplay'), focus: 'rail:settings' as const }
  expect(nativeKey(ui, 'knobPush').ui).toEqual(openPanel('settings'))
})

test('push on Restart or Shut down asks for a hold, it never acts at once', () => {
  const ui = inside('power', 'shutdown')
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, hold: 'shutdown' })
})

test('back leaves Settings for CarPlay, closes the switcher first, and rests on the waiting page', () => {
  expect(nativeKey(openPanel('settings'), 'back').ui).toEqual(openPanel('carplay'))
  const sw = openSwitcher(openPanel('settings'))
  expect(nativeKey(sw, 'back').ui).toEqual(closeSwitcher(sw))
  expect(nativeKey(initialUi, 'back').ui).toBe(initialUi)
})

test('switcher: push picks a panel', () => {
  let ui = openSwitcher(initialUi)
  expect(ui.focus).toBe('sw:carplay')
  ui = nativeKey(ui, 'knobCw').ui
  ui = nativeKey(ui, 'knobCw').ui
  expect(nativeKey(ui, 'knobPush').ui).toEqual(openPanel('settings'))
})

test('Display: push opens the test pattern; there the knob steps the ratio, push toggles fine, Back saves and leaves', () => {
  let ui = inside('display', 'aspect')
  ui = nativeKey(ui, 'knobPush').ui
  expect(ui.pattern).toBe(true)
  expect(nativeKey(ui, 'knobCw').aspect).toBe(1)
  expect(nativeKey(ui, 'knobCcw').aspect).toBe(-1)
  expect(nativeKey(ui, 'knobCw').ui).toBe(ui) // the knob does not move focus
  ui = nativeKey(ui, 'knobPush').ui
  expect(ui.fine).toBe(true)
  const left = nativeKey(ui, 'back')
  expect(left.ui.pattern).toBe(false)
  expect(left.ui.focus).toBe('aspect')
  expect(left.opensCarplay).toBeUndefined()
  expect(nativeKey(inside('display', 'aspectReset'), 'knobPush').resetAspect).toBe(true)
})
