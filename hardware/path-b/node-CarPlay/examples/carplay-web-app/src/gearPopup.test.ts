import { FORGET_MS, initialGearPopup, SETTLE_MS, stepGearPopup } from './gearPopup'
import { Gear } from './vehicle'

// Feed the estimate every 200 ms (the Vehicle poll) and return what is on screen at each step.
const run = (seq: (Gear | null)[], showMs = 2000) => {
  let s = initialGearPopup
  return seq.map((g, i) => (s = stepGearPopup(s, g, i * 200, showMs)).shown)
}

test('a new gear shows once it has held, and goes after the set time', () => {
  const shown = run([2, 2, 2, 2, ...Array(12).fill(2)])
  expect(shown.slice(0, 2)).toEqual([null, null]) // settling (400 ms)
  expect(shown[2]).toBe(2)
  expect(shown[11]).toBe(2) // 2 s from 400 ms ...
  expect(shown[12]).toBeNull() // ... ends at 2.4 s
})

test('a shift through the clutch (null between) shows the new gear; a quick change replaces it and restarts the time', () => {
  const shown = run([2, 2, 2, null, null, 3, 3, 3, 3, 4, 4, 4, ...Array(12).fill(4)])
  expect(shown[2]).toBe(2)
  expect(shown[7]).toBe(3)
  expect(shown[11]).toBe(4)
  expect(shown[11 + 9]).toBe(4) // 2 s after 4 settled at 2.2 s
  expect(shown[11 + 10]).toBeNull()
})

test('the same gear after the clutch does not show again; after a stop, pulling away in 1 does', () => {
  expect(run([1, 1, 1, null, 1, 1, 1], 0)).toEqual(Array(7).fill(null)) // 0 = off
  const stop = Math.ceil(FORGET_MS / 200) + 1
  const shown = run([1, 1, 1, ...Array(12).fill(1), ...Array(stop).fill(null), 1, 1, 1])
  expect(shown[shown.length - 1]).toBe(1)
  expect(SETTLE_MS).toBe(400)
})
