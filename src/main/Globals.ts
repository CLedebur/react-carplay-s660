import { Stream } from "socketmost/dist/modules/Messages";
import { DongleConfig } from 'node-carplay/node'

export type Most = {
  stream?: Stream
}

// Render backend used by the video pipeline (see Carplay.tsx / Render.worker).
// 'webgl2' is a good default on the Pi 4 / CM4 (V3D, GLES 3.1).
export type RendererType = 'webgl' | 'webgl2' | 'webgpu'

export type ExtraConfig = DongleConfig & {
  kiosk: boolean,
  camera: string,
  microphone: string,
  piMost: boolean,
  canbus: boolean,
  bindings: KeyBindings,
  renderer: RendererType,
  most?: Most,
  canConfig?: CanConfig
}

export interface KeyBindings {
  'left': string,
  'right': string,
  'selectDown': string,
  'back': string,
  'down': string,
  'home': string,
  'play': string,
  'pause': string,
  'next': string,
  'prev': string,
  'siri': string
}

export interface CanMessage {
  canId: number,
  byte: number,
  mask: number
}

export interface CanConfig {
  reverse?: CanMessage,
  lights?: CanMessage
}
