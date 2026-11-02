import {
  uiFromQuery,
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

test('opening a panel puts the knob on its tab bar; the knob walks only the tabs, and wraps', () => {
  expect(openPanel('settings').focus).toBe('tab:status')
  expect(openPanel('vehicle').focus).toBe('tab:drive')
  expect(openPanel('carplay').focus).toBe('rail:carplay')
  const ring = focusRing(openPanel('settings'))
  expect(ring).toEqual(['tab:status', 'tab:options', 'tab:carplay', 'tab:network', 'tab:display', 'tab:power'])
  expect(focusRing(openPanel('vehicle'))).toEqual(['tab:drive', 'tab:engine', 'tab:tuning', 'tab:dynamics', 'tab:body', 'tab:battery', 'tab:diag'])
  expect(focusRing(openPanel('carplay'))).toEqual(['rail:carplay', 'rail:vehicle', 'rail:settings'])
  let ui = openPanel('settings')
  for (let i = 0; i < ring.length - 1; i++) ui = nativeKey(ui, 'knobCw').ui
  expect(ui.focus).toBe('tab:power')
  expect(nativeKey(ui, 'knobCw').ui.focus).toBe('tab:status') // wraps within the tabs, never onto the rail
  expect(nativeKey(openPanel('settings'), 'knobCcw').ui.focus).toBe('tab:power')
})

test('on the rail the knob walks only the rail; Back from the tab bar gets there', () => {
  const rail = nativeKey(openPanel('vehicle'), 'back').ui
  expect(rail.focus).toBe('rail:vehicle')
  expect(rail.panel).toBe('vehicle')
  expect(focusRing(rail)).toEqual(['rail:carplay', 'rail:vehicle', 'rail:settings'])
  const next = nativeKey(rail, 'knobCw').ui
  expect(next.focus).toBe('rail:settings')
  expect(nativeKey(next, 'knobPush').ui).toEqual(openPanel('settings'))
  expect(nativeKey(rail, 'back').opensCarplay).toBe(true) // Back on the rail leaves for CarPlay
})

test('the tab follows the knob, Status first', () => {
  let ui = openPanel('settings')
  expect(ui.tab.settings).toBe('status')
  const seen: string[] = []
  for (let i = 0; i < 6; i++) {
    ui = nativeKey(ui, 'knobCw').ui
    seen.push(ui.tab.settings)
  }
  expect(seen).toEqual(['options', 'carplay', 'network', 'display', 'power', 'status'])
  expect(nativeKey(openPanel('vehicle'), 'knobCw').ui.tab.vehicle).toBe('engine')
})

test('push on a tab enters it, a loop of its own controls; Back steps out onto the tab, then leaves', () => {
  let ui = openPanel('settings') // tab:status
  ui = nativeKey(ui, 'knobCw').ui // tab:options
  expect(ui.focus).toBe('tab:options')
  ui = nativeKey(ui, 'knobPush').ui
  expect(ui.focus).toBe('opt:autoRunCarplay')
  expect(focusRing(ui)).toEqual(['opt:autoRunCarplay', 'opt:units', 'opt:clock', 'opt:gearPopup', 'opt:driveLog', 'webAdmin'])
  for (let i = 0; i < 6; i++) ui = nativeKey(ui, 'knobCw').ui
  expect(ui.focus).toBe('opt:autoRunCarplay') // wraps inside the tab
  ui = nativeKey(ui, 'back').ui
  expect(ui.focus).toBe('tab:options')
  expect(ui.panel).toBe('settings')
  ui = nativeKey(ui, 'back').ui
  expect(ui.focus).toBe('rail:settings') // then onto the rail
  expect(nativeKey(ui, 'back').opensCarplay).toBe(true) // and the next Back leaves
})

test('push on a read-only tab lets the knob scroll it; Back returns to the tab bar', () => {
  const ui = { ...openPanel('vehicle'), focus: 'tab:engine' as const, tab: { ...openPanel('vehicle').tab, vehicle: 'engine' as const } }
  const pane = nativeKey(ui, 'knobPush').ui
  expect(pane.focus).toBe('pane')
  expect(focusRing(pane)).toEqual(['pane'])
  expect(nativeKey(pane, 'knobCw')).toEqual({ ui: pane, scroll: 1 })
  expect(nativeKey(pane, 'knobCcw')).toEqual({ ui: pane, scroll: -1 })
  expect(nativeKey(pane, 'knobPush').ui).toBe(pane)
  expect(nativeKey(pane, 'back').ui.focus).toBe('tab:engine')
  const status = nativeKey({ ...openPanel('settings'), focus: 'tab:status' }, 'knobPush').ui
  expect(status.focus).toBe('pane')
  expect(nativeKey(status, 'back').ui.focus).toBe('tab:status')
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
  const onRail = { ...openPanel('settings'), focus: 'rail:settings' as const }
  expect(nativeKey(onRail, 'back').opensCarplay).toBe(true)
  expect(nativeKey(onRail, 'knobPush').opensCarplay).toBe(false)
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

test('back from the rail leaves Settings for CarPlay, closes the switcher first, and rests on the waiting page', () => {
  expect(nativeKey({ ...openPanel('settings'), focus: 'rail:settings' }, 'back').ui).toEqual(openPanel('carplay'))
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

test('?view= opens a panel on a tab (screenshots); anything else is the normal start', () => {
  const ui = uiFromQuery('?view=vehicle.battery')
  expect([ui.panel, ui.tab.vehicle, ui.focus]).toEqual(['vehicle', 'battery', 'tab:battery'])
  expect(uiFromQuery('?view=settings').focus).toBe('tab:status')
  expect(uiFromQuery('')).toBe(initialUi)
  expect(uiFromQuery('?view=vehicle.nope').focus).toBe('tab:drive')
})

test('highlight colour: push opens a picker on the saved colour; the knob walks all 14, push picks, Back keeps', () => {
  const row = { ...openPanel('settings'), tab: { ...openPanel('settings').tab, settings: 'display' as const }, focus: 'opt:accent' as const }
  const picker = nativeKey(row, 'knobPush', 'flameRed').ui
  expect(picker.focus).toBe('acc:flameRed')
  expect(focusRing(picker)).toHaveLength(14)
  const next = nativeKey(picker, 'knobCw').ui
  expect(next.focus).toBe('acc:starWhite')
  expect(nativeKey(next, 'knobPush')).toEqual({ ui: { ...next, focus: 'opt:accent' }, accent: 'starWhite' })
  const back = nativeKey(next, 'back')
  expect(back.ui.focus).toBe('opt:accent')
  expect(back.accent).toBeUndefined()
  expect(nativeKey(row, 'knobPush').cycle).toBeUndefined() // no longer steps through the list
})
