import { defaultSettings, GLASS_ASPECT, logicalWidth, nextValue, reloadPending, stepAspect, toFahrenheit } from './settings'

test('every setting steps to its next value and wraps', () => {
  expect(nextValue(defaultSettings, 'fps')).toBe(60)
  expect(nextValue({ ...defaultSettings, fps: 60 }, 'fps')).toBe(30)
  expect(nextValue(defaultSettings, 'autoRunCarplay')).toBe(false)
  expect(nextValue(defaultSettings, 'units')).toBe('f')
  expect(nextValue(defaultSettings, 'handDrive')).toBe('lhd')
})

test('only the settings that reach the dongle at start leave a reload pending', () => {
  const started = { handDrive: 'rhd', fps: 30, wifiBand: '5ghz', carplayWidth: 896 } as const
  expect(reloadPending(defaultSettings, null)).toBe(false) // CarPlay has not started yet
  expect(reloadPending(defaultSettings, started)).toBe(false)
  expect(reloadPending({ ...defaultSettings, units: 'f', clock: '12h', nightMode: true }, started)).toBe(false)
  expect(reloadPending({ ...defaultSettings, fps: 60 }, started)).toBe(true)
  expect(reloadPending({ ...defaultSettings, wifiBand: '2.4ghz' }, started)).toBe(true)
  expect(reloadPending({ ...defaultSettings, carplayWidth: 848 }, started)).toBe(true)
  expect(reloadPending({ ...defaultSettings, carplayShape: 'exact' }, started)).toBe(false) // applies at once
})

test('Fahrenheit conversion', () => {
  expect(toFahrenheit(0)).toBe(32)
  expect(toFahrenheit(100)).toBe(212)
})

test('the glass ratio steps coarse or fine and stays in range', () => {
  expect(stepAspect(1875, 1, false)).toBe(1895)
  expect(stepAspect(1875, -1, true)).toBe(1870)
  expect(stepAspect(GLASS_ASPECT.max, 1, false)).toBe(GLASS_ASPECT.max)
  expect(stepAspect(GLASS_ASPECT.min, -1, true)).toBe(GLASS_ASPECT.min)
})

test('the UI is drawn as wide as the glass: 1.875 gives 900, and 1.5 is the 720 the panel is fed', () => {
  expect(logicalWidth(1875)).toBe(900)
  expect(logicalWidth(1500)).toBe(720)
})
