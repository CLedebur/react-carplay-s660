import { useCallback, useEffect, useRef, useState } from 'react'
import { Control, ControlEvent } from './controls'
import {
  initialUi,
  isCarplayView,
  nativeKey,
  openPanel,
  openSwitcher,
  PowerAction,
  UiState,
} from './nav'
import { requestPower } from './useSystemStats'

export const MODE_HOLD_MS = 600 // hold Mode this long to open the panel switcher
export const POWER_HOLD_MS = 1500 // hold the knob this long on Restart / Shut down

const CONTROL_LABEL: Record<Control, string> = {
  knobCw: 'Knob →',
  knobCcw: 'Knob ←',
  knobPush: 'Knob push',
  back: 'Back',
  mode: 'Mode',
  phone: 'Phone',
}

export interface PowerNotice {
  action: PowerAction
  state: 'sending' | 'done' | 'failed'
  error?: string
}

// The native UI's state and its share of the physical controls. `onControl` takes every control
// event and returns the one CarPlay should receive, or null when the native UI used it.
export const useHeadUnit = (streaming: boolean) => {
  const [ui, setUiState] = useState<UiState>(initialUi)
  const uiRef = useRef(ui)
  const setUi = useCallback((next: UiState) => {
    uiRef.current = next
    setUiState(next)
  }, [])

  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  const [holding, setHolding] = useState<PowerAction | null>(null)
  const [power, setPower] = useState<PowerNotice | null>(null)
  const [lastKey, setLastKey] = useState<string | null>(null)

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeWasHeld = useRef(false)
  // Controls whose press went to CarPlay, so their release does too (and a release of a press the
  // native UI used, e.g. the push that closed the switcher, never reaches CarPlay as a stray selectUp).
  const forwarded = useRef(new Set<Control>())

  const cancelHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHolding(null)
  }, [])

  const beginHold = useCallback(
    (action: PowerAction) => {
      cancelHold()
      setHolding(action)
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null
        setHolding(null)
        setPower({ action, state: 'sending' })
        requestPower(action).then(
          () => setPower({ action, state: 'done' }), // stays up: the Pi is going away
          err => {
            setPower({ action, state: 'failed', error: String(err.message ?? err) })
            setTimeout(() => setPower(null), 6000)
          },
        )
      }, POWER_HOLD_MS)
    },
    [cancelHold],
  )

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
      if (modeTimer.current) clearTimeout(modeTimer.current)
    },
    [],
  )

  const onControl = useCallback(
    (event: ControlEvent): ControlEvent | null => {
      const { control, pressed, repeat } = event
      if (pressed && !repeat) setLastKey(CONTROL_LABEL[control])
      const carplayView = isCarplayView(uiRef.current, streamingRef.current)

      if (control === 'mode') {
        if (repeat) return null
        if (pressed) {
          modeWasHeld.current = false
          if (modeTimer.current) clearTimeout(modeTimer.current)
          modeTimer.current = setTimeout(() => {
            modeTimer.current = null
            modeWasHeld.current = true
            if (!uiRef.current.switcher) setUi(openSwitcher(uiRef.current))
          }, MODE_HOLD_MS)
          return null
        }
        if (modeTimer.current) clearTimeout(modeTimer.current)
        modeTimer.current = null
        if (modeWasHeld.current) return null
        if (carplayView) return event // a tap is CarPlay's Home
        setUi(openPanel('carplay')) // a tap anywhere else goes back to CarPlay
        return null
      }

      if (carplayView) {
        if (pressed) {
          forwarded.current.add(control)
          return event
        }
        return forwarded.current.delete(control) ? event : null
      }

      if (!pressed) {
        if (control === 'knobPush') cancelHold() // released early: nothing happens
        return null
      }
      if (repeat) return null
      const result = nativeKey(uiRef.current, control)
      if (result.ui !== uiRef.current) setUi(result.ui)
      if (result.hold) beginHold(result.hold)
      return null
    },
    [beginHold, cancelHold, setUi],
  )

  return { ui, holding, power, lastKey, onControl }
}
