import { defaultSettings, nextValue, reloadPending, toFahrenheit } from './settings'

test('every setting steps to its next value and wraps', () => {
  expect(nextValue(defaultSettings, 'fps')).toBe(60)
  expect(nextValue({ ...defaultSettings, fps: 60 }, 'fps')).toBe(30)
  expect(nextValue(defaultSettings, 'autoRunCarplay')).toBe(false)
  expect(nextValue(defaultSettings, 'units')).toBe('f')
  expect(nextValue(defaultSettings, 'handDrive')).toBe('lhd')
})

test('only the settings that reach the dongle at start leave a reload pending', () => {
  const started = { handDrive: 'rhd', fps: 30, wifiBand: '5ghz' } as const
  expect(reloadPending(defaultSettings, null)).toBe(false) // CarPlay has not started yet
  expect(reloadPending(defaultSettings, started)).toBe(false)
  expect(reloadPending({ ...defaultSettings, units: 'f', clock: '12h', nightMode: true }, started)).toBe(false)
  expect(reloadPending({ ...defaultSettings, fps: 60 }, started)).toBe(true)
  expect(reloadPending({ ...defaultSettings, wifiBand: '2.4ghz' }, started)).toBe(true)
})

test('Fahrenheit conversion', () => {
  expect(toFahrenheit(0)).toBe(32)
  expect(toFahrenheit(100)).toBe(212)
})
