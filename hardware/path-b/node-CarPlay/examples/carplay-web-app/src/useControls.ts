import { useEffect, useRef } from 'react'
import { ControlHandler, KEY_CODE_TO_CONTROL } from './controls'

// One window-level listener for the physical controls. The caller passes the handler of the
// view that is on screen; swapping views swaps the handler without re-adding listeners.
// Keys that are not panel controls (a bench keyboard's other keys) pass through untouched.
export const useControls = (handler: ControlHandler | null) => {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const control = KEY_CODE_TO_CONTROL[e.code]
      if (!control) return
      // Enter/Escape/arrows would otherwise act on whatever the page has focused.
      e.preventDefault()
      handlerRef.current?.({
        control,
        pressed: e.type === 'keydown',
        repeat: e.repeat,
      })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])
}
