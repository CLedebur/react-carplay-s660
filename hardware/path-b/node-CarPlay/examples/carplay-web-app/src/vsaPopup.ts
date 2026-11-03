// The stability pop-up: when the car's own counts of AHA, VSA or ABS interventions go up (s660-can.js
// counts them as they start, from 0x1A4), show which one for the set time; a further one restarts the
// time. Pure, so it is unit-tested. The first counts seen are only a baseline, and a count that falls
// (the CAN service restarted) is a new baseline, not an event.
export type VsaEvents = { agile: number; active: number; abs: number }
export type VsaLabel = 'AHA' | 'VSA' | 'ABS'

export interface VsaPopup {
  last: VsaEvents | null
  shown: VsaLabel | null // on screen until `until`
  until: number
}

export const initialVsaPopup: VsaPopup = { last: null, shown: null, until: 0 }

// If two start together, the stronger intervention is the one named.
const ORDER: [keyof VsaEvents, VsaLabel][] = [['abs', 'ABS'], ['active', 'VSA'], ['agile', 'AHA']]

export const stepVsaPopup = (s: VsaPopup, ev: VsaEvents | null, now: number, showMs: number): VsaPopup => {
  let next = s
  if (ev) {
    const last = s.last
    const fell = !last || ORDER.some(([k]) => ev[k] < last[k])
    const rose = !fell && ORDER.find(([k]) => ev[k] > last![k])
    if (rose && showMs > 0) next = { ...next, shown: rose[1], until: now + showMs }
    if (fell || rose) next = { ...next, last: ev }
  }
  if (next.shown !== null && now >= next.until) next = { ...next, shown: null }
  return next
}
