import { initialVsaPopup, stepVsaPopup } from './vsaPopup'

const ev = (agile: number, active = 0, abs = 0) => ({ agile, active, abs })

test('the first counts are a baseline; a rise shows its label for the set time', () => {
  let s = stepVsaPopup(initialVsaPopup, ev(5), 0, 2000)
  expect(s.shown).toBeNull()
  s = stepVsaPopup(s, ev(6), 100, 2000)
  expect(s.shown).toBe('AHA')
  s = stepVsaPopup(s, ev(6), 2000, 2000)
  expect(s.shown).toBe('AHA')
  s = stepVsaPopup(s, ev(6), 2100, 2000)
  expect(s.shown).toBeNull()
})

test('a new event restarts the time; the stronger intervention is named', () => {
  let s = stepVsaPopup(initialVsaPopup, ev(0), 0, 2000)
  s = stepVsaPopup(s, ev(1), 0, 2000)
  s = stepVsaPopup(s, ev(2, 0, 1), 1500, 2000)
  expect(s.shown).toBe('ABS')
  s = stepVsaPopup(s, ev(2, 0, 1), 3000, 2000)
  expect(s.shown).toBe('ABS')
})

test('counts that fall are a new baseline, and 0 s means off', () => {
  let s = stepVsaPopup(initialVsaPopup, ev(9), 0, 2000)
  s = stepVsaPopup(s, ev(0), 100, 2000)
  expect(s.shown).toBeNull()
  s = stepVsaPopup(s, ev(1), 200, 0)
  expect(s.shown).toBeNull()
  expect(s.last).toEqual(ev(1))
})
