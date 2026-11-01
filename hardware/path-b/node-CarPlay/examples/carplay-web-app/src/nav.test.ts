import {
  closeSwitcher,
  focusRing,
  initialUi,
  isCarplayView,
  nativeKey,
  openPanel,
  openSwitcher,
  settingsPage,
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

test('knob walks the rail, then every Settings page in order, and wraps', () => {
  const ring = focusRing(openPanel('settings'))
  expect(ring).toEqual([
    'rail:carplay',
    'rail:settings',
    'opt:autoRunCarplay',
    'opt:units',
    'opt:clock',
    'opt:handDrive',
    'opt:fps',
    'opt:wifiBand',
    'opt:nightMode',
    'netConnect',
    'reload',
    'restart',
    'shutdown',
  ])
  let ui = openPanel('settings') // focus starts on its own rail item
  for (let i = 0; i < ring.length - 2; i++) ui = nativeKey(ui, 'knobCw').ui
  expect(ui.focus).toBe('shutdown')
  expect(nativeKey(ui, 'knobCw').ui.focus).toBe('rail:carplay') // wraps
  expect(nativeKey(openPanel('settings'), 'knobCcw').ui.focus).toBe('rail:carplay')
})

test('Settings page 1 is status only; the page follows the knob', () => {
  let ui = openPanel('settings')
  const pages = [settingsPage(ui)]
  for (let i = 0; i < 11; i++) {
    ui = nativeKey(ui, 'knobCw').ui
    pages.push(settingsPage(ui))
  }
  expect(pages).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4, 5, 5, 5])
  expect(settingsPage(nativeKey(openPanel('settings'), 'knobCcw').ui)).toBe(1)
})

test('push on a setting asks the caller to step it, and stays put', () => {
  const ui = { ...openPanel('settings'), focus: 'opt:fps' as const }
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, cycle: 'fps' })
})

test('the Network page button asks the caller to bring the phone link up', () => {
  const ui = { ...openPanel('settings'), focus: 'netConnect' as const }
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, connect: 'bluetooth' })
})

test('Reload CarPlay needs a hold like Restart', () => {
  const ui = { ...openPanel('settings'), focus: 'reload' as const }
  expect(nativeKey(ui, 'knobPush')).toEqual({ ui, hold: 'reload' })
})

test('asking for CarPlay (rail, switcher, Back) is flagged; Settings and options are not', () => {
  const rail = { ...openPanel('settings'), focus: 'rail:carplay' as const }
  expect(nativeKey(rail, 'knobPush').opensCarplay).toBe(true)
  expect(nativeKey(openPanel('settings'), 'back').opensCarplay).toBe(true)
  expect(nativeKey(openPanel('settings'), 'knobPush').opensCarplay).toBe(false)
  expect(nativeKey(rail, 'knobCw').opensCarplay).toBeUndefined()
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
