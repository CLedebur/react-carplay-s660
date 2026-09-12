export type WorkerEventType = 'init' | 'frame' | 'renderDone'

export type Renderer = 'webgl' | 'webgl2' | 'webgpu'

export interface WorkerEvent {
  type: WorkerEventType
}

export class RenderEvent implements WorkerEvent {
  type: WorkerEventType = 'frame'

  constructor(public frameData: ArrayBuffer) {}
}

export class InitEvent implements WorkerEvent {
  type: WorkerEventType = 'init'

  constructor(
    public canvas: OffscreenCanvas,
    public videoPort: MessagePort,
    public renderer: Renderer = 'webgl',
    public reportFps: boolean = false,
  ) {}
}

// Sent worker -> main thread when renderer init or frame decode/render fails.
// `fatal: true` means nothing will ever render again (renderer failed to init);
// `fatal: false` is a per-frame decode hiccup the pipeline can recover from.
export interface RenderErrorEvent {
  type: 'renderError'
  message: string
  fatal: boolean
}
