import { ACCENTS, accentColours, DEFAULT_ACCENT } from './accent'
import { defaultSettings, nextValue } from './settings'

test('Carnival Yellow 2 is the default, with black text and no extra edge (as before)', () => {
  expect(DEFAULT_ACCENT).toBe('carnivalYellow2')
  expect(defaultSettings.accent).toBe('carnivalYellow2')
  expect(accentColours('carnivalYellow2')).toEqual({ focus: '#ffd400', ink: '#000000', edge: '#ffd400' })
})

test('dark paints get white text and a white edge; light ones black text', () => {
  for (const id of ['nightHawkBlack', 'mysticNight', 'velvetMaroon', 'britishGreen', 'admiralGray'])
    expect(accentColours(id)).toMatchObject({ ink: '#ffffff', edge: '#ffffff' })
  for (const id of ['starWhite', 'hidaIvory', 'alabasterSilver', 'sonicGray', 'activeGreen', 'beachBlue'])
    expect(accentColours(id).ink).toBe('#000000')
  expect(accentColours('nope').focus).toBe('#ffd400') // unknown = the default
})

test('the knob steps through all 14 paints and wraps', () => {
  expect(ACCENTS).toHaveLength(14)
  let s = { ...defaultSettings, accent: ACCENTS[13].id }
  s = { ...s, accent: nextValue(s, 'accent') }
  expect(s.accent).toBe(ACCENTS[0].id)
})
