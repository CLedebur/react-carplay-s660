import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { RotatingLines } from 'react-loader-spinner'
import './App.css'
import {
  findDevice,
  DongleConfig,
  CommandMapping,
  HandDriveType,
} from 'node-carplay/web'
import { CarPlayWorker } from './worker/types'
import useCarplayAudio from './useCarplayAudio'
import { useCarplayTouch } from './useCarplayTouch'
import { InitEvent, RenderErrorEvent } from './worker/render/RenderEvents'

// Display vs. video geometry (BUILD_NOTES 22.8). The S660 glass is 135x72 mm (1.875:1) behind a
// TV-style scaler that only accepts 720x480/720x576 and stretches whatever it gets across the
// glass. The HDMI output is 720x480 (EDID override + cmdline video=); iOS renders at the GLASS
// aspect, capped at 16:9 (848x480; wider makes Waze switch to an ultrawide layout that pushes its
// speed-limit badge off the left edge — 864/896 measured), and the canvas is displayed squeezed into
// 720x480, so the panel's stretch nearly restores square pixels (6% residual). Touch is normalised by the DISPLAY
// size. Hardcoded so the bench monitor (4K) cannot inflate window.innerWidth/innerHeight.
const DISPLAY_WIDTH = 720
const DISPLAY_HEIGHT = 480

// video: what the dongle / iOS renders. Default: 848 x 480
const width = 848
const height = 480


const videoChannel = new MessageChannel()
const micChannel = new MessageChannel()

const config: Partial<DongleConfig> = {
  width,
  height,
  fps: 30, // 60 was heavy on top of software decode; 30 halves it again, plenty for a dash
  mediaDelay: 300,
  hand: HandDriveType.RHD, // S660 is right-hand drive: iOS puts the CarPlay sidebar on the right
}

const RETRY_DELAY_MS = 30000

// How often to re-check for the dongle via navigator.usb.getDevices() (cheap, no device I/O).
// Backstops navigator.usb.ondisconnect, which was measured taking 15-30s to fire after a
// physical unplug on this hardware/browser combo.
const POLL_INTERVAL_MS = 2000

// Status/error line shown on the splash screen (BUILD_NOTES-adjacent: previously these
// conditions only ever reached console.error in a kiosk with no devtools — invisible).
type StatusLevel = 'info' | 'warn' | 'error'
interface StatusMessage {
  text: string
  level: StatusLevel
}

// Dongle-reported link status codes (CommandMapping) the app previously ignored entirely.
const LINK_STATUS_TEXT: Partial<Record<CommandMapping, string>> = {
  [CommandMapping.scanningDevice]: 'Scanning for phone…',
  [CommandMapping.deviceFound]: 'Phone found — connecting…',
  [CommandMapping.deviceNotFound]: 'Phone not found',
  [CommandMapping.connectDeviceFailed]: 'Connection failed',
  [CommandMapping.btPairStart]: 'Pairing Bluetooth…',
  [CommandMapping.btConnected]: 'Bluetooth connected',
  [CommandMapping.btDisconnected]: 'Bluetooth disconnected',
  [CommandMapping.wifiPair]: 'Pairing Wi-Fi…',
  [CommandMapping.wifiConnected]: 'Wi-Fi connected',
  [CommandMapping.wifiDisconnected]: 'Wi-Fi disconnected',
}

const LINK_STATUS_LEVEL: Partial<Record<CommandMapping, StatusLevel>> = {
  [CommandMapping.deviceNotFound]: 'warn',
  [CommandMapping.connectDeviceFailed]: 'error',
  [CommandMapping.btDisconnected]: 'warn',
  [CommandMapping.wifiDisconnected]: 'warn',
}

// White for every level -- on a 6" low-res dash panel, legibility beats severity color-coding.
const STATUS_TEXT_COLOR = '#ffffff'

// How long a transient status (a recoverable decode hiccup, a mic error, "disconnected")
// stays on screen before clearing itself. Persistent statuses (link state, fatal failures)
// are only replaced by the next status, never auto-cleared.
const TRANSIENT_STATUS_MS = 5000

