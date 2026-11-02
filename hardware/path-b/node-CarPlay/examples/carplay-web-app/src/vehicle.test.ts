import { batteryState } from './vehicle'

test('battery: engine running means the alternator should be charging', () => {
  expect(batteryState(14.2, 900)).toEqual({ label: 'CHARGING', tone: 'ok' })
  expect(batteryState(12.6, 900)).toEqual({ label: 'NOT CHARGING', tone: 'bad' })
  expect(batteryState(15.4, 3000)).toEqual({ label: 'OVERCHARGING', tone: 'bad' })
})

test('battery: engine stopped reads the state of charge', () => {
  expect(batteryState(12.7, 0)?.label).toBe('FULL')
  expect(batteryState(12.45, 0)?.label).toBe('GOOD')
  expect(batteryState(12.2, null)).toEqual({ label: 'LOW', tone: 'warn' })
  expect(batteryState(11.9, 0)).toEqual({ label: 'VERY LOW', tone: 'bad' })
  expect(batteryState(null, 0)).toBeNull()
})
