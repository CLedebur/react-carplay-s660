import { Gear } from './vehicle'

// The gear pop-up over CarPlay: when the estimated gear settles on a new value, show it for the set
// time; a further change before then replaces it and restarts the time. Pure, so it is unit-tested.
// The estimate drops to null whenever the clutch is pressed or the car is nearly stopped, so a gear
// counts only once it has held for SETTLE_MS, and the remembered gear is forgotten after FORGET_MS of
// null (a stop): pulling away then shows 1 again.
export const SETTLE_MS = 300
export const FORGET_MS = 3000

export interface GearPopup {
  settled: Gear | null // the last gear that held for SETTLE_MS
  seen: Gear | null // the estimate now
  seenAt: number // when `seen` last changed
  shown: Gear | null // on screen until `until`
  until: number
}

export const initialGearPopup: GearPopup = { settled: null, seen: null, seenAt: 0, shown: null, until: 0 }

export const stepGearPopup = (s: GearPopup, gear: Gear | null, now: number, showMs: number): GearPopup => {
  let next = gear === s.seen ? s : { ...s, seen: gear, seenAt: now }
  if (gear !== null && gear === next.seen && gear !== next.settled && now - next.seenAt >= SETTLE_MS) {
    next = { ...next, settled: gear, shown: showMs > 0 ? gear : null, until: now + showMs }
  }
  if (gear === null && next.settled !== null && now - next.seenAt >= FORGET_MS) next = { ...next, settled: null }
  if (next.shown !== null && now >= next.until) next = { ...next, shown: null }
  return next
}
