import { ExtraConfig } from "./Globals";
import { Server } from 'socket.io'
import { EventEmitter } from 'events'
import { Stream } from "socketmost/dist/modules/Messages";

export enum MessageNames {
  Connection = 'connection',
  GetSettings = 'getSettings',
  SaveSettings = 'saveSettings',
  Stream = 'stream',
  KeyCommand = 'keyCommand'
}

export class Socket extends EventEmitter {
  config: ExtraConfig
  io: Server
  saveSettings: (settings: ExtraConfig) => void
  constructor(config: ExtraConfig, saveSettings: (settings: ExtraConfig) => void) {
    super()
    this.config = config
    this.saveSettings = saveSettings
    this.io = new Server({
      cors: {
        origin: '*'
      }
    })

    this.io.on(MessageNames.Connection, (socket) => {
      this.sendSettings()

      socket.on(MessageNames.GetSettings, () => {
        this.sendSettings()
      })

      socket.on(MessageNames.SaveSettings, (settings: ExtraConfig) => {
        this.saveSettings(settings)
      })

      socket.on(MessageNames.Stream, (stream: Stream) => {
        this.emit(MessageNames.Stream, stream)
      })

      // Relays a key command from any connected client (e.g. a phone-based
      // remote control page) to every client, including the renderer, which
      // feeds it into the same pipeline as a physical/keyboard key press.
      socket.on(MessageNames.KeyCommand, (command: string) => {
        this.io.emit(MessageNames.KeyCommand, command)
      })
    })

    this.io.listen(4000)
  }

  sendSettings() {
    this.io.emit('settings', this.config)
  }

  sendReverse(reverse: boolean) {
    this.io.emit('reverse', reverse)
  }

  sendLights(lights: boolean) {
    this.io.emit('lights', lights)
  }
}
