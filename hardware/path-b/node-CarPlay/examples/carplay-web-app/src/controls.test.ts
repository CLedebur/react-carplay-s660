import { carplayCommandsFor, Control, KEY_CODE_TO_CONTROL } from './controls'

const press = (control: Control, repeat = false) =>
  carplayCommandsFor({ control, pressed: true, repeat })
const release = (control: Control) =>
  carplayCommandsFor({ control, pressed: false, repeat: false })

test('every firmware key maps to a control', () => {
  expect(Object.keys(KEY_CODE_TO_CONTROL).sort()).toEqual(
    ['ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'KeyM', 'KeyP'],
  )
})

test('knob turns move the CarPlay focus on press only', () => {
  expect(press('knobCw')).toEqual(['right'])
  expect(press('knobCcw')).toEqual(['left'])
  expect(release('knobCw')).toEqual([])
  expect(release('knobCcw')).toEqual([])
})

test('knob push is a select down/up pair', () => {
  expect(press('knobPush')).toEqual(['selectDown'])
  expect(release('knobPush')).toEqual(['selectUp'])
})

test('buttons fire once on press', () => {
  expect(press('back')).toEqual(['back'])
  expect(press('mode')).toEqual(['home'])
  expect(press('phone')).toEqual(['nudgeRight', 'selectUp'])
  expect(release('back')).toEqual([])
  expect(release('mode')).toEqual([])
  expect(release('phone')).toEqual([])
})

test('auto-repeat while held sends nothing', () => {
  for (const c of Object.values(KEY_CODE_TO_CONTROL)) {
    expect(press(c, true)).toEqual([])
  }
})
