import {
  closeSwitcher,
  focusRing,
  initialUi,
  isCarplayView,
  nativeKey,
  openPanel,
  openSwitcher,
} from './nav'

test('boots on the CarPlay panel', () => {
  expect(initialUi.panel).toBe('carplay')
  expect(isCarplayView(initialUi, false)).toBe(false) // waiting page until the phone connects
  expect(isCarplayView(initialUi, true)).toBe(true)
})

test('the switcher takes the controls back from CarPlay', () => {
  expect(isCarplayView(openSwitcher(initialUi), true)).toBe(false)
  expect(isCarplayView(openPanel('settings'), true)).toBe(false)
})

test('knob walks the rail, then Settings controls, and wraps', () => {
  expect(focusRing(openPanel('settings'))).toEqual(['rail:carplay', 'rail:settings', 'restart', 'shutdown'])
  let ui = openPanel('settings') // focus starts on its own rail item
  const seen = []
  for (let i = 0; i < 4; i++) {
    ui = nativeKey(ui, 'knobCw').ui
    seen.push(ui.focus)
  }
  expect(seen).toEqual(['restart', 'shutdown', 'rail:carplay', 'rail:settings'])
  expect(nativeKey(ui, 'knobCcw').ui.focus).toBe('rail:carplay')
})

test('the vehicle panel is not in any ring', () => {
  const all = [initialUi, openPanel('settings'), openSwitcher(initialUi)].flatMap(focusRing)
  expect(all.some(id => id.includes('vehicle'))).toBe(false)
})

test('push on the rail opens that panel', () => {
  const ui = { ...openPanel('carplay'), focus: 'rail:settings' as const }
  expect(nativeKey(ui, 'knobPush').ui).toEqual(openPanel('settings'))
})

test('push on Restart or Shut down asks for a hold, it never acts at once', () => {
  const ui = { ...openPanel('settings'), focus: 'shutdown' as const }
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
  expect(nativeKey(ui, 'knobPush').ui).toEqual(openPanel('settings'))
})
