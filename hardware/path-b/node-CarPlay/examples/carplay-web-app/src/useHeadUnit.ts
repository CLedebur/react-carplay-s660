import { useCallback, useEffect, useRef, useState } from 'react'
import { Control, ControlEvent } from './controls'
import {
  HoldAction,
  initialUi,
  isCarplayView,
  nativeKey,
  openPanel,
  openSwitcher,
  PowerAction,
  UiState,
} from './nav'
import { nextValue, Settings } from './settings'
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

export interface HeadUnitOptions {
  plugged: boolean // the phone is connected and CarPlay is streaming
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reloadCarplay: () => void
}

// The native UI's state and its share of the physical controls. `onControl` takes every control
// event and returns the one CarPlay should receive, or null when the native UI used it.
// `carplayShown` is whether CarPlay's video is what is on the glass: the phone is connected and
// either the setting says to run it automatically or the user has asked for it this connection.
export const useHeadUnit = ({ plugged, settings, update, reloadCarplay }: HeadUnitOptions) => {
  const [ui, setUiState] = useState<UiState>(initialUi)
  const uiRef = useRef(ui)
  const setUi = useCallback((next: UiState) => {
    uiRef.current = next
    setUiState(next)
  }, [])

  const [asked, setAsked] = useState(false) // the user opened CarPlay since the phone last connected
  useEffect(() => {
    if (!plugged) setAsked(false)
  }, [plugged])
  const carplayShown = plugged && (settings.autoRunCarplay || asked)
  const shownRef = useRef(carplayShown)
  shownRef.current = carplayShown
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const updateRef = useRef(update)
  updateRef.current = update
  const reloadRef = useRef(reloadCarplay)
  reloadRef.current = reloadCarplay

  const [holding, setHolding] = useState<HoldAction | null>(null)
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
    (action: HoldAction) => {
      cancelHold()
      setHolding(action)
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null
        setHolding(null)
        if (action === 'reload') return reloadRef.current()
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
      const carplayView = isCarplayView(uiRef.current, shownRef.current)

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
        setAsked(true)
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
      if (result.opensCarplay) setAsked(true)
      if (result.cycle) updateRef.current({ [result.cycle]: nextValue(settingsRef.current, result.cycle) })
      if (result.hold) beginHold(result.hold)
      return null
    },
    [beginHold, cancelHold, setUi],
  )

  return { ui, carplayShown, holding, power, lastKey, onControl }
}