function App() {
  const [isPlugged, setPlugged] = useState(false)
  const [deviceFound, setDeviceFound] = useState<Boolean | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [status, setStatusState] = useState<StatusMessage | null>(null)
  const statusClearTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const setStatus = useCallback(
    (text: string, level: StatusLevel, opts?: { transient?: boolean }) => {
      if (statusClearTimeoutRef.current) {
        clearTimeout(statusClearTimeoutRef.current)
        statusClearTimeoutRef.current = null
      }
      setStatusState({ text, level })
      if (opts?.transient) {
        statusClearTimeoutRef.current = setTimeout(() => {
          setStatusState(null)
        }, TRANSIENT_STATUS_MS)
      }
    },
    [],
  )

  const clearStatus = useCallback(() => {
    if (statusClearTimeoutRef.current) {
      clearTimeout(statusClearTimeoutRef.current)
      statusClearTimeoutRef.current = null
    }
    setStatusState(null)
  }, [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  )

  const renderWorker = useMemo(() => {
    if (!canvasElement) return

    const worker = new Worker(
      new URL('./worker/render/Render.worker.ts', import.meta.url),
    )
    const canvas = canvasElement.transferControlToOffscreen()
    worker.postMessage(new InitEvent(canvas, videoChannel.port2), [
      canvas,
      videoChannel.port2,
    ])
    return worker
  }, [canvasElement])

  useLayoutEffect(() => {
    if (canvasRef.current) {
      setCanvasElement(canvasRef.current)
    }
  }, [])

  const carplayWorker = useMemo(() => {
    const worker = new Worker(
      new URL('./worker/CarPlay.worker.ts', import.meta.url),
    ) as CarPlayWorker
    const payload = {
      videoPort: videoChannel.port1,
      microphonePort: micChannel.port1,
    }
    worker.postMessage({ type: 'initialise', payload }, [
      videoChannel.port1,
      micChannel.port1,
    ])
    return worker
  }, [])

  // No capture hardware exists on this unit (confirmed via `arecord -l`) -- mic init failures
  // are expected on every boot and stay console-only; see useCarplayAudio.ts.
  const { processAudio, getAudioPlayer, startRecording, stopRecording } =
    useCarplayAudio(carplayWorker, micChannel.port2)

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  // subscribe to worker messages
  useEffect(() => {
    carplayWorker.onmessage = ev => {
      const { type } = ev.data
      switch (type) {
        case 'plugged':
          // A successful connection means whatever earlier failure armed the reload timer
          // (e.g. a non-fatal USB reset warning at boot) is no longer relevant -- don't let
          // it force-reload a session that's now working. Previously only 'requestBuffer'/
          // 'audio' cleared this, so a working video-only connection (no audio traffic yet)
          // still got killed by a stale 30s timer from an unrelated earlier hiccup.
          clearRetryTimeout()
          setPlugged(true)
          clearStatus()
          break
        case 'unplugged':
          setPlugged(false)
          // Persistent, not transient: the phone stays disconnected until a fresh 'plugged'
          // arrives and clears it (that case already calls clearStatus()) -- auto-hiding this
          // after a few seconds would make it vanish while still genuinely disconnected.
          setStatus('Phone not connected', 'warn')
          break
        case 'requestBuffer':
          clearRetryTimeout()
          getAudioPlayer(ev.data.message)
          break
        case 'audio':
          clearRetryTimeout()
          processAudio(ev.data.message)
          break
        case 'media':
          //TODO: implement
          break
        case 'warning':
          setStatus(ev.data.message, 'warn', { transient: true })
          break
        case 'command':
          const {
            message: { value },
          } = ev.data
          switch (value) {
            case CommandMapping.startRecordAudio:
              startRecording()
              break
            case CommandMapping.stopRecordAudio:
              stopRecording()
              break
            default: {
              const text = LINK_STATUS_TEXT[value]
              if (text) {
                setStatus(text, LINK_STATUS_LEVEL[value] ?? 'info')
              }
            }
          }
          break
        case 'failure':
          setStatus(
            ev.data.message
              ? `Connection failed: ${ev.data.message}`
              : 'Connection failed — retrying',
            'error',
          )
          if (retryTimeoutRef.current == null) {
            console.error(
              `Carplay initialization failed -- Reloading page in ${RETRY_DELAY_MS}ms`,
            )
            retryTimeoutRef.current = setTimeout(() => {
              window.location.reload()
            }, RETRY_DELAY_MS)
          }
          break
      }
    }
  }, [
    carplayWorker,
    clearRetryTimeout,
    clearStatus,
    getAudioPlayer,
    processAudio,
    renderWorker,
    setStatus,
    startRecording,
    stopRecording,
  ])

  // render worker: renderer-init and decode/render errors (previously console.error only,
  // with no onerror handler at all — an uncaught exception in this worker just vanished).
  useEffect(() => {
    if (!renderWorker) return
    renderWorker.onmessage = ev => {
      const data = ev.data as RenderErrorEvent | undefined
      if (data?.type === 'renderError') {
        setStatus(data.message, 'error', { transient: !data.fatal })
      }
    }
    renderWorker.onerror = ev => {
      console.error('Render worker crashed', ev)
      setStatus(ev.message || 'Video renderer crashed', 'error')
    }
  }, [renderWorker, setStatus])

  // findDevice() -> navigator.usb.getDevices() only ever returns devices this origin is
  // already permitted to use. That permission now comes from the WebUsbAllowDevicesForUrls
  // managed policy provision.sh installs (BUILD_NOTES §28), not from a requestDevice() chooser
  // -- so no user gesture is ever needed, and the old invisible "tap to authorise" button is gone.
  const checkDevice = useCallback(
    async () => {
      const device = await findDevice()
      if (device) {
        setDeviceFound(true)
        clearStatus()
        const payload = {
          config,
        }
        carplayWorker.postMessage({ type: 'start', payload })
      } else {
        carplayWorker.postMessage({ type: 'stop' })
        setDeviceFound(false)
        setStatus('Dongle not connected', 'warn')
      }
    },
    [carplayWorker, setStatus, clearStatus],
  )

  // usb connect/disconnect handling and device check. `navigator.usb.ondisconnect` alone was
  // measured taking 15-30s to fire after a physical unplug on this hardware/browser combo --
  // this is Chromium/the kernel noticing the device is gone, not app logic, and isn't something
  // we can speed up directly. POLL_INTERVAL_MS re-runs the same cheap getDevices()-based check
  // on a short, predictable cadence so a real disconnect is never worse-case-bound by that OS
  // event's own latency.
  useEffect(() => {
    navigator.usb.onconnect = async () => {
      checkDevice()
    }

    navigator.usb.ondisconnect = async () => {
      checkDevice()
    }

    checkDevice()
    const pollId = setInterval(checkDevice, POLL_INTERVAL_MS)
    return () => clearInterval(pollId)
  }, [carplayWorker, checkDevice])

  const sendTouchEvent = useCarplayTouch(carplayWorker, DISPLAY_WIDTH, DISPLAY_HEIGHT)

  const isLoading = !isPlugged

  return (
    <div
      style={{ height: '100%', touchAction: 'none' }}
      id={'main'}
      className="App"
    >
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {deviceFound === true && (
            // S660 kiosk: small, dim "waiting for the phone" indicator near the bottom edge
            // instead of a big grey spinner over the logo.
            <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
              <RotatingLines
                strokeColor="#3a3a3a"
                strokeWidth="4"
                animationDuration="1"
                width="28"
                visible={true}
              />
            </div>
          )}
        </div>
      )}
      <div
        id="videoContainer"
        onPointerDown={sendTouchEvent}
        onPointerMove={sendTouchEvent}
        onPointerUp={sendTouchEvent}
        onPointerCancel={sendTouchEvent}
        onPointerOut={sendTouchEvent}
        style={{
          height: `${DISPLAY_HEIGHT}px`,
          width: `${DISPLAY_WIDTH}px`,
          padding: 0,
          margin: '0 auto',
          display: 'flex',
        }}
      >
        <canvas
          ref={canvasRef}
          id="video"
          style={isPlugged ? { width: '100%', height: '100%' } : { display: 'none' }} // squeeze 896 -> 720
        />
      </div>
      {status && (status.level === 'error' || isLoading) && (
        // Status/error line: sits above the "waiting for phone" spinner while loading;
        // only errors (not routine link-status info) interrupt the video once connected.
        <div
          style={{
            position: 'absolute',
            bottom: isLoading ? 70 : 20,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontFamily: 'sans-serif',
            fontSize: 24,
            fontWeight: 600,
            color: STATUS_TEXT_COLOR,
            textShadow: '0 1px 3px rgba(0,0,0,0.85)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  )
}

export default App
