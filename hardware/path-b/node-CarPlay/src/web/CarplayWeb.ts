import {
  Message,
  Plugged,
  Unplugged,
  VideoData,
  AudioData,
  MediaData,
  SendCommand,
  Command,
  DongleDriver,
  DongleConfig,
  DEFAULT_CONFIG,
} from '../modules/index.js'

const { knownDevices } = DongleDriver

export type CarplayMessage =
  | { type: 'plugged'; message?: undefined }
  | { type: 'unplugged'; message?: undefined }
  | { type: 'failure'; message?: string }
  | { type: 'warning'; message: string }
  | { type: 'audio'; message: AudioData }
  | { type: 'video'; message: VideoData }
  | { type: 'media'; message: MediaData }
  | { type: 'command'; message: Command }

export const isCarplayDongle = (device: USBDevice) => {
  const known = knownDevices.some(
    kd => kd.productId === device.productId && kd.vendorId === device.vendorId,
  )
  return known
}

export const findDevice = async (): Promise<USBDevice | null> => {
  try {
    const devices = await navigator.usb.getDevices()
    return (
      devices.find(d => {
        return isCarplayDongle(d) ? d : undefined
      }) || null
    )
  } catch (err) {
    return null
  }
}

export const requestDevice = async (): Promise<USBDevice | null> => {
  try {
    const { knownDevices } = DongleDriver
    const device = await navigator.usb.requestDevice({
      filters: knownDevices,
    })
    return device
  } catch (err) {
    return null
  }
}

export default class CarplayWeb {
  private _started: boolean = false
  private _pairTimeout: NodeJS.Timeout | null = null
  private _frameInterval: NodeJS.Timer | null = null
  private _config: DongleConfig
  public dongleDriver: DongleDriver

  constructor(config: Partial<DongleConfig>) {
    this._config = Object.assign({}, DEFAULT_CONFIG, config)
    const driver = new DongleDriver()
    driver.on('message', (message: Message) => {
      if (message instanceof Plugged) {
        this.clearPairTimeout()
        this.clearFrameInterval()

        const phoneTypeConfg = this._config.phoneConfig[message.phoneType]
        if (phoneTypeConfg?.frameInterval) {
          this._frameInterval = setInterval(
            () => {
              this.dongleDriver.send(new SendCommand('frame'))
            },
            phoneTypeConfg?.frameInterval,
          )
        }
        this.onmessage?.({ type: 'plugged' })
      } else if (message instanceof Unplugged) {
        this.onmessage?.({ type: 'unplugged' })
        // The dongle does not always re-initiate its own Wi-Fi handshake with the phone once
        // it comes back (e.g. after the phone's Wi-Fi is toggled off and on) -- previously the
        // only way to recover was a physical USB unplug/replug of the dongle, since that
        // handshake was otherwise only ever sent once, right after the initial USB claim.
        // Re-run the same wifiConnect-then-wifiPair sequence used at boot so a dropped phone
        // reconnects on its own.
        this.restartPairing()
      } else if (message instanceof VideoData) {
        this.clearPairTimeout()
        this.onmessage?.({ type: 'video', message })
      } else if (message instanceof AudioData) {
        this.clearPairTimeout()
        this.onmessage?.({ type: 'audio', message })
      } else if (message instanceof MediaData) {
        this.clearPairTimeout()
        this.onmessage?.({ type: 'media', message })
      } else if (message instanceof Command) {
        this.onmessage?.({ type: 'command', message })
      }
    })
    driver.on('failure', (reason?: Error) => {
      this.onmessage?.({ type: 'failure', message: reason?.message })
    })
    this.dongleDriver = driver
  }

  private clearPairTimeout() {
    if (this._pairTimeout) {
      clearTimeout(this._pairTimeout)
      this._pairTimeout = null
    }
  }

  private clearFrameInterval() {
    if (this._frameInterval) {
      clearInterval(this._frameInterval)
      this._pairTimeout = null
    }
  }

  // Same wifiConnect-then-wifiPair(15s) sequence the initial start() runs, factored out so it
  // can also run on a reconnect. clearPairTimeout() is called first to avoid stacking timers if
  // this ever fires more than once before a Plugged message arrives.
  private restartPairing() {
    if (!this._started) return
    this.clearPairTimeout()
    this.dongleDriver.send(new SendCommand('wifiConnect'))
    this._pairTimeout = setTimeout(() => {
      console.debug('phone not reconnected, sending pair')
      this.dongleDriver.send(new SendCommand('wifiPair'))
    }, 15000)
  }

  public onmessage: ((ev: CarplayMessage) => void) | null = null

  start = async (usbDevice: USBDevice) => {
    if (this._started) return
    const { initialise, start, send } = this.dongleDriver

    try {
      console.debug('opening device')
      await usbDevice.open()

      try {
        await usbDevice.reset()
      } catch (err) {
        // Not every USB controller/hub supports a port reset for this dongle (observed on
        // the S660 CM4 unit: "Unable to reset the device"). Reset only clears stale state
        // from a previous session -- it is not required for the CarPlay handshake -- so a
        // failure here must not abort the connection. Report it as a non-fatal warning
        // instead of 'failure', which would otherwise arm the 30s reload-on-failure timer
        // in the UI even though the device goes on to connect fine.
        console.warn('USB device reset failed, continuing without it', err)
        this.onmessage?.({
          type: 'warning',
          message: `USB reset unsupported: ${err instanceof Error ? err.message : String(err)}`,
        })
      }

      await initialise(usbDevice)
      await start(this._config)
      this._pairTimeout = setTimeout(() => {
        console.debug('no device, sending pair')
        send(new SendCommand('wifiPair'))
      }, 15000)
      this._started = true
    } catch (err) {
      console.error('Failed to start CarPlay session', err)
      this.onmessage?.({
        type: 'failure',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  stop = async () => {
    try {
      this.clearFrameInterval()
      this.clearPairTimeout()
      await this.dongleDriver.close()
    } catch (err) {
      console.error(err)
    } finally {
      this._started = false
    }
  }
}
