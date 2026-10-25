import { CommandValue } from 'node-carplay/web'

// Physical controls: the S660's centre-console audio switch panel, read by the OPERA MITM Pico
// and presented to the Pi as a plain USB keyboard (hardware/opera-mitm/firmware/src/config.h,
// BUILD_NOTES §30). Keep this table in step with the firmware's KEY_* defines.
export type Control = 'knobCw' | 'knobCcw' | 'knobPush' | 'back' | 'mode' | 'phone'

export const KEY_CODE_TO_CONTROL: Record<string, Control> = {
  ArrowRight: 'knobCw',
  ArrowLeft: 'knobCcw',
  Enter: 'knobPush',
  Escape: 'back',
  KeyM: 'mode',
  KeyP: 'phone',
}

// One press or release. `repeat` is the OS key auto-repeat while a button is held; views that
// want long-press behaviour time it from the first press instead of counting repeats.
export interface ControlEvent {
  control: Control
  pressed: boolean
  repeat: boolean
}

// Which screen owns the controls. Only 'carplay' exists today; the native head-unit UI
// (CAN-bus settings etc.) will be a second view in this same page, never a second tab —
// the dongle's WebUSB grant is per-origin (BUILD_NOTES §28). Each view gets its own handler,
// so the panel means "CarPlay knob" in one and "native menu knob" in the other.
export type View = 'carplay' | 'native'

export type ControlHandler = (event: ControlEvent) => void

// CarPlay's non-touch (rotary) model: Left/Right move the focus, Select is a press-and-release
// pair. The knob sends no release of its own (the firmware pulses its key for 25 ms), so turns
// act on press only.
export const carplayCommandsFor = ({
  control,
  pressed,
  repeat,
}: ControlEvent): CommandValue[] => {
  if (repeat) return []
  switch (control) {
    case 'knobCw':
      return pressed ? ['right'] : []
    case 'knobCcw':
      return pressed ? ['left'] : []
    case 'knobPush':
      return [pressed ? 'selectDown' : 'selectUp']
    case 'back':
      return pressed ? ['back'] : []
    case 'mode':
      return pressed ? ['home'] : []
    case 'phone':
      return pressed ? ['playOrPause'] : []
  }
}
